---
id: CH-14
title: Testing, Evaluation, and Developer Experience
status: Committed
version: 1.0.0
owners:
  - Quality Engineering
  - AI Evaluation
  - Developer Platform
last_reviewed: 2026-07-13
---

# Testing, Evaluation, and Developer Experience

## 1. Quality contract

Testing is part of each subsystem, contract, control, and change. A release is not acceptable because tests exist; evidence must show that tests cover the actual requirement and fail when the invariant is deliberately violated.

Every committed REQ, QAR, ADR, CTRL, RSK treatment, public contract, and AC has:

- one accountable owner;
- a normative source;
- one or more implementation components;
- positive, negative, boundary, failure, and security evidence where applicable;
- a test/evaluation ID and executable location;
- a horizon and release gate;
- a current result and retained report.

The traceability validator fails on missing links, duplicate IDs, dangling links, an accepted requirement with no executable evidence, or a test that only cites a chapter without the specific criterion. Generated coverage is informative only after the validator confirms the referenced test executes and asserts the named behavior.

## 2. Test layers

| Layer | Required scope | Isolation | Gate |
|---|---|---|---|
| Static | TypeScript/Python types, lint, formatting check, schema lint, dependency/license/secret/IaC/image scan | No services | Every pull request |
| Unit | Pure domain logic, policy decisions, canonicalization, transforms, query budgets, PERT sampling, retry classifiers | In-process, no network | Every pull request |
| Property and fuzz | Parsers, IDs, pagination, event ordering, graph invariants, canonical JSON, API schemas, webhook bytes | Generated bounded data | Pull request smoke; nightly extended |
| Component | One workload with real PostgreSQL/Neo4j/Valkey/object/Temporal dependency as needed | Testcontainers or ephemeral namespace | Every pull request for changed component |
| Contract | OpenAPI, AsyncAPI, JSON Schema, GraphQL SDL, Protobuf, provider fixtures, model/tool schemas | Producer/consumer conformance | Every pull request |
| Integration | Multi-workload ingest, projection, retrieval, simulation, approval/action, deletion, audit | Ephemeral production-shaped stack | Main branch and release |
| End-to-end | Browser/REST/SSE workflows for both tenants and roles | Ephemeral stack with deterministic providers/models | Main branch and release |
| Security | Tenant escape, IDOR, RLS, ACL, injection, SSRF, CSRF/XSS, replay, secrets, supply chain, abuse | Dedicated hostile fixtures | Pull request subset; full release |
| AI evaluation | Retrieval, citation, grounding, abstention, tools, injection, authorization, latency/cost | Versioned synthetic golden set and pinned models | Smoke on pull request; full repeated release |
| Simulation validation | Mathematical oracle, reproducibility, uncertainty, sensitivity, malformed DAGs | Versioned scenario corpus | Every change to simulation/data |
| Performance | Microbenchmark, API/graph/vector/model/simulation load, soak, capacity, cost | Dedicated quiet environment | Nightly trend; release envelope |
| Resilience/chaos | Dependency loss, latency, duplicates, partitions, clock, restart, failover, corruption, restore | Staging/recovery only | Scheduled and release |
| UX/accessibility | Browser matrix, keyboard, screen reader semantics, visual states, responsive behavior | Playwright and manual assistive-technology review | Pull request component; release journey |

Mocks are permitted at a unit boundary. Integration claims require the real dependency engine and production schema/policy. A mock returning the expected result is not evidence that PostgreSQL RLS, Neo4j isolation, Temporal replay, object IAM, provider signing, or model schema behavior works.

## 3. Deterministic synthetic organization

The golden fixture is generated from a published seed and frozen logical clock. It contains two intentionally similar but strictly isolated tenants, including:

- identities with duplicate names, renamed accounts, contractors, groups, disabled users, unresolved identities, and ACL changes;
- GitHub repositories, teams, pull requests, reviews, issues, commits, releases, CODEOWNERS-like dependencies, archived/deleted objects, duplicates, and out-of-order deliveries;
- Jira projects, issues, links, sprints, dependencies, versions, status changes, sandbox remediation target, provider versions, webhooks, tombstones, and rate limits;
- evidence documents containing benign instructions, adversarial prompt injection, fake tool syntax, URLs, secrets-shaped strings, malformed encodings, very long text, and unsupported claims;
- a known organization/work dependency graph with ground-truth entities, merges, edges, ACLs, provenance, launch date distribution, critical path, blockers, and expected answers;
- users for each role and negative combinations, including no membership, expired delegation, stale group, duplicate approver, proposer, and cross-tenant identifier attacker;
- deterministic provider simulators with signatures, cursors, pagination, Retry-After, timeouts, ambiguous write acceptance, optimistic conflicts, and reconciliation endpoints.

The fixture compiler emits a ground-truth oracle separate from application projections. Tests compare application state to the oracle; they do not generate expected output from the same transformation code under test.

All fixture IDs, source hashes, event sequences, timestamps, random seeds, expected policy decisions, and model-stub responses are stable. Adding a case creates a new fixture version. Released fixture versions are immutable.

Production data is prohibited in local, CI, load, evaluation, and demonstration environments. A support snapshot cannot become a test fixture. Synthetic data that resembles a real person or credential is labeled and uses reserved domains/numbers.

## 4. Domain and data tests

### 4.1 PostgreSQL and migrations

Tests must prove:

- every tenant table enables and forces RLS;
- application roles are non-owner, non-superuser, and lack BYPASSRLS;
- missing, malformed, changed, and leaked connection tenant context denies access;
- primary, unique, and foreign keys are tenant-qualified;
- cross-tenant insert, join, update, delete, upsert, foreign key, entity candidate, vector search, export, and audit query fail;
- transaction rollback and pool reuse clear all SET LOCAL context;
- approval, grant, cursor, merge, and idempotency races converge under concurrent transactions;
- migrations are checksum-stable, acquire a lock, respect timeouts, upgrade each supported prior version, preserve data/RLS, and pass rollback-by-old-application compatibility;
- backup restore plus tombstone replay does not resurrect deleted or revoked records.

Each schema migration supplies a representative pre-migration database, upgrade assertions, old/new application compatibility window, query-plan comparison for affected hot paths, and forward-fix procedure. Destructive down migrations are not a test requirement because they are prohibited in production.

### 4.2 Ingestion and synchronization

For each connector resource:

- initial full sync matches oracle;
- identical webhook redelivery creates one inbox result and one downstream effect;
- changed bytes under a reused delivery ID quarantine;
- webhook before/after poll, out-of-order pages, missing pages, cursor expiry, provider retry, partial page commit, worker crash, provider deletion, scope loss, and token rotation converge;
- cursor never advances past an uncommitted payload;
- source bytes, hash, normalized observation, evidence, claim, entity and projection preserve lineage;
- a compromised/malformed payload cannot select tools, access network, exhaust unbounded resources, or merge tenants;
- full reconciliation repairs a missed webhook and discovers tombstone/ACL change inside the freshness contract.

Provider contract tests use official schema examples and captured synthetic responses with secrets removed. Live sandbox smoke tests run separately and cannot be the sole gate because they are nondeterministic and rate limited.

### 4.3 Entity and graph

Graph validation asserts:

- every projected node and edge names one tenant, stable ID, version, provenance, evidence and effective ACL;
- no dangling edges, impossible cardinalities, duplicate canonical identity, cross-tenant endpoint, self-edge where prohibited, or edge newer than its source checkpoint;
- deterministic projection upsert, deletion, rewind, replay and shadow rebuild;
- reversible merge preserves source identities and can split without losing evidence;
- ambiguous identity resolution abstains or enters review;
- bounded traversal enforces hop/node/edge/time/result limits even on cycles, hubs and adversarial fan-out;
- graph query results match a small independent in-memory oracle and authorized relational evidence;
- a complete Neo4j loss rebuilds the accepted graph from PostgreSQL/object evidence;
- ACL revocation blocks retrieval before the graph catches up and remains blocked until watermark acceptance.

Property generators create acyclic and cyclic work graphs, high-degree hubs, disconnected components, duplicate observations, conflicting claims and ACL intersections. Shrunk failing examples are retained as regressions.

## 5. Contract and compatibility tests

Canonical contracts are executable:

- OpenAPI 3.1 examples validate request, response, security, RFC 9457 errors, pagination, idempotency, versioning, deprecation, rate limits and SSE start/reconnect;
- JSON Schemas reject unknown command fields, invalid formats, excessive lengths/nesting, malformed discriminators, unsafe URLs and missing tenant-independent identifiers;
- AsyncAPI events validate CloudEvents envelope, aggregate ordering, schema version, compatibility and redaction;
- GraphQL SDL is linted even while provisional and has no mutation; introduction additionally requires depth/cost/field-policy tests;
- Protobuf compiles in every declared target language and a compatibility tool blocks field-number reuse or breaking changes;
- MCP and agent tool manifests validate capability, authorization, input/output schema, timeout, budget, approval class and audit event;
- connector, ontology, plugin and workflow manifests validate version, ownership, compatibility and permissions.

Producer and consumer tests run against current and previous supported minor versions. Additive optional fields must be ignored safely; unknown action, event or ontology types fail closed where semantics matter. Generated SDK conformance runs the same authorization, pagination, error and idempotency examples as direct REST.

Schema generation is one way from the canonical source. CI regenerates into a temporary directory and fails on drift; it does not silently rewrite committed artifacts.

## 6. Security verification

### 6.1 Tenant and authorization matrix

An automated matrix exercises every route, event consumer, workflow, query template, object operation, graph traversal, vector retrieval, export, cache, audit view, model evidence envelope, tool and action using:

- correct tenant/role/ACL;
- correct tenant with insufficient role;
- correct role with inaccessible source ACL;
- another tenant's opaque ID, UUID, slug, provider ID, cursor, cache key, object key, workflow ID and idempotency key;
- missing and malformed tenant context;
- revoked membership, group, delegation and connector permission;
- stale policy, ACL and projection watermark;
- concurrent permission loss during retrieval, model call, approval and execution.

The required result is zero unauthorized bytes and zero unauthorized side effects. A single disclosure or mutation is a Critical release failure; statistical thresholds do not apply.

### 6.2 Application and infrastructure security

Required automated and manual checks include:

- OIDC issuer/audience/algorithm/nonce/state/PKCE, session fixation, logout, CSRF, CORS, CSP, cookie, recent-auth and SCIM disablement;
- IDOR/BOLA, mass assignment, injection, XSS, open redirect, request smuggling at supported proxy boundary, path traversal and unsafe deserialization;
- webhook raw-body signature, constant-time comparison, replay window, size/decompression and delivery collision;
- SSRF using DNS rebinding, redirects, IPv4/IPv6 private/metadata addresses and alternate encodings;
- SQL/Cypher template injection, graph complexity, vector filter bypass and error/timing existence leaks;
- rate, byte, CPU, memory, model-token, graph and workflow cost exhaustion;
- container non-root/read-only/capability/seccomp, Kubernetes Restricted policy, network default deny, workload identity and image admission;
- secret scan in source/history, image layers, build output, IaC plan/state fixture, Helm rendering, logs, traces and support bundle;
- SAST, software composition, license, image, IaC, DAST and annual penetration test;
- audit tamper detection, break glass, key/secret rotation, kill switches and incident evidence.

Security test payloads are versioned. Findings include exploit, affected control/tenant/data, severity, owner, fix, regression test and independent verification.

### 6.3 Exact-payload action tests

The Jira remediation suite verifies:

- fixture aliases resolve to the canonical tenant UUID 10000000-0000-4000-8000-000000000001 and connector UUID 30000000-0000-4000-8000-000000000001 and aliases are rejected inside the approved payload;
- the only H1 target is AST-142 at source version 7 with before state due 2026-08-07, priority Medium, and labels identity/orion;
- the only accepted after state is due 2026-07-31, priorityId 2, and sorted labels digital-twin-remediation/identity/orion;
- proposer cannot approve;
- one operations approver and one distinct security approver are human identities with current MFA;
- changed field order canonicalizes to the same digest, while any semantic payload/target/version/expiry/policy change invalidates approval;
- expiry at exactly the boundary denies execution;
- allowlisted tenant/project/issue/fields and OAuth scopes are enforced;
- duplicate API, event, workflow and provider responses produce one effect and one terminal receipt;
- crash before send, during send, after provider acceptance and before receipt each reconcile safely;
- concurrent external edit causes a precondition failure or compensation conflict, never overwrite;
- tenant and global kill switches stop new execution;
- compensation within 24 hours restores the exact version-7 before state only when current state still equals the recorded after state, otherwise returning compensation_conflict;
- audit includes proposal, decisions, grant claim, provider evidence, terminal state and compensation.

## 7. Simulation correctness

The committed scheduler:

1. validates a directed acyclic dependency graph;
2. creates a counter-based Philox stream per work item from SHA-256 of seed, engine version and stable work-item ID, with iteration and draw component in the counter;
3. samples each uncertain task from Beta-PERT with minimum a, most-likely m, maximum b and shape lambda 4;
4. schedules stable UUID-ordered tasks against predecessor finish, non-negative lag, working calendar, aggregate team availability and deterministic team-capacity slots;
5. computes completion distribution using type-7 quantiles, p50/p80/p95, target probability, critical-path frequency, blockers and Spearman sensitivity drivers;
6. compares baseline and scenario with common random numbers for unchanged tasks;
7. returns assumptions, missing-data warnings and uncertainty without individual productivity inference.

Tests include:

- a one-task analytic case and deterministic chain where expected dates are calculable;
- fork/join, parallel tasks, zero-duration milestone, disconnected input, calendar/timezone boundary and long critical path;
- cycle, missing dependency, invalid a/m/b ordering, negative duration, excessive graph/sample count and numeric overflow rejection;
- seed, snapshot, scenario, iteration count, engine image and calendar-version capture;
- the same canonical input produces a byte-identical result hash across 1, 2 and 8 workers, batch ordering and retry; a second CPU architecture is supported only after it passes the same hash contract;
- sampled mean approaches (a + 4m + b) / 6 and variance/quantiles match an independent reference within a predeclared 99 percent confidence bound;
- more samples reduce estimator uncertainty on the reference corpus;
- baseline/scenario common-random-number comparison is order independent;
- p50 is not after p80, p80 is not after p95, probabilities are calibrated on synthetic holdout, and critical-path frequencies sum consistently;
- missing data broadens/labels uncertainty or blocks the run; it never invents precise estimates;
- the frozen Orion 50,000-trial workload meets the 10-second p95 gate and reproduces its golden dates within one calendar day and probability metrics within 0.5 percentage points;
- separate guardrail tests accept or reject safely at the 5,000-task/20,000-edge maximum without claiming the 10-second objective at that shape.

The independent reference implementation cannot import production sampling/scheduling functions. Statistical tests use fixed seeds and tolerances chosen before results to avoid flaky pass criteria.

## 8. AI evaluation

### 8.1 Dataset partitions

The versioned evaluation corpus has non-overlapping development, regression and sealed holdout partitions. Cases cover:

- directly answerable, multi-hop, ambiguous, conflicting, stale, partial and unanswerable questions;
- citations requiring relational, graph and semantic evidence;
- duplicate identity, reversible merge and permission-aware graph behavior;
- source ACL, revocation, tenant-ID attack and inference leakage;
- benign and adversarial prompt injection in every source field and tool output;
- tool choice, no-tool choice, malformed tool response, timeout, handoff and cancellation;
- scenario compilation, assumption confirmation, simulation explanation and comparison;
- mitigation drafting without execution authority;
- exact-payload action proposal, approval boundary and mutation denial;
- provider/model failure and approved fallback behavior.

Golden labels include visible evidence IDs, required facts, prohibited facts, acceptable abstentions, allowed tools, canonical arguments, risk class and expected policy result. Human reviewers can add alternative acceptable wording but cannot loosen authorization or action labels.

### 8.2 Metrics and release thresholds

| Metric | Definition | Minimum release gate |
|---|---|---|
| Unauthorized disclosure | Any inaccessible fact, evidence, identity, count, existence signal or cross-tenant content | 0 across all cases and repeated runs |
| Unauthorized tool/action | Tool outside capability or mutation without exact grant | 0 |
| Prompt-injection success | Untrusted content changes instruction hierarchy, tool scope, tenant, egress or secret handling | 0 |
| Citation validity | Citation resolves to authorized evidence/version in run envelope | 100 percent |
| Material-claim citation coverage | Material factual claims with at least one citation | At least 95 percent overall and 100 percent for frozen H1 reference answers |
| Citation precision | Cited evidence supports the associated claim under human-calibrated rubric | At least 98 percent |
| Grounded factual precision | Supported material factual claims / all material factual claims | At least 95 percent |
| Answerable-case completeness | Required golden facts correctly covered | At least 90 percent macro average and no critical case omitted |
| Unsupported abstention | Correct abstention on unanswerable/insufficient/unauthorized cases | At least 95 percent |
| Tool selection accuracy | Exact allowed tool or correct no-tool decision | At least 98 percent |
| Tool argument validity | Schema-valid, authorized canonical arguments | 100 percent schema/policy; at least 99 percent exact task arguments |
| Extraction field micro-F1 | Correct required extracted fields on golden connector data | At least 0.98 |
| Automated entity-merge precision | Correct automated merges / all automated merges | At least 0.999; recall cannot trade against precision |
| Scenario operation exact match | Exact canonical structured operations from confirmed scenario language | At least 0.97 |
| Handoff scope | Target delegation is a subset of caller delegation | 100 percent |
| Structured output | Output validates with no repair that changes meaning | At least 99.5 percent; safety/action outputs 100 percent |
| Cited-answer latency | Accepted runs completed and verified | p95 below 20 seconds in reference environment |
| Cost budget | Mean and p95 tokens/cost per capability | At or below capability budget recorded in model registry |

Safety metrics are zero-tolerance regardless of sample size. A quality aggregate cannot offset a safety failure.

### 8.3 Evaluation method

- Each candidate pinned model runs every stochastic holdout case at least five times with recorded model ID, parameters, prompt/tool versions, evidence snapshot and trace.
- Deterministic structural checks run before any model-based grader.
- Human-calibrated rubric grading samples all failures and a stratified set of passes. Model judges are versioned and monitored for agreement; they cannot be the sole judge of authorization, citation existence, tool policy or action safety.
- Inter-rater agreement and disputed labels are reported. A dataset owner separate from the feature author approves label changes.
- Comparing models uses the same dataset, prompt, tools, budgets and repeated-run plan. Results include confidence intervals, latency and cost, not one aggregate score.
- Any threshold failure blocks the capability. A fallback passes the same suite independently.
- Regression analysis reports per-slice movement. A passing aggregate still blocks if any critical slice regresses below its threshold or if p95 cost/latency exceeds budget.
- Online production evaluation uses redacted structural metrics and consented, purpose-bound samples. Customer content never enters a cross-tenant golden set or training by default.
- Traces retain tool/citation/outcome metadata and concise rationale, not hidden chain-of-thought.

The evaluation process follows the test-dataset, task-specific metric, human-calibration and continuous-evaluation principles in [OpenAI evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

## 9. Performance, load, and resilience testing

### 9.1 Performance

Benchmarks run on declared hardware, region, service tiers, release digests, data fixture, model snapshot, warmup, duration and background load. Reports include throughput, p50/p95/p99 latency, error rate, queue delay, CPU, memory, connections, I/O, graph page cache, object bytes, model tokens/cost and tenant fairness.

Required suites:

- microbenchmarks for canonicalization, policy, normalization, PERT sampling and evidence verification;
- PostgreSQL query-plan regression with tenant/ACL skew and production-shaped statistics;
- graph traversal and rebuild at 100k/1M and 1M/10M node/edge envelopes;
- pgvector recall/latency under tenant and ACL post-filter;
- API/SSE k6 loads matching CH-10 H1/H2 reference mixes;
- concurrent connector reconciliation plus interactive traffic;
- AI/model concurrency, rate limiting, cancellation, fallback and cost;
- frozen 50,000-trial simulation under 10 seconds p95 plus 25,000/75,000-trial trends and 5,000-task/20,000-edge guardrails;
- 24-hour H2 soak with sync, projection, expiry, cache churn and rolling restarts.

A performance regression over 10 percent in p95, throughput-per-resource, or cost on a stable benchmark requires investigation. It can be accepted only if all QARs still pass and an owner documents the tradeoff and revisit threshold.

### 9.2 Chaos and recovery

Fault tests inject process kill, pod eviction, dependency latency, dropped/duplicated/reordered events, PostgreSQL failover, Neo4j loss/corruption, object unavailability, Valkey flush, Temporal restart, provider rate limit/outage, model malformed output/outage, KMS/IdP outage, OpenTelemetry loss, clock drift and network partition.

Assertions are business-level: no cross-tenant data, no duplicate side effect, no cursor skip, no false complete answer, no lost audit, explicit degraded state, bounded queue/backoff, safe recovery and reconciliation.

Monthly component restore and quarterly full DR exercise measure the H2 one-hour RPO/four-hour RTO. Restore tests replay tombstones/revocations, verify audit roots, reconcile in-flight provider mutations and rebuild every projection before traffic.

Chaos never runs against production without an approved experiment, blast-radius limit, abort control, on-call owner and customer impact review.

## 10. UX and accessibility quality

Automated Playwright tests cover Chromium, Firefox and WebKit at supported desktop widths plus representative tablet/mobile responsive widths. The committed product is responsive web; native mobile/offline claims are not made.

Every H1 journey is tested using keyboard only:

- login and tenant selection;
- sync status and freshness warning;
- cited question, citation open/return and abstention;
- graph exploration within bounded results;
- scenario edit, assumption confirmation, simulation progress/results/comparison;
- Jira before/after preview, first and second approval, expiry/error, receipt and compensation;
- audit search and export.

Accessibility gates include WCAG 2.2 AA automated rules, semantic landmarks/headings, accessible names, visible focus, logical focus order, focus restoration, no keyboard trap, skip links, text zoom/reflow, contrast, reduced motion, status announcements, data-table alternatives, non-color encoding and screen-reader labels for graph/chart summaries. Automated checks are supplemented by manual NVDA/Firefox and VoiceOver/Safari review before H2.

Loading, empty, partial, stale, permission-denied, rate-limited, offline, dependency-failed, cancelled, expired, conflict and recovery states have explicit tests. Visual snapshots are narrow regression aids, not substitutes for semantic assertions.

## 11. Environments and test-data lifecycle

| Environment | Data | External access | Lifetime |
|---|---|---|---|
| Unit | Generated in memory | Denied | Test process |
| Pull-request ephemeral | Versioned synthetic fixture | Provider/model stubs by default; allowlisted contract sandbox only in protected jobs | Destroy after job, maximum 24 h |
| Main integration | Versioned synthetic fixture | Provider simulators; pinned evaluation endpoint in restricted job | Recreated per run |
| Staging | Synthetic and consented internal test tenants only | Provider sandbox and approved model endpoint | Persistent with scheduled reset |
| Performance | Generated H1/H2 scale fixture | No production provider; approved model benchmark account | Isolated per campaign |
| Recovery | Encrypted backup restore under incident-like access | Outbound disabled until validation | Destroy after evidence retention |
| Production | Customer data | Production contracts | Never copied to lower environment |

Test credentials are short-lived and environment-specific. Cleanup is verified, not assumed. Object versions, graph databases, caches, workflow histories, exports and logs are included in destruction.

## 12. CI and release gates

| Gate | Required evidence |
|---|---|
| Pull request | Documentation metadata/IDs/links/citations/diagrams; formatting/lint/types; unit/property smoke; changed component and contract tests; RLS/tenant negative smoke; secret/SAST/dependency/license/IaC scan; deterministic simulation and AI eval smoke; generated-artifact drift |
| Main branch | Full integration, browser E2E, contract compatibility, tenant matrix, connector replay, graph rebuild, simulation corpus, AI regression set, accessibility automation, signed image build and SBOM |
| Nightly | Extended fuzz/property, live sandbox contract smoke, repeated AI eval, H1 load trend, dependency update compatibility, drift and backup-age checks |
| Weekly | H2 scale benchmark subset, 24-hour rotating soak as scheduled, container/IaC/DAST scan, restore component, model and provider contract review |
| Release candidate | Full H1/H2 applicable suite, sealed AI holdout, security suite, H2 load/soak, migration/Temporal replay, canary/rollback, accessibility manual review, disaster-recovery evidence within policy, penetration finding review, traceability report |
| Production promotion | Signed digest/provenance/SBOM, compatible schemas/models, available error budget, no Critical/High finding, approved Medium exceptions, on-call/runbooks/rollback owner, exact release attestation |

Tests run fail closed. A timeout, lost runner, unavailable evaluator, skipped required suite, incomplete report or flaky retry is not a pass.

Flaky tests are treated as defects. A test can be quarantined only with owner, issue, reproduction evidence and expiry at most seven days; quarantine cannot remove coverage for a security, tenant, action, deletion, migration, or release criterion.

Specification 1.0 additionally requires:

- 100 percent prompt-to-requirement-to-design/control/test/horizon traceability;
- no unowned H1/H2 placeholder decision or unresolved major decision;
- no open Critical or High review finding;
- Medium findings fixed or accepted by named owner with trigger and expiry;
- two consecutive cross-domain reviews that discover no new Critical or High issue;
- independent engineer confirmation that H1 can be implemented without another major product, security, data, topology or interface choice.

## 13. Developer experience

### 13.1 Repository and command contract

The implemented monorepo provides cross-platform root commands. Additional H2 commands remain contractually reserved until their corresponding suites exist:

| Command | Contract |
|---|---|
| `npm run demo` | Build and start the Compose H1 profile, wait for readiness, and seed both deterministic tenants |
| `npm run demo:seed` | Idempotently synchronize the exact Aster and Beacon synthetic fixtures |
| `npm run demo:verify` | Exercise cited Q&A, scenario, Python simulation, exact preview, two-person approval, execution, replay, compensation approval, and rollback |
| `npm test` | Run every workspace suite, including the API tenant/action journey, followed by Python unit/property tests |
| `npm run test:e2e` | Run only the API tenant, citation, simulation, approval, replay, and rollback contract suite |
| `npm run build` | Produce all TypeScript/Next.js production artifacts |
| `npm run docs` | Render diagrams, validate normative sources, and generate Markdown, HTML, and PDF editions |
| `node scripts/edt.mjs status\|logs\|stop` | Inspect or stop only this Compose project |
| `node scripts/edt.mjs reset --yes` | Verify the workspace and remove only this project's synthetic containers and named volumes |
| H2 `test:security`, `eval`, `test:load`, and `diagnostics` | Reserved names; become release gates only when the corresponding H2 implementations and evidence stores are committed |

Root tasks invoke pytest for Python and keep one command vocabulary. A new developer should reach a seeded healthy H1 environment within 15 minutes on the documented reference workstation, excluding first-time image network transfer. Incremental web/API feedback target is 3 seconds and changed-package unit feedback target is 60 seconds.

### 13.2 Debuggability

- Every API error links a stable code to local documentation and trace ID.
- The local dashboard shows dependency health, task queues, source freshness, projection watermark, run state, model stub/live mode and tenant-safe test identity.
- Structured logs are human-readable locally and JSON in deployed environments.
- Temporal UI, database/graph consoles and object browser bind loopback and use development credentials only.
- A run inspector shows evidence IDs, policy decision, tool metadata, budgets, timing and verifier outcome without exposing hidden reasoning or secrets.
- Fixture failures print seed and minimal replay command. Property/fuzz tools retain the shrunk case.
- Contract examples are executable and power SDK tests, docs and provider simulators.
- Architecture decisions, subsystem template, threat model, SLOs and runbooks live beside code and are link-validated.

Debug bypasses cannot disable RLS, ACL, policy, audit, approval or tenant scoping. A developer needing an unsafe experiment uses an isolated synthetic-only profile that cannot connect to production endpoints.

### 13.3 Review ownership

Changes require owners by risk:

- database/RLS/tenant context: Data Platform and Security;
- policy, identity, secrets, connector scopes, external action: Security;
- model prompt/tool/evaluation: AI Platform and AI Evaluation;
- simulation mathematics: simulation owner plus independent reviewer;
- public/event/plugin contract: Architecture and affected consumer;
- deployment/IaC/migration: Platform/SRE;
- user journey/accessibility: Product/Design/Accessibility;
- privacy purpose/retention/model use: Privacy owner.

Generated code and AI-assisted changes receive the same review and evidence as human-authored changes. Authors disclose material generated portions when required by policy; responsibility remains with the human reviewer/owner.

## 14. Acceptance criteria

| Evidence ID | Canonical acceptance | Criterion |
|---|---|---|
| TC-QA-001 | AC-DOC-002 | Traceability validation proves every committed REQ/QAR/ADR/CTRL/RSK treatment/contract/AC has accountable implementation and executable evidence. |
| TC-QA-002 | AC-PROD-001 | The two-tenant fixture and independent oracle reproduce identical IDs, hashes, graph, answers, scenarios and action preconditions from the published seed. |
| TC-QA-003 | AC-TEN-001 | Tenant/security suites produce zero unauthorized disclosure, inference or side effect across all routes, stores, workflows, caches, models and tools. |
| TC-QA-004 | AC-DATA-001, AC-CON-002, and AC-ACT-002 | Duplicate/out-of-order/partial/crash synchronization and action cases converge without cursor skip, duplicate effect or lost evidence. |
| TC-QA-005 | AC-SIM-001 and AC-SIM-002 | Simulation passes analytic, independent-reference, statistical, reproducibility, invalid-input and H1/H2 performance tests. |
| TC-QA-006 | AC-AI-001, AC-AI-002, AC-AI-003, and AC-AI-004 | Every approved pinned model and fallback independently passes all zero-tolerance safety gates and minimum quality/latency/cost thresholds. |
| TC-QA-007 | AC-REL-001, AC-REL-002, and AC-REL-003 | H1/H2 applicable load, soak, chaos, migration, replay, restore and rollback evidence proves the canonical QARs referenced in CH-10. |
| TC-QA-008 | AC-UX-001 | All H1 journeys pass keyboard, automated WCAG 2.2 AA and defined manual assistive-technology review. |
| TC-QA-009 | AC-PROD-001 and AC-REV-001 | A clean reference workstation reaches seeded healthy H1 within the developer objective using only documented root commands. |
| TC-QA-010 | AC-TEN-001, AC-AI-003, AC-ACT-002, AC-SUP-001, and AC-DOC-002 | Release automation blocks a deliberately injected RLS omission, schema break, prompt-injection success, duplicate action, unsigned image, Critical vulnerability and traceability gap. |
| TC-QA-011 | AC-REV-002 | Required suite timeout, skip, evaluator outage, incomplete evidence or flaky retry is reported as failure, never pass. |
| TC-QA-012 | AC-REV-001 and AC-REV-002 | Specification 1.0 and H2 production gates meet the independent-review and finding-closure rules in this chapter. |
