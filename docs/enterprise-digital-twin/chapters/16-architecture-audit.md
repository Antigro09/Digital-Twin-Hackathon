---
id: CH-16
title: Architecture Audit and Convergence Record
status: committed
version: 1.0.0
owners:
  - architecture-review-board
  - security-architecture
  - product-governance
last_reviewed: 2026-07-13
---

# Architecture Audit and Convergence Record

## 1. Audit opinion

The `1.0.0-rc.1` architecture is suitable as the normative implementation blueprint for the bounded H1 reference workload and as a gated reference architecture for H2. It does not become final `1.0.0` until every convergence criterion in this chapter is evidenced. H3 and H4 remain Provisional where telemetry, benchmarks, customer constraints, or deployment evidence are required. H5 remains Research.

No Critical or High architecture finding remains open in the design. Three Medium risks are explicitly accepted with owners, compensating controls, expiry dates, and revisit triggers. Other registered risks are mitigated but remain subject to implementation evidence. This opinion does not assert that the software has been built, that a control has operated effectively, that a compliance certification exists, or that synthetic simulation has external predictive validity.

The `CH-17` synthetic physical-asset amendment was added after the review passes listed in section 2.3. Its scope is deliberately limited to an in-process simulator and reuses the established tenant, API, exact-payload, idempotency, audit, deterministic-model, and accessibility boundaries. This amendment does not claim a completed architecture review or release gate: `TST-PHY-001`, `AC-PHY-001`, contract validation, and independent review remain required before publication evidence can describe the amended H1 scope as passed.

The architecture reached this opinion by narrowing unbounded claims, assigning authority and data ownership, converting ambiguous autonomy into bounded capability contracts, making projection and action failure semantics explicit, and defining a finite release gate. An independent build-readiness review and generated validation evidence remain mandatory release evidence under `AC-REV-001` and `AC-REV-002`; this self-audit does not substitute for them.

## 2. Audit scope and method

### 2.1 Scope

The audit covers:

- Product mission, users, outcomes, prohibited uses, and H1 demonstration contract.
- Workload decomposition, language ownership, data authority, workflows, events, and deployment boundaries.
- Shared multitenancy, identity, authorization, source ACLs, cryptography, secrets, privacy, and audit integrity.
- Connector installation, synchronization, compromised-source behavior, entity resolution, claims, evidence, and derived projections.
- AI capability profiles, model routing, retrieval, memory, prompt-injection defense, evaluation, and action authority.
- Scenario compilation, PERT/Monte Carlo simulation, uncertainty, prediction boundaries, and research claims.
- REST, SSE, webhook, event, GraphQL, Protobuf, MCP, connector, extension, SDK, and CLI interface ownership.
- UX surfaces, states, visualization semantics, accessibility, and approval ergonomics.
- Reliability, observability, recovery, deployment profiles, supply chain, testing, traceability, roadmap, and stop conditions.

The audit evaluates architecture sufficiency and internal consistency. It does not perform a source-code audit, penetration test, privacy legal opinion, capacity test, model evaluation, restore drill, certification, or production readiness attestation.

### 2.2 Review questions

Each domain was reviewed against the following questions:

1. Is the purpose and non-goal explicit?
2. Is there one authoritative owner for state and one defined owner for operation?
3. Are tenant and actor context derived and enforced independently of caller input?
4. Are public and internal interfaces typed, versioned, authorized, idempotent where needed, and observable?
5. Are source, valid, system, and processing time distinguished where relevant?
6. Do retries, duplicates, reordering, concurrency, cancellation, timeout, restart, partition, and compensation have defined outcomes?
7. Can a derived view be rebuilt, corrected, permission-revoked, retained, and deleted?
8. Can an AI output or untrusted connector payload affect authority or execution without deterministic validation?
9. Are uncertainty, missing evidence, partial state, and invalid domains visible to the user?
10. Is scale a measured service boundary rather than an unsupported aspiration?
11. Are accessibility and non-visual equivalence part of acceptance rather than post-release remediation?
12. Does every commitment have an owner, horizon, control, risk treatment, and acceptance evidence?

### 2.3 Review passes

| Pass | Purpose | Result |
|---|---|---|
| `AUD-2026-07-13-A` | Cross-domain design audit of the original expansive brief | Found the scope, technology, ontology, graph-tenancy, autonomy, simulation, and compliance issues recorded in the review ledger; all Critical/High findings were remediated in the normative baseline. |
| `AUD-2026-07-13-B` | Security, privacy, AI, scale, and buildability audit | Found derived-ACL, approval-replay, cross-tenant-learning, trace-minimization, and H1-envelope gaps; all High findings were remediated and Medium residual risks were assigned. |
| `AUD-2026-07-13-C` | Final internal consistency check against requirements, controls, risks, acceptance, and implementation-decision completeness | Found no new Critical or High issue and no new major H1/H2 product, security, data, topology, or interface decision. This is supporting self-review, not independent sign-off. |

The formal ledger reviews close with no remaining Critical or High issue, and pass C supports design self-convergence. Release still requires the independent engineer and repository validator evidence named in section 7.

## 3. Resolved findings

| Finding | Original severity | Problem | Resolution | Governing records |
|---|---|---|---|---|
| `FND-001` | Critical | The brief demanded exhaustive coverage and recursive review without a finite completion condition. | Freeze H1/H2 scope, use extensible catalogs for breadth, label later work, and require measurable convergence and independent review. | `REQ-GOV-002`, `REQ-GOV-003`, `ADR-001`, `ADR-016` |
| `FND-002` | High | A hackathon deliverable and complete Fortune 500 platform were treated as one immediate release. | Define a production-shaped H1 slice with production invariants inside a fixed envelope; treat H2-H5 as gated horizons. | `REQ-PROD-003`, `REQ-PROD-004`, `ADR-002`, `CH-02` |
| `FND-003` | High | The proposed platform could adopt microservices, a service mesh, multiple queues, and specialized stores before a measured need. | Use four modular OCI workloads, Temporal, a PostgreSQL outbox, and benchmark/ownership ADRs before service or infrastructure expansion. | `REQ-ARCH-001` through `REQ-ARCH-005`, `ADR-003`, `ADR-005`, `ADR-017` |
| `FND-004` | High | Relational, graph, vector, search, and object stores lacked a clear authority boundary. | PostgreSQL is authoritative for modeled state; S3-compatible storage preserves immutable source artifacts; graph/vector/search/cache are rebuildable projections. | `REQ-DATA-001`, `REQ-DATA-003`, `ADR-008`, `ADR-009`, `ADR-010` |
| `FND-005` | Critical | Shared infrastructure without a complete tenant fence could leak through rows, graph topology, embeddings, cache, objects, events, traces, or errors. | Derive tenant context from identity, enforce PostgreSQL RLS and tenant-qualified constraints, independently namespace projections, and run two-tenant negative tests. | `REQ-TEN-001` through `REQ-TEN-005`, `CTRL-TEN-001` through `CTRL-TEN-003`, `RSK-001`, `RSK-002` |
| `FND-006` | High | Source ACLs could be lost through claims, paths, counts, summaries, embeddings, caches, notifications, or exports. | Enforce monotonic visibility from qualifying evidence, carry ACL metadata, invalidate derived results on revocation, and suppress structural side channels. | `REQ-SEC-002`, `CTRL-DAT-002`, `ADR-007`, `RSK-003` |
| `FND-007` | Critical | Executive-titled agents implied broad or self-expanding authority. | Replace personas-as-authority with bounded capability profiles. Effective authority is the intersection of user, tenant, delegation, workflow, caller, and tool policy. | `REQ-AI-002`, `REQ-AI-008`, `CTRL-IAM-004`, `ADR-013` |
| `FND-008` | Critical | Untrusted connector content or model output could manipulate tools or exfiltrate data. | Separate content from instructions, use fixed structured tool schemas, external authorization, resource budgets, egress constraints, schema validation, and adversarial evaluation. | `REQ-AI-003`, `REQ-AI-004`, `CTRL-AI-001` through `CTRL-AI-004`, `RSK-004`, `RSK-005` |
| `FND-009` | High | Human approval was unspecified and could approve a description instead of the executed action. | Bind two distinct authenticated approvers to tenant, target, canonical payload hash, source version, policy version, expiry, and idempotency key; recheck immediately before execution. | `REQ-ACT-001`, `REQ-ACT-002`, `CTRL-ACT-001`, `CTRL-ACT-002`, `RSK-006` |
| `FND-010` | High | External retry and rollback behavior could duplicate a Jira write or overwrite a concurrent edit. | Use durable workflow state, stable idempotency, provider correlation, before/after receipts, optimistic source-version precondition, and compensation conflict instead of blind overwrite. | `REQ-ACT-003`, `CTRL-ACT-003`, `AC-ACT-002`, `AC-ACT-003`, `RSK-013` |
| `FND-011` | High | Simulation and prediction scope mixed conditional scheduling with causal and workforce claims. | H1 uses a seeded dependency-DAG PERT/Monte Carlo scheduler with distributions and limitations. Workforce-sensitive inference is prohibited through H3 and separately governed as Research. | `REQ-SIM-001` through `REQ-SIM-005`, `CTRL-PRV-002`, `ADR-014`, `RSK-007`, `RSK-011` |
| `FND-012` | High | Unlimited scale and trillion-edge language had no workload, cost, or validation boundary. | Commit explicit H1 and H2 envelopes; freeze H3 tiers from pilot telemetry; retain hyperscale as H5 Research with representative workload gates. | `REQ-REL-001`, `REQ-REL-002`, `REQ-REL-006`, `CH-15` |
| `FND-013` | High | Cloud neutrality, active-active multi-cloud, air gap, edge, and online OpenAI dependency were treated as simultaneously available. | Define portable contracts and one reference profile; graduate dedicated, customer-managed, regional, air-gapped, and edge profiles independently with explicit capability differences. | `REQ-ARCH-004`, `REQ-ARCH-006`, `ADR-015`, `RSK-008` |
| `FND-014` | Medium | Language, protocol, and datastore lists risked adoption by enumeration and duplicated responsibilities. | Assign TypeScript, Python, SQL, PostgreSQL, Neo4j, Temporal, S3-compatible storage, pgvector, Valkey, OpenTelemetry, Docker, and Kubernetes explicit ownership; defer alternatives behind triggers. | `ADR-004`, `ADR-010`, `ADR-017`, `RSK-009` |
| `FND-015` | High | Graph-first UX could hide evidence, staleness, permissions, uncertainty, and inaccessible states. | Make search/list the default, bound graph traversal/rendering, expose evidence and checkpoints, and require table/text equivalence plus WCAG 2.2 AA acceptance. | `REQ-UX-001` through `REQ-UX-004`, `CH-11`, `AC-UX-001` |
| `FND-016` | High | Compliance language could be read as a certification or legal conclusion. | Limit claims to control alignment and evidence readiness; require separate organizational controls, legal ownership, audit, and certification. | `REQ-SEC-005`, `REQ-SEC-006`, `CH-09` |
| `FND-017` | Medium | Model aliases and provider behavior could drift, fail, or become unavailable. | Route through a capability gateway, pin evaluated snapshots per workload, version prompts/tools, set budgets, and fail closed if no approved fallback passes. | `REQ-AI-001`, `REQ-AI-007`, `CTRL-AI-003`, `RSK-012` |
| `FND-018` | Medium | Audit and observability could become an uncontrolled shadow copy of tenant content. | Minimize to structured metadata and digests, redact by construction, separate audit authorization/retention, and preserve trace linkage without private chain-of-thought. | `REQ-AI-006`, `REQ-SEC-004`, `CTRL-AI-005`, `CTRL-AUD-001`, `RSK-014` |

## 4. Domain conformance result

| Domain | Disposition | Audit conclusion |
|---|---|---|
| Product and scope | Conforms | H1 has an exact actor, dataset, question, scenario, action, and measurement contract; later capability status is explicit. |
| Service architecture | Conforms | Four workloads have coherent ownership; durable workflow and event boundaries precede optional extraction. |
| Tenancy and identity | Conforms with implementation evidence required | Independent relational and derived-store fences are designed; negative tests and runtime policy evidence remain release gates. |
| Data and graph | Conforms | Authority, bitemporal provenance, reversible resolution, ontology versioning, projection rebuild, lifecycle, and domain extension are assigned. |
| Connectors and synchronization | Conforms | Scope, authentication, webhook verification, cursoring, duplicates, ordering, reconciliation, tombstones, quarantine, and compromised-connector behavior are specified. |
| AI and retrieval | Conforms with provider dependency | Authority is deterministic outside the model; content is untrusted; outputs are typed; model/prompt/tool changes are evaluation-gated. |
| Simulation and prediction | Conforms | H1 mathematics and outputs are reproducible and bounded; causal/predictive and workforce-sensitive claims remain gated. |
| Governed action | Conforms | H1 has one exact allowlisted Jira mutation, dual control, 15-minute expiry, concurrency precondition, durable receipt, idempotency, and compensation. |
| Security and privacy | Conforms with organizational evidence required | Technical controls and readiness mapping are complete; certification, lawful basis, customer contracts, and incident staffing are not inferred from architecture. |
| Reliability and observability | Conforms | Dependency-specific degradation, recovery, backpressure, replay, health, redaction, RPO/RTO, and projection rebuild responsibilities are assigned. |
| UX and accessibility | Conforms | Major surfaces and states, evidence semantics, visualization alternatives, responsive behavior, approval ergonomics, and accessibility gates are defined. |
| APIs and extensions | Conforms | Interface ownership and horizon are explicit; tenant derivation, auth, compatibility, pagination, idempotency, errors, redaction, and audit semantics are mandatory. |
| Deployment and operations | Conforms by profile | Local and reference cloud profiles are committed as named; later profiles cannot silently reduce controls. |
| Verification and developer experience | Conforms | Clean-room development, contract validation, synthetic oracle, continuous AI evaluation, security/load/failure testing, and release evidence have finite gates. |

## 5. Residual risk register

### 5.1 Accepted Medium risks

These acceptances cannot override a Critical/High result, law, contract, tenant boundary, or prohibited use.

| Risk | Residual exposure | Compensating controls | Owner | Acceptance expiry and revisit |
|---|---|---|---|---|
| `RSK-008` - Cloud-neutral abstraction cost | Portable adapters and conformance work may slow H1/H2 and still expose provider differences. | Keep adapters thin, choose one fully tested reference profile, expose capability differences, and reject lowest-common-denominator domain abstractions. | Platform | Expires `2027-01-31` or before selecting the H2 reference provider, whichever is earlier. Revisit with portability test and operating-cost evidence. |
| `RSK-009` - Runtime complexity over time | TypeScript, Python, SQL, and infrastructure runtimes increase tooling and on-call breadth. | Limit ownership by workload, share contracts and telemetry, maintain one local command, and require an ADR plus staffing evidence for every new language. | Architecture | Expires `2027-07-13` or before H3 service extraction, whichever is earlier. Revisit with incident, build-time, staffing, and performance data. |
| `RSK-016` - Synthetic external validity | H1 proves deterministic product behavior but not customer data quality, decision value, or predictive validity. | Label synthetic output, prohibit production accuracy claims, use partner-approved golden cases, and require prospective validation before prediction claims. | Product | Expires before the first H2 partner outcome claim or `2027-01-31`, whichever is earlier. Revisit through design-partner evaluation. |

### 5.2 Mitigated risks that require operating evidence

| Risk group | Residual concern | Required evidence |
|---|---|---|
| `RSK-001`, `RSK-002`, `RSK-003` | A code, query, cache, timing, or projection defect may still cross a tenant or ACL boundary. | RLS tests, tenant-qualified constraints, graph/vector/object/cache negative tests, revocation latency, side-channel tests, and independent penetration review. |
| `RSK-004`, `RSK-005` | Novel prompt injection or connector compromise may bypass assumed parsing, egress, or policy boundaries. | Adversarial corpus, sandbox/egress tests, credential canaries, incident exercise, and continuous connector/model evaluation. |
| `RSK-006`, `RSK-013` | Confused-deputy, race, provider ambiguity, or crash recovery may execute an unintended or duplicate action. | Canonicalization vectors, concurrent execution tests, source-version conflicts, restart reconciliation, approval revocation, and compensation drills. |
| `RSK-007` | A future ontology, dashboard, prompt, export, or customer configuration may recreate prohibited workforce scoring. | Schema/policy deny rules, product review, adversarial prompts, analytics review, sales/support training, and privacy audit. |
| `RSK-010` | Real-world identity ambiguity may exceed deterministic fixtures and create false merges. | Partner-specific false-merge/non-merge evaluation, review thresholds, split drills, and projection rebuild evidence. |
| `RSK-011` | Users may still over-trust a well-designed distribution or sensitivity chart. | Comprehension testing, claim-language review, calibration/validity documentation, and prohibition of guaranteed-date copy. |
| `RSK-012` | Provider outage, snapshot retirement, or regression may exceed fallback coverage. | Snapshot registry, failover exercises, capacity/budget alerts, fallback evaluation, and explicit unavailable behavior. |
| `RSK-014`, `RSK-015` | Logs, audit, backups, and derived stores may retain sensitive or deleted content. | Data inventory, content canaries, retention/deletion scan, backup-expiry evidence, redaction tests, and restricted audit access review. |
| `RSK-017` | Advanced visualization may exclude users or distract from evidence. | Keep 3D organizational visualization Rejected; permit the bounded synthetic physical-asset scene only with a component-location decision task, keyboard/reduced-motion support, rendering fallback, and an equivalent structured view. |
| `RSK-018` | Sustained backlog may make a graph or answer materially stale. | Lag SLOs, backpressure, priority, reconciliation, stale-result UX, capacity tests, and fail-closed actions. |

## 6. Known limitations and architecture boundaries

These limitations are intentional and do not represent hidden implementation choices:

- H1 ingests external-source metadata from synthetic GitHub and Jira only. The `CH-17` asset path generates synthetic telemetry inside the application; it has no IoT connector, historian, industrial protocol, physical-device read, or customer data. H1 does not ingest source code, email, private chat, meeting audio, finance records, or individual activity telemetry.
- H1's Jira field update is the only external mutation. Asset control modifies in-process simulator state and receipts state `external_write: false`. Every additional external action class requires a separate schema, threat model, approver policy, idempotency definition, source concurrency rule, compensation behavior, evaluation, and opt-in.
- H1 physical-asset anomalies and forecasts are deterministic demonstrations over synthetic history. They are not trained or validated predictive-maintenance models and cannot support maintenance, safety, or equipment-operation decisions.
- PERT/Monte Carlo output is conditional on fixture distributions and dependency structure. It is not a causal estimate and cannot validate a real launch forecast.
- Shared tenancy is the reference deployment. Dedicated, customer-managed, regional, air-gapped, and edge profiles remain separately gated.
- The online OpenAI runtime is an explicit dependency for H1. Air-gapped inference is unavailable until a local model profile passes the same workload-specific quality and safety gates.
- PostgreSQL, Neo4j, pgvector, and Valkey are sufficient only inside measured boundaries. Scale transitions follow `CH-15`; they are not pre-approved technology migrations.
- Two-person approval reduces accidental or unilateral action but does not prevent collusion. Organizational role assignment, separation-of-duty review, and audit monitoring remain required.
- Source systems may not support transactional rollback. Compensation is a new conditional action with conflict handling, not erasure of history.
- Control mapping is not certification and architecture cannot supply legal basis, employee consultation, customer contract, incident staffing, or operational control effectiveness.

## 7. Release convergence criteria

Specification version 1.0.0 is release-eligible only when all of the following are evidenced from a clean checkout:

1. Every normative Markdown file has unique valid frontmatter; every catalog, contract, diagram source, and example validates.
2. Consolidated Markdown, HTML, PDF, and traceability outputs build reproducibly.
3. Requirement coverage is 100 percent from each `REQ` through artifact, accepted ADR, component/contract, control, acceptance criterion, and horizon.
4. H1 and H2 contain no unresolved major product, security, privacy, data, topology, interface, lifecycle, failure, SLO, observability, ownership, or compatibility decision and no unowned `TBD`.
5. Every Committed subsystem defines purpose, non-goals, actors, ownership, schemas, interfaces, workflows, invariants, authorization, privacy, consistency, failure behavior, scaling, cost, SLOs, telemetry, deployment, testing, risks, and evolution.
6. The risk catalog contains no open Critical or High item. Each accepted Medium item has a named owner, expiry, compensating controls, and revisit trigger.
7. Two consecutive cross-domain reviews introduce no new Critical or High finding. Self-review passes alone do not satisfy independent build readiness.
8. An engineer independent of the authoring work records `AC-REV-001`: H1 can be implemented without making another major unstated product, security, data, topology, or interface decision.
9. The H1 workload evidence plan covers tenant isolation, permission revocation, deterministic ingestion/rebuild, citation/abstention, prompt injection, simulation reproducibility, approval expiry and mutation, duplicate execution, rollback/conflict, dependency failure, performance, accessibility, audit, and supply chain.
10. Any conflict is resolved by the declared precedence order rather than by document date or implementation convenience.

`AC-REV-002` is met only when criteria 1 through 10 are recorded in the generated audit/remediation dossier. Absence of a detected problem is not evidence of completion.

## 8. Reopen triggers

The Architecture Review Board MUST reopen the affected audit domain when any of the following occurs:

- A Critical/High vulnerability, privacy impact, tenant-isolation failure, source-ACL leak, unsafe action, or prohibited-use path is discovered.
- A model, provider, connector API, identity provider, policy engine, datastore, workflow runtime, or deployment profile changes its relevant contract.
- A new external mutation, connector data category, ontology domain, cross-tenant use, memory type, prediction target, or workforce-sensitive purpose is proposed.
- H1/H2 workload, tenant count, graph size, event rate, concurrency, latency, availability, RPO/RTO, residency, or cost boundary is exceeded.
- A benchmark triggers OpenSearch, ClickHouse, Kafka, a lakehouse, finer services, GraphQL, gRPC, another graph engine, or another language.
- A deployment adds customer management, on-premises, air gap, edge, multi-region writes, or active-active behavior.
- An accepted Medium risk reaches expiry, its compensating control fails, or its owner changes without renewed acceptance.
- An accessibility regression prevents equivalent completion of a Committed workflow.

Reopening a domain does not automatically invalidate unrelated decisions. The new review records impacted requirements, contracts, controls, risks, migrations, tests, rollout, rollback, and semantic version before implementation.

## 9. Final self-critique

The strongest aspect of this architecture is that it turns an ambitious organizational-intelligence concept into a complete, testable chain from evidence to governed action while preserving a larger extensibility path. The most consequential remaining weakness is not an unmade architecture choice; it is the amount of disciplined implementation and operating evidence required to prove that tenant isolation, permission fidelity, model safety, deletion, recovery, and action idempotency work together under failure.

The architecture deliberately accepts slower breadth expansion, a multi-runtime learning cost, and limited H1 external validity. Those tradeoffs are preferable to unsupported hyperscale claims, premature infrastructure, hidden workforce inference, or unsafe autonomy. If implementation evidence contradicts a design assumption, the appropriate response is to reopen the decision and narrow or redesign the capability, not to weaken the gate.
