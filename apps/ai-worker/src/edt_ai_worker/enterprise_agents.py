"""Versioned enterprise analyst profiles; authority is data, never prompt text."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class MemoryScope(str, Enum):
    SESSION = "session"
    VALIDATED_TENANT = "validated_tenant"


@dataclass(frozen=True)
class AnalystProfile:
    profile_id: str
    version: int
    purpose: str
    tools: tuple[str, ...]
    permissions: tuple[str, ...]
    memory: tuple[MemoryScope, ...]
    skills: tuple[str, ...]
    loops: tuple[str, ...]
    graph_node_types: tuple[str, ...]
    mutation_authority: bool = False


ANALYST_PROFILES = {
    "financial_analyst": AnalystProfile(
        "financial_analyst", 1,
        "Explain revenue, cost, cash flow, profit, ROI, forecasts, and financial stability from authorized company graph evidence.",
        ("graph.read", "financial.calculate", "simulation.propose", "knowledge.search"),
        ("ai.run.financial", "graph.read.financial", "simulation.create"),
        (MemoryScope.SESSION, MemoryScope.VALIDATED_TENANT),
        ("financial_health_review", "financial_forecast", "investment_roi"),
        ("daily_predictions", "monthly_forecasts"),
        ("RevenueStream", "Expense", "Budget", "Asset", "Investment", "Contract", "Invoice", "Payment", "Customer", "Employee", "Project", "Vendor"),
    ),
    "operations_analyst": AnalystProfile(
        "operations_analyst", 1,
        "Find operational constraints, dependencies, capacity risks, and evidenced inefficiencies in the company graph.",
        ("graph.read", "operations.calculate", "simulation.propose", "knowledge.search"),
        ("ai.run.operations", "graph.read.operations", "simulation.create"),
        (MemoryScope.SESSION, MemoryScope.VALIDATED_TENANT),
        ("operations_health_review", "inefficiency_discovery", "capacity_scenario"),
        ("daily_refresh", "weekly_inefficiencies"),
        ("Department", "Employee", "Project", "Asset", "Machine", "ProductionLine", "Supplier", "Inventory", "QualityIssue"),
    ),
    "risk_analyst": AnalystProfile(
        "risk_analyst", 1,
        "Identify, trace, and explain financial, operational, customer, market, regulatory, and dependency risks.",
        ("graph.read", "risk.calculate", "simulation.propose", "knowledge.search"),
        ("ai.run.risk", "graph.read.risk", "simulation.create"),
        (MemoryScope.SESSION, MemoryScope.VALIDATED_TENANT),
        ("risk_register_refresh", "dependency_risk", "market_impact"),
        ("daily_risk_check", "monthly_scenarios"),
        ("Risk", "Contract", "Customer", "Vendor", "Competitor", "Market", "Regulation", "EconomicFactor", "Asset", "Project"),
    ),
}


def require_profile(profile_id: str) -> AnalystProfile:
    try:
        return ANALYST_PROFILES[profile_id]
    except KeyError as exc:
        raise ValueError("unknown_agent_profile") from exc
