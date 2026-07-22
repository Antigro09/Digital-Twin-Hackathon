"""Aggregate, graph-oriented marketing metrics, simulations and process conformance."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from .models import StrictModel


MONEY = Decimal("0.01")
RATE = Decimal("0.000001")


class FunnelStage(str, Enum):
    AWARENESS = "awareness"
    INTEREST = "interest"
    LEAD = "lead"
    QUALIFIED_LEAD = "qualified_lead"
    CUSTOMER = "customer"
    RETENTION = "retention"


STAGES = tuple(FunnelStage)


class FunnelSnapshot(StrictModel):
    campaign_id: UUID
    segment_id: UUID
    awareness: int = Field(ge=0, le=1_000_000_000)
    interest: int = Field(ge=0, le=1_000_000_000)
    lead: int = Field(ge=0, le=1_000_000_000)
    qualified_lead: int = Field(ge=0, le=1_000_000_000)
    customer: int = Field(ge=0, le=1_000_000_000)
    retention: int = Field(ge=0, le=1_000_000_000)

    @model_validator(mode="after")
    def monotonic(self) -> "FunnelSnapshot":
        values = [getattr(self, stage.value) for stage in STAGES]
        if any(later > earlier for earlier, later in zip(values, values[1:])):
            raise ValueError("funnel counts must not increase at a later stage")
        return self


class FunnelTransition(StrictModel):
    transition_id: UUID
    campaign_id: UUID
    segment_id: UUID
    from_stage: FunnelStage
    to_stage: FunnelStage
    cohort_count: int = Field(gt=0, le=1_000_000_000)
    occurred_at: str = Field(min_length=20, max_length=40)
    source_event_id: UUID

    @model_validator(mode="after")
    def adjacent_forward_transition(self) -> "FunnelTransition":
        if STAGES.index(self.to_stage) != STAGES.index(self.from_stage) + 1:
            raise ValueError("funnel movement must advance exactly one stage")
        return self


class MarketingMoney(StrictModel):
    amount: Decimal = Field(ge=0, max_digits=20, decimal_places=4)
    currency: str = Field(pattern=r"^[A-Z]{3}$")


class FunnelMetrics(StrictModel):
    stage_conversion_rates: dict[str, Decimal]
    overall_conversion_rate: Decimal | None
    acquisition_cost: MarketingMoney | None
    customer_lifetime_value: MarketingMoney | None
    campaign_roi: Decimal | None


def _divide(numerator: Decimal, denominator: Decimal) -> Decimal | None:
    return (numerator / denominator).quantize(RATE, rounding=ROUND_HALF_UP) if denominator else None


def funnel_metrics(snapshot: FunnelSnapshot, *, spend: MarketingMoney, attributed_revenue: MarketingMoney, average_order_value: MarketingMoney | None = None, gross_margin_rate: Decimal | None = None, expected_retained_periods: Decimal | None = None) -> FunnelMetrics:
    currencies = {spend.currency, attributed_revenue.currency}
    if average_order_value is not None:
        currencies.add(average_order_value.currency)
    if len(currencies) != 1:
        raise ValueError("marketing values must use one normalized currency")
    if gross_margin_rate is not None and not Decimal("0") <= gross_margin_rate <= Decimal("1"):
        raise ValueError("gross margin rate must be between zero and one")
    if expected_retained_periods is not None and expected_retained_periods < 0:
        raise ValueError("expected retained periods cannot be negative")
    rates = {
        f"{left.value}_to_{right.value}": _divide(Decimal(getattr(snapshot, right.value)), Decimal(getattr(snapshot, left.value))) or Decimal("0")
        for left, right in zip(STAGES, STAGES[1:])
    }
    acquisition = None if snapshot.customer == 0 else MarketingMoney(amount=(spend.amount / snapshot.customer).quantize(MONEY, rounding=ROUND_HALF_UP), currency=spend.currency)
    clv = None
    if average_order_value is not None and gross_margin_rate is not None and expected_retained_periods is not None:
        clv = MarketingMoney(amount=(average_order_value.amount * gross_margin_rate * expected_retained_periods).quantize(MONEY, rounding=ROUND_HALF_UP), currency=spend.currency)
    roi = _divide(attributed_revenue.amount - spend.amount, spend.amount)
    return FunnelMetrics(
        stage_conversion_rates=rates,
        overall_conversion_rate=_divide(Decimal(snapshot.customer), Decimal(snapshot.awareness)),
        acquisition_cost=acquisition,
        customer_lifetime_value=clv,
        campaign_roi=roi,
    )


class ChannelPlan(StrictModel):
    channel_id: UUID
    budget_share: Decimal = Field(ge=0, le=1, decimal_places=6)
    cost_per_lead: Decimal = Field(gt=0, max_digits=20, decimal_places=4)
    lead_to_customer_rate: Decimal = Field(ge=0, le=1, decimal_places=6)
    customer_lifetime_value: Decimal = Field(ge=0, max_digits=20, decimal_places=4)
    risk_score: Decimal = Field(ge=0, le=1, decimal_places=6)


class BudgetOptimizationRequest(StrictModel):
    campaign_id: UUID
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    total_budget: Decimal = Field(gt=0, max_digits=20, decimal_places=4)
    channels: list[ChannelPlan] = Field(min_length=1, max_length=50)
    minimum_channel_share: Decimal = Field(default=Decimal("0"), ge=0, le=1, decimal_places=6)

    @model_validator(mode="after")
    def valid_allocation(self) -> "BudgetOptimizationRequest":
        if len({item.channel_id for item in self.channels}) != len(self.channels):
            raise ValueError("channel allocations must be unique")
        current_total = sum((item.budget_share for item in self.channels), Decimal("0"))
        if abs(current_total - Decimal("1")) > RATE:
            raise ValueError("channel budget shares must total one")
        if self.minimum_channel_share * len(self.channels) > Decimal("1"):
            raise ValueError("minimum channel shares cannot exceed the available budget")
        return self


class BudgetAllocationRecommendation(StrictModel):
    channel_id: UUID
    current_share: Decimal
    recommended_share: Decimal
    share_change: Decimal
    expected_customer_value_per_currency_unit: Decimal
    risk_adjusted_score: Decimal
    reasoning: str


class BudgetOptimizationResult(StrictModel):
    campaign_id: UUID
    currency: str
    total_budget: Decimal
    current_expected_revenue: Decimal
    recommended_expected_revenue: Decimal
    expected_revenue_impact: Decimal
    allocations: list[BudgetAllocationRecommendation]
    warnings: list[str]


def optimize_channel_budget(request: BudgetOptimizationRequest) -> BudgetOptimizationResult:
    """Return an advisory allocation from aggregate assumptions; never mutate spend."""

    unit_values = [
        channel.lead_to_customer_rate * channel.customer_lifetime_value / channel.cost_per_lead
        for channel in request.channels
    ]
    scores = [
        value * (Decimal("1") - channel.risk_score)
        for value, channel in zip(unit_values, request.channels)
    ]
    score_total = sum(scores, Decimal("0"))
    distributable = Decimal("1") - request.minimum_channel_share * len(request.channels)
    if score_total == 0:
        neutral_share = Decimal("1") / Decimal(len(request.channels))
        recommended = [neutral_share for _channel in request.channels]
    else:
        recommended = [
            request.minimum_channel_share + distributable * score / score_total
            for score in scores
        ]

    rounded = [share.quantize(RATE, rounding=ROUND_HALF_UP) for share in recommended]
    rounded[-1] += Decimal("1") - sum(rounded, Decimal("0"))
    current_revenue = request.total_budget * sum(
        (channel.budget_share * value for channel, value in zip(request.channels, unit_values)),
        Decimal("0"),
    )
    recommended_revenue = request.total_budget * sum(
        (share * value for share, value in zip(rounded, unit_values)),
        Decimal("0"),
    )
    allocations = []
    for channel, share, unit_value, score in zip(request.channels, rounded, unit_values, scores):
        change = share - channel.budget_share
        direction = "increase" if change > 0 else "decrease" if change < 0 else "hold"
        allocations.append(
            BudgetAllocationRecommendation(
                channel_id=channel.channel_id,
                current_share=channel.budget_share,
                recommended_share=share,
                share_change=change,
                expected_customer_value_per_currency_unit=unit_value.quantize(RATE, rounding=ROUND_HALF_UP),
                risk_adjusted_score=score.quantize(RATE, rounding=ROUND_HALF_UP),
                reasoning=f"{direction} based on aggregate conversion, lifetime value, cost per lead, and channel risk assumptions",
            )
        )
    return BudgetOptimizationResult(
        campaign_id=request.campaign_id,
        currency=request.currency,
        total_budget=request.total_budget,
        current_expected_revenue=current_revenue.quantize(MONEY, rounding=ROUND_HALF_UP),
        recommended_expected_revenue=recommended_revenue.quantize(MONEY, rounding=ROUND_HALF_UP),
        expected_revenue_impact=(recommended_revenue - current_revenue).quantize(MONEY, rounding=ROUND_HALF_UP),
        allocations=allocations,
        warnings=[
            "Advisory result only; no advertising platform or live budget was changed.",
            "Scores use supplied aggregate assumptions and must be reviewed for attribution bias, uncertainty, and channel constraints.",
        ],
    )


class MarketingSimulationRequest(StrictModel):
    campaign_id: UUID
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    total_budget: Decimal = Field(gt=0, max_digits=20, decimal_places=4)
    baseline: list[ChannelPlan] = Field(min_length=1, max_length=50)
    scenario: list[ChannelPlan] = Field(min_length=1, max_length=50)

    @field_validator("baseline", "scenario")
    @classmethod
    def allocations_total_one(cls, values: list[ChannelPlan]) -> list[ChannelPlan]:
        if len({item.channel_id for item in values}) != len(values):
            raise ValueError("channel allocations must be unique")
        if abs(sum((item.budget_share for item in values), Decimal("0")) - Decimal("1")) > RATE:
            raise ValueError("channel budget shares must total one")
        return values

    @model_validator(mode="after")
    def same_channels(self) -> "MarketingSimulationRequest":
        if {item.channel_id for item in self.baseline} != {item.channel_id for item in self.scenario}:
            raise ValueError("baseline and scenario must contain the same channels")
        return self


class MarketingSimulationResult(StrictModel):
    baseline_leads: Decimal
    scenario_leads: Decimal
    lead_change: Decimal
    baseline_customers: Decimal
    scenario_customers: Decimal
    customer_change: Decimal
    baseline_revenue: Decimal
    scenario_revenue: Decimal
    revenue_impact: Decimal
    baseline_risk: Decimal
    scenario_risk: Decimal
    risk_change: Decimal
    warnings: list[str]


def simulate_channel_mix(request: MarketingSimulationRequest) -> MarketingSimulationResult:
    def calculate(plans: list[ChannelPlan]) -> tuple[Decimal, Decimal, Decimal, Decimal]:
        leads = customers = revenue = weighted_risk = Decimal("0")
        for channel in plans:
            budget = request.total_budget * channel.budget_share
            channel_leads = budget / channel.cost_per_lead
            channel_customers = channel_leads * channel.lead_to_customer_rate
            leads += channel_leads
            customers += channel_customers
            revenue += channel_customers * channel.customer_lifetime_value
            weighted_risk += channel.budget_share * channel.risk_score
        return tuple(item.quantize(RATE, rounding=ROUND_HALF_UP) for item in (leads, customers, revenue, weighted_risk))  # type: ignore[return-value]

    base = calculate(request.baseline); scenario = calculate(request.scenario)
    return MarketingSimulationResult(
        baseline_leads=base[0], scenario_leads=scenario[0], lead_change=scenario[0] - base[0],
        baseline_customers=base[1], scenario_customers=scenario[1], customer_change=scenario[1] - base[1],
        baseline_revenue=base[2], scenario_revenue=scenario[2], revenue_impact=scenario[2] - base[2],
        baseline_risk=base[3], scenario_risk=scenario[3], risk_change=scenario[3] - base[3],
        warnings=["Conditional scenario output; channel response and lifetime value are supplied assumptions, not causal estimates.", "No advertising platform or live budget was changed."],
    )


class ProcessObservation(StrictModel):
    case_id: str = Field(min_length=1, max_length=200)
    steps: list[str] = Field(min_length=1, max_length=100)
    step_duration_hours: dict[str, Decimal] = Field(default_factory=dict, max_length=100)
    owners: dict[str, UUID | None] = Field(default_factory=dict, max_length=100)


class MarketingRealityCheck(StrictModel):
    documented_steps: list[str]
    observed_case_count: int
    missing_documented_steps: list[str]
    hidden_steps: list[str]
    bottlenecks: list[str]
    missing_ownership: list[str]
    conformance_rate: Decimal


def compare_marketing_process(documented_steps: list[str], observations: list[ProcessObservation], bottleneck_hours: Decimal = Decimal("24")) -> MarketingRealityCheck:
    if not documented_steps or len(documented_steps) != len(set(documented_steps)) or not observations:
        raise ValueError("documented steps and observations are required and must be unique")
    documented = set(documented_steps)
    actual = {step for case in observations for step in case.steps}
    conforming = sum(1 for case in observations if [step for step in case.steps if step in documented] == [step for step in documented_steps if step in case.steps])
    durations: dict[str, list[Decimal]] = {}
    for case in observations:
        for step, duration in case.step_duration_hours.items():
            if duration < 0:
                raise ValueError("step duration cannot be negative")
            durations.setdefault(step, []).append(duration)
    return MarketingRealityCheck(
        documented_steps=documented_steps,
        observed_case_count=len(observations),
        missing_documented_steps=sorted(documented - actual),
        hidden_steps=sorted(actual - documented),
        bottlenecks=sorted(step for step, values in durations.items() if sum(values) / len(values) > bottleneck_hours),
        missing_ownership=sorted({step for case in observations for step in case.steps if case.owners.get(step) is None}),
        conformance_rate=(Decimal(conforming) / Decimal(len(observations))).quantize(RATE, rounding=ROUND_HALF_UP),
    )
