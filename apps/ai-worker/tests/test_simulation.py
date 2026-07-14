from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from edt_ai_worker.calendar_math import WorkingCalendar
from edt_ai_worker.canonical import CounterStream
from edt_ai_worker.errors import DomainError
from edt_ai_worker.models import SimulationRequest
from edt_ai_worker.simulation import COUNTER_STREAM_COMPAT_VERSION, _quantile, run_simulation
from edt_ai_worker.snapshot import seal_snapshot

from conftest import TASK_A, TASK_B, confirmed_scenario, snapshot_payload


def test_counter_stream_golden_vector():
    stream = CounterStream(20260713, COUNTER_STREAM_COMPAT_VERSION, TASK_A, 17)
    assert [round(stream.uniform_open(), 15) for _ in range(4)] == [
        0.711737107339117,
        0.321609249839569,
        0.515823920990978,
        0.652358296888167,
    ]


def test_hyndman_fan_type_7_quantile():
    assert _quantile([0, 10], 0.5) == 5
    assert _quantile([1, 2, 3, 4, 5], 0.8) == pytest.approx(4.2)
    assert _quantile([7], 0.95) == 7


def test_preview_is_reproducible_and_complete(sealed_snapshot, aster_context):
    request = SimulationRequest(snapshot=sealed_snapshot, run_mode="preview", sample_count=500)
    first = run_simulation(request, aster_context)
    second = run_simulation(request, aster_context)
    assert first.result_sha256 == second.result_sha256
    assert first.uncertainty == second.uncertainty
    assert first.critical_path == [TASK_A, TASK_B]
    assert first.uncertainty.quantiles.p50 <= first.uncertainty.quantiles.p80 <= first.uncertainty.quantiles.p95
    assert first.probability_on_or_before_target is not None
    assert first.probability_after_target == pytest.approx(1 - first.probability_on_or_before_target)
    assert first.blockers[0].work_item_id == TASK_A
    assert first.sensitivity[0].work_item_id == TASK_A
    assert "preview_only_not_committed" in first.warnings
    assert any("predictive validity" in assumption for assumption in first.assumptions)


def test_golden_simulation_vector(sealed_snapshot, aster_context):
    expected = json.loads((Path(__file__).parent / "golden" / "simulation-vector.json").read_text(encoding="utf-8"))
    result = run_simulation(
        SimulationRequest(snapshot=sealed_snapshot, run_mode="preview", sample_count=500),
        aster_context,
    )
    assert {
        "result_sha256": result.result_sha256,
        "p50": result.uncertainty.quantiles.p50.isoformat(),
        "p80": result.uncertainty.quantiles.p80.isoformat(),
        "p95": result.uncertainty.quantiles.p95.isoformat(),
        "on_time": result.probability_on_or_before_target,
        "critical_path": [str(item) for item in result.critical_path],
    } == expected


def test_common_random_numbers_make_pure_shift_exact(sealed_snapshot, aster_context):
    scenario = confirmed_scenario(sealed_snapshot, delta=-1)
    result = run_simulation(
        SimulationRequest(
            snapshot=sealed_snapshot,
            scenario=scenario,
            run_mode="preview",
            sample_count=500,
        ),
        aster_context,
    )
    assert result.comparison is not None
    assert result.comparison.delta_workdays == {"p50": -1.0, "p80": -1.0, "p95": -1.0}
    assert result.comparison.probability_of_improvement == 1.0
    assert result.scenario_hash == scenario.scenario_digest


def test_changed_confirmed_scenario_digest_fails_closed(sealed_snapshot, aster_context):
    scenario = confirmed_scenario(sealed_snapshot).model_copy(update={"name": "changed after confirmation"})
    with pytest.raises(DomainError) as failure:
        run_simulation(
            SimulationRequest(
                snapshot=sealed_snapshot,
                scenario=scenario,
                run_mode="preview",
                sample_count=100,
            ),
            aster_context,
        )
    assert failure.value.code == "scenario_hash_mismatch"


def test_constant_serial_chain_matches_analytic_duration(aster_context):
    raw = snapshot_payload()
    raw["tasks"][0]["state"] = "not_started"
    raw["tasks"][0]["remaining_duration"].update(optimistic=2, most_likely=2, pessimistic=2)
    sealed = seal_snapshot(raw, aster_context)
    result = run_simulation(
        SimulationRequest(snapshot=sealed, run_mode="preview", sample_count=100),
        aster_context,
    )
    assert result.uncertainty.quantiles.p50.isoformat() == "2026-07-16"
    assert result.uncertainty.quantiles.p50 == result.uncertainty.quantiles.p95
    assert result.sensitivity == []


def test_empty_project_finishes_at_as_of(aster_context):
    raw = snapshot_payload()
    raw["tasks"] = []
    raw["dependencies"] = []
    raw["team_capacities"] = []
    raw["evidence_ids"] = []
    sealed = seal_snapshot(raw, aster_context)
    result = run_simulation(
        SimulationRequest(snapshot=sealed, run_mode="preview", sample_count=100),
        aster_context,
    )
    assert result.uncertainty.quantiles.p50.isoformat() == "2026-07-13"
    assert result.critical_path == []
    assert result.criticality == []


def test_weekend_calendar_addition(sealed_snapshot):
    calendar = WorkingCalendar(sealed_snapshot.timezone, sealed_snapshot.calendar)
    start = sealed_snapshot.as_of.replace(day=17)  # Friday 2026-07-17
    assert calendar.add_workdays(start, 2).date().isoformat() == "2026-07-20"


def test_target_cutoff_distinguishes_weekend_end_from_monday_start(aster_context):
    on_time_raw = snapshot_payload()
    on_time_raw["as_of"] = "2026-07-17T09:00:00Z"
    on_time_raw["project_start"] = "2026-07-17T09:00:00Z"
    on_time_raw["sealed_at"] = "2026-07-17T09:01:00Z"
    on_time_raw["target_date"] = "2026-07-19"
    on_time_raw["tasks"] = [on_time_raw["tasks"][1]]
    on_time_raw["tasks"][0]["remaining_duration"].update(optimistic=1, most_likely=1, pessimistic=1)
    on_time_raw["dependencies"] = []
    on_time = seal_snapshot(on_time_raw, aster_context)
    on_time_result = run_simulation(
        SimulationRequest(snapshot=on_time, run_mode="preview", sample_count=100),
        aster_context,
    )
    assert on_time_result.probability_on_or_before_target == 1.0

    late_raw = deepcopy(on_time_raw)
    late_raw["tasks"][0]["remaining_duration"].update(optimistic=0, most_likely=0, pessimistic=0)
    late_raw["tasks"][0]["earliest_start"] = "2026-07-20T09:00:00Z"
    late_raw["snapshot_id"] = "71000000-0000-4000-8000-000000000002"
    late = seal_snapshot(late_raw, aster_context)
    late_result = run_simulation(
        SimulationRequest(snapshot=late, run_mode="preview", sample_count=100),
        aster_context,
    )
    assert late_result.probability_on_or_before_target == 0.0


def test_input_order_does_not_change_computational_hash(aster_context):
    first_raw = snapshot_payload()
    second_raw = deepcopy(first_raw)
    second_raw["tasks"].reverse()
    first = seal_snapshot(first_raw, aster_context)
    second = seal_snapshot(second_raw, aster_context)
    first_result = run_simulation(SimulationRequest(snapshot=first, run_mode="preview", sample_count=200), aster_context)
    second_result = run_simulation(SimulationRequest(snapshot=second, run_mode="preview", sample_count=200), aster_context)
    assert first_result.result_sha256 == second_result.result_sha256
