---
id: CH-18
title: Event Intelligence and Causal Impact Engine
status: committed
version: 1.0.0
owners:
  - knowledge-graph
  - ai-platform
  - product-engineering
  - security-engineering
last_reviewed: 2026-07-15
---

# Event Intelligence and Causal Impact Engine

## 1. Purpose and H1 truth boundary

The Event Intelligence and Causal Impact Engine converts a reported change in reality into a reviewable, evidence-linked event interpretation, resolves its subjects against the authorized tenant graph, computes bounded direct and downstream consequences, and either creates a scenario branch or applies an exact reversible mutation to the synthetic H1 graph. It answers what changed, why, which relationships are affected, which risks or forecasts move, which consequences remain unknown, and what process-level remediation should be considered.

H1 is a deterministic product demonstration over the synthetic Aster and Beacon fixtures. It does not claim learned causal discovery, calibrated business prediction, autonomous organizational control, or connection to an HRIS, IAM provider, cloud control plane, industrial system, or other external system. Event application changes a shared tenant-scoped synthetic projection used by the entity catalog, bounded traversal, and simulation snapshot assembly. The Compose profile durably records the event workflow and projection snapshot in PostgreSQL; isolated tests may use the same persistence contract with an in-memory adapter but do not claim restart durability. No path revokes a real permission, edits a real employee record, controls production, or creates a real hiring decision.

Factual workforce events may be represented when supplied and authorized, but the engine MUST NOT score an individual, infer attrition or productivity, recommend an employment decision, or execute an HR action. A departure example may recommend ownership review, access-review workflow, documentation continuity, or a separately governed staffing scenario; it may not decide whom to hire, promote, remove, or evaluate.

| Requirement | Commitment |
|---|---|
| `REQ-EVT-001` | Convert untrusted natural-language reports into typed event interpretations with provenance, confidence, verification, evidence, entity candidates, and explicit unknowns. |
| `REQ-EVT-002` | Produce bounded, explainable direct, indirect, second-order, third-order, and unknown impacts without graph cycles or unbounded fan-out. |
| `REQ-EVT-003` | Route confirmed facts to a reviewable reality-update path and uncertain claims to isolated scenario branches without silently changing current truth. |
| `REQ-EVT-004` | Bind any synthetic graph update to tenant authority, exact payload and version, human review, idempotency, audit evidence, and rollback. |
| `REQ-EVT-005` | Provide an accessible event workspace with interpretation, resolution, causal graph, before/after state, timeline, branch, recommendation, and rollback views. |

## 2. Canonical event envelope and taxonomy

An event envelope contains an immutable tenant-qualified event ID, schema version, type and taxonomy version, source class and source reference, reporting actor, creator, occurred-at interval, recorded-at timestamp, optional location, confidence band and numeric support score, verification state, related entity references, evidence references, attachment metadata, prior-event references, classification, retention policy, and trace context. Time is an interval when the report says `yesterday`, `recently`, or another imprecise phrase; the engine does not invent precision.

The core taxonomy is versioned and extensible:

- people: hire, promotion, transfer, departure, leave, role change, contractor addition/removal, reorganization, and manager change;
- project: start, delay, cancellation, requirement or milestone change, budget or priority change, and scope increase/reduction;
- technology: outage, migration, discovered vulnerability, deprecated dependency, launch, removal, architecture change, and repository archive;
- business: customer acquisition/loss/risk, contract, vendor, market, competitor, regulatory, and funding change;
- operations: equipment, supply, process, production, facility, and natural-hazard events; and
- external: economic, weather, regulation, competitor, and industry-security events.

Customer ontology packages may add namespaced event types but cannot weaken required fields, confidence routing, security controls, or mutation policy. One input can yield multiple interpretations with explicit ordering or simultaneity. A potential statement such as `we might lose our largest customer` is classified as a risk hypothesis, not a completed customer-loss fact.

## 3. Interpretation and entity resolution pipeline

The pipeline is: authenticated input acceptance, content quarantine and redaction, event extraction, schema validation, event classification, tenant-bounded entity resolution, impact expansion, deterministic policy checks, optional simulation, human review, exact mutation, projection and transactional-outbox commit, and audit. Each stage receives typed data and a least-authority capability envelope. Event text remains a quoted data field and is never concatenated into privileged instructions or tool definitions.

Entity resolution returns ranked candidates with entity ID, display-safe label, confidence, matching features, conflicting features, and whether confirmation is required. Aliases, abbreviations, historic names, reversible merges, and source identities may support a candidate. An unknown entity stays unresolved; it is not auto-created or merged. Ambiguous candidates block reality application until a reviewer selects a candidate or marks the reference unknown. Tenant boundaries are applied before candidate generation so identifiers, counts, and rejected candidates cannot disclose another tenant.

Conflicting reports create a linked conflict set. Neither report overwrites the other. Source reliability, evidence strength, valid time, and reviewer decisions are recorded independently; confidence is not a substitute for proof. Corrections supersede the earlier interpretation while retaining history.

## 4. Bounded causal impact analysis

The engine starts from the resolved event subjects and applies a versioned library of typed cause-and-effect rules over an authorized snapshot. An impact contains its affected node or relationship, operation (`create`, `update`, `remove`, or `flag`), impact kind, before and proposed-after values, severity, confidence band, time horizon, causal depth, explanation, evidence, rule/model version, recommended process action, and uncertainty or missing-data note. Every impact evidence entry is an actual tenant-authorized `evidence_id` present in that event envelope; display clients resolve the identifier to its source kind, summary, and confidence rather than rendering an invented or dangling citation.

H1 separates four classes:

1. direct effects are definitional consequences of the event, such as a synthetic person state changing from active to departed;
2. relationship effects update or flag ownership, work, approval, dependency, or affected-by relationships;
3. derived risk and forecast effects are hypotheses with confidence decay and explicit assumptions; and
4. unknown effects are recorded when evidence, ontology coverage, or the traversal budget is insufficient.

Propagation is deterministic and capped at depth three, 100 impact nodes, 250 impact edges, 25 outgoing rules per source, and a fixed execution budget in H1. A visited key of event, rule, entity, property, and snapshot version prevents loops. Repeated effects are deduplicated by canonical payload; mutually contradictory effects become a conflict, not last-write-wins. Cycles in the company graph may be traversed once but never cause recursive expansion. When a cap is reached, the result is `partial` with a continuation/review reason and a visible unknown-impact record; it is never presented as complete.

The displayed causal graph is an explanation graph, not proof of real-world causality. Each edge distinguishes `observed`, `rule-derived`, `simulated`, or `unknown`; confidence decays across derived hops and cannot exceed its weakest evidence or policy input. Recommendations are bounded workflow proposals such as assign an interim service owner, review access, validate a runbook, contact an affected customer, or run a schedule scenario.

## 5. Confidence, verification, and truth routing

The confidence bands are `confirmed`, `likely`, `possible`, `speculative`, and `rejected`. A numeric score aids ranking but never independently authorizes a write.

| Band | Default behavior |
|---|---|
| Confirmed | May enter reality-update review only with required evidence, resolved entities, authorized reviewer, exact snapshot version, and all deterministic checks passing. |
| Likely | Creates or updates a scenario branch; human verification can later produce a distinct confirmed interpretation. |
| Possible | Scenario only, with assumptions and missing evidence made prominent. |
| Speculative | Saved only as an isolated hypothesis when policy permits; no live graph or prediction baseline changes. |
| Rejected | Retained as restricted audit/conflict evidence and excluded from current truth and simulations unless explicitly re-reviewed. |

Events involving employment, legal, financial, identity, production, security control, destructive operations, or external writes never receive autonomous execution authority. H1 synthetic reality application requires a human review decision and exact preview; production designs may add dual control based on risk classification but cannot weaken `REQ-ACT-004`.

## 6. Review, application, idempotency, and rollback

Interpretation creates a draft with an ETag, graph snapshot version and state hash, canonical payload hash, expiry, impact summary, and unresolved blockers. Review records `accept`, `reject`, or `request_changes`, the authenticated reviewer, selected resolution candidates, rationale, and reviewed hash. Review refreshes the authorized shared projection snapshot; its version and canonical state hash are included in the reviewed payload. Applied, rolled-back, and rejected events are terminal immutable history: review returns a conflict and a correction must create a superseding event rather than overwrite application, receipt, branch, timeline, or audit evidence. Requesting approval freezes the accepted payload, proposed mutations, event version, graph snapshot version, and graph state hash. Reality application requires `If-Match`, an `Idempotency-Key`, execution-time authorization, unexpired approval, identical payload hash, and a compare-and-swap match on both graph version and state hash. A graph change after approval makes the approval stale even when the event version has not changed. Scenario application retains the approved immutable base version and hash without modifying current truth.

For the H1 event slice, one PostgreSQL transaction records the updated event, executed approval, action receipt, before/after application snapshot, branch, timeline entry, idempotency record, hash-linked audit evidence, current event-projection snapshot, and CloudEvents-compatible outbox envelope. Before writing, it serializes the tenant audit tail, reserves the `(tenant, operation, Idempotency-Key)` row in `edt.idempotency`, row-locks the authoritative event and projection records, and compares the exact event version/status/ETag plus projection version/state hash. These database predicates—not a replica-local map—decide the winner; an identical retry returns the original persisted receipt and a different request under the same key fails. The shared projection performs the exact version-and-hash transition; a failed database commit restores its pre-application snapshot and exposes no successful receipt. Reality receipts contain only impacts explicitly marked `live_mutation_eligible` whose operation is in the authoritative allowlist (`set_state`, `modify_relationship`, `remove_relationship`, or `append_outage`). Risk, prediction, workflow, annotation, synthetic relationship-creation, and recommendation proposals remain non-authoritative scenario inputs. An empty reality mutation set or any unsupported operation fails closed; the projection neither advances its version nor stores the rejected operation as a fact. The returned receipt identifies the authorizing approval, event versions, graph versions, before/after state hashes, exact mutations, audit record, and allocated outbox position. The outbox envelope receives the same transaction-assigned position. Its `dataschema` is the `$id` of the source-controlled `event-intelligence-event-changed.v1.schema.json` contract, and `schema_hash` is the SHA-256 of that schema's canonical JSON value rather than a digest of its URI. All results remain labeled `synthetic: true` and `external_write: false`.

At API startup the Compose profile hydrates tenant events, interpretations, approvals, receipts, applications, branches, timeline entries, every audit record, the idempotency ledger, and latest projection snapshot from PostgreSQL before serving the event workflow. Payload tenant assertions are checked again after RLS reads. Audit hydration validates record shape and content hash, discovers missing predecessors, multiple children of one predecessor, unreachable records, and tenant-sequence gaps, and exposes counts plus bounded record/hash references through the audit endpoint. It does not discard corruption by selecting one path and declaring the chain valid. An empty chain is a valid bootstrap only when the tenant has no persisted event workflow; an existing event with no complete audit evidence is unhealthy. Invalid, gapped, forked, empty-for-existing-state, or event-incomplete audit evidence sets `chain_valid: false` and blocks new audited mutations until repair. Historical graph bindings are never invented during hydration: a legacy event without them is forced back to review, while an approval, receipt, application, branch, timeline entry, or idempotency record with missing, inconsistent, or cross-tenant bindings is excluded from executable state. The persisted idempotency record therefore returns the original receipt after a restart; it does not execute the mutation again. Reusing an idempotency key with different input fails. A stale graph version or hash, missing or dangling evidence, unresolved identity, changed payload, expired review, invalid cycle, fan-out limit, unauthorized field, unsupported projection operation, audit-health failure, or cross-tenant reference has zero committed effects.

The receipt retains before and after state hashes, event and graph versions, mutation list, projection status, outbox position, event/receipt IDs, and audit reference; the persisted application record retains the corresponding snapshots needed for replay and compensation. Rollback is a compensating event, not deletion of history. It uses a new monotonic graph version and is allowed only when both the current synthetic graph version and state hash equal the recorded post-application version and hash; returning to the same content at a later graph version does not make an older compensation safe. Otherwise a new conflict review is required. Rollback is itself authorized, exact, version-and-hash checked, idempotent, atomically persisted with audit and outbox evidence, and restart-safe.

## 7. Timeline, replay, and alternate futures

The event timeline orders valid time separately from recorded/system time and shows state before the event, the reported occurrence, immediate effects, later derived effects, corrections, rollback, and branch points. Every applied or rolled-back entry carries its receipt ID, before/after graph versions, and before/after state hashes so the persisted application can be replayed and audited after process restart. History replay reads an authorized persisted snapshot and immutable event evidence; it never rewrites the current graph. Out-of-order events trigger recomputation against their valid-time location and create a reviewable delta to later derived impacts.

Scenario branches reference an immutable base graph version and state hash, event interpretation, assumptions, rule/model versions, and branch status. Users can compare baseline, confirmed history, and alternate future without copying claims into live truth. Simultaneous events use a deterministic ordering key and a batch-level conflict pass. Branches expose prediction deltas only when an approved simulation model supports the affected outcome; otherwise the engine reports that no validated forecast is available.

## 8. Agents and authority

The bounded capability profiles are event extraction, entity resolution, impact analysis, causal explanation, simulation, risk analysis, verification, and graph mutation. They exchange schema-valid envelopes and retain structured rationales, evidence references, rule/model versions, and action traces rather than private chain of thought. No handoff widens tenant, data, tool, budget, or mutation authority. The graph-mutation profile is deterministic middleware: it cannot reinterpret text or invent mutations.

Model failure, unavailable approved fallback, schema-invalid output, prompt injection, insufficient evidence, or budget exhaustion produces abstention or human review. AI-derived impact suggestions remain proposals until deterministic validators accept their types, targets, ontology constraints, provenance, and authorization.

## 9. Security, privacy, consistency, and scale

`CTRL-EVT-001` requires authentication, server-derived tenant context, field and relationship authorization, input-size and attachment limits, content/instruction separation, malware and secret handling, sensitive-field classification/redaction, evidence ACL intersection, rate limits, bounded expansion, exact-payload review, audit, and rollback. Event creation never grants permission and an event claiming that a user is an administrator cannot change policy. Attachments are immutable scanned objects; H1 accepts metadata only.

The OpenAPI `event.read`, `event.create`, `event.review`, `event.approve`, `event.apply`, and `event.rollback` names are product scopes at the gateway boundary. H1 maps reads to an authorized `evidence.read.*` capability, creation/review/application to `scenario.create` plus creator binding, approval to the distinct `action.approve.operations` or `action.approve.security` capability, and rollback to either authorized approval capability. The platform operator and limited synthetic actor remain explicitly denied. This mapping is policy configuration, not an authority expansion performed by an agent or event payload.

An event cannot delete critical ownership silently. Removal rules create an explicit gap such as `NEEDS_OWNER` and route it to review. Required ontology constraints run against the complete proposed mutation set. A proposed relationship mutation is eligible only when its exact before relationship exists in the approved snapshot; absent facts become explicit unknowns or recommendations rather than fabricated edges. Events that would affect millions of nodes are compiled into a durable, chunked, resumable impact plan with sampled preview and aggregate counts in H2; H1 rejects any proposal above its fixed cap. Projection outages leave PostgreSQL authoritative and report stale projections. Events arriving faster than processing are durably queued, deduplicated, backpressured, and ordered per tenant/aggregate; H1 exposes the semantics without claiming production throughput.

Confidential event text is minimized in logs, notifications, traces, model context, and audit. Evidence permissions constrain the event, impacts, explanations, counts, timeline, and exports. Cross-company events may reference an external public entity but cannot read or mutate another customer tenant. Dates before the tenant/company existence, future dates represented as completed facts, invalid intervals, and impossible state transitions are blocked or routed to scenario review.

## 10. H1 interface and acceptance

The Event Intelligence workspace provides event entry, extracted interpretations, confidence and verification controls, candidate resolution, selectable causal graph plus structured impact list, before/after comparison, risks and prediction deltas, recommendations, scenario/reality routing, timeline, branch comparison, review/application state, receipts, and rollback. Color is never the only confidence or severity signal; all graph information has a keyboard-operable list/table equivalent.

The REST surface under `/v1/event-intelligence` defines taxonomy, interpretation, paginated event listing and detail, review, approval request and decision, application, rollback, audit, replay, timeline, branch listing, and branch comparison resources. Tenant context is server-derived and pagination cursors are bound to the active authorization fingerprint. Mutating routes require idempotency; state transitions require ETags; all responses are private and non-cacheable. Approval resources expose their reviewed event version plus bound graph version and hash; receipts and timeline entries distinguish event versions from graph versions and expose approval, receipt, and outbox linkage required for durable replay.

`AC-EVT-001` and `TST-EVT-001` require deterministic coverage of multi-event extraction, vague time, uncertainty, entity ambiguity, resolvable impact evidence, bounded cycle-safe propagation, conflict and injection handling, payload/version/hash rejection, tenant isolation, scenario routing, shared entity/traversal/simulation projection visibility, atomic receipt/audit/outbox persistence, restart hydration, one-time apply, replay, rollback, and audit-chain verification. The oracle confirms no real external change or individual employment recommendation.
