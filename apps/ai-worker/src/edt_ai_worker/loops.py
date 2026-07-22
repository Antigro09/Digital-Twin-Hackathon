"""Bounded autonomous intelligence loop catalog and lease keys."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from uuid import UUID, uuid5


_LOOP_NAMESPACE = UUID("4c45fe39-30ef-43aa-bc14-cfd790166cbf")


class Cadence(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


@dataclass(frozen=True)
class IntelligenceLoop:
    loop_id: str
    cadence: Cadence
    skills: tuple[str, ...]
    required_permissions: tuple[str, ...]
    mutation_authority: bool = False

    def run_id(self, tenant_id: UUID, period: date) -> UUID:
        return uuid5(_LOOP_NAMESPACE, f"{tenant_id}:{self.loop_id}:{period.isoformat()}")


LOOPS = {
    "daily_refresh": IntelligenceLoop("daily_refresh", Cadence.DAILY, ("data_refresh", "graph_projection", "risk_register_refresh", "prediction_refresh"), ("loop.execute", "graph.read")),
    "weekly_inefficiencies": IntelligenceLoop("weekly_inefficiencies", Cadence.WEEKLY, ("inefficiency_discovery", "recommendation_generation"), ("loop.execute", "graph.read")),
    "monthly_forecasts": IntelligenceLoop("monthly_forecasts", Cadence.MONTHLY, ("financial_forecast", "scenario_batch"), ("loop.execute", "graph.read", "simulation.create")),
}


def authorize_loop(loop_id: str, permissions: set[str]) -> IntelligenceLoop:
    loop = LOOPS.get(loop_id)
    if loop is None:
        raise ValueError("loop_not_found")
    if not set(loop.required_permissions).issubset(permissions):
        raise PermissionError("loop_permission_denied")
    return loop
