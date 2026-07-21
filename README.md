# Enterprise Digital Twin

This repository contains a runnable, production-shaped H1 demonstrator and the source-controlled enterprise architecture blueprint behind it. The organizational path turns deterministic synthetic GitHub and Jira observations into a permission-aware graph, produces a cited launch-risk answer, runs a reproducible PERT/Monte Carlo scenario, and governs one exact Jira remediation through two-person approval, idempotent execution, and separately approved compensation. A second synthetic physical-asset path adds advancing telemetry, an interactive rotatable 3D-style pump view, deterministic anomaly/forecast demonstrations, lifecycle history, and guarded simulated controls. The Event Intelligence path turns untrusted natural-language reports into typed events, tenant-bounded entity candidates, a three-hop causal impact graph, scenario or reality-review routing, exact synthetic mutations, timeline branches, audit evidence, and compensating rollback.

The current specification is `1.0.0-rc.1`. Its H1/H2 decisions are Committed, but final `1.0.0` publication remains gated on the independent build-readiness confirmation defined in the blueprint.

## Run the complete H1 demo

Prerequisites are Docker Desktop with Compose v2 and Node.js 22 or newer. All demo data and provider effects are synthetic.

```powershell
Copy-Item .env.example .env
npm run demo
```

Open <http://localhost:3000>. The launcher builds all four application workloads, starts PostgreSQL, Temporal, Neo4j, Valkey, and MinIO, waits for readiness, and seeds the isolated Aster and Beacon tenants.

The application database name is configurable with `EDT_DATABASE_NAME` and defaults to `edt_hardened`. The launcher creates it non-destructively when an older local PostgreSQL volume already exists, leaving a prior `edt` database untouched for audit comparison.

On the first connected visit, enter the value of `EDT_DEMO_UI_ACCESS_KEY` from your ignored local `.env` file. The key is checked only by the server-side local-demo unlock route, is never placed in the browser bundle or persisted by the browser, and establishes a short-lived HttpOnly ceremony cookie. The API itself accepts only short-lived signed Bearer tokens and rejects the former caller-controlled actor header. This authentication exchange exists only in the explicitly enabled trusted local-demo profile.

Choose **Asset twin** in the application to inspect the synthetic pump. Its telemetry and command effects are generated inside the demo: no IoT device, industrial network, customer historian, or physical actuator is connected. Analytics are deterministic demonstrations over synthetic history, not validated machine-learning predictions. Control previews and receipts explicitly report simulation mode and no external write.

Choose **Event intelligence** to enter what happened or ask what if. Try `Sarah, the lead backend engineer, left the company today.`, `Our AWS database experienced a 3-hour outage yesterday.`, or `We might lose our largest customer because they are unhappy.` The workspace separates verified reality review from scenario-only claims, exposes entity matching and direct/downstream/unknown impacts, and keeps every applied effect inside the synthetic tenant projection. Event text cannot become instructions, authority, an HR action, an identity change, or another external write.

Choose **AI Control Center** for the real model-backed intelligence layer: provider readiness and usage, seven bounded agents, permission-aware retrieval, document import, AI activity, evidence-bearing suggestions, and human review. AI output is always `PENDING_REVIEW`; approving a suggestion records validation but does not mutate the graph, simulation rules, events, or an external system.

### Configure the real Llama integration

The repository contains no provider credential and does not simulate one. Without a configured provider, the deterministic twin remains usable, AI status reports unavailable, and model-backed calls fail closed.

Create a server API key in the Meta Llama developer console, then add the exact model available to your account to the ignored local `.env`:

```dotenv
AI_PROVIDER_DEFAULT=llama
AI_REASONING_PROVIDER=llama
LLAMA_API_KEY=your-real-server-key
LLAMA_MODEL=your-exact-account-model-id
# Optional when using Meta's default https://api.llama.com/v1/ base URL:
LLAMA_ENDPOINT=https://api.llama.com/v1/
```

Rebuild and restart with `npm run demo`, then check **AI Control Center**. Provider credentials stay in the AI worker and are never sent to the browser or public API.

Vector retrieval is independently configured because the hosted Llama SDK does not expose an embeddings resource. To enable real semantic embeddings, configure an approved OpenAI-compatible endpoint/model; otherwise imports remain available for lexical retrieval and the UI honestly reports vector retrieval unavailable:

```dotenv
AI_EMBEDDING_API_KEY=your-embedding-provider-key
AI_EMBEDDING_MODEL=your-exact-embedding-model-id
AI_EMBEDDING_ENDPOINT=https://your-provider.example/v1/embeddings
AI_VECTOR_DIMENSIONS=256
```

See [AI architecture](docs/AI_ARCHITECTURE.md), [agents](docs/AI_AGENTS.md), [provider setup](docs/AI_PROVIDER_SYSTEM.md), [security](docs/AI_SECURITY.md), and [RAG/memory](docs/RAG_ARCHITECTURE.md) for the implementation contracts and limitations.

Verify the full machine-driven journey, including replay protection and compensation:

```powershell
npm run demo:verify
```

To exercise an API fixture principal from a terminal, mint a 15-minute local token without exposing the signing secret:

```powershell
npm run demo:token -- usr_aster_analyst
```

Useful lifecycle commands:

```powershell
node scripts/edt.mjs status
node scripts/edt.mjs logs api
node scripts/edt.mjs stop
node scripts/edt.mjs reset --yes
```

`reset --yes` removes only this Compose project's synthetic named volumes.

## Develop and validate from source

Use Node.js 24 and Python 3.12 for the same toolchain as application CI.

```powershell
npm ci
python -m pip install --editable "apps/ai-worker[test]"
npm run typecheck --workspaces --if-present
npm test
npm run build
python scripts/validate_deployment.py
```

The web app can run with static demonstration data when no API is available:

```powershell
$env:NEXT_PUBLIC_ENABLE_DEMO_DATA='true'
npm run dev:web
```

That mode is explicitly labeled and is not acceptance evidence. The live adapter is the default in Compose and CI.

## Build the architecture publication

The authoritative entry point is [the specification index](docs/enterprise-digital-twin/README.md). Generated reader editions are written under `output/`.

```powershell
npm run docs
python scripts/test_traceability_fail_closed.py
```

This validates metadata, stable identifiers, traceability, contracts, catalogs, citations, diagrams, fixtures, architecture gates, and then generates consolidated Markdown, HTML, and PDF editions.

## Repository map

| Path | Purpose |
|---|---|
| `apps/web` | Next.js/React operator experience |
| `apps/api` | NestJS/Fastify policy and command API |
| `apps/sync-worker` | Deterministic connector, synchronization, outbox, and projection worker |
| `apps/ai-worker` | Central FastAPI AI gateway, permission-aware RAG, specialized agents, graph analysis, and deterministic simulation boundary |
| `docs/enterprise-digital-twin` | Normative chapters, ADRs, contracts, catalogs, diagrams, fixtures, and reviews |
| `deploy/helm` | H2 Kubernetes/Helm deployment profile |
| `deploy/opentofu` | H2 cloud-neutral infrastructure wrapper |
| `scripts` | Demo lifecycle, live verification, specification build, and validation tooling |

## Extensible twin graph foundation

The API now includes a tenant-scoped canonical graph foundation under `/v1/twin`. It stores nodes, first-class relationships, typed history events, source references, confidence, ownership, simulation hooks, and AI capability descriptors through the existing PostgreSQL/RLS, audit-chain, idempotency, and transactional-outbox path. Neo4j remains a rebuildable projection rather than an authority.

Tenant graph administrators can register namespaced custom node and relationship types, then create or conditionally update graph records. Default node types cover organization, business, technology, operations, and financial entities. Read APIs provide filtering and search, bounded traversal, dependency analysis, weighted impact propagation, and structural critical-node ranking. Graph writes require the existing `connector.admin` capability; reads are classification-filtered and never accept a caller-selected tenant. The API rejects secret-like property names and unbounded graph queries. See the controller routes in `apps/api/src/twin-graph.controller.ts` for the precise contract.

## Deliberate boundaries

- Only the allowlisted synthetic Jira issue `AST-142` can be mutated in H1.
- Asset telemetry is synthetic and advanced by the local simulator; H1 has no MQTT, OPC UA, Modbus, SCADA, PLC, historian, or real IoT integration.
- Asset commands modify only tenant-scoped simulator state. They cannot send a command to physical equipment.
- Asset anomaly and remaining-useful-life outputs demonstrate deterministic analytics; they are not calibrated or validated for maintenance or safety decisions.
- Event interpretation and causal links are deterministic synthetic demonstrations. A displayed cause-effect chain is an evidence-linked rule explanation, not proof of real-world causality or a calibrated prediction.
- AI Control Center agents use a real configured provider; there is no hardcoded or keyword model substitute. Their outputs are assistive, evidence-bearing suggestions and cannot establish truth or mutate state.
- Llama/API availability and model quality are external dependencies. A configured key alone is not production acceptance evidence; the exact route must pass the applicable golden, isolation, injection, schema, latency, and cost evaluations.
- Event application changes only the persisted synthetic tenant projection. It cannot modify an HRIS, IAM provider, production system, customer account, physical device, or another external system.
- Individual productivity, burnout, attrition, performance, health, compensation, emotion, misconduct, and hiring scoring are prohibited.
- Customer data is not shared across tenants for retrieval, resolution, memory, analytics, training, or evaluation.
- H3-H5 scale, deployment, causal-prediction, and autonomous-organization capabilities are Provisional or Research, not current product claims.
- SOC 2, ISO 27001, and GDPR references describe control alignment and evidence readiness, not certification or legal conclusions.
