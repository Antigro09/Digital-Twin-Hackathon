"""Fast, dependency-free source audit used locally and in CI."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOTS = (ROOT / "apps", ROOT / "deploy", ROOT / "scripts")
IGNORED_PARTS = {"node_modules", "dist", "build", ".next", "__pycache__"}
TEXT_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".json", ".yaml", ".yml", ".sql", ".tf", ".md"}
SECRET_PATTERNS = {
    "private key": re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "generic live key": re.compile(r"\b(?:sk|rk)-[A-Za-z0-9_-]{20,}\b"),
}
DISALLOWED_UI = {
    "gradient": re.compile(r"(?:linear|radial)-gradient\("),
    "backdrop blur": re.compile(r"backdrop-filter\s*:\s*blur", re.I),
}


def files():
    for root in SOURCE_ROOTS:
        for path in root.rglob("*"):
            if path.is_file() and path.suffix.casefold() in TEXT_SUFFIXES and not IGNORED_PARTS.intersection(path.parts):
                yield path


def main() -> int:
    findings: list[str] = []
    for path in files():
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        relative = path.relative_to(ROOT).as_posix()
        if not relative.endswith((".test.ts", ".test.tsx", "_test.py", ".md")):
            for label, pattern in SECRET_PATTERNS.items():
                if pattern.search(content):
                    findings.append(f"SECRET {label}: {relative}")
        if relative == "apps/web/src/app/globals.css":
            for label, pattern in DISALLOWED_UI.items():
                if pattern.search(content):
                    findings.append(f"UX {label}: {relative}")
    required = [
        "apps/ai-worker/src/edt_ai_worker/authorization.py",
        "apps/ai-worker/src/edt_ai_worker/enterprise_audit.py",
        "apps/ai-worker/src/edt_ai_worker/governance.py",
        "apps/ai-worker/src/edt_ai_worker/mcp.py",
        "apps/ai-worker/src/edt_ai_worker/industry_models.py",
    ]
    findings.extend(f"ARCH missing boundary: {item}" for item in required if not (ROOT / item).is_file())
    if findings:
        print("Continuous audit failed:")
        print("\n".join(f"- {item}" for item in sorted(findings)))
        return 1
    print("Continuous audit passed: secret patterns, UX policy, and architecture boundaries.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
