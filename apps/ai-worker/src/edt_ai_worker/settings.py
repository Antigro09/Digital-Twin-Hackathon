from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlparse

from .errors import DomainError


def _integer(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise DomainError("invalid_ai_configuration", f"{name} must be an integer.", status_code=500) from exc
    if not minimum <= value <= maximum:
        raise DomainError(
            "invalid_ai_configuration",
            f"{name} must be between {minimum} and {maximum}.",
            status_code=500,
        )
    return value


def _decimal(name: str) -> Decimal | None:
    raw = os.getenv(name, "").strip()
    if not raw:
        return None
    try:
        value = Decimal(raw)
    except InvalidOperation as exc:
        raise DomainError("invalid_ai_configuration", f"{name} must be a decimal.", status_code=500) from exc
    if value < 0:
        raise DomainError("invalid_ai_configuration", f"{name} cannot be negative.", status_code=500)
    return value


def _boolean(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().casefold() in {"1", "true", "yes", "on"}


def _endpoint(name: str, value: str, *, allow_docker_host_gateway: bool = False) -> str:
    parsed = urlparse(value)
    loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    docker_host_gateway = allow_docker_host_gateway and parsed.hostname == "host.docker.internal"
    if (
        not parsed.hostname
        or parsed.scheme not in ({"https"} if not (loopback or docker_host_gateway) else {"https", "http"})
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise DomainError(
            "invalid_ai_configuration",
            f"{name} must be an HTTPS endpoint (HTTP is limited to loopback or the explicit Docker host gateway).",
            status_code=500,
        )
    return value


@dataclass(frozen=True)
class ProviderPricing:
    input_usd_per_million: Decimal | None
    output_usd_per_million: Decimal | None

    @property
    def configured(self) -> bool:
        return self.input_usd_per_million is not None and self.output_usd_per_million is not None


@dataclass(frozen=True)
class AISettings:
    llama_api_key: str | None
    llama_model: str | None
    llama_reasoning_model: str | None
    llama_endpoint: str
    ollama_api_key: str | None
    ollama_model: str | None
    ollama_endpoint: str
    openai_api_key: str | None
    openai_model: str | None
    openai_endpoint: str
    anthropic_api_key: str | None
    anthropic_model: str | None
    anthropic_endpoint: str
    custom_api_key: str | None
    custom_model: str | None
    custom_endpoint: str | None
    embedding_api_key: str | None
    embedding_model: str | None
    embedding_endpoint: str
    default_provider: str
    reasoning_provider: str
    timeout_seconds: int
    max_retries: int
    max_input_tokens: int
    max_output_tokens: int
    requests_per_minute: int
    cache_ttl_seconds: int
    max_cache_entries: int
    max_document_bytes: int
    max_retrieval_candidates: int
    vector_dimensions: int
    session_ttl_minutes: int
    store_dsn: str
    store_backend_required: bool
    shared_secret: str | None
    llama_pricing: ProviderPricing
    ollama_pricing: ProviderPricing
    openai_pricing: ProviderPricing
    anthropic_pricing: ProviderPricing
    custom_pricing: ProviderPricing

    @classmethod
    def from_env(cls) -> "AISettings":
        default_provider = os.getenv("AI_PROVIDER_DEFAULT", "llama").strip().casefold()
        reasoning_provider = os.getenv("AI_REASONING_PROVIDER", default_provider).strip().casefold()
        supported_providers = {"llama", "ollama", "openai", "anthropic", "custom"}
        if default_provider not in supported_providers or reasoning_provider not in supported_providers:
            raise DomainError(
                "invalid_ai_configuration",
                "AI provider selectors must be llama, ollama, openai, anthropic, or custom.",
                status_code=500,
            )

        fallback_path = Path(tempfile.gettempdir()) / "edt-ai-worker.sqlite3"
        store_dsn = os.getenv("AI_STORE_DSN", f"sqlite:///{fallback_path.as_posix()}").strip()
        if not (store_dsn.startswith("sqlite:///") or store_dsn.startswith("postgresql://")):
            raise DomainError(
                "invalid_ai_configuration",
                "AI_STORE_DSN must use sqlite:/// or postgresql://.",
                status_code=500,
            )

        llama_key = os.getenv("LLAMA_API_KEY", "").strip() or None
        llama_model = os.getenv("LLAMA_MODEL", "").strip() or None
        llama_reasoning_model = os.getenv("LLAMA_REASONING_MODEL", "").strip() or llama_model
        ollama_key = os.getenv("OLLAMA_API_KEY", "").strip() or None
        ollama_model = os.getenv("OLLAMA_MODEL", "").strip() or None
        openai_key = os.getenv("OPENAI_API_KEY", "").strip() or None
        openai_model = os.getenv("OPENAI_MODEL", "").strip() or None
        anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip() or None
        anthropic_model = os.getenv("ANTHROPIC_MODEL", "").strip() or None
        custom_key = os.getenv("CUSTOM_AI_API_KEY", "").strip() or None
        custom_model = os.getenv("CUSTOM_AI_MODEL", "").strip() or None
        custom_endpoint_raw = os.getenv("CUSTOM_AI_ENDPOINT", "").strip()
        embedding_key = os.getenv("AI_EMBEDDING_API_KEY", "").strip() or openai_key
        embedding_model = os.getenv("AI_EMBEDDING_MODEL", "").strip() or None

        # A key without an explicit model is ambiguous and therefore rejected. No
        # provider or model is silently substituted.
        if llama_key and not llama_model:
            raise DomainError(
                "invalid_ai_configuration", "LLAMA_MODEL is required with LLAMA_API_KEY.", status_code=500
            )
        if openai_key and not openai_model:
            raise DomainError(
                "invalid_ai_configuration", "OPENAI_MODEL is required with OPENAI_API_KEY.", status_code=500
            )
        if ollama_key and not ollama_model:
            raise DomainError("invalid_ai_configuration", "OLLAMA_MODEL is required with OLLAMA_API_KEY.", status_code=500)
        if anthropic_key and not anthropic_model:
            raise DomainError(
                "invalid_ai_configuration", "ANTHROPIC_MODEL is required with ANTHROPIC_API_KEY.", status_code=500
            )
        if custom_key and (not custom_model or not custom_endpoint_raw):
            raise DomainError(
                "invalid_ai_configuration",
                "CUSTOM_AI_MODEL and CUSTOM_AI_ENDPOINT are required with CUSTOM_AI_API_KEY.",
                status_code=500,
            )

        return cls(
            llama_api_key=llama_key,
            llama_model=llama_model,
            llama_reasoning_model=llama_reasoning_model,
            llama_endpoint=_endpoint(
                "LLAMA_ENDPOINT",
                os.getenv("LLAMA_ENDPOINT", "").strip() or "https://api.llama.com/v1/",
            ),
            openai_api_key=openai_key,
            openai_model=openai_model,
            openai_endpoint=_endpoint(
                "OPENAI_ENDPOINT",
                os.getenv("OPENAI_ENDPOINT", "").strip()
                or "https://api.openai.com/v1/responses",
            ),
            ollama_api_key=ollama_key,
            ollama_model=ollama_model,
            ollama_endpoint=_endpoint("OLLAMA_ENDPOINT", os.getenv("OLLAMA_ENDPOINT", "").strip() or "http://host.docker.internal:11434/api/chat", allow_docker_host_gateway=True),
            anthropic_api_key=anthropic_key,
            anthropic_model=anthropic_model,
            anthropic_endpoint=_endpoint(
                "ANTHROPIC_ENDPOINT",
                os.getenv("ANTHROPIC_ENDPOINT", "").strip() or "https://api.anthropic.com/v1/messages",
            ),
            custom_api_key=custom_key,
            custom_model=custom_model,
            custom_endpoint=_endpoint("CUSTOM_AI_ENDPOINT", custom_endpoint_raw) if custom_endpoint_raw else None,
            embedding_api_key=embedding_key,
            embedding_model=embedding_model,
            embedding_endpoint=_endpoint(
                "AI_EMBEDDING_ENDPOINT",
                os.getenv("AI_EMBEDDING_ENDPOINT", "").strip()
                or "https://api.openai.com/v1/embeddings",
            ),
            default_provider=default_provider,
            reasoning_provider=reasoning_provider,
            timeout_seconds=_integer(
                "AI_GATEWAY_TIMEOUT_SECONDS", 20, minimum=1, maximum=300
            ),
            max_retries=_integer("AI_GATEWAY_MAX_RETRIES", 2, minimum=0, maximum=5),
            max_input_tokens=_integer(
                "AI_GATEWAY_MAX_INPUT_TOKENS", 24_000, minimum=1_024, maximum=1_000_000
            ),
            max_output_tokens=_integer(
                "AI_GATEWAY_MAX_OUTPUT_TOKENS", 4096, minimum=128, maximum=32768
            ),
            requests_per_minute=_integer(
                "AI_GATEWAY_REQUESTS_PER_MINUTE", 30, minimum=1, maximum=10000
            ),
            cache_ttl_seconds=_integer("AI_GATEWAY_CACHE_TTL_SECONDS", 300, minimum=0, maximum=86400),
            max_cache_entries=_integer("AI_GATEWAY_MAX_CACHE_ENTRIES", 1000, minimum=0, maximum=100000),
            max_document_bytes=_integer(
                "AI_GATEWAY_MAX_DOCUMENT_BYTES", 5_242_880, minimum=1024, maximum=5_242_880
            ),
            max_retrieval_candidates=_integer(
                "AI_MAX_RETRIEVAL_CANDIDATES", 10000, minimum=100, maximum=100000
            ),
            vector_dimensions=_integer("AI_VECTOR_DIMENSIONS", 256, minimum=64, maximum=4096),
            session_ttl_minutes=_integer(
                "AI_SESSION_TTL_MINUTES", 60, minimum=1, maximum=10_080
            ),
            store_dsn=store_dsn,
            store_backend_required=_boolean("AI_DURABLE_STORE_REQUIRED"),
            shared_secret=os.getenv("AI_WORKER_SHARED_SECRET", "").strip() or None,
            llama_pricing=ProviderPricing(
                _decimal("AI_LLAMA_INPUT_USD_PER_MILLION"),
                _decimal("AI_LLAMA_OUTPUT_USD_PER_MILLION"),
            ),
            openai_pricing=ProviderPricing(
                _decimal("AI_OPENAI_INPUT_USD_PER_MILLION"),
                _decimal("AI_OPENAI_OUTPUT_USD_PER_MILLION"),
            ),
            ollama_pricing=ProviderPricing(_decimal("AI_OLLAMA_INPUT_USD_PER_MILLION"), _decimal("AI_OLLAMA_OUTPUT_USD_PER_MILLION")),
            anthropic_pricing=ProviderPricing(
                _decimal("AI_ANTHROPIC_INPUT_USD_PER_MILLION"),
                _decimal("AI_ANTHROPIC_OUTPUT_USD_PER_MILLION"),
            ),
            custom_pricing=ProviderPricing(
                _decimal("AI_CUSTOM_INPUT_USD_PER_MILLION"),
                _decimal("AI_CUSTOM_OUTPUT_USD_PER_MILLION"),
            ),
        )

    def secret_values(self) -> tuple[str, ...]:
        return tuple(
            value
            for value in (
                self.llama_api_key,
                self.ollama_api_key,
                self.openai_api_key,
                self.anthropic_api_key,
                self.custom_api_key,
                self.embedding_api_key,
                self.shared_secret,
            )
            if value and len(value) >= 8
        )
