from __future__ import annotations

from collections import defaultdict, deque
from datetime import timezone
from math import sqrt
from statistics import fmean

from .canonical import sha256_hex
from .decision_models import (
    DecisionSimulationRequest,
    DecisionSimulationResult,
    ForecastPoint,
    OutcomeComparison,
    PredictionConfidence,
    PredictionValidationRequest,
    PredictionValidationResult,
    PredictiveRequest,
    PredictiveResult,
    PropagatedEffect,
)
from .errors import DomainError
from .tenancy import TenantContext


SIMULATION_ENGINE_VERSION = "decision-simulation/1.0.0"
PREDICTIVE_ENGINE_VERSION = "predictive-baselines/1.0.0"
_DERIVED_RULE_VERSION = "business-derived-metrics/1.0.0"


def _round(value: float) -> float:
    return round(value, 8)


def _hash_without(value: object, field: str) -> str:
    if hasattr(value, "model_dump"):
        payload = value.model_dump(mode="json")
    else:
        payload = dict(value)  # type: ignore[arg-type]
    payload.pop(field, None)
    return sha256_hex(payload)


def _apply_derived_rules(state: dict[str, dict[str, float]]) -> None:
    for variables in state.values():
        if "price" in variables and "units" in variables:
            variables["revenue"] = _round(variables["price"] * variables["units"])
        if "revenue" in variables and "expense" in variables:
            variables["operating_margin"] = _round(variables["revenue"] - variables["expense"])
        if "budget" in variables and "expense" in variables:
            variables["budget_variance"] = _round(variables["budget"] - variables["expense"])
        if "demand" in variables and "capacity" in variables:
            variables["capacity_gap"] = _round(variables["capacity"] - variables["demand"])


def run_decision_simulation(request: DecisionSimulationRequest, context: TenantContext) -> DecisionSimulationResult:
    snapshot = request.snapshot
    scenario = request.scenario
    context.require_binding(snapshot.tenant_id, "decision snapshot")
    context.require_binding(scenario.tenant_id, "decision scenario")
    if scenario.snapshot_id != snapshot.snapshot_id or scenario.snapshot_hash != snapshot.canonical_sha256:
        raise DomainError("snapshot_binding_mismatch", "The scenario is not bound to the supplied snapshot.", status_code=409)
    if _hash_without(snapshot, "canonical_sha256") != snapshot.canonical_sha256:
        raise DomainError("snapshot_hash_mismatch", "The decision snapshot hash is invalid.", status_code=409)
    if _hash_without(scenario, "scenario_digest") != scenario.scenario_digest:
        raise DomainError("scenario_hash_mismatch", "The confirmed scenario digest is invalid.", status_code=409)

    baseline = {str(node.node_id): dict(node.variables) for node in snapshot.nodes}
    scenario_state = {node_id: dict(values) for node_id, values in baseline.items()}
    node_ids = set(scenario_state)
    direct_deltas: list[tuple[str, str, float]] = []
    for change in scenario.changes:
        node_id = str(change.node_id)
        if node_id not in node_ids:
            raise DomainError("scenario_node_missing", "A variable change references a node outside the snapshot.", status_code=422)
        variables = scenario_state[node_id]
        before = variables.get(change.variable, 0.0)
        if change.operation == "set":
            after = change.value
        elif change.operation == "add":
            after = before + change.value
        else:
            after = before * change.value
        if abs(after) > 1_000_000_000_000:
            raise DomainError("scenario_value_out_of_bounds", "A scenario change exceeded the supported numeric bound.", status_code=422)
        variables[change.variable] = _round(after)
        direct_deltas.append((node_id, change.variable, _round(after - before)))

    adjacency: dict[str, list[tuple[str, object]]] = defaultdict(list)
    for edge in snapshot.relationships:
        if edge.impact_direction in {"forward", "bidirectional"}:
            adjacency[str(edge.source_node_id)].append((str(edge.target_node_id), edge))
        if edge.impact_direction in {"reverse", "bidirectional"}:
            adjacency[str(edge.target_node_id)].append((str(edge.source_node_id), edge))

    effects: list[PropagatedEffect] = []
    for origin, variable, delta in direct_deltas:
        if delta == 0:
            continue
        queue = deque([(origin, delta, 0, [])])
        best: dict[str, float] = {origin: abs(delta)}
        while queue:
            current, current_delta, depth, path = queue.popleft()
            if depth >= scenario.max_depth:
                continue
            for target, edge_obj in adjacency.get(current, []):
                edge = edge_obj
                propagated = _round(current_delta * edge.strength * edge.confidence * edge.importance)
                if abs(propagated) < 0.00000001 or best.get(target, 0) >= abs(propagated):
                    continue
                best[target] = abs(propagated)
                before = scenario_state[target].get(variable, 0.0)
                scenario_state[target][variable] = _round(before + propagated)
                relationship_path = [*path, edge.relationship_id]
                effects.append(PropagatedEffect(
                    source_node_id=origin,
                    target_node_id=target,
                    variable=variable,
                    delta=propagated,
                    depth=depth + 1,
                    relationship_path=relationship_path,
                ))
                queue.append((target, propagated, depth + 1, relationship_path))

    _apply_derived_rules(baseline)
    _apply_derived_rules(scenario_state)
    comparisons: list[OutcomeComparison] = []
    for node_id in sorted(node_ids):
        variables = sorted(set(baseline[node_id]) | set(scenario_state[node_id]))
        for variable in variables:
            before = baseline[node_id].get(variable, 0.0)
            after = scenario_state[node_id].get(variable, 0.0)
            delta = _round(after - before)
            if delta == 0:
                continue
            comparisons.append(OutcomeComparison(
                node_id=node_id,
                variable=variable,
                baseline=_round(before),
                scenario=_round(after),
                absolute_delta=delta,
                percent_delta=None if before == 0 else _round(delta / abs(before) * 100),
            ))

    provisional = DecisionSimulationResult(
        schema_version="edt.decision-intelligence/1.0.0",
        engine_version=SIMULATION_ENGINE_VERSION,
        snapshot_id=snapshot.snapshot_id,
        scenario_id=scenario.scenario_id,
        branch_id=scenario.branch_id,
        propagation_method="bounded_weighted_relationship_propagation/1.0.0",
        rule_version=_DERIVED_RULE_VERSION,
        effects=effects,
        comparison=comparisons,
        assumptions=[*snapshot.assumptions, *scenario.assumptions],
        warnings=[
            "Results are conditional scenario outputs, not causal estimates or predictions.",
            "Relationship propagation uses declared weights and stops at the confirmed depth bound.",
        ],
        result_sha256="0" * 64,
    )
    return provisional.model_copy(update={"result_sha256": _hash_without(provisional, "result_sha256")})


def run_prediction(request: PredictiveRequest, context: TenantContext) -> PredictiveResult:
    context.require_binding(request.tenant_id, "prediction request")
    observations = sorted(request.observations, key=lambda item: item.observed_at)
    if len({item.observed_at for item in observations}) != len(observations):
        raise DomainError("duplicate_observation_time", "Historical observations must have unique timestamps.", status_code=422)
    origin = observations[0].observed_at
    x = [(item.observed_at - origin).total_seconds() / 86400 for item in observations]
    y = [item.value for item in observations]
    x_mean, y_mean = fmean(x), fmean(y)
    denominator = sum((item - x_mean) ** 2 for item in x)
    slope = 0.0 if denominator == 0 else sum((xi - x_mean) * (yi - y_mean) for xi, yi in zip(x, y)) / denominator
    intercept = y_mean - slope * x_mean
    fitted = [intercept + slope * item for item in x]
    residuals = [actual - predicted for actual, predicted in zip(y, fitted)]
    residual_sse = sum(value * value for value in residuals)
    total_sse = sum((value - y_mean) ** 2 for value in y)
    r_squared = 1.0 if total_sse == 0 and residual_sse == 0 else max(0.0, 1 - residual_sse / total_sse) if total_sse else 0.0
    residual_error = sqrt(residual_sse / max(1, len(y) - 2))
    cadence = max(1.0, (x[-1] - x[0]) / max(1, len(x) - 1))
    sample_score = min(1.0, len(y) / 24)
    confidence_score = max(0.05, min(0.99, 0.15 + 0.45 * sample_score + 0.4 * r_squared))
    forecast: list[ForecastPoint] = []
    for step in range(1, request.horizon_steps + 1):
        raw_value = intercept + slope * (x[-1] + cadence * step) + request.calibration_bias
        if request.algorithm == "bounded_linear_trend" or request.kind in {"customer_churn", "risk"}:
            raw_value = max(0.0, min(1.0, raw_value))
        interval = 1.96 * residual_error * sqrt(1 + step / max(1, len(y)))
        lower = raw_value - interval
        upper = raw_value + interval
        if request.algorithm == "bounded_linear_trend" or request.kind in {"customer_churn", "risk"}:
            lower, upper = max(0.0, lower), min(1.0, upper)
        forecast.append(ForecastPoint(step=step, value=_round(raw_value), lower=_round(lower), upper=_round(upper)))

    generated_at = request.requested_at.astimezone(timezone.utc)
    provisional = PredictiveResult(
        schema_version="edt.decision-intelligence/1.0.0",
        engine_version=PREDICTIVE_ENGINE_VERSION,
        prediction_id=request.prediction_id,
        model_id=request.model_id,
        model_version=request.model_version,
        kind=request.kind,
        target=request.target,
        generated_at=generated_at,
        feature_summary={
            "observation_count": len(y),
            "observed_min": _round(min(y)),
            "observed_max": _round(max(y)),
            "observed_mean": _round(y_mean),
            "trend_per_day": _round(slope),
            "cadence_days": _round(cadence),
        },
        forecast=forecast,
        confidence=PredictionConfidence(
            score=_round(confidence_score),
            sample_size=len(y),
            fit_r_squared=_round(r_squared),
            residual_standard_error=_round(residual_error),
            basis=["historical sample size", "linear-trend fit", "residual error", "forecast horizon"],
        ),
        validation_status="pending_outcome",
        limitations=[
            "This statistical baseline does not establish causality.",
            "Confidence is an engineering score, not a calibrated probability until validated outcomes accumulate.",
            "Workforce forecasts are aggregate only and cannot support employment decisions.",
        ],
        result_sha256="0" * 64,
    )
    return provisional.model_copy(update={"result_sha256": _hash_without(provisional, "result_sha256")})


def validate_prediction(request: PredictionValidationRequest) -> PredictionValidationResult:
    errors = [actual - point.value for actual, point in zip(request.actual_values, request.forecast)]
    absolute = [abs(value) for value in errors]
    mae = fmean(absolute)
    rmse = sqrt(fmean([value * value for value in errors]))
    percentage_values = [abs(error / actual) for error, actual in zip(errors, request.actual_values) if actual != 0]
    mape = fmean(percentage_values) if percentage_values else None
    scale = max(1e-9, fmean(abs(value) for value in request.actual_values))
    accuracy = max(0.0, min(1.0, 1 - mae / scale))
    return PredictionValidationResult(
        mean_absolute_error=_round(mae),
        mean_absolute_percentage_error=None if mape is None else _round(mape),
        root_mean_squared_error=_round(rmse),
        mean_bias=_round(fmean(errors)),
        accuracy_score=_round(accuracy),
    )
