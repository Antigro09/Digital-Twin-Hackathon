from decimal import Decimal
from uuid import uuid4

import pytest

from edt_ai_worker.business_intelligence import CashFlowPeriod, CustomerEconomics, MarketShock, Money, calculate_financial_metrics, customer_profitability, market_impact
from edt_ai_worker.document_links import propose_document_link
from edt_ai_worker.industry_models import INDUSTRY_PACKAGES, IndustryPackage, IndustryRegistry


def money(value):
    return Money(amount=Decimal(value), currency="USD")


def test_financial_metrics_and_roi_are_decimal_and_deterministic():
    result = calculate_financial_metrics([CashFlowPeriod(period="2026-07", revenue=money("1000"), expenses=money("600"), investments=money("100"))])
    assert result.operating_profit == Decimal("400")
    assert result.net_cash_flow == Decimal("300")
    assert result.profit_margin == Decimal("0.4000")
    assert result.roi == Decimal("3.0000")


def test_customer_and_market_risk_connect_to_revenue():
    customer = customer_profitability(CustomerEconomics(customer_id=uuid4(), revenue=money("1000"), direct_cost=money("300"), service_cost=money("100"), churn_probability=Decimal("0.25")))
    assert customer.contribution == Decimal("600") and customer.revenue_at_risk == Decimal("250.00")
    impact = market_impact(MarketShock(market_id=uuid4(), factor=Decimal("-0.10"), exposed_revenue=money("2000"), dependency_probability=Decimal("0.50")))
    assert impact.expected_revenue_change == Decimal("-200.00") and impact.expected_revenue_at_risk == Decimal("100.00")


def test_cross_currency_aggregation_fails_closed():
    euro = Money(amount=Decimal("10"), currency="EUR")
    with pytest.raises(ValueError):
        CashFlowPeriod(period="2026-07", revenue=money("10"), expenses=euro)


def test_industry_packages_and_custom_registration_need_no_core_change():
    assert set(INDUSTRY_PACKAGES) == {"construction", "manufacturing", "software"}
    custom = IndustryPackage.model_validate({"package_id": "healthcare", "version": 1, "node_types": ["Facility", "Device"], "relationships": [{"name": "OWNS_DEVICE", "source_types": ["Facility"], "target_types": ["Device"]}], "rules": [], "simulations": [], "ai_models": [], "workflows": []})
    registry = IndustryRegistry(); registry.register(custom)
    assert registry.resolve("healthcare", 1) == custom


def test_document_links_are_evidenced_review_only_proposals():
    link = propose_document_link(document_id=uuid4(), evidence_id=uuid4(), entity_id=uuid4(), entity_type="Machine", relationship_type="GOVERNS_MAINTENANCE", confidence=.9, source_locator="manual.pdf#page=4")
    assert link.status == "PENDING_REVIEW" and link.graph_mutation_performed is False
