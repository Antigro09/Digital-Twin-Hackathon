from __future__ import annotations

import math
import time
from abc import ABC, abstractmethod
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from .errors import DomainError
from .intelligence_models import TokenUsage
from .settings import AISettings


@dataclass(frozen=True)
class EmbeddingResponse:
    vectors: list[list[float]]
    usage: TokenUsage
    model: str


class EmbeddingProvider(ABC):
    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return self.embed_with_usage(texts).vectors

    @abstractmethod
    def embed_with_usage(self, texts: Sequence[str]) -> EmbeddingResponse:
        raise NotImplementedError


def _token_count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainError(
            "invalid_embedding_output",
            "The embedding provider returned invalid token usage.",
            status_code=502,
        )
    numeric = value
    if (
        numeric < 0
        or (isinstance(numeric, float) and not math.isfinite(numeric))
        or (isinstance(numeric, float) and not numeric.is_integer())
    ):
        raise DomainError(
            "invalid_embedding_output",
            "The embedding provider returned invalid token usage.",
            status_code=502,
        )
    return int(numeric)


class OpenAICompatibleEmbeddingProvider(EmbeddingProvider):
    """Real OpenAI-compatible `/embeddings` adapter; never synthesizes vectors."""

    def __init__(
        self,
        settings: AISettings,
        *,
        client: httpx.Client | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        if not settings.embedding_api_key or not settings.embedding_model:
            raise DomainError(
                "embedding_provider_not_configured",
                "Vector retrieval is not configured.",
                status_code=503,
            )
        self.settings = settings
        self.client = client or httpx.Client(
            timeout=float(settings.timeout_seconds),
            headers={
                "Authorization": f"Bearer {settings.embedding_api_key}",
                "Content-Type": "application/json",
            },
        )
        self.sleeper = sleeper

    def embed_with_usage(self, texts: Sequence[str]) -> EmbeddingResponse:
        if not texts or len(texts) > 100:
            raise DomainError(
                "invalid_embedding_batch",
                "Embedding batches must contain between 1 and 100 items.",
                status_code=422,
            )
        payload = {
            "model": self.settings.embedding_model,
            "input": list(texts),
            "dimensions": self.settings.vector_dimensions,
            "encoding_format": "float",
        }
        for attempt in range(self.settings.max_retries + 1):
            try:
                response = self.client.post(self.settings.embedding_endpoint, json=payload)
                retryable = response.status_code in {408, 409, 429} or response.status_code >= 500
                if response.status_code >= 400:
                    if retryable and attempt < self.settings.max_retries:
                        self.sleeper(min(0.25 * (2**attempt), 2.0))
                        continue
                    raise DomainError(
                        "embedding_provider_unavailable" if retryable else "embedding_provider_failed",
                        "The embedding provider could not complete the request.",
                        status_code=503 if retryable else 502,
                    )
                try:
                    body = response.json()
                except ValueError as exc:
                    raise DomainError(
                        "invalid_embedding_output",
                        "The embedding provider returned malformed output.",
                        status_code=502,
                    ) from exc
                if not isinstance(body, dict) or not isinstance(body.get("data"), list):
                    raise DomainError(
                        "invalid_embedding_output",
                        "The embedding provider returned malformed output.",
                        status_code=502,
                    )
                if not all(isinstance(item, dict) for item in body["data"]):
                    raise DomainError(
                        "invalid_embedding_output",
                        "The embedding provider returned malformed output.",
                        status_code=502,
                    )
                indexes = [item.get("index") for item in body["data"]]
                if any(isinstance(index, bool) or not isinstance(index, int) for index in indexes):
                    raise DomainError(
                        "invalid_embedding_output",
                        "The embedding provider returned invalid item indexes.",
                        status_code=502,
                    )
                if sorted(indexes) != list(range(len(texts))):
                    raise DomainError(
                        "invalid_embedding_output",
                        "The embedding provider returned an incomplete batch.",
                        status_code=502,
                    )
                ordered = sorted(body["data"], key=lambda item: item["index"])
                vectors = [item.get("embedding") for item in ordered]
                if len(vectors) != len(texts):
                    raise DomainError(
                        "invalid_embedding_output",
                        "The embedding provider returned an incomplete batch.",
                        status_code=502,
                    )
                validated: list[list[float]] = []
                for vector in vectors:
                    if not isinstance(vector, list) or len(vector) != self.settings.vector_dimensions:
                        raise DomainError(
                            "invalid_embedding_output",
                            "The embedding provider returned an unexpected vector dimension.",
                            status_code=502,
                        )
                    if any(
                        isinstance(value, bool) or not isinstance(value, (int, float))
                        for value in vector
                    ):
                        raise DomainError(
                            "invalid_embedding_output",
                            "The embedding provider returned invalid vector values.",
                            status_code=502,
                        )
                    converted = [float(value) for value in vector]
                    if any(not math.isfinite(value) for value in converted):
                        raise DomainError(
                            "invalid_embedding_output",
                            "The embedding provider returned non-finite values.",
                            status_code=502,
                        )
                    validated.append(converted)
                usage = body.get("usage")
                if not isinstance(usage, dict) or "prompt_tokens" not in usage:
                    raise DomainError(
                        "invalid_embedding_output",
                        "The embedding provider did not report token usage.",
                        status_code=502,
                    )
                input_tokens = _token_count(usage["prompt_tokens"])
                total_tokens = (
                    _token_count(usage["total_tokens"])
                    if "total_tokens" in usage
                    else input_tokens
                )
                if total_tokens < input_tokens:
                    raise DomainError(
                        "invalid_embedding_output",
                        "The embedding provider returned inconsistent token usage.",
                        status_code=502,
                    )
                response_model = body.get("model", self.settings.embedding_model)
                if not isinstance(response_model, str) or not response_model:
                    raise DomainError(
                        "invalid_embedding_output",
                        "The embedding provider returned an invalid model identifier.",
                        status_code=502,
                    )
                return EmbeddingResponse(
                    vectors=validated,
                    usage=TokenUsage(
                        input_tokens=input_tokens,
                        output_tokens=0,
                        total_tokens=total_tokens,
                    ),
                    model=response_model,
                )
            except DomainError:
                raise
            except (httpx.TimeoutException, httpx.TransportError):
                if attempt >= self.settings.max_retries:
                    break
                self.sleeper(min(0.25 * (2**attempt), 2.0))
        raise DomainError(
            "embedding_provider_unavailable",
            "The embedding provider could not complete the request.",
            status_code=503,
        )
