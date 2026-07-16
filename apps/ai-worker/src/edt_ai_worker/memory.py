from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Literal
from uuid import UUID, uuid4, uuid5

from pydantic import Field, JsonValue, ValidationError

from .errors import DomainError
from .intelligence_models import (
    ContextEvidence,
    EvidenceAccessBinding,
    SourceACL,
    SuggestionRecord,
)
from .models import StrictModel
from .safety import content_sha256, inspect_untrusted_content
from .storage import DurableRecordStore
from .tenancy import ActorContext


_SENSITIVE_KEY = re.compile(r"(?:password|passwd|secret|token|api[_-]?key|credential)", re.I)
_SESSION_MAX_SERIALIZED_CHARS = 4000
_VALIDATED_MEMORY_NAMESPACE = UUID("45d6333b-4a04-4814-9d8d-38e821099d1c")


class SessionMemoryEntry(StrictModel):
    memory_id: UUID
    tenant_id: UUID
    actor_id: UUID
    session_id: UUID
    role: Literal["user", "assistant"]
    content: dict[str, JsonValue]
    content_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    truncated: bool
    verified: Literal[False] = False
    created_at: datetime
    expires_at: datetime


class ValidationRecord(StrictModel):
    status: Literal["VALIDATED"]
    reviewer_id: UUID
    reviewed_at: datetime
    evidence_ids: list[UUID] = Field(min_length=1, max_length=100)
    review_id: UUID


class ValidatedMemoryEntry(StrictModel):
    memory_id: UUID
    tenant_id: UUID
    memory_type: Literal["enterprise", "learning"]
    content: dict[str, JsonValue]
    source_suggestion_id: UUID | None = None
    source_review_id: UUID | None = None
    source_acl: SourceACL
    source_evidence: list[EvidenceAccessBinding] = Field(min_length=1, max_length=200)
    validation: ValidationRecord
    created_at: datetime


class ControlledMemory:
    """Durable, tenant-qualified memory with explicit validation gates."""

    def __init__(
        self,
        store: DurableRecordStore,
        *,
        session_ttl_minutes: int = 60,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.store = store
        self.session_ttl_minutes = session_ttl_minutes
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    @classmethod
    def _sanitize_session_value(cls, value: Any, *, depth: int = 0) -> tuple[JsonValue, bool]:
        if depth >= 4:
            return "[TRUNCATED_DEPTH]", True
        if isinstance(value, dict):
            result: dict[str, JsonValue] = {}
            truncated = len(value) > 50
            for key in sorted(value, key=str)[:50]:
                label = str(key)[:200]
                if _SENSITIVE_KEY.search(label):
                    result[label] = "[REDACTED_SENSITIVE_FIELD]"
                    truncated = True
                    continue
                item, changed = cls._sanitize_session_value(value[key], depth=depth + 1)
                result[label] = item
                truncated = truncated or changed
            return result, truncated
        if isinstance(value, list):
            items: list[JsonValue] = []
            truncated = len(value) > 20
            for item in value[:20]:
                sanitized, changed = cls._sanitize_session_value(item, depth=depth + 1)
                items.append(sanitized)
                truncated = truncated or changed
            return items, truncated
        if isinstance(value, str):
            if inspect_untrusted_content(value):
                return "[REDACTED_UNTRUSTED_SESSION_TEXT]", True
            return (value[:500], len(value) > 500)
        if value is None or isinstance(value, (bool, int, float)):
            return value, False
        return str(value)[:500], True

    @classmethod
    def _bounded_session_content(
        cls, content: dict[str, JsonValue]
    ) -> tuple[dict[str, JsonValue], str, bool]:
        serialized = json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        digest = content_sha256(serialized)
        sanitized, truncated = cls._sanitize_session_value(content)
        assert isinstance(sanitized, dict)
        encoded = json.dumps(sanitized, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        if len(encoded) > _SESSION_MAX_SERIALIZED_CHARS:
            return (
                {
                    "summary": "[BOUNDED_SESSION_CONTENT]",
                    "top_level_fields": sorted(str(key)[:200] for key in content)[:50],
                    "content_sha256": digest,
                },
                digest,
                True,
            )
        return sanitized, digest, truncated

    def _purge_expired(self, context: ActorContext) -> int:
        now = self.clock()
        removed = 0
        for raw in self.store.list(
            tenant_id=context.tenant_id,
            kind="memory_session",
            actor_id=context.actor_id,
            limit=10000,
        ):
            try:
                item = SessionMemoryEntry.model_validate(raw)
            except ValidationError:
                # Legacy/unscoped session rows cannot safely enter a prompt.
                raw_id = raw.get("memory_id")
                try:
                    record_id = UUID(str(raw_id))
                except (TypeError, ValueError):
                    continue
                self.store.delete(
                    tenant_id=context.tenant_id,
                    kind="memory_session",
                    record_id=record_id,
                )
                removed += 1
                continue
            if item.expires_at <= now:
                self.store.delete(
                    tenant_id=context.tenant_id,
                    kind="memory_session",
                    record_id=item.memory_id,
                )
                removed += 1
        return removed

    def append_session(
        self,
        context: ActorContext,
        session_id: UUID,
        role: Literal["user", "assistant"],
        content: dict[str, JsonValue],
    ) -> SessionMemoryEntry:
        self._purge_expired(context)
        now = self.clock()
        sanitized, digest, truncated = self._bounded_session_content(content)
        entry = SessionMemoryEntry(
            memory_id=uuid4(),
            tenant_id=context.tenant_id,
            actor_id=context.actor_id,
            session_id=session_id,
            role=role,
            content=sanitized,
            content_sha256=digest,
            truncated=truncated,
            created_at=now,
            expires_at=now + timedelta(minutes=self.session_ttl_minutes),
        )
        self.store.put(
            tenant_id=context.tenant_id,
            kind="memory_session",
            record_id=entry.memory_id,
            actor_id=context.actor_id,
            created_at=now.isoformat(),
            payload=entry.model_dump(mode="json"),
        )
        return entry

    def session(self, context: ActorContext, session_id: UUID, *, limit: int = 20) -> list[SessionMemoryEntry]:
        self._purge_expired(context)
        now = self.clock()
        values = [
            SessionMemoryEntry.model_validate(item)
            for item in self.store.list(
                tenant_id=context.tenant_id,
                kind="memory_session",
                actor_id=context.actor_id,
                limit=200,
            )
        ]
        selected = [item for item in values if item.session_id == session_id and item.expires_at > now]
        selected.sort(key=lambda item: item.created_at)
        return selected[-limit:]

    def reset_session(self, context: ActorContext, session_id: UUID) -> int:
        removed = 0
        for item in self.session(context, session_id, limit=10000):
            self.store.delete(
                tenant_id=context.tenant_id,
                kind="memory_session",
                record_id=item.memory_id,
            )
            removed += 1
        return removed

    def persist_validated(
        self,
        context: ActorContext,
        *,
        memory_type: Literal["enterprise", "learning"],
        content: dict[str, JsonValue],
        validation: ValidationRecord,
        source_evidence: list[EvidenceAccessBinding],
        source_suggestion_id: UUID | None = None,
        source_review_id: UUID | None = None,
        source_acl: SourceACL | None = None,
    ) -> ValidatedMemoryEntry:
        if validation.reviewer_id != context.actor_id:
            raise DomainError(
                "invalid_memory_validation",
                "The validation record is not bound to the authenticated reviewer.",
                status_code=403,
            )
        if not source_evidence:
            raise DomainError(
                "missing_memory_provenance",
                "Validated memory requires source evidence provenance.",
                status_code=422,
            )
        evidence_ids = [item.evidence_id for item in source_evidence]
        if (
            len(set(evidence_ids)) != len(evidence_ids)
            or set(evidence_ids) != set(validation.evidence_ids)
        ):
            raise DomainError(
                "invalid_memory_provenance",
                "Validated memory evidence must exactly match its authorization provenance.",
                status_code=422,
            )
        now = self.clock()
        entry = ValidatedMemoryEntry(
            memory_id=uuid5(
                _VALIDATED_MEMORY_NAMESPACE,
                f"{context.tenant_id}:{memory_type}:{validation.review_id}",
            ),
            tenant_id=context.tenant_id,
            memory_type=memory_type,
            content=content,
            source_suggestion_id=source_suggestion_id,
            source_review_id=source_review_id,
            source_acl=source_acl
            or SourceACL(
                visibility="private",
                allowed_actor_ids=[context.actor_id],
                required_permissions=["ai.run"],
            ),
            source_evidence=source_evidence,
            validation=validation,
            created_at=now,
        )
        inserted = self.store.put_if_absent(
            tenant_id=context.tenant_id,
            kind=f"memory_{memory_type}",
            record_id=entry.memory_id,
            actor_id=context.actor_id,
            created_at=now.isoformat(),
            payload=entry.model_dump(mode="json"),
        )
        if not inserted:
            raw = self.store.get(
                tenant_id=context.tenant_id,
                kind=f"memory_{memory_type}",
                record_id=entry.memory_id,
            )
            try:
                existing = ValidatedMemoryEntry.model_validate(raw)
            except ValidationError as exc:
                raise DomainError(
                    "validated_memory_conflict",
                    "The deterministic validated-memory identifier is already occupied.",
                    status_code=409,
                ) from exc
            stable_existing = existing.model_dump(mode="json", exclude={"created_at"})
            stable_candidate = entry.model_dump(mode="json", exclude={"created_at"})
            # A retry after memory persistence but before review/idempotency
            # completion may reconstruct only the wall-clock validation time.
            stable_existing["validation"].pop("reviewed_at", None)
            stable_candidate["validation"].pop("reviewed_at", None)
            if stable_existing != stable_candidate:
                raise DomainError(
                    "validated_memory_conflict",
                    "The deterministic validated-memory identifier is already occupied.",
                    status_code=409,
                )
            return existing
        return entry

    @staticmethod
    def _authorized(context: ActorContext, acl: SourceACL) -> bool:
        if not context.may_access(acl.required_permissions):
            return False
        if acl.visibility == "tenant":
            return True
        roles = {
            permission.removeprefix("role:")
            for permission in context.permissions
            if permission.startswith("role:")
        }
        return context.actor_id in acl.allowed_actor_ids or bool(roles & set(acl.allowed_roles))

    def validated_context(
        self,
        context: ActorContext,
        authorize_binding: Callable[[EvidenceAccessBinding], None],
        *,
        limit: int = 10,
    ) -> list[ContextEvidence]:
        values: list[ValidatedMemoryEntry] = []
        for kind in ("memory_enterprise", "memory_learning"):
            for item in self.store.list(
                tenant_id=context.tenant_id,
                kind=kind,
                limit=100,
            ):
                try:
                    values.append(ValidatedMemoryEntry.model_validate(item))
                except ValidationError:
                    # Fail closed for pre-provenance memory records.
                    continue
        authorized: list[ValidatedMemoryEntry] = []
        for item in values:
            if not self._authorized(context, item.source_acl):
                continue
            try:
                for binding in item.source_evidence:
                    authorize_binding(binding)
            except DomainError as exc:
                if exc.code in {"evidence_not_accessible", "validated_memory_not_accessible"}:
                    continue
                raise
            authorized.append(item)
        values = authorized
        values.sort(key=lambda item: item.created_at, reverse=True)
        return [
            ContextEvidence(
                evidence_id=item.memory_id,
                source_locator=f"memory://{item.memory_type}/{item.memory_id}",
                content=json.dumps(item.content, sort_keys=True, separators=(",", ":")),
                source_type="memory",
                classification="internal",
                confidence=1,
                source_acl=item.source_acl,
            )
            for item in values[:limit]
        ]

    def authorize_binding(
        self,
        context: ActorContext,
        binding: EvidenceAccessBinding,
        authorize_source: Callable[[EvidenceAccessBinding], None],
    ) -> None:
        """Re-authorize a validated memory and every source it depends on.

        The memory locator and content digest are immutable provenance. A
        source deletion, ACL change, or content replacement makes the memory
        unavailable to future prompts, displays, and reviews.
        """

        if binding.authorization_source != "validated_memory":
            raise DomainError(
                "invalid_memory_provenance",
                "The evidence binding is not validated memory provenance.",
                status_code=422,
            )
        if binding.source_locator.startswith("memory://enterprise/"):
            memory_type: Literal["enterprise", "learning"] = "enterprise"
        elif binding.source_locator.startswith("memory://learning/"):
            memory_type = "learning"
        else:
            raise DomainError(
                "evidence_not_accessible",
                "One or more evidence items are unavailable in this authorization scope.",
                status_code=404,
            )
        raw = self.store.get(
            tenant_id=context.tenant_id,
            kind=f"memory_{memory_type}",
            record_id=binding.evidence_id,
        )
        if raw is None:
            raise DomainError(
                "evidence_not_accessible",
                "One or more evidence items are unavailable in this authorization scope.",
                status_code=404,
            )
        try:
            item = ValidatedMemoryEntry.model_validate(raw)
        except ValidationError as exc:
            raise DomainError(
                "evidence_not_accessible",
                "One or more evidence items are unavailable in this authorization scope.",
                status_code=404,
            ) from exc
        expected_locator = f"memory://{memory_type}/{item.memory_id}"
        content = json.dumps(item.content, sort_keys=True, separators=(",", ":"))
        if (
            item.tenant_id != context.tenant_id
            or item.memory_type != memory_type
            or binding.source_locator != expected_locator
            or binding.content_sha256 != content_sha256(content)
            or binding.source_acl != item.source_acl
            or not self._authorized(context, item.source_acl)
        ):
            raise DomainError(
                "evidence_not_accessible",
                "One or more evidence items are unavailable in this authorization scope.",
                status_code=404,
            )
        for source in item.source_evidence:
            authorize_source(source)

    def persist_approved_suggestion(
        self,
        context: ActorContext,
        suggestion: SuggestionRecord,
        source_evidence: list[EvidenceAccessBinding],
        *,
        review_id: UUID,
        reviewed_at: datetime,
    ) -> ValidatedMemoryEntry:
        if suggestion.tenant_id != context.tenant_id:
            raise DomainError(
                "cross_tenant_binding",
                "Suggestion is not bound to the authenticated tenant.",
                status_code=403,
            )
        return self.persist_validated(
            context,
            memory_type="enterprise",
            content=suggestion.output,
            validation=ValidationRecord(
                status="VALIDATED",
                reviewer_id=context.actor_id,
                reviewed_at=reviewed_at,
                evidence_ids=[citation.evidence_id for citation in suggestion.evidence],
                review_id=review_id,
            ),
            source_evidence=source_evidence,
            source_suggestion_id=suggestion.suggestion_id,
            source_review_id=review_id,
        )
