from __future__ import annotations

import json
import math
import time
from abc import ABC, abstractmethod
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import httpx
import llama_api_client
from llama_api_client import LlamaAPIClient

from .errors import DomainError
from .intelligence_models import ProviderName, TokenUsage
from .settings import AISettings


@dataclass(frozen=True)
class ProviderRequest:
    request_id: str
    schema_name: str
    system_prompt: str
    user_prompt: str
    json_schema: dict[str, Any]
    model: str
    temperature: float
    max_output_tokens: int
    actor_hash: str


@dataclass(frozen=True)
class ProviderResponse:
    provider: ProviderName
    model: str
    parsed: dict[str, Any]
    usage: TokenUsage
    provider_request_id: str | None
    latency_ms: int


class AIProvider(ABC):
    name: ProviderName

    @abstractmethod
    def generate(self, request: ProviderRequest) -> ProviderResponse:
        raise NotImplementedError

    def generate_batch(self, requests: Sequence[ProviderRequest]) -> list[ProviderResponse]:
        # The bounded gateway performs sequential batches so rate and cost checks
        # remain per item. Provider-native asynchronous batch APIs can implement
        # this method later without changing callers.
        return [self.generate(request) for request in requests]


def _retryable_exception(exc: Exception) -> bool:
    if isinstance(exc, (httpx.TimeoutException, httpx.TransportError, TimeoutError)):
        return True
    if isinstance(exc, (llama_api_client.APIConnectionError, llama_api_client.APITimeoutError)):
        return True
    status_code = getattr(exc, "status_code", None)
    return status_code in {408, 409, 429} or (isinstance(status_code, int) and status_code >= 500)


def _sleep_seconds(attempt: int) -> float:
    return min(0.25 * (2**attempt), 2.0)


def _parse_json_object(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise DomainError(
            "invalid_ai_provider_output",
            "The AI provider returned malformed structured output.",
            status_code=502,
        ) from exc
    if not isinstance(parsed, dict):
        raise DomainError(
            "invalid_ai_provider_output",
            "The AI provider returned a non-object structured output.",
            status_code=502,
        )
    return parsed


def _token_count(value: Any, *, field: str) -> int:
    """Accept provider numeric token counters, but never invent a missing count."""

    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DomainError(
            "invalid_ai_provider_usage",
            "The AI provider returned invalid token usage.",
            status_code=502,
        )
    numeric = value
    if (
        numeric < 0
        or (isinstance(numeric, float) and not math.isfinite(numeric))
        or (isinstance(numeric, float) and not numeric.is_integer())
    ):
        raise DomainError(
            "invalid_ai_provider_usage",
            "The AI provider returned invalid token usage.",
            status_code=502,
        )
    # Keep the field argument so callers cannot accidentally validate an
    # unlabelled metric while extending the adapter.
    if not field:
        raise AssertionError("token usage fields must be named")
    return int(numeric)


def _strict_schema_compatible(schema: dict[str, Any]) -> bool:
    """Return whether a schema fits the Responses strict-output subset.

    Non-strict JSON-schema mode is still schema-guided and the gateway always
    performs local Pydantic validation. This compatibility check avoids sending
    ``strict: true`` for maps, defaults, or composition keywords that the remote
    strict subset cannot faithfully represent.
    """

    unsupported = {
        "allOf",
        "not",
        "dependentRequired",
        "dependentSchemas",
        "if",
        "then",
        "else",
        "patternProperties",
        "default",
        "const",
    }

    def visit(value: Any, *, root: bool = False) -> bool:
        if isinstance(value, list):
            return all(visit(item) for item in value)
        if not isinstance(value, dict) or not value:
            return False if isinstance(value, dict) else True
        if unsupported.intersection(value):
            return False
        if root and (value.get("type") != "object" or "anyOf" in value):
            return False
        if value.get("type") == "object" or "properties" in value:
            properties = value.get("properties")
            if not isinstance(properties, dict):
                return False
            required = value.get("required")
            if not isinstance(required, list) or set(required) != set(properties):
                return False
            if value.get("additionalProperties") is not False:
                return False
        return all(visit(child) for child in value.values())

    return visit(schema, root=True)


class LlamaProvider(AIProvider):
    """Official Meta Llama API adapter using llama-api-client."""

    name = ProviderName.LLAMA

    def __init__(
        self,
        settings: AISettings,
        *,
        client: Any | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not settings.llama_api_key or not settings.llama_model:
            raise DomainError(
                "ai_provider_not_configured",
                "The requested AI provider is not configured.",
                status_code=503,
            )
        self.settings = settings
        self.client = client or LlamaAPIClient(
            api_key=settings.llama_api_key,
            base_url=settings.llama_endpoint,
            timeout=float(settings.timeout_seconds),
            # Retry ownership stays in this adapter so attempts are observable
            # and cannot multiply between layers.
            max_retries=0,
            _strict_response_validation=True,
        )
        self.sleeper = sleeper
        self.clock = clock

    @staticmethod
    def _content(response: Any) -> str:
        completion = getattr(response, "completion_message", None)
        if completion is None:
            raise DomainError(
                "invalid_ai_provider_output",
                "The AI provider returned malformed structured output.",
                status_code=502,
            )
        stop_reason = getattr(completion, "stop_reason", None)
        if stop_reason == "length":
            raise DomainError(
                "ai_provider_incomplete",
                "The AI provider returned incomplete structured output.",
                status_code=502,
            )
        if stop_reason == "tool_calls" or getattr(completion, "tool_calls", None):
            raise DomainError(
                "invalid_ai_provider_output",
                "The AI provider returned an unexpected tool call.",
                status_code=502,
            )
        if stop_reason != "stop":
            raise DomainError(
                "invalid_ai_provider_output",
                "The AI provider returned an indeterminate completion state.",
                status_code=502,
            )
        content = getattr(completion, "content", None)
        if isinstance(content, str):
            return content
        text = getattr(content, "text", None)
        if isinstance(text, str):
            return text
        raise DomainError(
            "invalid_ai_provider_output",
            "The AI provider returned no structured text output.",
            status_code=502,
        )

    @staticmethod
    def _usage(response: Any) -> TokenUsage:
        metrics = getattr(response, "metrics", None)
        if not isinstance(metrics, list):
            raise DomainError(
                "invalid_ai_provider_usage",
                "The AI provider did not report token usage.",
                status_code=502,
            )
        aliases = {
            "prompt": {"num_prompt_tokens", "prompt_tokens", "num_input_tokens", "input_tokens"},
            "completion": {
                "num_completion_tokens",
                "completion_tokens",
                "num_output_tokens",
                "output_tokens",
            },
            "total": {"num_total_tokens", "total_tokens"},
        }
        found: dict[str, int] = {}
        for metric in metrics:
            name = str(getattr(metric, "metric", "")).strip().casefold()
            category = next((key for key, names in aliases.items() if name in names), None)
            if category is None:
                continue
            if category in found:
                raise DomainError(
                    "invalid_ai_provider_usage",
                    "The AI provider returned ambiguous token usage.",
                    status_code=502,
                )
            found[category] = _token_count(getattr(metric, "value", None), field=name)
        if "prompt" not in found or "completion" not in found:
            raise DomainError(
                "invalid_ai_provider_usage",
                "The AI provider did not report complete token usage.",
                status_code=502,
            )
        prompt = found["prompt"]
        completion = found["completion"]
        total = found.get("total", prompt + completion)
        if total < prompt + completion:
            raise DomainError(
                "invalid_ai_provider_usage",
                "The AI provider returned inconsistent token usage.",
                status_code=502,
            )
        return TokenUsage(
            input_tokens=prompt,
            output_tokens=completion,
            total_tokens=total,
        )

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        started = self.clock()
        last_retryable = False
        for attempt in range(self.settings.max_retries + 1):
            try:
                response = self.client.chat.completions.create(
                    messages=[
                        {"role": "system", "content": request.system_prompt},
                        {"role": "user", "content": request.user_prompt},
                    ],
                    model=request.model,
                    max_completion_tokens=request.max_output_tokens,
                    temperature=request.temperature,
                    response_format={
                        "type": "json_schema",
                        "json_schema": {
                            "name": request.schema_name,
                            "schema": request.json_schema,
                        },
                    },
                    user=request.actor_hash,
                    timeout=float(self.settings.timeout_seconds),
                )
                return ProviderResponse(
                    provider=self.name,
                    model=request.model,
                    parsed=_parse_json_object(self._content(response)),
                    usage=self._usage(response),
                    provider_request_id=getattr(response, "id", None),
                    latency_ms=max(0, int((self.clock() - started) * 1000)),
                )
            except DomainError:
                raise
            except llama_api_client.APIResponseValidationError as exc:
                raise DomainError(
                    "invalid_ai_provider_output",
                    "The AI provider returned malformed structured output.",
                    status_code=502,
                ) from exc
            except Exception as exc:
                last_retryable = _retryable_exception(exc)
                if not last_retryable or attempt >= self.settings.max_retries:
                    break
                self.sleeper(_sleep_seconds(attempt))
        raise DomainError(
            "ai_provider_unavailable" if last_retryable else "ai_provider_request_failed",
            "The AI provider could not complete the request.",
            status_code=503 if last_retryable else 502,
        )


class OpenAIResponsesProvider(AIProvider):
    """Optional typed HTTP adapter for the OpenAI Responses API."""

    name = ProviderName.OPENAI

    def __init__(
        self,
        settings: AISettings,
        *,
        client: httpx.Client | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not settings.openai_api_key or not settings.openai_model:
            raise DomainError(
                "ai_provider_not_configured",
                "The requested AI provider is not configured.",
                status_code=503,
            )
        self.settings = settings
        self.client = client or httpx.Client(
            timeout=float(settings.timeout_seconds),
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
        )
        self.sleeper = sleeper
        self.clock = clock

    @staticmethod
    def _output_text(body: dict[str, Any]) -> str:
        output = body.get("output")
        if not isinstance(output, list):
            raise DomainError(
                "invalid_ai_provider_output",
                "The AI provider returned malformed output.",
                status_code=502,
            )
        texts: list[str] = []
        for item in output:
            if not isinstance(item, dict):
                raise DomainError(
                    "invalid_ai_provider_output",
                    "The AI provider returned malformed output.",
                    status_code=502,
                )
            if item.get("type") != "message":
                continue
            content_items = item.get("content")
            if not isinstance(content_items, list):
                raise DomainError(
                    "invalid_ai_provider_output",
                    "The AI provider returned malformed output.",
                    status_code=502,
                )
            for content in content_items:
                if not isinstance(content, dict):
                    raise DomainError(
                        "invalid_ai_provider_output",
                        "The AI provider returned malformed output.",
                        status_code=502,
                    )
                if content.get("type") == "refusal":
                    raise DomainError(
                        "ai_provider_refusal",
                        "The AI provider refused the request.",
                        status_code=422,
                    )
                if content.get("type") == "output_text":
                    if not isinstance(content.get("text"), str):
                        raise DomainError(
                            "invalid_ai_provider_output",
                            "The AI provider returned malformed output.",
                            status_code=502,
                        )
                    texts.append(content["text"])
        if len(texts) == 1:
            return texts[0]
        raise DomainError(
            "invalid_ai_provider_output",
            "The AI provider returned no structured text output.",
            status_code=502,
        )

    @staticmethod
    def _usage(body: dict[str, Any]) -> TokenUsage:
        usage = body.get("usage")
        if not isinstance(usage, dict) or "input_tokens" not in usage or "output_tokens" not in usage:
            raise DomainError(
                "invalid_ai_provider_usage",
                "The AI provider did not report complete token usage.",
                status_code=502,
            )
        input_tokens = _token_count(usage["input_tokens"], field="input_tokens")
        output_tokens = _token_count(usage["output_tokens"], field="output_tokens")
        if "total_tokens" in usage:
            total_tokens = _token_count(usage["total_tokens"], field="total_tokens")
        else:
            total_tokens = input_tokens + output_tokens
        if total_tokens < input_tokens + output_tokens:
            raise DomainError(
                "invalid_ai_provider_usage",
                "The AI provider returned inconsistent token usage.",
                status_code=502,
            )
        return TokenUsage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
        )

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        payload = {
            "model": request.model,
            "input": [
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": request.user_prompt},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": request.schema_name,
                    # Compatibility mode preserves schema guidance for broader
                    # Pydantic schemas while local validation remains mandatory.
                    "strict": _strict_schema_compatible(request.json_schema),
                    "schema": request.json_schema,
                }
            },
            "temperature": request.temperature,
            "max_output_tokens": request.max_output_tokens,
            "store": False,
        }
        started = self.clock()
        last_retryable = False
        for attempt in range(self.settings.max_retries + 1):
            try:
                response = self.client.post(self._endpoint(), json=payload)
                if response.status_code >= 400:
                    last_retryable = response.status_code in {408, 409, 429} or response.status_code >= 500
                    if last_retryable and attempt < self.settings.max_retries:
                        self.sleeper(_sleep_seconds(attempt))
                        continue
                    raise DomainError(
                        "ai_provider_unavailable" if last_retryable else "ai_provider_request_failed",
                        "The AI provider could not complete the request.",
                        status_code=503 if last_retryable else 502,
                    )
                try:
                    body = response.json()
                except ValueError as exc:
                    raise DomainError(
                        "invalid_ai_provider_output",
                        "The AI provider returned malformed output.",
                        status_code=502,
                    ) from exc
                if not isinstance(body, dict):
                    raise DomainError(
                        "invalid_ai_provider_output",
                        "The AI provider returned malformed output.",
                        status_code=502,
                    )
                status = body.get("status")
                if status != "completed":
                    if status == "incomplete":
                        raise DomainError(
                            "ai_provider_incomplete",
                            "The AI provider returned incomplete structured output.",
                            status_code=502,
                        )
                    raise DomainError(
                        "invalid_ai_provider_output",
                        "The AI provider returned a non-completed response.",
                        status_code=502,
                    )
                return ProviderResponse(
                    provider=self.name,
                    model=str(body.get("model") or request.model),
                    parsed=_parse_json_object(self._output_text(body)),
                    usage=self._usage(body),
                    provider_request_id=str(body["id"]) if body.get("id") else None,
                    latency_ms=max(0, int((self.clock() - started) * 1000)),
                )
            except DomainError:
                raise
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_retryable = True
                if attempt >= self.settings.max_retries:
                    break
                self.sleeper(_sleep_seconds(attempt))
        raise DomainError(
            "ai_provider_unavailable",
            "The AI provider could not complete the request.",
            status_code=503,
        )


    def _endpoint(self) -> str:
        return self.settings.openai_endpoint


class AnthropicMessagesProvider(AIProvider):
    """Anthropic Messages adapter with local structured-output enforcement."""

    name = ProviderName.ANTHROPIC

    def __init__(self, settings: AISettings, *, client: httpx.Client | None = None) -> None:
        if not settings.anthropic_api_key or not settings.anthropic_model:
            raise DomainError("ai_provider_not_configured", "The requested AI provider is not configured.", status_code=503)
        self.settings = settings
        self.client = client or httpx.Client(
            timeout=float(settings.timeout_seconds),
            headers={
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
        )

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        started = time.monotonic()
        payload = {
            "model": request.model,
            "system": request.system_prompt,
            "messages": [{"role": "user", "content": request.user_prompt}],
            "max_tokens": request.max_output_tokens,
            "temperature": request.temperature,
        }
        try:
            response = self.client.post(self.settings.anthropic_endpoint, json=payload)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise DomainError("ai_provider_unavailable", "The AI provider could not complete the request.", status_code=503) from exc
        if response.status_code >= 400:
            retryable = response.status_code in {408, 409, 429} or response.status_code >= 500
            raise DomainError("ai_provider_unavailable" if retryable else "ai_provider_request_failed", "The AI provider could not complete the request.", status_code=503 if retryable else 502)
        try:
            body = response.json()
            blocks = body["content"]
            texts = [item["text"] for item in blocks if item.get("type") == "text"]
            usage = body["usage"]
            if body.get("stop_reason") != "end_turn" or len(texts) != 1:
                raise ValueError("incomplete")
            tokens = TokenUsage(
                input_tokens=_token_count(usage["input_tokens"], field="input_tokens"),
                output_tokens=_token_count(usage["output_tokens"], field="output_tokens"),
                total_tokens=_token_count(usage["input_tokens"], field="input_tokens") + _token_count(usage["output_tokens"], field="output_tokens"),
            )
            return ProviderResponse(self.name, str(body.get("model") or request.model), _parse_json_object(texts[0]), tokens, str(body.get("id")) if body.get("id") else None, max(0, int((time.monotonic() - started) * 1000)))
        except (KeyError, TypeError, ValueError) as exc:
            raise DomainError("invalid_ai_provider_output", "The AI provider returned malformed output.", status_code=502) from exc


class CustomEndpointProvider(OpenAIResponsesProvider):
    """Governed OpenAI Responses-compatible custom endpoint adapter."""

    name = ProviderName.CUSTOM

    def __init__(self, settings: AISettings, *, client: httpx.Client | None = None, **kwargs: Any) -> None:
        if not settings.custom_api_key or not settings.custom_model or not settings.custom_endpoint:
            raise DomainError("ai_provider_not_configured", "The requested AI provider is not configured.", status_code=503)
        if client is None:
            client = httpx.Client(
                timeout=float(settings.timeout_seconds),
                follow_redirects=False,
                headers={"Authorization": f"Bearer {settings.custom_api_key}", "Content-Type": "application/json"},
            )
        self.settings = settings
        self.client = client
        self.sleeper = kwargs.get("sleeper", time.sleep)
        self.clock = kwargs.get("clock", time.monotonic)

    def _endpoint(self) -> str:
        assert self.settings.custom_endpoint is not None
        return self.settings.custom_endpoint
