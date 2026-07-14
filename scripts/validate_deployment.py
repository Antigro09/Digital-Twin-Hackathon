from __future__ import annotations

import re
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]


def require(path: str) -> Path:
    candidate = ROOT / path
    if not candidate.is_file():
        raise SystemExit(f"missing deployment artifact: {path}")
    return candidate


compose = yaml.safe_load(require("compose.yaml").read_text(encoding="utf-8"))
dockerignore = require(".dockerignore").read_text(encoding="utf-8").splitlines()
for required_pattern in (".git", "**/node_modules", "output"):
    if required_pattern not in dockerignore:
        raise SystemExit(f".dockerignore must exclude {required_pattern}")
services = compose.get("services", {})
expected = {"api", "web", "sync-worker", "ai-worker", "postgres", "temporal", "neo4j", "valkey", "minio"}
missing = expected - set(services)
if missing:
    raise SystemExit(f"compose.yaml is missing services: {sorted(missing)}")
for workload in ("api", "web", "sync-worker", "ai-worker"):
    service = services[workload]
    if "build" not in service or "healthcheck" not in service or service.get("restart") != "unless-stopped":
        raise SystemExit(f"{workload} must be built locally, health-checked, and restartable")

chart = yaml.safe_load(require("deploy/helm/enterprise-digital-twin/Chart.yaml").read_text(encoding="utf-8"))
if chart.get("apiVersion") != "v2" or chart.get("type") != "application":
    raise SystemExit("Helm chart metadata is invalid")
for relative in (
    "deploy/helm/enterprise-digital-twin/values.yaml",
    "deploy/helm/enterprise-digital-twin/templates/deployments.yaml",
    "deploy/helm/enterprise-digital-twin/templates/services.yaml",
    "deploy/helm/enterprise-digital-twin/templates/networkpolicy.yaml",
    "deploy/opentofu/h2/versions.tf",
    "deploy/opentofu/h2/main.tf",
    "deploy/opentofu/h2/variables.tf",
):
    require(relative)

for workflow in (ROOT / ".github/workflows").glob("*.yml"):
    content = workflow.read_text(encoding="utf-8")
    floating = re.findall(r"uses:\s+[^\s#]+@(?![0-9a-f]{40}(?:\s|$))[^\s#]+", content)
    if floating:
        raise SystemExit(f"{workflow.relative_to(ROOT)} contains floating action references: {floating}")

print("Deployment validation passed: Compose, Helm, OpenTofu, and pinned CI actions are present.")
