from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import ValidationError

from edt_ai_worker.marketing_intelligence import (
    BudgetOptimizationRequest, ChannelPlan, FunnelSnapshot, FunnelTransition,
    MarketingMoney, MarketingSimulationRequest, ProcessObservation,
    compare_marketing_process, funnel_metrics, optimize_channel_budget,
    simulate_channel_mix,
)


def test_funnel_metrics_cover_conversion_cac_clv_and_roi():
    snapshot = FunnelSnapshot(campaign_id=uuid4(), segment_id=uuid4(), awareness=1000, interest=600, lead=300, qualified_lead=150, customer=60, retention=45)
    result = funnel_metrics(snapshot, spend=MarketingMoney(amount=Decimal("1200"), currency="USD"), attributed_revenue=MarketingMoney(amount=Decimal("6000"), currency="USD"), average_order_value=MarketingMoney(amount=Decimal("200"), currency="USD"), gross_margin_rate=Decimal("0.5"), expected_retained_periods=Decimal("4"))
    assert result.overall_conversion_rate == Decimal("0.060000")
    assert result.acquisition_cost.amount == Decimal("20.00")
    assert result.customer_lifetime_value.amount == Decimal("400.00")
    assert result.campaign_roi == Decimal("4.000000")


def test_funnel_rejects_impossible_counts_and_non_adjacent_movement():
    with pytest.raises(ValidationError):
        FunnelSnapshot(campaign_id=uuid4(), segment_id=uuid4(), awareness=10, interest=11, lead=1, qualified_lead=1, customer=1, retention=1)
    with pytest.raises(ValidationError):
        FunnelTransition(transition_id=uuid4(), campaign_id=uuid4(), segment_id=uuid4(), from_stage="awareness", to_stage="lead", cohort_count=1, occurred_at="2026-07-22T12:00:00Z", source_event_id=uuid4())


def test_channel_reallocation_reports_leads_customers_revenue_and_risk():
    a, b = uuid4(), uuid4()
    def plan(channel, share, cpl, conversion, clv, risk):
        return ChannelPlan(channel_id=channel, budget_share=Decimal(share), cost_per_lead=Decimal(cpl), lead_to_customer_rate=Decimal(conversion), customer_lifetime_value=Decimal(clv), risk_score=Decimal(risk))
    request = MarketingSimulationRequest(campaign_id=uuid4(), currency="USD", total_budget=Decimal("10000"), baseline=[plan(a, ".6", "20", ".1", "500", ".2"), plan(b, ".4", "10", ".2", "500", ".4")], scenario=[plan(a, ".4", "20", ".1", "500", ".2"), plan(b, ".6", "10", ".2", "500", ".4")])
    result = simulate_channel_mix(request)
    assert result.lead_change > 0 and result.customer_change > 0 and result.revenue_impact > 0
    assert result.risk_change > 0 and "No advertising platform" in result.warnings[1]


def test_budget_optimizer_recommends_higher_risk_adjusted_value_without_mutation():
    a, b = uuid4(), uuid4()
    result = optimize_channel_budget(BudgetOptimizationRequest(
        campaign_id=uuid4(),
        currency="USD",
        total_budget=Decimal("10000"),
        minimum_channel_share=Decimal("0.1"),
        channels=[
            ChannelPlan(channel_id=a, budget_share=Decimal("0.5"), cost_per_lead=Decimal("20"), lead_to_customer_rate=Decimal("0.1"), customer_lifetime_value=Decimal("500"), risk_score=Decimal("0.2")),
            ChannelPlan(channel_id=b, budget_share=Decimal("0.5"), cost_per_lead=Decimal("10"), lead_to_customer_rate=Decimal("0.2"), customer_lifetime_value=Decimal("500"), risk_score=Decimal("0.1")),
        ],
    ))
    by_channel = {item.channel_id: item for item in result.allocations}
    assert by_channel[b].recommended_share > by_channel[b].current_share
    assert sum((item.recommended_share for item in result.allocations), Decimal("0")) == Decimal("1")
    assert result.expected_revenue_impact > 0
    assert "no advertising platform" in result.warnings[0]


def test_marketing_reality_check_finds_hidden_steps_bottlenecks_and_owners():
    owner = uuid4()
    result = compare_marketing_process(["brief", "approve", "launch"], [
        ProcessObservation(case_id="1", steps=["brief", "legal_review", "approve", "launch"], step_duration_hours={"legal_review": Decimal("30")}, owners={"brief": owner, "legal_review": None, "approve": owner, "launch": owner}),
        ProcessObservation(case_id="2", steps=["brief", "launch"], step_duration_hours={"brief": Decimal("2")}, owners={"brief": owner, "launch": owner}),
    ])
    assert result.hidden_steps == ["legal_review"]
    assert result.bottlenecks == ["legal_review"]
    assert result.missing_ownership == ["legal_review"]
