from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import Field, JsonValue, field_validator, model_validator

from .models import StrictModel


MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
MAX_DOCUMENT_BASE64_CHARS = 4 * ((MAX_DOCUMENT_BYTES + 2) // 3)


class AgentType(str, Enum):
    KNOWLEDGE_INGESTION = "knowledge_ingestion"
    ENTITY_RESOLUTION = "entity_resolution"
    EVENT_UNDERSTANDING = "event_understanding"
    CAUSAL_ANALYSIS = "causal_analysis"
    SIMULATION_PLANNING = "simulation_planning"
    PREDICTION_EXPLANATION = "prediction_explanation"
    TECHNICAL_KNOWLEDGE = "technical_knowledge"


class Classification(str, Enum):
    PUBLIC = "public"
    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
    RESTRICTED = "restricted"


class ProviderName(str, Enum):
    LLAMA = "llama"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    CUSTOM = "custom"


class TokenUsage(StrictModel):
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    total_tokens: int = Field(ge=0)
    measurement: Literal["provider_reported", "unavailable", "cache_hit"] = "provider_reported"

    @model_validator(mode="after")
    def valid_total(self) -> "TokenUsage":
        if self.total_tokens < self.input_tokens + self.output_tokens:
            raise ValueError("total_tokens cannot be smaller than input plus output")
        return self


class EvidenceCitation(StrictModel):
    evidence_id: UUID
    source_locator: str = Field(min_length=1, max_length=2000)


class PendingOutput(StrictModel):
    status: Literal["PENDING_REVIEW"]
    confidence: float = Field(ge=0, le=1)
    evidence: list[EvidenceCitation] = Field(min_length=1, max_length=100)
    limitations: list[str] = Field(default_factory=list, max_length=50)


class EntitySuggestion(StrictModel):
    entity_type: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=500)
    properties: dict[str, JsonValue] = Field(default_factory=dict)
    evidence_ids: list[UUID] = Field(min_length=1, max_length=50)


class RelationshipSuggestion(StrictModel):
    source_name: str = Field(min_length=1, max_length=500)
    relationship_type: str = Field(min_length=1, max_length=100)
    target_name: str = Field(min_length=1, max_length=500)
    evidence_ids: list[UUID] = Field(min_length=1, max_length=50)


class ConstraintSuggestion(StrictModel):
    entity_name: str = Field(min_length=1, max_length=500)
    constraint: str = Field(min_length=1, max_length=500)
    value: JsonValue
    evidence_ids: list[UUID] = Field(min_length=1, max_length=50)


class KnowledgeIngestionOutput(PendingOutput):
    entities: list[EntitySuggestion] = Field(default_factory=list, max_length=200)
    relationships: list[RelationshipSuggestion] = Field(default_factory=list, max_length=500)
    constraints: list[ConstraintSuggestion] = Field(default_factory=list, max_length=200)


class EntityResolutionOutput(PendingOutput):
    match: bool
    candidate_entity_ids: list[UUID] = Field(min_length=2, max_length=20)
    reason: str = Field(min_length=1, max_length=2000)
    automatic_merge_allowed: Literal[False] = False


class EventUnderstandingOutput(PendingOutput):
    event_type: str = Field(min_length=1, max_length=100)
    entity_refs: list[str] = Field(default_factory=list, max_length=100)
    possible_impacts: list[str] = Field(default_factory=list, max_length=100)
    actual_effects_calculated: Literal[False] = False


class CausalStep(StrictModel):
    source: str = Field(min_length=1, max_length=500)
    relationship: str = Field(min_length=1, max_length=500)
    target: str = Field(min_length=1, max_length=500)
    evidence_ids: list[UUID] = Field(min_length=1, max_length=50)


class CausalAnalysisOutput(PendingOutput):
    chain: list[CausalStep] = Field(min_length=1, max_length=100)
    affected_nodes: list[str] = Field(default_factory=list, max_length=200)
    probabilities_calculated: Literal[False] = False


class SimulationPlanningOutput(PendingOutput):
    scenario_name: str = Field(min_length=1, max_length=200)
    affected_entity_ids: list[UUID] = Field(default_factory=list, max_length=200)
    proposed_variables: dict[str, JsonValue] = Field(default_factory=dict)
    assumptions_requiring_confirmation: list[str] = Field(default_factory=list, max_length=100)
    simulation_executed: Literal[False] = False


class PredictionExplanationOutput(PendingOutput):
    summary: str = Field(min_length=1, max_length=5000)
    risk_level: Literal["low", "medium", "high", "unknown"]
    drivers: list[str] = Field(default_factory=list, max_length=100)
    recommendations: list[str] = Field(default_factory=list, max_length=100)
    prediction_recalculated: Literal[False] = False


class TechnicalFactSuggestion(StrictModel):
    entity: str = Field(min_length=1, max_length=500)
    property: str = Field(min_length=1, max_length=200)
    value: JsonValue
    evidence_ids: list[UUID] = Field(min_length=1, max_length=50)


class TechnicalKnowledgeOutput(PendingOutput):
    facts: list[TechnicalFactSuggestion] = Field(default_factory=list, max_length=300)
    capabilities: list[str] = Field(default_factory=list, max_length=100)
    limitations_found: list[str] = Field(default_factory=list, max_length=100)
    dependencies: list[str] = Field(default_factory=list, max_length=100)
    failure_modes: list[str] = Field(default_factory=list, max_length=100)


AgentOutput = (
    KnowledgeIngestionOutput
    | EntityResolutionOutput
    | EventUnderstandingOutput
    | CausalAnalysisOutput
    | SimulationPlanningOutput
    | PredictionExplanationOutput
    | TechnicalKnowledgeOutput
)


class AgentRunRequest(StrictModel):
    agent_type: AgentType
    input: dict[str, JsonValue] = Field(min_length=1, max_length=200)
    session_id: UUID | None = None
    retrieval_query: str | None = Field(default=None, min_length=1, max_length=4000)
    evidence_ids: list[UUID] = Field(default_factory=list, max_length=100)
    context_evidence: list["ContextEvidence"] = Field(default_factory=list, max_length=50)
    max_evidence_items: int = Field(default=12, ge=1, le=50)
    max_cost_usd: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=6)


class RetrievalSearchRequest(StrictModel):
    query: str = Field(min_length=1, max_length=4000)
    limit: int = Field(default=10, ge=1, le=50)
    required_permissions: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("required_permissions")
    @classmethod
    def unique_permissions(cls, value: list[str]) -> list[str]:
        folded = [item.strip().casefold() for item in value]
        if any(not item for item in folded) or len(set(folded)) != len(folded):
            raise ValueError("permissions must be non-empty and unique")
        return folded


class RetrievedKnowledge(StrictModel):
    evidence_id: UUID
    document_id: UUID
    source_locator: str
    media_type: str
    classification: Classification
    snippet: str = Field(max_length=2000)
    relevance: float = Field(ge=-1, le=1)
    confidence: float = Field(ge=0, le=1)
    indexed_at: datetime
    security_flags: list[str]
    content_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    retrieval_mode: Literal["lexical", "hybrid"]
    lexical_relevance: float = Field(ge=0, le=1)
    vector_relevance: float | None = Field(default=None, ge=-1, le=1)
    embedding_model: str | None = None


class RetrievalSearchResult(StrictModel):
    items: list[RetrievedKnowledge]
    query_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    permission_trimmed: Literal[True] = True
    embedding_usage: TokenUsage | None = None
    embedding_model: str | None = None


class SourceACL(StrictModel):
    visibility: Literal["private", "tenant"]
    allowed_actor_ids: list[UUID] = Field(default_factory=list, max_length=200)
    allowed_roles: list[str] = Field(default_factory=list, max_length=100)
    required_permissions: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def valid_acl(self) -> "SourceACL":
        object.__setattr__(self, "allowed_actor_ids", list(dict.fromkeys(self.allowed_actor_ids)))
        object.__setattr__(
            self, "allowed_roles", [item.strip().casefold() for item in self.allowed_roles]
        )
        object.__setattr__(
            self,
            "required_permissions",
            [item.strip().casefold() for item in self.required_permissions],
        )
        if (
            any(not item for item in (*self.allowed_roles, *self.required_permissions))
            or len(set(self.allowed_roles)) != len(self.allowed_roles)
            or len(set(self.required_permissions)) != len(self.required_permissions)
        ):
            raise ValueError("ACL roles and permissions must be non-empty and unique")
        if self.visibility == "private" and not (self.allowed_actor_ids or self.allowed_roles):
            raise ValueError("private ACL requires an allowed actor or role")
        return self


class ContextEvidence(StrictModel):
    evidence_id: UUID
    source_locator: str = Field(min_length=1, max_length=2000)
    content: str = Field(min_length=1, max_length=4000)
    source_type: Literal["graph", "event", "simulation", "prediction", "user_input", "memory"]
    classification: Classification = Classification.INTERNAL
    confidence: float = Field(default=1, ge=0, le=1)
    source_acl: SourceACL


class EvidenceAccessBinding(StrictModel):
    """Content-free authorization provenance retained for later rechecks."""

    evidence_id: UUID
    source_locator: str = Field(min_length=1, max_length=2000)
    source_acl: SourceACL
    authorization_source: Literal["durable_knowledge", "request_context", "validated_memory"]
    content_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class DocumentImportRequest(StrictModel):
    document_id: UUID
    source_locator: str = Field(min_length=1, max_length=2000)
    media_type: str = Field(min_length=1, max_length=200)
    text: str | None = Field(default=None, max_length=MAX_DOCUMENT_BYTES)
    # Exact base64 envelope for the default 5 MiB decoded H1 limit.
    content_base64: str | None = Field(default=None, max_length=MAX_DOCUMENT_BASE64_CHARS)
    classification: Classification = Classification.INTERNAL
    source_acl: SourceACL
    confidence: float = Field(default=1, ge=0, le=1)

    @model_validator(mode="after")
    def exactly_one_content(self) -> "DocumentImportRequest":
        if (self.text is None) == (self.content_base64 is None):
            raise ValueError("exactly one of text or content_base64 is required")
        return self


class DocumentImportReceipt(StrictModel):
    import_id: UUID
    document_id: UUID
    status: Literal["INDEXED", "QUARANTINED"]
    chunks_indexed: int = Field(ge=0)
    chunks_quarantined: int = Field(ge=0)
    evidence_ids: list[UUID]
    media_type: str
    content_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    parser: str
    imported_at: datetime
    embedding_usage: TokenUsage | None = None
    embedding_model: str | None = None
    model_invoked: Literal[False] = False


class ProviderAuditMetadata(StrictModel):
    provider_request_id: str | None = Field(default=None, max_length=500)
    request_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    response_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    latency_ms: int = Field(ge=0)


class EffectiveReview(StrictModel):
    review_id: UUID
    reviewer_id: UUID
    decision: Literal["APPROVE", "REJECT"]
    reviewed_at: datetime


class SuggestionRecord(StrictModel):
    suggestion_id: UUID
    run_id: UUID
    tenant_id: UUID
    actor_id: UUID
    agent_type: AgentType
    status: Literal["PENDING_REVIEW"] = "PENDING_REVIEW"
    confidence: float = Field(ge=0, le=1)
    evidence: list[EvidenceCitation] = Field(min_length=1)
    output: dict[str, JsonValue]
    provider: ProviderName
    model: str
    usage: TokenUsage
    cost_usd: Decimal | None = None
    cost_status: Literal["priced", "unpriced"]
    cached: bool
    cache_source_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    mutation_performed: Literal[False] = False
    created_at: datetime
    effective_review: EffectiveReview | None = None


class AgentRunResult(StrictModel):
    run_id: UUID
    suggestion: SuggestionRecord
    provider_audit: ProviderAuditMetadata


class ActivityRecord(StrictModel):
    activity_id: UUID
    tenant_id: UUID
    actor_id: UUID
    agent_type: AgentType | None
    kind: Literal[
        "agent_run", "document_import", "retrieval", "suggestion_review", "learning_outcome"
    ]
    state: Literal["running", "succeeded", "failed"]
    provider: ProviderName | None = None
    model: str | None = None
    usage: TokenUsage | None = None
    cost_usd: Decimal | None = None
    cost_status: Literal["priced", "unpriced", "not_applicable"]
    evidence_ids: list[UUID] = Field(default_factory=list)
    error_code: str | None = None
    created_at: datetime


class ActivityList(StrictModel):
    items: list[ActivityRecord]


class ReviewRequest(StrictModel):
    decision: Literal["APPROVE", "REJECT"]
    note: str | None = Field(default=None, max_length=2000)


class ReviewReceipt(StrictModel):
    review_id: UUID
    suggestion_id: UUID
    reviewer_id: UUID
    decision: Literal["APPROVE", "REJECT"]
    suggestion_status: Literal["PENDING_REVIEW"] = "PENDING_REVIEW"
    mutation_performed: Literal[False] = False
    reviewed_at: datetime
    validated_memory_id: UUID | None = None


class ValidatedOutcomeRequest(StrictModel):
    suggestion_id: UUID
    validation: Literal["CONFIRMED", "CORRECTED"]
    outcome_type: str = Field(min_length=1, max_length=100)
    outcome: dict[str, JsonValue] = Field(min_length=1, max_length=100)
    evidence_ids: list[UUID] = Field(min_length=1, max_length=100)
    observed_at: datetime
    note: str | None = Field(default=None, max_length=2000)

    @field_validator("observed_at")
    @classmethod
    def aware_observation(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("observed_at must include a timezone offset")
        return value


class LearningMemoryReceipt(StrictModel):
    memory_id: UUID
    suggestion_id: UUID
    status: Literal["VALIDATED"] = "VALIDATED"
    validation: Literal["CONFIRMED", "CORRECTED"]
    reviewer_id: UUID
    evidence_ids: list[UUID]
    persisted_at: datetime
    graph_mutation_performed: Literal[False] = False
    simulation_mutation_performed: Literal[False] = False


class SuggestionList(StrictModel):
    items: list[SuggestionRecord]


class ProviderStatus(StrictModel):
    provider: ProviderName
    configured: bool
    model: str | None
    live_provider_verified: Literal[False] = False


class AIStatus(StrictModel):
    status: Literal["ready", "degraded"]
    providers: list[ProviderStatus]
    agents: list[AgentType]
    storage_backend: str
    durable_store_ready: bool
    vector_configured: bool
    vector_ready: bool
    retrieval_modes: list[Literal["lexical", "vector"]]
    model_outputs_mutate_state: Literal[False] = False


AgentRunRequest.model_rebuild()
