# AI Provider System

Status: H1 implementation and operations contract  
Last reviewed: 2026-07-15

## Provider-neutral interface

All inference is invoked through the AI Gateway's `AIProvider` contract. Application features name an agent/task type, not a provider-specific endpoint or model.

The contract accepts a system instruction, user/data messages, a strict output JSON Schema, model policy, sampling controls, token limit, timeout, correlation metadata, and cancellation deadline. It returns validated structured content plus the actual provider, model, request identifier when safe to retain, finish reason, latency, and normalized token usage.

Provider adapters must implement:

- configuration/readiness validation;
- authenticated remote inference;
- provider-native strict structured output where supported;
- timeout, cancellation, and bounded transient retry handling;
- normalized refusal, authentication, rate-limit, timeout, transport, provider, and invalid-response errors;
- input/output/total token accounting;
- redacted operational logging;
- no hidden provider fallback or response fabrication.

## Llama provider

Llama is the default H1 model provider. The adapter uses Meta's official Llama API client and its chat-completions structured-response contract. The endpoint and model are deliberately configuration values because model availability and endpoint assignment are account-specific.

Required environment variables:

```dotenv
AI_PROVIDER_DEFAULT=llama
LLAMA_API_KEY=<secret from the Meta Llama developer console>
LLAMA_MODEL=<exact model identifier available to the account>
# Optional; blank uses the official SDK default https://api.llama.com/v1/
LLAMA_ENDPOINT=
```

Optional bounded controls:

```dotenv
AI_GATEWAY_TIMEOUT_SECONDS=20
AI_GATEWAY_MAX_RETRIES=2
AI_GATEWAY_MAX_INPUT_TOKENS=24000
AI_GATEWAY_MAX_OUTPUT_TOKENS=4096
AI_GATEWAY_REQUESTS_PER_MINUTE=30
AI_GATEWAY_MAX_DOCUMENT_BYTES=5242880
AI_SESSION_TTL_MINUTES=60
```

Setup:

1. Create or select a Llama API developer project and issue a server API key.
2. Copy `.env.example` to the ignored `.env` if it does not already exist.
3. Add the key, exact available model identifier, and base endpoint to `.env`. Do not add quotes unless they are part of the value.
4. Start or rebuild the stack with `npm run demo`.
5. Open **AI Control Center** and confirm that provider readiness is `ready` and the route reports `llama`.
6. Run a small structured agent task and verify that the activity record shows non-fabricated provider usage and a validated result.

The official Meta Llama API announcement documents key creation, official Python/TypeScript SDKs, and OpenAI SDK compatibility: <https://ai.meta.com/blog/llamacon-llama-news/>. The official Python SDK documents async use, configurable retries/timeouts, normalized API errors, and base-URL configuration: <https://github.com/meta-llama/llama-api-python>.

### Transport rules

- `Authorization` is built only by the provider SDK/adapter and never accepted from a public request.
- The API key is loaded at process start from environment/secret injection and is never placed in prompts, traces, metrics, exception bodies, or response DTOs.
- The configured endpoint must use HTTPS outside local provider testing. Redirects to a different origin are rejected by the deployment egress policy.
- Calls have a finite deadline. Retries use jittered exponential backoff and honor provider retry hints within the original deadline.
- Only connection failures, 408, 409, 429, and 5xx-class transient failures are retry candidates. Invalid credentials, invalid requests, refusals, and invalid structured output do not trigger provider hopping.
- The gateway applies its own retry cap even when the SDK has built-in retries so total attempts remain auditable.
- Prompt or output content is not emitted to standard logs.

### Structured outputs

The adapter requests `response_format.type = json_schema` with a named strict schema when the selected model supports it. The returned value is parsed exactly once, size-limited, and validated locally with the same schema. Extra properties, missing required fields, wrong types, invalid enums, invalid evidence references, or non-JSON text fail the run. A repair request, when enabled for an agent, is capped at one attempt and receives only validation errors—not a lowered schema.

## OpenAI provider

OpenAI is an optional, independently evaluated provider route. It is not an automatic substitute for Llama. It uses the Responses API and its strict structured-output contract.

```dotenv
OPENAI_API_KEY=<server-side secret>
OPENAI_MODEL=<evaluated model snapshot or exact approved model id>
```

The OpenAI Responses API expresses structured outputs under `text.format`; the adapter still performs local application validation and handles refusal/incomplete states explicitly. See the official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

## Embedding provider

The current hosted Llama SDK does not expose an embeddings resource, so vector generation uses a separate real OpenAI-compatible embeddings adapter. It never derives placeholder vectors from hashes or random values. Configure an approved endpoint/model explicitly:

```dotenv
AI_EMBEDDING_API_KEY=<embedding-provider secret>
AI_EMBEDDING_MODEL=<exact embedding model id>
AI_EMBEDDING_ENDPOINT=<full HTTPS /embeddings endpoint>
AI_VECTOR_DIMENSIONS=256
```

`AI_EMBEDDING_API_KEY` may reuse `OPENAI_API_KEY` when the same approved OpenAI account is intended; the embedding model is still mandatory. The configured dimension must be supported by the exact model. Without an embedding route, imports and lexical retrieval remain honest about vector unavailability and no synthetic embedding is stored. Query embedding calls short-circuit when no authorized stored vector exists; receipts/activity retain provider-reported embedding tokens and the returned model identifier.

## Model router

Routing policy is server-owned and maps an allowlisted `agent_type` to a capability class. A public caller cannot select an arbitrary endpoint, provider, model, temperature, context size, or schema.

| Capability class | Agents | Default route | Sampling policy | Output policy |
|---|---|---|---|---|
| Structured high-volume | knowledge ingestion, event understanding, technical knowledge | Llama configured model | low temperature | Agent-specific strict schema |
| Resolution | entity resolution | Llama configured model | near-deterministic | Match/conflict schema; review threshold |
| Grounded reasoning | causal analysis, simulation planning, prediction explanation | Llama configured model | low temperature | Evidence-bearing strict schema |
| Evaluated advanced reasoning | explicitly promoted complex tasks | Optional approved provider/model | task-specific | Same or stronger schema and eval gate |

The H1 router applies a configurable conservative provider-neutral estimate across system instructions, the complete JSON Schema, session/user context, authorized evidence, and requested output. It removes optional history/evidence only at whole-item boundaries and fails if explicit evidence cannot fit. It never removes security instructions or schema constraints. A provider-specific tokenizer and explicit omission metadata are later refinements.

## Error contract

Provider-specific exceptions are normalized into stable categories:

| Category | Retry | Public behavior |
|---|---:|---|
| `provider_unconfigured` | No | 503; setup required without naming secrets |
| `provider_authentication_failed` | No | 503; operator action required |
| `provider_rate_limited` | Bounded | 429 or 503 with safe retry hint |
| `provider_timeout` | Bounded | 504 |
| `provider_unavailable` | Bounded | 503 |
| `provider_refused` | No | Safe refusal state |
| `invalid_provider_response` | No, except one schema repair where allowed | 502; no partial persistence |
| `policy_denied` | No | 403 or safe capability denial |

Raw upstream bodies are not returned to clients because they can contain provider diagnostics, submitted data, or account metadata.

## Usage and cost accounting

The adapter records provider-reported input/output/total tokens. If usage is unavailable, numeric fields remain zero and `measurement: unavailable` prevents them from being presented as exact. A cache hit records `measurement: cache_hit`, zero incremental tokens/cost, no new provider request ID, and the source response digest. H1 cost is calculated only when operators explicitly configure the selected provider's input/output rates; otherwise it is `unpriced`. Embedding usage is token-accounted but monetarily unpriced because generation rates are not assumed to apply.

H1 actor-scoped activity records generation and embedding usage. A normalized tenant operations warehouse for multidimensional/time-window aggregates is a later transition. Raw user content is not a metric label.

## Provider promotion checklist

A provider/model route cannot be enabled for production until it passes schema validity, extraction or reasoning quality, evidence fidelity, abstention, tenant-isolation, injection, refusal, timeout, retry, token/cost, and latency suites on the applicable agents. The record includes exact model/configuration, prompt/schema hashes, evaluator versions, decision owner, date, rollback route, and data-processing approval.
