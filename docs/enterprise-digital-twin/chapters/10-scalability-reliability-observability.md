---
id: CH-10
title: Scalability, Reliability, and Observability
status: Committed
version: 1.0.0
owners:
  - Site Reliability Engineering
  - Platform Engineering
  - Data Engineering
last_reviewed: 2026-07-13
---

# Scalability, Reliability, and Observability

## 1. Scope and scale posture

The platform must meet the committed H1 and H2 envelopes and expose measured transition points for later horizons. It does not claim support for millions of organizations, billions of graph nodes, trillions of edges, petabytes of documents, thousands of concurrent agents, active-active multi-cloud, or edge autonomy. Those are H5 research topics until representative workloads, economics, consistency, privacy, and operations are proven.

Scale is achieved first by bounded work, tenant quotas, stateless horizontal application replicas, PostgreSQL tuning and partitioning, per-tenant graph placement, and asynchronous workflows. A new datastore or broker is a last step after measurement, not the first response to a forecast.

## 2. Committed capacity envelopes

| Dimension | H1 Hackathon | H2 Design-partner pilot | H3 and later |
|---|---|---|---|
| Tenants | Exactly two synthetic tenants in acceptance environment | Up to 10 production tenants | Freeze from pilot telemetry and benchmark before commitment |
| Human identities | Up to 100 per tenant | Up to 1,000 authenticated users aggregate across the pilot | No published claim until frozen |
| Concurrent interactive users | 10 aggregate | 100 aggregate test load, with no tenant above 50 | Derive from observed concurrency |
| Graph size | 100,000 nodes and 1,000,000 edges per tenant | 1,000,000 nodes and 10,000,000 edges per tenant | Benchmark-gated topology |
| Connector scope | GitHub metadata read-only; Jira read plus one controlled remediation update | Same core connectors with production recovery, scope and revocation controls | Connector catalog expands through manifests and conformance tests |
| Sync freshness | Full reconciliation interval at most 15 minutes | 99 percent of healthy-provider source changes visible within 15 minutes | Contract by connector tier |
| Interactive non-AI query | p95 below 2 seconds | p95 below 2 seconds at the H2 load shape | Freeze per query class |
| Cited answer | p95 below 20 seconds on accepted evaluation set | p95 below 20 seconds when approved model endpoint is healthy | Separate model and platform SLOs |
| Interactive simulation | p95 below 10 seconds for the frozen 50,000-trial Orion workload | p95 below 10 seconds for the same committed reference workload at H2 concurrency | Larger or maximum-shape runs are asynchronous and have no 10-second claim |
| Availability | Demonstration acceptance target, not a production SLA | 99.9 percent monthly for the regional service | Freeze by deployment profile |
| Recovery | Re-seed synthetic data; documented backup/restore | RPO at most 1 hour; RTO at most 4 hours | Regional and isolation targets frozen later |

The H2 "1,000 users" commitment is interpreted as aggregate across the ten-tenant pilot because the approved horizon did not state per tenant. Raising it to per tenant is a material capacity change and requires a QAR update and benchmark.

### 2.1 Reference load shapes

Performance results are valid only with the following published shape and a representative data distribution:

- H1 interactive: 10 concurrent sessions, 70 percent bounded reads, 10 percent graph traversals, 10 percent scenario operations, 5 percent cited-answer starts, and 5 percent administration; up to two simultaneous simulations and two cited answers.
- H2 interactive: 100 active sessions, up to 50 simultaneous HTTP requests, 70 percent bounded reads, 10 percent graph traversals, 8 percent scenario operations, 5 percent cited-answer starts, 2 percent connector administration, and 5 percent SSE/status traffic; up to 20 simultaneous cited answers and 10 simulations across tenants.
- H1 simulation performance: the frozen Orion fixture runs exactly 50,000 trials and must meet the 10-second p95 objective.
- Simulation guardrail: at most 5,000 tasks and 20,000 dependency edges. This maximum-shape class is asynchronous and has no demo latency claim. Performance regression tests also exercise 25,000 and 75,000 trials around the committed 50,000-trial case.
- Ingestion benchmark runs connector reconciliation concurrently with the interactive load and includes duplicates, tombstones, ACL changes, and a 10 percent payload-change rate.
- Data cannot be uniformly random. Benchmarks include high-degree graph hubs, long-tail text sizes, skewed tenant activity, shared provider rate limits, stale projections, and source ACL fan-out.

## 3. Service level indicators and objectives

### 3.1 Measurement rules

A valid request enters at the API after TLS termination and ends when the complete response is written or a persisted asynchronous run ID is accepted. Browser network time is measured separately. Invalid authentication, forbidden access, schema-invalid requests, and intentional client cancellation are excluded from availability; service-generated 429, 5xx, deadline expiration, unavailable dependency, and incorrect success count as bad events.

Latency objectives apply only within documented input limits. A response rejected before work because it exceeds a published limit is not a latency violation, but undocumented or incorrectly enforced limits are defects. Planned maintenance counts against availability unless the customer contract explicitly excludes it.

| Catalog QAR | SLI | H1 gate | H2 objective and window |
|---|---|---|---|
| QAR-PERF-001 | Good valid interactive API responses / all valid interactive API requests | p95 under 2 s and p99 under 5 s at H1 load | 99.9 percent good and p95 under 2 s monthly |
| QAR-PERF-003 | Cited answers completed, verified, and streamed before deadline / accepted cited-answer runs | At least 95 percent under 20 s | At least 95 percent under 20 s over rolling 28 days while model endpoint SLI is healthy |
| QAR-PERF-002 | Frozen 50,000-trial Orion simulations completed before deadline / accepted reference runs | At least 95 percent under 10 s | At least 95 percent under 10 s over rolling 28 days at H2 concurrency |
| QAR-SYNC-001 | Healthy-provider observations queryable with required projection watermark within 15 min / observed provider changes | 99 percent, and the scripted demo completes within 60 s | 99 percent rolling 7 days |
| QAR-SEC-003 and QAR-COR-001 | Sensitive Jira executions with one terminal receipt and no duplicate effect / accepted grants | 100 percent | 100 percent; any duplicate is Severity 1 |
| QAR-SEC-002 | Revocations blocked immediately and fully projected within the horizon target / accepted revocations | 100 percent blocked immediately, 95 percent projected within 15 min | 100 percent blocked immediately, 99 percent projected within 5 min |
| QAR-OBS-001 | Audit roots exported and verified within 15 min / closed audit periods | 100 percent | 99.9 percent monthly; no lost events |
| QAR-AVL-001 | Regional service availability | Demonstration run completes | 99.9 percent monthly |
| QAR-DR-001 | Restore point age and recovery time | Restore rehearsal documented | RPO at most 1 hour and RTO at most 4 hours |
| QAR-SYNC-001 and QAR-COR-001 | Graph projection after committed normalization and full H1 rebuild | Normal projection within 60 s; full tenant rebuild within 15 min | Pilot target is measured and frozen before H2 exit; revocation still blocks immediately |

At 99.9 percent monthly availability, the nominal 30-day error budget is 43 minutes 12 seconds. The SRE dashboard computes the exact budget from the measurement window.

### 3.2 Error-budget policy

- A 14.4x one-hour or 6x six-hour burn pages the service owner.
- A 2x three-day burn opens an incident and blocks unrelated risk-increasing production releases.
- Exhausting the monthly budget freezes feature promotion until reliability is restored or the accountable owner and customer approve a documented exception.
- Security isolation, duplicate mutation, audit loss, and deletion failure are correctness incidents and have no error budget.
- External model/provider availability is shown separately, but the product still reports the user-visible failure. Dependency exclusion cannot hide platform retry, timeout, or degradation defects.

## 4. Resource budgets and admission control

Every request or workflow reserves a tenant budget before work:

| Resource | H1/H2 enforcement |
|---|---|
| HTTP body | Endpoint schema limit; default 1 MiB, webhooks 10 MiB raw maximum unless provider contract is lower |
| Pagination | Default 50, maximum 200 records; opaque cursor; no unbounded export in request path |
| Graph traversal | Maximum 4 hops, 10,000 visited nodes, 50,000 visited edges, 5,000 returned UI/API elements, and 2 s database time; AI retrieval further caps the envelope at 500 graph nodes |
| Vector retrieval | Maximum 200 candidates before exact tenant/ACL post-filter and maximum 40 evidence chunks in a model envelope |
| Model context | Capability-specific token budget recorded before call; no automatic unlimited retry or context growth |
| Simulation | Frozen 50,000-trial workload for the interactive SLO; 5,000-task/20,000-edge maximum accepted asynchronously; CPU/memory/trial reservation and cancellation between bounded batches |
| Connector | Per-tenant and per-provider page concurrency, bytes/minute, request/minute, and workflow deadline |
| Export | Asynchronous only, one active export per tenant in H1 and configurable H2 quota |
| Jira action | One target issue per grant, one in-flight action per issue, and a tenant mutation rate limit |

Admission returns a safe 413, 422, 429, or 503 problem response with limit and retry guidance. It cannot enqueue work that has no bounded completion or cancellation path.

Backpressure order is:

1. Stop research and optional enrichment.
2. Delay embeddings and non-urgent graph projection.
3. Preserve high-priority permission revocation, tombstones, action reconciliation, and audit export.
4. Shed new AI and simulation work per tenant.
5. Preserve authentication, authorization, health, cancellation, kill switch, and incident access as long as PostgreSQL is healthy.

Noisy-neighbor controls exist at API concurrency, Temporal task queues, provider requests, model calls, simulation workers, database connection pools, and graph queries. A tenant cannot consume reserved capacity for security control paths.

## 5. Scaling strategy and transition triggers

| Component | H1/H2 scaling method | Evidence that triggers a change |
|---|---|---|
| Web/API | Stateless replicas, autoscaling on concurrency and latency, bounded connection pools | Sustained p95 above target after query and pool tuning |
| Sync worker | Per-provider and per-tenant Temporal task queues; replicas scale on oldest task age | Oldest healthy task over 2 min for 15 min with provider capacity available |
| Intelligence worker | Separate queues for extraction, query, simulation, and evaluation; CPU/memory and model concurrency quotas | Queue delay consumes 20 percent of user deadline or utilization above 70 percent for 30 min |
| PostgreSQL | Query/index tuning, connection pooling, time/range partitioning for audit/outbox, vertical scaling, read replicas only for staleness-tolerant reads | Primary CPU above 65 percent or storage latency above target for 30 min at representative peak after tuning |
| pgvector | Tenant-prefiltered indexes, dimensionality/corpus review, partitioning, tuned candidate count | Recall target and p95 cannot both pass, or vector workload materially harms OLTP |
| Neo4j | Tenant placement, memory/page-cache sizing, query-plan review, read replicas where supported | Tenant graph exceeds tested envelope or p95 traversal exceeds 1 s after query/index tuning |
| Outbox | Batch dispatch, partitioning, retention, consumer checkpoints | Sustained publish load exceeds safe PostgreSQL budget, replay window exceeds retention budget, or 3 independent high-throughput consumers need streams |
| Object storage | Managed elastic service, multipart upload, lifecycle policies | No application sharding before provider limits are measured |
| Valkey/Redis | Replica/failover, bounded TTL, key eviction policy, tenant quotas | Cache hit or limiter latency affects API objective; correctness remains independent |
| Search | PostgreSQL text search and pgvector first | Introduce OpenSearch only under the benchmark gate in CH-04 |
| Analytics | PostgreSQL operational reports first | Introduce ClickHouse/lakehouse only when governed analytics load harms operational state |

H3 targets require a pilot capacity report containing per-tenant distributions, peak-to-average ratios, growth, query classes, model cost, provider quotas, database/graph working sets, failure history, operational staffing, and total cost. A percentile without the input distribution is not valid evidence.

## 6. Distributed-systems semantics

### 6.1 Delivery, ordering, and idempotency

- Webhooks, outbox events, and Temporal activities are at least once.
- The webhook inbox unique key is provider installation plus provider delivery ID. Reused IDs with a different content hash are quarantined.
- Each aggregate has a monotonically increasing version within a tenant. Events include tenant, aggregate ID, aggregate version, event ID, causation ID, and trace context.
- Consumers transactionally insert an inbox receipt and apply an effect. A duplicate returns the prior outcome.
- Older aggregate versions cannot overwrite newer state. Gaps pause that aggregate and request reconciliation rather than guessing.
- Connector cursor, observations, and publication commit atomically. A page failure cannot advance the cursor.
- Idempotency records retain request digest and terminal response. Reusing a key with a different digest returns 409.
- The Jira worker does not retry an ambiguous mutation. It reconciles provider state and receipt evidence before any repeat.

### 6.2 Timeouts, retries, and circuit breaking

| Operation | Attempt timeout | Retry contract |
|---|---|---|
| PostgreSQL interactive statement | 1.5 s | Serialization/deadlock only, maximum 5 attempts with full jitter from 25 to 400 ms inside request deadline |
| Neo4j interactive traversal | 2 s | One retry only for a clearly transient connection failure and only if watermark remains valid |
| Valkey cache | 100 ms | No retry in interactive path; bypass cache |
| Provider GET/page | Connect 3 s, read 20 s, total 30 s | Up to 8 attempts with full jitter, 1 s to 5 min, respecting Retry-After and workflow deadline |
| Model cited answer call | Capability deadline at most 15 s within 20 s run | At most one safe retry or evaluated fallback if remaining deadline permits |
| Simulation activity | 9 s for interactive class | No blind retry after deterministic compute error; infrastructure retry uses same snapshot and seed |
| Jira mutation | Connect 3 s, total 20 s | Retry only when no request bytes were accepted or provider idempotency/reconciliation proves no effect |
| Projection event | 30 s | Exponential retry up to 20 attempts, then tenant-scoped dead-letter state and alert |
| Audit export | 30 s | Durable retry until retention deadline; failure pages before 15 min |

A dependency circuit opens after at least 20 calls and more than 50 percent eligible failures over 30 seconds, remains open for 30 seconds, then permits bounded probes. Security denials, 4xx validation, and tenant quota rejections do not trip dependency circuits. Circuit state is per provider/region and tenant where a tenant credential can be the cause.

Retries always consume a deadline and budget. There are no infinite hot retries. Durable workflows can schedule a later reconciliation after terminal operational failure, but the original run reaches an explicit terminal or intervention state.

## 7. Dependency failure semantics

| Failure | User-visible and system behavior | Recovery signal |
|---|---|---|
| PostgreSQL primary unavailable | Stateful API returns 503; workers pause before effects; no projection-only writes; sensitive commands are rejected | Successful primary transaction plus replica/backup health |
| PostgreSQL failover | Clients reconnect with jitter; uncertain transactions reconcile by idempotency key; no manual replay until status known | New primary writable, lag and RLS checks pass |
| Neo4j unavailable | Graph queries/simulations report graph_unavailable; non-graph administration remains available; projection events remain durable | Projection reaches required watermark and integrity check passes |
| Neo4j corrupted or divergent | Quarantine tenant projection, rebuild shadow graph from PostgreSQL, compare counts/hashes/ACL, switch alias | Rebuild acceptance report |
| Object store unavailable | Inbox can remain durable, but source observation and cursor do not claim captured payload; ingestion backs off | Content hash write/read verification passes |
| Valkey unavailable | Cache bypass; durable fallback limiter for sensitive writes or fail closed; latency may degrade | Cache probe and limiter parity pass |
| Temporal unavailable | API persists eligible commands plus outbox and returns run ID; expiring commands fail if safe dispatch cannot occur; workers resume from history | Namespace and task queue healthy |
| Identity provider unavailable | Existing unexpired sessions can continue within tenant policy; new login and high-risk recent-auth checks fail closed | Issuer/JWKS and authentication probe pass |
| KMS/secret manager unavailable | Cached short-lived decrypt grants may finish already authorized reads; new connector/model/action secret use fails closed | Key decrypt and audit probe pass |
| GitHub/Jira unavailable or rate limited | Preserve prior versions, mark source freshness degraded, respect Retry-After, reconcile later | Successful scoped probe and cursor progress |
| Model provider unavailable | Cited answer fails with safe retry guidance; deterministic search and simulation remain available; no unapproved model | Evaluated model health and schema probe pass |
| OpenTelemetry collector unavailable | Bounded local buffer then drop ordinary telemetry with counter; security audit remains in PostgreSQL and independent export | Collector export success; dropped count alert |
| Network partition | Minority/unreachable workload stops writes; no split-brain application authority; retry after endpoint discovery | Authoritative primary and workflow ownership confirmed |
| Clock drift | Above 500 ms alerts; above 2 s workload becomes unready for approvals, expiry, signatures, and ordered events | NTP offset below threshold for 5 min |

Partial answers must name missing sources and freshness. The product cannot convert "source unavailable" into "no risk found."

## 8. High availability

H2 reference deployment uses:

- at least two web, API, sync-worker, and intelligence-worker replicas across failure zones;
- topology spread, pod disruption budgets, graceful termination, and readiness before traffic;
- PostgreSQL multi-zone primary/standby with automated failover and point-in-time recovery;
- Temporal production cluster or managed service with multi-zone persistence;
- Neo4j topology appropriate to the licensed deployment and tenant envelope, with rebuildability as the final recovery control;
- managed multi-zone S3-compatible object durability and versioning;
- Valkey/Redis primary/replica or managed failover, with correctness independent of it;
- redundant ingress, DNS, OpenTelemetry collectors, and identity/key service endpoints.

The deployment is single-writer per authoritative PostgreSQL database. H2 does not claim active-active regions. During failover, availability is preferred only when consistency and tenant isolation remain provable.

Deployments drain work safely:

1. Mark replica unready.
2. Stop accepting new requests or Temporal activities.
3. Finish or heartbeat/cancel in-flight work before termination grace.
4. Release database/graph connections.
5. Let Temporal reassign uncompleted activities; idempotency handles replay.

## 9. Backup, disaster recovery, and corruption

### 9.1 H2 recovery plan

| Asset | Backup or reconstruction | RPO contribution | Recovery order |
|---|---|---|---|
| PostgreSQL business database | Continuous WAL/archive plus daily full backup, encrypted and immutable for retention window | At most 1 hour, target 15 min | 1 |
| Temporal persistence | Managed/cluster database backup coordinated with workflow namespace | At most 1 hour | 2 |
| S3-compatible evidence | Versioning and approved-region replication or immutable backup | At most 1 hour for new objects | 3 |
| Neo4j | Rebuild from restored PostgreSQL; optional backups shorten RTO | No independent RPO | 4 |
| Valkey/Redis | Rebuild or fail over | No business-data RPO | 5 |
| Configuration and policy | Git plus signed release artifacts; Restricted config from secret manager backup | Last approved change | Before application traffic |
| Audit root ledger | Independently retained signed roots and audit export | No accepted event loss | Verified before reopening sensitive actions |

Backups use separate credentials, encryption keys, accounts/projects where supported, and deletion protection. A backup job success is not restore proof.

Recovery procedure:

1. Declare incident, choose an approved recovery region within tenant residency, and freeze writes and connector credentials.
2. Restore infrastructure and secrets from reviewed code and secret-manager recovery.
3. Restore PostgreSQL and Temporal to a mutually consistent point no older than one hour. If workflow histories are newer, reset/reconcile workflows from business idempotency state.
4. Restore/verify object hashes, replay deletion and revocation tombstones newer than the selected restore point, and prevent any erased data from becoming queryable.
5. Rebuild shadow graph/vector/search projections, validate tenant counts, hashes, ACL coverage, and checkpoints.
6. Reconcile connector cursors and every in-flight external action before enabling workers.
7. Validate RLS, tenant negative tests, audit chain/root, KMS, IdP, health, and synthetic user journeys.
8. Reopen read traffic, then background processing, then AI, and finally external mutation after explicit incident approval.

H2 runs a monthly component restore and a quarterly full recovery exercise. The full exercise must demonstrate RPO and RTO with measured timestamps. An annual exercise includes loss of the primary region when the tenant residency contract permits a recovery region. If residency forbids any second region, the customer-facing recovery commitment must state that constraint before onboarding.

Database corruption uses point-in-time recovery to a shadow environment, integrity checks, and controlled cutover. No operator repairs authoritative rows from a graph or cache.

## 10. Observability contract

### 10.1 Signals and correlation

OpenTelemetry is mandatory in all workloads. A request ID and W3C trace context flow through HTTP, outbox events, Temporal workflows, provider calls, graph queries, model calls, and action receipts. Logs contain trace_id and span_id. Tenant appears as a pseudonymous bounded identifier only where needed; actor and source content do not become metric labels.

Required span classes are:

- http.server and http.client;
- db.postgresql.query with normalized operation, not raw SQL;
- db.neo4j.query with template ID, not Cypher text;
- temporal.workflow and temporal.activity;
- connector.fetch, connector.normalize, projection.apply;
- retrieval.relational, retrieval.vector, retrieval.graph, evidence.authorize;
- ai.responses, ai.tool, ai.verify;
- simulation.compile and simulation.run;
- approval.decide, action.execute, action.reconcile, action.compensate;
- audit.append and audit.export.

### 10.2 Required metrics

| Metric family | Required dimensions | Purpose |
|---|---|---|
| edt_http_requests_total and edt_http_duration_seconds | route template, method, status class, workload, region | Availability and latency |
| edt_sse_connections and edt_run_event_lag_seconds | run type, region | Streaming health |
| edt_db_pool and edt_db_statement_duration_seconds | workload, operation class, outcome | Pool saturation and slow queries |
| edt_outbox_oldest_seconds, edt_outbox_pending, edt_inbox_duplicates_total | event class, consumer | Event backlog and duplication |
| edt_temporal_task_queue_delay_seconds and edt_activity_failures_total | queue, activity class, outcome | Workflow saturation |
| edt_source_age_seconds and edt_connector_requests_total | provider, connector state, outcome | Freshness and provider health |
| edt_projection_lag_events and edt_projection_lag_seconds | projection type, region | Graph/vector/search convergence |
| edt_revocation_blocked_reads_total and edt_revocation_projection_seconds | store class, outcome | Permission safety |
| edt_graph_query_duration_seconds and edt_graph_budget_exceeded_total | query template, outcome | Traversal performance and abuse |
| edt_ai_run_duration_seconds, edt_ai_tokens_total, edt_ai_cost_units, edt_ai_failures_total | capability, pinned model ID, outcome | Quality, latency, and cost |
| edt_citation_verification_total and edt_abstentions_total | capability, outcome/reason | Grounding safety |
| edt_simulation_duration_seconds and edt_simulation_samples_total | engine version, input class, outcome | Simulation capacity and reproducibility |
| edt_approval_state_total and edt_action_state_total | action type, state/reason | Approval funnel and mutation correctness |
| edt_rate_limit_total and edt_budget_rejections_total | capability, reason | Abuse/noisy-neighbor detection |
| edt_audit_export_lag_seconds and edt_audit_integrity_failures_total | region, outcome | Audit recoverability |
| edt_backup_age_seconds, edt_restore_duration_seconds, edt_rebuild_lag_seconds | asset, region, outcome | Recovery readiness |

Metrics must not label raw tenant ID, actor, resource ID, issue key, provider object ID, prompt, evidence ID, or error message. Per-tenant operational investigation uses access-controlled logs or an on-demand bounded view.

### 10.3 Structured logs

Each log has timestamp, severity, service, release, environment, region, event_name, safe message, request/trace/span IDs, workflow/run ID where applicable, pseudonymous tenant key where permitted, operation class, outcome, stable error code, retryability, and duration. Logs never contain request bodies, source text, prompts, model output, tokens, cookies, authorization headers, secrets, raw SQL/Cypher, or unredacted provider responses.

Errors and all approval/action/security events are traced at 100 percent. Ordinary successful traffic uses head sampling with tail retention for slow or anomalous traces. Sampling cannot affect authoritative audit.

### 10.4 Health endpoints

| Endpoint | Meaning |
|---|---|
| /health/live | Process event loop and internal deadlock watchdog are responsive; it does not call dependencies |
| /health/ready | Workload can safely accept its class of work, required tenant-neutral configuration is loaded, clock is within 2 s, and required authoritative dependency is reachable |
| /health/startup | Migrations/config compatibility and warmup are complete |
| /health/dependencies | Authenticated operator view of dependency, circuit, queue, watermark, and last success; never public and never includes secrets |

Neo4j failure does not make an administration-only API replica unready, but graph routes return explicit dependency status. Worker readiness is queue-specific where the orchestrator supports it.

## 11. Alerts and runbooks

Paging alerts require an actionable runbook, owner, severity, dashboard, and clear condition. Required pages include:

- SLO fast or slow burn;
- any cross-tenant canary or RLS test failure;
- any duplicate or unauthorized external mutation;
- audit integrity failure or export lag over 15 minutes;
- revocation blocked-read failure or projection over 5 minutes;
- oldest outbox/task age threatening the 15-minute freshness objective;
- PostgreSQL availability, replication, corruption, storage, or connection exhaustion;
- KMS/secret failure affecting security paths;
- backup age over 1 hour or failed restore rehearsal;
- global provider failure only when user impact or data freshness crosses objective.

Capacity warnings are tickets, not pages, unless exhaustion is imminent. Runbooks include impact, safety invariant, immediate containment, dashboards/queries, dependency status, recovery, reconciliation, customer communication owner, evidence preservation, and exit checks.

## 12. Acceptance criteria

| Evidence ID | Canonical acceptance | Criterion |
|---|---|---|
| TC-REL-001 | AC-REL-001 | H1 and H2 benchmark reports use the exact capacity envelope and load shapes in this chapter and meet every applicable latency/freshness threshold. |
| TC-REL-002 | AC-DATA-001, AC-ACT-002, and AC-REL-003 | Outbox, inbox, workflow, projection, simulation, and Jira action tests prove idempotency under duplicate, delayed, reordered, and crash-after-effect delivery. |
| TC-REL-003 | AC-REL-001 and AC-TEN-001 | Saturating one tenant cannot violate another tenant's interactive or revocation budget at the stated load. |
| TC-REL-004 | AC-REL-003 | PostgreSQL, Neo4j, object, Valkey, Temporal, IdP, KMS, connector, model, telemetry, and network faults produce the documented fail-closed or degraded behavior. |
| TC-REL-005 | AC-DATA-002 | A graph corruption exercise rebuilds a shadow projection and validates tenant counts, evidence hashes, ACL coverage, and watermark before cutover. |
| TC-REL-006 | AC-REL-002 | H2 restore evidence demonstrates no more than one hour of authoritative loss and service recovery within four hours, including tombstone replay and in-flight action reconciliation. |
| TC-REL-007 | AC-OBS-001 | SLO dashboards derive from documented SLIs, and synthetic bad events demonstrably consume error budget and trigger the expected alerts. |
| TC-REL-008 | AC-OBS-001 | Every required trace crosses API, outbox/Temporal, data stores, model/provider calls, and terminal run state without exposing Restricted content. |
| TC-REL-009 | AC-REL-003 and AC-OBS-001 | Health probes distinguish process, readiness, startup, and dependency degradation and do not cause restart loops during external outages. |
| TC-REL-010 | AC-OBS-001 and AC-REL-003 | Every page has an exercised runbook, owner, dashboard, safe containment, reconciliation, and exit criteria. |
| TC-REL-011 | AC-DOC-002 and AC-REV-001 | A pilot exit report freezes or explicitly leaves provisional each H3 scale/SLO/cost/isolation/residency/DR target from measured evidence. |
