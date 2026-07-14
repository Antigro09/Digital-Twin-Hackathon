from __future__ import annotations

from copy import deepcopy
from uuid import UUID

import pytest

from edt_ai_worker.canonical import hash_without
from edt_ai_worker.models import Scenario
from edt_ai_worker.snapshot import seal_snapshot
from edt_ai_worker.tenancy import ASTER_TENANT_ID, TenantContext


TASK_A = UUID("116ab4b3-b108-5f91-ab7e-111f7fba1d45")
TASK_B = UUID("216ab4b3-b108-5f91-ab7e-111f7fba1d45")
TEAM_ID = UUID("316ab4b3-b108-5f91-ab7e-111f7fba1d45")
EVIDENCE_A = UUID("416ab4b3-b108-5f91-ab7e-111f7fba1d45")
EVIDENCE_B = UUID("516ab4b3-b108-5f91-ab7e-111f7fba1d45")
EVIDENCE_EDGE = UUID("616ab4b3-b108-5f91-ab7e-111f7fba1d45")
EVIDENCE_TEAM = UUID("716ab4b3-b108-5f91-ab7e-111f7fba1d45")


def snapshot_payload(*, tenant_id: UUID = ASTER_TENANT_ID) -> dict:
    return {
        "schema_version": "1.0",
        "snapshot_id": "71000000-0000-4000-8000-000000000001",
        "tenant_id": str(tenant_id),
        "project_id": "72000000-0000-4000-8000-000000000001",
        "as_of": "2026-07-13T09:00:00Z",
        "project_start": "2026-07-13T09:00:00Z",
        "target_date": "2026-07-20",
        "projection_checkpoint_id": "74000000-0000-4000-8000-000000000001",
        "outbox_position": 42,
        "ontology_version": "h1/1.0.0",
        "simulation_model_version": "pert-monte-carlo/1.0.0",
        "parameter_set_version": "h1-defaults/1.0.0",
        "default_seed": "20260713",
        "timezone": "UTC",
        "timezone_database_version": "system-pinned",
        "calendar": {
            "version": "aster-working-calendar/1.0.0",
            "working_weekdays": [1, 2, 3, 4, 5],
            "workday_start": "09:00",
            "hours_per_workday": 8,
            "holidays": [],
        },
        "tasks": [
            {
                "work_item_id": str(TASK_A),
                "source_key": "AST-142",
                "label": "Close launch blocker",
                "state": "blocked",
                "team_id": str(TEAM_ID),
                "remaining_duration": {
                    "optimistic": 2,
                    "most_likely": 3,
                    "pessimistic": 5,
                    "unit": "workday",
                    "source": "explicit",
                },
                "earliest_start": None,
                "actual_finish": None,
                "external_blocker": False,
                "external_blocker_until": None,
                "evidence_ids": [str(EVIDENCE_A)],
            },
            {
                "work_item_id": str(TASK_B),
                "source_key": "AST-150",
                "label": "Release validation",
                "state": "not_started",
                "team_id": str(TEAM_ID),
                "remaining_duration": {
                    "optimistic": 2,
                    "most_likely": 2,
                    "pessimistic": 2,
                    "unit": "workday",
                    "source": "explicit",
                },
                "earliest_start": None,
                "actual_finish": None,
                "external_blocker": False,
                "external_blocker_until": None,
                "evidence_ids": [str(EVIDENCE_B)],
            },
        ],
        "dependencies": [
            {
                "predecessor_work_item_id": str(TASK_A),
                "successor_work_item_id": str(TASK_B),
                "type": "finish_to_start",
                "lag_workdays": 0,
                "source_relationship_id": "81000000-0000-4000-8000-000000000001",
                "evidence_ids": [str(EVIDENCE_EDGE)],
            }
        ],
        "team_capacities": [
            {
                "team_id": str(TEAM_ID),
                "parallel_capacity": 1,
                "availability": 1,
                "evidence_ids": [str(EVIDENCE_TEAM)],
            }
        ],
        "assumptions": ["Source estimates were explicitly confirmed for the synthetic fixture."],
        "warnings": [],
        "evidence_ids": [str(EVIDENCE_A), str(EVIDENCE_B), str(EVIDENCE_EDGE), str(EVIDENCE_TEAM)],
        "sealed_at": "2026-07-13T09:01:00Z",
    }


def confirmed_scenario(snapshot, *, delta: int = -1) -> Scenario:
    raw = {
        "scenario_id": "70000000-0000-4000-8000-000000000001",
        "tenant_id": str(snapshot.tenant_id),
        "snapshot_id": str(snapshot.snapshot_id),
        "snapshot_hash": snapshot.canonical_sha256,
        "name": "AST-142 completes earlier",
        "target_date": "2026-07-20",
        "model_version": "pert-monte-carlo/1.0.0",
        "calendar_version": snapshot.calendar.version,
        "compiler_version": "scenario-compiler/1.0.0",
        "seed": "20260713",
        "sample_count": 50000,
        "interventions": [
            {
                "type": "shift_completion_distribution",
                "work_item_id": str(TASK_A),
                "delta_workdays": delta,
            }
        ],
        "assumptions": [],
        "confirmed_by": "73000000-0000-4000-8000-000000000001",
        "confirmed_at": "2026-07-13T09:02:00Z",
        "scenario_digest": "0" * 64,
    }
    provisional = Scenario.model_validate(raw)
    raw["scenario_digest"] = hash_without(provisional, "scenario_digest")
    return Scenario.model_validate(raw)


@pytest.fixture
def aster_context() -> TenantContext:
    return TenantContext(ASTER_TENANT_ID)


@pytest.fixture
def sealed_snapshot(aster_context):
    return seal_snapshot(snapshot_payload(), aster_context)


@pytest.fixture
def snapshot_payload_copy():
    return deepcopy(snapshot_payload())

