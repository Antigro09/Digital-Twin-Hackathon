---
id: CH-11
title: User Experience and Visualization Specification
status: committed
version: 1.0.0
owners:
  - product-design
  - frontend-engineering
  - accessibility-engineering
last_reviewed: 2026-07-13
---

# User Experience and Visualization Specification

## 1. Experience goals

The interface helps an authorized user move through six distinct cognitive tasks without collapsing them into a conversational black box:

1. Establish what data is available, current, and permitted.
2. Ask a question and inspect evidence for each material claim.
3. Explore relationships and time without implying completeness or causality.
4. define and compare a reproducible scenario.
5. Review, approve, execute, audit, and if necessary compensate an exact external action.
6. Inspect a synthetic physical asset spatially, correlate its telemetry and lifecycle context, and safely exercise simulator-only controls.

`REQ-UX-001`: H1 MUST include cockpit, search, graph, evidence, timeline, scenario comparison, agent-run, approval, connector-health, and audit surfaces.

`REQ-UX-002`: Every screen MUST define loading, empty, error, denied, stale, partial, offline, destructive, and recovery states where applicable.

`REQ-UX-003`: H1 MUST meet WCAG 2.2 AA interaction, contrast, keyboard, focus, reduced-motion, and assistive-technology requirements.

`REQ-UX-004`: Graph and simulation visualizations MUST expose source evidence, time, confidence, permissions, uncertainty, and accessible tabular alternatives.

In addition, every screen identifies the active tenant. A tenant change clears tenant-scoped history, drafts, cached data, selected entities, and conversation context before loading the destination tenant. Observed facts, resolved claims, inferences, recommendations, scenario assumptions, simulated outputs, proposed actions, and completed actions use distinct labels and semantics. Freshness and partial-result state appear at the point of use. Every H1 journey is completable without chat, pointer, drag-and-drop, hover, animation, color perception, or spatial graph interpretation.

## 2. Application shell and information architecture

### 2.1 Persistent shell

The authenticated shell contains:

- Skip link to main content as the first focusable control.
- Product name and environment badge.
- Active tenant switcher with synthetic-data or non-production badge where applicable.
- Primary navigation.
- Global command palette and search trigger.
- Freshness/degradation indicator.
- Notifications entry point.
- Help and glossary entry point.
- User menu with active roles, accessibility preferences, session, and sign-out.

Desktop uses a visible left navigation rail and top context bar. Tablet uses a collapsible navigation drawer. Mobile uses a top tenant bar plus a bottom bar for Home, Ask, Explore, Scenarios, and More. The same URL and heading hierarchy are used at every breakpoint.

### 2.2 Primary navigation

| Group | Destinations | H1 visibility |
|---|---|---|
| Understand | Home, Ask, Explore, Timeline | Visible |
| Plan | Scenarios, Simulation Runs | Visible |
| Act | Proposed Actions, Approvals, Action Receipts | Visible to authorized roles; counts never reveal unauthorized items |
| Operate | Connectors, Sync Runs, Audit | Visible by role |
| Govern | Identities and Access, Policies, Ontology, Extensions, Retention | H1 shows required tenant administration; later items are status-labeled |
| Personal | Notifications, Saved Views, Reports, Preferences | Preferences visible; collaboration features status-labeled |

Authorization removes inaccessible destinations from routine navigation. Direct navigation to an unauthorized tenant resource returns the non-enumerating not-found treatment, not a role or object existence disclosure.

### 2.3 URL and navigation rules

- Tenant-scoped routes include a non-secret tenant slug for orientation, while authority derives only from the authenticated session.
- Entity, claim, evidence, scenario, run, approval, and action links use opaque IDs, never source text or email addresses.
- Browser Back and Forward preserve filters and selected tabs but never resurrect an expired approval, revoked evidence, or previous tenant context.
- Destructive or external-action transitions use a server-created preview resource; URL parameters cannot encode approval.
- Deep links open the required tenant only after authorization and show the user's current access scope.

## 3. Screen inventory

Status values follow the architecture-wide `Committed`, `Provisional`, `Research`, and `Rejected` definitions.

### 3.1 Entry and orientation

| Screen and route | Status | Audience | Required content and behavior |
|---|---|---|---|
| Product entry `/` | Committed H1 | Signed-out visitor or demo judge | Concise mission, evidence/simulation/action story, synthetic-demo disclosure, security posture link, accessibility link, and sign-in. No customer logos or unsupported outcome claims. |
| Sign-in `/sign-in` | Committed H1 | All users | Enterprise identity-provider choice, privacy notice, session error recovery, device and phishing-safe guidance. Credentials are entered only at the identity provider. |
| Tenant chooser `/tenants` | Committed H1 | Multi-tenant users | Authorized tenants, environment, role summary, last access, and search. Counts and names for unauthorized tenants never appear. |
| Home `/:tenant/home` | Committed H1 | Tenant users | Data freshness, connector status, recent cited answers, active scenarios, approval tasks, audit-relevant alerts, and clear first-run guidance. Cards are role-filtered and never infer hidden counts. |
| System status `/:tenant/status` | Committed H1 | Tenant users | Per-capability health, latest safe checkpoint, freshness, degraded behavior, and incident reference. Does not reveal infrastructure topology or secrets. |

### 3.2 Ask and evidence

| Screen and route | Status | Audience | Required content and behavior |
|---|---|---|---|
| Ask `/:tenant/ask` | Committed H1 | Analyst and domain users | Question composer, scope selector, source/freshness summary, example prompts, run budget, and prior runs. Submitting shows the frozen evidence scope and creates a cancellable run. |
| Answer run `/:tenant/answers/:runId` | Committed H1 | Run owner and authorized collaborators | Streaming stage status, final answer, claim-level evidence controls, confidence language, assumptions, missing evidence, model/profile version, freshness, bounded follow-up, and export. External actions are never implicit follow-ups. |
| Agent run inspector `/:tenant/runs/:runId` | Committed H1 | Run owner, authorized auditors, and operators | Capability-profile and phase timeline, evidence IDs, tool names and validated argument digests, handoffs, budgets, policy decisions, approvals, retries, model/profile version, termination reason, and redacted trace linkage. It exposes no private chain-of-thought, secret, hidden ACL, or inaccessible source content. |
| Evidence drawer | Committed H1 | Any answer viewer | Source title, source system, authorized snippet, source and ingestion times, claim relation, transformation history, access status, and open-in-source action. It is a focus-managed dialog on narrow layouts and a complementary panel on wide layouts. |
| Knowledge browser `/:tenant/knowledge` | Committed H1 | Analysts and stewards | Faceted list of authorized entities, claims, evidence, relationships, source, confidence, validity time, and quality state. Default is list/table, not graph. |
| Entity detail `/:tenant/entities/:entityId` | Committed H1 | Authorized users | Canonical attributes, aliases, provenance, relationships, timeline, ACL summary, data-quality warnings, merge history, and report-correction entry. Hidden relations do not influence visible counts. |
| Evidence detail `/:tenant/evidence/:evidenceId` | Committed H1 | Authorized users | Immutable source digest, normalized observation, transformation lineage, claims supported or contradicted, retention status, and source link. Raw payload requires separate scope and is redacted by default. |
| Resolution review `/:tenant/resolution/:decisionId` | Committed H1 | Data stewards | Candidate records, match and non-match evidence, rule/model version, confidence, resulting canonical identity, split action, impact preview, and rebuild status. |

### 3.3 Explore and time

| Screen and route | Status | Audience | Required content and behavior |
|---|---|---|---|
| Graph explorer `/:tenant/explore` | Committed H1 | Analysts and domain users | Search-first bounded subgraph, relation and time filters, layout controls, evidence side panel, path explanation, current node/edge cap, truncation notice, table alternative, and shareable saved view. |
| Relationship detail `/:tenant/relationships/:relationshipId` | Committed H1 | Authorized users | Direction, type, endpoint labels, validity interval, confidence, source evidence, derivation rule, contradiction state, and history. Direction and semantics are written in plain language. |
| Timeline `/:tenant/timeline` | Committed H1 | Analysts and domain users | Time-ordered source events, claims, decisions, simulation snapshots, actions, and corrections. Users can switch among source time, validity time, and ingestion time. |
| Dependency view `/:tenant/dependencies/:rootId` | Committed H1 | Program and engineering users | Directed acyclic scheduling view, cycle warnings, blockers, milestones, critical-path occupancy, assumptions, and accessible path list. It cannot imply causality beyond the typed relationship. |
| Organization view `/:tenant/organization` | Provisional H2 | Authorized domain users | Team and reporting structures at approved granularity, effective dates, vacancies, and source quality. Individual activity metrics are excluded. |
| Asset twin `/:tenant/assets/:assetId` | Committed H1 | Authorized operators | Synthetic disclosure, live/pause state, interactive rotatable perspective SVG, synchronized component list, telemetry with units and age, deterministic anomaly/forecast model card, lifecycle history, exact simulator-command preview, execution receipt, and audit evidence. The route remains usable if the visual cannot render. |

### 3.4 Scenarios and simulations

| Screen and route | Status | Audience | Required content and behavior |
|---|---|---|---|
| Scenario library `/:tenant/scenarios` | Committed H1 | Analysts | Owned/shared scenarios, status, baseline snapshot, last run, engine version, tags, and archive. It distinguishes a mutable draft from an immutable executed version. |
| Scenario builder `/:tenant/scenarios/new` | Committed H1 | Analysts | Goal, selected baseline, typed interventions, assumptions, calendar, seed, validation, non-effects, estimated budget, and confirmation. Natural-language input compiles to structured fields that the user must inspect. |
| Scenario detail `/:tenant/scenarios/:scenarioId` | Committed H1 | Authorized viewers | Version history, structured intervention diff, assumptions, validation findings, runs, collaborators, and duplicate-to-draft. An executed scenario version is immutable. |
| Simulation run `/:tenant/simulations/:runId` | Committed H1 | Authorized viewers | Progress, cancellation, baseline/scenario percentile comparison, distribution, critical path, blockers, sensitivity, warnings, snapshot, seed, engine, trials, and runtime. A table and narrative expose the same result. |
| Compare `/:tenant/simulations/compare` | Committed H1 | Analysts | Side-by-side selection with compatible-baseline validation, aligned measures, delta explanations, and export. Incompatible engine versions or snapshots are visibly marked and never silently normalized. |
| Simulation playback `/:tenant/simulations/:runId/playback` | Provisional H2 | Analysts | Trial aggregation over time with pause, step, speed, and text summary. It is not required for the H1 decision and must pass an accessibility-value review before commitment. |

### 3.5 Governed action

| Screen and route | Status | Audience | Required content and behavior |
|---|---|---|---|
| Proposed actions `/:tenant/actions` | Committed H1 | Analysts and action operators | Draft, awaiting approval, ready, expired, executing, completed, failed, and compensation states; filters do not expose unauthorized counts. |
| Action preview `/:tenant/actions/:actionId/preview` | Committed H1 | Requester and approvers | Exact target, canonical payload hash, before/after field diff, expected source version, evidence/scenario references, policy decision, required roles, expiry, risk, idempotency scope, and compensation plan. Payload is read-only. |
| Approval inbox `/:tenant/approvals` | Committed H1 | Approvers | Tasks requiring the actor's specific role, expiry, requester, action type, target, risk, and status. Bulk approval is prohibited for H1 external actions. |
| Approval decision `/:tenant/approvals/:approvalId` | Committed H1 | Eligible approver | Full preview, approval-role statement, exact expiry, conflict-of-interest/self-approval result, approve and decline with optional rationale. No preselected decision and no countdown animation that pressures action. |
| Action execution `/:tenant/actions/:actionId` | Committed H1 | Authorized executor | Final policy recheck, approval summary, execution status, cancellation semantics, connector response, immutable receipt, and next safe action. Refresh cannot resubmit the connector write. |
| Receipt and rollback `/:tenant/actions/:actionId/receipt` | Committed H1 | Authorized viewers/operators | Request and response IDs, before/after snapshots, approvals, timestamps, trace reference, idempotency result, rollback eligibility, exact compensation preview, and compensation receipt or conflict. |

### 3.6 Operations and governance

| Screen and route | Status | Audience | Required content and behavior |
|---|---|---|---|
| Connectors `/:tenant/admin/connectors` | Committed H1 | Tenant and connector admins | Connector type, scope, allowlist, credential health without secret value, sync freshness, webhook state, rate-limit state, last reconciliation, and disable control. |
| Connector setup `/:tenant/admin/connectors/new` | Committed H1 | Connector admins | Provider authorization, requested scopes, tenant/source binding, allowlist, data categories, retention summary, validation, and explicit install confirmation. |
| Sync run `/:tenant/admin/sync/:runId` | Committed H1 | Connector admins and stewards | Durable workflow stages, cursors, item counts, duplicates, tombstones, retries, quarantines, checkpoints, partial failures, reconciliation, and safe resume. |
| Audit `/:tenant/audit` | Committed H1 | Security, compliance, tenant admins | Filterable append-only event index, actor, delegated authority, resource, policy decision, trace, redaction, export, and chain from answer through compensation. Search and export are themselves audited. |
| Audit event `/:tenant/audit/:eventId` | Committed H1 | Authorized auditors | Canonical event, schema version, integrity state, actor and tenant derivation, request correlation, related events, redacted payload, retention class, and export status. |
| Identities and access `/:tenant/admin/access` | Committed H2 | Tenant admins | Source-to-actor mappings, SSO/SCIM memberships, roles, delegations, connector identities, revocation, access review, and effective-policy explanation. H1 fixture roles are read-only outside the product administration surface. |
| Policies `/:tenant/admin/policies` | Committed H2 | Security admins | Versioned policy bundles, change diff, validation, staged activation, rollback, impacted actions, and test cases. H1 shows policy explanations but policy editing is configuration-managed. |
| Ontology `/:tenant/admin/ontology` | Provisional H2 | Data stewards and extension authors | Core and namespaced types, versions, constraints, provenance, compatibility, and package status. Core types cannot be modified in place. |
| Extensions `/:tenant/admin/extensions` | Provisional H2 | Tenant admins and developers | Signed connector, ontology, workflow, and tool packages; permissions; compatibility; evaluation; enable/disable; and provenance. Marketplace discovery is later than private installation. |
| Retention and deletion `/:tenant/admin/data-governance` | Committed H2 | Privacy and tenant admins | Data categories, retention rules, legal holds, deletion requests, projection erasure, evidence impact, and signed completion report. H1 exposes read-only policy documentation. |

### 3.7 Personal, collaboration, and reporting

| Screen and route | Status | Audience | Required content and behavior |
|---|---|---|---|
| Notifications `/:tenant/notifications` | Provisional H2 | All users | Approval requests, completed runs, stale sources, access changes, shared analyses, and policy events. Sensitive content is omitted from push/email bodies. |
| Saved views `/:tenant/saved` | Provisional H2 | Analysts | Saved queries, graph scopes, filters, and simulation comparisons with permission revalidation on open. |
| Reports `/:tenant/reports` | Provisional H2 | Analysts and executives | Versioned evidence-backed report drafts, review status, data snapshot, export, and expiration. Reports never freeze authorization to source evidence. |
| Collaboration panel | Provisional H2 | Authorized collaborators | Comments anchored to claims/scenario versions, mentions, review decisions, and activity. A comment cannot grant source access. |
| Preferences `/:tenant/preferences` | Committed H1 | All users | Theme, density, timezone, date format, reduced motion, graph simplification, notification settings, keyboard shortcuts, and data-export defaults. |

## 4. Common state contract

Every screen implements each applicable state below with a stable heading, status text, recovery action, focus behavior, and telemetry event. A spinner without explanatory text is never a complete state.

| State | Required presentation and behavior |
|---|---|
| Initial loading | Preserve shell and heading skeleton; announce loading once after a short delay; avoid focus movement; permit cancellation for long runs. |
| Incremental refresh | Keep prior authorized content, label it with its checkpoint, show refresh progress non-modally, and replace only after authorization recheck. |
| Streaming | Show named stages and elapsed time; mark partial text as provisional; do not expose hidden chain-of-thought; allow cancel where safe. |
| First-use empty | Explain why the area is empty, the role required for the primary action, and the safe next step. |
| Filtered empty | Preserve filters, say no authorized results match, and offer clear-filters without implying hidden results. |
| Current success | Show source/checkpoint freshness and a complete primary action outcome. |
| Stale success | Show last safe checkpoint, age, affected conclusions, and refresh/retry; never use stale policy to authorize an action. |
| Partial result | Name unavailable sources or capabilities, what remains usable, and what conclusions are limited. Partial is not styled as full success. |
| Redacted by permission | Omit protected values and structural hints; explain that accessible evidence is incomplete and provide an access workflow if configured. |
| Permission lost | Immediately remove protected content from view and client cache, stop dependent work, preserve only a non-sensitive run reference, and announce the change. |
| Validation error | Place a summary at the top, associate field errors programmatically, preserve valid input, and move focus to the summary. |
| Version conflict | Show the current safe source version and stale draft diff; require re-preview and re-approval where action semantics changed. |
| Dependency degraded | Name the capability, not internal topology; describe safe fallback and disabled actions; link to tenant-safe status. |
| Rate limited | Show retry time and preserved work; background retries use bounded backoff and can be canceled. |
| Offline or disconnected | Keep non-sensitive already-rendered content read-only, mark it stale, queue no external action, and require revalidation after reconnect. |
| Session expired | Remove protected data from the viewport and local storage, preserve only an opaque return route, and reauthenticate before recovery. |
| Not found | Use a single non-enumerating treatment for missing and unauthorized tenant resources. |
| Model unavailable or invalid | Preserve the question and evidence scope, show a safe retry or approved fallback, and create no recommendation or action. |
| Traversal truncated | Show node/edge/depth limits, omitted count only when policy-safe, and controls to refine scope instead of silently clipping. |
| Awaiting approval | Show required roles, collected decisions, expiry, and payload hash; never reveal approver membership beyond authorized policy output. |
| Approval expired or invalidated | Freeze the invalid decision history, explain the invalidating event, and require a new preview. |
| Executing | Show durable action state and safe navigation; disable duplicate submission but allow refresh and receipt recovery. |
| Completed | Show verified source result and immutable receipt. A visual success state requires both, not merely an HTTP response. |
| Compensation available | Show the exact restore diff, precondition, risks, approval policy, and idempotency behavior. |
| Compensation conflict | Show that no overwrite occurred, current authorized source state, prior receipt, and the new reviewed-action path. |
| Fatal error | Provide correlation ID, safe retry, support path, and preserved non-sensitive draft; never expose stack, query, secret, prompt, or tenant data. |

`TC-UX-001` (evidence for `AC-UX-001`): Automated component tests render every applicable state for every H1 route; end-to-end tests cover the state transitions in the reference workload, including permission revocation and compensation conflict.

## 5. Interaction patterns

### 5.1 Search and command palette

Global search returns only tenant-authorized entity, claim, scenario, action, and navigation results. Results are grouped by type, show freshness, and never reveal counts for inaccessible groups. The command palette provides navigation and non-destructive commands. It MUST NOT approve or execute an external action.

`Ctrl/Cmd+K` opens the command palette. `/` focuses search when the focus is not in an editable field. `?` opens shortcut help. `Esc` closes the topmost non-destructive overlay and restores focus. All shortcuts have menu equivalents, can be disabled where appropriate, and avoid browser or assistive-technology conflicts.

### 5.2 Citations and evidence

Each material answer claim has a visible semantic label: `Observed`, `Resolved`, `Inferred`, `Assumption`, `Simulated`, or `Recommendation`. Citation controls name source and age. Opening evidence does not lose the reader's position; closing it restores focus to the invoking claim. If a citation becomes unauthorized, the content is removed and the answer is re-evaluated or marked no longer verifiable.

### 5.3 Forms and drafts

Drafts use explicit Save status and server-side versioning. Sensitive drafts are not placed in browser local storage. Auto-save failures are announced without stealing focus. Natural-language scenario input, AI-suggested fields, and connector-suggested mappings remain proposals until the user confirms the structured representation.

### 5.4 Approvals

Approvals use a dedicated page, not a chat response, toast, email link, or modal layered over unrelated work. Approve and Decline have equal visual weight. The approver must be able to inspect the entire canonical diff and policy summary without scrolling through generated persuasion. Any edit creates a new proposal and invalidates approval. The UI never preselects approval, uses celebratory animation, or hides expiry and rollback risk.

### 5.5 Responsive behavior

- At 320 to 599 CSS pixels, tables become labeled record lists or horizontal regions with an explicit table alternative; no data column silently disappears.
- At 600 to 1023 pixels, secondary panels become drawers with focus trapping and return.
- At 1024 pixels and above, evidence or inspector panels may be persistent while the primary heading and reading order remain logical.
- Touch targets are at least 24 by 24 CSS pixels with sufficient spacing; primary controls target 44 by 44 where layout permits.
- Graph canvas gestures always have visible button and keyboard equivalents.

### 5.6 Motion and theme

Motion communicates state only when needed. Under `prefers-reduced-motion`, animated graph transitions, count-up values, chart interpolation, skeleton shimmer, and simulation playback are disabled or replaced by discrete updates. Dark, light, and system themes use tokenized colors that meet contrast requirements. Status meaning, graph type, and uncertainty never rely on theme-specific color alone.

## 6. Visualization system

### 6.1 Shared visual grammar

| Meaning | Encoding |
|---|---|
| Source observation | Solid outline plus `Observed` text/icon |
| Resolved canonical entity or relationship | Solid line with provenance control |
| Inferred relationship | Dashed line plus confidence text |
| Scenario-only entity or edge | Dotted line plus `Scenario` label |
| Contradicted claim | Split warning marker and explicit contradiction text |
| Stale data | Clock marker, age text, and patterned treatment |
| Permission-limited result | Omitted protected geometry plus an accessible incompleteness notice; no ghost node that leaks topology |
| Critical path | Increased line weight, `Critical path` label, and ordered path list |
| Risk severity | Text label and shape/icon in addition to a color token |
| Uncertainty | Distribution, interval, or range with numeric table; never an unlabeled blur or single-point gauge |

Every visualization includes a title, decision question, source/checkpoint time, legend, filters summary, visible limits, reset, download policy, and data-table or structured-text alternative. Exported images include title, legend, snapshot, timestamp, and synthetic-data watermark for H1.

### 6.2 Visualization catalog

| Visualization | Status | Decision supported | Required implementation |
|---|---|---|---|
| Knowledge graph | Committed H1 | What authorized entities and relationships support this question? | Search-first bounded subgraph; deterministic initial layout; type and time filters; evidence inspector; path list; node/edge cap; table equivalent. |
| Relationship explorer | Committed H1 | Why does this relationship exist and how has it changed? | One focused edge with endpoints, direction, validity, confidence, contradiction, derivation, and evidence timeline. |
| Dependency graph | Committed H1 | Which sequence gates a milestone? | Directed layout; typed edges; cycle detection; critical-path occupancy; blocker list; hidden-edge-safe counts; topological list alternative. |
| Project flow | Committed H1 | Where does work move, wait, or block? | Stage and dependency view derived from Jira state, with duration source and missing-data warnings; not an individual productivity chart. |
| Risk heatmap | Committed H1 | Which project risks combine likelihood and impact? | Small bounded matrix; every cell has text, count only when disclosure-safe, and linked list; simulated and observed risks remain separate. |
| Event timeline | Committed H1 | What changed, when, and according to which clock? | Zoomable but keyboard-operable sequence with source, validity, ingestion, decision, and action lanes plus tabular event log. |
| Launch distribution | Committed H1 | How do baseline and scenario dates differ? | Overlaid distribution or cumulative curves, p50/p80/p95 markers, trial count, calendar, numeric table, and non-causal comparison language. |
| Sensitivity view | Committed H1 | Which modeled inputs most affect launch uncertainty? | Ranked tornado or interval bars, direction, magnitude, method, and table; sensitivity is not labeled causality. |
| Critical-path occupancy | Committed H1 | How frequently does each path gate launch across trials? | Ranked paths and percentages with confidence/sample information; accessible ordered list is primary on narrow screens. |
| Evidence lineage | Committed H1 | How did a source observation become a displayed claim? | Left-to-right transformation stages, versions, digests, policy checks, and a linear text trace. |
| Audit sequence | Committed H1 | Which actors and controls led from question to action and rollback? | Chronological event list with correlation groups; optional swimlanes by actor/service; canonical table remains authoritative. |
| Connector freshness | Committed H1 | Which source or projection may limit a conclusion? | Status table and small age bars; explicit timestamps and thresholds; no green-only health signal. |
| Procedural 3D-style physical-asset view | Committed H1 synthetic path | Where on the demonstration asset is the selected condition measured? | Rotatable perspective SVG with component hotspots tied to stable IDs and telemetry; rotate/reset buttons, pointer drag, arrow keys, keyboard component selection, reduced motion, rendering fallback, and an equivalent ordered component/status/measurement view. It is not a CAD model, contains no exclusive data, and is always labeled synthetic. |
| Organization graph | Provisional H2 | How are approved teams and reporting structures related at a selected time? | Effective-dated hierarchy with vacancy and source-quality states; no individual performance overlays. |
| Calendar | Provisional H2 | How do modeled milestones and constraints align over working calendars? | Accessible agenda/table first, timezone and working-day rules, scenario overlay, no automatic source mutation. |
| Aggregate communication flow | Provisional H2 | Where do approved team-level handoffs appear under a documented purpose? | Minimum group size, aggregate edges, privacy review, no message sentiment or individual centrality. Direct individual communication graph is Rejected through H3. |
| Financial flow | Provisional H3 | How do approved budgets or cost allocations connect to programs? | Separate authorization domain, currency and period semantics, reconciliation status, lineage, and finance-owner approval. |
| Geographic view | Provisional H4 | Which approved regions, facilities, or assets are affected? | Coarse location by default, residency-aware data, accessible region table, and no precise person location. |
| Simulation playback | Provisional H2 | Does temporal playback add insight beyond comparison and distributions? | Aggregated states, pause/step, reduced-motion mode, transcript, and a measured user-value gate. |
| 3D organizational view | Rejected H1-H3; Research H4 | No H1-H3 organizational decision requires it | Rejected for organizational delivery because of occlusion, navigation cost, performance, and accessibility burden. The separate H1 physical-asset scene does not change this decision. H4 organizational research requires a validated decision task that cannot be served by 2D plus table. |

### 6.3 Knowledge graph behavior

The graph never opens on an unbounded tenant-wide force layout. The user starts from an entity, question result, saved view, or typed traversal template. The initial view renders no more than 200 authorized nodes and expands to a hard client rendering ceiling of 500. Server traversal limits may be lower based on policy and cost. Reaching a limit produces a visible truncation state and refinement controls.

Node size encodes only the selected, labeled measure and defaults to a constant. It MUST NOT silently encode degree, popularity, employee rank, or activity. Edge thickness defaults to constant and may encode a labeled quantitative measure only when its unit and provenance are defined. Inferred confidence is shown numerically or categorically, not solely as opacity.

Keyboard users can search nodes, move through the ordered node list, inspect neighbors grouped by relationship type, traverse an edge, pin an item, change filters, and open evidence. A synchronized data table contains the visible authorized nodes and edges. Screen readers are not required to interpret canvas geometry.

### 6.4 Simulation behavior

Baseline and scenario use a shared horizontal time scale. p50, p80, and p95 are labeled directly and reproduced in a table. The default view emphasizes distributions and differences, not animated particles or a single countdown. The interface states the conditional question, unchanged assumptions, engine version, seed, trial count, snapshot, missing data, and validity limitation before interpretation text.

### 6.5 Heatmap behavior

Heatmaps contain a small, fixed set of ordered likelihood and impact categories. Each cell has an accessible name, pattern or icon, and link to the filtered risk list. Empty means no authorized modeled risks in the cell, not no organizational risk. Cells never expose hidden counts by subtraction.

## 7. Content and confidence language

Use direct language:

- `Supported by 3 current sources` rather than `The AI knows`.
- `The simulation places the p80 date at September 24 under these assumptions` rather than `Launch will be September 24`.
- `Accessible evidence is insufficient` rather than `No evidence exists` when permissions or source health limit the result.
- `This relationship was inferred with medium confidence` rather than `Probably related`.
- `The action was not executed because approval expired` rather than a generic error.

Confidence labels map to a versioned calibration policy and include an explanation. Numeric confidence is not shown when the underlying method is not calibrated for that interpretation.

## 8. Accessibility acceptance

### 8.1 Required engineering controls

- Semantic landmarks, a single page-level `h1`, logical headings, and native controls before custom ARIA.
- Visible focus with at least 3:1 contrast against adjacent colors.
- Text and interactive-control contrast meeting WCAG 2.2 AA.
- All dialogs have programmatic name, description where needed, focus containment, explicit close, and focus return.
- Live regions are limited to meaningful asynchronous changes and never announce streaming tokens one by one.
- Data tables provide captions, headers, scopes, sorting state, and pagination state.
- Errors are summarized and associated with fields; success is not communicated by color alone.
- Zoom to 200 percent and reflow at 320 CSS pixels without two-dimensional scrolling except for genuinely two-dimensional data regions with equivalent alternatives.
- User-selected timezone and locale are displayed; raw timestamps remain available to auditors.
- Charts and graph controls work at 400 percent zoom or provide an equivalent structured view.
- Pointer gestures, drag, pinch, and hover all have single-pointer and keyboard alternatives.
- Authentication does not rely on cognitive-function tests and supports password-manager and identity-provider flows.

### 8.2 Manual acceptance journey

`TC-UX-002` (evidence for `AC-UX-001`): Using keyboard and a supported screen reader, a tester can sign in, choose Aster, determine freshness, ask the reference question, inspect every citation and limitation, build the fixed scenario, compare p50/p80/p95 values, inspect the critical path, preview the exact Jira diff, approve or decline, inspect the receipt, and request rollback.

`TC-UX-003` (evidence for `AC-UX-001`): At 320 CSS pixels and 200 percent zoom, the same journey preserves all fields, warnings, evidence states, and action semantics without clipped controls or hidden data columns.

`TC-UX-004` (evidence for `AC-UX-001`): With reduced motion and forced colors enabled, no state, graph relationship type, risk severity, percentile, approval state, or execution result loses its non-color/non-motion representation.

`TC-UX-005` (evidence for `AC-UX-001`): Automated accessibility checks produce no serious or critical violations on H1 routes, and manual review records no WCAG 2.2 A or AA failure in the critical journey.

## 9. Usability and telemetry acceptance

Product telemetry records route, interaction class, duration, result class, accessibility preference category only when necessary, and correlation ID. It excludes question text, source snippets, entity names, payload values, emails, graph content, and model prompts by default. Tenant-level analytics require tenant policy and cannot join data across tenants without separately governed opt-in.

| Test case | Acceptance criterion |
|---|---|
| `TC-UX-006` mapped to `AC-UX-001` | A first-time reference-workload analyst can reach a cited answer, open its evidence, and identify missing information without facilitator intervention. |
| `TC-UX-007` mapped to `AC-UX-001` | An eligible approver can correctly identify target, changed fields, expiry, source version, required roles, and rollback behavior before deciding. |
| `TC-UX-008` mapped to `AC-UX-001` and `AC-ACT-002` | No UI control can bypass server authorization, forge tenant context, mutate an approved payload, or turn refresh/retry into a duplicate action. |
| `TC-UX-009` mapped to `AC-UX-001` | Graph, distribution, sensitivity, heatmap, lineage, and audit visualizations each have an equivalent table or structured-text representation with the same decision-relevant values. |
| `TC-UX-010` mapped to `AC-UX-001` | User testing detects no case where a participant interprets simulation output as guaranteed, hidden evidence as absent, an inferred edge as observed, or a draft action as executed; any such result blocks release copy. |
