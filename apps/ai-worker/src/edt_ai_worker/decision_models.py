from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from .models import StrictModel


ScenarioKind = Literal["hiring", "pricing_change", "supplier_failure", "expansion", "budget_change"]
PredictionKind = Literal["revenue", "expense", "customer_churn", "workforce", "risk"]


class SimulationNode(StrictModel):
    node_id: UUID
    type_id: str = Field(min_length=1, max_length=128)
    label: str = Field(min_length=1, max_length=500)
    variables: dict[str, float] = Field(max_length=50)

    @field_validator("variables")
    @classmethod
    def validate_variables(cls, values: dict[str, float]) -> dict[str, float]:
        for name, value in values.items():
            if not name or len(name) > 64 or not name.replace("_", "").isalnum():
                raise ValueError("variable names must be bounded identifiers")
            if abs(value) > 1_000_000_000_000:
                raise ValueError("variable values exceed the supported bound")
        return values


class SimulationRelationship(StrictModel):
    relationship_id: UUID
    source_node_id: UUID
    target_node_id: UUID
    impact_direction: Literal["forward", "reverse", "bidirectional", "none"]
    strength: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    importance: float = Field(ge=0, le=1)


class DecisionSnapshot(StrictModel):
    schema_version: Literal["edt.decision-intelligence/1.0.0"]
    snapshot_id: UUID
    tenant_id: UUID
    as_of: datetime
    graph_version: int = Field(ge=0)
    nodes: list[SimulationNode] = Field(min_length=1, max_length=100)
    relationships: list[SimulationRelationship] = Field(max_length=500)
    assumptions: list[str] = Field(max_length=100)
    canonical_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class VariableChange(StrictModel):
    node_id: UUID
    variable: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    operation: Literal["set", "add", "multiply"]
    value: float = Field(ge=-1_000_000_000_000, le=1_000_000_000_000)


class DecisionScenario(StrictModel):
    scenario_id: UUID
    branch_id: UUID
    parent_branch_id: UUID | None = None
    tenant_id: UUID
    snapshot_id: UUID
    snapshot_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    kind: ScenarioKind
    name: str = Field(min_length=1, max_length=200)
    changes: list[VariableChange] = Field(min_length=1, max_length=100)
    assumptions: list[str] = Field(max_length=100)
    max_depth: int = Field(ge=1, le=6, default=4)
    rule_version: Literal["business-derived-metrics/1.0.0"]
    status: Literal["confirmed"]
    scenario_digest: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def require_scenario_driver(self) -> "DecisionScenario":
        required = {
            "hiring": {"headcount"},
            "pricing_change": {"price"},
            "supplier_failure": {"supplier_availability"},
            "expansion": {"capacity", "locations"},
            "budget_change": {"budget"},
        }[self.kind]
        if not any(change.variable in required for change in self.changes):
            raise ValueError(f"{self.kind} requires a change to one of: {', '.join(sorted(required))}")
        return self


class DecisionSimulationRequest(StrictModel):
    snapshot: DecisionSnapshot
    scenario: DecisionScenario


class PropagatedEffect(StrictModel):
    source_node_id: UUID
    target_node_id: UUID
    variable: str
    delta: float
    depth: int
    relationship_path: list[UUID]


class OutcomeComparison(StrictModel):
    node_id: UUID
    variable: str
    baseline: float
    scenario: float
    absolute_delta: float
    percent_delta: float | None


class DecisionSimulationResult(StrictModel):
    schema_version: Literal["edt.decision-intelligence/1.0.0"]
    engine_version: Literal["decision-simulation/1.0.0"]
    snapshot_id: UUID
    scenario_id: UUID
    branch_id: UUID
    propagation_method: Literal["bounded_weighted_relationship_propagation/1.0.0"]
    rule_version: Literal["business-derived-metrics/1.0.0"]
    effects: list[PropagatedEffect]
    comparison: list[OutcomeComparison]
    assumptions: list[str]
    warnings: list[str]
    result_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class HistoricalObservation(StrictModel):
    observed_at: datetime
    value: float = Field(ge=-1_000_000_000_000, le=1_000_000_000_000)
    features: dict[str, float] = Field(default_factory=dict, max_length=50)

    @field_validator("observed_at")
    @classmethod
    def aware_observed_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("observed_at must include an offset")
        return value


class PredictiveRequest(StrictModel):
    prediction_id: UUID
    tenant_id: UUID
    model_id: UUID
    model_version: str = Field(min_length=1, max_length=64)
    kind: PredictionKind
    algorithm: Literal["linear_trend", "bounded_linear_trend"]
    target: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    requested_at: datetime
    horizon_steps: int = Field(ge=1, le=36)
    observations: list[HistoricalObservation] = Field(min_length=3, max_length=10_000)
    calibration_bias: float = Field(ge=-1_000_000_000, le=1_000_000_000, default=0)

    @field_validator("requested_at")
    @classmethod
    def aware_requested_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("requested_at must include an offset")
        return value

    @model_validator(mode="after")
    def enforce_prediction_boundary(self) -> "PredictiveRequest":
        if self.kind == "workforce" and self.target not in {"headcount", "workforce_capacity", "open_positions"}:
            raise ValueError("workforce predictions are limited to aggregate headcount, capacity, or open positions")
        forbidden = {"employee_id", "person_id", "performance", "productivity", "attrition", "hiring_score"}
        if self.target in forbidden or any(key in forbidden for item in self.observations for key in item.features):
            raise ValueError("person-level or employment-decision prediction is prohibited")
        return self


class ForecastPoint(StrictModel):
    step: int
    value: float
    lower: float
    upper: float


class PredictionConfidence(StrictModel):
    score: float = Field(ge=0, le=1)
    sample_size: int
    fit_r_squared: float = Field(ge=0, le=1)
    residual_standard_error: float = Field(ge=0)
    basis: list[str]


class PredictiveResult(StrictModel):
    schema_version: Literal["edt.decision-intelligence/1.0.0"]
    engine_version: Literal["predictive-baselines/1.0.0"]
    prediction_id: UUID
    model_id: UUID
    model_version: str
    kind: PredictionKind
    target: str
    generated_at: datetime
    feature_summary: dict[str, float | int]
    forecast: list[ForecastPoint]
    confidence: PredictionConfidence
    validation_status: Literal["pending_outcome"]
    limitations: list[str]
    result_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class PredictionValidationRequest(StrictModel):
    forecast: list[ForecastPoint] = Field(min_length=1, max_length=36)
    actual_values: list[float] = Field(min_length=1, max_length=36)

    @model_validator(mode="after")
    def matching_lengths(self) -> "PredictionValidationRequest":
        if len(self.forecast) != len(self.actual_values):
            raise ValueError("forecast and actual_values must have equal lengths")
        return self


class PredictionValidationResult(StrictModel):
    mean_absolute_error: float = Field(ge=0)
    mean_absolute_percentage_error: float | None
    root_mean_squared_error: float = Field(ge=0)
    mean_bias: float
    accuracy_score: float = Field(ge=0, le=1)
