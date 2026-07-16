from __future__ import annotations

from fastapi.testclient import TestClient

from edt_ai_worker.api import app
from edt_ai_worker.tenancy import ASTER_TENANT_ID


def test_internal_service_token_is_constant_time_gated_and_never_echoed(monkeypatch):
    secret = "internal-worker-secret-value"
    monkeypatch.setenv("AI_WORKER_SHARED_SECRET", secret)
    client = TestClient(app)
    assert client.get("/health/live").status_code == 200
    body = {"evidence": [], "fields": ["owner"]}
    base = {"X-Internal-Tenant-Id": str(ASTER_TENANT_ID)}
    missing = client.post("/v1/evidence/extract-known-facts", headers=base, json=body)
    wrong = client.post(
        "/v1/evidence/extract-known-facts",
        headers={**base, "X-Internal-Service-Token": "wrong-worker-secret"},
        json=body,
    )
    assert missing.status_code == wrong.status_code == 401
    assert missing.json()["code"] == wrong.json()["code"] == "invalid_internal_authentication"
    assert secret not in missing.text + wrong.text


def test_validation_errors_do_not_echo_confidential_request_input(monkeypatch):
    secret = "internal-worker-secret-value"
    confidential = "API_KEY=do-not-echo-this-secret"
    monkeypatch.setenv("AI_WORKER_SHARED_SECRET", secret)
    client = TestClient(app)
    response = client.post(
        "/v1/extractions",
        headers={
            "X-Internal-Tenant-Id": str(ASTER_TENANT_ID),
            "X-Internal-Service-Token": secret,
        },
        json={"evidence": [], "fields": [], "confidential": confidential},
    )
    assert response.status_code == 422
    assert confidential not in response.text
