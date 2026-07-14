# Enterprise Digital Twin

This repository contains a runnable, production-shaped H1 demonstrator and the source-controlled enterprise architecture blueprint behind it. The organizational path turns deterministic synthetic GitHub and Jira observations into a permission-aware graph, produces a cited launch-risk answer, runs a reproducible PERT/Monte Carlo scenario, and governs one exact Jira remediation through two-person approval, idempotent execution, and separately approved compensation. A second synthetic physical-asset path adds advancing telemetry, an interactive rotatable 3D-style pump view, deterministic anomaly/forecast demonstrations, lifecycle history, and guarded simulated controls.

The current specification is `1.0.0-rc.1`. Its H1/H2 decisions are Committed, but final `1.0.0` publication remains gated on the independent build-readiness confirmation defined in the blueprint.

## Run the complete H1 demo

Prerequisites are Docker Desktop with Compose v2 and Node.js 22 or newer. All demo data and provider effects are synthetic.

```powershell
Copy-Item .env.example .env
npm run demo
```

Open <http://localhost:3000>. The launcher builds all four application workloads, starts PostgreSQL, Temporal, Neo4j, Valkey, and MinIO, waits for readiness, and seeds the isolated Aster and Beacon tenants.

Choose **Asset twin** in the application to inspect the synthetic pump. Its telemetry and command effects are generated inside the demo: no IoT device, industrial network, customer historian, or physical actuator is connected. Analytics are deterministic demonstrations over synthetic history, not validated machine-learning predictions. Control previews and receipts explicitly report simulation mode and no external write.

Verify the full machine-driven journey, including replay protection and compensation:

```powershell
npm run demo:verify
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
| `apps/ai-worker` | FastAPI graph-analysis and deterministic simulation boundary |
| `docs/enterprise-digital-twin` | Normative chapters, ADRs, contracts, catalogs, diagrams, fixtures, and reviews |
| `deploy/helm` | H2 Kubernetes/Helm deployment profile |
| `deploy/opentofu` | H2 cloud-neutral infrastructure wrapper |
| `scripts` | Demo lifecycle, live verification, specification build, and validation tooling |

## Deliberate boundaries

- Only the allowlisted synthetic Jira issue `AST-142` can be mutated in H1.
- Asset telemetry is synthetic and advanced by the local simulator; H1 has no MQTT, OPC UA, Modbus, SCADA, PLC, historian, or real IoT integration.
- Asset commands modify only tenant-scoped simulator state. They cannot send a command to physical equipment.
- Asset anomaly and remaining-useful-life outputs demonstrate deterministic analytics; they are not calibrated or validated for maintenance or safety decisions.
- Individual productivity, burnout, attrition, performance, health, compensation, emotion, misconduct, and hiring scoring are prohibited.
- Customer data is not shared across tenants for retrieval, resolution, memory, analytics, training, or evaluation.
- H3-H5 scale, deployment, causal-prediction, and autonomous-organization capabilities are Provisional or Research, not current product claims.
- SOC 2, ISO 27001, and GDPR references describe control alignment and evidence readiness, not certification or legal conclusions.
