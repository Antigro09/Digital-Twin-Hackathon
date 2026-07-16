# Enterprise Digital Twin Audit and Remediation Dossier

Specification `1.0.0-rc.1` - published 2026-07-13

This dossier consolidates threat, privacy, failure, compliance, risk-acceptance, and cross-domain review evidence. The central ledgers remain normative.

## Risk disposition summary

| Severity | Status | Count |
| --- | --- | --- |
| high | mitigated | 8 |
| medium | mitigated | 9 |
| medium | accepted | 4 |
| low | mitigated | 1 |

## Control Readiness Mapping

### Control Readiness Mapping

This is a readiness and evidence map, not a certification or legal conclusion.

| Capability | Blueprint controls | Evidence owner | H2 evidence |
|---|---|---|---|
| Access governance | CTRL-IAM-001 through CTRL-IAM-004, CTRL-TEN-001 through CTRL-TEN-003 | Identity and Security | Identity configuration, access reviews, RLS tests, break-glass records |
| Data protection | CTRL-DAT-001 through CTRL-DAT-003, CTRL-CRY-001, CTRL-CRY-002 | Data Governance | Inventory, classification, key rotation, deletion and restore evidence |
| Change and supply chain | CTRL-SUP-001 | Developer Platform | Reviewed changes, SBOM, signatures, scans, provenance and deployment records |
| Availability and recovery | CTRL-OPS-001, CTRL-OPS-002 | SRE | SLO reports, restore drills, incidents, capacity and failover tests |
| Monitoring and response | CTRL-AUD-001, CTRL-INC-001 | Security Operations | Alert tests, audit verification, incident exercises and postmortems |
| Vendor and subprocessor governance | CTRL-PRV-001, CTRL-CON-001 | Privacy and Procurement | DPA, subprocessor register, risk reviews, exit and deletion evidence |
| Privacy rights and minimization | CTRL-PRV-001, CTRL-PRV-002, CTRL-DAT-003 | Privacy | Purpose records, DPIA screens, DSAR/export/delete tests, retention reports |
| AI governance | CTRL-AI-001 through CTRL-AI-005, CTRL-ACT-001 through CTRL-ACT-003 | AI Governance | Model inventory, evaluations, prompt/tool versions, approvals, incidents and rollback tests |

SOC 2 and ISO 27001 also require organizational policies, personnel controls, vendor governance, evidence operation, internal audit, and management oversight outside the software artifact. GDPR role, lawful basis, notice, transfer, retention, and rights decisions are tenant and jurisdiction specific.

## Failure Mode and Effects Analysis

### Failure Mode and Effects Analysis

Scores use 1-5 severity, occurrence, and detectability. RPN is their product. Any severity 5 security or tenant-isolation failure blocks release regardless of RPN.

| Failure mode | Effect | S | O | D | RPN | Detection and response |
|---|---|---:|---:|---:|---:|---|
| PostgreSQL unavailable | Authoritative reads and writes stop | 5 | 2 | 1 | 10 | Fail closed, readiness false, queue safe connector checkpoints, alert, restore or failover |
| Object store unavailable | New raw payload persistence stops | 4 | 2 | 2 | 16 | Do not acknowledge source event until durable; backpressure and retry |
| Neo4j unavailable | Graph exploration and graph-dependent answers unavailable | 3 | 3 | 1 | 9 | Preserve authoritative writes, mark graph stale, offer evidence search where safe, rebuild projection |
| Partial projection | Paths or counts omit new claims | 4 | 3 | 2 | 24 | Checkpoint lag, answer freshness labels, bounded fail-closed policy for high-risk questions |
| Duplicate or reordered source event | Duplicate facts or state regression | 4 | 3 | 2 | 24 | Provider revision ordering, observation uniqueness, idempotent reducers, reconciliation |
| Missed webhook | Stale organizational state | 3 | 3 | 2 | 18 | Freshness SLO, periodic reconciliation, cursor comparison |
| ACL revocation lag | Unauthorized derived access | 5 | 2 | 2 | 20 | High-priority invalidation, policy version checks, cache purge, projection rebuild, incident if breached |
| Model provider unavailable | Answers and extraction delayed | 3 | 3 | 1 | 9 | Queue within expiry, fail closed, no unevaluated fallback, visible status |
| Model hallucination | Unsupported organizational claim | 4 | 3 | 3 | 36 | Evidence resolution, citation verifier, abstention threshold, continuous eval |
| Prompt injection | Exfiltration or unintended action | 5 | 3 | 3 | 45 | Content separation, schema boundaries, tool gateway, approvals, red-team suite |
| Workflow worker crash | Run pauses or repeats activity | 3 | 3 | 1 | 9 | Temporal replay, heartbeats, idempotent activities, bounded retry |
| Action approval expires | User expects action but none occurs | 2 | 3 | 1 | 6 | Explicit status, no execution, create a new preview |
| Jira times out after accepting write | Duplicate issue risk | 4 | 2 | 3 | 24 | Provider correlation and idempotency lookup before retry |
| Compensation fails | External state differs from intended rollback | 4 | 2 | 1 | 8 | Manual-intervention terminal state, alert, evidence and runbook |
| Cache stale or poisoned | Wrong result or authorization leak | 5 | 2 | 3 | 30 | Tenant-qualified keys, policy version, short TTL, never authoritative, canary tests |
| Clock skew | Approval or temporal query inconsistency | 3 | 2 | 2 | 12 | Trusted time service, server timestamps, skew monitoring, leeway bounds |
| Regional loss | H2 service outage and possible data loss | 5 | 1 | 2 | 10 | Encrypted backup, restore drill, RPO/RTO alert and projection rebuild |
| Deployment rollback with schema mismatch | Runtime failure or data incompatibility | 4 | 2 | 2 | 16 | Expand-contract migrations, compatibility gate, feature flags, forward-fix plan |

## Privacy and AI Impact Assessment

### Privacy and AI Impact Assessment

#### Intended purpose

H1 helps an authorized software organization understand project dependencies and compare a launch-delay scenario. It uses deterministic synthetic data. H2 may process customer-approved engineering and project metadata for the same purpose under a documented controller/processor allocation and data processing agreement.

#### People and data

Potential data subjects include employees, contractors, customers, vendors, and connector administrators. Data classes include identifiers, roles, project assignments, work artifacts, comments, access-control lists, service metadata, model inputs and outputs, approvals, and audit metadata. Secrets, private messages, source-file bodies, Actions logs, health data, emotion inference, and individual productivity scores are excluded from H1.

#### Necessity and proportionality

- Collect only allowlisted repositories, projects, object types, and fields required for delivery dependency analysis.
- Prefer aggregate team capacity over individual behavior measures.
- Preserve source ACLs and display why a result is visible.
- Use synthetic data for public demonstrations and golden evaluations.
- Do not use customer data for cross-tenant training, retrieval, memory, or analytics without a separate explicit opt-in assessment.

#### Lifecycle and rights

The data inventory records purpose, category, source, owner, retention, region, subprocessors, derived stores, and deletion method. Access, export, correction, objection, restriction, and eligible deletion requests propagate through observations, claims, objects, graph, vector, search, cache, traces, evaluation sets, and backup expiry. Legal hold is purpose-limited, access-controlled, and visible to authorized administrators.

#### High-risk exclusions

Through H3 the product does not rank or score individual burnout, attrition, productivity, performance, promotion, compensation, hiring, firing, layoff, health, emotion, misconduct, or union activity. It does not make legal, credit, insurance, financial, or safety decisions. A future proposal requires a separate intended-purpose and jurisdiction assessment, counsel and DPO review, scientific construct validity, fairness evidence, meaningful human review, notice, correction and appeal, monitoring, and kill switch.

#### Assessment outcome

H1 is acceptable because it uses synthetic data and enforces the same tenant, ACL, minimization, action, and audit paths planned for production. H2 remains conditional on customer-specific purpose, region, contract, retention, subprocessor, worker-notice, and source-scope approval.

## Architecture Review and Remediation Ledger

### Architecture Review and Remediation Ledger

#### Review 1 - cross-domain design audit

| Finding | Severity | Resolution |
|---|---|---|
| Hackathon and enterprise claims were conflated | High | Split H1 demonstrator from H2-H5 and prohibit GA claims without evidence. |
| Every technology was implied as mandatory | High | Added adopt, conditional, reject matrix and evidence-based introduction triggers. |
| Exhaustive ontology was not evolvable | High | Added stable core, inherited lifecycle rules, namespaced packages, and migration contract. |
| Shared graph tenancy relied on an application filter | High | Added query gateway, independent namespaces, negative tests, residual risk, and cell migration trigger. |
| Broad autonomy lacked an authority ceiling | Critical | Added policy gateway, delegation intersection, two-person exact-payload approval, prohibited actions, budgets, and kill switch. |
| Simulation could be mistaken for prediction | High | Selected reproducible PERT Monte Carlo, explicit uncertainty, synthetic label, and no individual productivity input. |
| Compliance language implied certification | Medium | Reframed as control readiness with organizational evidence owners. |

All Critical and High findings were remediated in the normative baseline.

#### Review 2 - security, privacy, AI, and buildability audit

| Finding | Severity | Resolution |
|---|---|---|
| Derived ACL behavior was underspecified | High | Defined claim-level evidence ACLs, monotonic visibility, revocation invalidation, and side-channel tests. |
| Approval replay and timeout ambiguity | High | Bound approval to canonical payload and idempotency key; added provider lookup and compensation terminal states. |
| Trace collection could become a shadow content store | Medium | Added minimization, redacted references, restricted access, and retention. |
| Cross-tenant learning default was unclear | High | Explicitly prohibited cross-tenant retrieval, resolution, memory, analytics, and training. |
| H1 scale lacked a test envelope | Medium | Fixed two tenants, 100 identities, 100k nodes, 1M edges, ten users, freshness and latency objectives. |

All High findings were remediated. Medium residual risks are owned in `catalogs/risks.yaml`.

#### Convergence record

The two formal reviews introduced no remaining Critical or High finding after remediation.

#### Implementation validation record - 2026-07-13

This record is implementation evidence for `1.0.0-rc.1`; it is not the independent `AC-REV-001` sign-off.

| Evidence | Result | Boundary |
|---|---|---|
| TypeScript compilation | All API, sync-worker, and web type checks passed; all four production workloads built. | Local Node.js toolchain. |
| Isolated automated suites | 25 Python tests, 11 ordinary web tests, 2 sync-worker tests, and 4 API end-to-end cases passed. | The live-only web case is intentionally excluded from the ordinary web suite and executed separately. |
| Live cross-workload journey | The live web client drove the API and Python worker with oracle fallback disabled; cited answer, 50,000-trial simulation, exact preview, two distinct approvals, single execution, replay safety, separately approved compensation, 14 audit events, and zero Beacon disclosure passed in 7.81 seconds of test execution. | In-memory authoritative-store profile with real HTTP workload boundaries; no external provider or model effect. |
| Operator verification | `scripts/verify_live.mjs` returned `status: verified`, simulation engine `pert-mt19937-beta/2.0.0`, replay safety, restored `2026-08-07` due date, 14 audit events, and zero cross-tenant disclosure. | Fresh API state and the real Python simulation worker. |
| Connector replay | Aster synchronized six sources/four relationships twice to identical state and cursor digests; Beacon synchronized its independent two-source fixture; external effect count remained zero. | In-memory provider simulator. PostgreSQL/S3/Neo4j/Temporal integration is exercised by the Compose profile and CI image gate. |
| Normative publication | 44 Markdown and 60 machine-readable artifacts passed with zero errors/warnings and 100 percent requirement traceability; deliberate trace corruption failed closed. | Clean source build on the local toolchain. |
| PDF inspection | The 235-page PDF passed metadata/text extraction and visual inspection of the cover, contents, representative dense tables, all ten diagram pages in portrait/landscape, and final provenance page. | Local Poppler render at 144 DPI for diagram inspection. |
| Dependency audit | Full and production npm audits reported zero Critical/High and the two accepted Moderate PostCSS findings recorded as `RSK-019`. | Source-controlled CSS only; the risk acceptance expires on its recorded trigger/date. |
| Deployment sources | Compose, Helm, OpenTofu, health checks, and immutable GitHub Action references passed static validation. | Docker is not installed on the local workstation; Compose configuration and all four OCI image builds are mandatory in `.github/workflows/application.yml`. |

The in-app browser runtime was unavailable on the local workstation, so this record does not claim interactive browser, screenshot-regression, keyboard, or assistive-technology evidence. Those remain CI/manual release-candidate evidence under CH-14.

#### Remaining final-release gates

- An engineer independent of the authoring and implementation work must record `AC-REV-001` after reproducing H1 from a clean checkout.
- The application workflow must publish successful Compose configuration and four-image build evidence on a Docker-enabled runner.
- The required browser/accessibility review must be attached before any H2 production or final accessibility claim.

Until those gates are evidenced, the specification remains `1.0.0-rc.1` and MUST NOT be represented as final `1.0.0`.

## Residual Risk Acceptance

### Residual Risk Acceptance

No Critical or High residual risk is accepted for H1 or H2.

| Risk | Rationale | Compensating controls | Owner | Expiry or revisit |
|---|---|---|---|---|
| RSK-008 cloud-neutral abstraction cost | Portability is an explicit product decision | Thin adapters, portable contracts, conformance tests | Platform | H2 provider selection |
| RSK-009 limited polyglot cost | H1 has only TypeScript and Python application runtimes | Contract generation, ownership boundaries, language introduction ADR | Architecture | H3 service extraction |
| RSK-016 synthetic data external-validity limit | Public demo safety and deterministic verification outweigh realism | No predictive-accuracy claim, golden oracle, H2 design-partner validation | Product | Before H2 prediction claims |
| RSK-019 framework CSS-tool pin | Next.js 16.2.10 pins PostCSS 8.4.31, which has a Medium stringification advisory; H1 has no untrusted CSS, templates, runtime themes, or style-stringification input | Source-controlled CSS only, zero production High/Critical dependency findings, dependency audit in CI, monthly framework update review | Developer Platform and Security Architecture | 2026-08-15, any compatible Next.js release, or any proposal for untrusted style/template input |

Acceptance expires automatically if scope, data classes, jurisdictions, deployment mode, or authority expands. A changed risk requires a new review rather than silent continuation.

## Threat Model

### Threat Model

#### Scope and assets

The assessment covers identity, tenant context, API, connector installations, normalized observations, authoritative claims, object storage, graph/vector/search projections, agent context, model and MCP/tool calls, scenarios, approvals, Jira actions, audit, deployment, and the documentation supply chain.

Highest-value assets are tenant data, source ACLs, connector credentials, encryption keys, policy bundles, action approvals, audit evidence, model/tool configuration, and integrity of simulation results.

#### Trust boundaries

All browser input, connector payloads, uploaded content, webhooks, model output, MCP output, provider errors, and cross-workload messages are untrusted. Identity assertions become trusted only after issuer, audience, signature, lifetime, nonce, and membership validation. Tenant context is server derived. Model output never becomes authority.

#### STRIDE analysis

| Threat | Example | Required controls | Verification |
|---|---|---|---|
| Spoofing | Forged webhook, token, approver, or service identity | OIDC validation, signed webhook verification, workload identity, MFA, nonce and replay cache | Invalid signature, stale token, wrong audience, and impersonation tests |
| Tampering | Change action payload after approval or corrupt claims | Canonical hashes, optimistic versioning, exact-payload approval, signed artifacts, hash-linked audit | Payload mutation, concurrent update, audit-chain verification |
| Repudiation | Approver denies authorizing Jira write | Distinct authenticated approvals, policy version, immutable timestamps and receipts | End-to-end evidence reconstruction |
| Information disclosure | Cross-tenant ID, graph path, embedding, cache, error, or trace leak | RLS, independent namespaces, ACL monotonicity, redaction, non-enumerable errors | Two-tenant negative suite and canary-secret scans |
| Denial of service | Graph explosion, model loop, webhook flood, decompression bomb | Traversal limits, quotas, budgets, rate limits, bounded parsers, backpressure, circuit breakers | Load, fuzz, budget, and resource-exhaustion tests |
| Elevation of privilege | Agent delegation widens tools or tenant | Delegation intersection, external policy gateway, immutable tool manifests, no client tenant selection | Handoff, confused-deputy, and policy-bypass tests |

#### AI and connector abuse cases

- Indirect prompt injection in Jira text requests a secret, another tenant, or a write tool. The content remains a user-data field, structured extraction runs without privileged tools, and the policy gateway denies authority changes.
- A compromised connector sends huge nested payloads or URLs to internal services. Size, depth, format, network, DNS, and egress constraints reject or quarantine it.
- A model invents evidence or tool arguments. Evidence identifiers must resolve under current ACLs, schemas reject unknown fields, and action approval displays the exact canonical payload.
- A remote MCP server changes its tools or output. Tool allowlists, server identity, schema version, approvals, egress checks, and trace records prevent silent authority expansion.
- An evaluator or trace store captures secrets or restricted content. Evaluation datasets are minimized and tenant-scoped; trace exports default to metadata and redacted references.

#### Residual risk

Pooled graph isolation remains weaker than PostgreSQL RLS. H1 accepts this only with bounded server-owned query templates, tenant-qualified projection assertions, two-tenant tests, and no arbitrary Cypher. Failure of any control blocks release and triggers isolated graph deployment analysis.

## Generated validation evidence

```json
{
  "complete": 106,
  "coverage_percent": 100.0,
  "quality_attribute": {
    "complete": 18,
    "total": 18
  },
  "release_gate_percent": 100,
  "required_dimensions": [
    "artifacts",
    "decisions",
    "components",
    "contracts",
    "controls",
    "acceptance",
    "tests_evaluations",
    "roadmap"
  ],
  "requirement": {
    "complete": 88,
    "total": 88
  },
  "total": 106
}
```
