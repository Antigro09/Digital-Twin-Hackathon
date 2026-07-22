from datetime import datetime, timedelta, timezone
from uuid import uuid4

from edt_ai_worker.authorization import PolicyEngine, Resource, Role, Subject
from edt_ai_worker.enterprise_audit import EnterpriseAuditEvent
from edt_ai_worker.governance import GovernanceEnvelope, LineageHop


def subject(tenant, actor, role=Role.MANAGER, methods=frozenset({"pwd", "mfa"})):
    return Subject(tenant, actor, frozenset({role}), frozenset(), frozenset({"finance"}), frozenset(), frozenset(), methods)


def test_policy_denies_cross_tenant_and_missing_mfa():
    tenant, actor = uuid4(), uuid4(); policy = PolicyEngine()
    resource = Resource(uuid4(), actor, "finance", None, None, "internal")
    assert policy.decide(subject(tenant, actor), "graph.read", resource).reason == "tenant_boundary"
    same = Resource(tenant, actor, "finance", None, None, "internal")
    assert policy.decide(subject(tenant, actor, methods=frozenset({"pwd"})), "graph.read", same, require_mfa=True).reason == "mfa_required"


def test_abac_uses_department_and_restricted_data_is_executive_only():
    tenant, actor = uuid4(), uuid4(); policy = PolicyEngine()
    internal = Resource(tenant, uuid4(), "finance", None, None, "internal")
    assert policy.decide(subject(tenant, actor), "graph.read", internal).allowed
    restricted = Resource(tenant, actor, "finance", None, None, "restricted")
    assert not policy.decide(subject(tenant, actor), "graph.read", restricted).allowed
    assert policy.decide(subject(tenant, actor, Role.EXECUTIVE), "graph.read", restricted).allowed


def test_governance_answers_source_owner_quality_and_retention():
    now = datetime.now(timezone.utc)
    envelope = GovernanceEnvelope(source_system="erp", source_locator="erp://invoice/1", owner_id=uuid4(), quality_score=.98, quality_method="source validation", classification="confidential", retention_policy="finance-7y", retention_until=now + timedelta(days=1), encryption_key_ref="kms://tenant/finance", lineage=[LineageHop(source_id="invoice-1", operation="ingest", occurred_at=now)])
    assert envelope.source_system == "erp" and envelope.owner_id and envelope.quality_score == .98
    assert not envelope.can_delete(now)


def test_audit_has_before_after_reason_and_redacts_secrets():
    event = EnterpriseAuditEvent(event_id=uuid4(), tenant_id=uuid4(), actor_id=uuid4(), occurred_at=datetime.now(timezone.utc), category="permission_change", action="permission.update", resource_type="actor", resource_id="actor-1", previous_value={"api_key": "super-secret-key"}, new_value={"role": "manager"}, reason="approved transfer", policy_decision="allowed", request_id="req-1", explanation="Manager access granted after approval.")
    assert "super-secret-key" not in str(event.previous_value)
