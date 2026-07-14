#!/usr/bin/env python3
"""Prove mandatory trace dimensions fail closed under realistic catalog damage."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

import yaml


ROOT = Path(__file__).resolve().parents[1]


def run_negative_case(name: str, mutate: Callable[[dict[str, Any]], None], expected_text: str) -> None:
    with tempfile.TemporaryDirectory(prefix=f"edt-trace-{name}-") as raw_temp:
        temp_root = Path(raw_temp)
        shutil.copytree(ROOT / "docs", temp_root / "docs")
        (temp_root / "scripts").mkdir()
        shutil.copy2(ROOT / "scripts/validate_blueprint.py", temp_root / "scripts/validate_blueprint.py")

        trace_path = temp_root / "docs/enterprise-digital-twin/catalogs/traceability.yaml"
        trace = yaml.safe_load(trace_path.read_text(encoding="utf-8"))
        if not isinstance(trace, dict):
            raise AssertionError("traceability catalog did not parse as a mapping")
        mutate(trace)
        trace_path.write_text(yaml.safe_dump(trace, sort_keys=False, allow_unicode=True), encoding="utf-8")

        result = subprocess.run(
            [
                sys.executable,
                str(temp_root / "scripts/validate_blueprint.py"),
                "--repo-root",
                str(temp_root),
            ],
            cwd=temp_root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        if result.returncode == 0:
            raise AssertionError(f"{name}: damaged traceability unexpectedly passed\n{result.stdout}")
        if expected_text not in result.stdout:
            raise AssertionError(f"{name}: validator failed for the wrong reason; expected {expected_text!r}\n{result.stdout}")


def remove_test_mapping(trace: dict[str, Any]) -> None:
    trace["rules"][0].pop("tests_evaluations", None)


def misroute_roadmap(trace: dict[str, Any]) -> None:
    trace["rules"][0]["roadmap"] = ["H2"]


def main() -> int:
    run_negative_case("missing-test", remove_test_mapping, "REQ-GOV-001 has no tests_evaluations trace")
    run_negative_case("wrong-roadmap", misroute_roadmap, "REQ-GOV-001 has no roadmap trace")
    print("Traceability fail-closed proof passed: missing test and wrong roadmap mappings were rejected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
