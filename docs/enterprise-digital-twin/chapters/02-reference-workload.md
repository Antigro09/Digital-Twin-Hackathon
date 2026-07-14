---
id: CH-02
title: H1 Reference Workload and Demonstration Contract
status: committed
version: 1.0.0
owners:
  - product-engineering
  - quality-engineering
last_reviewed: 2026-07-13
---

# H1 Reference Workload and Demonstration Contract

## 1. Purpose

This chapter is the executable product contract for the H1 hackathon slice. It freezes the demonstration dataset, actor rights, question, scenario, external action, failure cases, and measurements. A visually convincing path that bypasses ingestion, authorization, provenance, simulation, approval, idempotency, audit, or rollback does not satisfy this contract.

Under `REQ-VER-002`, the reference workload MUST run from checked-in, deterministic synthetic fixtures without access to a real employee, customer, repository, or Jira project. Under `REQ-TEN-001` through `REQ-TEN-004`, the same application build MUST serve both synthetic tenants; tenant isolation MUST NOT be implemented by tenant-specific application code. All dates, identities, text, code metadata, issue records, source permissions, and expected answers MUST be synthetic and marked as such in the interface.

## 2. Frozen workload identity

| Field | Value |
|---|---|
| Workload ID | `edt-h1-github-jira-launch-risk` |
| Fixture version | `1.0.0` |
| Root seed | `edt-h1-20260713` |
| Simulation seed | `20260713` |
| Frozen evaluation clock | `2026-07-13T16:00:00Z` |
| Tenant aliases | `tnt_aster` and `tnt_beacon` |
| Primary tenant UUID | `10000000-0000-4000-8000-000000000001` (`tnt_aster`) |
| Isolation-canary tenant UUID | `10000000-0000-4000-8000-000000000002` (`tnt_beacon`) |
| Aster Jira installation UUID | `30000000-0000-4000-8000-000000000001` (`con_aster_jira`) |
| Aster GitHub installation UUID | `30000000-0000-4000-8000-000000000002` (`con_aster_github`) |
| Beacon Jira installation UUID | `30000000-0000-4000-8000-000000000003` (`con_beacon_jira`) |
| Beacon GitHub installation UUID | `30000000-0000-4000-8000-000000000004` (`con_beacon_github`) |
| GitHub mode | Synthetic GitHub App payloads, metadata-only, read-only, allowlisted repositories |
| Jira mode | Synthetic Jira OAuth payloads, read for allowlisted projects, one allowlisted issue-field update in `tnt_aster` |
| Simulation | Seeded PERT/Monte Carlo schedule simulation over a dependency DAG |

The aliases make fixtures and test reports readable; canonical contracts, rows, events, actions, and API calls use the UUIDs. Actor and connector aliases in this chapter similarly resolve through the signed fixture manifest to fixed UUIDs. The evaluation clock is injected into workflows. Tests MUST NOT depend on wall-clock time. Approval-expiry tests advance a controlled clock.

## 3. Synthetic tenants

### 3.1 Aster Labs (`tnt_aster`)

Aster Labs is a synthetic software organization preparing the `Orion 2.0` launch. Its fixture contains:

| Source data | Frozen count |
|---|---:|
| Human identities | 48 |
| Teams | 7 |
| GitHub organizations | 1 |
| GitHub repositories | 12 |
| GitHub pull requests | 420 |
| GitHub reviews | 690 |
| GitHub issue and PR links | 206 |
| Jira projects | 4 |
| Jira issues | 240 |
| Jira issue links | 318 |
| Jira comments | 560 |
| Release milestones | 8 |

The workload's decision chain is fixed:

1. Jira issue `AST-142`, `Complete SSO cutover`, is scheduled to finish on `2026-08-07`.
2. `AST-142` is implemented by open GitHub pull request `aster-labs/identity-service#184`, `Finalize token migration`, which is awaiting one required security review.
3. `AST-142` blocks `AST-173`, `Build Orion release candidate`.
4. `AST-173` blocks `AST-201`, `Complete launch certification`.
5. `AST-201` gates milestone `Orion 2.0 General Availability`.
6. Two lower-confidence parallel risks exist in the fixture, but neither is on the p80 critical path. The answer must describe them as secondary, not omit their uncertainty or promote them above `AST-142`.

The relevant source objects have intentionally different owners and ACLs so the application must combine only evidence visible to the requesting actor.

### 3.2 Beacon Works (`tnt_beacon`)

Beacon Works is an unrelated synthetic organization used as an isolation canary. Its fixture contains:

| Source data | Frozen count |
|---|---:|
| Human identities | 32 |
| Teams | 5 |
| GitHub organizations | 1 |
| GitHub repositories | 8 |
| GitHub pull requests | 260 |
| GitHub reviews | 410 |
| GitHub issue and PR links | 118 |
| Jira projects | 3 |
| Jira issues | 160 |
| Jira issue links | 204 |
| Jira comments | 320 |
| Release milestones | 5 |

Beacon deliberately reuses the display name `Jordan Lee`, the repository name `platform`, and the issue summary `Complete SSO cutover`. Its opaque source IDs differ and every canonical key is tenant-qualified. The string `BEACON-CANARY-7Q9K` exists only in a Beacon Jira description and source artifact.

`TC-DEMO-001` (evidence for `AC-TEN-001`): No Aster query, prompt, trace available to an Aster operator, citation, cache key, export, graph response, vector result, search result, metric label, or error message may contain `BEACON-CANARY-7Q9K`.

## 4. Actors and permissions

| Actor alias and UUID | Tenant | Grants | Explicit denials |
|---|---|---|---|
| `usr_aster_analyst` / `20000000-0000-4000-8000-000000000001` | Aster | Read all allowlisted Orion Jira and GitHub metadata; create scenarios; run simulations; draft remediation | Approve or execute external action; administer connectors |
| `usr_aster_limited` / `20000000-0000-4000-8000-000000000002` | Aster | Read Orion Jira except security-restricted issues; read public Aster repositories | Read `identity-service#184`, its reviews, or restricted citations; approve actions |
| `usr_aster_ops_approver` / `20000000-0000-4000-8000-000000000003` | Aster | Read full reference evidence; approve operations-class Jira remediation | Satisfy security approver slot; approve twice; alter payload while approving |
| `usr_aster_security_approver` / `20000000-0000-4000-8000-000000000004` | Aster | Read full reference evidence; approve security-impacting Jira remediation | Satisfy operations approver slot; approve twice; alter payload while approving |
| `usr_aster_admin` / `20000000-0000-4000-8000-000000000005` | Aster | Configure fixture connectors, policy, identity mapping, and replay tests | Count as an action approver unless separately granted an approver role |
| `usr_beacon_analyst` / `20000000-0000-4000-8000-000000000006` | Beacon | Read Beacon allowlists; create Beacon scenarios | Any Aster resource or action |
| `usr_platform_operator` / `20000000-0000-4000-8000-000000000007` | Platform | View redacted service health and tenant-opaque operational metrics | Tenant content, prompts, citations, source payloads, graph data, or action payloads |

All test sessions are authenticated by the development identity provider and mapped to immutable actor IDs. A caller-supplied tenant header or resource tenant is ignored for authority derivation and rejected when it conflicts with the session.

`TC-DEMO-002` (evidence for `AC-TEN-001`): Replaying an Aster resource identifier with a Beacon session returns an indistinguishable not-found response, emits a tenant-boundary security event, and reveals neither existence nor tenant name.

## 5. Ingestion and synchronization script

The demonstration begins with empty tenant data and performs the following scripted sequence:

1. Install synthetic GitHub and Jira connectors with tenant-specific credentials and allowlists.
2. Backfill GitHub and Jira source objects into immutable object storage and authoritative normalized records.
3. Deliver three duplicate webhooks and two out-of-order webhooks from each connector. The final normalized state must equal the ordered, deduplicated oracle state.
4. Interrupt the Jira backfill after a committed cursor, resume it, and prove that no committed item is lost or applied twice.
5. Tombstone one unrelated pull request and one unrelated Jira issue, then rebuild Neo4j and vector projections from PostgreSQL.
6. Resolve identities and issue-to-pull-request links, retaining the evidence and rule version for each merge or edge.
7. Compare normalized records, resolution decisions, canonical relationships, ACLs, and projection checkpoints with the ground-truth oracle.

Connector payload text is untrusted data. It is never concatenated into system instructions and cannot activate a tool, alter tenant context, change approval policy, or override the scenario definition.

`TC-DEMO-003` (evidence for `AC-DATA-002`): After the scripted faults and rebuild, authoritative source-object and observation digests, identity-resolution decisions, golden claims, golden relationships, tombstones, and projection checkpoints match the signed fixture oracle.

`TC-DEMO-004` (evidence for `AC-DATA-001`): A duplicate event changes no business state after its first successful application and records a deduplication outcome correlated to the original event.

## 6. Reference question and answer contract

The analyst asks:

> What is most likely to delay Orion 2.0, what evidence supports that conclusion, and what information is still missing?

The answer is successful only when it:

- Identifies the `AST-142` -> `AST-173` -> `AST-201` -> `Orion 2.0` dependency chain as the strongest supported launch blocker.
- Identifies `aster-labs/identity-service#184` and its missing required security review as evidence affecting `AST-142`.
- Separates source facts from the inference that the chain is the strongest delay risk.
- Provides claim-level links to the exact authorized Jira and GitHub source observations, including source-updated time and twin-ingested time.
- Reports source freshness and the current projection checkpoint.
- Names the two secondary risks and labels their lower confidence.
- States that individual productivity was not inferred.
- States missing information: future review completion time, unrecorded work, and whether the modeled task-duration distributions represent actual delivery behavior.
- Offers scenario creation as a next step but does not create, approve, or execute an external action from the question alone.

The answer for `usr_aster_limited` must not reveal the restricted repository, pull-request number, review state, hidden node degree, or a citation URL. It may say that accessible evidence is insufficient to explain the relevant Jira blocker and offer an access-request path.

`TC-DEMO-005` (evidence for `AC-AI-001`): In the full-access golden evaluation, every material factual claim has an oracle-authorized citation, no material citation contradicts its claim, and the answer identifies all four nodes in the critical dependency chain.

`TC-DEMO-006` (evidence for `AC-AI-002`): When the pull-request evidence is withheld, deleted, or contradicted, the answer abstains from the unsupported code-review claim rather than reconstructing it from training knowledge or hidden graph topology.

## 7. Scenario contract

From the answer, the analyst creates this scenario:

> Assume AST-142 completes five working days earlier while all other task distributions, dependencies, calendars, and capacity assumptions remain unchanged.

Before execution, the scenario builder compiles and displays:

- Baseline snapshot ID and projection checkpoint.
- Root seed and simulation seed `20260713`.
- A single typed intervention on the completion distribution for work item `116ab4b3-b108-5f91-ab7e-111f7fba1d45`, whose authorized display key is `AST-142`.
- Unchanged assumptions and explicit non-effects.
- The Aster working-day calendar used for the five-day shift.
- Validation that the graph is acyclic over the selected scheduling subgraph.
- A warning that this is a conditional schedule model over synthetic data, not a prediction of employee performance.

The confirmed intervention serializes as:

```json
{
  "type": "shift_completion_distribution",
  "work_item_id": "116ab4b3-b108-5f91-ab7e-111f7fba1d45",
  "delta_workdays": -5
}
```

The engine adds `-5` to the optimistic, most-likely, and pessimistic remaining-duration bounds together. It rejects the scenario if any shifted bound would be negative; it does not change dependencies, calendars, team capacity, or individual attributes.

The reference engine uses 50,000 trials and a versioned deterministic pseudorandom generator. The golden result, within one calendar day at each percentile and a 0.5 percentage-point sampling tolerance, is:

| Result | Baseline | Scenario | Difference |
|---|---|---|---|
| p50 launch date | 2026-08-20 | 2026-08-13 | 5 working days earlier |
| p80 launch date | 2026-08-24 | 2026-08-17 | 5 working days earlier |
| p95 launch date | 2026-08-27 | 2026-08-20 | 5 working days earlier |
| Dominant critical path | `AST-142` -> `AST-173` -> `AST-201` -> launch | Same path, lower occupancy | Reduced but not eliminated |

The result includes percentile dates, the launch-date distribution, critical-path occupancy, top blockers, sensitivity drivers, assumptions, uncertainty, missing-data warnings, baseline and scenario comparison, engine version, seed, trial count, and duration. It never reports a single date without the distribution.

`TC-DEMO-007` (evidence for `AC-SIM-001`): Repeating the run with the same snapshot, scenario, engine version, calendar, and seed produces byte-identical canonical numeric output. Changing any of those inputs produces a new run identity.

`TC-DEMO-008` (evidence for `AC-SIM-002`): The p95 under the scenario remains later than p80 and p50; the interface does not describe the scenario as guaranteeing an earlier launch.

## 8. Exact Jira remediation contract

The analyst asks the system to draft a Jira remediation that operationalizes the scenario. The sole allowed H1 external mutation is an update to synthetic Jira issue `AST-142` in allowlisted project `AST`.

### 8.1 Before snapshot

```json
{
  "issueKey": "AST-142",
  "version": 7,
  "fields": {
    "duedate": "2026-08-07",
    "priority": { "id": "3", "name": "Medium" },
    "labels": ["identity", "orion"]
  }
}
```

### 8.2 Canonical approved payload

```json
{
  "action": "jira.issue.update",
  "connectorInstallationId": "30000000-0000-4000-8000-000000000001",
  "expectedIssueVersion": 7,
  "issueKey": "AST-142",
  "projectKey": "AST",
  "set": {
    "duedate": "2026-07-31",
    "labels": ["digital-twin-remediation", "identity", "orion"],
    "priorityId": "2"
  },
  "tenantId": "10000000-0000-4000-8000-000000000001"
}
```

The preview shows the field-level before/after diff, target connector and project, evidence and scenario references, required approver roles, expiry, expected Jira version, rollback fields, and canonical payload hash. Human-readable text is explanatory; approval binds only the canonical structured payload.

Two distinct authenticated humans are required: one active operations approver and one active security approver. Both must still have their required role when execution begins. The approval window is 15 minutes from preview creation using server time. Self-approval, duplicate approval by one actor, delegated bot approval, or approval after role revocation fails closed.

Any payload, target, connector, source version, policy version, or tenant change after the first approval invalidates all collected approvals and creates a new preview. Execution uses a stable idempotency key derived from tenant, action type, target, expected version, and canonical payload hash.

### 8.3 Execution and compensation

Successful execution records the request, canonical payload, approvals, policy decision, connector request identifier, before snapshot, after snapshot, source response, timestamps, trace, and immutable action receipt. A repeated execution request returns the original receipt and MUST NOT perform a second Jira write.

Rollback restores `duedate`, `priority`, and `labels` from the before snapshot only if the issue still has the recorded after version and values. If another actor changed the issue, rollback enters `compensation_conflict`, performs no blind overwrite, and requires a new reviewed action.

`TC-DEMO-009` (evidence for `AC-ACT-001`): Zero or one approval, two approvals from the same actor, an expired approval, a changed payload, a changed issue version, or a revoked role results in zero Jira writes.

`TC-DEMO-010` (evidence for `AC-ACT-002`): With two valid approvals, concurrent execution requests produce exactly one Jira write and the same durable action receipt.

`TC-DEMO-011` (evidence for `AC-ACT-003`): In the no-conflict path, rollback restores the complete before snapshot, produces a compensation receipt, and remains idempotent when retried.

## 9. Required interface journey

The demonstration uses the production navigation and never invokes a hidden operator endpoint to advance state:

1. Sign in as `usr_aster_analyst`; select Aster Labs and confirm the synthetic-data banner.
2. Open connector health; run the scripted sync and inspect freshness, injected faults, recovery, and projection rebuild.
3. Open Ask; submit the reference question; expand citations and evidence status.
4. Switch to `usr_aster_limited`; repeat the question and show permission-preserving abstention.
5. Return as the analyst; convert the answer to the fixed scenario; inspect and confirm compiled assumptions.
6. Run the simulation; compare baseline and scenario distributions and inspect critical path and sensitivity.
7. Draft the exact Jira remediation; inspect the before/after payload and policy requirements.
8. Approve once as the operations approver and once as the security approver; return to the analyst session.
9. Execute two concurrent requests; inspect one action receipt and one source-system change.
10. Open Audit; trace question, evidence, scenario, approvals, execution, and receipt.
11. Roll back; verify restored Jira state and the compensation receipt.
12. Switch to Beacon Works; show its independent data, then run the isolation-canary tests.

### 9.1 Five-minute judged narrative

`AC-PROD-001` is measured with a healthy local stack and pre-authenticated synthetic actor sessions, but with empty tenant business data at the start. Every displayed result is produced through the real ingestion, retrieval, simulation, policy, connector, and audit paths; no final graph, answer, simulation, approval, receipt, or rollback is precomputed.

| Elapsed time | Demonstrated outcome |
|---|---|
| `00:00-00:40` | Select the frozen two-tenant fixture, run the deterministic seed/sync fast path, and show connector and projection checkpoints. |
| `00:40-01:35` | Ask the reference question, inspect claim-level Jira/GitHub citations, and show the permission-limited answer state. |
| `01:35-02:30` | Confirm the five-working-day intervention, run 50,000 trials, and compare p50/p80/p95 plus critical path and sensitivity. |
| `02:30-03:30` | Generate the exact `AST-142` diff and collect one operations and one security approval in distinct sessions. |
| `03:30-04:20` | Submit concurrent execution requests, show one Jira effect and one durable receipt, and open the correlated audit sequence. |
| `04:20-05:00` | Execute compensation, verify the restored source snapshot, and show the Beacon isolation canary remains absent from Aster outputs. |

The untimed assurance journey in section 9 exercises the same path with expanded evidence, injected failures, and administrative views. If the judged path exceeds five minutes, skips a real control, or uses precomputed final state, `AC-PROD-001` fails even when individual latency targets pass.

## 10. Performance and quality envelope

Tests run after warm application startup with two loaded tenants, up to 100 identities, up to 100,000 graph nodes and 1,000,000 graph edges per tenant, and ten concurrent interactive users. Cache-hit-only measurements do not establish a datastore service-level objective.

| ID | Metric | H1 pass condition |
|---|---|---|
| `SLO-DEMO-001` | Connector freshness | 99 percent of accepted synthetic webhooks reflected in authoritative normalized state within 15 minutes; scripted demo target within 60 seconds |
| `SLO-DEMO-002` | Non-AI API latency | p95 under 2 seconds and p99 under 5 seconds for scoped graph, evidence, scenario, approval, and audit reads |
| `SLO-DEMO-003` | Simulation latency | p95 under 10 seconds for the fixed 50,000-trial workload |
| `SLO-DEMO-004` | Cited answer latency | p95 under 20 seconds, excluding a clearly reported provider outage |
| `SLO-DEMO-005` | UI responsiveness | Local interaction acknowledgment under 100 ms and a progress state for work over 500 ms |
| `SLO-DEMO-006` | Projection recovery | Full H1 projection rebuild completes within 15 minutes per tenant and reaches a verifiable checkpoint |
| `SLO-DEMO-007` | Availability during demo | No single recoverable connector, graph, vector, cache, or model failure corrupts authoritative data or permits an unsafe action |

Quality gates:

- 100 percent of golden source objects normalize to the expected canonical form.
- 100 percent of golden entity merges and non-merges match the oracle; all merges are reversible.
- 100 percent of golden dependency edges and ACL labels match the oracle after rebuild.
- 100 percent of reference-answer material facts meet citation correctness.
- 100 percent of unsupported-claim cases abstain.
- 100 percent reproducibility for identical simulation inputs.
- 0 cross-tenant or unauthorized disclosures across API, UI, retrieval, cache, trace, log, and export tests.
- 0 invalid, expired, replayed, mutated, or insufficiently approved Jira writes.
- 100 percent of successful writes have a durable receipt and tested compensation behavior.
- The complete critical journey meets WCAG 2.2 AA automated checks and passes manual keyboard and screen-reader review.

## 11. Failure demonstrations

At least one automated run and one recorded operator run cover:

| Fault | Expected behavior |
|---|---|
| PostgreSQL unavailable | New authoritative operations stop; reads do not silently use stale projections as truth; no external action executes. |
| Neo4j unavailable | Evidence and authoritative records remain intact; graph-dependent UI reports degradation; no fabricated path is returned. |
| Vector retrieval unavailable | The answer may use authorized structured retrieval or abstain; it reports degraded retrieval. |
| Cache stale or unavailable | Authorization is re-evaluated against authoritative policy; cache bypass affects latency, not correctness. |
| Duplicate or out-of-order connector event | Final state matches the versioned source oracle and the condition is observable. |
| Partial synchronization | Results expose source/checkpoint staleness and do not claim completeness. |
| Permission revoked mid-run | Subsequent retrieval and tool steps fail closed; hidden evidence is not retained in visible output. |
| Prompt injection in Jira text | The text is quoted as untrusted evidence; it cannot activate a tool or alter policy. |
| Model timeout or invalid structure | Bounded retry or approved fallback occurs; otherwise the run ends safely with no action. |
| Approval expires during execution | Policy is rechecked immediately before the connector call; no write occurs after expiry. |
| Concurrent Jira edit | Version precondition fails; no overwrite occurs; preview and approvals become invalid. |
| Process restart after Jira response | Receipt reconciliation uses the idempotency key and source request ID; a retry does not duplicate the write. |

## 12. Demonstration completion gate

`TC-DEMO-012` (evidence for `AC-PROD-001`): H1 is complete only when a clean environment can load the frozen fixtures, execute the entire journey, pass all workload quality and security gates, generate the same canonical oracle report, and preserve a queryable audit chain from source observation through rollback.

Recorded screenshots or a seeded database alone are insufficient evidence. The release evidence bundle must include fixture and oracle digests, test and evaluation results, latency samples, accessibility results, traces with tenant content redacted, action and compensation receipts, and the exact application and contract versions.
