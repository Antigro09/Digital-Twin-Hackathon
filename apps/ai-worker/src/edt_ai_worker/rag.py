from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid5

from pydantic import Field

from .documents import ParsedDocument
from .embeddings import EmbeddingProvider
from .errors import DomainError
from .intelligence_models import (
    Classification,
    ContextEvidence,
    DocumentImportReceipt,
    DocumentImportRequest,
    EvidenceAccessBinding,
    RetrievedKnowledge,
    RetrievalSearchRequest,
    RetrievalSearchResult,
    SourceACL,
    TokenUsage,
)
from .models import StrictModel
from .safety import content_sha256, inspect_untrusted_content
from .storage import DurableRecordStore
from .tenancy import ActorContext


KNOWLEDGE_CHUNK_KIND = "knowledge_chunk"
_EVIDENCE_NAMESPACE = UUID("a34f1631-f2bb-46c5-b2ed-e8b129831a24")
_IMPORT_NAMESPACE = UUID("bd53de30-0870-4c0f-ab5c-aa5b3c823446")
_EPHEMERAL_NAMESPACE = UUID("da061291-a95e-49f0-9177-259a70147a5c")
_WORD = re.compile(r"[\w.-]{2,}", re.UNICODE)


class KnowledgeChunk(StrictModel):
    evidence_id: UUID
    tenant_id: UUID
    document_id: UUID
    source_locator: str
    media_type: str
    classification: Classification
    source_acl: SourceACL
    authorization_source: Literal[
        "durable_knowledge", "request_context", "validated_memory"
    ] = "durable_knowledge"
    content: str = Field(min_length=1, max_length=4000)
    content_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    confidence: float = Field(ge=0, le=1)
    embedding: list[float] | None = None
    embedding_model: str | None = None
    indexed_at: datetime
    security_flags: list[str]
    quarantined: bool


def _chunks(text: str, *, target: int = 1200, overlap: int = 120) -> list[str]:
    compact = text.replace("\x00", "").strip()
    values: list[str] = []
    cursor = 0
    while cursor < len(compact):
        end = min(cursor + target, len(compact))
        if end < len(compact):
            boundary = max(compact.rfind("\n", cursor + target // 2, end), compact.rfind(". ", cursor, end))
            if boundary > cursor:
                end = boundary + 1
        value = compact[cursor:end].strip()
        if value:
            values.append(value)
        if end >= len(compact):
            break
        cursor = max(cursor + 1, end - overlap)
    return values


def _terms(text: str) -> set[str]:
    return {match.group(0).casefold() for match in _WORD.finditer(text)}


def _lexical(query: set[str], content: str) -> float:
    candidate = _terms(content)
    if not query or not candidate:
        return 0.0
    intersection = len(query & candidate)
    coverage = intersection / len(query)
    jaccard = intersection / len(query | candidate)
    return min(1.0, 0.8 * coverage + 0.2 * jaccard)


def _cosine(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    numerator = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if not left_norm or not right_norm:
        return 0.0
    return max(-1.0, min(1.0, numerator / (left_norm * right_norm)))


def _usage_total(values: list[TokenUsage]) -> TokenUsage | None:
    if not values:
        return None
    measurement = (
        "unavailable"
        if any(item.measurement == "unavailable" for item in values)
        else "provider_reported"
    )
    return TokenUsage(
        input_tokens=sum(item.input_tokens for item in values),
        output_tokens=sum(item.output_tokens for item in values),
        total_tokens=sum(item.total_tokens for item in values),
        measurement=measurement,
    )


def _roles(context: ActorContext) -> set[str]:
    return {permission.removeprefix("role:") for permission in context.permissions if permission.startswith("role:")}


def is_authorized(context: ActorContext, acl: SourceACL) -> bool:
    if not context.may_access(acl.required_permissions):
        return False
    if acl.visibility == "tenant":
        return True
    return context.actor_id in acl.allowed_actor_ids or bool(_roles(context) & set(acl.allowed_roles))


class KnowledgeIndex:
    def __init__(
        self,
        store: DurableRecordStore,
        *,
        embedding_provider: EmbeddingProvider | None,
        embedding_model: str | None,
        max_candidates: int,
    ) -> None:
        self.store = store
        self.embedding_provider = embedding_provider
        self.embedding_model = embedding_model
        self.max_candidates = max_candidates
        self._vector_verified = False

    @property
    def vector_configured(self) -> bool:
        return self.embedding_provider is not None

    @property
    def vector_ready(self) -> bool:
        return self.embedding_provider is not None and self._vector_verified

    def import_document(
        self,
        body: DocumentImportRequest,
        parsed: ParsedDocument,
        context: ActorContext,
    ) -> DocumentImportReceipt:
        if not is_authorized(context, body.source_acl):
            raise DomainError(
                "invalid_source_acl",
                "The importing actor is not included in the normalized source ACL.",
                status_code=403,
            )
        now = datetime.now(timezone.utc)
        raw_chunks = _chunks(parsed.text)
        if not raw_chunks or len(raw_chunks) > 5000:
            raise DomainError(
                "document_limit_exceeded",
                "Document chunk count is outside the supported range.",
                status_code=413,
            )
        flags = [inspect_untrusted_content(item) for item in raw_chunks]
        safe_positions = [index for index, value in enumerate(flags) if not value]
        vectors: dict[int, list[float]] = {}
        vector_models: dict[int, str] = {}
        embedding_usage: list[TokenUsage] = []
        if self.embedding_provider and safe_positions:
            for start in range(0, len(safe_positions), 100):
                positions = safe_positions[start : start + 100]
                embedded = self.embedding_provider.embed_with_usage(
                    [raw_chunks[index] for index in positions]
                )
                self._vector_verified = True
                vectors.update(zip(positions, embedded.vectors, strict=True))
                vector_models.update((position, embedded.model) for position in positions)
                embedding_usage.append(embedded.usage)

        new_ids: set[UUID] = set()
        for index, content in enumerate(raw_chunks):
            evidence_id = uuid5(
                _EVIDENCE_NAMESPACE,
                f"{context.tenant_id}:{body.document_id}:{index}:{content_sha256(content)}",
            )
            new_ids.add(evidence_id)
            chunk = KnowledgeChunk(
                evidence_id=evidence_id,
                tenant_id=context.tenant_id,
                document_id=body.document_id,
                source_locator=f"{body.source_locator}#chunk={index}",
                media_type=body.media_type.split(";", 1)[0].casefold(),
                classification=body.classification,
                source_acl=body.source_acl,
                content=(
                    content
                    if not flags[index]
                    else "[QUARANTINED: sensitive or instruction-like content removed]"
                ),
                content_sha256=content_sha256(content),
                confidence=body.confidence,
                embedding=vectors.get(index),
                embedding_model=vector_models.get(index),
                indexed_at=now,
                security_flags=flags[index],
                quarantined=bool(flags[index]),
            )
            self.store.put(
                tenant_id=context.tenant_id,
                kind=KNOWLEDGE_CHUNK_KIND,
                record_id=evidence_id,
                actor_id=context.actor_id,
                created_at=now.isoformat(),
                payload=chunk.model_dump(mode="json"),
            )

        # Remove superseded chunks from the same document after all replacements
        # are durable, so a failed import cannot erase the previous source.
        for existing in self.store.list(
            tenant_id=context.tenant_id,
            kind=KNOWLEDGE_CHUNK_KIND,
            limit=self.max_candidates,
        ):
            chunk = KnowledgeChunk.model_validate(existing)
            if chunk.document_id == body.document_id and chunk.evidence_id not in new_ids:
                self.store.delete(
                    tenant_id=context.tenant_id,
                    kind=KNOWLEDGE_CHUNK_KIND,
                    record_id=chunk.evidence_id,
                )

        quarantined = sum(bool(value) for value in flags)
        import_id = uuid5(
            _IMPORT_NAMESPACE,
            f"{context.tenant_id}:{body.document_id}:{parsed.content_sha256}",
        )
        return DocumentImportReceipt(
            import_id=import_id,
            document_id=body.document_id,
            status="QUARANTINED" if quarantined else "INDEXED",
            chunks_indexed=len(raw_chunks) - quarantined,
            chunks_quarantined=quarantined,
            evidence_ids=sorted(new_ids, key=str),
            media_type=body.media_type.split(";", 1)[0].casefold(),
            content_sha256=parsed.content_sha256,
            parser=parsed.parser,
            imported_at=now,
            embedding_usage=_usage_total(embedding_usage),
            embedding_model=(
                next(iter(set(vector_models.values())))
                if len(set(vector_models.values())) == 1
                else None
            ),
        )

    def _visible_chunks(self, context: ActorContext) -> list[KnowledgeChunk]:
        raw = self.store.list(
            tenant_id=context.tenant_id,
            kind=KNOWLEDGE_CHUNK_KIND,
            limit=self.max_candidates,
        )
        values = [KnowledgeChunk.model_validate(item) for item in raw]
        return [
            item
            for item in values
            if not item.quarantined and is_authorized(context, item.source_acl)
        ]

    def get_authorized(self, context: ActorContext, evidence_ids: list[UUID]) -> list[KnowledgeChunk]:
        requested = set(evidence_ids)
        visible = {item.evidence_id: item for item in self._visible_chunks(context)}
        missing = requested - visible.keys()
        if missing:
            # Do not disclose whether a record exists in another tenant or ACL.
            raise DomainError(
                "evidence_not_accessible",
                "One or more evidence items are unavailable in this authorization scope.",
                status_code=404,
            )
        return [visible[evidence_id] for evidence_id in evidence_ids]

    def ephemeral(self, context: ActorContext, items: list[ContextEvidence]) -> list[KnowledgeChunk]:
        values: list[KnowledgeChunk] = []
        seen: set[UUID] = set()
        now = datetime.now(timezone.utc)
        for item in items:
            if item.evidence_id in seen:
                raise DomainError(
                    "duplicate_context_evidence",
                    "Context evidence IDs must be unique.",
                    status_code=422,
                )
            seen.add(item.evidence_id)
            if not is_authorized(context, item.source_acl):
                raise DomainError(
                    "evidence_not_accessible",
                    "Context evidence is unavailable in this authorization scope.",
                    status_code=404,
                )
            flags = inspect_untrusted_content(item.content)
            if flags:
                raise DomainError(
                    "unsafe_context_evidence",
                    "Context evidence failed the prompt-injection gate.",
                    status_code=422,
                )
            values.append(
                KnowledgeChunk(
                    evidence_id=item.evidence_id,
                    tenant_id=context.tenant_id,
                    document_id=uuid5(
                        _EPHEMERAL_NAMESPACE,
                        f"{context.tenant_id}:{item.evidence_id}:{item.source_locator}",
                    ),
                    source_locator=item.source_locator,
                    media_type=f"application/vnd.edt.{item.source_type}+json",
                    classification=item.classification,
                    source_acl=item.source_acl,
                    authorization_source=(
                        "validated_memory" if item.source_type == "memory" else "request_context"
                    ),
                    content=item.content,
                    content_sha256=content_sha256(item.content),
                    confidence=item.confidence,
                    indexed_at=now,
                    security_flags=[],
                    quarantined=False,
                )
            )
        return values

    @staticmethod
    def binding(item: KnowledgeChunk) -> EvidenceAccessBinding:
        return EvidenceAccessBinding(
            evidence_id=item.evidence_id,
            source_locator=item.source_locator,
            source_acl=item.source_acl,
            authorization_source=item.authorization_source,
            content_sha256=item.content_sha256,
        )

    def reauthorize_chunk(self, context: ActorContext, item: KnowledgeChunk) -> KnowledgeChunk:
        """Recheck a run-time evidence snapshot immediately before persistence."""

        if item.authorization_source != "durable_knowledge":
            if not is_authorized(context, item.source_acl):
                raise DomainError(
                    "evidence_not_accessible",
                    "One or more evidence items are unavailable in this authorization scope.",
                    status_code=404,
                )
            return item
        raw = self.store.get(
            tenant_id=context.tenant_id,
            kind=KNOWLEDGE_CHUNK_KIND,
            record_id=item.evidence_id,
        )
        if raw is None:
            raise DomainError(
                "evidence_not_accessible",
                "One or more evidence items are unavailable in this authorization scope.",
                status_code=404,
            )
        current = KnowledgeChunk.model_validate(raw)
        if current.quarantined or not is_authorized(context, current.source_acl):
            raise DomainError(
                "evidence_not_accessible",
                "One or more evidence items are unavailable in this authorization scope.",
                status_code=404,
            )
        if (
            current.content_sha256 != item.content_sha256
            or current.source_locator != item.source_locator
        ):
            raise DomainError(
                "evidence_changed_during_run",
                "One or more evidence items changed while the AI request was running.",
                status_code=409,
            )
        return current

    def authorize_binding(
        self, context: ActorContext, binding: EvidenceAccessBinding
    ) -> None:
        if binding.authorization_source != "durable_knowledge":
            if not is_authorized(context, binding.source_acl):
                raise DomainError(
                    "evidence_not_accessible",
                    "One or more evidence items are unavailable in this authorization scope.",
                    status_code=404,
                )
            return
        raw = self.store.get(
            tenant_id=context.tenant_id,
            kind=KNOWLEDGE_CHUNK_KIND,
            record_id=binding.evidence_id,
        )
        if raw is None:
            raise DomainError(
                "evidence_not_accessible",
                "One or more evidence items are unavailable in this authorization scope.",
                status_code=404,
            )
        current = KnowledgeChunk.model_validate(raw)
        if (
            current.quarantined
            or not is_authorized(context, current.source_acl)
            or current.content_sha256 != binding.content_sha256
            or current.source_locator != binding.source_locator
        ):
            raise DomainError(
                "evidence_not_accessible",
                "One or more evidence items are unavailable in this authorization scope.",
                status_code=404,
            )

    def search(self, body: RetrievalSearchRequest, context: ActorContext) -> RetrievalSearchResult:
        context.require(body.required_permissions, "the requested retrieval scope")
        visible = self._visible_chunks(context)
        query_terms = _terms(body.query)
        query_vector: list[float] | None = None
        # Do not send a query to an embedding provider unless there is at least
        # one authorized vector produced by this exact embedding route. This
        # avoids unnecessary disclosure/cost and prevents comparing vectors
        # from incompatible model spaces after a route migration.
        vector_candidates = {
            item.evidence_id
            for item in visible
            if item.embedding is not None and item.embedding_model is not None
        }
        embedding_usage: TokenUsage | None = None
        query_embedding_model: str | None = None
        if self.embedding_provider and vector_candidates:
            embedded_query = self.embedding_provider.embed_with_usage([body.query])
            query_vector = embedded_query.vectors[0]
            embedding_usage = embedded_query.usage
            query_embedding_model = embedded_query.model
            vector_candidates = {
                item.evidence_id
                for item in visible
                if item.evidence_id in vector_candidates
                and item.embedding_model == query_embedding_model
            }
            self._vector_verified = True
        scored: list[tuple[float, float, float | None, KnowledgeChunk]] = []
        for item in visible:
            lexical = _lexical(query_terms, item.content)
            vector: float | None = None
            if query_vector is not None and item.evidence_id in vector_candidates:
                assert item.embedding is not None
                vector = _cosine(query_vector, item.embedding)
                relevance = 0.75 * vector + 0.25 * lexical
            else:
                relevance = lexical
            if relevance > 0:
                scored.append((relevance, lexical, vector, item))
        scored.sort(key=lambda value: (-value[0], str(value[3].evidence_id)))
        items = [
            RetrievedKnowledge(
                evidence_id=item.evidence_id,
                document_id=item.document_id,
                source_locator=item.source_locator,
                media_type=item.media_type,
                classification=item.classification,
                snippet=item.content[:2000],
                relevance=score,
                confidence=item.confidence,
                indexed_at=item.indexed_at,
                security_flags=item.security_flags,
                content_sha256=item.content_sha256,
                retrieval_mode="hybrid" if vector is not None else "lexical",
                lexical_relevance=lexical,
                vector_relevance=vector,
                embedding_model=item.embedding_model if vector is not None else None,
            )
            for score, lexical, vector, item in scored[: body.limit]
        ]
        return RetrievalSearchResult(
            items=items,
            query_sha256=content_sha256(body.query),
            embedding_usage=embedding_usage,
            embedding_model=query_embedding_model,
        )
