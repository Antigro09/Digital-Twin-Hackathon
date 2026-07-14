from __future__ import annotations

from collections import deque
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import ValidationError

from .canonical import hash_without
from .errors import DomainError
from .models import Calendar, Scenario, SimulationSnapshot
from .tenancy import TenantContext


MAX_TASKS = 500
MAX_DEPENDENCIES = 5_000


def _model_error(code: str, exc: ValidationError) -> DomainError:
    return DomainError(code, "The payload failed structural validation.", details={"errors": exc.errors(include_url=False)})


def seal_snapshot(payload: dict[str, Any], context: TenantContext) -> SimulationSnapshot:
    raw = dict(payload)
    try:
        raw_tenant = UUID(str(raw.get("tenant_id")))
    except (ValueError, TypeError, AttributeError) as exc:
        raise DomainError("invalid_snapshot", "Snapshot tenant_id is missing or invalid.") from exc
    context.require_binding(raw_tenant, "snapshot")
    # Set-valued collections are normalized before hashing so semantically equal
    # snapshots are invariant to connector/list ordering.
    raw["tasks"] = sorted(
        (
            {**task, "evidence_ids": sorted(task.get("evidence_ids", []))}
            for task in raw.get("tasks", [])
        ),
        key=lambda task: str(task.get("work_item_id", "")),
    )
    raw["dependencies"] = sorted(
        (
            {**edge, "evidence_ids": sorted(edge.get("evidence_ids", []))}
            for edge in raw.get("dependencies", [])
        ),
        key=lambda edge: (
            str(edge.get("predecessor_work_item_id", "")),
            str(edge.get("successor_work_item_id", "")),
            str(edge.get("source_relationship_id", "")),
        ),
    )
    raw["team_capacities"] = sorted(
        (
            {**team, "evidence_ids": sorted(team.get("evidence_ids", []))}
            for team in raw.get("team_capacities", [])
        ),
        key=lambda team: str(team.get("team_id", "")),
    )
    raw["evidence_ids"] = sorted(raw.get("evidence_ids", []))
    raw["assumptions"] = sorted(set(raw.get("assumptions", [])))
    raw["warnings"] = sorted(set(raw.get("warnings", [])))
    calendar_raw = dict(raw.get("calendar") or {})
    calendar_raw["working_weekdays"] = sorted(set(calendar_raw.get("working_weekdays", [])))
    calendar_raw["holidays"] = sorted(set(calendar_raw.get("holidays", [])))
    calendar_raw["canonical_sha256"] = "0" * 64
    try:
        provisional_calendar = Calendar.model_validate(calendar_raw)
    except ValidationError as exc:
        raise _model_error("invalid_calendar", exc) from exc
    calendar_raw["canonical_sha256"] = hash_without(provisional_calendar, "canonical_sha256")
    raw["calendar"] = calendar_raw
    raw["canonical_sha256"] = "0" * 64
    try:
        provisional = SimulationSnapshot.model_validate(raw)
    except ValidationError as exc:
        raise _model_error("invalid_snapshot", exc) from exc
    raw["canonical_sha256"] = hash_without(provisional, "canonical_sha256")
    try:
        sealed = SimulationSnapshot.model_validate(raw)
    except ValidationError as exc:
        raise _model_error("invalid_snapshot", exc) from exc
    validate_snapshot(sealed, context)
    return sealed


def parse_snapshot(payload: SimulationSnapshot | dict[str, Any], context: TenantContext) -> SimulationSnapshot:
    try:
        snapshot = payload if isinstance(payload, SimulationSnapshot) else SimulationSnapshot.model_validate(payload)
    except ValidationError as exc:
        raise _model_error("invalid_snapshot", exc) from exc
    validate_snapshot(snapshot, context)
    return snapshot


def validate_snapshot(snapshot: SimulationSnapshot, context: TenantContext) -> list[str]:
    context.require_binding(snapshot.tenant_id, "snapshot")
    if hash_without(snapshot.calendar, "canonical_sha256") != snapshot.calendar.canonical_sha256:
        raise DomainError("calendar_hash_mismatch", "Calendar content does not match its sealed hash.")
    if hash_without(snapshot, "canonical_sha256") != snapshot.canonical_sha256:
        raise DomainError("snapshot_hash_mismatch", "Snapshot content does not match its sealed hash.")
    try:
        ZoneInfo(snapshot.timezone)
    except ZoneInfoNotFoundError as exc:
        raise DomainError("invalid_calendar", f"Unknown IANA timezone: {snapshot.timezone}") from exc
    if len(snapshot.tasks) > MAX_TASKS or len(snapshot.dependencies) > MAX_DEPENDENCIES:
        raise DomainError(
            "simulation_too_large",
            "Snapshot exceeds the bounded H1 simulation shape.",
            status_code=413,
            details={
                "tasks": len(snapshot.tasks),
                "task_limit": MAX_TASKS,
                "dependencies": len(snapshot.dependencies),
                "dependency_limit": MAX_DEPENDENCIES,
            },
        )
    if not snapshot.tasks and (snapshot.dependencies or snapshot.team_capacities):
        raise DomainError("invalid_empty_project", "An empty project requires empty dependencies and capacities.")
    if snapshot.sealed_at < snapshot.as_of:
        raise DomainError("invalid_seal_time", "sealed_at cannot precede as_of.")

    tasks = {task.work_item_id: task for task in snapshot.tasks}
    if len(tasks) != len(snapshot.tasks):
        raise DomainError("duplicate_work_item", "Snapshot contains duplicate work-item IDs.")
    teams = {team.team_id: team for team in snapshot.team_capacities}
    if len(teams) != len(snapshot.team_capacities):
        raise DomainError("duplicate_team_capacity", "Snapshot contains duplicate team IDs.")
    for task in snapshot.tasks:
        if task.state == "completed" and task.actual_finish and task.actual_finish > snapshot.as_of:
            raise DomainError("invalid_actual_finish", f"Completed task {task.work_item_id} finishes after as_of.")
        if task.state not in ("completed", "cancelled") and task.team_id not in teams:
            raise DomainError("invalid_team_capacity", f"Task {task.work_item_id} has no sealed team capacity.")

    adjacency: dict[UUID, set[UUID]] = {task_id: set() for task_id in tasks}
    duplicate_pairs: set[tuple[UUID, UUID]] = set()
    seen_pairs: set[tuple[UUID, UUID]] = set()
    for edge in snapshot.dependencies:
        before = edge.predecessor_work_item_id
        after = edge.successor_work_item_id
        if before not in tasks or after not in tasks:
            raise DomainError(
                "unknown_task_reference",
                "Dependency refers to a task outside the sealed snapshot.",
                details={"predecessor": str(before), "successor": str(after)},
            )
        if before == after:
            raise DomainError("invalid_dependency_cycle", "A self-dependency is not allowed.", details={"cycle": [str(before), str(before)]})
        if tasks[before].state == "cancelled" or tasks[after].state == "cancelled":
            raise DomainError("unresolved_cancelled_work", "Cancelled tasks cannot retain active dependencies.")
        pair = (before, after)
        if pair in seen_pairs:
            duplicate_pairs.add(pair)
        seen_pairs.add(pair)
        adjacency[before].add(after)

    cycle = _find_cycle(adjacency)
    if cycle:
        raise DomainError(
            "invalid_dependency_cycle",
            "Dependency graph contains a cycle.",
            details={"cycle": [str(item) for item in cycle]},
        )

    warnings = list(snapshot.warnings)
    for before, after in sorted(duplicate_pairs, key=lambda pair: (pair[0].bytes, pair[1].bytes)):
        warnings.append(f"duplicate_dependency_greatest_lag_retained:{before}:{after}")
    if snapshot.target_date and snapshot.target_date < snapshot.project_start.astimezone(ZoneInfo(snapshot.timezone)).date():
        warnings.append("target_precedes_project_start")
    return sorted(set(warnings))


def validate_scenario(scenario: Scenario, snapshot: SimulationSnapshot, context: TenantContext) -> None:
    context.require_binding(scenario.tenant_id, "scenario")
    if scenario.snapshot_id != snapshot.snapshot_id or scenario.snapshot_hash != snapshot.canonical_sha256:
        raise DomainError("scenario_snapshot_mismatch", "Scenario does not bind the supplied sealed snapshot.")
    if scenario.model_version != snapshot.simulation_model_version:
        raise DomainError("scenario_model_mismatch", "Scenario model version differs from the snapshot.")
    if scenario.calendar_version != snapshot.calendar.version:
        raise DomainError("scenario_calendar_mismatch", "Scenario calendar version differs from the snapshot.")
    if hash_without(scenario, "scenario_digest") != scenario.scenario_digest:
        raise DomainError("scenario_hash_mismatch", "Scenario content does not match its confirmed digest.")


def _find_cycle(adjacency: dict[UUID, set[UUID]]) -> list[UUID] | None:
    """Find a deterministic shortest directed cycle for diagnostics."""

    best: list[UUID] | None = None
    for start in sorted(adjacency, key=lambda item: item.bytes):
        queue: deque[tuple[UUID, list[UUID]]] = deque((child, [start, child]) for child in sorted(adjacency[start], key=lambda item: item.bytes))
        visited_depth: dict[UUID, int] = {start: 0}
        while queue:
            node, path = queue.popleft()
            if best is not None and len(path) >= len(best):
                continue
            if node == start:
                best = path
                break
            depth = len(path)
            if depth >= visited_depth.get(node, 1 << 30):
                continue
            visited_depth[node] = depth
            for child in sorted(adjacency[node], key=lambda item: item.bytes):
                queue.append((child, path + [child]))
    return best
