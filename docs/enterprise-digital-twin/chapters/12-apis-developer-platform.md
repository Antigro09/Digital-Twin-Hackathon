---
id: CH-12
title: APIs and Developer Platform
status: Committed
version: 1.0.0
owners:
  - API Platform
  - Developer Experience
  - Security
last_reviewed: 2026-07-13
---

# APIs and Developer Platform

## 1. Purpose and interface precedence

This chapter defines the public REST API, run streaming, signed webhooks, event contracts, conditional GraphQL and gRPC surfaces, MCP exposure, extension packages, generated SDKs, and CLI. Machine-readable contracts are normative where they are more restrictive than examples in prose.

Interface precedence is:

1. security, tenancy, authorization, and approval invariants in the architecture;
2. machine-readable contract at its released commit and content hash;
3. this chapter;
4. examples and generated documentation.

An implementation conflict is release-blocking. It is not resolved by accepting whatever the running service currently emits.

| ID | Requirement |
|---|---|
| REQ-ARCH-007 | The platform MUST define REST, SSE, webhooks, events, GraphQL, gRPC, MCP, plugin, SDK, and CLI contracts with clear horizon ownership. |
| REQ-TEN-001 | Clients MUST NOT select authoritative tenant context; every request binds it from authenticated membership. |
| REQ-DEV-001 | APIs, events, schemas, ontology packages, connectors, plugins, agents, workflows, SDKs, CLI, and webhooks MUST be versioned and independently testable. |
| REQ-REL-003 | Interface workflows MUST define retries, idempotency, ordering, deduplication, clock behavior, partitions, replay, dead letters, and backpressure. |
| REQ-SEC-001 | Every privileged operation MUST authenticate, authorize, tenant-bind, and audit at execution time. |
| REQ-ACT-001 | Approval/execution APIs MUST bind tenant, actor, credential, target, canonical arguments, expiry, policy version, and idempotency key. |
| REQ-SEC-007 | Plugin and SDK builds MUST use pinned dependencies, provenance, SBOM, signing, scanning, protected CI identities, and verified artifacts. |
| QAR-PERF-001 | Ten H1 users issuing bounded non-AI graph/evidence reads MUST see p95 latency below 2 seconds. |
| QAR-COR-001 | Duplicate, reordered, or replayed requests/events MUST converge to one stable state without duplicate effects. |
| QAR-SEC-001 | Guessed cross-tenant identifiers through every interface MUST reveal neither existence nor content. |

OpenAPI 3.1 is primary for public command/administration REST. Every applicable contract defines authorization, concurrency, pagination, versioning, rate limits, deadlines, retry, redaction, and audit. Long runs use resumable SSE; external webhooks are authenticated, replay-bounded, at-least-once, versioned, and reconcilable; MCP/plugins remain narrower than internal services and disabled by default.

## 2. Normative artifacts

The source-controlled contract set is:

| Artifact | Status | Role |
|---|---|---|
| `contracts/openapi/enterprise-digital-twin.openapi.yaml` | H1 Committed | REST operations, schemas, security, errors, and SSE discovery responses. |
| `contracts/asyncapi/events.asyncapi.yaml` | H1 Committed | Internal/outbound event channels and CloudEvents payload schemas. |
| `contracts/schemas/` | H1 Committed | Canonical types, tools, scenarios, manifests, and webhook data. |
| `contracts/mcp-manifest.json` | H1 Committed | MCP resources, tools, annotations, and approval classes. |
| `contracts/graphql/schema.graphql` | H2 Provisional | Read-only graph exploration SDL. |
| `contracts/proto/digital_twin.proto` | H3 Provisional | Extracted internal service boundaries. |

Generated artifacts are never edited directly. CI verifies that generated SDKs, reference documentation, examples, and consolidated specification use the exact released contract hashes.

## 3. Canonical contract types

Versioned domain payloads carry a `schema_version`. Standard protocol envelopes identify their contract through the protocol-defined field and media/schema URI instead: RFC 9457 `type`, CloudEvents `specversion` plus `type`/`dataschema`, and SSE event name plus data schema version. Public representations omit fields the actor cannot access and never rely on omission to grant permission. IDs are opaque UUIDs unless the field explicitly names a provider key.

| Type | Required semantics |
|---|---|
| `TenantContext` | Internal only: tenant ID, actor, active delegations, purpose, policy version, authorization timestamp, region, trace context. It is assembled from authentication plus server-side tenant selection. |
| `Actor` | Tenant-local ID, kind `human`, `service`, or `agent`, immutable principal/audit reference, status, assurance level, and display fields. An `agent` is a non-authenticating audit subject bound to an invoking principal, capability profile, and reduced delegation; it has no independent membership or credential. Provider users are not actors until linked. |
| `Delegation` | Grantor, grantee, allowed actions/resources/purposes, valid interval, revocation version, and non-delegable flag. Handoffs take the intersection, never a union. |
| `ResourceRef` | Resource kind, opaque ID, optional version and projection generation. No URI may contain a storage credential. |
| `PolicyDecision` | Effect `allow`, `deny`, or `indeterminate`, stable reason codes, obligations, policy version, evaluated time, and audit reference. `indeterminate` is enforced as deny and can never satisfy an authorization or approval. Denial detail is redacted when it would reveal a resource. |
| `Entity`, `EntityVersion`, `Claim`, `Evidence`, `Relationship`, `OntologyType`, `SourceACL`, `ResolutionDecision` | Bitemporal, evidence-backed data types defined in CH-05. Current views include `data_watermark` and conflict/provenance links. |
| `SourceObject`, `NormalizedObservation`, `SyncCursor`, `ProjectionCheckpoint` | Connector and projection types defined in CH-05 and CH-06. Raw object URIs and cursor internals are not public. |
| `AgentRun`, `ToolInvocation`, `ApprovalRequest`, `ApprovedPayload`, `ActionReceipt`, `CompensationResult` | Durable AI/action types defined in CH-07. Public forms expose state and safe rationale, never prompts, reasoning internals, credentials, or encrypted argument refs. |
| `Scenario`, `SimulationSnapshot`, `SimulationRun`, `Forecast`, `Uncertainty`, `Assumption` | Immutable/versioned types from CH-08. Numeric values, seed, iteration count, and engine version are not rewritten by an explanation layer. |
| `AuditEvent` | Append-only event ID, tenant, actor/service, action, resource refs, outcome, reason, policy version, trace ID, occurred/recorded time, and payload hash. Sensitive detail is stored separately with stricter access. |
| `TraceContext` | W3C `traceparent`, optional `tracestate`, request ID, and tenant-safe baggage policy. Client baggage cannot set tenant, actor, or authorization fields. |
| `Problem` | RFC 9457 problem details plus stable `code`, `request_id`, safe `errors[]`, and optional `retry_after`. |
| `AssetTwinSnapshot` | Tenant-authorized synthetic asset, spatial components, current/history telemetry, deterministic analytics and model card, lifecycle records, simulator control state, and data watermark. |
| `AssetControlPreview` | Short-lived exact simulated command, expected version, before/after state, safety checks, payload hash, ETag, expiry, and explicit no-external-write marker. |
| `AssetControlReceipt` | Idempotent simulator transition result, before/after versions, payload hash, audit evidence, and explicit simulation/no-external-write markers. Replay returns this same receipt. |

Canonical date-times are RFC 3339 UTC with millisecond precision; calendar dates are ISO `YYYY-MM-DD`. Monetary amounts use integer minor units plus ISO currency. Arbitrary precision identifiers and seeds are strings. JSON numbers MUST be finite; `NaN` and infinities are invalid.

## 4. REST/HTTP contract

### 4.1 Protocol and authentication

- Base path is `/v1`; HTTPS with TLS 1.2 or newer is mandatory outside local development.
- Requests and responses use `application/json`; unsupported media types return `415`.
- Authentication uses an OIDC access token with issuer, audience, signature, expiry, assurance, and revocation checks. Browser sessions use an HTTP-only, secure, same-site cookie and CSRF protection for commands.
- An authenticated principal selects among server-known tenant memberships through a server-issued, short-lived, actor/session- and audience-bound opaque context handle. Browsers carry it in an HTTP-only `EDT-Context` cookie; SDK/CLI clients use `X-EDT-Context`. The handle references a server-side membership and policy version, expires and rotates on context change, and cannot be minted from a client-supplied tenant value. `X-Tenant-ID` is rejected. A `tenant_id` present in a versioned canonical resource schema is only a consistency assertion: the server compares it with derived context and rejects a mismatch; it can never select or expand scope. Public command schemas omit it wherever possible.
- `traceparent` may be accepted after syntax validation. `X-Request-ID` is generated by the server; a safe client correlation ID may be echoed separately.
- Sensitive responses set `Cache-Control: private, no-store`. CDN caching is limited to public documentation and immutable, authorization-safe assets.

### 4.2 Resource and command surface

| Operation | Result and invariants |
|---|---|
| `GET /v1/me` | Current actor, memberships, active tenant context summary, and safe capabilities. |
| `GET /v1/entities` | Authorized keyset-paginated entity summaries at one bound watermark; filters and sort fields are allowlisted. |
| `GET /v1/entities/{entity_id}` | Authorized current entity, selected claims, conflict markers, provenance links, watermark, and ETag. |
| `POST /v1/graph/traversals` | Executes a registered bounded query template with typed parameters; no Cypher. Returns nodes/edges, truncation, watermark, and projection generation. |
| `POST /v1/questions` | Creates a grounded-answer run and returns `202`, run resource, status URL, and event URL. Requires `Idempotency-Key`. |
| `GET /v1/agent-runs/{run_id}` | Safe run state, progress, result when complete, usage summary, and timestamps. |
| `POST /v1/agent-runs/{run_id}/cancel` | Idempotent cancellation request; `202` while stopping, `200` if terminal. |
| `GET /v1/connectors` | Installed connector summaries, scopes, state, freshness, and health; secret fields excluded. |
| `POST /v1/connector-installations` | Starts an authorized installation flow and returns a short-lived provider authorization URL. |
| `POST /v1/connectors/{installation_id}/reconcile` | Requests an idempotent reconcile/backfill within policy; never accepts a source cursor. |
| `DELETE /v1/connectors/{installation_id}` | Starts revocation/deletion workflow with confirmation and audit. |
| `POST /v1/simulation-snapshots` | Compiles and seals an evidence-backed snapshot or returns validation conflicts. |
| `POST /v1/scenarios` | Creates a typed scenario draft against one snapshot. |
| `POST /v1/scenarios/{id}/confirm` | Confirms the exact scenario digest for the current actor. |
| `POST /v1/simulations` | Starts a confirmed simulation and returns `202` plus run/event URLs. |
| `GET /v1/simulations/{simulation_id}` | Returns authorized durable state, progress, immutable result when complete, and event URL. |
| `POST /v1/actions/jira/remediation-previews` | Produces an immutable exact `AST-142` field-limited Jira preview in CH-06. It neither opens approval nor mutates. |
| `POST /v1/actions/jira/remediation-previews/{preview_id}/approval-requests` | Opens one approval request bound to the current immutable preview hash; the response is idempotent and callers cannot choose approvers. |
| `POST /v1/approvals/{id}/decisions` | Records one human approve/reject decision after reauthentication when policy requires. |
| `POST /v1/approvals/{id}/execute` | Consumes a valid execution grant; returns original receipt on idempotent replay. It cannot accept replacement payload fields. |
| `POST /v1/action-receipts/{id}/compensation-previews` | Produces guarded rollback preview. Execution follows a new approval/action flow. |
| `GET /v1/assets` | Lists tenant-authorized synthetic asset summaries; it does not discover or connect devices. |
| `GET /v1/assets/{assetId}/twin` | Returns the physical scene/component metadata, current and historical synthetic telemetry, deterministic analytics/model card, lifecycle, simulator control state, and watermark. |
| `GET /v1/assets/{assetId}/telemetry` | Advances exactly one deterministic five-second frame and returns the most recent 1-120 frames selected by `limit`. Polling this resource is not an industrial streaming or real-time guarantee. |
| `POST /v1/assets/{assetId}/control-previews` | Validates type, value, reason, expected version, transition, range, tenant policy, and idempotency; returns a short-lived exact simulator-only preview and ETag. |
| `POST /v1/assets/{assetId}/control-previews/{previewId}/execute` | Reauthorizes and executes the unchanged preview once against simulator state using `Idempotency-Key` and `If-Match`; performs no device or network write. |
| `GET /v1/audit-events` | Authorized keyset-paginated audit index with filters; detail access is separately controlled. |
| `GET /v1/ontology/types` | Installed, visible ontology catalog and versions. |
| `POST /v1/extension-packages/validations` | Validates a signed package in quarantine; installation is a separate administrator command. |

Collection reads use `GET`. Complex read-only graph searches may use `POST` because bodies are structured and size-bounded; they still have no side effects and are marked accordingly in OpenAPI. Commands return a resource or run; they never return an untracked free-form success string.

### 4.3 Idempotency and concurrency

Every public `POST`, `PUT`, `PATCH`, and state-changing `DELETE` declares whether `Idempotency-Key` is required. Ordinary command keys are 16 to 128 printable ASCII characters, scoped to tenant, actor, operation, and canonical request hash, and retained for 24 hours or the command retention period, whichever is longer. An approved external action instead uses the action-level key from CH-06, scoped to tenant, target, expected source version, action, and approved payload digest; actor identity is audited but is not part of a namespace that could let two actors execute the same grant twice.

The first request atomically stores key, request hash, state, and eventual response reference. Same key plus same hash returns the original status/result. Same key plus a different hash returns `409 idempotency_key_reused`. In-progress replay returns the same run. A server timeout does not authorize a client to generate a new key for an external write; the client queries the original command.

Mutable administrative resources use strong ETags. `PUT`, `PATCH`, confirmation, and policy-sensitive actions require `If-Match`; absent precondition returns `428`, stale version returns `412`. A scenario draft may transition once to a confirmed state, but its operation list and digest do not change. Snapshot content, confirmed scenario content, an approval's bound payload/digest, and action receipts are immutable; approval decisions and lifecycle transitions are append-only child records that update a derived state projection.

Physical-asset control previews follow the same strong-precondition and replay rules but are not external actions and do not require the Jira action's two-person approval policy. A preview binds the tenant, actor, synthetic asset ID, expected simulator version, command, reason, safety-policy version, expiry, and payload hash. Execution rejects an altered or expired preview, stale version, unsupported transition, out-of-range value, policy failure, or reused key with a different hash. Every response carries `execution_mode: simulation`; every receipt carries `simulation: true` and `external_write: false`.

Asset reads require `asset.read`, preview requires `asset.control.preview`, and execution requires `asset.control.execute`. These application capabilities are evaluated against the server-derived actor and tenant context on every call; a general login or graph-read grant is insufficient.

### 4.4 Pagination, filtering, and sorting

Collections use keyset pagination with `page_size` from 1 to 100 and an opaque authenticated `page_cursor`. The cursor binds tenant, actor ID, authorization fingerprint/policy version, endpoint, normalized filters, sort, snapshot watermark, last sort key, and expiry. It is not a base64-encoded SQL fragment. Invalid, altered, expired, or differently scoped cursors return `400 invalid_cursor`.

Responses contain `items`, `next_cursor`, `has_more`, and `data_watermark`. Sort fields and filter operators are endpoint allowlists. Default order is stable and ends in immutable ID. Offset pagination is not public. A policy change can invalidate a cursor and return `409 authorization_changed` rather than risk mixed visibility.

### 4.5 Errors, retry, and limits

Errors use [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json`:

```json
{
  "type": "https://docs.example.invalid/problems/source-changed",
  "title": "Source changed",
  "status": 409,
  "code": "source_changed",
  "detail": "Create a new preview from the current source state.",
  "instance": "/v1/actions/opaque-id",
  "request_id": "UUID",
  "errors": []
}
```

`detail` never confirms existence of an unauthorized resource. Validation errors name safe JSON Pointers and stable codes, not raw rejected values. Retryable responses are `408`, selected `409` states, `425`, `429`, `502`, `503`, and `504` only when the operation's idempotency contract permits retry. `Retry-After` is supplied where known.

Default tenant limits are 120 ordinary requests/minute per actor, 20 graph queries/minute, 10 AI/simulation starts/minute, and 5 action/approval commands/minute, with lower anonymous limits for public docs only. Responses include `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` on `429`. Limits are also enforced per tenant, IP risk bucket, connector installation, and provider quota; headers do not reveal other users.

Server deadlines are 2 seconds for ordinary reads, 5 seconds for bounded graph queries, and 10 seconds for synchronous commands that only enqueue durable work. Longer work returns `202`. Client disconnect cancels safe in-process reads but does not erase a durable run or assume an external command failed.

## 5. Server-Sent Events

`GET /v1/agent-runs/{run_id}/events` and `GET /v1/simulations/{simulation_id}/events` return `text/event-stream` after normal authorization. A stream is a view over durable run events, not the source of truth. The client can always recover from the corresponding run resource.

Durable event frames contain a monotonically increasing per-run `id`, a registered `event`, and one JSON `data` object. H1 event names are:

- `run.accepted`, `run.started`, `run.progress`;
- `retrieval.started`, `retrieval.completed`;
- `tool.started`, `tool.completed`, `tool.failed` with safe tool category only;
- `run.awaiting_confirmation`, `run.awaiting_approval`;
- `simulation.progress` at bounded batch intervals;
- `run.completed`, `run.abstained`, `run.cancelled`, `run.failed`;
- `stream.heartbeat` every 15 seconds.

Durable events carry schema version, run ID, sequence, timestamp, safe progress, and result link when terminal. `stream.heartbeat` is transport-only: it carries the latest durable sequence, has no new event ID, and is not retained or replayed. No event carries prompts, chain-of-thought, raw connector content, tool arguments, tokens, approval secrets, or inaccessible evidence.

The client reconnects with `Last-Event-ID`. The server replays retained run events for at least 24 hours and starts after the supplied sequence. An unknown future ID returns `400`; replay outside retention returns `410 event_history_expired` and directs the client to run state. Streams cap at 30 minutes per connection, support proxy heartbeat, disable buffering, and use per-actor connection limits. Authorization is checked on connect and at least every 30 seconds as a backstop; policy/ACL revocation publishes an immediate connection-invalidation signal and closes affected streams.

## 6. Webhooks

### 6.1 Inbound provider webhooks

GitHub and Jira ingress is specified in CH-06. The GitHub callback is bound to the app registration/environment, then maps the signed payload installation ID to exactly one server-side tenant installation. Jira dynamic callbacks use installation-bound opaque paths in addition to their signed bearer token and matched webhook ID. Raw bytes or bearer claims are authenticated before trusting routing fields, durable receipt precedes `2xx`, duplicate delivery is accepted idempotently, and canonical state comes from authenticated reconciliation.

### 6.2 Outbound platform webhooks

Outbound platform subscriptions are H2 Provisional; H1 commits only authenticated provider webhook ingress and internal outbox events. If the H2 gate is approved, tenants may subscribe only to allowlisted event types such as `connector.sync.completed`, `run.completed`, `approval.requested`, `action.completed`, and `action.compensation.completed`. Source text, full answers, credentials, and raw evidence are not delivered; subscribers fetch authorized detail through REST. Activation requires subscription-management/secret-rotation OpenAPI operations, delivery SLO and quota, SSRF tests, and a support owner.

Payloads use CloudEvents 1.0 JSON and contain `specversion`, global event `id`, stable `source`, versioned `type`, resource `subject`, `time`, `datacontenttype`, `dataschema`, and minimal `data`. Tenant is bound to the subscription and is not treated as a routing instruction in the payload.

Each subscription has a 32-byte random secret. Headers are:

```text
X-EDT-Webhook-Id: subscription UUID
X-EDT-Delivery-Id: event UUID
X-EDT-Timestamp: Unix seconds
X-EDT-Key-Id: opaque secret version
X-EDT-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + raw_body)>
```

Consumers must require HTTPS, compare signatures in constant time, reject timestamps outside 5 minutes, deduplicate delivery ID for at least 72 hours, and tolerate unknown additive fields. Secret rotation supports current and previous secret for a 24-hour overlap and identifies the key version without exposing it.

Delivery is at least once and ordering is not guaranteed. Retry schedule is 1, 5, 15, 60 minutes, then 6, 12, and 24 hours with jitter. `2xx` acknowledges; `408`, `409`, `425`, `429`, network errors, and `5xx` retry; other `4xx` suspend after three occurrences. A dead-lettered event is visible to administrators and can be redelivered with the same event ID and a new delivery-attempt record. Reconciliation through REST is always available.

SSRF controls resolve and validate DNS on every attempt, forbid loopback/private/link-local/metadata ranges unless an approved private-delivery profile exists, cap redirects at zero, connect only to an IP returned by that validated resolution while using the original hostname for TLS SNI/hostname verification, pin the HTTPS port, and apply connection/body/time limits.

## 7. Async events and CloudEvents

Internal logical events also use CloudEvents 1.0 semantics and JSON Schema, persisted first through the PostgreSQL transactional outbox. H1 transport is the outbox plus Temporal activities; the AsyncAPI contract describes logical channels without implying Kafka.

Event type format is `com.enterprisedigitaltwin.<domain>.<event>.v1`. The envelope includes tenant ID internally, tenant-qualified `partition_key`, aggregate type/ID/version, causation ID, correlation ID, trace context, occurred time, schema URI/hash, and data classification. The default partition key is the RFC 8785 hash of `{tenant_id, aggregate_type, aggregate_id}`; a projection channel that requires total tenant outbox order instead hashes `{tenant_id, projection_name}` and declares that exception in AsyncAPI. A partition key is an ordering key, never an authorization input. Event consumers deduplicate global event ID and enforce monotonically increasing aggregate version where ordering matters.

Events describe facts in past tense. Commands are not smuggled through event topics. Payloads contain stable IDs and changed fields, not complete sensitive documents. A consumer encountering a version gap pauses the aggregate and reconciles from the authoritative API. Poison events enter a tenant-scoped dead-letter ledger with redacted diagnostics.

Adding an optional field is backward compatible. Removing/renaming fields, changing meaning/type, making optional data required, or reinterpreting ordering requires a new event major type. Producers publish old and new types during migration; consumers prove readiness before old publication stops.

## 8. GraphQL and gRPC conditional surfaces

### 8.1 GraphQL

GraphQL is H2 Provisional and read-only. It exists only if design-partner evidence shows that REST query templates cannot support graph exploration. It exposes canonical entity, relationship, claim, evidence citation, and connection types; it has no mutation, subscription, arbitrary Cypher, secret field, or tenant argument. The provisional `JSON` scalar is limited to schema-validated, redacted extension properties and cannot carry arbitrary storage records.

Production accepts registered persisted operations by hash. Authorization occurs in data loaders before fetch and again during result serialization. Schema fields declare classification and cost. Default limits are depth 4, cost 10,000, 5,000 returned nodes, 2-second resolver deadline, and 1 MiB response. Introspection is administrator-only outside development. N+1 access is prevented with tenant/ACL-aware batch loaders whose cache lasts one request.

Collections use Relay-style connections with opaque authorization-bound keyset cursors; offsets and tenant arguments are absent. Cursor invalidation, rate limiting, errors, redaction, audit, and idempotency for the read-only surface inherit the REST rules. A resolver may return fewer authorized nodes plus `truncated=true`; it never fills a requested count with inaccessible neighbors.

Fields are additive within a major schema. Removal requires `@deprecated` for at least two minor releases and 12 months, usage telemetry, migration documentation, and a major release if semantics break. Clients must handle nullable fields and unknown enum values through generated unknown cases.

### 8.2 gRPC

gRPC is H3 Provisional for extracted service-to-service boundaries only. Public clients use REST. Protobuf packages use `edt.<domain>.v1`, stable field numbers, wrapper/message types for presence, `google.protobuf.Timestamp`, and explicit pagination tokens. Field numbers and enum numeric values are never reused; removals are reserved.

Mutating RPCs carry command ID/idempotency and explicit expected version. Every RPC declares deadline, retry class, max message size, and authorization action. mTLS workload identity plus an identity-aware interceptor derives tenant/service context; tenant metadata from callers is matched to a signed delegation and never trusted alone. Errors use canonical gRPC status plus typed details mapped consistently to RFC 9457.

Streaming RPCs require flow control, cancellation, bounded buffers, and resume tokens. A service extraction is approved only after contract, load, failure, deployment, and rollback evidence shows a benefit over the modular API process.

## 9. MCP contract

The H1 MCP server is a thin policy-enforced facade over application services. It uses OAuth authorization, derives tenant and actor from the session, and exposes no tenant selector, generic URL fetch, SQL, Cypher, shell, filesystem, or unrestricted provider operation.

### 9.1 Resources

| URI template | Content |
|---|---|
| `edt://entities/{entity_id}` | Authorized entity summary with watermark and provenance links. |
| `edt://evidence/{evidence_id}` | Authorized citation-safe evidence view, not object-store URI. |
| `edt://runs/{run_id}` | Safe run state and result link. |
| `edt://scenarios/{scenario_id}` | Confirmed scenario diff and assumptions. |
| `edt://simulation-runs/{run_id}` | Structured forecast and comparison. |

Resource reads are reauthorized each time. Unknown and unauthorized IDs return indistinguishable not-found responses.

### 9.2 Tools

| Tool | Class | Approval |
|---|---|---|
| `twin_search_evidence` | Read | User approval according to MCP client policy; never auto-approved for external MCP clients. |
| `twin_get_entity` | Read | Same as above. |
| `twin_traverse_graph` | Read | Same as above; registered edge enums and H1 traversal limits. |
| `twin_compile_scenario` | Draft | Requires user confirmation before simulation. |
| `twin_run_simulation` | Compute | Confirmed scenario ID only. |
| `twin_preview_jira_remediation` | Draft | No write; exact safe preview. |
| `twin_request_approval` | Workflow | Opens an approval only; cannot choose approvers. |
| `twin_execute_approved_action` | External write | Explicit client approval plus valid server-side two-person execution grant; arguments cannot contain replacement payload. |

All tool inputs and outputs use strict JSON Schema with `additionalProperties: false`, stable limits, side-effect annotations, and schema hashes. Tool names are immutable within v1. An incompatible schema or changed side effect requires a new tool name ending `_v2` and a migration period. Tool results contain resource links and safe summaries, not credentials or bulk source data.

MCP search/list results use the same opaque authorization-bound cursors and maximum page size as REST. Read tools have a 2-second service deadline, graph traversal has its stricter CH-07 limit, and long simulation returns a run resource rather than holding the call open. Per-actor and per-tenant limits mirror or narrow REST limits. Errors expose stable safe codes and retryability. Every resource read, tool proposal, approval, denial, invocation, redaction, and result hash is audited. The execute tool requires an action-level idempotency key and returns the original receipt on replay; no other tool invents side effects through retry.

Remote MCP servers are disabled by default. Enabling one requires server identity verification, exact tool allowlist, egress/data-flow review, approval mode, per-tool data classification, incident owner, and revocation. No model can add an MCP server at runtime.

## 10. Extension and plugin packages

### 10.1 Package manifest

Every `.edtpkg` is a signed archive with a canonical manifest that validates against `contracts/schemas/plugin-manifest.schema.json`. The schema requires exact publisher identity, semantic version and compatibility hashes, content-addressed component descriptors, purpose-bound permissions, default-deny exact-origin egress, server-derived tenant isolation, SBOM/provenance/signature references, and reversible lifecycle behavior.

Components may be a connector manifest, ontology package, bounded agent profile, workflow definition, UI panel, or SDK metadata. Each component has its own normative schema under `contracts/schemas/` and a content hash. The signature bundle is detached over the canonical manifest and component Merkle root; the signature file itself is excluded from that root, avoiding a circular archive signature. Installation verifies publisher signature, transparency/provenance policy, SBOM, malware scan, license policy, compatibility, migrations, permissions, network destinations, resource limits, and fixtures in quarantine.

Plugins are tenant-disabled by default. An administrator reviews the exact diff and permissions. A package cannot request database superuser, RLS bypass, arbitrary network, raw model key, arbitrary filesystem, secret values, tenant selection, or authorization override. UI panels run in a sandboxed origin with a capability bridge and strict Content Security Policy; they receive only explicitly authorized serialized data.

### 10.2 Component contracts

| Component | Mandatory contract |
|---|---|
| Connector | Provider/auth, exact scopes/endpoints, object types, webhooks, cursor, schemas, source precedence, rate policy, tombstones, retention, network allowlist, and separately enumerated mutations as defined in CH-06. |
| Ontology | Namespaced types/edges, JSON Schemas, identity, cardinality, classification, indexing, retention, migration, fixtures, and compatibility rules from CH-05. |
| Agent profile | Purpose, allowed tools, strict output, budgets, memory, handoffs, approval class, termination, eval suite, and prohibited use. It may only narrow installed platform capabilities. |
| Workflow | Typed states/transitions, actor/action policy, timeouts, retries, idempotency, compensation, cancellation, audit events, and version migration. No arbitrary executable expressions. |
| UI panel | Route, capability requests, data schemas, accessibility declaration, bundle integrity, CSP, size/performance budget, and empty/loading/error states. |

Upgrades are staged, migration-tested, and reversible before activation. Disabling stops new invocations immediately. Uninstall preserves governed data until an explicit migrate/archive/delete plan completes. Marketplace publication is H3 Provisional and adds independent security review, publisher verification, vulnerability response SLA, revocation, and tenant impact reporting.

## 11. SDK and CLI contracts

### 11.1 SDKs

H1 freezes independently testable TypeScript and Python client behavior in `contracts/schemas/sdk-contract.schema.json`; distributable generated packages are not part of the demonstrator artifact. A conforming client provides:

- OIDC token callback or server credential interface without persisting secrets by default;
- typed request/response/problem objects with unknown-field tolerance;
- async keyset iterators that preserve cursors;
- idempotency-key generation and original-command lookup;
- ETag/`If-Match` helpers;
- SSE reconnect with `Last-Event-ID` and terminal-state fallback;
- webhook signature verification over raw bytes;
- timeouts, cancellation, structured logging hooks, trace propagation, and safe retry classification;
- access to raw response metadata without weakening type validation.

SDKs never retry a non-idempotent command automatically, choose a tenant from untrusted input, log tokens/bodies, or hide partial results. Generated code is reproducible and versioned with the API contract. Go, Java, C#, Kotlin, Swift, Rust, C++, and native mobile SDKs are Conditional on measured customer demand; they do not block the stable REST contract.

### 11.2 CLI

The public `edt` CLI contract is defined by `contracts/schemas/cli-contract.schema.json` and is implemented as a thin SDK client after its H2 packaging gate. Core commands are `auth login`, `context list|use`, `connector list|sync`, `entity get`, `graph query`, `ask`, `scenario create|confirm`, `simulate`, `approval list|decide`, `action status|execute`, `audit list`, `plugin validate|install`, and `schema pull`. The implemented H1 repository-local `scripts/edt.mjs` utility is deliberately narrower: it starts, seeds, verifies, inspects, stops, or resets the synthetic Compose environment and is not the public administration CLI.

Human output defaults to tables/progress; `--output json` emits only versioned JSON to stdout and diagnostics to stderr. Non-interactive mode requires explicit context and never opens a browser. Tokens use OS credential storage. `--yes` may skip a local confirmation but cannot bypass server policy, reauthentication, user confirmation, or dual approval. Destructive/uninstall operations display resource and tenant context and require explicit command flags.

CLI exit codes distinguish success, validation, authentication, authorization, conflict, rate limit, retryable service failure, cancellation, and internal error. Shell completion never fetches sensitive names without authentication. A `--debug` flag redacts authorization, cookies, source content, webhook secrets, and signed URLs.

## 12. Compatibility, deprecation, and lifecycle

| Surface | Compatible change | Breaking change and policy |
|---|---|---|
| REST/OpenAPI | Add optional response field, operation, or opt-in feature; widen documented non-security limit. | Remove/rename field, change type/meaning/default, make optional input required, narrow accepted enum, or change side effect. Publish `/v2`, migration guide, and at least 12-month H2 support window. |
| JSON Schema | Add optional property while readers tolerate unknown fields; add new schema ID. | Required property, changed constraints/meaning, removed enum. New major schema URI. |
| Errors | Add safe metadata or a new stable error code. | Reuse a code with changed semantics or change retryability. Version operation/major contract. |
| SSE | Add event type or optional field; clients ignore unknown events and reconcile run state. | Change sequence, replay, event meaning, or remove required field. New event schema major. |
| Webhooks/AsyncAPI | Add optional data or new event type. | Change event meaning/type/required data. Dual-publish new major event. |
| GraphQL | Add nullable field/type. | Remove/change field or make nullable non-null. Deprecate for two minors and at least 12 months; use schema major when required. |
| Protobuf | Add new field number or method with safe semantics. | Reuse tag/enum, change wire type/meaning, or remove without reserve. New package major. |
| MCP | Add resource/tool with no implicit access, or optional schema field. | Change tool side effect, required args, output meaning, or approval. New versioned tool name/server major. |
| Plugin | Add optional manifest field or component type understood as unsupported by old hosts. | New required field, permission semantics, migration format, or host API. New manifest/host major. |

Deprecation is announced in documentation, changelog, SDK warnings, `Deprecation` and `Sunset` HTTP headers where applicable, administrator notifications, and usage reports. Security fixes may shorten a window; they require an incident decision, safe replacement, and direct customer notice. Removed identifiers, Protobuf tags, event types, and tool names are never reused.

Clients MUST ignore unknown response object properties and unknown SSE/webhook event types, preserve opaque cursors, and implement unknown enum handling. Servers MUST reject unknown command properties where the schema uses `additionalProperties: false`; silent typo acceptance is forbidden.

## 13. Security, privacy, and operations

Authorization occurs at request entry, service operation, data retrieval, and result serialization. A gateway check alone is insufficient. Policy unavailability fails closed for protected data. Resource existence is concealed on unauthorized reads. Batch operations authorize each item and never return mixed-tenant data.

Input limits cover headers, path/query length, JSON depth, object/array count, strings, regex complexity, decompression, multipart size, and request time. Parsers reject duplicate security-sensitive JSON keys and ambiguous Unicode normalization. Output encoding is context-specific; Markdown/HTML from models or connectors is sanitized before rendering.

Every command emits an audit event with actor, action, resource, policy version, idempotency key hash, outcome, and trace ID. Read auditing is risk-based but mandatory for evidence, exports, audit logs, approval detail, plugin packages, and sensitive graph traversals. Logs contain safe IDs and hashes, not tokens, prompts, source excerpts, or webhook bodies.

Operational metrics include request rate/status/latency by operation, auth failures, policy denials, rate-limit decisions, idempotency replay/conflict, ETag conflict, cursor invalidation, SSE connections/replay gaps, webhook success/retry/dead letters, contract-version usage, SDK versions, GraphQL cost if enabled, MCP approvals/denials, and plugin health. High-cardinality tenant and actor IDs are hashed or mapped through controlled exemplars.

## 14. Verification and acceptance

| ID | Acceptance criterion |
|---|---|
| AC-DOC-001 | OpenAPI, AsyncAPI, JSON Schemas, MCP manifest, GraphQL SDL, Protobuf, frontmatter, and examples parse and lint cleanly. |
| AC-TEN-001 | Contract tests derive tenant context and reject mismatched assertions, guessed IDs, cross-tenant cursors, unauthorized batches, graph/MCP bypasses, and existence leaks. |
| AC-DATA-001 | Same-key/same-body command replay returns the original result, different-body reuse returns `409`, and randomized duplicate event delivery converges. |
| AC-CON-001 | H1 inbound webhook tests verify authentication, raw-byte integrity where applicable, expiry/replay, duplicates, retries, and reconciliation; the H2 outbound gate additionally requires signature rotation, redelivery, SSRF/DNS rebinding defense, and delivery reconciliation. |
| AC-ACT-002 | Ambiguous and concurrent execution requests remain queryable and create exactly one Jira effect and one receipt. |
| AC-PHY-001 | Physical-twin contract tests reproduce seeded telemetry and analytics, conceal cross-tenant asset IDs, reject unsafe/stale/mutated/replayed-conflicting previews, produce one simulator transition for a valid command, and prove zero device egress. |
| AC-SUP-001 | Generated SDKs and signed plugins include SBOM/provenance, pass conformance/scanning, never retry unsafe commands, and fail malicious packages before installation. |
| AC-REL-001 | H1 non-AI API load meets the 2-second p95 target and SSE/webhook connection budgets without bypassing policy or rate limits. |
| AC-OBS-001 | REST, SSE, webhook, MCP, workflow, and external action activity correlates through one redacted trace/audit path. |

Additional conformance checks prove pagination has no duplicate/omitted fixture rows at a fixed watermark, rejects altered cursors, and invalidates on permission change; SSE reconnects exactly after `Last-Event-ID`; MCP rejects tenant, SQL, Cypher, URL, replacement payload, and undeclared arguments; and compatibility CI blocks every unversioned breaking change. Testing includes unit schema tests, generated client/server contracts, authentication/authorization matrices, cursor/idempotency properties, fuzzing of JSON/headers/URLs/signatures/SSE/Protobuf/packages, provider replay, load/soak, and dependency chaos. Documentation examples execute against the reference server in CI.

## 15. Risks and evolution

| ID | Risk | Mitigation |
|---|---|---|
| RSK-001 | A public, GraphQL, gRPC, MCP, SDK, or plugin interface leaks another tenant. | Server-derived context, no tenant selectors, central policy, bounded templates, output reauthorization, and adversarial two-tenant conformance. |
| RSK-002 | A pooled Neo4j query exposed through REST, GraphQL, or MCP omits tenant isolation. | Tenant-qualified persisted templates, no generic graph query, central limits, result reauthorization, and a dedicated-database/cell trigger. |
| RSK-013 | Idempotency is mistaken for external-provider atomicity. | Command ledger, source revalidation, post-write verification, ambiguous state, original receipt, and compensation. |
| RSK-004 | MCP or plugin content causes tool misuse or data exfiltration. | Strict schemas, approval, signed/quarantined packages, capability permissions, egress allowlist, sandboxing, and adversarial tests. |
| RSK-009 | Interface generations amplify the platform's four-runtime operational complexity. | REST primary contract, shared schemas, deterministic generation, bounded supported majors, telemetry, and release-blocking conformance. |
| RSK-018 | Webhook/event backlog or exactly-once assumptions create stale state. | At-least-once contract, IDs/versions, dedup, backpressure, dead letter, retry, and reconciliation. |

H1 commits REST, SSE, authenticated provider webhook ingress, logical AsyncAPI events, the constrained MCP facade, TypeScript/Python SDK and CLI conformance contracts, and package validation. Distributable public SDK/CLI packages, H2 outbound platform webhooks and read-only GraphQL, H3 gRPC extraction, marketplace distribution, and additional native SDKs are Provisional and require usage, security, performance, and support evidence before activation.
