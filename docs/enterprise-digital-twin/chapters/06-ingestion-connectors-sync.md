---
id: CH-06
title: Ingestion, Connectors, and Synchronization
status: Committed
version: 1.0.0
owners:
  - Connector Platform
  - Data Platform
last_reviewed: 2026-07-13
---

# Ingestion, Connectors, and Synchronization

## 1. Purpose and boundaries

This chapter defines the connector runtime and the complete H1 GitHub and Jira synchronization contract. Connectors collect authorized source observations; they do not decide canonical truth, merge identities, grant permissions, or let model output reach an external API directly.

H1 is deliberately narrow: GitHub metadata is read-only, Jira is read-only except for one field-limited remediation update in an allowlisted sandbox project, and all organizations and records are synthetic. H2 generalizes the framework but does not automatically enable additional connector writes.

| ID | Requirement |
|---|---|
| REQ-CON-001 | H1 GitHub access MUST be read-only metadata for allowlisted sandbox repositories and exclude source bodies, secrets, logs, and private messages. |
| REQ-CON-002 | H1 Jira access MUST be restricted to allowlisted projects and the exact approved remediation issue mutation. |
| REQ-CON-003 | Connectors MUST verify webhooks, reconcile periodically, checkpoint cursors, deduplicate events, and preserve tombstones. |
| REQ-CON-004 | Connector execution MUST isolate credentials, egress, parsing, quotas, and tenant effects and support immediate revocation. |
| REQ-CON-005 | The connector SDK MUST define manifests, authentication, discovery, backfill, incremental sync, writes, errors, telemetry, tests, and certification. |
| REQ-ACT-001 | Approval MUST bind tenant, actor, credential, target, canonical arguments, expiry, policy version, and idempotency key. |
| REQ-ACT-002 | The H1 mutation MUST require two distinct authenticated approvers; the requester cannot satisfy the second approval. |
| REQ-ACT-003 | The Jira action MUST record before/after state and provide authorized idempotent compensation. |
| QAR-SYNC-001 | H1 source freshness MUST be no more than 15 minutes at p95 while providers are healthy. |
| QAR-COR-001 | Duplicate, reordered, or replayed delivery MUST converge to the same state without duplicate effects. |
| QAR-SEC-003 | Payload change or replay MUST be denied or return the original receipt without another write. |

Valid webhook ingress is acknowledged within 2 seconds at p95 after durable enqueue. A restarted connector resumes from its last committed cursor without duplicating canonical state.

## 2. Connector execution model

Each installation is a tenant-scoped state machine:

`requested -> authorizing -> validating -> initial_sync -> active -> degraded -> suspended -> revoking -> revoked`

Only `active` and `degraded` installations schedule reads. A credential failure moves to `suspended`; no silent fallback to a broader credential is allowed. Revocation invalidates the secret, disables new work, establishes an immediate authorization deny barrier, unregisters webhooks where possible, and starts retention/deletion policy.

Temporal owns the durable workflows:

- `InstallConnectorWorkflow`: exchange credentials, validate identity and scopes, register webhooks, and start initial sync.
- `WebhookDispatchWorkflow`: deduplicate a durable notification, fetch authoritative source objects, normalize, and checkpoint.
- `ReconcileConnectorWorkflow`: enumerate provider state, compare manifests, fetch differences, confirm tombstones, and update cursors.
- `RefreshCredentialWorkflow`: rotate short-lived tokens and refresh OAuth grants without exposing token material to activities.
- `RefreshWebhookWorkflow`: renew expiring registrations and verify delivery health.
- `RevokeConnectorWorkflow`: deny access, stop schedules, unregister hooks, purge credentials, and initiate deletion.
- `ExecuteJiraRemediationWorkflow`: revalidate approval and source version, apply one update, record receipt, and compensate on request.

Activities use bounded retries with provider-specific backoff and jitter. Authentication, authorization, schema validation, and permanent 4xx errors are non-retryable. Rate limit and 5xx errors are retryable until the workflow deadline. Each activity heartbeat contains a cursor, not credentials or source content.

## 3. Common connector contract

### 3.1 Manifest

Every connector package validates against `contracts/schemas/connector-manifest.schema.json`. The manifest and all referenced package artifacts are closed, versioned contracts; a connector cannot declare a generic `read`, `write`, hostname, or schema string and defer its meaning to code.

| Field | Required contract |
|---|---|
| `schema_version`, `id`, `version` | Manifest-schema major, stable reverse-DNS connector ID, and semantic package version. H1 IDs are `com.enterprise-digital-twin.connector.github` and `com.enterprise-digital-twin.connector.jira-cloud`. |
| `publisher` | Stable publisher ID and display name, owning team, support URI, and monitored security contact. |
| `provider`, `deployment` | Provider ID plus an allowlist of supported provider variants; H1 permits only `github_cloud` or `jira_cloud`. Runtime mode, OCI image digest, minimum worker version, and installation isolation are explicit. |
| `auth` | Exact authentication type, required provider permissions/scopes with access level, credential lifetime/refresh behavior, and secret-storage class. The runtime rejects an installed grant whose effective permission set is missing a required scope or includes a forbidden scope. |
| `capabilities.reads[]` | One entry per provider resource with its stable resource name, allowed operations from `discover`, `backfill`, `incremental`, `reconcile`, and `acl_sync`, pagination mode, deletion behavior, and required auth permission. |
| `capabilities.events[]` | One entry per accepted provider event with delivery-ID source, verification profile, maximum body size, whether it is authoritative, and the authenticated reconciliation resource it can enqueue. H1 events are never authoritative. |
| `capabilities.mutations[]` | One entry per externally mutating command with target resource, exact operation, default-enabled flag, approval class, idempotency class, and compensation command. GitHub supplies an empty array; Jira supplies only `jira_issue_remediation_v1`, disabled by default outside the allowlisted H1 sandbox installation. |
| `schemas` | Content-addressed references for raw envelope, bounded raw payload, normalized observation, cursor, and ontology-mapping JSON Schemas. Each reference contains a package-relative URI, stable `$id`, semantic schema version, and lowercase SHA-256 of RFC 8785 canonical JSON bytes. |
| `rate_limits` | Named provider buckets, quota scope, maximum per-installation concurrency, fairness weight, request timeout, retry classes, and bounded backoff policy. |
| `cursor` | Referenced cursor schema plus commit granularity, overlap/lookback policy, supported reset modes, reset authorization class, and last-good-checkpoint behavior. Arbitrary caller-provided cursors are prohibited. |
| `data_policy` | Included/excluded provider fields, classifications, raw and normalized retention classes, payload/depth/string/decompression limits, redaction policy, untrusted-content flag, and prohibition on training use. |
| `network_policy` | Closed HTTPS egress rules containing exact host, port, and path-prefix allowlists; minimum TLS version; DNS revalidation; private/link-local/metadata address denial; redirect count; response-size limit; and connect/read deadline. Wildcards, IP literals, alternate ports, and manifest-controlled proxies are prohibited in H1. |
| `health` | Typed credential, webhook, freshness, quota, and reconciliation checks with interval, timeout, failure threshold, degraded/suspended transition, and safe diagnostic code. |
| `support` | Compatibility range, deprecation state/sunset, owning service, runbook URI, and security escalation. |

Package references are normalized relative paths beneath their connector directory: absolute URIs, `..`, symlinks escaping the package, a missing artifact, an unexpected artifact, an `$id` mismatch, or a digest mismatch fails build and installation. The schema permits additive provider fields only inside the bounded untrusted `payload` member of a raw envelope. Normalized observations, cursors, mapping declarations, and the manifest itself reject unknown fields. Mapping declarations contain only registered source JSON Pointers, ontology types/predicates, allowlisted transform IDs, classification, authority, and ACL behavior; expressions, scripts, templates, network locations, and model prompts are invalid.

The normative H1 packages are:

| Package | Required machine-readable instances |
|---|---|
| `contracts/connectors/github/` | `manifest.json`, `schemas/raw-envelope.schema.json`, `schemas/raw-payload.schema.json`, `schemas/normalized-observation.schema.json`, `schemas/cursor.schema.json`, and `schemas/ontology-mapping.schema.json`. The manifest enumerates exactly the permissions, resources, events, reconciliation fetches, exclusions, and empty mutation set in Section 4. |
| `contracts/connectors/jira-cloud/` | The same six files. The manifest enumerates exactly the scopes, resources, events, endpoints, field exclusions, and sole remediation/compensation commands in Sections 5 and 8. |

Each package is tested against positive and negative raw fixtures and at least one concrete mapping fixture. CI validates both manifests against the shared manifest schema, resolves and rehashes every referenced schema, validates mapping fixtures, confirms the capability lists equal the chapter allowlists, and proves that no H1 mutation or egress target exists only in implementation code. Package version changes follow semantic compatibility: changing a permission, event identity, normalized meaning, cursor interpretation, mapping meaning, egress destination, mutation, redaction, or deletion behavior is breaking unless the old behavior remains independently selectable through the declared compatibility window.

Connector code runs in a network-restricted worker with no model credentials, database superuser role, tenant-selection input, or direct Neo4j access. Its egress is limited to the manifest host allowlist and object storage through a scoped service identity. Parser limits include 10 MiB per JSON payload in H1, maximum nesting depth 64, maximum string length 1 MiB, decompression ratio 20:1, and a 30-second parse deadline. Oversized or invalid objects are quarantined with hashes and metadata, not logged.

### 3.2 Ingest envelope and idempotency

The immutable envelope contains:

```json
{
  "schema_version": "1.0",
  "tenant_id": "server-derived UUID",
  "installation_id": "UUID",
  "provider": "github|jira",
  "delivery_id": "provider delivery ID or generated poll ID",
  "event_type": "string",
  "external_object_id": "string",
  "external_version": "provider version or canonical content hash",
  "observed_at": "RFC3339 timestamp",
  "source_updated_at": "RFC3339 timestamp or null",
  "payload_sha256": "lowercase hex",
  "payload_object_uri": "opaque object reference",
  "ingest_run_id": "UUID"
}
```

The ingress transaction inserts a receipt with unique `(tenant_id,installation_id,provider,delivery_id)` and an outbox event. A duplicate with the same hash returns success without new work. Reuse of a delivery ID with a different hash is quarantined and alerted. Poll observations deduplicate on source key plus `external_version`; when no provider version exists, the connector hashes a canonical JSON representation after removing volatile transport fields.

Normalization is a pure, versioned function from immutable envelope to `NormalizedObservation[]`. Each observation carries source key, ontology candidate type, attributes, relationships, source ACL, effective time, source locator, parser version, and warnings. Retrying normalization produces byte-identical canonical JSON. Invalid optional fields become warnings; invalid identity, tenant, timestamp, or authorization fields quarantine the observation.

## 4. GitHub App contract

### 4.1 Permissions and endpoint allowlist

H1 uses a GitHub App installation token. No user OAuth token or personal access token is accepted. The app requests only these permissions:

| Scope | Level | H1 use |
|---|---|---|
| Repository metadata | Read | Installation, repository identity, visibility, and topics. GitHub grants metadata read access to installed repositories. |
| Contents | Read | Commit, branch, and comparison metadata. The application endpoint policy forbids fetching file blobs or repository archives. |
| Pull requests | Read | Pull request metadata, reviews, requested reviewers, and merge state. |
| Actions | Read | Workflow and workflow-run metadata. Workflow file contents are not fetched. |
| Checks | Read | Check suite and check run names, status, conclusion, and timestamps. |
| Deployments | Read | Deployment and deployment-status metadata. |
| Members | Organization read | Organization member and team identity needed for synthetic organization resolution. |

The API client allowlist is limited to installation repositories; repository metadata; branches, commits, comparisons; pull requests and reviews; Actions workflows/runs/jobs; checks; deployments/statuses; organization members; and teams. Calls to contents blobs, archives, source tarballs, secrets, variables, administration, billing, email, and security-alert bodies are blocked even if an upstream permission could permit them. The customer may install the app on selected repositories only.

GitHub documents that app permissions determine both API access and subscribable webhooks and recommends the minimum permissions required. See [Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).

### 4.2 Events and validation

Subscribed events are `installation`, `installation_repositories`, `repository`, `push`, `pull_request`, `pull_request_review`, `workflow_run`, `check_run`, `deployment`, `deployment_status`, `membership`, and `team`. Events not on this list are rejected before payload parsing.

Ingress preserves the exact request bytes, validates `X-Hub-Signature-256` using HMAC-SHA256 and a constant-time comparison, and requires a syntactically valid `X-GitHub-Delivery` UUID. A GitHub App uses one app/environment-bound webhook route; after signature verification, the payload's installation ID must map server-side to exactly one enabled tenant connector installation for that app registration. No tenant or installation supplied in a query, header, or unsigned route segment participates in the mapping. The delivery ledger rejects altered ID reuse and deduplicates replay. The signature is checked before JSON parsing. GitHub notes that deliveries can arrive out of order and that `X-Hub-Signature-256` is the verification header; see [Troubleshooting webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/troubleshooting-webhooks).

A valid installation lifecycle event may arrive before its setup callback has completed. In that case the app-level ingress stores only delivery ID, body hash, event type, app registration, GitHub installation ID, and receipt time in a short-lived global setup ledger; it discards the unbound body after signature validation and performs no normalization or tenant write. `InstallConnectorWorkflow` proceeds only after its server-held setup state and an authenticated GitHub installation lookup bind that installation ID to one tenant, then performs reconciliation rather than replaying the discarded body. Unclaimed metadata expires after 24 hours and is security-audited without source payload content.

Webhook effects are minimal:

- installation changes trigger scope and repository reconciliation;
- a push enqueues its repository and referenced commit range;
- a pull request, review, check, workflow, or deployment event enqueues the referenced object for authenticated GET;
- member/team changes enqueue organization identity reconciliation;
- deletion/uninstallation installs an immediate deny barrier before cleanup.

No canonical claim is created solely from a webhook body.

### 4.3 GitHub reconciliation and cursors

Initial sync enumerates installation repositories, then in stable repository-ID order fetches repository metadata, branches, commits within the configured H1 lookback, open and recently updated pull requests, reviews, checks, workflow runs, deployments, and team/member references. H1 lookback is 180 days; older metadata is fetched only when referenced by an in-window object.

The versioned cursor contains repository ID, collection kind, provider page token or last stable tuple `(updated_at,id)`, lookback lower bound, and manifest generation. A cursor is committed in the same PostgreSQL transaction as normalized observations and outbox events. Pages are processed with overlap: the next run rereads the final 10 minutes and deduplicates by external version. REST conditional requests use ETag where supplied, but a `304` never substitutes for scheduled deletion and permission reconciliation.

Every 15 minutes the worker reconciles repository selection and objects changed since the prior watermark. Every 24 hours it performs a bounded manifest scan. A full weekly scan verifies counts and samples content hashes. Rate-limit headers control per-installation concurrency; security revocations and webhook repair take priority over historical backfill.

## 5. Jira Cloud OAuth contract

### 5.1 Scopes and endpoints

H1 uses the server-side OAuth 2.0 authorization code flow, a confidential client secret, high-entropy state, an exact registered redirect URI, rotating refresh tokens, and the classic scopes below. Atlassian documents the authorization-code exchange, required state, exact redirect URI, and rotating refresh-token behavior in its [OAuth 2.0 (3LO) guide](https://developer.atlassian.com/cloud/oauth/getting-started/implementing-oauth-3lo/).

- `read:jira-work` for project, issue, status, sprint, version, comment metadata, and JQL search;
- `read:jira-user` for accessible user profiles used in tenant-local identity resolution;
- `write:jira-work` solely for the allowlisted remediation update in Section 8;
- `manage:jira-webhook` to create, list, refresh, and remove dynamic webhooks;
- `offline_access` to maintain synchronization without a browser session.

Atlassian recommends classic scopes where available and documents that Jira permissions still constrain the authorized user's access. See [Jira OAuth scopes](https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/). `manage:jira-project`, `manage:jira-configuration`, admin, service-management write, and granular scopes are not requested.

Read calls are limited to accessible resources, self, fields, project search, JQL issue search, issue metadata, bounded issue changelog needed for synchronization/action verification, statuses, versions, sprints, and comments. Attachments are represented by metadata only and are not downloaded in H1. Write calls are denied except `PUT /rest/api/3/issue/{issueIdOrKey}` from the approved remediation workflow and dynamic webhook lifecycle endpoints.

The installation stores Atlassian `cloudId`, authorized account ID, consented scopes, refresh-token generation, sandbox project IDs, and encrypted secret reference. The callback rejects missing/mismatched OAuth state, an unexpected callback route, or a previously consumed code. The server exchanges the one-time code only at the configured Atlassian token endpoint using its confidential client authentication and the exact registered redirect URI. After exchange, it enumerates accessible resources and rejects a `cloudId` or account binding that differs from the pending installation.

Refresh-token use is single-flight per installation under a workflow plus row lock. The activity atomically stores the newly returned access token expiry, rotated refresh-token secret reference, and incremented credential generation before releasing the lease. A stale generation cannot overwrite a newer token. Crash recovery reads the latest committed generation and never fans out concurrent refreshes; repeated invalid-grant failure suspends the installation and requires reauthorization.

### 5.2 Webhooks

The connector registers one dynamic issue webhook per installation with JQL `project IN (ALLOWLIST)` and events `jira:issue_created`, `jira:issue_updated`, and `jira:issue_deleted`. A second webhook for comments is enabled only if comments are included in the tenant's H1 demo data. Dynamic registrations expire after 30 days, so the refresh workflow renews them on day 20 and verifies them daily. Atlassian documents the expiration and refresh endpoint in [Jira webhook REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-webhooks/).

For OAuth 2.0 app webhooks, ingress validates the bearer token signature and claims against the app client secret and expected tenant binding, validates that `matchedWebhookIds` belongs to the installation, and deduplicates on `X-Atlassian-Webhook-Identifier`. The provider identifier is stable across retries. The handler acknowledges only after durable receipt and schedules an authenticated GET; Jira's duplicate and retry behavior is documented in [Jira webhooks](https://developer.atlassian.com/cloud/jira/software/webhooks/).

Webhook callback URLs contain an additional random, installation-bound path token. This token is defense in depth and does not replace bearer validation. Unknown project, issue, webhook ID, issuer, cloud ID, or event type is rejected and audited.

### 5.3 Jira reconciliation and cursors

Initial sync discovers allowlisted projects and fields, then uses ordered JQL:

```text
project IN (ALLOWLIST) ORDER BY updated ASC, id ASC
```

Subsequent incremental scans add a lower-bound `updated >= watermark_minus_10_minutes`. The cursor stores the last `(updated,id)`, field schema hash, JQL version, page token, and lookback. The overlap prevents loss at timestamp boundaries; the source key and canonical content hash prevent duplicates. Issue fetches explicitly request only configured fields: key, project, type, summary, description when enabled, status, resolution, priority, labels, assignee, reporter, parent, subtasks, links, sprint, fix versions, due date, created, updated, and comments when enabled.

Every 15 minutes incremental reconciliation validates changes. Daily reconciliation enumerates projects, fields, statuses, and webhooks. Weekly full reconciliation enumerates all in-scope issue IDs and confirms tombstones. The connector respects `Retry-After`, caps per-installation concurrency, and stores provider request IDs without response content.

## 6. Source precedence and normalization

| Canonical concern | Authority and conflict rule |
|---|---|
| Jira issue/project fields | Jira is authoritative for issue status, dates, assignee reference, dependencies represented as issue links, sprint, version, and project membership. |
| GitHub engineering activity | GitHub is authoritative for repository, commit, pull request, review, check, workflow-run, and deployment metadata. |
| Cross-system project/repository link | Governed manual mapping first; exact configured key second; explicit source link third; inferred text mention remains a low-confidence candidate. |
| Person identity | Administrator/SCIM link first, exact provider account link second, tenant-verified work email third, review-required candidate last. Display name never auto-merges. |
| Dates that disagree | Preserve both claims; the domain predicate's registered authority selects the canonical view and exposes the conflict. |

All provider text is untrusted. HTML and Atlassian document format are parsed with allowlisted nodes, links are normalized without fetching them, mentions become references rather than instructions, control characters are removed, and rendered output is escaped by the client. Normalization never executes macros, templates, embedded objects, URLs, or code.

## 7. Tombstones, permission loss, and replay

A delete webhook creates a provisional tombstone and deny barrier, then an authenticated GET confirms deletion. `404` is interpreted using installation scope: if repository/project access also disappeared, the object becomes `inaccessible`; if scope remains and the provider confirms absence, it becomes `deleted`. `403` never proves deletion.

During a full manifest scan, an object missing once is `suspect_missing`; missing in two independent successful scans at least 15 minutes apart is `tombstoned`, unless the provider offers a definitive deletion marker. A later reappearance creates a new source version and closes the tombstone; it does not erase history.

Permission loss is handled before content cleanup. The policy service receives an installation/ACL version increment, cached reads are invalidated, and inaccessible evidence is denied immediately. The retention workflow then archives or deletes payloads according to tenant policy. Replaying an ingest run is allowed only from immutable envelopes into a new parser/projection generation and must not re-enable tombstoned access.

## 8. H1 Jira remediation command

The only external mutation is `jira.issue.update` against an existing issue in an administrator-configured sandbox project. It may replace exactly three fields: `labels`, `duedate`, and `priority`. No transition, assignee, description, comment, attachment, issue creation, or deletion is permitted. For the frozen H1 workload, the only target is synthetic issue `AST-142` in project `AST` for tenant `10000000-0000-4000-8000-000000000001` (`tnt_aster`) through connector installation `30000000-0000-4000-8000-000000000001` (`con_aster_jira`).

### 8.1 Preview

The preview service performs an authenticated GET and captures this frozen H1 before snapshot:

```json
{
  "issueKey": "AST-142",
  "version": 7,
  "fields": {
    "duedate": "2026-08-07",
    "priority": {"id": "3", "name": "Medium"},
    "labels": ["identity", "orion"]
  }
}
```

The exact canonical approved payload is:

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

`tenantId` is inserted from server context into the internal approved payload; it is never accepted from the public preview request. Labels are sorted and deduplicated, existing labels remain, and `digital-twin-remediation` is the only system-added label. Priority IDs and due dates are validated against the current Jira field metadata and tenant action policy. The preview also binds reason, evidence IDs, scenario ID, policy version, credential generation, required roles, expiry, rollback fields, stable action-level idempotency key, and the SHA-256 of RFC 8785 canonical payload JSON. It is immutable. Any field, target, connector, source version, credential, policy, tenant, idempotency key, or digest change invalidates all approvals.

### 8.2 Approval and execution

Two distinct active human actors approve the exact digest within 15 minutes: one with the operations approver role and one with the security approver role. Self-approval, duplicate actors, delegated bot approval, expiry, or role revocation fails closed. Execution locks the command row, verifies the idempotency key, both role-distinct approvals, current connector, tenant, and project allowlist, then refetches the issue and its current change watermark. If version is not `7` or `labels`, `duedate`, or `priority` differ from the before snapshot, it returns `409 source_changed` and requires a new preview.

The stable idempotency key is derived from tenant, action, connector, issue key, expected version, and canonical payload hash. Jira's documented edit operation accepts field updates and can return a conflict, but this design does not assume an undocumented atomic compare-and-swap contract; see the [Jira edit issue operation](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-put). The connector records `send_started` durably before handing one field-limited `PUT` to the network and never sends a second `PUT` for that command. It immediately refetches the issue and relevant change history, then records provider request ID when available, exact payload, before/after snapshot, observed result, actor IDs, approval IDs, policy version, and audit event. Concurrent callers return the ledger state or original receipt. A provider conflict produces `source_changed`; an overlapping same-field edit or timeout without conclusive history enters `verification_required`/`concurrent_change_detected`, pages an operator, and never blind-retries or auto-rolls back. This provides application-level idempotency and at-most-one send, while making the residual external race explicit.

### 8.3 Compensation

Rollback is a new dual-approved command linked to the receipt. It is allowed only within 24 hours and only when the current issue version and `labels`, `duedate`, and `priority` exactly match the recorded after snapshot. It restores all three recorded before values and verifies them. Divergence produces `409 compensation_conflict` for manual resolution; the system never overwrites later human work. A successful retry returns the original compensation receipt. A failed or partial compensation retains both snapshots and pages an operator.

## 9. Consistency, failure handling, and operations

| Failure | Behavior |
|---|---|
| Webhook invalid or oversized | Reject before enqueue, record hashed security metadata, and never log the body. |
| Provider 401 | Refresh once when safe; on failure suspend installation and notify an administrator. |
| Provider 403 | Re-evaluate scopes and source ACL; do not treat as deletion or retry indefinitely. |
| Provider 404 | Confirm installation scope and object identity before a tombstone. |
| Provider 429 | Honor `Retry-After`, reduce concurrency, preserve cursor, and prioritize revocations. |
| Provider 5xx/network failure | Exponential backoff with jitter and workflow deadline; surface stale watermark. |
| Cursor corrupt/incompatible | Stop that stream, retain last good checkpoint, and start a reviewed bounded rescan. |
| Parser regression | Quarantine the new observation; keep last valid canonical version and allow generation rollback. |
| Database/object storage unavailable | Do not acknowledge new webhooks until durable receipt is possible; provider retries or reconciliation recovers. |
| Revoked credential mid-page | Abort the page, deny reads immediately, and never commit a partial cursor. |

Metrics include delivery acceptance/rejection, deduplication ratio, webhook age, provider request latency/status, rate-limit remaining, token-refresh failures, cursor age, objects scanned/changed/quarantined/tombstoned, reconciliation drift, parse duration, outbox lag, freshness by tenant, and action/compensation outcomes. Alerts fire for p95 freshness over 15 minutes for two intervals, webhook refresh inside five days of expiry, reconciliation drift, repeated signature failure, credential suspension, and any ambiguous external write.

Logs and traces include hashed tenant and installation IDs, provider request ID, ingest run, activity attempt, cursor version, and payload hash. They exclude OAuth codes, tokens, webhook secrets, raw bodies, issue descriptions, user emails, and source excerpts.

## 10. Testing and acceptance

| ID | Acceptance criterion |
|---|---|
| AC-CON-001 | Invalid, expired-token, replayed, altered, unmapped/wrong-installation, and wrong-tenant GitHub/Jira webhooks are denied or idempotently deduplicated as appropriate and audited; no GitHub write permission or non-allowlisted route is available. |
| AC-CON-002 | Missed webhook, partial page, process termination, and stale cursor recover through reconciliation without loss or duplicate canonical state. |
| AC-DATA-001 | Duplicate and randomly ordered webhooks plus overlapping polls produce byte-identical normalized observations and canonical checksums. |
| AC-ACT-001 | One approver, duplicate actor, expired approval, changed payload/version, revoked role, wrong project, altered field, or reused key causes zero Jira writes. |
| AC-ACT-002 | Two valid role-distinct approvals plus concurrent execution requests produce exactly one Jira field update and the same durable receipt. |
| AC-ACT-003 | Ambiguous timeout triggers verification; conflict-free compensation restores due date, priority, and labels, while later human edits prevent overwrite. |
| AC-REL-001 | H1 synthetic load meets 15-minute freshness and the committed end-to-end latency envelope while respecting provider rate limits. |

Tests use provider contract fixtures plus record/replay suites with secrets removed. Fuzzing covers JSON, Unicode, Atlassian document format, headers, pagination tokens, and timestamps. Chaos tests inject rate limits, expired tokens, webhook gaps, duplicate pages, clock skew, worker termination, network partitions, provider 5xx responses, and object-store failures. A nightly reconciliation oracle compares provider fixtures with canonical source manifests.

## 11. Risks and evolution

| ID | Risk | Mitigation |
|---|---|---|
| RSK-005 | Connector credential compromise or provider scopes broader than the H1 endpoint subset. | Tenant keys, exact scopes, local endpoint/egress allowlist, isolated workers, rotation, revocation, and audited calls. |
| RSK-006 | Approval confused deputy or payload substitution. | Canonical exact payload, role-distinct approvers, 15-minute expiry, policy/source recheck, and immutable arguments. |
| RSK-013 | Jira timeout or replay creates a duplicate external action. | Durable idempotency ledger, source refetch, provider correlation, ambiguous-state verification, receipt, and compensation. |
| RSK-018 | Webhook/backfill backlog causes stale data. | Fair priority queues, separate historical concurrency, freshness metrics, cursor replay, backpressure, and reconciliation. |
| RSK-003 | Compromised or stale source ACL data leaks through derived claims. | Immediate deny barrier, immutable evidence, quarantine, deterministic normalization, conflict preservation, and rapid credential revocation. |

Additional connectors use this contract only after a connector-specific threat model, exact permission list, source precedence, deletion semantics, provider rate model, fixtures, and mutation review are committed. H2 connector reads are Committed by domain need; every new external mutation remains separately gated and disabled by default.
