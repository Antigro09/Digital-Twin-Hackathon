---
id: CH-03
title: System Architecture
status: Committed
version: 1.0.0
owners:
  - Architecture
  - Platform Engineering
last_reviewed: 2026-07-13
---

# System Architecture

## 1. Purpose and normative interpretation

This chapter defines the deployable architecture for the Enterprise Digital Twin. "Must" and "must not" are release requirements. "Should" records the default, and an exception requires an ADR. PostgreSQL is the system of record. Neo4j, pgvector indexes, caches, and future search or analytics stores are derived projections and can be rebuilt.

The product has two tracks:

- H1 and H2 are committed, production-shaped delivery horizons with measurable limits.
- H3 and H4 are provisional until pilot evidence freezes their targets.
- H5 is research and cannot be represented as available or production-ready.

The exhaustive source prompt asks for microservices, a service mesh, Kafka, NATS, event sourcing, active-active multi-cloud, and hyperscale operation. Those are not simultaneous H1 requirements. The committed design is a modular monorepo with four independently deployable application workloads, durable Temporal workflows, and a PostgreSQL transactional outbox. Additional infrastructure is introduced only at the triggers in [Technology Stack](04-technology-stack.md). This resolves the conflict in favor of the smallest architecture that preserves enterprise invariants and has an explicit scale path.

## 2. Context and trust boundaries

The system serves authenticated users and administrators, receives untrusted events from GitHub and Jira, calls those providers, invokes approved model endpoints, and persists data in isolated tenant namespaces.

| Boundary | Trusted side | Untrusted side | Required enforcement |
|---|---|---|---|
| Browser to web/API | Server-rendered application and API | Browser state, URLs, cookies, uploads | OIDC session validation, CSRF protection, input schemas, output encoding, CSP |
| Provider to webhook endpoint | API after signature and replay validation | All webhook bytes and headers | Provider signature, timestamp window, delivery-id inbox, size limit |
| Connector worker to provider | Worker credential broker | Provider response and availability | Per-tenant credentials, egress allowlist, schema validation, retry budget |
| Application to data stores | Workload identity and tenant transaction context | User-selected tenant identifiers | Server-derived tenant context, RLS, tenant-qualified keys, least-privilege roles |
| Retrieval to model | Authorized evidence envelope | Connector text and model output | ACL filtering before prompt construction, content/instruction separation, structured output validation |
| Action executor to Jira | Approved exact payload | Model proposals and mutable provider state | Allowlisted project, two-person approval, payload digest, idempotency, before/after evidence |
| Tenant to tenant | Tenant-specific principals and keys | Every other tenant | No shared retrieval, merge, memory, analytics, cache entry, or training corpus |

## 3. Deployment units and ownership

There are exactly four first-party OCI application workloads in H1 and H2. PostgreSQL, Temporal, Neo4j, S3-compatible object storage, Valkey/Redis, the identity provider, and the OpenTelemetry collector are infrastructure dependencies, not additional product microservices.

| Workload | Runtime | Owns | May read | Must not do |
|---|---|---|---|---|
| Web application | Next.js, React, TypeScript | Browser UI, server-side rendering, session UX, SSE client, accessibility and visualization shell | Public configuration and API responses | Connect to databases, providers, Temporal, or model APIs; derive authorization from client state |
| API | NestJS on Fastify, TypeScript | REST commands and queries, signed webhook ingress, OIDC session validation, policy enforcement, connector administration, scenario commands, approvals, audit query API, SSE run status | Control schemas, authorized claims/evidence, projection status | Run long jobs inline; accept a client tenant as authoritative; write another workload's tables |
| Synchronization worker | TypeScript, Temporal worker | GitHub/Jira adapters, polling and reconciliation, inbox/outbox dispatch, normalization, cursors, tombstones, graph projection, approved Jira execution and compensation | Connector configuration, durable workflow commands, source payload references | Invoke models; merge identities across tenants; mutate Jira without a valid action grant |
| Intelligence worker | Python, Temporal worker | Extraction, entity resolution decisions, embeddings, bounded graph analysis, cited answer generation, simulation, AI evaluations | Authorized evidence bundles, graph projections, scenario snapshots | Fetch arbitrary URLs; expand caller authority; execute external mutations; expose private reasoning traces |

Infrastructure processes can scale independently, but no new first-party deployable is created without an ADR that demonstrates an ownership, scaling, security, or availability boundary that the four workloads cannot satisfy.

### 3.1 Database write ownership

All schemas contain tenant_id where data is tenant-scoped. A workload uses a distinct non-superuser database role. FORCE ROW LEVEL SECURITY applies to tenant tables. Cross-owner writes are prohibited even if a role could technically be granted access.

| Schema group | Authoritative writer | Representative records |
|---|---|---|
| control | API | tenants, memberships, delegations, connector installations, scenarios, approvals, action grants, audit index |
| ingest | Synchronization worker | webhook inbox, source objects, normalized observations, sync cursors, tombstones, projection checkpoints |
| knowledge | Intelligence worker | claims, evidence links, resolution decisions, entity versions, embedding metadata |
| simulation | Intelligence worker | immutable simulation snapshots, runs, forecasts, assumptions, uncertainty |
| execution | Synchronization worker | action attempts, provider receipts, compensation results |
| workflow | Temporal server through its own database | workflow history and task queues; never business source-of-truth records |

Changes between owners use typed commands or events. A transaction that changes authoritative business state also inserts an outbox row. Consumers maintain an inbox keyed by tenant_id, event_id, and consumer_name. Delivery is at least once; consumer effects must be idempotent. "Exactly once" is not claimed.

### 3.2 Infrastructure data authority

| Store | Authority and isolation | Recovery rule |
|---|---|---|
| PostgreSQL plus pgvector | Authoritative business state and semantic vectors under RLS | Point-in-time restore is the primary data recovery path |
| S3-compatible storage | Immutable provider payloads, exported reports, evidence artifacts, model artifacts | Versioning and object lock where required; metadata in PostgreSQL points to content hashes |
| Neo4j | Per-tenant graph projection with provenance references | Rebuild from PostgreSQL claims and relationships; never repair PostgreSQL from Neo4j |
| Valkey/Redis | Cache, distributed rate-limit counters, short-lived coordination | Flush and rebuild; no approval, policy, cursor, or audit authority |
| Temporal | Durable orchestration history | Business state remains reconcilable from PostgreSQL; workflows use stable IDs |

## 4. End-to-end data flow

### 4.1 Installation and synchronization

1. An administrator authenticates through OIDC and selects a tenant from server-resolved memberships.
2. The API validates connector-administration permission and initiates GitHub App installation or Jira OAuth with PKCE and signed state bound to tenant, actor, nonce, and expiry.
3. Provider credentials are stored through the secret broker under a tenant-specific encryption key. PostgreSQL stores only a secret reference, granted scopes, installation identity, and rotation metadata.
4. A webhook reaches the API. The API reads a bounded byte stream, verifies provider signature before parsing, enforces timestamp and delivery-id replay windows, stores the delivery in the PostgreSQL inbox, emits an outbox event in the same transaction, and acknowledges only after durable commit.
5. A dispatcher starts or signals a stable Temporal synchronization workflow. Polling schedules use the same workflow, so webhooks and reconciliation cannot race independent cursor writers.
6. The synchronization worker fetches pages with bounded concurrency, validates response schemas, computes a content hash, writes encrypted raw bytes to tenant-isolated object storage, and records SourceObject plus NormalizedObservation in PostgreSQL. Cursor advancement and observation publication occur in one transaction.
7. The intelligence worker extracts claims and evidence. Connector text is treated as data, not instruction. Entity resolution can propose or apply a tenant-local merge according to confidence policy; every merge is versioned and reversible.
8. A PostgreSQL outbox event causes the synchronization worker's projector to upsert the tenant graph. The projector records the highest committed source sequence in ProjectionCheckpoint. Duplicate and out-of-order events are safe.
9. Embeddings are generated only from authorized, policy-approved text and stored in pgvector rows protected by the same tenant RLS. ACL metadata remains attached to each retrievable chunk.
10. Tombstones and permission revocations have higher queue priority than enrichment. A revocation watermark blocks affected retrieval until all required projections meet or exceed that watermark.

Full reconciliation is mandatory at least every 15 minutes in H1. Webhooks reduce latency but never replace polling, cursor repair, or tombstone discovery.

### 4.2 Organizational question and cited answer

1. The API authenticates the actor, derives tenant and delegation, and creates an AgentRun with a budget, deadline, policy version, and immutable request digest.
2. Query planning produces bounded relational, vector, and graph retrieval operations. User input cannot inject Cypher, SQL, URLs, tool names, or tenant identifiers.
3. Each store query applies tenant isolation and SourceACL filtering. Graph traversals have hop, node, edge, time, and result-size limits.
4. The API or intelligence workflow constructs an evidence envelope containing stable evidence IDs, source timestamps, authorization context, and projection watermarks. Unauthorized content is removed before any model request.
5. The model gateway selects an evaluated pinned model for the query capability. Structured output is schema-validated. If no approved model is available, the run fails closed.
6. A verifier checks that each material factual claim references evidence visible to the actor. Unsupported claims are removed or the response abstains.
7. The API streams status and the final answer over SSE. Reconnection uses Last-Event-ID and reads persisted run events; SSE is not the authority.

The response must state evidence freshness, incomplete-source warnings, and projection lag. It must never present stale or partial data as complete.

### 4.3 Scenario and simulation

1. The API validates a scenario draft and persists it as an immutable version. The user confirms assumptions before execution.
2. The intelligence worker creates a SimulationSnapshot containing the graph projection sequence, source version IDs, model version, parameter set, timezone, and pseudorandom seed.
3. The worker validates that the work dependency graph is acyclic. It runs seeded PERT sampling and Monte Carlo scheduling within CPU, sample-count, memory, and wall-clock budgets.
4. Results include p50, p80, and p95 completion dates, critical path, blockers, sensitivity drivers, uncertainty, assumptions, missing-data warnings, and a baseline-versus-scenario comparison.
5. The snapshot and result are immutable. Re-running the same engine version, snapshot, parameters, and seed must produce the same serialized result within documented floating-point tolerance.

Simulation describes schedule uncertainty. It must not infer individual productivity, health, emotion, burnout, attrition, misconduct, compensation suitability, or employment performance.

### 4.4 Exact-payload Jira action

The frozen H1 fixture has one mutation target. Fixture alias tnt_aster resolves to tenant UUID 10000000-0000-4000-8000-000000000001, and connector alias con_aster_jira resolves to installation UUID 30000000-0000-4000-8000-000000000001. Aliases appear only in fixtures and reports; the canonical payload uses the UUIDs. The target is Jira issue AST-142 in project AST. Its required before state is source version 7, due date 2026-08-07, priority Medium, and labels identity and orion. Its only approved after state is due date 2026-07-31, priorityId 2, and sorted labels digital-twin-remediation, identity, and orion.

1. A mitigation agent may draft, but not execute, that exact Jira update. Any other target, field, or value is outside H1.
2. The API fetches current provider state and creates a preview with canonical payload, before snapshot, expected provider version, target, risk class, expiry, and SHA-256 payload digest.
3. Two distinct authenticated actors approve the same digest: one with the operations approval capability and one with the security approval capability. The proposer cannot approve. Each approval is re-authorized at submission time.
4. On the second approval, the API atomically creates a single-use ActionGrant and outbox event. The grant expires no later than 15 minutes after preview creation.
5. The synchronization worker revalidates tenant, project allowlist, scopes, grant expiry, two distinct approvers, digest, idempotency key, and expected provider version. Any mismatch fails without mutation.
6. The worker sends the Jira request with an idempotency record, captures the provider response and after snapshot, and commits an ActionReceipt plus audit event. Retried workflow activities return the existing receipt.
7. Rollback is a new dual-authorized compensation command requested within 24 hours. It restores the exact before snapshot only when current Jira state still equals the recorded after state. Any intervening edit yields compensation_conflict and manual_intervention_required instead of overwriting it. H1 does not use pre-authorized automatic compensation.

## 5. Consistency, concurrency, and time

| Concern | Contract |
|---|---|
| Transactional state | PostgreSQL READ COMMITTED is default. SERIALIZABLE or explicit row locks are required for approvals, cursor advancement, merge decisions, and idempotency claims. |
| Projection reads | Each response includes source sequence and projection sequence. A command may request min_projection_sequence; timeout produces 409 projection_not_ready, not stale success. |
| Concurrent edits | Optimistic version columns and If-Match are required for mutable API resources. Conflicts return RFC 9457 problem details with no silent last-write-wins. |
| Ordering | Ordering is per tenant and aggregate sequence, not global wall clock. Consumers ignore older aggregate versions but still record receipt. |
| Clock | Persist UTC instants and the original business timezone where relevant. Deadlines use server time; NTP drift alerts at 500 ms and readiness fails at 2 s. |
| Deletion | Deletion creates a durable tombstone and revocation watermark before asynchronous projection and artifact deletion. Retrieval fails closed while deletion is incomplete. |
| Replay | Rebuilds run into a shadow projection, verify counts, hashes, ACL coverage, and watermark, then atomically switch the tenant projection alias. |

## 6. Interface boundaries

- REST with OpenAPI 3.1 is the H1/H2 command, query, and administration interface.
- SSE is the one-way run-progress interface. It has no command semantics.
- Provider webhooks are signed ingress endpoints with provider-specific validation and a common inbox.
- AsyncAPI and CloudEvents-compatible JSON envelopes describe internal events. The envelope includes specversion, id, source, type, subject, time, datacontenttype, dataschema, tenant_id, traceparent, aggregate_id, aggregate_version, and payload.
- GraphQL is provisional and read-only. It cannot bypass REST policy, expose arbitrary Cypher, or be introduced until field-level cost and authorization tests pass.
- Protocol Buffers and gRPC are provisional boundaries for a workload extracted after a measured trigger. They do not duplicate H1 REST contracts.
- MCP resources and tools are capability-scoped facades over the same policy and approval services. They cannot create a second authorization path.

Every external operation defines tenant derivation, authorization action, schema version, idempotency behavior, pagination, rate limit, timeout, retryability, redaction, audit event, and deprecation policy.

## 7. Architectural invariants

1. No request, event payload, model output, cache key, or provider object can establish tenant authority.
2. No data crosses tenants for retrieval, entity resolution, memory, analytics, evaluation, or training without a separately approved opt-in design; H1 and H2 implement no such opt-in.
3. PostgreSQL is authoritative; a derived store cannot independently create business truth.
4. Source evidence remains attributable to provider object, version, content hash, ingestion time, and applicable ACL.
5. Projection consumers are idempotent, replayable, and observable.
6. Connector and model content is untrusted and cannot select tools or grant permissions.
7. Agent handoff can narrow but never expand actor delegation, budgets, data scope, or action scope.
8. External mutation requires a policy check at proposal, approval, grant, and execution time.
9. H1 permits only the documented Jira sandbox remediation mutation.
10. Every run has a deadline, cancellation path, resource budget, trace, immutable input digest, and terminal state.
11. Sensitive audit events are append-only and exported to independently retained object storage.
12. A degraded dependency produces an explicit degraded or failed result; the system cannot fabricate completeness.

## 8. Failure modes

| Failure | Required behavior |
|---|---|
| PostgreSQL unavailable | Reject stateful requests, pause consumers, and return 503 with Retry-After. Never write only to a projection. |
| Neo4j unavailable or behind watermark | Graph-dependent answers and simulations fail or wait. A relational fallback is allowed only when it implements identical ACL and bounded-query semantics and is labeled as partial. |
| Object store unavailable | Keep already committed inbox deliveries pending and stop cursor advancement before a source object claims durable capture. Retry within budget. |
| Temporal unavailable | Persist accepted command plus outbox event, return 202 with run ID, and dispatch later. Reject commands whose semantic expiry cannot survive the delay. |
| Valkey/Redis unavailable | Bypass caches. Sensitive write rate limits fall back to a durable database limiter or fail closed. |
| Model endpoint unavailable or invalid | Retry only safe calls within the run deadline, use an evaluated allowed fallback, or fail closed. Never return an unverified draft. |
| Connector compromised | Disable installation, revoke secret, quarantine new observations, retain evidence, start reconciliation, and prevent its content from driving tools. |
| Partial or duplicate sync | Preserve prior authoritative versions, mark source freshness degraded, retry idempotently, and never advance cursor past an uncommitted page. |
| Worker crash after external mutation | Reconcile using action idempotency record and provider state before retry; never blindly repeat the mutation. |
| Permission revocation | Advance revocation watermark, invalidate caches, block affected retrieval, and rebuild projections before access resumes. |

## 9. Acceptance criteria

| Evidence ID | Canonical acceptance | Criterion |
|---|---|---|
| TC-ARCH-001 | AC-REV-001 | A deployment inventory proves exactly four first-party application workloads and the ownership boundaries in this chapter. |
| TC-ARCH-002 | AC-TEN-001 | Automated tests prove all tenant tables use FORCE RLS and cross-tenant foreign keys or reads fail. |
| TC-ARCH-003 | AC-DATA-001 | Duplicate, delayed, and out-of-order webhook and outbox events converge to one authoritative version and one projection effect. |
| TC-ARCH-004 | AC-DATA-002 | A complete tenant graph can be rebuilt from PostgreSQL and object evidence without using the prior graph. |
| TC-ARCH-005 | AC-AI-001 and AC-AI-002 | Every cited answer exposes evidence IDs and freshness, and the verifier abstains when evidence is absent or unauthorized. |
| TC-ARCH-006 | AC-SIM-001 | The same simulation snapshot, engine version, parameters, and seed reproduces the accepted result. |
| TC-ARCH-007 | AC-ACT-001 | Jira execution is impossible with one approver, duplicate approvers, an expired grant, a changed payload, a non-allowlisted project, or stale provider state. |
| TC-ARCH-008 | AC-ACT-002 and AC-ACT-003 | A worker crash after Jira acceptance returns the existing receipt or enters manual intervention without a duplicate mutation. |
| TC-ARCH-009 | AC-SEC-002 | Revoked source access cannot be retrieved from PostgreSQL, graph, vector, cache, model context, or persisted answer artifacts. |
| TC-ARCH-010 | AC-REL-003 | Dependency fault tests produce the explicit failure semantics above and no false success. |

## 10. Related decisions

Foundational choices are recorded by the ADR catalog. This chapter is the normative integrated view: modular service decomposition, PostgreSQL authority, rebuildable projections, transactional outbox, pooled relational tenancy, server-derived authorization, bounded AI capabilities, seeded PERT/Monte Carlo simulation, cloud-neutral packaging, and benchmark-gated extraction. Any later ADR that changes an invariant here must update this chapter, its acceptance criteria, and the traceability ledger in the same change.
