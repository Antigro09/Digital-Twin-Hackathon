"""Deterministic financial and market intelligence over graph-derived inputs."""

from __future__ import annotations

from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from .models import StrictModel


FinancialNodeType = Literal["RevenueStream", "Expense", "Budget", "Asset", "Investment", "Contract", "Invoice", "Payment"]
ExternalNodeType = Literal["Customer", "Competitor", "Market", "IndustryTrend", "Regulation", "EconomicFactor"]

FINANCIAL_RELATIONSHIPS = (
    ("Customer", "HAS_CONTRACT", "Contract"),
    ("Contract", "GENERATES", "RevenueStream"),
    ("RevenueStream", "CONTRIBUTES_TO", "Profit"),
    ("Employee", "INCURS", "Expense"),
    ("Expense", "ALLOCATED_TO", "Department"),
    ("Department", "DELIVERS", "Project"),
)

MARKET_IMPACT_PATH = ("Market", "Customer", "RevenueStream", "Risk")


class Money(StrictModel):
    amount: Decimal = Field(max_digits=20, decimal_places=4)
    currency: str = Field(pattern=r"^[A-Z]{3}$")


class CashFlowPeriod(StrictModel):
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    revenue: Money
    expenses: Money
    investments: Money | None = None

    @model_validator(mode="after")
    def one_currency(self) -> "CashFlowPeriod":
        currencies = {self.revenue.currency, self.expenses.currency}
        if self.investments is not None:
            currencies.add(self.investments.currency)
        if len(currencies) != 1:
            raise ValueError("currency conversion must occur before aggregation")
        return self


class FinancialMetrics(StrictModel):
    currency: str
    revenue: Decimal
    expenses: Decimal
    operating_profit: Decimal
    net_cash_flow: Decimal
    profit_margin: Decimal | None
    roi: Decimal | None


def calculate_financial_metrics(periods: list[CashFlowPeriod]) -> FinancialMetrics:
    if not periods:
        raise ValueError("financial periods are required")
    currencies = {item.revenue.currency for item in periods}
    if len(currencies) != 1:
        raise ValueError("currency conversion must occur before aggregation")
    revenue = sum((item.revenue.amount for item in periods), Decimal("0"))
    expenses = sum((item.expenses.amount for item in periods), Decimal("0"))
    investments = sum((item.investments.amount for item in periods if item.investments is not None), Decimal("0"))
    profit = revenue - expenses
    return FinancialMetrics(
        currency=next(iter(currencies)),
        revenue=revenue,
        expenses=expenses,
        operating_profit=profit,
        net_cash_flow=profit - investments,
        profit_margin=(profit / revenue).quantize(Decimal("0.0001")) if revenue else None,
        roi=((profit - investments) / investments).quantize(Decimal("0.0001")) if investments else None,
    )


class CustomerEconomics(StrictModel):
    customer_id: UUID
    revenue: Money
    direct_cost: Money
    service_cost: Money
    churn_probability: Decimal = Field(ge=0, le=1, decimal_places=6)

    @model_validator(mode="after")
    def one_currency(self) -> "CustomerEconomics":
        if len({self.revenue.currency, self.direct_cost.currency, self.service_cost.currency}) != 1:
            raise ValueError("customer economics require one normalized currency")
        return self


class CustomerProfitability(StrictModel):
    customer_id: UUID
    currency: str
    contribution: Decimal
    margin: Decimal | None
    revenue_at_risk: Decimal


def customer_profitability(value: CustomerEconomics) -> CustomerProfitability:
    contribution = value.revenue.amount - value.direct_cost.amount - value.service_cost.amount
    return CustomerProfitability(
        customer_id=value.customer_id,
        currency=value.revenue.currency,
        contribution=contribution,
        margin=(contribution / value.revenue.amount).quantize(Decimal("0.0001")) if value.revenue.amount else None,
        revenue_at_risk=(value.revenue.amount * value.churn_probability).quantize(Decimal("0.01")),
    )


class MarketShock(StrictModel):
    market_id: UUID
    factor: Decimal = Field(gt=Decimal("-1"), le=10)
    exposed_revenue: Money
    dependency_probability: Decimal = Field(ge=0, le=1)


class MarketImpact(StrictModel):
    currency: str
    expected_revenue_change: Decimal
    expected_revenue_at_risk: Decimal
    path: tuple[str, ...] = MARKET_IMPACT_PATH


def market_impact(value: MarketShock) -> MarketImpact:
    change = (value.exposed_revenue.amount * value.factor).quantize(Decimal("0.01"))
    return MarketImpact(
        currency=value.exposed_revenue.currency,
        expected_revenue_change=change,
        expected_revenue_at_risk=(abs(change) * value.dependency_probability).quantize(Decimal("0.01")),
    )
