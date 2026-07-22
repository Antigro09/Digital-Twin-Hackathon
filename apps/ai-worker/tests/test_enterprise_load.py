from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

from edt_ai_worker.authorization import PolicyEngine, Resource, Role, Subject
from edt_ai_worker.business_intelligence import CashFlowPeriod, Money, calculate_financial_metrics
from edt_ai_worker.loops import LOOPS


def test_ten_thousand_financial_periods_remain_bounded():
    periods = [CashFlowPeriod(period="2026-07", revenue=Money(amount=Decimal("10"), currency="USD"), expenses=Money(amount=Decimal("6"), currency="USD")) for _ in range(10_000)]
    result = calculate_financial_metrics(periods)
    assert result.revenue == Decimal("100000") and result.operating_profit == Decimal("40000")


def test_ten_thousand_policy_decisions_do_not_share_tenant_state():
    policy = PolicyEngine(); tenant = uuid4(); actor = uuid4()
    subject = Subject(tenant, actor, frozenset({Role.EMPLOYEE}), frozenset(), frozenset(), frozenset(), frozenset(), frozenset({"mfa"}))
    for _ in range(10_000):
        assert policy.decide(subject, "graph.read", Resource(tenant, actor, None, None, None, "internal")).allowed
        assert not policy.decide(subject, "graph.read", Resource(uuid4(), actor, None, None, None, "internal")).allowed


def test_loop_ids_are_unique_across_tenants_and_periods():
    tenants = [UUID(int=index + 1) for index in range(1000)]
    ids = {LOOPS["daily_refresh"].run_id(tenant, date(2026, 7, day)) for tenant in tenants for day in range(1, 11)}
    assert len(ids) == 10_000
