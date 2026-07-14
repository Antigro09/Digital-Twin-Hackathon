---
id: CH-01
title: Product Vision and Operating Principles
status: committed
version: 1.0.0
owners:
  - product-architecture
  - product-management
last_reviewed: 2026-07-13
---

# Product Vision and Operating Principles

## 1. Mission

The Enterprise Digital Twin gives an authorized person a current, evidence-backed model of how an organization works, lets that person test a proposed change against the model, and permits controlled action only after the required human decision.

The product is a system of understanding and governed action. It is not a replacement for systems of record, an employee surveillance product, or an autonomous executive. PostgreSQL remains the authoritative store for the twin's claims, evidence, approvals, and audit indexes; connected systems remain authoritative for their source records. Graph, vector, search, and cache stores are derived projections.

`REQ-PROD-001`: The product MUST maintain a continuously synchronized, evidence-backed representation of organizational entities, activity, and dependencies within the authorized source scope.

`REQ-PROD-002`: Answers MUST cite accessible evidence and abstain when evidence is insufficient.

`REQ-PROD-003`: H1 MUST explain launch risk and compare a user-confirmed dependency scenario.

`REQ-PROD-004`: H1 MUST preview, dual-authorize, execute, audit, and compensate one allowlisted Jira remediation mutation.

`REQ-PROD-005`: The core metamodel MUST support namespaced domain and customer ontology packages without changing core code.

Every material statement shown as fact must be traceable to source evidence, an explicit user input, or a labeled simulation assumption. The product distinguishes observed fact, resolved claim, inference, recommendation, scenario assumption, and simulated output. It preserves source permissions and tenant boundaries from ingestion through retrieval, explanation, export, and action. Under `REQ-AI-008`, an agent cannot gain authority through reasoning, memory, tool selection, or handoff.

## 2. Product philosophy

### 2.1 Evidence before fluency

A concise abstention is better than an unsupported answer. Answers expose citations at the claim level, identify stale or missing sources, and state when evidence conflicts. Generated prose never upgrades an inference into a fact.

### 2.2 A model, not a mirror

The twin is a time-versioned interpretation of source observations. Entity resolution is reversible, relationships retain provenance and confidence, and projection lag is visible. The interface never implies that the twin is complete merely because a visualization is dense.

### 2.3 Simulation before mutation

Users can explore a scenario without changing a source system. A proposed external mutation is rendered as an exact payload, evaluated by policy, approved by the required humans, executed idempotently, and paired with a compensating action where the connector supports one.

### 2.4 Progressive trust

Autonomy expands only after a capability has passed offline evaluation, adversarial evaluation, shadow use, controlled pilot use, and an explicit governance decision. A broader model or tool catalog does not automatically broaden autonomy.

### 2.5 Bounded claims

The hackathon slice demonstrates production-quality invariants within a deliberately narrow envelope. Later horizons are commitments only where exit criteria and owners are defined. Research ideas are not presented as shipping capabilities.

### 2.6 Human dignity

The initial enterprise horizons exclude individual productivity, performance, burnout, attrition, hiring, compensation, health, emotion, misconduct, and similar employment scoring. Aggregation or dual approval does not make those uses acceptable.

## 3. Product principles

| ID | Principle | Required behavior |
|---|---|---|
| `PRN-001` | Tenant isolation is invariant | Tenant context is derived by the server. Queries, indexes, object keys, graph namespaces, caches, prompts, traces, and exports are tenant-scoped. |
| `PRN-002` | Permission fidelity | Revocation propagates to every serving projection; stale permission state fails closed. Redacted facts cannot be reconstructed from counts, topology, snippets, or citations. |
| `PRN-003` | Provenance survives transformation | Normalization, entity resolution, summarization, graph projection, and simulation preserve links to the originating observation and transformation version. |
| `PRN-004` | Determinism where promised | Synthetic fixtures, projection rebuilds, scenario compilation, and seeded simulation produce reproducible outputs within documented numeric tolerances. |
| `PRN-005` | Uncertainty is a first-class output | Forecast distributions, assumptions, missing inputs, sensitivity drivers, and model limitations appear with the result. |
| `PRN-006` | Exact approval | Approval binds actor, tenant, action type, canonical payload hash, target, expiry, policy version, and source snapshot. Any change invalidates approval. |
| `PRN-007` | Safe retries | Connector ingestion and external actions use idempotency keys, replay protection, durable receipts, and explicit compensation state. |
| `PRN-008` | Rebuildable projections | Neo4j, vector, search, and cache data can be rebuilt from authoritative records without changing semantic identity. |
| `PRN-009` | Accessible equivalence | Every workflow and visualization has a keyboard-operable and non-visual equivalent that exposes the same decisions and information. |
| `PRN-010` | Observable degradation | Staleness, partial results, unavailable dependencies, policy denials, and degraded model behavior are visible rather than silently hidden. |

## 4. Market position

The product is positioned for organizations that have operational data distributed across work-management, code-hosting, knowledge, and business systems but cannot reliably answer cross-system questions or test an operational change. The initial buyer is not purchasing another document repository or dashboard. The buyer is purchasing a governed organizational model with evidence, time, dependency, scenario, and action semantics.

The product category is defined by four connected jobs:

1. Continuously reconcile authorized observations from enterprise systems into a permission-aware organizational model.
2. Answer cross-system questions with claim-level evidence and visible data freshness.
3. Run reproducible what-if scenarios without altering source systems.
4. Convert an approved recommendation into a narrow, auditable, reversible action.

No claim in this chapter depends on a comparison with a named vendor. Competitive positioning must be updated only through dated primary sources and a separate, reviewable source ledger.

## 5. Differentiators expressed as testable capabilities

| ID | Capability | Proof required |
|---|---|---|
| `CAP-001` | Evidence graph | A reviewer can navigate from an answer claim to the exact tenant-authorized source observation and transformation history. |
| `CAP-002` | Temporal organizational model | A reviewer can inspect what was believed at a selected time and distinguish source time, ingestion time, validity time, and transaction time. |
| `CAP-003` | Reversible identity resolution | A reviewer can inspect why records were merged, split an incorrect merge, rebuild projections, and observe no loss of source evidence. |
| `CAP-004` | Permission-aware reasoning | The same question asked by actors with different rights returns appropriately different evidence without leaking hidden topology. |
| `CAP-005` | Scenario-to-action chain | A reviewer can reproduce a simulation, inspect assumptions, preview an exact remediation payload, gather required approvals, execute once, and roll back. |
| `CAP-006` | Extensible domain model | A tenant can add a namespaced ontology package without modifying the core ontology or bypassing validation and authorization. |
| `CAP-007` | Evaluation-gated AI | A model or prompt version cannot enter a production profile unless workload-specific quality and safety gates pass. |

## 6. Personas and responsibilities

| Persona | Role in the product | Primary need | Must not be assumed |
|---|---|---|---|
| Executive sponsor | Economic buyer and accountable sponsor | Understand portfolio-level dependencies, evidence quality, and scenario tradeoffs | Unlimited access or authority to override policy |
| Transformation or operations leader | Primary H1/H2 operator | Diagnose launch risk, compare scenarios, and coordinate remediation | Permission to inspect every source or individual activity |
| Program or product leader | Domain user | Trace blockers, dates, decisions, and cross-team dependencies | That a graph relationship proves causation |
| Engineering leader | Domain user and source owner | Validate code and work dependencies, freshness, and proposed changes | That code metadata measures individual productivity |
| Analyst | Question and scenario author | Reusable evidence-backed analyses, exports, and assumptions | Authority to execute recommended actions |
| Approver | Human control point | Exact, understandable action payload and risk context | That approval is transferable or reusable after expiry |
| Security and compliance administrator | Policy and evidence owner | Connector scopes, access decisions, audit evidence, retention, and incident controls | Authority to read content outside granted scope |
| Tenant administrator | Tenant configuration owner | Identity mapping, connector setup, policies, and ontology packages | Platform-operator access to tenant plaintext |
| Connector owner | Source-system steward | Scope, health, rate limit, reconciliation, and credential rotation | Product-wide administrative access |
| Data steward | Resolution and quality reviewer | Conflicts, provenance, merge review, and deletion workflows | Permission to change source systems |
| Developer or extension author | API, SDK, and plugin consumer | Stable contracts, local fixtures, validation, and observability | Ability to publish unsigned or over-privileged extensions |
| Data subject | Person represented by authorized source data | Accurate use, policy-respecting visibility, correction and deletion handling | That product use converts observations into employment judgments |
| Platform operator | Service reliability role | Health and capacity signals with redacted diagnostics | Routine access to tenant content or model prompts |

Buyer, user, approver, administrator, source owner, platform operator, and data-subject responsibilities MUST remain separate in policy and audit records even when one person holds multiple roles.

## 7. Value proposition and measurable outcomes

The product creates value only when it improves a decision without obscuring evidence or shifting unacceptable risk to represented people.

| Outcome | Product measure | H1 target | H2 direction |
|---|---|---:|---|
| Faster evidence gathering | p95 time from question submission to a reviewable cited answer | Less than 20 seconds for the reference workload | Establish customer baseline and demonstrate a material reduction without relaxing citation quality |
| Better dependency visibility | Ground-truth blockers discovered and correctly connected | 100 percent in deterministic H1 fixtures | Calibrated precision and recall on partner-approved golden cases |
| Safer operational change | Unauthorized, expired, mutated, replayed, or duplicate actions executed | 0 | 0 |
| Reproducible planning | Identical seeded runs with identical snapshot and model version | 100 percent within documented numeric tolerance | 100 percent within versioned engine tolerance |
| Permission fidelity | Cross-tenant or unauthorized disclosure in automated and adversarial tests | 0 | 0 |
| Explainable uncertainty | Forecasts displaying assumptions, uncertainty, sensitivity, and missing-data warnings | 100 percent | 100 percent |
| Recoverability | Approved H1 mutations with validated compensation path | 100 percent | Per-action service-level objective before enablement |

Business impact such as avoided delay or reduced coordination cost is reported as an attributed case study with its assumptions. The platform MUST NOT present simulated savings as realized value.

## 8. Product tracks

### 8.1 Production-shaped demonstrator

H1 proves the complete thin slice described in `CH-02`: synthetic GitHub and Jira observations, a permission-aware graph, cited launch-risk analysis, seeded schedule simulation, an exact Jira remediation preview, two-person approval, idempotent execution, and compensation. `CH-17` adds a separately bounded synthetic physical-asset demonstration with advancing telemetry, spatial inspection, deterministic analytics, lifecycle history, and simulator-only control. Neither track claims real customer integration or predictive validity. H1 favors depth and verifiability over connector or domain breadth.

### 8.2 Enterprise reference architecture

H2 through H4 define an extensible architecture for additional tenants, connectors, domains, deployment profiles, and operational controls. A capability is labeled:

- `Committed`: funded or required, with owner, contract, dependencies, and acceptance gate.
- `Provisional`: direction is accepted, but a benchmark, design-partner result, or external dependency must be resolved before commitment.
- `Research`: hypothesis with safety, validity, and graduation gates; not marketed as available.
- `Rejected`: considered and intentionally excluded from the current architecture, with a revisit trigger if one exists.

Status applies to a defined capability and horizon, not to a technology name in isolation.

## 9. Non-goals and prohibited uses

The following are out of scope through H3 unless a new architecture decision, safety review, legal review, and product-governance approval explicitly replace this boundary:

- Individual performance, productivity, burnout, attrition, hiring, promotion, compensation, emotion, health, misconduct, or termination scoring.
- Covert employee monitoring, keystroke tracking, screen capture, private-message inference, or social-relationship ranking.
- Fully autonomous external action, self-granted permissions, approval impersonation, or approval inferred from conversation.
- A claim that synthetic schedule simulation predicts real organizational outcomes.
- Replacement of GitHub, Jira, identity providers, financial systems, or other source systems as their operational system of record.
- Cross-tenant retrieval, entity resolution, memory, analytics, benchmarking, training, or model improvement without separately recorded opt-in governance.
- Simultaneous active-active operation across arbitrary clouds in H1 or H2.
- Trillion-edge production claims, universal ontology coverage, or adoption of every technology named during ideation.

Under `CTRL-PRV-002`, product analytics, demonstrations, sales material, documentation, and support procedures MUST use the same prohibited-use boundary as runtime policy.

## 10. Accessibility and inclusion principles

The primary conformance target is WCAG 2.2 AA for all H1 user journeys. Product acceptance includes keyboard-only operation, screen-reader semantics, visible focus, 200 percent zoom, reflow at 320 CSS pixels, reduced motion, non-color status cues, accessible names, error association, and text/table alternatives for visualizations. Domain terminology must be defined in context, and confidence language must not imply mathematical certainty where none exists.

Evidence for `AC-UX-001` includes a keyboard-only screen-reader user asking the reference question, inspecting every citation, configuring and comparing the scenario, reviewing the exact Jira payload, approving or declining it, inspecting the receipt, and initiating rollback without losing information available visually.

## 11. Long-term vision

The long-term product can become a composable operating layer for organizational understanding: a governed ontology, durable evidence and decision memory, domain-specific simulations, and bounded agents that coordinate work across approved tools. That vision is reached through measured capability graduation, not through an assumed path to artificial executives.

The durable strategic assets are:

- A permission-aware, time-versioned organizational evidence model.
- Trusted entity and relationship resolution with reversible provenance.
- Evaluated scenario models with explicit domains of validity.
- Action governance that makes an AI-originated proposal no more privileged than any other proposal.
- Open contracts for connectors, ontology packages, workflows, tools, and portable deployment.

## 12. Product acceptance criteria

| Governing gate | Criterion |
|---|---|
| `AC-AI-001` and `AC-AI-002` | Every user-visible factual claim in the H1 reference answer has authorized evidence or is labeled as an inference, and unsupported cases abstain. |
| `AC-SIM-001` | Every H1 scenario result exposes snapshot ID, seed, engine version, assumptions, missing inputs, percentiles, and sensitivity drivers and reproduces canonically. |
| `AC-ACT-001` and `AC-ACT-002` | Every H1 external mutation is limited to the allowlisted Jira sandbox project, requires two distinct currently authorized human approvers, and produces one external effect. |
| `AC-OBS-001` | A tenant administrator can determine why a source, claim, entity, edge, answer, recommendation, approval, action, or rollback exists from correlated retained evidence. |
| Product copy review | Product copy never describes a projection as authoritative, an inference as fact, a forecast as certainty, a research item as committed, or control alignment as certification. |
| `CTRL-PRV-002` and `AC-AI-003` | No H1 workflow includes an individual employment or health inference, and adversarial connector or prompt content cannot activate one. |
