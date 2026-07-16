# AI Security Model

Status: H1 security contract  
Last reviewed: 2026-07-15

## Security objectives

The AI layer must not expand authority, cross tenant boundaries, disclose inaccessible evidence, turn untrusted content into instructions, corrupt authoritative knowledge, change deterministic calculations, execute actions, expose secrets, or create an unaudited inference path.

The model is treated as an untrusted probabilistic component. Authentication, tenant derivation, authorization, retrieval, validation, review, persistence, calculation, and action execution are deterministic controls outside the model.

## Trust boundaries

| Boundary | Required control |
|---|---|
| Browser to API | Signed short-lived user token; server-derived tenant/actor; DTO allowlist; rate/size limits |
| API to AI worker | Private network plus independent `AI_WORKER_SHARED_SECRET`; constant-time verification; no browser access to the secret |
| AI worker to provider | TLS, provider API key from secret injection, endpoint egress allowlist, bounded deadline/retries |
| Retrieval to prompt | Tenant and source-ACL filtering before retrieval; classification policy; provenance; untrusted-data labeling |
| Provider output to application | Strict schema plus local validation, evidence re-authorization, prohibited-output checks |
| Suggestion to memory/graph | Authenticated human review; immutable digest; separate domain command for graph mutation |

## Tenant and permission isolation

Tenant context comes only from authenticated middleware. Public AI requests cannot contain an authoritative tenant ID, actor ID, role, ACL, or provider credential. Every knowledge row, embedding, memory entry, run, suggestion, and audit record carries a tenant-qualified key. Retrieval predicates tenant and source ACL in the datastore query, before ranking and before result counts are returned.

The H1 public import contract permits only `source_acl.visibility: private`. The API expands that value to the server-derived importing actor and required capability before calling the worker; caller-supplied actor IDs, roles, permission strings, or tenant-wide visibility are rejected. Broader tenant sharing requires a separate policy-backed H2 command and preview.

Authorization is re-evaluated when context is assembled, after the provider returns, on idempotent run replay, when a suggestion is displayed, when a review is submitted, and whenever validated memory is reused. Durable evidence revocation/deletion/replacement suppresses dependent suggestions and validated memory. Session summaries are sanitized unverified actor/session state with a TTL and purge/reset capability; they are not citable evidence and are not claimed to receive immediate source-revocation propagation. Cache keys bind tenant, actor permissions, policy/model/schema/prompt, and evidence content hashes, and every cache hit still performs evidence re-authorization.

Cross-tenant retrieval, entity resolution, memory, cache reuse, analytics, evaluation, and training are prohibited. Aggregate operational metrics use non-reversible tenant references and contain no prompt text.

## Prompt-injection defense

Injection is handled as a data-flow problem, not by asking the model to be careful.

- System/developer instructions are immutable server templates. User or document strings are never interpolated into privileged instructions.
- Retrieved chunks are serialized in typed, delimited `UNTRUSTED_DATA` records with evidence IDs and no tool authority.
- The model receives no API key, database credential, raw policy object, arbitrary URL fetcher, shell, SQL, Cypher, or mutation tool.
- Agent profiles allow one strict schema and a fixed capability. Content cannot select another agent, provider, model, schema, tool, memory scope, or tenant.
- Any text such as “ignore previous instructions,” encoded variants, fake system messages, tool-call markup, or requests for secrets remains source content. It is neither executed nor promoted.
- Evidence IDs returned by the model are intersected with the server-supplied authorized set. Invented or inaccessible IDs fail validation.
- Provider output is data, never code. HTML/Markdown is escaped in the UI and cannot introduce executable actions.

## Output integrity and corruption prevention

All knowledge-changing model results remain `PENDING_REVIEW`. The suggestion contains a canonical digest of the exact structured payload, evidence set, tenant, agent/profile, provider/model, prompt/schema versions, and creation time. Review binds that digest; a changed payload requires a new review.

Approval may move a suggestion into validated enterprise memory, but it does not directly mutate graph nodes, relationships, events, simulation rules, predictions, accounts, connectors, or external systems. Those changes require an existing deterministic domain command with its own authorization and, where applicable, preview/approval workflow.

Confidence is advisory. It never bypasses review or permission checks. Invalid schemas, missing evidence, forbidden categories, contradictory critical values, and provider refusals fail closed.

## Secrets and sensitive data

- Provider keys and the internal service credential are injected at runtime, ignored by Git, and visible only to their owning server process.
- Secret values are never logged, placed in exception messages, prompts, model metadata, audit payloads, browser bundles, HTML, or health responses.
- Logging uses allowlisted metadata. Inputs and outputs are represented by IDs, hashes, classifications, counts, sizes, and validation states; raw confidential content is excluded by default.
- Provider errors are normalized before crossing the worker boundary. Raw upstream response bodies are not exposed.
- Inputs pass size, media-type, archive, control-character, and secret-pattern checks. Known credentials are redacted or rejected before provider submission according to data policy.
- Provider data-retention and training terms are reviewed as a deployment/subprocessor decision; a code-level setting alone is not treated as a legal guarantee.

## Abuse and cost controls

Implemented H1 controls include per-actor requests/minute, document bytes/pages/chunks, retrieval candidates/items, a conservative full-route input estimate, output tokens, retries, timeout, session TTL, and optional per-request generation cost. Provider-reported usage is reconciled after execution. Distributed concurrency, daily tenant token/cost budgets, and import-frequency quotas are required deployment transitions and are not claimed by the current in-process gateway.

Caching is permitted only for non-sensitive deterministic retrieval or an exact, permission-bound inference key that includes tenant, actor policy/ACL version, source hashes, agent/prompt/schema/model versions, and request digest. Cached AI output remains a suggestion and never bypasses validation or review.

## Audit events

The audit record includes:

- run, correlation, tenant, and actor references;
- agent/profile, provider/model, prompt/schema/config hashes;
- evidence IDs and classifications, not unnecessary raw content;
- authorization decision and policy version;
- timestamps, latency, attempts, terminal state, and normalized error;
- token usage and reviewed cost estimate;
- output digest, confidence, validation findings, suggestion status;
- reviewer, decision, reason, timestamp, and reviewed digest.

Audit access is separately authorized. Logs and traces must not expose raw prompts, completions, credentials, or high-cardinality personal data.

## Threats and required tests

| Threat | Required test and safe result |
|---|---|
| Caller supplies another tenant/actor | Field rejected/ignored; zero foreign records or counts |
| Direct/indirect/encoded injection | Strict capability output only; no instruction/tool/secret effect |
| Model invents an evidence ID | Validation fails; no suggestion persisted |
| ACL revoked during a run | Final evidence recheck fails or trims result |
| Provider returns prose/malformed JSON/extra field | Run fails or one bounded strict repair; no partial write |
| Provider/API key missing or invalid | Unavailable/auth error; no fake response and no secret in logs |
| Prompt requests graph/action mutation | Denied capability or review-only suggestion |
| Duplicate review or payload swap | Idempotent receipt or digest conflict |
| Secret embedded in document | Redacted/rejected under policy; never logged |
| Rate/cost exhaustion | Request denied before provider call with auditable limit state |
| Cross-tenant cache key collision | No hit; isolation suite remains zero disclosure |

Any cross-tenant disclosure, unauthorized action, credential exposure, or successful privilege-changing injection is a release blocker.

## Incident response

Operators can disable a provider, model route, agent profile, tenant AI capability, imports, or all model egress without stopping the deterministic twin. Response includes revoking/rotating keys, preserving metadata/audit evidence without spreading sensitive payloads, identifying affected run/evidence hashes, invalidating caches and session memory, suspending suggestions, notifying data/security owners, and regression-testing before re-enable.
