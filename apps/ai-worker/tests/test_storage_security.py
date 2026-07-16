from __future__ import annotations

from uuid import UUID

from edt_ai_worker.storage import DurableRecordStore, _SCHEMA_POSTGRES
from edt_ai_worker.tenancy import ASTER_TENANT_ID, BEACON_TENANT_ID


def test_durable_store_qualifies_identical_ids_by_tenant():
    store = DurableRecordStore("sqlite:///:memory:")
    record_id = UUID("79000000-0000-4000-8000-000000000001")
    store.put(
        tenant_id=ASTER_TENANT_ID,
        kind="test",
        record_id=record_id,
        actor_id=None,
        created_at="2026-07-15T12:00:00+00:00",
        payload={"tenant": "aster"},
    )
    store.put(
        tenant_id=BEACON_TENANT_ID,
        kind="test",
        record_id=record_id,
        actor_id=None,
        created_at="2026-07-15T12:00:00+00:00",
        payload={"tenant": "beacon"},
    )
    assert store.get(tenant_id=ASTER_TENANT_ID, kind="test", record_id=record_id) == {
        "tenant": "aster"
    }
    assert store.get(tenant_id=BEACON_TENANT_ID, kind="test", record_id=record_id) == {
        "tenant": "beacon"
    }


def test_postgres_schema_forces_tenant_rls_and_connection_sets_context():
    normalized = " ".join(_SCHEMA_POSTGRES.split()).casefold()
    assert "enable row level security" in normalized
    assert "force row level security" in normalized
    assert "current_setting('app.tenant_id'" in normalized
    source = __import__("inspect").getsource(DurableRecordStore._postgres)
    assert "set_config('app.tenant_id'" in source
