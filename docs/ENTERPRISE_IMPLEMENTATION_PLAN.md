# Enterprise Intelligence Implementation Plan

Status: approved implementation baseline  
Audit date: 2026-07-22  
Scope: application architecture, AI, security, tenant isolation, governance, UX, performance, reliability, scalability, and verification

## Executive assessment

The repository is a credible H1 demonstrator, not yet an enterprise deployment. It has a modular API, an isolated AI worker, a provider-neutral interface for Llama and OpenAI, tenant-qualified records with PostgreSQL row-level security, deterministic simulations, document parsing, evidence-aware retrieval, audit hashes, and a restrained operations-oriented UI. Those foundations should be extended rather than replaced.

The principal gaps are runtime breadth and enforcement consistency. The requested Financial, Operations, and Risk analysts do not exist as first-class profiles; Anthropic and arbitrary custom endpoints are absent; reusable skills and MCP servers are documentation contracts rather than governed runtime registries; no durable daily/weekly/monthly intelligence scheduler exists; financial, market, document, and industry entities lack a unified configurable domain service; enterprise SSO/MFA and ABAC are not implemented; governance metadata is not mandatory on every write; and continuous review does not cover secret scanning, Python dependencies, SAST, load tests, or authorization invariants.

No application code is to be modified before this plan is committed.

## Current implementation audit

### Architecture

- `apps/api` is a NestJS/Fastify control plane. Controllers derive tenant and actor context through `ContextService`; services own graph, event, asset, simulation, prediction, integration, and gateway behavior.
- `apps/ai-worker` is a FastAPI execution plane. It contains provider adapters, routing, agent specifications, bounded memory, RAG, document parsing, evidence validation, simulation, and tenant-aware persistence.
- `apps/sync-worker` provides connector synchronization and Temporal workflow scaffolding.
- `apps/web` is a Next.js interface with explorer, scenario, action, asset, event, and AI control workspaces.
- PostgreSQL `edt.records` acts as a tenant-qualified generic authoritative store. Outbox and hash-chained audit records provide a useful transaction/audit foundation. Graph projection is optional.
- The code is modular by process but several domains use large services and generic JSON records. This keeps the demo flexible while moving schema, validation, and query costs into application code.

### Previous-phase verification

- Phase 1/2 foundations are visible in migrations `001` through `003`: tenant isolation, graph integrity, integration records, source lineage, and outbox patterns.
- Phase 3 is represented by migration `004`, decision simulation and prediction services, model registry records, tests, and UI components.
- Existing ADRs correctly require shared multitenancy with RLS, source ACL enforcement, durable workflows, provider neutrality, explicit agent authority, immutable snapshots, and separated decision intelligence.
- The new implementation will preserve these boundaries: the API remains the policy enforcement point; AI outputs remain proposals; tenant identity is server-derived; simulations remain side-effect free; external tools are deny-by-default.

### Security boundaries

Trust boundaries currently exist between browser/API, API/AI worker, API/database, sync worker/external systems, and application/graph/object stores.

Strengths:

- Tenant IDs are derived from authenticated context, not accepted from ordinary request bodies.
- PostgreSQL RLS is forced on tenant data and the application role cannot bypass RLS.
- The API-to-worker call requires a shared service secret, sends bounded permissions, enforces timeouts and response limits, and validates/redacts worker output.
- Document ingestion has media and size allowlists; Office archives receive structural checks.
- Agent results are pending proposals with evidence validation and explicit review paths.
- Provider keys are sourced from environment configuration and are not returned in API responses.

Risks and required remediation:

| Priority | Finding | Consequence | Planned control |
|---|---|---|---|
| Critical | Production identity is not implemented; demo HMAC authentication is the only runnable identity path. | No enterprise SSO, OAuth/OIDC, or MFA assurance. | OIDC JWT validation, issuer/audience allowlist, authentication assurance claims, disabled demo auth in production. |
| Critical | Authorization is capability-based but lacks a centralized RBAC plus ABAC decision engine. | Department, ownership, project, location, and sensitivity policies can diverge by service. | One fail-closed policy service used by controllers, graph queries, documents, agents, MCP, loops, and audit reads. |
| Critical | AI worker trust uses a static bearer secret and forwarded headers. | Replay or lateral movement if the secret leaks. | Rotation support, request timestamp/nonce/HMAC binding, network policy, and production mTLS guidance. |
| High | Generic record payloads do not universally require ownership, lineage, quality, classification, or retention metadata. | Governance questions cannot be answered for every datum. | Mandatory governance envelope and write-time validation. |
| High | MCP/custom endpoints could become SSRF and privilege-escalation paths if implemented naively. | Internal network access, secret disclosure, or unsafe mutations. | Admin-only registry, HTTPS/host allowlists, no redirects/private IPs, scoped secrets, per-tool policy, approvals, timeouts, schemas, and audit. |
| High | Default development object-store credentials exist in sync-worker configuration. | Unsafe deployment if defaults reach production. | Fail closed outside explicit local-demo mode and add secret scanner tests. |
| High | AI audit records are useful but the platform lacks one normalized audit contract containing who, when, before, after, and reason for every mutation. | Incomplete forensic and compliance evidence. | Append-only normalized audit service and database constraints/indexes. |
| Medium | In-memory stores, caches, rate limits, and scheduler state are process-local fallbacks. | State loss and inconsistent behavior under horizontal scaling. | Persistent adapters, leases, idempotency, and explicit demo-only fallbacks. |
| Medium | Provider egress configuration is not a complete destination policy. | Data may be sent to an unintended endpoint or geography. | Tenant/provider allowlists, classification-aware routing, endpoint validation, and no-secret logging. |

### UX audit

The interface already avoids a generic chat-first layout and generally resembles an engineering console. It supports dense navigation and includes evidence, impact, approval, rollback, and scenario concepts. Remaining issues are fragmented domain navigation, an oversized global stylesheet, limited keyboard/table semantics, demo-oriented copy, inconsistent empty/error states, and no dedicated financial, market, document, industry, governance, or audit workspaces. The AI area exposes technical controls but does not present agents as governed coworkers with visible tools, permissions, memory, skills, loops, and execution explanations.

The target UI will use square/low-radius panels, neutral colors, compact tables, explicit state labels, persistent filters, breadcrumb context, dependency/impact questions, and role-appropriate views. It will not introduce glassmorphism, purple/blue gradients, ornamental animation, or a chatbot-dominated experience.

### Performance, reliability, and scalability audit

- PostgreSQL indexes cover common tenant/kind and decision-intelligence paths, but JSONB-heavy domain access will need targeted expression indexes and bounded pagination.
- Graph traversal and search endpoints need explicit depth, node, result, and execution-time budgets.
- AI calls have useful time and response bounds, but provider concurrency, circuit breaking, per-tenant quotas, and durable job state need consolidation.
- Document processing is synchronous at the worker boundary; production ingestion should be queued, idempotent, malware-scanned upstream, and observable by stage.
- Local memory/cache/rate-limit implementations are safe only for a single demonstrator instance.
- Failure handling exists, but readiness must distinguish mandatory dependencies and autonomous jobs require leases, retry budgets, dead-letter state, and resumability.
- The current CI tests Node dependencies but lacks Python dependency scanning, secret scanning, SAST, policy tests, migration linting, and load thresholds.

### Baseline verification evidence

Repository inspection was completed before modifications. The working tree contained an unrelated untracked `get-pip.py`, which is excluded from all phases. On this host, `npm` was not available and `python.exe` could not start, so the baseline test suites could not be executed. This is an environment limitation, not a passing test result. Each phase must still add tests and static validation; the final gate must be executed when the toolchain is available.

## Target architecture

All intelligence execution follows one path:

1. An authenticated actor or leased schedule submits an intent without a client-selected tenant.
2. The API derives tenant, actor, authentication assurance, roles, and attributes.
3. The policy service evaluates action, resource, relationship, sensitivity, and purpose.
4. The API loads a bounded, tenant-isolated graph/evidence context.
5. The agent runtime resolves a versioned agent profile and skill definition.
6. The provider router selects an allowed model/provider using classification, residency, cost, and availability policy.
7. MCP tools are resolved through a tenant registry and individually authorized; mutations require approval.
8. Output is schema-validated, grounded, explained, and stored as a proposal or read-only analysis.
9. A normalized audit event records actor, time, action, before/after, reason, policy decision, evidence, model, tools, and correlation identifiers.

No model or tool receives unrestricted database credentials. No AI response directly mutates authoritative graph or financial data.

## Phased implementation plan

### Phase 1 — Audit and plan

- Commit this audit, security review, prior-phase validation, risk register, target architecture, and acceptance gates.
- Preserve unrelated working-tree content.

Acceptance: the plan exists before application changes and documents blocked baseline verification.

### Phase 2 — Provider-neutral AI, agents, skills, MCP, and loops

- Add Anthropic and governed custom endpoint adapters beside Llama and OpenAI.
- Add immutable provider configuration validation, classification-aware routing, SSRF defenses, bounded retries, quotas, and redacted telemetry.
- Define Financial Analyst, Operations Analyst, and Risk Analyst profiles with purpose, tools, permissions, memory policy, skills, loop participation, graph access, and output schemas.
- Implement versioned reusable skill definitions specifying required data, tools, MCP servers, model policy, and bounded execution steps.
- Implement a tenant-scoped MCP registry and tool broker with schema validation, capability checks, approvals, and audit explanations.
- Implement daily/weekly/monthly loop definitions with durable leases, idempotency windows, explicit job outputs, and no autonomous write authority.

Acceptance: provider contract tests, agent boundary tests, MCP SSRF/permission tests, and schedule/idempotency tests pass.

### Phase 3 — Financial, market, document, and industry intelligence

- Add configurable graph-backed financial entities and relationships, financial metrics, forecasts, ROI, cash flow, and scenario inputs.
- Add customer, competitor, market, regulation, trend, and economic-factor entities with profitability, churn, dependency, competitor, and market-impact analyses.
- Extend document indexing with entity/link suggestions, provenance, ACL propagation, relationship review, and knowledge retrieval.
- Add versioned industry model packages for construction, manufacturing, and software plus custom node types, relationships, rules, simulations, models, and workflows without core edits.

Acceptance: domain validation, tenant isolation, calculations, document linkage, and custom-industry tests pass.

### Phase 4 — Enterprise security, tenancy, audit, and governance

- Add OIDC/OAuth bearer validation and MFA assurance enforcement while keeping local demo auth explicitly non-production.
- Centralize Executive/Manager/Employee RBAC and department/ownership/project/location/sensitivity ABAC.
- Require tenant and authorization context at every repository, graph, AI, MCP, loop, and audit boundary.
- Add governance envelopes for source, owner, lineage, quality, classification, retention, and encryption metadata.
- Normalize append-only audit entries with who, when, what, previous value, new value, and reason.
- Harden secret handling, service authentication, transport policy, deployment defaults, and key redaction.

Acceptance: cross-tenant, confused-deputy, IDOR, ABAC, MFA, audit-integrity, retention, and secret-exposure tests pass.

### Phase 5 — Enterprise product interfaces

- Add dense workspaces for financial intelligence, market intelligence, documents, industry configuration, security/governance, AI agents, loop history, and audit review.
- Improve explorer dependency/impact navigation, search/filter state, simulation comparisons, evidence display, and explanation receipts.
- Apply accessibility, keyboard, responsive, loading, empty, and failure-state review.
- Remove remaining gradient/AI-marketing visual treatments and reduce card/rounding excess.

Acceptance: component tests cover navigation, filters, permissions, errors, and key decision workflows; accessibility smoke checks pass.

### Phase 6 — Continuous audit, test expansion, and final review

- Add CI checks for secrets, SAST, Node and Python dependencies, authorization invariants, migrations, architecture boundaries, and generated contract drift.
- Add unit, integration, security, AI, simulation, and load tests with explicit budgets.
- Run the complete build/test/audit suite and document remaining limitations with owners and severity.
- Fix all feasible findings and produce an enterprise readiness report. Unimplemented production dependencies must be labeled, not simulated.

Acceptance: all locally available gates pass; CI definitions are reproducible; final report contains no untracked critical finding.

## Non-negotiable implementation rules

- Fail closed on missing identity, tenant, policy, secret, schema, provenance, or audit context.
- Never trust tenant, role, permission, ownership, or classification supplied by the browser or model.
- Never place credentials in model prompts, logs, audit before/after values, source control, or MCP arguments.
- Never let AI or an autonomous loop directly mutate authoritative state; use proposals, approval, idempotency, and compensation.
- Bound every traversal, query, upload, prompt, response, retry, loop, and external call.
- Preserve provenance and source ACLs through document chunks, graph context, agent memory, model output, and citations.
- Keep provider, model, industry, skill, agent, connector, and MCP definitions versioned and replaceable.
- Maintain separate tenant contexts, caches, memories, quotas, schedules, provider policies, and encryption scopes.
- Use migrations and backwards-compatible contracts for durable state.
- Do not claim production readiness for controls that require an external IdP, KMS, WAF, malware scanner, SIEM, or managed database; provide secure integration boundaries and deployment validation.

## Verification matrix

| Area | Required evidence |
|---|---|
| Unit | Provider adapters, policies, financial formulas, schemas, schedules, redaction |
| Integration | API-to-worker, graph context, MCP broker, document-to-entity, audit persistence |
| Security | tenant isolation, RBAC/ABAC, MFA assurance, SSRF, IDOR, prompt/tool injection, secret scanning |
| AI | schema conformance, evidence authorization, provider failover, cost limits, explanation presence |
| Simulation | deterministic financial scenarios, invariant preservation, immutable snapshots |
| Load | bounded graph traversal, search pagination, agent concurrency, loop leasing, document queues |
| UX | role navigation, keyboard access, dense tables, errors, permission denials, reduced motion |

## Known external production dependencies

An enterprise deployment still requires configured infrastructure: an OIDC identity provider enforcing MFA, a KMS-backed secret manager and envelope encryption, managed TLS certificates, network egress controls, a malware scanning service, durable workflow infrastructure, production PostgreSQL/object/graph/vector stores, centralized metrics/logs/traces, and a SIEM archive. The application must validate these dependencies and fail closed in production mode.
