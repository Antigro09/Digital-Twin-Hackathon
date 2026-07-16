# AI provider system

## Provider abstraction

`AIProvider.generate(ProviderRequest) -> ProviderResponse` is the only model boundary. `generate_batch` preserves the same per-item rate, cost, and validation semantics. The gateway knows provider names and capabilities, not SDK response types.

## Meta Llama

`LlamaProvider` uses Meta's official pinned `llama-api-client==0.6.0`. It configures API-key authentication, `LLAMA_ENDPOINT` (default official `https://api.llama.com/v1/`), an explicit `LLAMA_MODEL`, bounded timeouts, gateway-owned exponential retries, JSON Schema `response_format`, typed SDK responses, token metrics, and a redacted request ID.

There is no hardcoded or simulated fallback. Missing credentials/model configuration returns `ai_provider_not_configured`; retry exhaustion returns a generic provider-unavailable problem without exception text.

## Optional OpenAI Responses

`OpenAIResponsesProvider` is an accurately typed HTTP adapter for `/v1/responses`. It sends `store: false` and `text.format={type: json_schema, strict: true, schema: ...}`, detects refusals, parses output text, tracks usage, and applies the same retries and application-side validation. This follows OpenAI's Structured Outputs guidance while retaining Pydantic validation because schema-conforming content can still be factually wrong.

## Routing and cost

Extraction-oriented agents use `AI_PROVIDER_DEFAULT`; high-reasoning agents use `AI_REASONING_PROVIDER`. The selected provider must be configured. No failure causes an unapproved cross-provider fallback.

Generation token counts are recorded from the provider. Monetary cost is calculated only when explicit per-million input/output rates are configured; otherwise it is honestly `unpriced`. A request with `max_cost_usd` fails unless pricing exists, then uses a conservative preflight estimate over the complete system prompt, JSON Schema, user/session context, evidence, and maximum output. A cache hit reports zero incremental usage/cost rather than charging the source request again.

## Embeddings

The official Llama SDK has no embeddings resource. The worker therefore uses a separate real OpenAI-compatible adapter configured by `AI_EMBEDDING_API_KEY`, `AI_EMBEDDING_MODEL`, `AI_EMBEDDING_ENDPOINT`, and `AI_VECTOR_DIMENSIONS`. It never generates hash/random pseudo-vectors. Without this configuration, vector retrieval is unavailable and lexical retrieval remains explicit. Import/retrieval receipts and activity record provider-reported embedding tokens and exact returned model provenance; monetary cost is left unpriced because generation pricing is not assumed to be embedding pricing.

Primary references:

- Meta official SDK: https://github.com/meta-llama/llama-api-python
- Meta structured output: https://llama.developer.meta.com/docs/features/structured-output
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
