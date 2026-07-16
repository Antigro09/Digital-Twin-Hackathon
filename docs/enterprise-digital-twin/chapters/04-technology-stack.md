---
id: CH-04
title: Technology Stack
status: Committed
version: 1.0.0
owners:
  - Architecture
  - Developer Platform
last_reviewed: 2026-07-15
---

# Technology Stack

## 1. Decision policy

This chapter is the authoritative technology portfolio. It prevents an exhaustive wishlist from becoming an obligation to operate overlapping systems.

| Status | Meaning |
|---|---|
| Adopt | Required for the committed H1/H2 architecture unless an ADR supersedes it |
| Conditional | Not an H1 dependency; introduction requires the stated measurable trigger and an approved ADR |
| Research | May be evaluated in an isolated environment and cannot carry production data or appear in committed interfaces |
| Reject | Must not be introduced because it duplicates authority, lacks a justified use, or conflicts with current constraints |

A conditional technology can move to Adopt only after one representative benchmark demonstrates the trigger, a named team accepts operational ownership, threat and privacy reviews pass, data migration and rollback are tested, cost is budgeted, and compatibility contracts are documented. A benchmark must compare the current stack and the candidate on the same tenant-shaped dataset. Preference, resume value, or theoretical scale is not a trigger.

Exact package and image versions are pinned by lockfiles and image digests in the implementation repository. Production never follows a floating language, package, container, or model alias. Supported version changes use automated compatibility tests, security review, staged rollout, and rollback.

## 2. Committed stack by layer

| Layer | Adopted technology | Ownership and rationale | Constraints |
|---|---|---|---|
| Monorepo | pnpm workspaces and Turborepo | One dependency graph for web, API, worker, contracts, and tooling; cached tasks | No package may import another workload's private module |
| Web | TypeScript, Next.js, React | Server-rendered accessible web UI, route composition, SSE client | No database, connector, Temporal, or model credentials |
| API | TypeScript, NestJS, Fastify | Typed modular API with schema validation and high-performance HTTP adapter | REST/OpenAPI is primary; long work is delegated |
| Sync worker | TypeScript, Temporal TypeScript SDK | Shares connector contracts and performs durable I/O workflows | Activities are idempotent and bounded |
| Intelligence worker | Python, Temporal Python SDK, Pydantic, NumPy | Model integration, extraction, graph analysis, evaluation, PERT/Monte Carlo simulation | No external mutation and no arbitrary code execution |
| Relational and vector | PostgreSQL with pgvector | Authoritative ACID state, RLS, SQL, transactional outbox, initial vector retrieval | SQL-first migrations; vector rows carry tenant and ACL |
| Graph | Neo4j | Bounded traversal and graph algorithms over a rebuildable per-tenant projection | Never authoritative; no user-supplied Cypher |
| Object | S3-compatible API; MinIO for local development | Immutable raw evidence and generated artifacts | Tenant namespace and encryption key; content hashes |
| Cache and limits | Valkey using the Redis protocol | Non-authoritative cache and distributed counters | Flush-safe; never stores sole approval or policy state |
| Workflow | Temporal | Durable retries, timers, cancellation, and long-running synchronization/action workflows | Workflow code is deterministic; business truth remains in PostgreSQL |
| API contracts | OpenAPI 3.1, JSON Schema, RFC 9457, SSE | Language-neutral command/query interface and structured errors | Generated artifacts are checked for drift |
| Events | Transactional outbox/inbox, AsyncAPI, CloudEvents-compatible JSON | At-least-once publication without a second broker in H1/H2 | Consumers are idempotent; no exactly-once claim |
| Telemetry | OpenTelemetry and collector | Vendor-neutral traces, metrics, and correlated logs | No tenant PII in high-cardinality attributes |
| Packaging | OCI images and Docker | Reproducible workload packaging and local Compose | Images run non-root, read-only, and by digest |
| Orchestration | Docker Compose for local/H1; Kubernetes and Helm adopted at H2 | Standard scheduling, policy, rollout, and availability for the committed design-partner topology | Production stateful services should be managed outside the cluster |
| Infrastructure as code | OpenTofu with provider-neutral modules | Declarative cloud and Kubernetes resources without dual IaC sources | Remote encrypted state, locking, plan review |
| Identity | External OIDC; SAML and SCIM at H2 boundary | Enterprise IdP remains authentication authority | Local development can use a disposable OIDC provider |
| AI | Provider-neutral Python AI Gateway; Meta Llama API primary; OpenAI Responses optional | Capability-oriented model calls, strict schemas, permission-aware retrieval, traceable runs | Exact evaluated model configuration; no provider call bypasses gateway; no simulated production response |

### 2.1 Language and data-access rules

- TypeScript strict mode is mandatory. Runtime inputs use generated JSON Schema validators; static types alone are not validation.
- Python uses current project-pinned Python, type checking, Pydantic models, deterministic dependency locking, and isolated virtual environments.
- SQL migrations are ordered, immutable after release, and written as reviewed PostgreSQL SQL. A Node migration runner acquires a database advisory lock and records checksum, owner, applied time, and release.
- TypeScript uses Kysely for typed query construction plus reviewed SQL for RLS, recursive queries, pgvector, and database-specific behavior. Python uses psycopg. Neither is an authorization boundary.
- Shared schemas are generated from canonical JSON Schema/OpenAPI definitions. Copy-pasted domain types across languages are prohibited.
- A new runtime language requires a durable ownership boundary and staffing plan. A small performance hotspot does not justify a new service language until profiling and a benchmark prove it.

### 2.2 Model routing baseline

The gateway exposes capabilities, not raw model names, to application code:

| Capability | H1 route | Required gate |
|---|---|---|
| difficult grounded reasoning | Configured `AI_REASONING_PROVIDER`; Llama by default | Argument accuracy, groundedness, safety, latency, and cost evaluation |
| balanced grounded analysis | Configured Llama model | Citation support, abstention, ACL, injection, and schema evaluation |
| high-volume extraction | Configured Llama model | Structured extraction precision/recall, provenance, latency, and cost evaluation |

The model identifier is never guessed or embedded in application features. Before deployment, the platform owner records the exact account-available model/configuration and evaluation evidence in the model registry. If no route passes the capability evaluation, that capability is disabled. Fallbacks are independently evaluated and cannot silently reduce safety. Meta documents its hosted Llama API and official SDKs in the [Llama API announcement](https://ai.meta.com/blog/llamacon-llama-news/) and [official Python SDK](https://github.com/meta-llama/llama-api-python). OpenAI Responses remains an optional adapter and follows its [structured-output contract](https://developers.openai.com/api/docs/guides/structured-outputs).

## 3. Technology portfolio matrix

### 3.1 Languages and client platforms

| Technology | Status | Approved use or introduction trigger | Decision |
|---|---|---|---|
| TypeScript | Adopt | Web, API, sync worker, connector SDK, schema tooling | Maximizes shared contract safety in I/O-heavy product surfaces |
| Python | Adopt | Intelligence worker, simulation, model integration, evaluations | Best fit for scientific and AI libraries; isolated from external mutation |
| SQL | Adopt | PostgreSQL schema, policy, queries, migrations, reporting | Keeps data constraints and RLS explicit |
| Go | Conditional H3 | High-throughput gateway, CLI or connector appliance only after sustained concurrency/distribution evidence shows TypeScript cannot meet the target and ownership justifies a new runtime | No H1/H2 service |
| Rust | Conditional H4 | Sandboxed extension, edge appliance or hardened parser after profiling or isolation evidence proves TypeScript/Python inadequate | Prefer current runtimes first |
| WebAssembly | Conditional H4 | Sandboxed customer plugin execution after capability, resource-metering, determinism, and escape testing pass | Not a general server runtime |
| C# | Conditional H3 generated SDK; reject services | Generate a client only after a contracted .NET customer and conformance suite exist | No duplicated backend |
| Java | Conditional H3 generated SDK; reject services | Generate a client only after a contracted JVM customer and conformance suite exist | Temporal and build tools do not make Java an application language |
| Kotlin | Conditional H4 generated SDK/client; reject services | Mobile/JVM client only after a committed product surface exists | No native client in H1/H2 |
| Swift | Conditional H4 generated SDK/client; reject services | Native Apple client only after a committed offline/mobile surface exists | Responsive web is the current client |
| C++ | Reject | No current workload justifies memory-unsafe native code | Use Rust if a proven native kernel is later required |

### 3.2 Interfaces, workflow, and messaging

| Technology | Status | Approved use or introduction trigger | Decision |
|---|---|---|---|
| REST and OpenAPI 3.1 | Adopt | Primary public commands, queries, administration, and SDK generation | Stable, inspectable security boundary |
| SSE | Adopt | Server-to-browser progress for persisted runs | Simpler than bidirectional sockets for current needs |
| Signed webhooks | Adopt | GitHub and Jira inbound events | Durable inbox plus reconciliation |
| AsyncAPI and CloudEvents JSON | Adopt | Internal event catalog and envelope | Broker-neutral and contract-testable |
| Temporal | Adopt | Sync, enrichment, simulation, evaluation, approval expiry, action and compensation workflows | Durable workflow semantics without bespoke schedulers |
| GraphQL | Conditional H2 | Read-only graph exploration after H2 field authorization, query cost, depth, introspection, batching, and pagination tests pass | Never a command or arbitrary Cypher surface |
| gRPC and Protocol Buffers | Conditional H3 | Internal interface only when a workload is extracted and measured call volume or streaming makes REST inadequate | Avoid duplicate contracts in the monolith |
| Kafka | Conditional H3 | Adopt only when sustained outbox traffic exceeds PostgreSQL dispatch capacity in a representative test, replay retention exceeds database budget, or at least three independent consumer groups require ordered high-throughput streams | PostgreSQL outbox remains H1/H2 |
| NATS and JetStream | Reject H3 | Overlaps Temporal and a future Kafka event backbone | One durable event strategy |
| RabbitMQ | Reject | Adds overlapping queue semantics without a committed use | Temporal owns task delivery |
| Apache Pulsar | Reject | Duplicates the conditional Kafka role and raises operational breadth | Revisit only by superseding portfolio ADR |
| Event sourcing | Reject as system-wide architecture | Domain audit history and immutable source versions are adopted, but current state remains authoritative tables | Avoid reconstructing all business state from events |
| Service mesh | Reject | Current workload count does not justify another security and operations control plane | A future H3 reclassification requires a superseding portfolio ADR and measured gap |
| Dapr | Reject | Duplicates Temporal, SDK, secrets, and pub/sub abstractions | Explicit libraries and contracts are easier to audit |

### 3.3 Databases, search, analytics, and cache

| Technology | Status | Approved use or introduction trigger | Decision |
|---|---|---|---|
| PostgreSQL | Adopt | Authoritative tenant, identity, source, claim, scenario, approval, action, and audit-index state | ACID, RLS, mature operations |
| pgvector | Adopt | Initial semantic retrieval within tenant and ACL filters | Preserves transactional and tenant controls |
| Neo4j | Adopt | Rebuildable tenant graph projection and bounded traversals | Specialized graph query model without authority split |
| Valkey | Adopt | Cache and distributed rate-limit counters through Redis-compatible protocol | Open implementation; non-authoritative |
| Redis | Reject | Valkey is the sole adopted Redis-protocol cache implementation | Do not operate duplicate cache technologies |
| S3-compatible object storage | Adopt | Immutable raw payloads, artifacts, exports, evaluation datasets | Provider-neutral object contract |
| MinIO | Adopt for local; conditional production | Compose development and air-gapped profile after durability tests | Managed object storage preferred in H2 cloud |
| OpenSearch | Conditional H2 | Introduce after PostgreSQL full-text plus pgvector misses p95 target or corpus/aggregation load harms OLTP in representative H2 tests | Tenant-isolated indexes and dual-read validation required |
| Elasticsearch | Reject | Duplicates OpenSearch candidate and introduces a second search contract | One search transition path |
| ClickHouse | Conditional H2 | Introduce when append-heavy telemetry/product analytics queries measurably affect PostgreSQL or exceed agreed retention/query budgets | No source-of-truth business state |
| Lakehouse object tables | Conditional | H3 analytical history only after governed cross-domain analysis requires it and privacy/residency controls pass | Not part of transactional query path |
| Milvus | Reject | Duplicates pgvector; no committed billion-vector requirement | Benchmark only under a superseding ADR |
| Qdrant | Conditional H3 | Specialized vector retrieval only when representative benchmarks prove pgvector and conditional OpenSearch cannot meet recall, latency, or isolation targets | Requires a new tenant policy surface and migration/rollback proof |
| Pinecone | Reject | Duplicates pgvector and adds external data residency dependency | No H1/H2 use |
| Weaviate | Reject | Duplicates graph, vector, and schema responsibilities | Keep authorities separate and explicit |
| MongoDB | Reject | Document flexibility is already handled by JSONB plus immutable objects | Avoid another system of record |
| Cassandra/DynamoDB | Reject | Current access patterns and horizons do not justify eventual-consistent authority | Revisit only for a measured H3 workload |
| MySQL | Reject | PostgreSQL is selected; dual relational support adds no product value | PostgreSQL-compatible SQL means portability discipline, not simultaneous databases |
| CockroachDB | Conditional | Regional SQL only after H4 multi-region consistency requirements are frozen and PostgreSQL topology cannot meet them | Requires semantics and RLS revalidation |
| Prometheus | Adopt | Metrics storage and alert rules in the reference observability profile | OpenMetrics-compatible path |
| Grafana | Adopt | Dashboards and trace/log correlation in reference profile | No business authorization data source |
| Loki and Tempo | Adopt in reference profile | Logs and traces behind OpenTelemetry collector | Replaceable backends; retention is environment-specific |

### 3.4 Platform, security, and delivery

| Technology | Status | Approved use or introduction trigger | Decision |
|---|---|---|---|
| OpenTelemetry | Adopt | Instrumentation and collector pipeline for traces, metrics, and correlated logs | Vendor-neutral telemetry contract |
| OCI and Docker | Adopt | Reproducible workload images and Compose development | BuildKit, non-root runtime, immutable digest |
| Docker Compose | Adopt for local/H1 demo | One-command environment, synthetic data, and fault testing | Not an H2 HA control plane |
| Kubernetes | Adopt H2 | Required by the committed regional design-partner profile; freeze a supported version before first pilot deployment | No multi-cluster claim until H4 |
| Helm | Adopt H2 | Required packaging contract for the Kubernetes profile | Rendered manifests validated in CI |
| OpenTofu | Adopt H2 | Infrastructure definitions and plans | Sole source for shared infrastructure |
| Terraform | Conditional H2 compatibility | A provider or customer may require Terraform execution only if the same HCL modules pass both engines; no forked module tree or dual state | OpenTofu remains reference tool |
| Argo CD | Adopt for H2 | GitOps reconciliation and environment promotion | Production changes come from reviewed Git commits |
| GitHub Actions | Adopt | CI, artifact creation, security scans, contract tests, evaluation gates | OIDC federation; no long-lived cloud keys |
| External Secrets Operator | Adopt for Kubernetes | Materialize short-lived secrets from an approved external KMS/vault | Secret values never enter Git or Helm values |
| OPA | Conditional | Externalize policy only when H2 policy count, independent policy ownership, or non-API enforcement requires it and parity tests pass | H1 uses a versioned in-process policy decision module |
| Keycloak | Adopt only for local reference | Disposable OIDC/SAML test identity provider | Production integrates customer IdP |
| Cosign and Sigstore | Adopt | Sign images, attest provenance, verify before deploy | Keyless CI signing where supported |
| Syft and SPDX/CycloneDX | Adopt | Software bill of materials for each release image | SBOM retained with release evidence |
| Trivy | Adopt | Image, filesystem, dependency, secret, and IaC scanning | Findings follow release severity policy |
| Istio/Linkerd | Reject | Service mesh is rejected in the current portfolio | Evaluate one, never both, only after service mesh is reclassified |
| Edge computing | Research | Read-only, encrypted, disconnected inference only after H4 data and revocation semantics are specified | No current product claim |

### 3.5 Test and developer tooling

| Technology | Status | Approved use | Decision |
|---|---|---|---|
| Vitest | Adopt | TypeScript unit and component tests | Fast workspace-native runner |
| Pytest | Adopt | Python unit, property, simulation, and evaluation tests | Mature fixtures and scientific ecosystem |
| Playwright | Adopt | Cross-browser end-to-end and accessibility automation | Exercises real browser flows |
| Testcontainers | Adopt | PostgreSQL, Neo4j, Valkey, object store, and Temporal integration tests | Production-shaped dependencies in CI |
| k6 | Adopt | API, SSE, and workflow load/soak tests | Scriptable thresholds and CI output |
| Schemathesis | Adopt | OpenAPI property and negative testing | Finds contract edge cases from canonical schema |
| Ruff and mypy | Adopt | Python formatting/lint check and static types | Fast deterministic gates |
| ESLint and TypeScript compiler | Adopt | TypeScript lint and type gates | Rules are centrally versioned |
| OpenAPI Generator | Adopt | Generated client conformance fixtures and later SDKs | Generated code is versioned by contract release |

## 4. Build-versus-buy boundaries

| Capability | Decision | Product-owned portion |
|---|---|---|
| Identity | Integrate | Tenant membership mapping, delegation, policy context, audit; do not build passwords or MFA |
| Workflow | Buy/use Temporal | Workflow definitions, idempotency, business state, compensations |
| Databases/object store | Prefer managed H2 | Schemas, RLS, queries, backup verification, projection rebuild |
| Models | Use provider behind gateway | Capability routing, evidence construction, tool policy, evaluations, safety, audit |
| Graph visualization | Use a maintained rendering library | Accessible interactions, authorization, graph query limits, product semantics |
| Connectors | Build narrow adapters over provider APIs | Scope selection, normalization, reconciliation, provenance, ACL and error semantics |
| Authorization | Build product policy core; integrate IdP | Resource/action vocabulary, tenant context, ACL intersection, delegation, exact-payload grants |
| Observability | Open standards plus replaceable backends | Semantic conventions, SLOs, dashboards, alerts, redaction |

## 5. Technology invariants

1. Only one technology is authoritative for each concern.
2. A cache, graph, search index, analytics store, workflow history, or model memory cannot become business authority.
3. No technology introduction weakens tenant isolation, ACL revocation, evidence provenance, or audit semantics.
4. Provider-neutral means contracts and packaging are portable; it does not mean operating every alternative simultaneously.
5. Generated SDKs follow the OpenAPI contract and add no privileged endpoints.
6. Libraries that execute plugins, templates, parsers, or model tools run with explicit capabilities, resource budgets, and no ambient credentials.
7. All adopted dependencies have a named update owner, SBOM entry, license policy, vulnerability policy, and end-of-life plan.
8. Client and connector libraries never receive a database superuser, RLS-bypass role, cluster-admin identity, or cross-tenant credential.

## 6. Acceptance criteria

| Evidence ID | Canonical acceptance | Criterion |
|---|---|---|
| TC-TECH-001 | AC-DOC-002 and AC-REV-001 | Dependency inventory maps every production package and service to an Adopt entry or approved ADR. |
| TC-TECH-002 | AC-SUP-001 | CI fails on unpinned package locks, mutable production image tags, unsigned images, or missing SBOMs. |
| TC-TECH-003 | AC-REV-001 | The application can replace telemetry, object storage, and model endpoint implementations through documented contracts without changing domain authority. |
| TC-TECH-004 | AC-REV-001 | No H1 deployment contains Kafka, NATS, service mesh, OpenSearch, ClickHouse, separate vector database, GraphQL command surface, or gRPC service. |
| TC-TECH-005 | AC-DOC-002 and AC-REV-001 | A conditional technology ADR includes measured trigger evidence, owner, security/privacy assessment, migration, dual-read or compatibility validation, cost, and rollback. |
| TC-TECH-006 | AC-AI-001, AC-AI-003, and AC-AI-004 | All production model capabilities resolve to an evaluated pinned snapshot and fail closed when no approved snapshot is available. |
| TC-TECH-007 | AC-DOC-001 | Language-boundary contract tests prove TypeScript and Python serialize the same canonical types and errors. |
| TC-TECH-008 | AC-TEN-001 | PostgreSQL RLS, graph isolation, object namespace, and cache namespace tests pass against every supported managed implementation. |
