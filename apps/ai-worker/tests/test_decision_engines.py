from datetime import datetime, timezone
from uuid import UUID

import pytest
from pydantic import ValidationError

from edt_ai_worker.canonical import hash_without
from edt_ai_worker.decision_engines import run_decision_simulation, run_prediction, validate_prediction
from edt_ai_worker.decision_models import (
    DecisionScenario,
    DecisionSimulationRequest,
    DecisionSnapshot,
    PredictionValidationRequest,
    PredictiveRequest,
)
from edt_ai_worker.tenancy import ASTER_TENANT_ID, TenantContext


NODE_A = UUID("81000000-0000-4000-8000-000000000001")
NODE_B = UUID("81000000-0000-4000-8000-000000000002")


def decision_snapshot() -> DecisionSnapshot:
    raw = {
        "schema_version": "edt.decision-intelligence/1.0.0",
        "snapshot_id": "82000000-0000-4000-8000-000000000001",
        "tenant_id": str(ASTER_TENANT_ID),
        "as_of": "2026-07-20T00:00:00Z",
        "graph_version": 3,
        "nodes": [
            {"node_id": str(NODE_A), "type_id": "edt.core/Company", "label": "Company", "variables": {"price": 10, "units": 100}},
            {"node_id": str(NODE_B), "type_id": "edt.core/RevenueStream", "label": "Revenue", "variables": {"price": 5, "units": 10}},
        ],
        "relationships": [{
            "relationship_id": "83000000-0000-4000-8000-000000000001",
            "source_node_id": str(NODE_A),
            "target_node_id": str(NODE_B),
            "impact_direction": "forward",
            "strength": 0.5,
            "confidence": 1,
            "importance": 1,
        }],
        "assumptions": ["Price is represented in one consistent unit."],
        "canonical_sha256": "0" * 64,
    }
    provisional = DecisionSnapshot.model_validate(raw)
    raw["canonical_sha256"] = hash_without(provisional, "canonical_sha256")
    return DecisionSnapshot.model_validate(raw)


def pricing_scenario(snapshot: DecisionSnapshot) -> DecisionScenario:
    raw = {
        "scenario_id": "84000000-0000-4000-8000-000000000001",
        "branch_id": "85000000-0000-4000-8000-000000000001",
        "parent_branch_id": None,
        "tenant_id": str(ASTER_TENANT_ID),
        "snapshot_id": str(snapshot.snapshot_id),
        "snapshot_hash": snapshot.canonical_sha256,
        "kind": "pricing_change",
        "name": "Ten percent price increase",
        "changes": [{"node_id": str(NODE_A), "variable": "price", "operation": "add", "value": 1}],
        "assumptions": [],
        "max_depth": 4,
        "rule_version": "business-derived-metrics/1.0.0",
        "status": "confirmed",
        "scenario_digest": "0" * 64,
    }
    provisional = DecisionScenario.model_validate(raw)
    raw["scenario_digest"] = hash_without(provisional, "scenario_digest")
    return DecisionScenario.model_validate(raw)


def test_decision_simulation_applies_propagates_rules_and_compares():
    snapshot = decision_snapshot()
    scenario = pricing_scenario(snapshot)
    context = TenantContext(ASTER_TENANT_ID)
    first = run_decision_simulation(DecisionSimulationRequest(snapshot=snapshot, scenario=scenario), context)
    second = run_decision_simulation(DecisionSimulationRequest(snapshot=snapshot, scenario=scenario), context)

    assert first.result_sha256 == second.result_sha256
    assert first.effects[0].target_node_id == NODE_B
    assert first.effects[0].delta == 0.5
    assert any(item.node_id == NODE_A and item.variable == "revenue" and item.absolute_delta == 100 for item in first.comparison)
    assert any(item.node_id == NODE_B and item.variable == "revenue" and item.absolute_delta == 5 for item in first.comparison)


def test_prediction_pipeline_forecasts_confidence_and_validation():
    context = TenantContext(ASTER_TENANT_ID)
    request = PredictiveRequest.model_validate({
        "prediction_id": "86000000-0000-4000-8000-000000000001",
        "tenant_id": str(ASTER_TENANT_ID),
        "model_id": "87000000-0000-4000-8000-000000000001",
        "model_version": "1.0.0",
        "kind": "revenue",
        "algorithm": "linear_trend",
        "target": "monthly_revenue",
        "requested_at": "2026-07-21T12:00:00Z",
        "horizon_steps": 2,
        "observations": [
            {"observed_at": "2026-01-01T00:00:00Z", "value": 100},
            {"observed_at": "2026-02-01T00:00:00Z", "value": 110},
            {"observed_at": "2026-03-01T00:00:00Z", "value": 120},
            {"observed_at": "2026-04-01T00:00:00Z", "value": 130},
        ],
    })
    result = run_prediction(request, context)

    assert len(result.forecast) == 2
    assert result.forecast[1].value > result.forecast[0].value > 130
    assert 0 < result.confidence.score <= 1
    validation = validate_prediction(PredictionValidationRequest(forecast=result.forecast, actual_values=[140, 150]))
    assert validation.accuracy_score > 0.95
    assert validation.mean_absolute_error >= 0


def test_workforce_prediction_rejects_person_level_targets():
    with pytest.raises(ValidationError):
        PredictiveRequest.model_validate({
            "prediction_id": "86000000-0000-4000-8000-000000000001",
            "tenant_id": str(ASTER_TENANT_ID),
            "model_id": "87000000-0000-4000-8000-000000000001",
            "model_version": "1.0.0",
            "kind": "workforce",
            "algorithm": "linear_trend",
            "target": "attrition",
            "requested_at": "2026-07-21T12:00:00Z",
            "horizon_steps": 1,
            "observations": [
                {"observed_at": datetime(2026, month, 1, tzinfo=timezone.utc), "value": month}
                for month in (1, 2, 3)
            ],
        })


@pytest.mark.parametrize(("kind", "variable"), [
    ("hiring", "headcount"),
    ("pricing_change", "price"),
    ("supplier_failure", "supplier_availability"),
    ("expansion", "capacity"),
    ("budget_change", "budget"),
])
def test_all_typed_scenario_families_execute(kind: str, variable: str):
    snapshot = decision_snapshot()
    raw = {
        "scenario_id": "84000000-0000-4000-8000-000000000001",
        "branch_id": "85000000-0000-4000-8000-000000000001",
        "parent_branch_id": None,
        "tenant_id": str(ASTER_TENANT_ID),
        "snapshot_id": str(snapshot.snapshot_id),
        "snapshot_hash": snapshot.canonical_sha256,
        "kind": kind,
        "name": f"{kind} test",
        "changes": [{"node_id": str(NODE_A), "variable": variable, "operation": "add", "value": 1}],
        "assumptions": [], "max_depth": 2,
        "rule_version": "business-derived-metrics/1.0.0", "status": "confirmed",
        "scenario_digest": "0" * 64,
    }
    provisional = DecisionScenario.model_validate(raw)
    raw["scenario_digest"] = hash_without(provisional, "scenario_digest")
    result = run_decision_simulation(
        DecisionSimulationRequest(snapshot=snapshot, scenario=DecisionScenario.model_validate(raw)),
        TenantContext(ASTER_TENANT_ID),
    )
    assert any(item.variable == variable for item in result.comparison)


@pytest.mark.parametrize(("kind", "target", "algorithm"), [
    ("revenue", "revenue", "linear_trend"),
    ("expense", "expense", "linear_trend"),
    ("customer_churn", "churn_rate", "bounded_linear_trend"),
    ("workforce", "headcount", "linear_trend"),
    ("risk", "risk_score", "bounded_linear_trend"),
])
def test_all_prediction_families_execute(kind: str, target: str, algorithm: str):
    result = run_prediction(PredictiveRequest.model_validate({
        "prediction_id": "86000000-0000-4000-8000-000000000001",
        "tenant_id": str(ASTER_TENANT_ID),
        "model_id": "87000000-0000-4000-8000-000000000001",
        "model_version": "1.0.0", "kind": kind, "algorithm": algorithm, "target": target,
        "requested_at": "2026-07-21T12:00:00Z",
        "horizon_steps": 1,
        "observations": [
            {"observed_at": "2026-01-01T00:00:00Z", "value": 0.1},
            {"observed_at": "2026-02-01T00:00:00Z", "value": 0.2},
            {"observed_at": "2026-03-01T00:00:00Z", "value": 0.3},
        ],
    }), TenantContext(ASTER_TENANT_ID))
    assert result.kind == kind
    assert result.forecast[0].value >= 0
    if kind in {"customer_churn", "risk"}:
        assert result.forecast[0].value <= 1
