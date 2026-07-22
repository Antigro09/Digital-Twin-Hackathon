# Phase 8 Marketing Intelligence Plan

Audit date: 2026-07-22
Status: implementation baseline; created before Phase 8 application changes

## Existing extension points

- The authoritative company graph is `TwinGraphService`, backed by tenant-qualified PostgreSQL records, forced RLS, transactional outbox events, graph history, classifications, source provenance, bounded traversal, dependency analysis, and impact analysis. Marketing must extend its core ontology rather than create a separate store.
- `TwinEventService` and event intelligence already provide tenant-scoped, idempotent facts, reviewed reality/scenario routing, source evidence, audit history, and graph projection. Funnel movements are business events that reference marketing graph nodes.
- Decision intelligence already seals immutable graph snapshots, creates reviewed branches, propagates bounded variable changes, persists results, and supports forecasting/classification models. Marketing scenarios and conversion prediction belong in these contracts.
- The AI worker already has provider-neutral routing, controlled memory, evidence-grounded outputs, declarative skills, analyst profiles, and proposal-only authority. Marketing Analyst must use those same boundaries.
- Document and event systems contain the primitives required for documented-versus-actual process analysis, but there is no marketing-specific conformance model.
- The web application is an engineering control plane. Phase 8 will not create a separate marketing application or consumer-style campaign dashboard.

## Missing dependencies and risks

| Gap | Risk | Phase 8 response |
|---|---|---|
| Marketing ontology is absent from core graph types. | Campaign entities become unvalidated JSON or an isolated subsystem. | Register marketing nodes and typed relationships in `TwinGraphService`. |
| Funnel transitions have no canonical event/state contract. | Duplicate, backwards, cross-tenant, or personally identifying movement records. | Add aggregate stage snapshots and transition validation with stable event identity; prohibit individual propensity scoring. |
| Existing prediction kinds omit conversion and lead volume. | Marketing models masquerade as unrelated revenue/churn models. | Add aggregate `marketing_conversion` prediction kind and bounded targets. |
| Existing scenario kinds do not express channel allocation or segment targeting. | Budget reallocation bypasses decision snapshots or uses ambiguous generic changes. | Add `marketing_budget`, `marketing_channel_mix`, `market_entry`, and `segment_targeting` scenario kinds and required aggregate drivers. |
| No marketing recommendation schema exists. | Model prose lacks impact, confidence, affected nodes, or evidence. | Add a Marketing Analyst profile/output contract with proposal-only authority. |
| Process intelligence is generic. | “Documented vs actual” marketing operations cannot be measured consistently. | Add deterministic conformance comparison for aggregate stage/workflow observations. |
| Marketing data can include personal and behavioral data. | Unauthorized profiling or sensitive-trait targeting. | Operate on segment/aggregate identifiers, inherit source ACLs/classification, forbid protected/sensitive attributes and individual conversion scores. |
| No dedicated marketing UI/API client exists. | A broad UI addition would become an isolated demo surface. | Expose integrated backend contracts first; UI remains graph/simulation/AI driven and gains marketing through existing workspaces. |

## Implementation sequence

1. Extend core graph node/relationship registrations for department, employee/role specialization, campaigns, segments, leads, brand, channels, agencies, trends, funnel and financial/product connections.
2. Implement deterministic funnel metrics, campaign value metrics, budget optimization suggestions, simulation calculations, and process conformance in the AI worker as pure bounded functions.
3. Extend decision simulation and prediction contracts in both API and worker so existing engines accept marketing scenarios and aggregate conversion forecasts.
4. Add Marketing Analyst to the governed analyst registry with purpose, tools, permissions, memory, skills, loops, graph scope, and no mutation authority.
5. Add unit, integration, security, consistency, and scale-focused tests; update database constraints that enumerate scenario/prediction kinds.
6. Perform a final graph/AI/security/performance/data-consistency review and commit as `phase8`.

## Security and data rules

- Marketing data remains tenant-scoped and inherits graph classification, source data, ownership, audit, and ABAC boundaries.
- Metrics and predictions operate on campaigns, channels, segments, and aggregate funnel counts—not named-person behavioral profiles.
- Protected traits, inferred sensitive traits, dark patterns, and individual eligibility or conversion scoring are prohibited inputs/targets.
- AI recommendations are evidence-cited proposals and include reasoning, affected node IDs, confidence, expected impact, limitations, and review status.
- Simulations are immutable-snapshot branches and never change a live advertising platform or budget.
- All rates and currency calculations reject invalid denominators, mixed currencies, negative counts, non-finite values, and unbounded allocations.

## Acceptance criteria

- Marketing node and relationship types appear in the existing `/v1/twin` type catalog and work with existing search, traversal, dependencies, and impact analysis.
- Funnel transitions and metrics are monotonic, aggregate, deterministic, and tenant-safe.
- Campaign value, acquisition cost, lifetime value, ROI, and channel allocation use exact decimal calculations.
- Marketing simulations report lead, customer, revenue, and risk deltas through the existing decision engine contracts.
- Marketing Analyst and process conformance results are schema validated and proposal/read-only.
- Existing and new tests pass on a functioning Node/Python toolchain; unavailable local execution is reported rather than treated as passing.

## Final audit and verification

- **Graph integration:** Marketing types are registered in the existing tenant-scoped type catalog. Marketing relationships have explicit endpoint constraints and use the established traversal, impact, history, provenance, RLS, and outbox paths.
- **AI usage:** Marketing Analyst is provider-neutral, evidence-grounded, schema-validated, aggregate-only, and proposal-only. Recommendations require reasoning, affected nodes, confidence, expected impact, and evidence IDs.
- **Security:** Funnel events enforce adjacent forward transitions and UUID graph references. Aggregate conversion targets are allowlisted; protected and inferred sensitive features are rejected at both API and worker boundaries. Existing tenant isolation and source ACL rules remain authoritative.
- **Performance:** Funnel, simulation, optimization, and conformance calculations are bounded to finite collections. Existing graph traversal caps remain unchanged. No new store, background poller, or unbounded graph query was introduced.
- **Data consistency:** Currency, allocation, funnel monotonicity, scenario driver, prediction target, and database check constraints are aligned across API, worker, migrations, and published schemas.
- **Verification:** Workspace TypeScript type checking, targeted API integration/security tests, targeted web tests, and Python source/test AST parsing passed. Python runtime tests could not run because the host Python environment lacks pytest and the volume could not create a working virtual environment; this remains an environment limitation, not a passing test claim.
