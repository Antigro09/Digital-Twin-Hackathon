from __future__ import annotations

import math
from datetime import date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, validate_assignment=True)


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and (value.tzinfo is None or value.utcoffset() is None):
        raise ValueError("datetime must include an offset")
    return value


class Calendar(StrictModel):
    version: str = Field(min_length=1, max_length=100)
    working_weekdays: list[int] = Field(min_length=1, max_length=7)
    workday_start: str = Field(pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
    hours_per_workday: float = Field(gt=0, le=24)
    holidays: list[date] = Field(default_factory=list)
    canonical_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def unique_calendar_values(self) -> "Calendar":
        if len(set(self.working_weekdays)) != len(self.working_weekdays):
            raise ValueError("working_weekdays contains duplicates")
        if any(day < 1 or day > 7 for day in self.working_weekdays):
            raise ValueError("working_weekdays must use ISO values 1 through 7")
        if len(set(self.holidays)) != len(self.holidays):
            raise ValueError("holidays contains duplicates")
        return self


class DurationEstimate(StrictModel):
    optimistic: float = Field(ge=0, le=1300)
    most_likely: float = Field(ge=0, le=1300)
    pessimistic: float = Field(ge=0, le=1300)
    unit: Literal["workday"] = "workday"
    source: Literal["explicit", "confirmed_imputation"]

    @model_validator(mode="after")
    def ordered(self) -> "DurationEstimate":
        if not self.optimistic <= self.most_likely <= self.pessimistic:
            raise ValueError("duration must satisfy optimistic <= most_likely <= pessimistic")
        return self


class WorkItem(StrictModel):
    work_item_id: UUID
    source_key: str | None = None
    label: str = Field(min_length=1, max_length=500)
    state: Literal["not_started", "in_progress", "blocked", "completed", "cancelled"]
    team_id: UUID
    remaining_duration: DurationEstimate
    earliest_start: datetime | None = None
    actual_finish: datetime | None = None
    external_blocker: bool = False
    external_blocker_until: datetime | None = None
    evidence_ids: list[UUID] = Field(min_length=1)

    _earliest_aware = field_validator("earliest_start")(_aware)
    _finish_aware = field_validator("actual_finish")(_aware)
    _blocker_aware = field_validator("external_blocker_until")(_aware)

    @model_validator(mode="after")
    def state_invariants(self) -> "WorkItem":
        if len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError("work-item evidence IDs contain duplicates")
        bounds = (
            self.remaining_duration.optimistic,
            self.remaining_duration.most_likely,
            self.remaining_duration.pessimistic,
        )
        if self.state == "completed":
            if self.actual_finish is None:
                raise ValueError("completed task requires actual_finish")
            if any(value != 0 for value in bounds):
                raise ValueError("completed task must have zero remaining duration")
        elif self.actual_finish is not None:
            raise ValueError("only completed tasks may have actual_finish")
        if self.state == "cancelled" and any(value != 0 for value in bounds):
            raise ValueError("cancelled task must have zero remaining duration")
        return self


class Dependency(StrictModel):
    predecessor_work_item_id: UUID
    successor_work_item_id: UUID
    type: Literal["finish_to_start"] = "finish_to_start"
    lag_workdays: float = Field(ge=0, le=1300)
    source_relationship_id: UUID
    evidence_ids: list[UUID] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_evidence(self) -> "Dependency":
        if len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError("dependency evidence IDs contain duplicates")
        return self


class TeamCapacity(StrictModel):
    team_id: UUID
    parallel_capacity: int = Field(ge=1, le=100)
    availability: float = Field(gt=0, le=1)
    evidence_ids: list[UUID] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_evidence(self) -> "TeamCapacity":
        if len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError("team-capacity evidence IDs contain duplicates")
        return self


class SimulationSnapshot(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    snapshot_id: UUID
    tenant_id: UUID
    project_id: UUID
    as_of: datetime
    project_start: datetime
    target_date: date | None
    projection_checkpoint_id: UUID
    outbox_position: int = Field(ge=0)
    ontology_version: str = Field(min_length=1, max_length=100)
    simulation_model_version: Literal["pert-monte-carlo/1.0.0"] = "pert-monte-carlo/1.0.0"
    parameter_set_version: str = Field(min_length=1, max_length=100)
    default_seed: str = Field(pattern=r"^(0|[1-9][0-9]{0,19})$")
    timezone: str = Field(min_length=1, max_length=100)
    timezone_database_version: str = Field(min_length=1, max_length=100)
    calendar: Calendar
    tasks: list[WorkItem]
    dependencies: list[Dependency]
    team_capacities: list[TeamCapacity]
    assumptions: list[str]
    warnings: list[str]
    evidence_ids: list[UUID]
    sealed_at: datetime
    canonical_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    _as_of_aware = field_validator("as_of")(_aware)
    _project_aware = field_validator("project_start")(_aware)
    _sealed_aware = field_validator("sealed_at")(_aware)

    @field_validator("default_seed")
    @classmethod
    def uint64_seed(cls, value: str) -> str:
        if int(value) > (2**64 - 1):
            raise ValueError("seed exceeds uint64")
        return value

    @model_validator(mode="after")
    def unique_root_evidence(self) -> "SimulationSnapshot":
        if len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError("snapshot evidence IDs contain duplicates")
        return self


class SetDurationEstimate(StrictModel):
    type: Literal["set_duration_estimate"]
    work_item_id: UUID
    optimistic_days: float = Field(ge=0, le=1300)
    most_likely_days: float = Field(ge=0, le=1300)
    pessimistic_days: float = Field(ge=0, le=1300)

    @model_validator(mode="after")
    def ordered(self) -> "SetDurationEstimate":
        if not self.optimistic_days <= self.most_likely_days <= self.pessimistic_days:
            raise ValueError("scenario duration bounds are reversed")
        return self


class ShiftCompletionDistribution(StrictModel):
    type: Literal["shift_completion_distribution"]
    work_item_id: UUID
    delta_workdays: int = Field(ge=-260, le=260)


class SetEarliestStart(StrictModel):
    type: Literal["set_earliest_start"]
    work_item_id: UUID
    earliest_start: datetime | None

    _aware = field_validator("earliest_start")(_aware)


class AddDependency(StrictModel):
    type: Literal["add_dependency"]
    predecessor_work_item_id: UUID
    successor_work_item_id: UUID
    lag_workdays: float = Field(ge=0, le=1300)


class RemoveDependency(StrictModel):
    type: Literal["remove_dependency"]
    predecessor_work_item_id: UUID
    successor_work_item_id: UUID


class RemoveScope(StrictModel):
    type: Literal["remove_scope"]
    work_item_id: UUID


class ChangeTeamCapacity(StrictModel):
    type: Literal["change_team_capacity"]
    team_id: UUID
    capacity_delta: int = Field(ge=-99, le=99)


class ResolveExternalBlocker(StrictModel):
    type: Literal["resolve_external_blocker"]
    work_item_id: UUID
    resolution_date: datetime

    _aware = field_validator("resolution_date")(_aware)


class MarkTaskCompleted(StrictModel):
    type: Literal["mark_task_completed"]
    work_item_id: UUID
    actual_finish: datetime

    _aware = field_validator("actual_finish")(_aware)


Intervention = Annotated[
    SetDurationEstimate
    | ShiftCompletionDistribution
    | SetEarliestStart
    | AddDependency
    | RemoveDependency
    | RemoveScope
    | ChangeTeamCapacity
    | ResolveExternalBlocker
    | MarkTaskCompleted,
    Field(discriminator="type"),
]


class ScenarioAssumption(StrictModel):
    assumption_id: UUID
    statement: str = Field(min_length=1, max_length=2000)
    status: Literal["confirmed", "inferred_from_evidence", "missing", "contested"]
    source: Literal["user", "evidence", "engine_default", "confirmed_imputation"]
    evidence_ids: list[UUID] = Field(default_factory=list)


class Scenario(StrictModel):
    scenario_id: UUID
    tenant_id: UUID
    snapshot_id: UUID
    snapshot_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    name: str = Field(min_length=1, max_length=200)
    target_date: date | None
    model_version: Literal["pert-monte-carlo/1.0.0"]
    calendar_version: str = Field(min_length=1, max_length=100)
    compiler_version: str = Field(min_length=1, max_length=100)
    seed: str = Field(pattern=r"^(0|[1-9][0-9]{0,19})$")
    sample_count: Literal[50000]
    interventions: list[Intervention] = Field(min_length=1, max_length=50)
    assumptions: list[ScenarioAssumption]
    confirmed_by: UUID
    confirmed_at: datetime
    scenario_digest: str = Field(pattern=r"^[a-f0-9]{64}$")

    _confirmed_aware = field_validator("confirmed_at")(_aware)

    @field_validator("seed")
    @classmethod
    def uint64_seed(cls, value: str) -> str:
        if int(value) > (2**64 - 1):
            raise ValueError("seed exceeds uint64")
        return value


class SealSnapshotRequest(StrictModel):
    snapshot: dict[str, Any]


class SimulationRequest(StrictModel):
    snapshot: SimulationSnapshot
    scenario: Scenario | None = None
    run_mode: Literal["preview", "committed"] = "committed"
    sample_count: int = Field(default=50000, ge=100, le=50000)

    @model_validator(mode="after")
    def committed_sample_count(self) -> "SimulationRequest":
        if self.run_mode == "committed" and self.sample_count != 50000:
            raise ValueError("committed H1 runs require exactly 50000 trials")
        return self


class QuantileForecast(StrictModel):
    p50: date
    p80: date
    p95: date


class Uncertainty(StrictModel):
    method: Literal["seeded_beta_pert_monte_carlo"]
    sample_count: int
    seed: str
    quantiles: QuantileForecast
    batch_standard_errors_days: dict[str, float]
    warnings: list[str]


class CriticalityItem(StrictModel):
    work_item_id: UUID
    index: float = Field(ge=0, le=1)


class BlockerItem(StrictModel):
    work_item_id: UUID
    score: float = Field(ge=0)
    criticality_index: float = Field(ge=0, le=1)
    p80_finish_improvement_if_zeroed: float = Field(ge=0)


class SensitivityItem(StrictModel):
    work_item_id: UUID
    method: Literal["spearman_rank"]
    correlation: float = Field(ge=-1, le=1)
    absolute_rank: int = Field(ge=1)
    criticality_index: float = Field(ge=0, le=1)
    estimate_source: Literal["explicit", "confirmed_imputation"]


class Comparison(StrictModel):
    baseline_quantiles: QuantileForecast
    scenario_quantiles: QuantileForecast
    delta_workdays: dict[str, float]
    probability_of_improvement: float = Field(ge=0, le=1)
    changed_criticality: list[dict[str, Any]]
    interpretation: Literal["negative_delta_means_earlier;association_not_causal"]


class SimulationResult(StrictModel):
    simulation_id: UUID
    tenant_id: UUID
    snapshot_id: UUID
    snapshot_hash: str
    scenario_id: UUID | None
    scenario_hash: str | None
    calendar_version: str
    engine_version: str
    seed: str
    sample_count: int
    status: Literal["succeeded"]
    uncertainty: Uncertainty
    probability_on_or_before_target: float | None
    probability_after_target: float | None
    critical_path: list[UUID]
    criticality: list[CriticalityItem]
    blockers: list[BlockerItem]
    sensitivity: list[SensitivityItem]
    comparison: Comparison | None
    assumptions: list[str]
    missing_data: list[str]
    warnings: list[str]
    evidence_ids: list[UUID]
    created_at: datetime
    completed_at: datetime
    result_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    _created_aware = field_validator("created_at")(_aware)
    _completed_aware = field_validator("completed_at")(_aware)


JsonScalar = str | int | float | bool | None


class EvidenceItem(StrictModel):
    evidence_id: UUID
    tenant_id: UUID
    source_type: Literal["github", "jira", "synthetic_oracle"]
    source_locator: str = Field(min_length=1, max_length=2000)
    supported_statements: list[str] = Field(default_factory=list)
    facts: dict[str, JsonScalar] = Field(default_factory=dict)
    classification: Literal["public", "internal", "confidential", "restricted"] = "internal"

    @model_validator(mode="after")
    def finite_facts(self) -> "EvidenceItem":
        for value in self.facts.values():
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError("evidence facts may not contain non-finite numbers")
        return self


class ProposedClaim(StrictModel):
    statement: str = Field(min_length=1, max_length=2000)
    evidence_ids: list[UUID] = Field(min_length=1)


class GroundedAnswerRequest(StrictModel):
    question: str = Field(min_length=1, max_length=2000)
    evidence: list[EvidenceItem] = Field(max_length=500)
    proposed_claims: list[ProposedClaim] = Field(default_factory=list, max_length=50)
    data_watermark: datetime

    _watermark_aware = field_validator("data_watermark")(_aware)


class Citation(StrictModel):
    evidence_id: UUID
    source_type: str
    source_locator: str


class GroundedAnswer(StrictModel):
    status: Literal["answered", "abstained"]
    answer: str
    citations: list[Citation]
    unsupported_claims: list[str]
    data_watermark: datetime
    warnings: list[str]

    _watermark_aware = field_validator("data_watermark")(_aware)


class ExtractionRequest(StrictModel):
    evidence: list[EvidenceItem] = Field(max_length=500)
    fields: list[str] = Field(min_length=1, max_length=100)


class ExtractedFact(StrictModel):
    field: str
    value: JsonScalar
    evidence_id: UUID


class ExtractionResult(StrictModel):
    extracted: list[ExtractedFact]
    missing_fields: list[str]
    warnings: list[str]
