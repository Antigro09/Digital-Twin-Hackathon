# AI intelligence architecture

The Python worker contains two deliberately separate capabilities:

1. The existing seeded PERT/Monte Carlo scheduler is deterministic and remains the only component that calculates simulation results.
2. The AI Gateway understands, extracts, plans, and explains. It can only create immutable `PENDING_REVIEW` suggestions and cannot call a graph write, simulation write, connector, shell, or control-plane tool.

## Request path

`API-authenticated actor -> internal service credential -> tenant/actor/scope context -> rate and idempotency gates -> permission-trimmed retrieval -> route context/cost budget -> provider -> post-call evidence re-authorization -> Pydantic/citation/secret gates -> suggestion + redacted audit`

The API derives `X-Internal-Tenant-Id`, `X-Internal-Actor-Id`, and `X-Internal-Permissions`. When `AI_WORKER_SHARED_SECRET` is configured, every non-health endpoint also requires `X-Internal-Service-Token`. Model callers never select a tenant in a payload.

## Durable state

`DurableRecordStore` uses PostgreSQL when `AI_STORE_DSN=postgresql://...`. The H1/local fallback is an explicitly labeled file-backed SQLite store. Records are keyed by tenant, type, and UUID. It persists knowledge chunks and real vectors, suggestions, review receipts, activity, redacted audit records, idempotency responses, and controlled memory.

The current worker stores vectors as bounded SQL JSON arrays and performs permission filtering before bounded cosine ranking. Native pgvector indexing is a declared scale transition, not a present claim.

## Endpoints

- Existing deterministic endpoints: snapshot seal, simulation run/result, and evidence verification.
- `GET /v1/ai/status`
- `GET /v1/ai/activity`
- `POST /v1/ai/agent-runs` (`Idempotency-Key` required)
- `POST /v1/ai/retrieval/search`
- `POST /v1/ai/documents/import` (`Idempotency-Key` required)
- `GET /v1/ai/suggestions` and `GET /v1/ai/suggestions/{id}`
- `POST /v1/ai/suggestions/{id}/reviews` (`Idempotency-Key` required)
- `POST /v1/ai/learning/outcomes` (`Idempotency-Key` required)

The legacy `/v1/grounded-answers` and `/v1/extractions` aliases are explicitly deprecated deterministic evidence utilities. They do not masquerade as model-backed AI.

## Deliberate H1 limitations

- PostgreSQL is the enterprise backend, but the worker also supports SQLite for isolated tests/local execution.
- Native pgvector ANN, OCR, images, legacy `.doc`/`.xls`, and diagram vision are not implemented. Unsupported binaries fail closed.
- The gateway is synchronous. Provider-native asynchronous batches can implement the existing batch interface later.
- Readiness is split: `vector_configured` means credentials/model exist; `vector_ready` becomes true only after a successful embedding call.
- AI approval can validate controlled enterprise/learning memory. It never applies graph or simulation mutations.
- Activity and suggestion reads are actor-scoped. Stored suggestions carry a separate content-free evidence-binding record; replay, display, review, and memory reuse re-authorize it.
- The 24,000-token default route budget is a conservative provider-neutral byte estimate over the complete system prompt, JSON Schema, session context, user input, and evidence. Exact provider token usage is reconciled from the response.
- Cache hits report zero incremental tokens/cost and reference the validated source-response digest; idempotent replay returns the original response without creating another activity record.
