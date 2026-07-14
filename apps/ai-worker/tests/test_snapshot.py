from __future__ import annotations

from copy import deepcopy

import pytest

from edt_ai_worker.errors import DomainError
from edt_ai_worker.models import SimulationSnapshot
from edt_ai_worker.snapshot import parse_snapshot, seal_snapshot

from conftest import TASK_A, TASK_B, snapshot_payload


def test_seal_is_order_invariant_and_verifiable(aster_context):
    first = snapshot_payload()
    second = deepcopy(first)
    second["tasks"].reverse()
    second["evidence_ids"].reverse()
    sealed_first = seal_snapshot(first, aster_context)
    sealed_second = seal_snapshot(second, aster_context)
    assert sealed_first.canonical_sha256 == sealed_second.canonical_sha256
    assert sealed_first.calendar.canonical_sha256 == sealed_second.calendar.canonical_sha256
    assert parse_snapshot(sealed_first, aster_context) == sealed_first


def test_tampered_snapshot_fails_closed(sealed_snapshot, aster_context):
    raw = sealed_snapshot.model_dump(mode="json")
    raw["tasks"][0]["label"] = "tampered"
    tampered = SimulationSnapshot.model_validate(raw)
    with pytest.raises(DomainError, match="sealed hash") as failure:
        parse_snapshot(tampered, aster_context)
    assert failure.value.code == "snapshot_hash_mismatch"


def test_cycle_has_stable_explicit_error(aster_context):
    raw = snapshot_payload()
    raw["dependencies"].append(
        {
            "predecessor_work_item_id": str(TASK_B),
            "successor_work_item_id": str(TASK_A),
            "type": "finish_to_start",
            "lag_workdays": 0,
            "source_relationship_id": "81000000-0000-4000-8000-000000000002",
            "evidence_ids": ["616ab4b3-b108-5f91-ab7e-111f7fba1d45"],
        }
    )
    with pytest.raises(DomainError) as failure:
        seal_snapshot(raw, aster_context)
    assert failure.value.code == "invalid_dependency_cycle"
    assert failure.value.details["cycle"] == [str(TASK_A), str(TASK_B), str(TASK_A)]


def test_unknown_dependency_endpoint_is_rejected(aster_context):
    raw = snapshot_payload()
    raw["dependencies"][0]["successor_work_item_id"] = "99999999-0000-4000-8000-000000000999"
    with pytest.raises(DomainError) as failure:
        seal_snapshot(raw, aster_context)
    assert failure.value.code == "unknown_task_reference"

