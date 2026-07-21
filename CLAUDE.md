# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Enterprise Digital Twin is a runnable "H1" demonstrator plus the source-controlled enterprise architecture blueprint behind it. It has two independent deliverables that live in the same repo:

1. **The application** (`apps/*`, `compose.yaml`, `deploy/*`) — a permission-aware graph over deterministic synthetic GitHub/Jira data, a synthetic physical-asset (pump) twin, an event-intelligence path, and a real model-backed "AI Control Center" whose output is always advisory (`PENDING_REVIEW`).
2. **The blueprint** (`docs/enterprise-digital-twin/**`) — the normative spec (chapters, ADRs, contracts, catalogs, diagrams, reviews) that builds to `output/` as Markdown/HTML/PDF editions.

All demo data and provider effects in the application are synthetic. Read README.md's "Deliberate boundaries" section before changing behavior near tenancy, AI mutation, or individual-scoring — those boundaries are intentional product constraints, not gaps to fill in.

## Common commands

### Run the full demo (Docker Compose)

```powershell
Copy-Item .env.example .env
npm run demo                              # node scripts/edt.mjs start — builds + starts everything, seeds Aster/Beacon tenants
npm run demo:verify                       # full live machine-driven journey incl. replay protection and compensation
npm run demo:token -- usr_aster_analyst   # mint a 15-minute fixture-principal token
node scripts/edt.mjs status|logs <service>|stop|reset --yes
```

### Source development (Node 24 + Python 3.12, matching CI)

```powershell
npm ci
python -m pip install --editable "apps/ai-worker[test]"
npm run typecheck --workspaces --if-present
npm test              # runs every workspace's test script + `python -m pytest apps/ai-worker/tests -q`
npm run build         # build --workspaces --if-present
python scripts/validate_deployment.py
```

Per-workspace (npm workspaces are `apps/api`, `apps/sync-worker`, `apps/web`; `apps/ai-worker` is a standalone Python project):

```powershell
npm run test --workspace @edt/api          # jest --config test/jest-e2e.json --runInBand over **/*.e2e-spec.ts
npx jest --config apps/api/test/jest-e2e.json --runInBand -t "<name>"   # single API test by name
npm run test --workspace @edt/web          # vitest run
npm run test --workspace @edt/web -- --run src/components/Foo.test.tsx  # single web test file
npm run test --workspace @edt/sync-worker  # vitest run
npm run dev:api / dev:web / dev:sync       # nest start --watch / next dev / tsx watch
```

```powershell
cd apps/ai-worker
python -m venv .venv; .venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
pytest                                       # all tests (pytest.ini_options already sets pythonpath=src)
pytest tests/test_decision_engines.py -q     # single file
pytest tests/test_decision_engines.py::test_name -q
uvicorn edt_ai_worker.api:app --host 127.0.0.1 --port 8080
```

Run the web app against static demo data instead of a live API (explicitly not acceptance evidence):

```powershell
$env:NEXT_PUBLIC_ENABLE_DEMO_DATA='true'
npm run dev:web
```

### Specification / blueprint build

```powershell
npm run docs                                # render_diagrams -> validate_blueprint -> build_blueprint -> render_pdf
python scripts/validate_blueprint.py
python scripts/test_traceability_fail_closed.py
```

Generated editions land under `output/` (md/html/pdf + `traceability-report.{md,json}`). The authoritative reading order is `docs/enterprise-digital-twin/README.md`; changing H1/H2 behavior requires an ADR, a `catalogs/traceability.yaml` update, and successful validation (see `docs/enterprise-digital-twin/decision-precedence.md`).

## Architecture

### Two independent CI surfaces

- `.github/workflows/application.yml` — triggers on `apps/**`, `deploy/**`, `scripts/**`, `compose.yaml`; type-checks/tests every workspace, builds all workloads, boots the AI worker + API in-process and runs a live end-to-end journey test, then builds the OCI images.
- `.github/workflows/blueprint.yml` — triggers on `docs/enterprise-digital-twin/**`; validates the spec, proves traceability fails closed, and renders the consolidated MD/HTML/PDF editions.

### Runtime topology (`compose.yaml` services)

`postgres` (+ `postgres-app-db-init`), `temporal` (+ `temporal-ui`), `neo4j`, `valkey`, `minio`, `ai-worker`, `api`, `sync-worker`, `web`. PostgreSQL is the system of record; **Neo4j is always a rebuildable projection, never an authority**.

### Authorization/tenancy pattern (`apps/api`)

- `context.service.ts` is the single place that derives tenant/actor/permission context from the authenticated principal, on every `/v1` request. It hard-rejects a caller-supplied `X-Tenant-ID` or `X-Demo-Actor` — tenant scope is never client-selected, by design (`app.module.ts` even documents that no raw tenant middleware exists on purpose).
- `database.service.ts` implements the shared mutation primitives every domain service builds on: idempotency guards (`Idempotency-Key` + request-hash replay), expected-record optimistic-concurrency checks, a transactional outbox, and a hash-chained audit trail (`EventMutationAudit`/`previous_hash`/`event_hash`). New domain mutations should go through these primitives rather than ad hoc SQL/transactions.
- Postgres RLS is enforced via a transaction-local `app.tenant_id`; the app DB role must not be superuser or `BYPASSRLS` (the AI worker's `edt_ai_worker` role is checked the same way).
- The AI worker only trusts `X-Internal-Tenant-Id` / `X-Internal-Actor-Id` / `X-Internal-Permissions` / `X-Internal-Service-Token` when they arrive from the API's private-network call, gated by `AI_WORKER_SHARED_SECRET` — never from a browser.

### AI layer (`apps/ai-worker`) — strict separation of concerns

- Deterministic math (`simulation.py`, `decision_engines.py`, `calendar_math.py`) never calls a model and fails closed. Each stochastic draw comes from a SHA-256 counter stream keyed by seed/engine-version/task/iteration/component, so results are reproducible regardless of input order or retries; the sampling/calendar/canonical-JSON implementation and engine version are pinned together and protected by golden vectors.
- `gateway.py` + `agents.py` + `providers.py` + `routing.py` are the only model-backed path (the "AI Gateway"). `AI_PROVIDER_DEFAULT`/`AI_REASONING_PROVIDER` select Llama (via Meta's official SDK) by default; OpenAI Responses is an optional *explicit* route, never a silent fallback used to dodge a refusal or validation failure.
- Every model-backed result is persisted `PENDING_REVIEW` with provenance and never mutates graph/simulation/prediction/external state directly. `APPROVE`/`REJECT` is a separate, idempotent, immutable review; approval persists validated enterprise memory only.
- `rag.py` is permission-aware retrieval: tenant + source-ACL filtering happens in the datastore query itself, before ranking and before result counts are returned.
- Full contracts: `docs/AI_ARCHITECTURE.md`, `docs/AI_AGENTS.md`, `docs/AI_PROVIDER_SYSTEM.md`, `docs/AI_SECURITY.md`, `docs/RAG_ARCHITECTURE.md`. `apps/ai-worker/` also carries shorter mirrors of the same docs — keep both in sync when this layer changes.

### Simulation vs. prediction ("decision intelligence" foundation)

- `/v1/twin/simulation/*` (`simulation-engine.service.ts`/`.controller.ts`, backed by the worker's deterministic math) seals graph-backed snapshots, creates/confirms typed scenario branches (hiring, pricing, supplier, expansion, budget), runs bounded relationship propagation plus deterministic derived-metric rules, and diffs each outcome against its immutable baseline.
- `/v1/twin/prediction/*` (`predictive-engine.service.ts`) registers versioned non-LLM models, turns historical observations into revenue/expense/churn/workforce/risk forecasts with confidence evidence, then records real outcomes and human validation to update rolling accuracy/calibration.
- **Simulation never calls prediction, and neither path invokes an LLM or oracle substitute.** The Nest API owns authorization/lifecycle/persistence/idempotency/audit/outbox; the Python worker (`decision_engines.py`/`decision_models.py`) owns only the math and fails closed.
- Migration `004_decision_intelligence_foundation.sql`, the corresponding ADR, the OpenAPI/AsyncAPI/JSON Schema contracts under `docs/enterprise-digital-twin/contracts`, `apps/api/test/decision-intelligence.e2e-spec.ts`, and `apps/ai-worker/tests/test_decision_engines.py` are the acceptance evidence for this layer — keep all of them in sync with any change here.

### Data & integration foundation

- `/v1/twin/data-architecture` declares four governed planes: authoritative PostgreSQL, rebuildable Neo4j projection, isolated AI/vector knowledge, and append-only historical/raw retention.
- Connector and MCP-server registries (`/v1/twin/connectors`, `/v1/twin/mcp-servers`, in `integration-registry.service.ts`) store only governed secret *references*, never credential values, and deliberately never execute a connector or MCP tool inside the API process.
- Migration `003_data_integration_foundation.sql` database-enforces tenant/resource identity, record shapes, quality-score ranges, and active-integration invariants.

### Twin graph

Tenant-scoped canonical graph under `/v1/twin` (`twin-graph.service.ts`/`.controller.ts`): nodes, first-class relationships, typed history events, provenance, confidence, ownership, and simulation hooks. Graph writes require `connector.admin`; reads are classification-filtered and never accept a caller-selected tenant. Secret-like property names and unbounded graph queries are rejected outright.

## Deliberate product boundaries (don't silently relax these)

See README.md's "Deliberate boundaries" section for the complete list. The ones most likely to matter while coding:

- Only the synthetic Jira issue `AST-142` is mutable in H1; asset telemetry/commands touch only the local simulator, never real IoT/OT/SCADA.
- Individual productivity, burnout, attrition, performance, health, compensation, emotion, misconduct, or hiring scoring is prohibited anywhere in this codebase.
- Customer data never crosses tenants for retrieval, entity resolution, memory, analytics, training, or evaluation.
- AI output is always advisory/`PENDING_REVIEW`; it cannot mutate the graph, simulation, prediction, or an external system by itself — that always requires an existing deterministic domain command.
- H3–H5 scale/deployment/causal-prediction/autonomous-organization capabilities are Provisional or Research — don't present them as already shipped.
