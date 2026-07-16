# AI security model

## Authentication and tenant isolation

The shared service token is compared with `hmac.compare_digest` and is never logged. Tenant, actor, roles, and capabilities are trusted only from internal headers. SQL reads always bind the tenant before records are deserialized. Response isolation checks remain active for the frozen H1 tenants.

## Source authorization

Imported and ephemeral evidence use a normalized `SourceACL`:

```json
{
  "visibility": "private",
  "allowed_actor_ids": ["..."],
  "allowed_roles": [],
  "required_permissions": ["knowledge.read"]
}
```

Private sources require an actor or role principal. Retrieval checks tenant, required capabilities, actor/role visibility, quarantine status, and requested evidence IDs. An inaccessible record produces the same not-found behavior whether it is absent, cross-tenant, or ACL-denied.

Evidence authorization is checked when context is assembled and again after a provider call. Every suggestion stores immutable, content-free bindings (ID, locator, ACL, source type, and content hash). Run replay, suggestion display, review, and validated-memory reuse recheck those bindings. Durable source deletion/content replacement/ACL revocation suppresses dependent suggestions and memory. Ephemeral graph/event/simulation/user-input bindings can recheck the captured actor ACL and digest, but the worker cannot independently query the upstream source; the API must derive them from a fresh authorized domain read.

## Prompt-injection and secret containment

External source strings are serialized as quoted JSON data and never become system instructions. Known instruction-override, prompt-exfiltration, credential-exfiltration, tool-command, private-key, cloud-token, and credential-assignment patterns quarantine a chunk before embedding or model submission. Quarantined content is replaced by a marker in the AI record store. Direct task/context injection is rejected.

Provider output is schema validated and scanned for both configured secrets and generic credential patterns. Exception text from provider SDKs is not returned or persisted. Request/audit records retain hashes, identifiers, token counts, provider/model names, and evidence IDs—not prompts, source bodies, credentials, or raw model output.

## Integrity controls

- Runs, imports, reviews, and learning outcomes require tenant+actor+operation-scoped idempotency keys. Reuse with a different body returns `409`.
- Only fully schema/citation/secret-valid responses enter the cache.
- The cache key binds tenant, actor, permissions, provider, model, schema, policy version, prompt/session history, and evidence hashes.
- Review decisions are immutable effective state. A repeated identical review replays; an opposite decision conflicts.
- Suggestions always remain `PENDING_REVIEW`; review is exposed separately and performs no graph/simulation mutation.
- Cached runs carry `measurement=cache_hit`, zero incremental token usage, zero known incremental cost, no new provider request ID, and the original validated response digest.
- Session memory is actor/session scoped, sanitized, bounded, TTL-expiring, purgeable, and always marked unverified. Sensitive-key values and instruction-like strings are replaced before persistence.

## Supported security tests

Tests cover missing/invalid service credentials, secret-safe validation errors, provider exception redaction, injection quarantine, generic secret quarantine, tenant and actor ACL isolation, hallucinated citations, unsafe model output, idempotent replay, review conflicts, and validation-only learning memory.
