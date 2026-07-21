---
id: CH-08
title: Simulation and Prediction
status: Committed
version: 1.0.0
owners:
  - Simulation Platform
  - Applied AI
  - Product Analytics
last_reviewed: 2026-07-13
---

# Simulation and Prediction

## Phase 3 decision-intelligence foundation

ADR-019 adds a general, governed foundation beside the frozen H1 launch scheduler. It deliberately keeps two questions separate:

```text
Simulation: immutable snapshot -> confirmed change -> bounded relationship propagation
            -> versioned deterministic rules -> impact -> baseline comparison

Prediction: historical observations -> bounded feature processing -> registered non-LLM model
            -> forecast -> confidence evidence -> real outcome -> human validation -> learning event
```

The API routes are separated under `/v1/twin/simulation/*` and `/v1/twin/prediction/*`; neither service imports or calls the other. PostgreSQL records are tenant-qualified, hash-bound, idempotent, audited, and emitted through the transactional outbox. The Python intelligence worker performs pure deterministic calculation and fails closed. It has no connector read, graph write, LLM call, oracle fallback, or external action capability.

General simulation snapshots seal one to 100 authorized graph nodes, explicit aggregate numeric variables, up to 500 visible relationships, graph version, as-of time, assumptions, and canonical digest. A scenario is a typed `hiring`, `pricing_change`, `supplier_failure`, `expansion`, or `budget_change` branch. Every branch references an immutable snapshot and optional confirmed parent branch, contains allowlisted `set`, `add`, or `multiply` changes, declares a propagation depth of at most six, and requires digest confirmation. Execution applies changes, propagates the same variable through declared direction/strength/confidence/importance, recalculates only the registered `revenue`, `operating_margin`, `budget_variance`, and `capacity_gap` identities when their inputs exist, and returns per-node baseline/scenario deltas. Propagated weights express modeled exposure, not causality.

The predictive registry stores forecasting, optimization, anomaly-detection, computer-vision, and classification definitions with inputs, outputs, semantic version, accuracy, owner, trigger, lifecycle state, calibration bias, learning revision, and state hash. This phase executes only active forecasting/classification definitions using `linear_trend` or `bounded_linear_trend`; other types are governance-ready registrations, not pretend implementations. Revenue, expense, customer-churn, aggregate-workforce, and risk forecasts accept three to 10,000 historical observations and a one-to-36-step horizon. The exact observations are retained in an immutable tenant-scoped feature batch with user-input source binding and data hash; the public run references that batch without duplicating it. Results include processed feature summaries, forecast intervals, fit/sample/error confidence evidence, limitations, input hash, model version, and pending-outcome state.

Learning is explicit and reviewable. A real outcome is recorded with source evidence, then an authorized user confirms or corrects it. The worker calculates MAE, MAPE where defined, RMSE, bias, and normalized accuracy. One transaction updates the prediction, rolling model accuracy, bounded calibration bias, learning revision, append-only learning event, audit chain, idempotency record, and outbox event. Historical outcomes, technical specifications, company rules, corrections, and expert knowledge can be submitted, but remain `pending_review` and cannot silently alter a model.

Workforce use remains aggregate-only: `headcount`, `workforce_capacity`, and `open_positions`. Person identifiers, individual attrition, performance, productivity, suitability, and hiring scores are rejected. Hiring scenarios model an explicit aggregate headcount change; they do not recommend, rank, select, or evaluate people and do not authorize an employment action.

The current foundation is horizontally stateless at the API layer and all reads are recovered from PostgreSQL rather than replica-local maps. Bounded input sizes prevent unbounded graph or historical processing. Production promotion still requires Temporal orchestration for long runs, cancellation/heartbeats, object storage for large artifacts, representative backtesting, calibration/drift/fairness gates, model-artifact signing, domain-owner approval, and load evidence. Those gates are limitations, not silently claimed capabilities.

## 1. Purpose, claim boundary, and non-goals

H1 implements one defensible simulation: a seeded PERT/Monte Carlo forecast of launch timing over a task dependency DAG. It compares an immutable baseline with a user-confirmed scenario and explains the conditional distribution of completion dates.

The result is not a promise, causal conclusion, or validated prediction of human behavior. It is conditional on task estimates, dependencies, calendars, and stated assumptions. The product MUST call it a forecast or simulation, not an objective prediction of the organization.

Individual burnout, attrition, performance, productivity, hiring, compensation, emotion, health, misconduct, or suitability scoring is prohibited through H3. H1 has no person-level rate, performance, availability, or productivity parameter. Production-calibrated mergers, layoffs, customer churn, pricing, security-loss magnitude, cash-flow, and market claims remain Research until separately governed models and validation exist; ADR-019 provides only the bounded conditional/statistical foundation described above.

| ID | Requirement |
|---|---|
| REQ-SIM-001 | H1 MUST use a seeded PERT/Monte Carlo dependency-DAG scheduler rather than model-authored mathematics. |
| REQ-SIM-002 | Scenario inputs, assumptions, interventions, snapshot, engine version, and seed MUST be typed, confirmed, and persisted. |
| REQ-SIM-003 | Simulation MUST return p50, p80, p95, critical path, blockers, sensitivity, uncertainty, assumptions, and missing-data warnings. |
| REQ-SIM-004 | Synthetic scenarios MUST be labeled demonstrative and MUST NOT claim causal or production predictive validity. |
| REQ-SIM-005 | Later forecasts MUST define outcome, window, lineage, calibration, backtesting, drift, abstention, fairness, explanation, and prohibited use before promotion. |
| QAR-SIM-001 | Equal snapshot, scenario, engine version, calendar, and seed MUST produce an identical canonically rounded output digest. |
| QAR-PERF-002 | The frozen Orion 2.0 H1 workload with 50,000 trials MUST complete in less than 10 seconds at p95. |

Every run binds an immutable evidence-backed snapshot, confirmed scenario, seed, trial count, engine/container version, and calendar version. Invalid dependency graphs fail explicitly. Baseline/scenario comparisons use common random numbers for unchanged work items.

## 2. Ownership and execution

The Python simulation worker owns validation, sampling, scheduling, aggregation, and comparison. PostgreSQL owns `Scenario`, `SimulationSnapshot`, `SimulationRun`, and result metadata. Immutable snapshots and large result artifacts are stored in S3-compatible storage. Temporal owns long-running execution, cancellation, retries, and progress. The AI subsystem can produce a typed draft and a prose explanation; it cannot change numeric results.

The engine is a pure function:

```text
result = simulate(snapshot, scenario, seed, sample_count, engine_version)
```

It performs no provider reads, graph writes, model calls, or external actions. All source resolution occurs before snapshot sealing.

## 3. Canonical input types

### 3.1 SimulationSnapshot

```json
{
  "schema_version": "1.0",
  "snapshot_id": "UUID",
  "tenant_id": "server-derived UUID",
  "project_id": "UUID",
  "as_of": "RFC3339 timestamp",
  "project_start": "RFC3339 timestamp",
  "target_date": "ISO YYYY-MM-DD or null",
  "simulation_model_version": "pert-monte-carlo/1.0.0",
  "parameter_set_version": "beta-pert-lambda-4/1.0.0",
  "default_seed": "unsigned 64-bit decimal string",
  "timezone": "IANA timezone",
  "timezone_database_version": "IANA tzdb version",
  "calendar": {
    "version": "string",
    "working_weekdays": [1, 2, 3, 4, 5],
    "workday_start": "09:00",
    "hours_per_workday": 8,
    "holidays": ["YYYY-MM-DD"]
  },
  "team_capacities": [],
  "tasks": [],
  "dependencies": [],
  "assumptions": [],
  "warnings": [],
  "evidence_ids": [],
  "canonical_sha256": "hex"
}
```

`tenant_id` is stored for isolation but is omitted from model-visible content and cannot be supplied by a public caller. `canonical_sha256` is SHA-256 over RFC 8785 canonical JSON excluding the hash field. Sealing records all entity, claim, evidence, ontology, ACL, numeric-model, parameter-set, calendar, timezone-database, and default-seed versions used. Later source or numeric-input changes create a new snapshot.

### 3.2 Task and dependency

```json
{
  "work_item_id": "stable UUID",
  "source_key": "provider display key or null",
  "label": "display-only string",
  "state": "not_started|in_progress|blocked|completed|cancelled",
  "team_id": "aggregate team UUID",
  "remaining_duration": {
    "optimistic": 2.0,
    "most_likely": 3.0,
    "pessimistic": 7.0,
    "unit": "workday",
    "source": "explicit|confirmed_imputation"
  },
  "earliest_start": "RFC3339 timestamp or null",
  "actual_finish": "RFC3339 timestamp or null",
  "external_blocker": false,
  "external_blocker_until": "RFC3339 timestamp or null",
  "evidence_ids": ["UUID"]
}
```

A dependency is `{predecessor_work_item_id, successor_work_item_id, type:"finish_to_start", lag_workdays, source_relationship_id, evidence_ids}`. H1 supports finish-to-start dependencies with non-negative lag only. CH-05 `DEPENDS_ON consumer->prerequisite` relationships are deliberately inverted during snapshot compilation to `{predecessor=prerequisite, successor=consumer}`; `BLOCKS blocker->work` retains its direction. Duplicate edges are canonicalized to the greatest lag after emitting a warning. Self-edges are invalid.

Each aggregate team has `{team_id, parallel_capacity, availability, evidence_ids}`. `parallel_capacity` is an integer from 1 to 100 representing simultaneous scheduling slots. `availability` is an aggregate scenario coefficient in `(0,1]` that scales the team's task durations; it is not derived from or exposed as any person's productivity. Team membership, person hours, and person-level rates are absent from simulation input.

Completed tasks have zero remaining duration and a known `actual_finish` at or before `as_of`. Cancelled tasks have zero remaining duration and are absent from scheduling but retained in the snapshot audit. A cancelled task cannot remain an endpoint of an active scheduling dependency; before sealing, the snapshot compiler requires an explicit source resolution or a user-confirmed assumption that excludes the edge and records it in the snapshot. In-progress tasks require an estimate of remaining work; the engine never converts percent-complete to remaining time. All durations are finite numbers in `[0, 1300]` workdays and satisfy `optimistic <= most_likely <= pessimistic`. `external_blocker_until` is an evidence-backed earliest-release constraint. When `external_blocker=true` and its release date is unknown, the compiler emits a missing-data warning and the run is explicitly conditioned on immediate release at `as_of`; it does not silently invent a date. Any task in `blocked` state without a release constraint must carry a confirmed assumption that blocker delay is already included in its three-point remaining estimate, or sealing stops for clarification.

H1 synthetic fixtures provide explicit three-point estimates. If a real source provides only one positive estimate `e`, the compiler may offer, but not silently apply, the documented imputation `(0.8e, e, 1.5e)`. The user must confirm it, `source` becomes `confirmed_imputation`, and the forecast carries a high-visibility assumption. A task with no estimate blocks sealing.

### 3.3 Scenario

A confirmed scenario is an immutable envelope containing `scenario_id`, baseline `snapshot_id` and hash, name, target-date assertion, simulation-model version, calendar version, compiler version, unsigned 64-bit decimal-string `seed`, `sample_count`, ordered interventions, assumptions, confirmation actor/time, and canonical digest. It references the sealed snapshot rather than duplicating its tasks, dependencies, or capacities. In H1 its model, calendar, and seed values are consistency assertions that MUST equal the snapshot values; changing one requires a new snapshot. H1 committed runs require `sample_count=50000`; a separately labeled preview may request 1,000 to 49,999 samples but cannot produce the committed demo result or an approval-bearing remediation. The engine executes exactly `sample_count` numbered iterations.

The intervention list permits only these typed operations:

- `set_duration_estimate(work_item_id, optimistic, most_likely, pessimistic)`;
- `shift_completion_distribution(work_item_id, delta_workdays)`; this adds the same signed working-day delta to optimistic, most-likely, and pessimistic remaining duration, preserving distribution width and common random numbers;
- `set_earliest_start(work_item_id, timestamp_or_null)`;
- `add_dependency(predecessor, successor, lag_workdays)`;
- `remove_dependency(predecessor, successor)`;
- `remove_scope(work_item_id)`;
- `change_team_capacity(team_id, capacity_delta)` where the integer delta leaves capacity in `[1,100]`;
- `resolve_external_blocker(work_item_id, resolution_date)`;
- `mark_task_completed(work_item_id, actual_finish)` for a hypothetical work-state comparison.

There is no free-form formula, code, person reference, arbitrary graph mutation, or hidden capacity change. Operations are applied in order and conflicts are rejected, for example removing an absent edge twice or modifying a completed task duration. `remove_scope` removes the task and its incident scenario dependency edges in the compiled copy and lists every removed downstream constraint in the confirmation diff; it never mutates the source graph. `shift_completion_distribution` requires an integer delta in `[-260,260]` and is invalid if any shifted duration becomes negative. `resolve_external_blocker` clears the flag and sets the task's release constraint to `max(existing earliest_start, resolution_date)`; it cannot move work before `as_of`. `mark_task_completed` requires `project_start <= actual_finish <= as_of` and sets remaining duration to zero; a future claimed actual finish is invalid. Capacity changes are aggregate, explicit in the diff, and unused by the frozen H1 scenario. Natural-language source is retained only as an untrusted audit artifact beside the structured scenario; it is not included as executable input.

## 4. Compilation and confirmation

The scenario flow is:

1. The user chooses an immutable baseline snapshot.
2. A typed UI or the `scenario_planning` capability drafts only Section 3.3 operations.
3. Deterministic validation applies the draft to a copy, checks IDs, ranges, cycles, calendar, policy, and prohibited fields.
4. The UI shows an exact before/after diff, affected milestones, added assumptions, and source conflicts.
5. The user confirms the digest. Any change requires a new confirmation.
6. The API creates a run referencing, not copying or mutating, the snapshot and scenario.

Natural language is never interpreted during numeric execution. If the compiler cannot map a phrase exactly, it returns an unresolved question instead of selecting an operation.

### 4.1 Frozen H1 reference scenario

The H1 workload uses primary tenant `10000000-0000-4000-8000-000000000001` (`tnt_aster`) and isolation canary `10000000-0000-4000-8000-000000000002` (`tnt_beacon`). Its scheduling chain is `AST-142 -> AST-173 -> AST-201 -> Orion 2.0 General Availability`. Fixture work-item IDs are deterministic UUIDv5 values over their tenant/source identity; `AST-142` maps to `116ab4b3-b108-5f91-ab7e-111f7fba1d45`. The confirmed scenario contains exactly one intervention:

```json
{
  "type": "shift_completion_distribution",
  "work_item_id": "116ab4b3-b108-5f91-ab7e-111f7fba1d45",
  "delta_workdays": -5
}
```

All other duration distributions, dependencies, calendars, capacities, and assumptions remain unchanged. The reference run uses seed `20260713` and 50,000 trials. Within one calendar day at each percentile, its golden output is:

| Result | Baseline | Scenario |
|---|---|---|
| p50 launch date | `2026-08-20` | `2026-08-13` |
| p80 launch date | `2026-08-24` | `2026-08-17` |
| p95 launch date | `2026-08-27` | `2026-08-20` |
| Dominant path | `AST-142 -> AST-173 -> AST-201 -> launch` | Same path with lower occupancy |

These golden dates validate the fixture and engine together; they are not precomputed production answers and are never substituted for executing the real run.

## 5. Mathematical model

### 5.1 Beta-PERT duration

For each non-completed task `i`, let `o_i`, `m_i`, and `p_i` be optimistic, most-likely, and pessimistic remaining workdays. H1 uses Beta-PERT with `lambda = 4`:

```text
alpha_i = 1 + lambda * (m_i - o_i) / (p_i - o_i)
beta_i  = 1 + lambda * (p_i - m_i) / (p_i - o_i)
X_i     = o_i + (p_i - o_i) * B_i
B_i     ~ Beta(alpha_i, beta_i)
```

When `o_i = m_i = p_i`, `X_i` is that constant and no random value is consumed. Any other zero-width or reversed interval is invalid. The familiar PERT mean `(o_i + 4m_i + p_i) / 6` is reported for input inspection but is not substituted for sampling.

H1 assumes task durations are independent conditional on the entered estimates. Because real work may share systemic risks, the output always states this assumption. Correlated risk factors are an H2 research/validation item and cannot be introduced by merely widening a prompt.

### 5.2 Deterministic random streams

The engine uses counter-based Philox streams. The stream key is derived from `SHA-256(encode_tuple(seed, engine_version, work_item_id))`, where each UTF-8 text value is length-prefixed and the UUID uses its 16 raw network-order bytes; the counter contains iteration and draw component. Work-item UUIDs are sorted bytewise. The implementation maps a fixed 53-bit uniform variate through the pinned inverse beta CDF, so a changed distribution uses the same underlying uniform value. Therefore worker count, batch size, retry, and input/topological ordering do not change a task's random draw.

The implementation pins the PRNG and beta-sampling algorithm in the engine container. Exact replay is guaranteed only for the same `engine_version` and container digest; a new numeric-library or sampling algorithm is a new engine version and must pass golden-vector compatibility tests. Inputs and results retain enough metadata to run the prior image during the support window.

Baseline and scenario use identical streams for a task that exists in both. A scenario-changed duration transforms the same underlying uniform variates through its new distribution. New tasks receive streams from their stable IDs. This common-random-number design reduces noise in the difference without pretending the estimates are causal.

### 5.3 Capacity-aware schedule calculation

For a task `i` assigned to aggregate team `g`, let `a_g` be availability and `c_g` be integer parallel capacity. Effective sampled duration is:

```text
Y_i = X_i / a_g
```

For each iteration, the engine uses a deterministic event-driven parallel schedule-generation scheme. It maintains predecessor counts, a release instant for each task, `c_g` numbered slots for each team, a bytewise-UUID ready queue per team, and a global event queue. A task enters its team's ready queue only after all predecessors are complete and its release instant has arrived. At each event instant, completions are processed first in bytewise UUID order, newly eligible tasks are enqueued, and each free team slot takes the bytewise-lowest ready task; equal free slots use the lowest slot index. Zero-duration completions are processed to a fixed point at the same instant before time advances.

```text
release_i = next_working_instant(max(as_of,
                                    project_start,
                                    earliest_start_i,
                                    external_blocker_until_i),
                                 calendar)

dependency_ready_i = max(release_i,
                         max(add_working_days(finish_j, lag_ji) for each predecessor j))

start_i = first event instant at or after dependency_ready_i
          where a team-g slot is free and i is the
          bytewise-lowest UUID in that team's ready queue

finish_i = add_working_duration(start_i, Y_i, calendar)

project_finish = max(finish_i for each terminal active task i)
```

The predecessor maximum is absent for a task with no predecessors, leaving `dependency_ready_i=release_i`. When no task can start, time advances to the earliest running-task finish or dependency-satisfied future release; if neither exists while work remains, validation has missed an impossible state and the run fails rather than looping. Completed predecessor finish is its actual finish. Null `earliest_start` and null `external_blocker_until` contribute no later constraint. Every remaining task starts no earlier than `as_of`, project start, its explicit release constraints, its predecessors, and an available team slot. A ready task never waits behind a merely future-released task. Disconnected components are allowed and project completion is the latest terminal task. A project with no active tasks completes at `as_of`. This stable non-delay heuristic is not a claim to solve the globally optimal resource-constrained project scheduling problem.

Working-time addition uses the sealed IANA timezone and calendar. It advances only through configured working intervals, treats holidays as non-working, preserves fractional workdays, and emits RFC3339 instants plus display dates. Ambiguous or nonexistent daylight-saving local times are resolved by the timezone database version recorded in the engine. Capacity is team-level and deterministic within an iteration; H1 does not model individual assignment, individual rate, preemption, multitasking loss, skill substitution, or stochastic availability.

### 5.4 Quantiles and probability

Completion instants are converted to elapsed working seconds for aggregation and then mapped back through the calendar. For sorted zero-indexed values `x[0..n-1]`, quantile `q` uses Hyndman-Fan type 7:

```text
h = (n - 1) * q
j = floor(h)
g = h - j
Q(q) = (1 - g) * x[j] + g * x[min(j + 1, n - 1)]
```

H1 reports the sealed-timezone local dates containing `Q(0.50)`, `Q(0.80)`, and `Q(0.95)`. A target date maps to the exclusive start of the next local civil date under the sealed timezone database, so weekend and daylight-saving boundaries have one deterministic meaning. `probability_on_or_before_target` is the count of iterations with `project_finish < target_cutoff` divided by iterations, and `probability_after_target = 1 - probability_on_or_before_target`. Both are omitted when no target is present, and the UI labels the latter as simulated miss probability under the sealed assumptions.

Sampling uncertainty is estimated by splitting the ordered iteration set into 20 equal deterministic batches, computing each requested quantile per batch, and reporting the standard error of the batch quantiles. Fewer than 2,000 iterations is allowed only for an explicit preview and is labeled low precision. The committed H1 result uses 50,000 iterations.

The pinned engine uses IEEE 754 binary64 without fast-math reassociation and rejects non-finite intermediates. Before hashing, instants are rounded to UTC milliseconds using round-half-to-even; workday deltas, probabilities, correlations, criticality indexes, and standard errors are rounded to six decimal places with negative zero normalized to zero. Ranked arrays sort by the documented score direction and then bytewise work-item UUID. RFC 8785 canonical JSON is hashed only after this normalization. Full-precision internal values may be retained in the short-lived validation artifact but are not part of the public compatibility contract.

## 6. Critical path, blockers, and sensitivity

For every iteration the engine augments source dependencies with resource-order edges between consecutive tasks assigned to the same simulated team slot, then performs a backward pass from `project_finish`. A task is critical when total slack is no more than `1e-9` workdays. Its criticality index is the fraction of iterations in which it is critical. The displayed p80 critical path is the deterministic dependency/resource chain ending at the p80-nearest completion sample, breaking equal-finish ties by work-item UUID. The product marks resource-order edges so they are not mistaken for source facts. It also shows criticality index so one sampled path is not mistaken for the only risk path.

Blockers are ranked active tasks whose state is `blocked` or `external_blocker=true`, then by:

```text
blocker_score = criticality_index * max(0, p80_finish_improvement_if_zeroed)
```

`p80_finish_improvement_if_zeroed` is `baseline_p80 - counterfactual_p80` in working days. The one-at-a-time counterfactual sets only that task's remaining duration to zero and, when present, its external-blocker release constraint to `as_of`; dependency lags and every other input remain unchanged. It preserves common random numbers and is an impact screen, not a causal estimate.

Sensitivity drivers use Spearman rank correlation between each task's sampled duration and project completion duration. The output reports signed correlation, absolute rank, criticality index, and source estimate. Correlation is omitted for constant tasks and labeled unstable when fewer than 2,000 iterations or when batch estimates vary materially. Only the top 20 drivers are returned by default.

## 7. Output contract

`SimulationRun` includes:

```json
{
  "simulation_id": "UUID",
  "tenant_id": "server-derived UUID",
  "snapshot_id": "UUID",
  "snapshot_hash": "hex",
  "scenario_id": "UUID or null",
  "scenario_hash": "hex or null",
  "calendar_version": "string",
  "engine_version": "semver+container-digest",
  "seed": "unsigned 64-bit decimal string",
  "sample_count": 50000,
  "status": "succeeded",
  "uncertainty": {
    "method": "seeded_pert_monte_carlo",
    "sample_count": 50000,
    "seed": "20260713",
    "quantiles": {"p50": "YYYY-MM-DD", "p80": "YYYY-MM-DD", "p95": "YYYY-MM-DD"},
    "batch_standard_errors_days": {"p50": 0.1, "p80": 0.2, "p95": 0.4},
    "warnings": []
  },
  "probability_on_or_before_target": 0.72,
  "probability_after_target": 0.28,
  "critical_path": ["task UUID"],
  "criticality": [{"work_item_id": "UUID", "index": 0.63}],
  "blockers": [],
  "sensitivity": [],
  "assumptions": [],
  "missing_data": [],
  "warnings": [],
  "evidence_ids": [],
  "created_at": "RFC3339 timestamp",
  "completed_at": "RFC3339 timestamp",
  "result_sha256": "hex"
}
```

`tenant_id` is internal/audit context and is not accepted from a public caller. Quantile dates are rendered in the sealed project timezone; full UTC instants remain in the validation artifact. `result_sha256` covers a canonical `SimulationResult` value containing the uncertainty, probabilities, comparison, paths, drivers, assumptions, warnings, evidence, input hashes, seed, sample count, and engine/calendar versions. It excludes `simulation_id`, tenant ID, lifecycle status and timestamps, progress, trace IDs, storage URIs, and the hash field itself. Thus two independently created runs over equal committed inputs produce the same computational result hash even though their run records differ.

A comparison adds baseline and scenario forecasts, paired per-iteration deltas, p50/p80/p95 delta workdays, probability of improvement, and changed criticality. A negative finish-date delta means earlier completion and is labeled explicitly. The comparison never describes an association as causal.

User-facing explanation is generated after numeric completion from this structured result and accessible evidence. It must preserve numbers exactly, cite estimate/dependency evidence, identify confirmed imputations, explain that p80 means 80% of simulated outcomes finish on or before the shown date under assumptions, and include the data watermark. Any model explanation that changes or omits required numeric fields is rejected.

## 8. Validation and edge cases

Validation occurs before sealing and again before execution:

| Case | Required result |
|---|---|
| Cycle or self-edge | `422 invalid_dependency_cycle` with a deterministic shortest cycle path; no run. |
| Missing task endpoint | `422 unknown_task_reference`; no implicit task creation. |
| Invalid/NaN/infinite/reversed duration | `422 invalid_duration`; no clamping. |
| Missing estimate | Sealing blocked unless the user confirms the documented imputation. |
| Completed task after `as_of` | `422 invalid_actual_finish`. |
| Cancelled task has nonzero duration or an unresolved active dependency | `422 unresolved_cancelled_work`; require a source correction or confirmed snapshot-compilation exclusion. |
| Earliest start after target | Run is allowed with `target_infeasible_from_constraints` warning and probability computed normally. |
| Target before project start | Probability is zero and a warning is returned. |
| Empty project | Completes at `as_of` with no critical path. |
| Disconnected task group | Included; warning lists independent terminal groups. |
| Duplicate dependency | Greatest lag retained with warning; contradictory add/remove scenario operations are rejected. |
| Calendar has no working day or invalid timezone | `422 invalid_calendar`. |
| Missing team, non-integer/zero capacity, or availability outside `(0,1]` | `422 invalid_team_capacity`; no value is inferred from people or activity data. |
| Graph above H1 limits | `413 simulation_too_large` with actual limits; no partial hidden sampling. |
| Run cancellation | Stop between bounded batches, store `cancelled`, discard incomplete quantiles, retain progress and audit metadata. |
| Worker retry | Resume at a batch boundary; deterministic streams and result-part hashes prevent duplicate or changed samples. |
| Snapshot ACL revoked | Prevent result access and explanation; numeric artifact remains governed by deletion/retention policy. |

Contradictory source claims are not silently resolved by the engine. Snapshot compilation uses the CH-05 predicate precedence rule, includes conflicts and the selected claim, and requires confirmation when a conflict changes scheduling input.

## 9. Performance, caching, and observability

The H1 cache key is:

```text
SHA-256(RFC8785({snapshot_hash, scenario_hash, seed, sample_count, engine_version}))
```

Only a completed, checksum-verified result is cacheable. Authorization is always evaluated on access; cache membership is not permission. Different tenants never share result objects, even for identical synthetic content. Progress checkpoints store completed batch IDs and hashes, not an evolving final percentile.

The engine stores aggregate results by default, not every sample. Debug or validation runs may retain compressed sample arrays for 7 days under restricted access. Normal H1 result metadata follows scenario retention; deleting a snapshot removes dependent cached results after an immediate deny barrier.

Metrics include queue time, validation time, task/edge/iteration counts, sample throughput, schedule throughput, run duration, cancellation latency, cache hit, invalid input by code, batch quantile variation, result size, and numeric warnings. Traces record snapshot/scenario/result hashes, engine/container versions, seed, batch IDs, and timing; task labels and source text are excluded.

## 10. Verification and acceptance

### 10.1 Deterministic and analytic tests

- A constant one-task project finishes exactly after its duration on the sealed calendar.
- A constant serial chain finishes after the sum of task durations and lags.
- A fork/join with sufficient team slots finishes after the maximum branch plus the join task; one slot serializes same-team branches in stable order.
- Completed and cancelled tasks follow Section 3.2 without consuming random draws.
- Weekends, holidays, fractional workdays, leap years, and daylight-saving boundaries match golden calendars.
- Beta-PERT sample moments converge to analytic expectations within predefined statistical tolerance.
- Quantile type 7 matches golden vectors, including one-element and repeated-value samples.
- Stable seed and engine image produce byte-identical result JSON across 1, 2, and 8 workers and after batch retry.
- Equal baseline and scenario produce exactly zero paired deltas. Shifting all three bounds by the same delta shifts that task's sampled duration exactly under common random numbers; project-finish monotonicity is asserted only for serial or unconstrained-capacity fixtures because resource-constrained priority schedules can exhibit scheduling anomalies.
- Increasing aggregate parallel capacity cannot delay a fixture under the stable scheduling heuristic; reducing availability cannot improve it.

### 10.2 Acceptance criteria

| ID | Acceptance criterion |
|---|---|
| AC-SIM-001 | A sealed run can be independently replayed from snapshot, scenario, seed, sample count, engine image, and calendar to the same result hash. |
| AC-SIM-002 | Cycles, invalid ranges, missing estimates, impossible capacity, unknown work items, disconnected work, contradictory interventions, and malicious numbers produce explicit stable outcomes. |
| AC-REL-001 | The frozen 50,000-trial workload meets the 10-second p95 target with CPU and memory recorded in the benchmark artifact. |
| AC-TEN-001 | The `tnt_aster` run and its cache, trace, explanation, and citations contain no `tnt_beacon` identifier, evidence, or timing disclosure. |
| AC-PROD-001 | The real run, not a substituted fixture result, reproduces Section 4.1 golden dates within tolerance and supports the five-minute demo journey. |

The result contract additionally requires p50/p80/p95, target probability, critical path/criticality, blockers, sensitivity, assumptions, missing data, evidence, exact numeric explanation, revocation behavior, and one audited terminal state. Independent review traces every estimate, dependency, calendar override, team capacity, and intervention to evidence or explicit confirmation.

Property-based tests generate DAGs, calendars, scenario diffs, and valid/invalid PERT triples. Metamorphic tests check input-list/topological-order invariance for the same DAG, work-item stream isolation, exact common-random-number duration shifting, schedule monotonicity only for serial or unconstrained-capacity fixtures, dependency removal non-delay under those same controlled fixtures, and batching invariance. Separate resource-constrained fixtures record priority/resource-order changes rather than assuming global monotonicity. Fuzz tests cover canonical JSON, timestamps, extreme finite numbers, duplicate IDs, and malicious labels. Performance tests run the frozen workload at 25,000, 50,000, and 75,000 trials; separate guardrail tests cover the 5,000-work-item and 20,000-edge input maxima without claiming the demo latency SLO at that maximum shape.

## 11. Risks and evolution

| ID | Risk | Mitigation |
|---|---|---|
| RSK-011 | Users interpret a simulated percentile, capacity input, or blocker score as a precise causal forecast. | Plain-language percentile semantics, evidence/assumptions, distribution, sampling error, synthetic disclaimer, and no causal language. |
| RSK-016 | Synthetic estimates and golden dates are mistaken for external predictive validity. | Limit claims to reproducibility/system behavior and require design-partner calibration before production accuracy claims. |
| RSK-007 | Aggregate capacity is repurposed into unsafe person or workforce scoring. | Exclude person inputs/rates, prohibit employment outcomes, govern schemas/outputs, and require a separate research program. |

Numeric-library or runtime changes can still break reproducibility. The mandatory mitigation is a versioned engine/container, counter-based streams, golden vectors, side-by-side migration, and replay support for prior engine images.

H2 may add shared aggregate resource pools, calibrated correlation factors, additional dependency types, preemption rules, and portfolio interactions only behind new schemas, equations, validation datasets, and compatibility versions. Financial, customer, security, market, workforce, and autonomous-organization simulations remain Research until each has a lawful purpose, validated data-generating model, uncertainty contract, human oversight, and explicit release gate.
