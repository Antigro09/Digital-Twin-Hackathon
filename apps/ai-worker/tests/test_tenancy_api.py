from __future__ import annotations

from fastapi.testclient import TestClient

from edt_ai_worker.api import app, result_store
from edt_ai_worker.models import SimulationRequest
from edt_ai_worker.simulation import run_simulation
from edt_ai_worker.tenancy import (
    ASTER_TENANT_ID,
    BEACON_TENANT_ID,
    TenantContext,
    TenantScopedResultStore,
    H1_TENANTS,
)

from conftest import snapshot_payload


def test_store_is_qualified_by_tenant():
    store: TenantScopedResultStore[dict] = TenantScopedResultStore()
    aster = TenantContext(ASTER_TENANT_ID)
    beacon = TenantContext(BEACON_TENANT_ID)
    store.put(aster, "same-key", {"tenant": str(ASTER_TENANT_ID)})
    store.put(beacon, "same-key", {"tenant": str(BEACON_TENANT_ID)})
    assert store.get(aster, "same-key") == {"tenant": str(ASTER_TENANT_ID)}
    assert store.get(beacon, "same-key") == {"tenant": str(BEACON_TENANT_ID)}


def test_h1_tenant_allowlist_is_exact_and_closed():
    assert H1_TENANTS == frozenset((ASTER_TENANT_ID, BEACON_TENANT_ID))


def test_health_is_public_but_worker_operations_require_context():
    client = TestClient(app)
    assert client.get("/health/live").status_code == 200
    response = client.post("/v1/grounded-answers", json={})
    assert response.status_code == 401
    assert response.json()["code"] == "missing_tenant_context"


def test_result_lookup_cannot_cross_tenants(sealed_snapshot, aster_context):
    result = run_simulation(
        SimulationRequest(snapshot=sealed_snapshot, run_mode="preview", sample_count=100),
        aster_context,
    )
    result_store.put(aster_context, result.result_sha256, result)
    client = TestClient(app)
    aster_response = client.get(
        f"/v1/simulation-results/{result.result_sha256}",
        headers={"X-Internal-Tenant-Id": str(ASTER_TENANT_ID)},
    )
    beacon_response = client.get(
        f"/v1/simulation-results/{result.result_sha256}",
        headers={"X-Internal-Tenant-Id": str(BEACON_TENANT_ID)},
    )
    assert aster_response.status_code == 200
    assert str(BEACON_TENANT_ID) not in aster_response.text
    assert beacon_response.status_code == 404


def test_payload_tenant_cannot_override_internal_context(sealed_snapshot):
    client = TestClient(app)
    response = client.post(
        "/v1/simulations",
        headers={"X-Internal-Tenant-Id": str(BEACON_TENANT_ID)},
        json={
            "snapshot": sealed_snapshot.model_dump(mode="json"),
            "run_mode": "preview",
            "sample_count": 100,
        },
    )
    assert response.status_code == 403
    assert response.json()["code"] == "cross_tenant_binding"


def test_seal_and_simulate_http_flow():
    client = TestClient(app)
    headers = {"X-Internal-Tenant-Id": str(ASTER_TENANT_ID)}
    seal_response = client.post(
        "/v1/snapshots/seal",
        headers=headers,
        json={"snapshot": snapshot_payload()},
    )
    assert seal_response.status_code == 200, seal_response.text
    assert len(seal_response.json()["canonical_sha256"]) == 64
    simulate_response = client.post(
        "/v1/simulations",
        headers=headers,
        json={
            "snapshot": seal_response.json(),
            "run_mode": "preview",
            "sample_count": 100,
        },
    )
    assert simulate_response.status_code == 200, simulate_response.text
    body = simulate_response.json()
    assert body["status"] == "succeeded"
    assert body["tenant_id"] == str(ASTER_TENANT_ID)
    assert str(BEACON_TENANT_ID) not in simulate_response.text
