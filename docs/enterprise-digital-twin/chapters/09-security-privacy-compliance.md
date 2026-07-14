---
id: CH-09
title: Security, Privacy, and Compliance
status: Committed
version: 1.0.0
owners:
  - Security Engineering
  - Privacy Engineering
  - Platform Engineering
last_reviewed: 2026-07-13
---

# Security, Privacy, and Compliance

## 1. Security objective and limits

The security objective is to preserve tenant isolation, source permissions, evidence integrity, human control of external changes, and recoverable audit evidence even when a user, connector payload, model response, network peer, or dependency is malicious or faulty.

H1 and H2 are designed for SOC 2 and ISO 27001 control evidence and GDPR engineering readiness. This specification does not claim certification, legal compliance, or fitness for regulated health, government classified, financial trading, or employment-decision processing. Certification, legal basis, contracts, policies, training, and organizational controls remain the responsibility of named business, legal, privacy, and security owners.

The following use cases are prohibited through H4: individual productivity scoring; burnout, attrition, emotion, health, misconduct, hiring, termination, compensation, or performance prediction; covert employee surveillance; and automated employment decisions. A future research proposal cannot lift this prohibition without a separate legal basis, data protection impact assessment, worker consultation, ethics review, security design, and explicit product-governance approval.

## 2. Security principles

| Catalog control | Principle | Enforced behavior |
|---|---|---|
| CTRL-IAM-002 | Server-derived tenant authority | Membership and tenant context come from verified identity plus authoritative membership, never request headers, model output, connector content, or cache data |
| CTRL-IAM-003 | Default deny | Missing identity, membership, policy input, ACL, key, scope, projection watermark, or approval causes denial |
| CTRL-IAM-003 and CTRL-CON-001 | Least privilege | Users, workloads, connectors, agents, database roles, and CI jobs receive only required actions and tenant resources |
| CTRL-ACT-002 | Separation of duties | Proposal, two-person approval, execution, security administration, and audit have distinct permissions |
| CTRL-IAM-003 | Complete mediation | Authorization is checked when data is retrieved, when a proposal is created, when each approval is accepted, and immediately before execution |
| CTRL-DAT-002 | Projection-safe revocation | Revocation blocks reads until every participating projection and cache meets the revocation watermark |
| CTRL-AI-001 | Untrusted content | Provider text and model output are data, never authority or instructions |
| CTRL-PRV-001 and CTRL-DAT-003 | Minimized persistence | Store only required content, avoid raw content in logs/workflow history, and enforce tenant retention and deletion |
| CTRL-ACT-001 | Verifiable change | Sensitive commands bind approvals to one canonical payload, target, version, expiry, and tenant |
| CTRL-AUD-001 | Recoverable evidence | Security and action events are append-only, integrity checked, access controlled, and exported to independent retention |

## 3. Data classification and handling

| Class | Examples | Storage and transport | Logging and model handling |
|---|---|---|---|
| Public | Published product documentation and explicitly public tenant material | TLS; normal encrypted storage | May be logged only when operationally useful |
| Internal | Configuration metadata, non-sensitive synthetic demo data | TLS 1.2 or later; encrypted storage | No full payload in telemetry; allowed to approved model endpoint |
| Confidential | Source content, organization graph, tickets, identities, forecasts | Tenant-isolated encrypted storage; scoped workload access | Redacted logs; only authorized evidence sent to approved model capability |
| Restricted | Secrets, OAuth tokens, approval grants, audit integrity keys, security incidents, legal hold data | External secret manager/KMS, envelope encryption, no browser exposure | Never placed in prompts, traces, metrics, workflow search attributes, or support bundles |

Classification is inherited from the source and can only become more restrictive. A derived fact that requires multiple inputs receives an effective audience no broader than the intersection of the audiences required to support it. A result containing confidential data is actor-bound and cannot be cached for a different actor unless the cache key contains an immutable ACL digest and policy version.

## 4. Identity, sessions, and workload trust

### 4.1 Human authentication

- Production authentication is delegated to a tenant-approved OIDC identity provider. H2 supports SAML through an identity broker and SCIM 2.0 provisioning.
- The API validates issuer, signature, audience, authorized party where present, nonce, state, expiry, not-before, and algorithm allowlist. It rejects tokens from dynamically supplied issuers or key URLs.
- A stable actor key is issuer plus subject. Email, display name, or provider username is not identity.
- Interactive sessions use Secure, HttpOnly, SameSite=Lax cookies; state-changing browser calls require same-origin checks and an anti-CSRF token. Session rotation follows login, privilege change, and recovery.
- MFA and phishing-resistant authentication are IdP policy. Tenant and platform administrators, approvers, and break-glass operators must use MFA; H2 requires a tenant assertion or documented IdP policy evidence.
- SCIM disablement immediately invalidates membership, delegation, sessions, and cached authorization. Reconciliation detects missed deprovisioning.
- Recovery and support cannot bypass the IdP. Impersonation is disabled in H1/H2. A future support-view feature must be read-only, time-bound, customer-approved, visibly bannered, and separately audited.

### 4.2 Service and job identities

- Kubernetes workloads use separate service accounts and short-lived workload identity. Local Compose uses unique development-only credentials.
- Each workload has a separate PostgreSQL role, object-store policy, Temporal namespace/task-queue permission, Neo4j credential, and model gateway capability.
- A service identity does not imply a tenant. Each job carries a signed immutable context naming one tenant, purpose, workflow ID, actor or system principal, delegation, budget, and expiry.
- Background batch processing iterates one tenant transaction at a time. There is no normal cross-tenant application role.
- The maintenance break-glass database role is held outside application secrets, requires incident/change approval, has a maximum one-hour credential, records the operator and ticket, and produces an alert. It is never used by migrations or runtime code.

## 5. Pooled multitenancy and isolation

### 5.1 Tenant derivation

The browser can request a tenant slug as a locator, but it cannot assert tenant authority. The API resolves the selected slug against current memberships for the verified issuer-plus-subject, chooses the active membership and delegation, and creates TenantContext. A token tenant claim is advisory unless it is issued by a specifically configured IdP mapping and still matches authoritative membership.

Every request, workflow, event, trace, and audit record has one tenant context. Platform-public data uses an explicit platform scope and is never represented by a null tenant on a tenant table.

### 5.2 PostgreSQL

All tenant tables meet these rules:

1. The primary or candidate key begins with tenant_id.
2. Every tenant-to-tenant foreign key includes tenant_id on both sides.
3. ENABLE ROW LEVEL SECURITY and FORCE ROW LEVEL SECURITY are set.
4. SELECT, INSERT, UPDATE, and DELETE policies compare tenant_id with the transaction-local tenant setting and reject a missing or malformed setting.
5. Application roles are non-superuser, do not own tables, and do not have BYPASSRLS.
6. The connection pool returns a connection only through a transaction wrapper that sets app.tenant_id, app.actor_id, app.policy_version, and app.request_id using SET LOCAL.
7. Pool release rolls back any open transaction. Tests verify that a connection reused for another tenant cannot observe prior context.
8. Unique constraints for external IDs include tenant_id. Entity-resolution candidate queries include tenant_id before similarity logic.
9. Migrations run under a schema-owner role unavailable to applications. Migration verification fails if a new tenant table lacks policy or tenant-qualified foreign keys.

High-risk transactions, including approval acceptance, single-use grant claim, connector cursor advancement, and identity merge, use row locks or SERIALIZABLE isolation with bounded retry.

### 5.3 Derived stores

| Store | Isolation requirement |
|---|---|
| pgvector | Vectors remain in PostgreSQL tenant rows under FORCE RLS. Approximate-index queries must preserve an exact tenant and ACL post-filter before results leave the data layer. |
| Neo4j | H1/H2 use a pooled logical namespace: every node and relationship carries tenant_id and projection_generation; only typed query/projector gateways inject server-derived tenant context; relationship endpoints are tenant checked; results are reauthorized against current PostgreSQL policy. User Cypher and direct application access are prohibited. H3 can move a tenant to a dedicated graph database/cell only after the RSK-002 trigger and ADR review. |
| Object storage | Each tenant uses a distinct bucket or access-controlled prefix and tenant-specific encryption-key reference. IAM denies listing or reading another namespace. Object names are opaque IDs, not user paths. |
| Valkey/Redis | Keys begin with an HMAC-derived tenant namespace, not a guessable slug. Separate credentials or ACL key patterns restrict workloads. Cached authorization records include policy version and revocation watermark. |
| Future OpenSearch | One tenant index or access-controlled tenant index set. Aliases are server resolved. Every query includes an independently verified tenant filter and ACL post-filter. |
| Temporal | Workflow IDs start with an HMAC tenant namespace. Workflow payloads use object references; raw source content and tokens are prohibited. Unavoidable confidential payloads use an approved payload codec. Search attributes contain no PII. |
| Telemetry | Tenant is represented by a low-cardinality pseudonymous key. Logs do not contain source bodies, prompts, model responses, tokens, or personal email addresses. |

### 5.4 Cross-tenant negative guarantee

H1 and H2 implement no cross-tenant search, analytics, entity merge, model memory, evaluation corpus, or training. Operational aggregate metrics use non-content counts with privacy review. A future customer opt-in is not a feature flag; it requires a new data-purpose contract, legal basis, isolation design, deletion design, threat model, audit trail, and ADR.

## 6. Authorization and source ACL

### 6.1 Policy model

Authentication roles do not directly grant data. The API policy decision combines:

- actor identity, tenant membership, role, group, authentication assurance, and account status;
- active delegation with issuer, grantee, allowed actions/resources, start, expiry, and revocation;
- action and capability;
- resource tenant, type, stable ID, owner, classification, SourceACL, state, and version;
- environment, provider scope, project allowlist, policy version, risk class, and current time.

The result is Allow, Deny, or Indeterminate plus reason codes, obligations, policy version, and decision ID. Deny overrides Allow; Indeterminate is Deny. Obligations can require redaction, result-size limits, confirmation, two-person approval, or a fresher projection.

Committed tenant roles are Viewer, Analyst, Operator, ConnectorAdmin, Approver, SecurityAdmin, TenantAdmin, and Auditor. Roles grant candidate actions, not broad data visibility. Platform operations roles have no source-content access by default.

### 6.2 Evidence authorization

- SourceACL records provider principals, groups, visibility, source version, observed time, and resolution status.
- Provider identities map to tenant actors through explicit, versioned resolution. Ambiguous mapping denies access.
- Retrieval returns claim-level facts only when at least one complete supporting evidence path is visible and no required source is hidden.
- Entity existence, relationship existence, counts, snippets, embeddings, and graph neighborhoods are all data and require authorization. The system must not leak inaccessible facts through empty-versus-not-found behavior, counts, timing, ranking, or graph degree.
- Graph edges and vector chunks retain evidence IDs and effective ACL digests. ACL filtering occurs before model context construction.
- Query and answer artifacts record policy version, actor, evidence IDs, source versions, and revocation watermark. An answer cannot be replayed to another actor without reauthorization.
- Cache invalidation is event driven, but a watermark check is still required. If an ACL projection is stale after a revocation, affected reads fail closed.

## 7. Key, secret, and cryptographic controls

| Asset | Control |
|---|---|
| TLS | TLS 1.2 or later externally and authenticated encryption internally; H2 uses workload identity for service-to-service connections |
| Database/object encryption | Provider-managed encryption at rest plus envelope encryption for Restricted fields and tenant object namespaces |
| Tenant keys | One tenant data-encryption key hierarchy under KMS/HSM-backed key encryption keys; key IDs are versioned and rotation is online |
| OAuth/provider secrets | Stored only in an approved secret manager, referenced by opaque ID, scoped per tenant installation, and refreshed/revoked through a broker |
| Cookies and tokens | Signed with rotated keys; short-lived access; refresh token rotation where used; tokens never enter URLs or logs |
| Webhooks | Provider-specific signature algorithm, constant-time comparison, raw-body verification, delivery-id uniqueness, and timestamp window |
| Action digest | SHA-256 over RFC 8785 canonical JSON for the exact approved payload: UUID tenant and connector installation, action, project/issue target, expected provider version, and field set. ApprovedPayload separately binds idempotency key, policy version, credential version, and expiry. |
| Audit integrity | Append-only sequence with previous-record digest per tenant/day plus signed daily root exported to independent object retention |

Key access is authorized by workload identity and tenant. Rotation preserves decrypt-only access to prior key versions until data is rewrapped. Suspected compromise disables use immediately, starts rewrap or credential rotation, and records affected tenants and evidence. Deleting a key is not the normal deletion workflow because it can destroy unrelated records.

Secrets never appear in source control, build arguments, images, Helm values, CI output, exception text, traces, support bundles, model prompts, or Temporal search attributes. Secret scanners block merge and release.

## 8. Connector and ingestion security

1. GitHub uses a GitHub App with read-only metadata scopes required by the connector. Jira uses OAuth with read scopes plus the minimum issue-write scope needed for the allowlisted remediation action.
2. Installation state binds provider, tenant, actor, redirect URI, nonce, PKCE verifier, and expiry. Redirect targets are allowlisted.
3. Each tenant installation has separate credentials and rate budget. Provider tokens are never shared across tenants.
4. Outbound HTTP uses a provider-specific host allowlist, DNS and IP validation, HTTPS, certificate validation, redirect denial or revalidation, response byte limits, connect/read/total timeouts, and decompression limits. This prevents SSRF and archive/decompression bombs.
5. Payload schemas have maximum nesting, collection count, text length, attachment count, and total size. Unsupported encodings and active content are quarantined.
6. Original bytes are hashed and retained according to policy; normalization never overwrites evidence.
7. Webhooks are hints. Scheduled reconciliation verifies cursors, deletions, scopes, and ACL changes.
8. Connector failures cannot cause broad provider retries. Exponential backoff with jitter respects Retry-After, circuit breakers, and per-tenant concurrency.
9. A compromised connector installation can be disabled independently. New data is quarantined, credentials revoked, prior claims marked suspect, and dependent projections reverified.
10. Attachments and future document parsing run in a sandbox with no ambient network or cloud metadata access, read-only inputs, output and CPU/memory/time limits, malware scanning, and parser isolation.

## 9. AI, agent, tool, and MCP security

### 9.1 Capability boundary

Agents are capability profiles, not organizational officers. The committed profiles are query/research, extraction/resolution, graph verification, scenario planning, mitigation drafting, and action execution. Each run receives a signed delegation snapshot with allowed tenant, evidence scope, tools, resource limits, model capability, deadline, and cancellation token. Handoffs intersect the current grant with the target profile and therefore can only narrow authority.

The platform does not persist or expose hidden chain-of-thought. It stores inputs, selected evidence, tool calls and arguments, structured outputs, decisions, verifier results, timing, cost, and concise rationale sufficient for audit.

### 9.2 Prompt injection and data exfiltration controls

- System and developer instructions are static, versioned, and separated from source content using typed message fields.
- Retrieved text is labeled with evidence ID and untrusted-content markers. Instructions found inside evidence have no execution semantics.
- Models receive no ambient network, database, provider, or secret access. Every tool is a narrow server-side function with a strict schema and independent authorization.
- Tool names and schemas come from the approved capability registry, not from source text or a user-provided URL.
- Tool arguments are schema-validated, canonicalized, length bounded, policy checked, and audited. Free-form SQL, Cypher, shell, filesystem paths, or HTTP fetch tools are prohibited.
- Retrieved content, tool output, and model output pass data-loss-prevention checks appropriate to classification before leaving a trust boundary.
- Model-generated citations must resolve to evidence in the authorized run envelope. Unknown citations are rejected.
- Memory is tenant-, actor-, purpose-, and retention-bound. H1/H2 have no cross-run autonomous long-term model memory beyond explicit product records.
- Model fallbacks are pre-evaluated and pinned. A model error, refusal, timeout, schema failure, or safety-gate failure cannot be converted into an unverified answer.
- Adversarial injection and tool-selection evaluations run before release and continuously, following the defense-in-depth pattern in [OpenAI agent safety guidance](https://developers.openai.com/api/docs/guides/agent-builder-safety).

### 9.3 MCP

MCP servers and tools are allowlisted by exact server identity and version. Remote servers require audience-bound OAuth, explicit egress policy, and a security review. Dynamic tool discovery cannot automatically grant use. Sensitive tools require the same preview and approval service as REST. Tool annotations are informational and never replace policy. The platform follows [OpenAI guidance for approvals on sensitive MCP operations](https://developers.openai.com/api/docs/guides/tools-connectors-mcp).

## 10. Jira remediation approval and execution

H1 supports one external mutation instance. Fixture alias tnt_aster resolves to tenant UUID 10000000-0000-4000-8000-000000000001, and con_aster_jira resolves to connector-installation UUID 30000000-0000-4000-8000-000000000001. Aliases never occur in the canonical approved payload. The only target is AST-142 in allowlisted sandbox project AST.

The exact required before state is Jira source version 7, due date 2026-08-07, priority Medium, and labels identity and orion. The exact approved after state is due date 2026-07-31, priorityId 2, and lexically sorted labels digital-twin-remediation, identity, and orion. Only due date, priority, and labels can change, and only to those values. Summary, description, project, issue type, transition, assignee, watcher, attachment, comment, delete, bulk edit, and arbitrary Jira REST paths are prohibited.

The public ApprovalRequest status follows the canonical contract: pending -> approved, denied, expired, or cancelled -> executed or compensated where applicable. ActionReceipt uses succeeded, failed, verification_required, compensated, compensation_conflict, or manual_intervention_required. CompensationResult uses restored, compensation_conflict, verification_required, failed, or manual_intervention_required. Internal previewing and executing workflow phases are telemetry, not additional public status values.

| Stage | Mandatory checks |
|---|---|
| Preview | Fresh Jira before snapshot; project and field allowlist; expected issue version; canonical payload; digest; proposer; policy decision; 15-minute maximum expiry |
| Operations approval | Human operations approver, MFA assurance, not proposer, current membership, matching digest and expiry |
| Security approval | A different human security approver, MFA assurance, not proposer or operations approver, current membership, matching digest and expiry; approvals may arrive in either order |
| Grant | Single-use random grant ID, digest, tenant, action, target, expected version, two decision IDs, expiry; atomic outbox publication |
| Execution | Recheck tenant, action manifest, project, OAuth scopes, grant unused and unexpired, digest, provider version, and kill switch immediately before call |
| Receipt | Idempotency key, request digest, provider request ID, redacted response, before/after hashes, outcome, actor/approvers, timestamps, trace |
| Compensation | New preview from original before state, current-state comparison, two new approvers, no overwrite of unrelated edits |

Any payload, target, expected version, policy, or expiry change invalidates both approvals. Approval links do not contain bearer grants. The worker atomically claims the single-use grant before the provider call. If the provider response is lost, the worker reconciles current Jira state and provider request evidence before retry. Compensation must be requested within 24 hours and restores the version-7 before snapshot only if current state still matches the recorded approved after state; otherwise it records compensation_conflict and enters manual_intervention_required.

A tenant kill switch disables all mutations. Platform security can invoke a global kill switch, but cannot enable a tenant mutation. Both switches are checked at preview and execution.

## 11. Application and API security

- All request bodies, paths, queries, headers, webhooks, and model/tool outputs are validated against size-bounded schemas. Unknown fields are rejected on commands.
- SQL is parameterized. Graph queries use predefined templates with typed parameters. User-supplied regular expressions, recursive depth, sort columns, and field selectors are allowlisted and budgeted.
- Output encoding is context-specific. Rich text is rendered through a strict sanitizer. Content Security Policy denies unapproved script, frame, connection, and object sources.
- Browser state-changing endpoints require CSRF defense. CORS is an explicit origin allowlist with credentials only for the product origin.
- APIs have per-actor, per-tenant, per-IP, and capability budgets. Expensive graph, export, AI, and simulation calls also reserve tenant quotas.
- Resource IDs are opaque, but authorization is still performed for every object. Not-found responses are normalized to avoid existence leaks.
- Error responses follow RFC 9457, use stable safe codes, and omit stack traces, queries, provider bodies, secrets, and policy internals.
- Upload support is disabled until its parser sandbox, malware scan, file-type sniffing, quotas, retention, and deletion controls are accepted.
- Administrative configuration changes require recent authentication, optimistic concurrency, audit, and where high risk, two-person approval.

## 12. Audit and accountability

AuditEvent includes event ID, tenant, UTC time, monotonic tenant sequence, actor or workload identity, authentication assurance, delegation, action, resource reference, policy decision ID/version, request and trace IDs, outcome, reason code, source IP classification, before/after hashes or redacted diff, idempotency key, and previous digest. It never stores secrets or unnecessary source bodies.

The following are always audited: login and logout; membership and SCIM changes; role/delegation changes; connector install/scope/credential changes; policy changes; data exports and deletions; break-glass access; model/tool invocation metadata; prompt-injection safety blocks; scenario confirmation; approvals and rejection; grant claim; external action and compensation; kill switches; retention/legal hold; security configuration; and audit access.

Audit records are append-only to application roles. A signed daily tenant root is exported to an independently controlled object retention location. This detects tampering; it does not make the primary database magically immutable. Auditor access is read-only, purpose-limited, and itself audited.

Default H2 retention is:

- security, authorization, connector-administration, and external-action audit: 7 years;
- operational metadata: 24 months;
- raw connector payloads and derived evidence chunks: 90 days;
- agent run content and detailed run telemetry: 30 days;
- anonymized aggregate telemetry: 13 months;
- raw prompts and model responses: not retained by default; approved redacted evaluation samples follow the evaluation dataset policy;
- deleted primary data: purge within 24 hours after tombstone and required hold checks;
- backups containing deleted data: age out within 35 days and cannot restore without replaying deletion tombstones.

Tenant policy can shorten these defaults. Longer retention requires a documented legal or regulatory basis. Legal hold overrides deletion only for the minimum named records and has owner, reason, jurisdiction, approval, start, review date, and release audit.

## 13. Privacy engineering and GDPR readiness

### 13.1 Roles and purpose

For customer source data, the customer is normally controller and the service provider is processor, subject to contract and legal review. Product account, billing, fraud, and security data may have a different role and must be recorded separately. Each connector has a purpose, data categories, data subjects, source, lawful-basis owner, destinations, retention, model use, residency, and deletion path in the data inventory.

### 13.2 Required capabilities

- Data minimization: request only provider scopes and fields needed for the committed use case.
- Transparency: tenant administrators can see connected sources, scopes, categories, derived uses, model endpoints, regions, retention, and pending deletion.
- Access and portability: export subject-linked authoritative records, provenance, derived claims, and material decisions in a structured form after identity verification and tenant approval.
- Rectification: source-owned facts are corrected at source and reconciled; product-owned resolution decisions can be corrected with history.
- Erasure: create a tombstone, block retrieval, delete primary/projection/cache/object/vector data, propagate to approved subprocessors, and record completion without retaining the erased content.
- Restriction and objection: disable relevant processing purpose without deleting evidence required for an accepted hold.
- Automated decisions: H1/H2 provide recommendations and simulations only; no legal or similarly significant automated decision is permitted.
- Privacy by default: no cross-tenant training, memory, analytics, or evaluation; no customer-content model training without a separately recorded opt-in that is absent in H1/H2.
- DPIA trigger: systematic monitoring, large-scale sensitive data, novel high-impact prediction, cross-context identity resolution, or workforce use blocks release until a DPIA is approved.
- Subprocessor governance: record model, hosting, telemetry, support, and identity subprocessors with region, purpose, contract, security review, and deletion assurance.

Data residency is enforced through a tenant home region. Authoritative databases, objects, graph projection, backups, model processing, and support access remain in approved regions. Global routing can use non-content health metadata only. A region change is a controlled export/import with dual authorization, integrity validation, old-region deletion, and audit.

## 14. Control readiness

| Framework area | Engineering controls and evidence | Limitation |
|---|---|---|
| SOC 2 Security and Confidentiality | Identity/MFA evidence, least privilege, change review, encryption, audit, vulnerability scans, incident exercises, tenant isolation tests | Requires organizational policies, auditor period, and operating evidence |
| SOC 2 Availability | SLOs, alerts, capacity tests, backup restore, DR exercises, incident/postmortem records | Availability commitments are H2 only |
| SOC 2 Processing Integrity | Schema validation, idempotency, reconciliation, projection checks, deterministic simulations, approval receipts | Does not validate business predictions from synthetic data |
| ISO 27001 organizational and people controls | Ownership, access review evidence, secure development gates, supplier register, incident roles | HR and governance processes are outside software |
| ISO 27001 technological controls | Secure configuration, logging, cryptography, vulnerability management, backup, network controls, secrets, SDLC | Certification scope must be separately defined |
| GDPR engineering readiness | Data inventory, minimization, purpose/retention, rights workflows, residency, deletion, DPIA triggers, subprocessor evidence | Legal basis, notices, DPA, transfer mechanism, and regulator interpretation require counsel |

HIPAA, PCI DSS, FedRAMP, government classification, and records-management certification are out of scope. A sales or deployment profile cannot claim them without a separately approved control baseline and external validation.

## 15. Threat model and mitigations

| Threat ID | Related catalog item | Threat | Primary controls | Residual treatment |
|---|---|---|---|---|
| THR-SEC-001 | RSK-001 | Tenant identifier manipulation or confused deputy | Server-derived context, FORCE RLS, tenant-qualified keys, per-tenant derived stores, negative tests | Critical release blocker if any cross-tenant path exists |
| THR-SEC-002 | RSK-003 | Stale source ACL leaks revoked data | Revocation watermark, cache invalidation, projection checkpoints, fail-closed reads | Alert and disable affected connector/query capability |
| THR-SEC-003 | RSK-004 | Prompt injection triggers a tool or exfiltration | Untrusted-content boundary, no ambient tools, schema/policy checks, egress allowlist, adversarial eval | No sensitive action without exact approval |
| THR-SEC-004 | RSK-005 | Compromised connector poisons graph | Signature/scope checks, immutable provenance, quarantine, confidence, reversible merges, reconciliation | Mark dependent claims suspect and rebuild |
| THR-SEC-005 | RSK-005 | SSRF through connector or MCP | Fixed host catalog, DNS/IP validation, metadata IP deny, redirect revalidation, egress policy | Disable installation/server on anomaly |
| THR-SEC-006 | RSK-006 and RSK-013 | Replay or approval payload swap | Delivery inbox, canonical digest, expiry, two distinct approvers, single-use grant, provider version | Manual intervention on ambiguous provider state |
| THR-SEC-007 | RSK-001 and RSK-014 | Privileged insider reads customer content | Separate ops/content roles, no routine content access, break-glass, tenant keys, audit alerts | Customer-managed keys or a dedicated H4 data plane remain gated options |
| THR-SEC-008 | REQ-SEC-007 | Dependency or build compromise | Lockfiles, SBOM, signatures, provenance, scanning, isolated CI, digest admission | Critical/high policy blocks release |
| THR-SEC-009 | RSK-018 | Denial of service and cost exhaustion | Layered rate/size/concurrency budgets, queue backpressure, circuit breakers, tenant quotas, cancellation | Shed non-critical enrichment before interactive control paths |
| THR-SEC-010 | RSK-012 | Model provider retention or region mismatch | Approved endpoint configuration, data minimization, contract/subprocessor review, region check | Disable model capability if guarantees do not match tenant |
| THR-SEC-011 | RSK-002 | Graph query complexity attack | Query templates, depth/node/edge/time budgets, admission quotas, cancellation | Terminate query and record abuse signal |
| THR-SEC-012 | RSK-015 | Deletion restored from backup | Tombstone ledger outside backup point, restore replay, backup expiry, restore validation | Privacy incident if replay or downstream deletion fails |
| THR-SEC-013 | RSK-014 | Audit deletion or forgery | Append-only role, chained digests, signed daily root, independent retention | Daily verification and incident on mismatch |
| THR-SEC-014 | RSK-010 | Identity collision across providers | Issuer-plus-subject keys, explicit tenant-local resolution, reversible merges | Ambiguity denies access and requires review |

## 16. Security operations

- Vulnerability intake covers dependencies, images, infrastructure, source, cloud configuration, and provider advisories. Exploitable Critical issues block release and receive immediate containment; exploitable High issues block production promotion unless the security owner records a time-limited exception with compensating control.
- Dependency updates run at least weekly; internet-facing and cryptographic emergency updates use an expedited tested path.
- Security incidents follow Prepare, Detect, Triage, Contain, Eradicate, Recover, Notify, and Learn. Runbooks identify incident commander, security lead, tenant communications, privacy/legal decision owner, evidence custodian, and service owner.
- Credential compromise, cross-tenant access, unauthorized Jira mutation, audit-integrity failure, and deletion failure are Severity 1 conditions.
- Quarterly access reviews cover platform roles, production access, CI identities, KMS, break glass, connector scopes, and tenant administrators in H2.
- Penetration testing is required before H2 production and annually thereafter, with retest of Critical and High findings.
- Security findings have severity, exploit scenario, affected tenant/data, owner, deadline, evidence, and verification. Critical or High findings cannot remain open at a specification 1.0 or H2 production release.

## 17. Acceptance criteria

| Evidence ID | Canonical acceptance | Criterion |
|---|---|---|
| TC-SEC-001 | AC-TEN-001 | Cross-tenant tests cover API, PostgreSQL, graph, vector, object, cache, Temporal identifiers, exports, audit, and model context and produce zero disclosures. |
| TC-SEC-002 | AC-TEN-001 | Every tenant table has FORCE RLS, a tenant-qualified key and foreign key, and a non-owner application role test. |
| TC-SEC-003 | AC-SEC-002 | Removing a source permission blocks all affected reads before any stale projection or cache can respond. |
| TC-SEC-004 | AC-AI-003 | Connector text containing prompt injection cannot select a tool, change tenant, bypass retrieval ACL, or cause external network access. |
| TC-SEC-005 | AC-ACT-001, AC-ACT-002, AC-ACT-003 | No Jira change occurs with a proposer approval, fewer than two other human approvers, repeated identity, stale membership, changed payload, expiry, stale issue version, invalid scope, disabled tenant, or non-allowlisted project. |
| TC-SEC-006 | AC-SEC-001 | Secrets and Restricted content are absent from Git history, images, SBOM, logs, traces, metrics, workflow search attributes, error responses, and model prompts. |
| TC-SEC-007 | AC-PRV-001 | A tenant deletion test removes authoritative, graph, vector, object, cache, answer, and model-memory records and proves tombstone replay after restore. |
| TC-SEC-008 | AC-OBS-001 | An audit verifier detects a changed, removed, reordered, or inserted event and validates the independently stored daily root. |
| TC-SEC-009 | AC-REL-002 and AC-REL-003 | Restore, break-glass, key rotation, connector compromise, incident response, and global mutation kill-switch exercises produce complete evidence. |
| TC-SEC-010 | AC-PRV-001 | The data inventory maps every processed field to purpose, classification, owner, region, retention, model use, subprocessors, export, and deletion path. |
| TC-SEC-011 | AC-REV-002 | Security review finds no open Critical or High issue; Medium exceptions name owner, compensating control, expiry, and revisit trigger. |
| TC-SEC-012 | AC-DOC-002 | An independent reviewer can trace each canonical security/privacy control to implementation evidence, automated tests, operational evidence, and an accountable owner. |
