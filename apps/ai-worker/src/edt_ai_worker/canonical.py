from __future__ import annotations

import hashlib
import math
import struct
from datetime import date, datetime, timezone
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel
import rfc8785


def _normalise(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return _normalise(value.model_dump(mode="python"))
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("naive datetime cannot be canonicalised")
        utc = value.astimezone(timezone.utc)
        if utc.microsecond:
            return utc.isoformat(timespec="microseconds").replace("+00:00", "Z")
        return utc.isoformat(timespec="seconds").replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Enum):
        return _normalise(value.value)
    if isinstance(value, dict):
        return {str(key): _normalise(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalise(item) for item in value]
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non-finite number cannot be canonicalised")
        if value == 0:
            return 0.0
    return value


def canonical_json_bytes(value: Any) -> bytes:
    """Return RFC 8785 JSON Canonicalization Scheme bytes."""

    return rfc8785.dumps(_normalise(value))


def sha256_hex(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def hash_without(value: BaseModel | dict[str, Any], *keys: str) -> str:
    raw = value.model_dump(mode="python") if isinstance(value, BaseModel) else dict(value)
    for key in keys:
        raw.pop(key, None)
    return sha256_hex(raw)


def _part(value: str | bytes | int) -> bytes:
    if isinstance(value, int):
        raw = value.to_bytes(8, "big", signed=False)
    elif isinstance(value, str):
        raw = value.encode("utf-8")
    else:
        raw = value
    return struct.pack(">I", len(raw)) + raw


class CounterStream:
    """Order-independent deterministic random stream backed by SHA-256 counters."""

    __slots__ = ("_prefix", "_counter")

    def __init__(self, seed: int, engine_version: str, task_id: UUID, iteration: int) -> None:
        if seed < 0 or seed > (2**64 - 1):
            raise ValueError("seed is outside uint64")
        if iteration < 0:
            raise ValueError("iteration is negative")
        self._prefix = b"".join(
            (
                _part(seed),
                _part(engine_version),
                _part(task_id.bytes),
                _part(iteration),
            )
        )
        self._counter = 0

    def uniform_open(self) -> float:
        digest = hashlib.sha256(self._prefix + _part(self._counter)).digest()
        self._counter += 1
        # A fixed 53-bit midpoint never returns exactly zero or one.
        mantissa = int.from_bytes(digest[:8], "big") >> 11
        return (mantissa + 0.5) / float(2**53)

    def normal(self) -> float:
        # Box-Muller with fixed draw consumption.
        u1 = self.uniform_open()
        u2 = self.uniform_open()
        return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)

    def gamma(self, shape: float) -> float:
        if not math.isfinite(shape) or shape <= 0:
            raise ValueError("gamma shape must be finite and positive")
        if shape < 1.0:
            # Boosting transformation; the recursive call uses the same stream.
            return self.gamma(shape + 1.0) * self.uniform_open() ** (1.0 / shape)
        d = shape - (1.0 / 3.0)
        c = 1.0 / math.sqrt(9.0 * d)
        for _ in range(10_000):
            x = self.normal()
            v_base = 1.0 + c * x
            if v_base <= 0:
                continue
            v = v_base**3
            u = self.uniform_open()
            if u < 1.0 - 0.0331 * x**4:
                return d * v
            if math.log(u) < 0.5 * x * x + d * (1.0 - v + math.log(v)):
                return d * v
        raise RuntimeError("deterministic gamma sampler failed to converge")

    def beta(self, alpha: float, beta: float) -> float:
        left = self.gamma(alpha)
        right = self.gamma(beta)
        return left / (left + right)
