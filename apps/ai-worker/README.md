# Enterprise Digital Twin H1 AI worker

This service is the bounded Python workload for the H1 demonstrator. It validates and seals immutable simulation snapshots, runs a seeded Beta-PERT/Monte Carlo dependency scheduler, and exposes deterministic evidence-only answer and extraction stubs. It makes no external model calls and accepts only the two frozen synthetic H1 tenants.

## Run locally

```powershell
cd apps/ai-worker
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
pytest
uvicorn edt_ai_worker.api:app --host 127.0.0.1 --port 8080
```

The internal HTTP boundary expects `X-Internal-Tenant-Id` on every non-health request. This header is trusted only after the platform API has authenticated the caller and derived tenant context; it is not a public tenant selector. Payload tenant bindings must exactly match it. The only accepted tenant IDs are:

- Aster Labs: `10000000-0000-4000-8000-000000000001`
- Beacon Works: `10000000-0000-4000-8000-000000000002`

## Endpoints

- `GET /health/live` and `GET /health/ready`
- `POST /v1/snapshots/seal` creates canonical calendar and snapshot hashes after semantic validation.
- `POST /v1/simulations` validates a sealed snapshot and optional confirmed scenario, then returns a complete synchronous H1 result. `sample_count=50000` is the committed run; smaller counts are explicit previews.
- `POST /v1/grounded-answers` emits only proposed statements that exactly match typed supporting evidence, otherwise it abstains.
- `POST /v1/extractions` copies requested structured facts from typed evidence and reports missing fields without inference.

## Determinism and safety boundary

Each stochastic task draw comes from a SHA-256 counter stream keyed by the unsigned seed, engine version, task UUID, iteration, and component counter. Consequently input order, process hash randomization, batching, and retries cannot affect a result. Baseline and scenario runs reuse the same streams. A pure shift of a PERT triple therefore preserves the variate exactly. The sampling algorithm, calendar implementation, canonical JSON implementation, and engine version are pinned together and protected by golden vectors.

The scheduler is a stable aggregate-team list scheduler over a validated DAG. It models finish-to-start dependencies, lags, working calendars, release constraints, aggregate parallel capacity, and availability. It does **not** model or score individuals, infer productivity, claim causal effects, or establish predictive validity from synthetic data.

`result_sha256` excludes run IDs and timestamps, so equivalent committed inputs reproduce the same computational hash. Cached values are stored under `(tenant_id, result_hash)` and every outbound payload is scanned for the other synthetic tenant's identifier. A result never acts as an authorization decision; the platform must re-evaluate source ACLs before access or explanation.

Implementation guardrails are intentionally narrower than the future enterprise research envelope: 500 active tasks, 5,000 dependency edges, 50,000 trials, and at most 64 exact sensitivity series per run. A larger request fails explicitly.

