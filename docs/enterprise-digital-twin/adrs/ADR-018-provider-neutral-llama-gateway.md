---
id: ADR-018
title: Provider-Neutral AI Gateway with Llama Primary
status: accepted
version: 1.0.0
owners: [ai-platform, security-architecture]
last_reviewed: 2026-07-15
supersedes: ADR-012
---

# ADR-018: Provider-Neutral AI Gateway with Llama Primary

## Decision

Supersede `ADR-012` and route every model-backed capability through one provider-neutral Python AI Gateway. Meta Llama API is the default H1 provider through an `AIProvider` adapter. OpenAI Responses is an optional independently configured and evaluated adapter. Application controllers, the browser, connectors, graph services, simulation services, and action services cannot call either provider directly or select an arbitrary provider/model.

The gateway owns server-derived tenant/actor context, permission-trimmed retrieval, agent/profile and model routing, immutable prompt and schema versions, strict structured outputs, local validation, rate/time/token/cost budgets, controlled memory, suggestion review state, redacted audit, retry normalization, and provider readiness. Provider-native features remain available inside their adapter; the common contract does not weaken schema, refusal, safety, usage, or data-control behavior.

Llama credentials, endpoint, and exact account-available model identifiers are runtime secrets/configuration. No model response, semantic embedding, or provider-success state may be simulated outside test-only doubles. When no approved route is configured or healthy, the affected AI capability reports unavailable and fails closed while deterministic twin capabilities remain operational.

Seven H1 capability profiles are model-backed: knowledge ingestion, entity resolution, event understanding, causal analysis, simulation planning, prediction explanation, and technical knowledge. They produce evidence-bearing `PENDING_REVIEW` suggestions. They cannot authenticate, authorize, mutate the canonical graph, establish enterprise memory, calculate simulation/prediction values, approve themselves, or execute actions. Only reviewed artifacts may enter enterprise/learning memory, and graph mutations still require a separate deterministic domain command.

## Consequences

- Llama becomes an explicit H1 external dependency for live AI acceptance evidence; a real key, endpoint, and exact model are deployment inputs.
- Provider portability is a tested adapter boundary, not a promise that models are behaviorally interchangeable.
- OpenAI can be promoted per workload only with the same isolation, injection, schema, grounding, quality, latency, cost, and data-processing gates.
- PostgreSQL stores durable AI runs, provenance, vectors, memory, suggestions, reviews, and usage; reduced local stores cannot satisfy the enterprise-memory release gate.
- Air-gapped inference remains unavailable until a reachable local adapter and embedding route pass the same workload gates.

