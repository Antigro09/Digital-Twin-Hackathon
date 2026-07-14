---
id: EDT-REVIEW-LEDGER-001
title: Architecture Review and Remediation Ledger
status: committed
version: 1.0.0
owners: [architecture-review-board]
last_reviewed: 2026-07-13
---

# Architecture Review and Remediation Ledger

## Review 1 - cross-domain design audit

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

## Review 2 - security, privacy, AI, and buildability audit

| Finding | Severity | Resolution |
|---|---|---|
| Derived ACL behavior was underspecified | High | Defined claim-level evidence ACLs, monotonic visibility, revocation invalidation, and side-channel tests. |
| Approval replay and timeout ambiguity | High | Bound approval to canonical payload and idempotency key; added provider lookup and compensation terminal states. |
| Trace collection could become a shadow content store | Medium | Added minimization, redacted references, restricted access, and retention. |
| Cross-tenant learning default was unclear | High | Explicitly prohibited cross-tenant retrieval, resolution, memory, analytics, and training. |
| H1 scale lacked a test envelope | Medium | Fixed two tenants, 100 identities, 100k nodes, 1M edges, ten users, freshness and latency objectives. |

All High findings were remediated. Medium residual risks are owned in `catalogs/risks.yaml`.

## Convergence record

The two formal reviews introduced no remaining Critical or High finding after remediation.

## Implementation validation record - 2026-07-13

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

## Remaining final-release gates

- An engineer independent of the authoring and implementation work must record `AC-REV-001` after reproducing H1 from a clean checkout.
- The application workflow must publish successful Compose configuration and four-image build evidence on a Docker-enabled runner.
- The required browser/accessibility review must be attached before any H2 production or final accessibility claim.

Until those gates are evidenced, the specification remains `1.0.0-rc.1` and MUST NOT be represented as final `1.0.0`.
