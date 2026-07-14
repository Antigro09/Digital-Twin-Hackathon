---
id: CH-15
title: Delivery Roadmap and Research Program
status: committed
version: 1.0.0
owners:
  - architecture-council
  - product-management
  - research-governance
last_reviewed: 2026-07-13
---

# Delivery Roadmap and Research Program

## 1. Roadmap policy

This roadmap is dependency-gated rather than date-promised. A later horizon cannot compensate for a missing invariant in an earlier horizon. Scope may move later, but tenant isolation, permission fidelity, provenance, idempotency, action governance, and audit evidence may not be deferred from the first capability that needs them.

Capability status means:

- `Committed`: approved for the named horizon with an owner, dependencies, acceptance evidence, and support boundary.
- `Provisional`: architecture direction is selected, but a named benchmark, pilot result, or external dependency must pass before commitment.
- `Research`: a falsifiable hypothesis under a research protocol; unavailable to ordinary production workflows.
- `Rejected`: intentionally not pursued in the named horizons; it requires a new decision record and stated revisit trigger.

Under `REQ-GOV-004`, marketing, demonstrations, APIs, feature flags, and documentation MUST NOT present a Provisional, Research, or Rejected capability as generally available. A capability cannot advance status merely because its code exists; graduation requires the product, safety, security, privacy, reliability, cost, evaluation, operations, and user-value evidence defined here. No roadmap item may weaken the prohibited individual employment and health use cases enforced by `REQ-ACT-004` and `CTRL-PRV-002` through H3.

## 2. Dependency spine

The critical dependency order is:

```text
Normative contracts and threat model
  -> tenant identity, authorization, and audit
  -> authoritative data, outbox, and immutable artifacts
  -> connector synchronization and provenance
  -> entity resolution and rebuildable projections
  -> permission-aware retrieval and cited answers
  -> versioned scenario snapshots and simulation
  -> exact-payload approval and one connector action
  -> pilot operations, deletion, and recovery
  -> measured enterprise scale and deployment expansion
  -> separately governed research capabilities
```

Work may proceed in parallel only after the contracts at its incoming edge are frozen and validated. Frontend mocks may precede backend completion, but they cannot define alternate authorization, action, or data semantics.

## 3. Horizon summary

| Horizon | Status | Product boundary | Scale and service boundary | Exit decision |
|---|---|---|---|---|
| H1 - Hackathon reference slice | Committed | Two synthetic tenants; GitHub metadata read-only; Jira read and one dual-approved remediation update; cited launch-risk answer; seeded launch simulation; rollback | Up to 100 identities, 100,000 graph nodes and 1,000,000 edges per tenant; ten concurrent users; 15-minute freshness; p95 non-AI read under 2 seconds, simulation under 10 seconds, cited answer under 20 seconds | Complete the frozen `CH-02` workload and all H1 security, quality, accessibility, and audit gates |
| H2 - Design-partner pilot | Committed after H1 exit review | Up to ten tenants; enterprise SSO/SCIM; permission revocation; retention/deletion; connector recovery; partner-approved domains | Up to 1,000 users and 1,000,000 nodes/10,000,000 edges per tenant; 99.9 percent availability; one-hour RPO; four-hour RTO | Partner acceptance, operational evidence, deletion proof, representative load and recovery tests, and no unresolved Critical/High finding |
| H3 - Enterprise GA | Provisional | Supportable enterprise product, commercial controls, hardened integrations, measured scale tiers | Scale, SLO, cost, isolation, residency, and DR targets are frozen from H2 telemetry and representative benchmarks before commitment | GA readiness review proves targets, support model, security evidence, upgrade/rollback, and unit economics |
| H4 - Deployment expansion | Provisional | Dedicated data plane, customer VPC, on-premises, air-gapped, regional, and edge profiles introduced separately | Per-profile limits and failure domains; no blanket active-active multi-cloud promise | Each profile passes compatibility, security, operability, upgrade, backup, recovery, and cost gates |
| H5 - Research | Research | Hyperscale graph, causal organizational models, bounded higher autonomy, collective decision systems, and long-horizon simulations | No production scale claim; trillion-edge and autonomous-organization ideas remain hypotheses | Each program has its own ethical, scientific, safety, legal, and product graduation decision |

## 4. H1 - Production-shaped hackathon slice

### 4.1 Team and timebox

H1 is designed for three to five people over two to four weeks:

- Platform/security engineer owns tenant context, policy enforcement, PostgreSQL/RLS, action governance, audit, local infrastructure, and CI.
- Data/connectors engineer owns fixtures, GitHub/Jira normalization, synchronization, outbox, provenance, resolution, and projections.
- AI/simulation engineer owns structured retrieval, model gateway, evaluations, scenario compilation, PERT/Monte Carlo engine, and result explanations.
- Product/full-stack engineer owns API integration, application shell, Ask, Explore, Simulation, Approval, and Audit journeys.
- Quality/reliability ownership is shared or assigned to a fifth engineer; release authority remains independent from feature authorship.

A smaller team preserves subsystem ownership but reduces parallelism; it does not remove acceptance gates.

### 4.2 Work packages and gates

| Order | Work package | Depends on | Completion evidence |
|---:|---|---|---|
| 1 | Normative baseline and repository | None | Versioned contracts, requirement/control/risk IDs, architecture decisions, threat model, and validation pipeline |
| 2 | Local platform and tenant security | 1 | Reproducible local startup; authenticated server-derived tenant context; RLS isolation; tenant-qualified keys; redacted telemetry; secret handling |
| 3 | Authoritative model and durable workflows | 1, 2 | Migrations; authoritative records; object digests; transactional outbox; Temporal workflows; replay and recovery tests |
| 4 | Synthetic GitHub/Jira synchronization | 2, 3 | Signed deterministic fixtures; allowlists; cursors; webhooks; duplicates; ordering; tombstones; reconciliation; quarantine; connector health |
| 5 | Identity, evidence, graph, and retrieval | 3, 4 | Reversible resolution; claims/evidence; ACL propagation; Neo4j and pgvector rebuild; bounded traversal; ground-truth oracle comparison |
| 6 | Cited answer | 2, 5 | Capability-oriented model gateway; structured tool schemas; prompt-injection defenses; citations; abstention; permission-restricted answer; golden and adversarial evaluations |
| 7 | Scenario and simulation | 3, 5 | Immutable snapshot; validated dependency DAG; seeded PERT/Monte Carlo run; percentiles, critical path, sensitivity, assumptions, warnings, deterministic oracle |
| 8 | Governed Jira action | 2, 3, 4, 7 | Exact preview; canonical hash; two distinct approvers; 15-minute expiry; policy recheck; source-version precondition; idempotent receipt; compensation and conflict handling |
| 9 | Integrated product journey | 4-8 | Responsive and WCAG 2.2 AA journey across freshness, Ask, evidence, graph, scenario, comparison, approval, receipt, audit, and rollback |
| 10 | Release evidence and independent review | 1-9 | Clean-room run; performance/security/accessibility/evaluation reports; failure demonstrations; SBOM and provenance; no Critical/High findings |

### 4.3 H1 exit gate

H1 exits only when:

- The exact `edt-h1-github-jira-launch-risk` workload passes from an empty local environment.
- All H1 requirements, controls, risks, contracts, and acceptance criteria are traceable to passing evidence.
- There are zero cross-tenant and unauthorized disclosures in automated, adversarial, and manual tests.
- Unsupported answers abstain, repeated simulations reproduce, invalid approvals write nothing, duplicate execution writes once, and rollback is verified.
- The complete journey passes manual keyboard and screen-reader review.
- Ten-user performance meets the H1 envelope with traces showing no hidden correctness fallback.
- A reviewer who did not author the subsystem confirms that H1 can be operated and recovered using the documentation.

H1 does not exit by hiding a failing dependency behind fixture-only precomputed answers or seeded final database state.

## 5. H2 - Design-partner pilot

### 5.1 Entry conditions

H2 begins only after the H1 exit review and after each design partner signs an approved data-purpose, connector-scope, tenant-isolation, retention, incident, and prohibited-use agreement. Partner data cannot be used to fill gaps in product governance.

### 5.2 Committed capability increments

| Increment | Required behavior | Gate |
|---|---|---|
| Enterprise identity | OIDC/SAML federation, SCIM provisioning/deprovisioning, group mapping, step-up authentication, access review, and emergency revocation | Revocation reaches every serving projection and active agent/tool run within the defined SLO; stale state fails closed |
| Tenant lifecycle | Provision, suspend, export, retention, deletion, cryptographic erasure where applicable, and signed completion evidence | Restore and deletion drills show no orphan projection, object, cache, embedding, trace, or backup-policy gap |
| Connector operations | Production GitHub and Jira connectors plus at most two partner-selected read-only connectors | Scope review, rate-limit recovery, API-version compatibility, reconciliation, credential rotation, quarantine, and source-permission tests |
| Domain packs | Organization, work/projects, and engineering/product; one partner-selected pack may enter controlled pilot | Namespaced ontology, source precedence, lifecycle, privacy, validation, and steward workflow are complete |
| Collaboration | Saved views, reviewed reports, notifications, and claim/scenario comments | Reauthorization on every open/export; messages carry no sensitive body by default; comments cannot grant evidence access |
| Reliability | Multi-instance workloads, backup/restore, documented failover, recovery drills, capacity alerts, and incident procedures | 99.9 percent service objective, one-hour RPO, four-hour RTO, and fault-injection evidence |
| Governance evidence | Control mapping, audit export, data inventory, privacy workflows, support boundaries, and change approvals | Evidence readiness only; no claim of certification without an independent certification process |

### 5.3 Pilot constraints

- Up to ten tenants, 1,000 users, 1,000,000 graph nodes, and 10,000,000 edges per tenant.
- Shared pooled deployment remains the reference profile, with database-enforced isolation and tenant-specific credentials, keys, graph namespaces, vector scope, object prefixes, and cache scope.
- New external action types remain disabled by default. Each requires an action-specific threat model, exact schema, authorization policy, approver roles, idempotency definition, source concurrency control, compensation behavior, sandbox evaluation, and partner opt-in.
- Cross-tenant analytics, retrieval, entity resolution, memory, training, and benchmarks remain prohibited by default.
- Individual employment and health inference remains excluded.

### 5.4 H2 exit gate

H2 exits when representative partner evidence proves permission revocation, synchronization recovery, projection rebuild, deletion, backup restore, model fallback, incident response, connector upgrade, and tenant suspension within target; no Critical/High finding remains; Medium findings have named acceptance and revisit triggers; and two consecutive cross-domain reviews identify no new Critical/High issue.

## 6. H3 - Enterprise general availability

H3 is Provisional until H2 telemetry and benchmarks freeze numeric tiers. The implementation team MUST NOT invent GA scale or cost promises from H1 synthetic results.

### 6.1 GA workstreams

- Product packaging, entitlements, contract-safe tenancy boundaries, support tiers, and tenant-safe metering.
- Formal service objectives and error budgets for API, ingestion freshness, retrieval, simulation, action execution, projection lag, and recovery.
- Upgrade, rollback, schema compatibility, connector compatibility, and deprecation policy across supported versions.
- Representative capacity models, per-tenant quotas, noisy-neighbor controls, cost attribution, and admission control.
- Security program evidence, independent penetration testing, supply-chain provenance, incident exercises, privacy impact assessments, and customer assurance material.
- Regional data-processing controls and residency commitments that are technically enforced and testable.
- Supportable administration, diagnostics, audit export, and customer success workflows that do not require platform access to tenant plaintext.

### 6.2 Benchmark-gated scale transitions

| Transition | Remains deferred until | Required proof before adoption |
|---|---|---|
| PostgreSQL full-text/pgvector to OpenSearch | Retrieval relevance, latency, indexing isolation, or operational cost misses a frozen tier | Representative corpus benchmark, ACL update/revocation behavior, tenant isolation, rebuild, backup, cost, and operations review |
| PostgreSQL audit/query indexes to ClickHouse | Approved aggregate/audit workloads cannot meet SLO or cost without harming transactions | Data-minimization design, tenant isolation, deletion/retention propagation, reconciliation, restore, and measured benefit |
| Transactional outbox plus Temporal to Kafka | Sustained event fan-out, retention, replay, or throughput exceeds measured limits | Partitioning/keying, ordering semantics, schema governance, replay, DLQ, tenant isolation, disaster recovery, and staffing evidence |
| Operational stores to a lakehouse | Governed analytical use cases and retention volume justify another copy | Data-purpose approval, lineage, tenant isolation, opt-in for any cross-tenant analysis, deletion, cost, and owner |
| Modular workloads to finer services | Independent scaling, fault isolation, team ownership, or release cadence has a measured bottleneck | Boundary load tests, contract, ownership, on-call, tracing, migration, rollback, and reduced total risk |
| REST read APIs to GraphQL | Partner graph-exploration use cases show a material client need | Query cost controls, field authorization, depth/complexity limits, persisted queries, schema lifecycle, and no topology leakage |
| Internal HTTP to gRPC | Extracted services require typed streaming or lower measured overhead | Protobuf ownership, compatibility, deadlines, retries, tenant propagation, observability, and browser boundary remains REST/SSE |

### 6.3 H3 commitment and exit

The Architecture Council converts H3 to Committed only after publishing tier-specific scale, availability, freshness, latency, RPO/RTO, support, and cost targets based on evidence. GA exits when two release candidates pass clean install, upgrade, rollback, restore, tenant-migration, connector-version, load, chaos, security, privacy, accessibility, and model-evaluation gates with no open Critical/High finding.

## 7. H4 - Deployment expansion

Deployment profiles graduate independently in this order unless customer evidence justifies a different branch:

1. Dedicated vendor-managed tenant data plane.
2. Customer VPC/VNet deployment with vendor-managed control plane.
3. Customer-managed on-premises connected deployment.
4. Regional and multi-region profiles with explicit authority and failover semantics.
5. Air-gapped deployment after removal or replacement of required online dependencies.
6. Edge ingestion or local inference only for measured latency, sovereignty, or disconnected-operation cases.

| Profile | Blocking questions that must be resolved before commitment |
|---|---|
| Dedicated data plane | Provisioning, key ownership, upgrades, observability, cost floor, tenant migration, and recovery responsibility |
| Customer VPC/VNet | Control/data-plane trust, outbound connectivity, private endpoints, credential custody, diagnostics, support access, and drift |
| On-premises connected | Supported Kubernetes/storage matrix, hardware sizing, upgrade cadence, backup ownership, remote support, and connector egress |
| Regional/multi-region | Data authority, conflict handling, identity routing, graph/vector projection placement, workflow ownership, failover, RPO/RTO, and residency |
| Air-gapped | Offline identity, model runtime and evaluation, package signing/import, connector feasibility, vulnerability updates, license checks, clock, and export review |
| Edge | Offline queue, local authorization, key custody, model/data minimization, reconciliation, remote wipe, and bounded stale operation |

Under `REQ-ARCH-004` and `ADR-015`, cloud neutrality means portable interfaces and deployment artifacts with a tested reference profile. It does not mean every profile is identical or simultaneously active-active.

Each profile must pass the same tenant, provenance, authorization, audit, accessibility, action, and evaluation contracts as the reference deployment or explicitly declare a capability unavailable. Silent weakening is prohibited.

## 8. H5 - Research portfolio

Research runs in isolated accounts and datasets, has no production credentials, and cannot be enabled by an ordinary feature flag. Each project has a hypothesis, principal investigator, data-purpose statement, review board, stop condition, misuse analysis, evaluation plan, and publication/retention policy.

### 8.1 Hyperscale organizational graph

Hypothesis: hierarchical partitions, temporal summaries, compressed representations, and workload-specific graph engines can answer defined organizational queries at billion-node scale without weakening tenant or permission semantics.

Graduation evidence:

- Representative query corpus and update workload, not synthetic edge count alone.
- Exact tenant/ACL correctness during ingestion, traversal, revocation, rebuild, and failover.
- Bounded query cost and graceful truncation.
- Measured operational cost, recovery, deletion, and team support burden.
- A decision use case that requires the additional scale.

Trillion-edge capability remains Research until all conditions hold; no roadmap date is assigned.

### 8.2 Causal and predictive organizational models

Hypothesis: for narrowly defined non-employment outcomes, explicit causal assumptions and prospective validation can improve decisions beyond descriptive and conditional simulation.

Graduation evidence:

- Pre-registered target, intervention, causal graph, assumptions, confounders, and invalidation tests.
- Prospective evaluation against a partner-approved baseline with calibrated uncertainty.
- Dataset shift, feedback-loop, fairness, privacy, and misuse assessment.
- Human decision protocol, appeal/correction path, and no automated high-impact action.
- Independent statistical and domain review.

Synthetic PERT/Monte Carlo scheduling is not evidence for causal validity.

### 8.3 Workforce-sensitive research

Individual burnout, attrition, productivity, performance, emotion, health, misconduct, hiring, promotion, compensation, and termination inference is Rejected for H1-H3 product use. Any research proposal involving people must begin with necessity, proportionality, worker representation, legal review, privacy impact, bias and harm analysis, consent or other valid basis, data minimization, and a credible decision benefit. A successful model evaluation alone cannot graduate the use case.

The default research direction is team-level process and system bottlenecks without ranking people. No workforce-sensitive research may use customer data, influence an employment decision, or ship behind a hidden preview.

### 8.4 Higher autonomy and organizational agents

Hypothesis: bounded agents can coordinate longer workflows while maintaining delegated authority, verifiable state, cost limits, cancellation, approval, and recovery.

Graduation sequence:

1. Read-only offline task with golden oracle.
2. Read-only shadow run against synthetic or explicitly approved data.
3. Draft-only recommendation with human review.
4. Sandbox action with exact approval and compensation.
5. Narrow production action after action-specific governance.

Authority inheritance, self-approval, approval inferred from chat, creation of new credentials, disabling audit, and open-ended external tool discovery are Rejected. Artificial CEO, board, HR, legal, finance, or security titles confer no authority and are not the capability model.

### 8.5 Collective memory and decision systems

Research may examine time-versioned decision rationale, claim contradiction, institutional-memory decay, and multi-agent critique. Graduation requires provenance, correction, expiry, contested-claim representation, permission revocation, memory deletion, anti-amplification safeguards, and evidence that multiple agents improve calibrated quality rather than merely increasing tokens or consensus theater.

### 8.6 Market and economic simulation

Research may model bounded, explicitly hypothetical external scenarios with licensed or synthetic data. It must separate organization-internal evidence from external assumptions, report sensitivity and validity range, and avoid investment, credit, insurance, legal, or employment decisions without separate high-impact governance. Model complexity is justified only by prospective predictive or decision-value evidence.

## 9. Research graduation gate

A Research capability can become Provisional only when all of the following are recorded:

- Named product decision and affected users.
- Falsifiable hypothesis and baseline.
- Authorized, representative evaluation data with retention and deletion rules.
- Quality, calibration, safety, privacy, fairness, security, latency, reliability, and cost thresholds.
- Threat and misuse model, red-team results, safe failure, kill switch, and incident owner.
- Human oversight, contestability, correction, and audit design.
- Compatibility and rollback plan.
- Independent domain, security, privacy, and research review.

It can become Committed only after shadow or controlled-pilot evidence meets those thresholds and an Architecture Decision Record assigns a product owner, service boundary, support policy, and horizon. Failure to meet a stop condition archives the project and its status remains Research or becomes Rejected.

## 10. Portfolio stop and convergence rules

- At most one new external action class enters active graduation at a time until H2 action operations are proven.
- A benchmark-triggered technology is not introduced while the existing component meets its frozen SLO and cost envelope unless risk reduction is independently demonstrated.
- Research cannot consume production reliability capacity without a named budget and isolation boundary.
- A roadmap review closes only when every Committed item has an owner and evidence, every Provisional item has a named gate, every Research item has a protocol, and every Rejected item has a rationale.
- Two consecutive cross-domain reviews with no new Critical/High finding are required before specification convergence; this limits review passes, not ongoing operational assurance.
