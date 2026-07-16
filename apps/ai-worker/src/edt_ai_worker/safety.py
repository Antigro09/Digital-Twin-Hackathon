from __future__ import annotations

import json
import re
import unicodedata
from hashlib import sha256
from typing import Any

from .errors import DomainError


_INJECTION_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "instruction_override_attempt",
        re.compile(r"\b(?:ignore|disregard|override)\b.{0,80}\b(?:instructions?|system|developer|policy)\b", re.I | re.S),
    ),
    (
        "prompt_exfiltration_attempt",
        re.compile(r"\b(?:reveal|print|repeat|show)\b.{0,80}\b(?:system prompt|developer message|hidden instructions?)\b", re.I | re.S),
    ),
    (
        "credential_exfiltration_attempt",
        re.compile(r"\b(?:api[_ -]?key|password|secret|credential|access[_ -]?token)\b.{0,80}\b(?:reveal|send|print|exfiltrate|return)\b", re.I | re.S),
    ),
    (
        "tool_instruction_attempt",
        re.compile(r"\b(?:execute|run|call|invoke)\b.{0,80}\b(?:shell|terminal|tool|function|command)\b", re.I | re.S),
    ),
    (
        "secret_material_detected",
        re.compile(
            r"(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|"
            r"\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b|"
            r"\b(?:password|passwd|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*[^\s,;]{8,})",
            re.I,
        ),
    ),
)


def content_sha256(value: str | bytes) -> str:
    raw = value.encode("utf-8") if isinstance(value, str) else value
    return sha256(raw).hexdigest()


def inspect_untrusted_content(content: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", content)[:2_000_000]
    return [name for name, pattern in _INJECTION_PATTERNS if pattern.search(normalized)]


def reject_injected_instruction(payload: dict[str, Any]) -> None:
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if inspect_untrusted_content(serialized):
        raise DomainError(
            "prompt_injection_detected",
            "The request contains instructions that cannot be safely processed.",
            status_code=422,
        )


def assert_no_secret(payload: Any, secrets: tuple[str, ...]) -> None:
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    flags = inspect_untrusted_content(serialized)
    if any(secret in serialized for secret in secrets) or "secret_material_detected" in flags:
        raise DomainError(
            "unsafe_ai_provider_output",
            "The AI provider output failed the security gate.",
            status_code=502,
        )


def actor_hash(tenant_id: str, actor_id: str) -> str:
    return sha256(f"{tenant_id}:{actor_id}".encode("utf-8")).hexdigest()
