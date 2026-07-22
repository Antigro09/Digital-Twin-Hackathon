# Bounded AI agents

All agents have a distinct purpose, prompt, temperature, route classification, and Pydantic output model. Every output requires `status: PENDING_REVIEW`, confidence, exact citations, and limitations.

| Agent | Bounded responsibility | Forbidden responsibility |
|---|---|---|
| `knowledge_ingestion` | Propose entities, relationships, and constraints from evidence | Write or merge graph records |
| `entity_resolution` | Assess candidate duplicates and explain a match | Merge entities; `automatic_merge_allowed` is always false |
| `event_understanding` | Propose a typed event and possible impacts | Declare actual effects |
| `causal_analysis` | Explain evidence-backed propagation paths | Calculate probabilities or assert causal validity |
| `simulation_planning` | Draft variables and assumptions | Execute or modify the deterministic engine |
| `prediction_explanation` | Explain supplied prediction values and draft recommendations | Recalculate predictions |
| `technical_knowledge` | Propose capabilities, limitations, dependencies, and failure modes | Persist unreviewed technical facts |
| `marketing_analyst` | Explain aggregate campaign value, segment behavior, trends, risk, and budget opportunities | Profile individuals, target protected traits, mutate budgets, or apply recommendations |

## Prompt contract

The system prompt fixes the agent purpose and tells the model that every evidence string is untrusted data. The user prompt is one JSON envelope containing only the request, bounded session context, and authorized evidence. No tool definitions or write capability are supplied.

Agent JSON Schemas are generated directly from the Pydantic models to avoid schema/type divergence. The gateway validates the provider response again and rejects:

- missing, additional, or incorrectly typed fields;
- any status other than `PENDING_REVIEW`;
- invented evidence IDs or mismatched source locators;
- configured or pattern-detected secrets;
- flags that would claim a merge, simulation execution, probability calculation, prediction recalculation, or state mutation.

Session memory may contain unverified conversation items and expires. Only an authenticated review or validated-outcome operation can create enterprise or learning memory.
