from __future__ import annotations

import math
import random
import statistics
from array import array
from dataclasses import dataclass, replace
from datetime import date, datetime, timezone
from typing import Iterable
from uuid import UUID, uuid4

from .calendar_math import WorkingCalendar
from .canonical import CounterStream, sha256_hex
from .errors import DomainError
from .models import (
    AddDependency,
    BlockerItem,
    ChangeTeamCapacity,
    Comparison,
    CriticalityItem,
    MarkTaskCompleted,
    QuantileForecast,
    RemoveDependency,
    RemoveScope,
    ResolveExternalBlocker,
    Scenario,
    SensitivityItem,
    SetDurationEstimate,
    SetEarliestStart,
    ShiftCompletionDistribution,
    SimulationRequest,
    SimulationResult,
    SimulationSnapshot,
    Uncertainty,
)
from .snapshot import parse_snapshot, validate_scenario
from .tenancy import TenantContext


ENGINE_VERSION = "pert-mt19937-beta/2.0.0"
COUNTER_STREAM_COMPAT_VERSION = "pert-sha256-counter-gamma/1.0.0"
MAX_SENSITIVITY_SERIES = 64
MAX_BLOCKER_COUNTERFACTUALS = 5
# A non-working gap contains no working duration, but civil instants on either
# side must still be ordered. This epsilon encodes a phase inside that collapsed
# gap without changing any six-decimal workday result.
BOUNDARY_PHASE_EPSILON = 1e-9
SampleCache = dict[tuple[UUID, float, float], array]


@dataclass(frozen=True)
class PlanTask:
    task_id: UUID
    team_id: UUID
    state: str
    optimistic: float
    most_likely: float
    pessimistic: float
    estimate_source: str
    earliest_start: datetime | None
    actual_finish: datetime | None
    external_blocker: bool
    external_blocker_until: datetime | None
    evidence_ids: tuple[UUID, ...]


@dataclass(frozen=True)
class PlanEdge:
    predecessor: UUID
    successor: UUID
    lag: float
    evidence_ids: tuple[UUID, ...]


@dataclass(frozen=True)
class PlanTeam:
    team_id: UUID
    capacity: int
    availability: float
    evidence_ids: tuple[UUID, ...]


@dataclass(frozen=True)
class ExecutionPlan:
    snapshot: SimulationSnapshot
    tasks: dict[UUID, PlanTask]
    edges: tuple[PlanEdge, ...]
    teams: dict[UUID, PlanTeam]
    target_date: date | None
    warnings: tuple[str, ...]
    scenario: Scenario | None = None


@dataclass
class IterationSchedule:
    project_finish: "WorkInstant"
    critical_chain: tuple[UUID, ...]
    sampled_durations: dict[UUID, float]


@dataclass
class SampleCollection:
    finishes: array
    critical_counts: dict[UUID, int]
    duration_series: dict[UUID, array]
    p80_path: tuple[UUID, ...]


@dataclass(frozen=True)
class PreparedSchedule:
    base: datetime
    active_tasks: dict[UUID, PlanTask]
    active_task_ids: tuple[UUID, ...]
    team_slot_counts: dict[UUID, int]
    releases: dict[UUID, "WorkInstant"]
    completed_finishes: dict[UUID, "WorkInstant"]
    predecessor_edges: dict[UUID, tuple[PlanEdge, ...]]


@dataclass(frozen=True)
class WorkInstant:
    workdays: float
    gap_phase: float = 0.0

    def key(self) -> tuple[float, float]:
        return (self.workdays, self.gap_phase)

    def encoded(self) -> float:
        return self.workdays + self.gap_phase * BOUNDARY_PHASE_EPSILON

    def advance(self, duration_workdays: float) -> "WorkInstant":
        if duration_workdays == 0:
            return self
        return WorkInstant(self.workdays + duration_workdays, 0.0)


def _round6(value: float) -> float:
    result = round(value, 6)
    return 0.0 if result == 0 else result


def _quantile(values: Iterable[float], q: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("quantile requires at least one value")
    if len(ordered) == 1:
        return float(ordered[0])
    h = (len(ordered) - 1) * q
    lower = math.floor(h)
    fraction = h - lower
    upper = min(lower + 1, len(ordered) - 1)
    return (1.0 - fraction) * ordered[lower] + fraction * ordered[upper]


def _build_plan(snapshot: SimulationSnapshot, scenario: Scenario | None) -> ExecutionPlan:
    tasks = {
        task.work_item_id: PlanTask(
            task_id=task.work_item_id,
            team_id=task.team_id,
            state=task.state,
            optimistic=task.remaining_duration.optimistic,
            most_likely=task.remaining_duration.most_likely,
            pessimistic=task.remaining_duration.pessimistic,
            estimate_source=task.remaining_duration.source,
            earliest_start=task.earliest_start,
            actual_finish=task.actual_finish,
            external_blocker=task.external_blocker,
            external_blocker_until=task.external_blocker_until,
            evidence_ids=tuple(task.evidence_ids),
        )
        for task in snapshot.tasks
    }
    # Duplicate source edges retain the greatest lag with a deterministic tie.
    edge_map: dict[tuple[UUID, UUID], PlanEdge] = {}
    for edge in snapshot.dependencies:
        key = (edge.predecessor_work_item_id, edge.successor_work_item_id)
        candidate = PlanEdge(key[0], key[1], edge.lag_workdays, tuple(edge.evidence_ids))
        existing = edge_map.get(key)
        if existing is None or candidate.lag > existing.lag:
            edge_map[key] = candidate
    teams = {
        team.team_id: PlanTeam(team.team_id, team.parallel_capacity, team.availability, tuple(team.evidence_ids))
        for team in snapshot.team_capacities
    }
    warnings = list(snapshot.warnings)
    if len(edge_map) != len(snapshot.dependencies):
        warnings.append("duplicate_dependency_greatest_lag_retained")
    if snapshot.target_date and snapshot.target_date < snapshot.project_start.astimezone(
        WorkingCalendar(snapshot.timezone, snapshot.calendar).zone
    ).date():
        warnings.append("target_precedes_project_start")
    target = snapshot.target_date

    if scenario is not None:
        seen_operations: set[tuple[str, UUID | tuple[UUID, UUID]]] = set()
        per_task_operation_count: dict[UUID, int] = {}
        removed_tasks = {
            operation.work_item_id
            for operation in scenario.interventions
            if isinstance(operation, RemoveScope)
        }
        for operation in scenario.interventions:
            task_id = getattr(operation, "work_item_id", None)
            if task_id is not None:
                per_task_operation_count[task_id] = per_task_operation_count.get(task_id, 0) + 1
        if any(per_task_operation_count.get(task_id, 0) > 1 for task_id in removed_tasks):
            raise DomainError("contradictory_interventions", "Removed scope cannot receive another intervention.")
        for operation in scenario.interventions:
            if isinstance(operation, (SetDurationEstimate, ShiftCompletionDistribution)):
                key: tuple[str, UUID | tuple[UUID, UUID]] = ("duration", operation.work_item_id)
                task = tasks.get(operation.work_item_id)
                if task is None:
                    raise DomainError("unknown_task_reference", f"Scenario references unknown task {operation.work_item_id}.")
            elif isinstance(operation, SetEarliestStart):
                key = ("earliest_start", operation.work_item_id)
                task = tasks.get(operation.work_item_id)
                if task is None:
                    raise DomainError("unknown_task_reference", f"Scenario references unknown task {operation.work_item_id}.")
            elif isinstance(operation, RemoveScope):
                key = ("scope", operation.work_item_id)
                task = tasks.get(operation.work_item_id)
                if task is None:
                    raise DomainError("unknown_task_reference", f"Scenario references unknown task {operation.work_item_id}.")
            elif isinstance(operation, ResolveExternalBlocker):
                key = ("blocker", operation.work_item_id)
                task = tasks.get(operation.work_item_id)
                if task is None:
                    raise DomainError("unknown_task_reference", f"Scenario references unknown task {operation.work_item_id}.")
            elif isinstance(operation, MarkTaskCompleted):
                key = ("completion", operation.work_item_id)
                task = tasks.get(operation.work_item_id)
                if task is None:
                    raise DomainError("unknown_task_reference", f"Scenario references unknown task {operation.work_item_id}.")
            elif isinstance(operation, (AddDependency, RemoveDependency)):
                key = ("dependency", (operation.predecessor_work_item_id, operation.successor_work_item_id))
            else:
                key = ("capacity", operation.team_id)
            if key in seen_operations:
                raise DomainError("contradictory_interventions", f"Scenario repeats intervention target {key}.")
            seen_operations.add(key)

            if isinstance(operation, SetDurationEstimate):
                tasks[operation.work_item_id] = replace(
                    task,
                    optimistic=operation.optimistic_days,
                    most_likely=operation.most_likely_days,
                    pessimistic=operation.pessimistic_days,
                )
            elif isinstance(operation, ShiftCompletionDistribution):
                shifted = (
                    task.optimistic + operation.delta_workdays,
                    task.most_likely + operation.delta_workdays,
                    task.pessimistic + operation.delta_workdays,
                )
                if shifted[0] < 0 or shifted[2] > 1300:
                    raise DomainError("invalid_duration", "A shifted scenario duration is outside H1 bounds.")
                tasks[operation.work_item_id] = replace(
                    task, optimistic=shifted[0], most_likely=shifted[1], pessimistic=shifted[2]
                )
            elif isinstance(operation, SetEarliestStart):
                tasks[operation.work_item_id] = replace(task, earliest_start=operation.earliest_start)
            elif isinstance(operation, AddDependency):
                before, after = operation.predecessor_work_item_id, operation.successor_work_item_id
                if before not in tasks or after not in tasks:
                    raise DomainError("unknown_task_reference", "Added dependency has an unknown endpoint.")
                if before == after:
                    raise DomainError("invalid_dependency_cycle", "Added dependency is a self-edge.")
                edge_map[(before, after)] = PlanEdge(before, after, operation.lag_workdays, ())
            elif isinstance(operation, RemoveDependency):
                edge_map.pop((operation.predecessor_work_item_id, operation.successor_work_item_id), None)
            elif isinstance(operation, RemoveScope):
                tasks.pop(operation.work_item_id)
                edge_map = {
                    pair: edge
                    for pair, edge in edge_map.items()
                    if operation.work_item_id not in pair
                }
            elif isinstance(operation, ChangeTeamCapacity):
                team = teams.get(operation.team_id)
                if team is None:
                    raise DomainError("invalid_team_capacity", f"Unknown scenario team {operation.team_id}.")
                new_capacity = team.capacity + operation.capacity_delta
                if new_capacity < 1 or new_capacity > 100:
                    raise DomainError("invalid_team_capacity", "Scenario capacity delta produces an invalid capacity.")
                teams[operation.team_id] = replace(team, capacity=new_capacity)
            elif isinstance(operation, ResolveExternalBlocker):
                tasks[operation.work_item_id] = replace(
                    task,
                    external_blocker=False,
                    external_blocker_until=operation.resolution_date,
                )
            elif isinstance(operation, MarkTaskCompleted):
                if operation.actual_finish > snapshot.as_of:
                    raise DomainError("invalid_actual_finish", "Scenario completion is after snapshot as_of.")
                tasks[operation.work_item_id] = replace(
                    task,
                    state="completed",
                    optimistic=0,
                    most_likely=0,
                    pessimistic=0,
                    actual_finish=operation.actual_finish,
                )
        target = scenario.target_date
        warnings.extend(
            assumption.statement
            for assumption in scenario.assumptions
            if assumption.status in ("missing", "contested")
        )

    _validate_plan(tasks, edge_map.values(), teams)
    return ExecutionPlan(
        snapshot=snapshot,
        tasks=tasks,
        edges=tuple(sorted(edge_map.values(), key=lambda edge: (edge.predecessor.bytes, edge.successor.bytes))),
        teams=teams,
        target_date=target,
        warnings=tuple(sorted(set(warnings))),
        scenario=scenario,
    )


def _validate_plan(tasks: dict[UUID, PlanTask], edges: Iterable[PlanEdge], teams: dict[UUID, PlanTeam]) -> None:
    adjacency = {task_id: set() for task_id in tasks}
    indegree = {task_id: 0 for task_id in tasks}
    for edge in edges:
        if edge.predecessor not in tasks or edge.successor not in tasks:
            raise DomainError("unknown_task_reference", "Compiled scenario dependency has an unknown endpoint.")
        if edge.predecessor == edge.successor:
            raise DomainError("invalid_dependency_cycle", "Compiled scenario contains a self-edge.")
        if tasks[edge.predecessor].state == "cancelled" or tasks[edge.successor].state == "cancelled":
            raise DomainError("unresolved_cancelled_work", "Cancelled tasks cannot retain active dependencies.")
        if edge.successor not in adjacency[edge.predecessor]:
            adjacency[edge.predecessor].add(edge.successor)
            indegree[edge.successor] += 1
    queue = sorted((task_id for task_id, count in indegree.items() if count == 0), key=lambda value: value.bytes)
    visited = 0
    while queue:
        node = queue.pop(0)
        visited += 1
        for child in sorted(adjacency[node], key=lambda value: value.bytes):
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)
                queue.sort(key=lambda value: value.bytes)
    if visited != len(tasks):
        raise DomainError("invalid_dependency_cycle", "Compiled scenario contains a dependency cycle.")
    for task in tasks.values():
        values = (task.optimistic, task.most_likely, task.pessimistic)
        if not all(math.isfinite(value) for value in values) or not values[0] <= values[1] <= values[2]:
            raise DomainError("invalid_duration", f"Task {task.task_id} has an invalid PERT triple.")
        if task.state in ("completed", "cancelled") and any(value != 0 for value in values):
            raise DomainError("invalid_duration", f"Terminal task {task.task_id} has remaining duration.")
        if task.state not in ("completed", "cancelled") and task.team_id not in teams:
            raise DomainError("invalid_team_capacity", f"No team capacity exists for task {task.task_id}.")


def _sample_duration(
    task: PlanTask,
    seed: int,
    iteration: int,
    zeroed: frozenset[UUID],
    sample_cache: SampleCache | None,
) -> float:
    if task.task_id in zeroed or task.state in ("completed", "cancelled"):
        return 0.0
    low, mode, high = task.optimistic, task.most_likely, task.pessimistic
    if low == mode == high:
        return low
    width = high - low
    if width <= 0:
        raise DomainError("invalid_duration", f"Task {task.task_id} has an invalid PERT range.")
    alpha = 1.0 + 4.0 * (mode - low) / width
    beta = 1.0 + 4.0 * (high - mode) / width
    cache_key = (task.task_id, round(alpha, 12), round(beta, 12))
    series = sample_cache.get(cache_key) if sample_cache is not None else None
    if series is not None and iteration < len(series):
        unit_sample = series[iteration]
    else:
        stream = CounterStream(seed, ENGINE_VERSION, task.task_id, iteration)
        unit_sample = stream.beta(alpha, beta)
        if sample_cache is not None:
            if series is None:
                series = array("d")
                sample_cache[cache_key] = series
            series.append(unit_sample)
    return low + width * unit_sample


def _warm_sample_cache(plan: ExecutionPlan, seed: int, sample_count: int, sample_cache: SampleCache) -> None:
    """Precompute one deterministic task-local beta stream in C-backed MT19937.

    A stream is keyed by task and PERT shape, so pure location/scale scenario
    changes reuse identical quantiles (common random numbers) without repeating
    expensive digest work. The Python runtime and engine version are pinned.
    """
    for task in plan.tasks.values():
        if task.state in ("completed", "cancelled") or task.optimistic == task.pessimistic:
            continue
        width = task.pessimistic - task.optimistic
        alpha = 1.0 + 4.0 * (task.most_likely - task.optimistic) / width
        beta = 1.0 + 4.0 * (task.pessimistic - task.most_likely) / width
        cache_key = (task.task_id, round(alpha, 12), round(beta, 12))
        existing = sample_cache.get(cache_key)
        if existing is not None and len(existing) >= sample_count:
            continue
        seed_digest = sha256_hex(
            {
                "seed": str(seed),
                "engine_version": ENGINE_VERSION,
                "task_id": str(task.task_id),
                "alpha": cache_key[1],
                "beta": cache_key[2],
            }
        )
        generator = random.Random(int(seed_digest, 16))
        sample_cache[cache_key] = array(
            "d",
            (generator.betavariate(alpha, beta) for _ in range(sample_count)),
        )


def _utc_timestamp(value: datetime) -> float:
    return value.astimezone(timezone.utc).timestamp()


def _max_instant(values: Iterable[datetime]) -> datetime:
    return max(values, key=_utc_timestamp)


def _prepare_schedule(
    plan: ExecutionPlan,
    calendar: WorkingCalendar,
    *,
    zeroed: frozenset[UUID] = frozenset(),
) -> PreparedSchedule:
    snapshot = plan.snapshot
    base = calendar.normalize(_max_instant((snapshot.as_of, snapshot.project_start)))
    active = {
        task_id: task
        for task_id, task in plan.tasks.items()
        if task.state not in ("completed", "cancelled")
    }
    releases: dict[UUID, WorkInstant] = {}
    for task_id, task in active.items():
        constraints = [snapshot.as_of, snapshot.project_start]
        if task.earliest_start is not None:
            constraints.append(task.earliest_start)
        if task.external_blocker_until is not None and task_id not in zeroed:
            constraints.append(task.external_blocker_until)
        release = calendar.normalize(_max_instant(constraints))
        releases[task_id] = _external_work_instant(base, release, calendar, floor_at_zero=True)
    completed = {
        task_id: _external_work_instant(base, task.actual_finish, calendar)
        for task_id, task in plan.tasks.items()
        if task.state == "completed" and task.actual_finish is not None
    }
    predecessor_edges: dict[UUID, list[PlanEdge]] = {task_id: [] for task_id in active}
    for edge in plan.edges:
        if edge.successor in active and plan.tasks[edge.predecessor].state != "cancelled":
            predecessor_edges[edge.successor].append(edge)
    return PreparedSchedule(
        base=base,
        active_tasks=active,
        active_task_ids=tuple(sorted(active, key=lambda task_id: task_id.bytes)),
        team_slot_counts={team_id: team.capacity for team_id, team in plan.teams.items()},
        releases=releases,
        completed_finishes=completed,
        predecessor_edges={
            task_id: tuple(sorted(edges, key=lambda edge: edge.predecessor.bytes))
            for task_id, edges in predecessor_edges.items()
        },
    )


def _external_work_instant(
    base: datetime,
    instant: datetime,
    calendar: WorkingCalendar,
    *,
    floor_at_zero: bool = False,
) -> WorkInstant:
    workdays = calendar.working_days_between(base, instant)
    if floor_at_zero:
        workdays = max(0.0, workdays)
    if workdays < 0:
        return WorkInstant(workdays, 0.0)
    canonical = calendar.add_workdays(base, workdays)
    canonical_ts = _utc_timestamp(canonical)
    instant_ts = _utc_timestamp(instant)
    if instant_ts <= canonical_ts + 1e-9:
        return WorkInstant(workdays, 0.0)
    next_start = calendar.normalize(canonical)
    next_ts = _utc_timestamp(next_start)
    if next_ts <= canonical_ts + 1e-9:
        return WorkInstant(workdays, 0.0)
    phase = max(0.0, min(1.0, (instant_ts - canonical_ts) / (next_ts - canonical_ts)))
    return WorkInstant(workdays, phase)


def _schedule_iteration(
    plan: ExecutionPlan,
    prepared: PreparedSchedule,
    seed: int,
    iteration: int,
    *,
    zeroed: frozenset[UUID] = frozenset(),
    sample_cache: SampleCache | None = None,
) -> IterationSchedule:
    active = prepared.active_tasks
    if not active:
        return IterationSchedule(WorkInstant(0.0), (), {})

    sampled = {
        task_id: _sample_duration(task, seed, iteration, zeroed, sample_cache)
        for task_id, task in active.items()
    }
    finished: dict[UUID, WorkInstant] = dict(prepared.completed_finishes)
    zero = WorkInstant(0.0)
    team_slots: dict[UUID, list[tuple[WorkInstant, UUID | None]]] = {
        team_id: [(zero, None)] * capacity
        for team_id, capacity in prepared.team_slot_counts.items()
    }
    parent: dict[UUID, UUID | None] = {}
    unscheduled = set(prepared.active_task_ids)

    while unscheduled:
        selected: tuple[float, float, bytes, int, UUID, WorkInstant, UUID | None] | None = None
        for task_id in prepared.active_task_ids:
            if task_id not in unscheduled:
                continue
            edges = prepared.predecessor_edges[task_id]
            if any(edge.predecessor not in finished for edge in edges):
                continue
            task = active[task_id]
            slots = team_slots[task.team_id]
            slot_index = min(range(len(slots)), key=lambda idx: (slots[idx][0].key(), idx))
            slot_ready, slot_parent = slots[slot_index]
            start = prepared.releases[task_id]
            start_key = start.key()
            governing: list[UUID] = []
            slot_key = slot_ready.key()
            if slot_key > start_key:
                start, start_key = slot_ready, slot_key
                governing = [slot_parent] if slot_parent is not None else []
            elif slot_key == start_key and slot_parent is not None:
                governing.append(slot_parent)
            for edge in edges:
                predecessor_finish = finished[edge.predecessor].advance(edge.lag)
                predecessor_key = predecessor_finish.key()
                if predecessor_key > start_key:
                    start, start_key = predecessor_finish, predecessor_key
                    governing = [edge.predecessor]
                elif predecessor_key == start_key:
                    governing.append(edge.predecessor)
            candidate = (
                start.workdays,
                start.gap_phase,
                task_id.bytes,
                slot_index,
                task_id,
                start,
                min(governing, key=lambda value: value.bytes) if governing else None,
            )
            if selected is None or candidate[:4] < selected[:4]:
                selected = candidate
        if selected is None:
            raise DomainError("unschedulable_graph", "Validated plan reached an impossible scheduling state.")
        _, _, _, slot_index, task_id, start, governing_parent = selected
        task = active[task_id]
        effective_days = sampled[task_id] / plan.teams[task.team_id].availability
        finish = start.advance(effective_days)
        finished[task_id] = finish
        team_slots[task.team_id][slot_index] = (finish, task_id)
        parent[task_id] = governing_parent
        unscheduled.remove(task_id)

    project_task = max(active, key=lambda task_id: (finished[task_id].key(), task_id.bytes))
    chain: list[UUID] = []
    cursor: UUID | None = project_task
    while cursor is not None:
        chain.append(cursor)
        cursor = parent.get(cursor)
    chain.reverse()
    return IterationSchedule(finished[project_task], tuple(chain), sampled)


def _sensitivity_candidates(plan: ExecutionPlan) -> tuple[UUID, ...]:
    stochastic = [
        task
        for task in plan.tasks.values()
        if task.state not in ("completed", "cancelled") and task.pessimistic > task.optimistic
    ]
    stochastic.sort(key=lambda task: (-(task.pessimistic - task.optimistic), task.task_id.bytes))
    return tuple(task.task_id for task in stochastic[:MAX_SENSITIVITY_SERIES])


def _collect_samples(
    plan: ExecutionPlan,
    calendar: WorkingCalendar,
    seed: int,
    sample_count: int,
    *,
    zeroed: frozenset[UUID] = frozenset(),
    diagnostics: bool = True,
    sample_cache: SampleCache | None = None,
) -> SampleCollection:
    if sample_cache is not None:
        _warm_sample_cache(plan, seed, sample_count, sample_cache)
    prepared = _prepare_schedule(plan, calendar, zeroed=zeroed)
    finishes = array("d")
    critical_counts = {task_id: 0 for task_id in plan.tasks}
    candidates = _sensitivity_candidates(plan) if diagnostics else ()
    duration_series = {task_id: array("d") for task_id in candidates}
    for iteration in range(sample_count):
        schedule = _schedule_iteration(plan, prepared, seed, iteration, zeroed=zeroed, sample_cache=sample_cache)
        finishes.append(schedule.project_finish.encoded())
        if diagnostics:
            for task_id in schedule.critical_chain:
                critical_counts[task_id] += 1
            for task_id in candidates:
                duration_series[task_id].append(schedule.sampled_durations.get(task_id, 0.0))

    p80_value = _quantile(finishes, 0.8)
    p80_iteration = min(range(sample_count), key=lambda index: (abs(finishes[index] - p80_value), index))
    p80_path = (
        _schedule_iteration(plan, prepared, seed, p80_iteration, zeroed=zeroed, sample_cache=sample_cache).critical_chain
        if diagnostics
        else ()
    )
    return SampleCollection(finishes, critical_counts, duration_series, p80_path)


def _forecast(finishes: Iterable[float], calendar: WorkingCalendar, base: datetime) -> QuantileForecast:
    values = list(finishes)
    return QuantileForecast(
        p50=calendar.local_date(calendar.add_workdays(base, _quantile(values, 0.50))),
        p80=calendar.local_date(calendar.add_workdays(base, _quantile(values, 0.80))),
        p95=calendar.local_date(calendar.add_workdays(base, _quantile(values, 0.95))),
    )


def _batch_standard_errors(finishes: array) -> dict[str, float]:
    if len(finishes) < 20:
        return {"p50": 0.0, "p80": 0.0, "p95": 0.0}
    batch_count = 20
    batch_size = len(finishes) // batch_count
    result: dict[str, float] = {}
    for label, q in (("p50", 0.5), ("p80", 0.8), ("p95", 0.95)):
        estimates = []
        for batch in range(batch_count):
            start = batch * batch_size
            end = len(finishes) if batch == batch_count - 1 else (batch + 1) * batch_size
            estimates.append(_quantile(finishes[start:end], q))
        result[label] = _round6(statistics.stdev(estimates) / math.sqrt(batch_count))
    return result


def _rank(values: Iterable[float]) -> list[float]:
    data = list(values)
    order = sorted(range(len(data)), key=lambda index: (data[index], index))
    ranks = [0.0] * len(data)
    cursor = 0
    while cursor < len(order):
        end = cursor + 1
        while end < len(order) and data[order[end]] == data[order[cursor]]:
            end += 1
        average = ((cursor + 1) + end) / 2.0
        for position in range(cursor, end):
            ranks[order[position]] = average
        cursor = end
    return ranks


def _pearson(left: list[float], right: list[float]) -> float:
    left_mean = statistics.fmean(left)
    right_mean = statistics.fmean(right)
    numerator = sum((a - left_mean) * (b - right_mean) for a, b in zip(left, right))
    left_ss = sum((a - left_mean) ** 2 for a in left)
    right_ss = sum((b - right_mean) ** 2 for b in right)
    if left_ss == 0 or right_ss == 0:
        return 0.0
    return max(-1.0, min(1.0, numerator / math.sqrt(left_ss * right_ss)))


def _sensitivity(plan: ExecutionPlan, samples: SampleCollection, sample_count: int) -> list[SensitivityItem]:
    finish_ranks = _rank(samples.finishes)
    raw = []
    for task_id, durations in samples.duration_series.items():
        correlation = _pearson(_rank(durations), finish_ranks)
        raw.append((task_id, correlation))
    raw.sort(key=lambda item: (-abs(item[1]), item[0].bytes))
    return [
        SensitivityItem(
            work_item_id=task_id,
            method="spearman_rank",
            correlation=_round6(correlation),
            absolute_rank=index,
            criticality_index=_round6(samples.critical_counts.get(task_id, 0) / sample_count),
            estimate_source=plan.tasks[task_id].estimate_source,
        )
        for index, (task_id, correlation) in enumerate(raw[:20], start=1)
    ]


def _blockers(
    plan: ExecutionPlan,
    calendar: WorkingCalendar,
    seed: int,
    sample_count: int,
    baseline: SampleCollection,
    sample_cache: SampleCache | None = None,
) -> list[BlockerItem]:
    candidates = [
        task_id
        for task_id, task in plan.tasks.items()
        if task.state == "blocked" or task.external_blocker
    ]
    candidates.sort(
        key=lambda task_id: (
            -baseline.critical_counts.get(task_id, 0),
            task_id.bytes,
        )
    )
    original_p80 = _quantile(baseline.finishes, 0.8)
    output = []
    for task_id in candidates[:MAX_BLOCKER_COUNTERFACTUALS]:
        counterfactual = _collect_samples(
            plan,
            calendar,
            seed,
            sample_count,
            zeroed=frozenset((task_id,)),
            diagnostics=False,
            sample_cache=sample_cache,
        )
        counterfactual_p80 = _quantile(counterfactual.finishes, 0.8)
        improvement = max(0.0, original_p80 - counterfactual_p80)
        criticality = baseline.critical_counts.get(task_id, 0) / sample_count
        output.append(
            BlockerItem(
                work_item_id=task_id,
                score=_round6(criticality * improvement),
                criticality_index=_round6(criticality),
                p80_finish_improvement_if_zeroed=_round6(improvement),
            )
        )
    output.sort(key=lambda item: (-item.score, item.work_item_id.bytes))
    return output


def _comparison(
    baseline_plan: ExecutionPlan,
    scenario_plan: ExecutionPlan,
    baseline: SampleCollection,
    scenario: SampleCollection,
    calendar: WorkingCalendar,
    base: datetime,
    sample_count: int,
) -> Comparison:
    deltas = array(
        "d",
        (after - before for before, after in zip(baseline.finishes, scenario.finishes)),
    )
    changed = []
    for task_id in sorted(set(baseline_plan.tasks) | set(scenario_plan.tasks), key=lambda value: value.bytes):
        before = baseline.critical_counts.get(task_id, 0) / sample_count
        after = scenario.critical_counts.get(task_id, 0) / sample_count
        delta = after - before
        if abs(delta) >= 0.000001:
            changed.append(
                {
                    "work_item_id": str(task_id),
                    "baseline_index": _round6(before),
                    "scenario_index": _round6(after),
                    "delta": _round6(delta),
                }
            )
    changed.sort(key=lambda item: (-abs(item["delta"]), item["work_item_id"]))
    return Comparison(
        baseline_quantiles=_forecast(baseline.finishes, calendar, base),
        scenario_quantiles=_forecast(scenario.finishes, calendar, base),
        delta_workdays={
            "p50": _round6(_quantile(deltas, 0.50)),
            "p80": _round6(_quantile(deltas, 0.80)),
            "p95": _round6(_quantile(deltas, 0.95)),
        },
        probability_of_improvement=_round6(
            sum(1 for before, after in zip(baseline.finishes, scenario.finishes) if after < before) / sample_count
        ),
        changed_criticality=changed[:20],
        interpretation="negative_delta_means_earlier;association_not_causal",
    )


def _components_warning(plan: ExecutionPlan) -> list[str]:
    active = {task_id for task_id, task in plan.tasks.items() if task.state not in ("completed", "cancelled")}
    if not active:
        return []
    neighbors = {task_id: set() for task_id in active}
    for edge in plan.edges:
        if edge.predecessor in active and edge.successor in active:
            neighbors[edge.predecessor].add(edge.successor)
            neighbors[edge.successor].add(edge.predecessor)
    components = []
    remaining = set(active)
    while remaining:
        root = min(remaining, key=lambda value: value.bytes)
        stack = [root]
        component = set()
        while stack:
            node = stack.pop()
            if node in component:
                continue
            component.add(node)
            stack.extend(neighbors[node] - component)
        remaining -= component
        components.append(component)
    if len(components) <= 1:
        return []
    return [f"disconnected_task_groups:{len(components)}"]


def _result_hash_payload(result: SimulationResult) -> dict:
    return {
        "snapshot_id": str(result.snapshot_id),
        "snapshot_hash": result.snapshot_hash,
        "scenario_id": str(result.scenario_id) if result.scenario_id else None,
        "scenario_hash": result.scenario_hash,
        "calendar_version": result.calendar_version,
        "engine_version": result.engine_version,
        "seed": result.seed,
        "sample_count": result.sample_count,
        "uncertainty": result.uncertainty,
        "probability_on_or_before_target": result.probability_on_or_before_target,
        "probability_after_target": result.probability_after_target,
        "critical_path": result.critical_path,
        "criticality": result.criticality,
        "blockers": result.blockers,
        "sensitivity": result.sensitivity,
        "comparison": result.comparison,
        "assumptions": result.assumptions,
        "missing_data": result.missing_data,
        "warnings": result.warnings,
        "evidence_ids": result.evidence_ids,
    }


def run_simulation(request: SimulationRequest, context: TenantContext) -> SimulationResult:
    created_at = datetime.now(timezone.utc)
    snapshot = parse_snapshot(request.snapshot, context)
    if request.scenario is not None:
        validate_scenario(request.scenario, snapshot, context)
    calendar = WorkingCalendar(snapshot.timezone, snapshot.calendar)
    baseline_plan = _build_plan(snapshot, None)
    primary_plan = _build_plan(snapshot, request.scenario)
    base = _prepare_schedule(primary_plan, calendar).base
    seed_text = request.scenario.seed if request.scenario else snapshot.default_seed
    seed = int(seed_text)
    sample_cache: SampleCache = {}

    baseline_samples = _collect_samples(
        baseline_plan,
        calendar,
        seed,
        request.sample_count,
        diagnostics=True,
        sample_cache=sample_cache,
    )
    if request.scenario is None:
        primary_samples = baseline_samples
        comparison = None
    else:
        primary_samples = _collect_samples(
            primary_plan,
            calendar,
            seed,
            request.sample_count,
            diagnostics=True,
            sample_cache=sample_cache,
        )
        comparison = _comparison(
            baseline_plan,
            primary_plan,
            baseline_samples,
            primary_samples,
            calendar,
            base,
            request.sample_count,
        )

    forecast = _forecast(primary_samples.finishes, calendar, base)
    target = primary_plan.target_date
    if target is None:
        on_time = late = None
    else:
        cutoff = _external_work_instant(base, calendar.target_cutoff(target), calendar).encoded()
        on_time_count = sum(1 for finish in primary_samples.finishes if finish < cutoff)
        on_time = _round6(on_time_count / request.sample_count)
        late = _round6(1.0 - on_time)

    warnings = set(primary_plan.warnings)
    warnings.update(_components_warning(primary_plan))
    if request.run_mode == "preview":
        warnings.add("preview_only_not_committed")
    if request.sample_count < 2000:
        warnings.add("low_precision_preview")
    if len(_sensitivity_candidates(primary_plan)) == MAX_SENSITIVITY_SERIES:
        stochastic_count = sum(
            task.pessimistic > task.optimistic
            for task in primary_plan.tasks.values()
            if task.state not in ("completed", "cancelled")
        )
        if stochastic_count > MAX_SENSITIVITY_SERIES:
            warnings.add("sensitivity_limited_to_64_widest_distributions")
    missing_data = sorted(
        f"blocker_resolution_missing:{task.task_id}"
        for task in primary_plan.tasks.values()
        if (task.external_blocker or task.state == "blocked") and task.external_blocker_until is None
    )
    assumptions = sorted(
        set(snapshot.assumptions)
        | {
            "Task durations are independent conditional on the sealed estimates.",
            "Capacity is modeled only at aggregate team level.",
            "Synthetic results demonstrate reproducibility, not external predictive validity or causality.",
        }
        | ({assumption.statement for assumption in request.scenario.assumptions} if request.scenario else set())
    )
    evidence_ids = set(snapshot.evidence_ids)
    for task in primary_plan.tasks.values():
        evidence_ids.update(task.evidence_ids)
    for edge in primary_plan.edges:
        evidence_ids.update(edge.evidence_ids)
    for team in primary_plan.teams.values():
        evidence_ids.update(team.evidence_ids)

    criticality = [
        CriticalityItem(
            work_item_id=task_id,
            index=_round6(count / request.sample_count),
        )
        for task_id, count in primary_samples.critical_counts.items()
        if count
    ]
    criticality.sort(key=lambda item: (-item.index, item.work_item_id.bytes))
    uncertainty_warnings = []
    if request.sample_count < 2000:
        uncertainty_warnings.append("fewer_than_2000_trials")

    provisional = SimulationResult(
        simulation_id=uuid4(),
        tenant_id=context.tenant_id,
        snapshot_id=snapshot.snapshot_id,
        snapshot_hash=snapshot.canonical_sha256,
        scenario_id=request.scenario.scenario_id if request.scenario else None,
        scenario_hash=request.scenario.scenario_digest if request.scenario else None,
        calendar_version=snapshot.calendar.version,
        engine_version=ENGINE_VERSION,
        seed=seed_text,
        sample_count=request.sample_count,
        status="succeeded",
        uncertainty=Uncertainty(
            method="seeded_beta_pert_monte_carlo",
            sample_count=request.sample_count,
            seed=seed_text,
            quantiles=forecast,
            batch_standard_errors_days=_batch_standard_errors(primary_samples.finishes),
            warnings=uncertainty_warnings,
        ),
        probability_on_or_before_target=on_time,
        probability_after_target=late,
        critical_path=list(primary_samples.p80_path),
        criticality=criticality,
        blockers=_blockers(primary_plan, calendar, seed, request.sample_count, primary_samples, sample_cache),
        sensitivity=_sensitivity(primary_plan, primary_samples, request.sample_count),
        comparison=comparison,
        assumptions=assumptions,
        missing_data=missing_data,
        warnings=sorted(warnings),
        evidence_ids=sorted(evidence_ids, key=lambda value: value.bytes),
        created_at=created_at,
        completed_at=datetime.now(timezone.utc),
        result_sha256="0" * 64,
    )
    result = provisional.model_copy(update={"result_sha256": sha256_hex(_result_hash_payload(provisional))})
    context.assert_response_isolated(result)
    return result
