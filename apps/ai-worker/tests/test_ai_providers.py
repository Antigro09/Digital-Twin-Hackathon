from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest

from edt_ai_worker.embeddings import OpenAICompatibleEmbeddingProvider
from edt_ai_worker.errors import DomainError
from edt_ai_worker.providers import LlamaProvider, OpenAIResponsesProvider, ProviderRequest
from edt_ai_worker.settings import AISettings


def configured_settings(monkeypatch, *, openai: bool = False, embeddings: bool = False) -> AISettings:
    monkeypatch.setenv("AI_STORE_DSN", "sqlite:///:memory:")
    monkeypatch.setenv("LLAMA_API_KEY", "llama-test-secret-value")
    monkeypatch.setenv("LLAMA_MODEL", "llama-test-model")
    monkeypatch.setenv("AI_GATEWAY_MAX_RETRIES", "2")
    if openai:
        monkeypatch.setenv("OPENAI_API_KEY", "openai-test-secret-value")
        monkeypatch.setenv("OPENAI_MODEL", "openai-test-model")
    else:
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_MODEL", raising=False)
    if embeddings:
        monkeypatch.setenv("AI_EMBEDDING_API_KEY", "embedding-test-secret-value")
        monkeypatch.setenv("AI_EMBEDDING_MODEL", "embedding-test-model")
        monkeypatch.setenv("AI_VECTOR_DIMENSIONS", "64")
    else:
        monkeypatch.delenv("AI_EMBEDDING_API_KEY", raising=False)
        monkeypatch.delenv("AI_EMBEDDING_MODEL", raising=False)
    return AISettings.from_env()


def provider_request() -> ProviderRequest:
    return ProviderRequest(
        request_id="request-1",
        schema_name="event_schema",
        system_prompt="system",
        user_prompt="user",
        json_schema={"type": "object", "properties": {"status": {"type": "string"}}},
        model="llama-test-model",
        temperature=0,
        max_output_tokens=500,
        actor_hash="a" * 64,
    )


class FakeLlamaCompletions:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        value = self.outcomes.pop(0)
        if isinstance(value, Exception):
            raise value
        return value


class FakeLlamaClient:
    def __init__(self, outcomes):
        self.completions = FakeLlamaCompletions(outcomes)
        self.chat = SimpleNamespace(completions=self.completions)


def llama_response(content: str, *, stop_reason: str = "stop", metrics=None):
    return SimpleNamespace(
        id="llama-response-1",
        completion_message=SimpleNamespace(
            content=content,
            stop_reason=stop_reason,
            tool_calls=None,
        ),
        metrics=(
            [
                SimpleNamespace(metric="num_prompt_tokens", value=10.0),
                SimpleNamespace(metric="num_completion_tokens", value=4.0),
                SimpleNamespace(metric="num_total_tokens", value=14.0),
            ]
            if metrics is None
            else metrics
        ),
    )


def test_llama_uses_official_structured_contract_and_retries(monkeypatch):
    settings = configured_settings(monkeypatch)
    fake = FakeLlamaClient(
        [httpx.ReadTimeout("temporary"), httpx.ConnectError("temporary"), llama_response('{"status":"ok"}')]
    )
    sleeps = []
    provider = LlamaProvider(settings, client=fake, sleeper=sleeps.append)
    result = provider.generate(provider_request())
    assert result.parsed == {"status": "ok"}
    assert result.usage.total_tokens == 14
    assert len(fake.completions.calls) == 3
    assert sleeps == [0.25, 0.5]
    sent = fake.completions.calls[-1]
    assert sent["response_format"]["type"] == "json_schema"
    assert sent["response_format"]["json_schema"]["schema"]["type"] == "object"
    assert "llama-test-secret-value" not in repr(sent)


def test_llama_invalid_json_is_rejected_without_retry(monkeypatch):
    settings = configured_settings(monkeypatch)
    fake = FakeLlamaClient([llama_response("not-json")])
    provider = LlamaProvider(settings, client=fake, sleeper=lambda _: None)
    with pytest.raises(DomainError) as failure:
        provider.generate(provider_request())
    assert failure.value.code == "invalid_ai_provider_output"
    assert len(fake.completions.calls) == 1


def test_llama_rejects_truncated_output_even_when_json_is_valid(monkeypatch):
    settings = configured_settings(monkeypatch)
    fake = FakeLlamaClient([llama_response('{"status":"ok"}', stop_reason="length")])
    provider = LlamaProvider(settings, client=fake, sleeper=lambda _: None)
    with pytest.raises(DomainError) as failure:
        provider.generate(provider_request())
    assert failure.value.code == "ai_provider_incomplete"
    assert len(fake.completions.calls) == 1


@pytest.mark.parametrize(
    "metrics",
    [
        [],
        [SimpleNamespace(metric="num_prompt_tokens", value=10)],
        [
            SimpleNamespace(metric="num_prompt_tokens", value=10),
            SimpleNamespace(metric="num_completion_tokens", value=-1),
        ],
        [
            SimpleNamespace(metric="num_prompt_tokens", value=10),
            SimpleNamespace(metric="num_completion_tokens", value=4),
            SimpleNamespace(metric="num_total_tokens", value=3),
        ],
    ],
)
def test_llama_requires_real_consistent_token_usage(monkeypatch, metrics):
    settings = configured_settings(monkeypatch)
    fake = FakeLlamaClient([llama_response('{"status":"ok"}', metrics=metrics)])
    provider = LlamaProvider(settings, client=fake, sleeper=lambda _: None)
    with pytest.raises(DomainError) as failure:
        provider.generate(provider_request())
    assert failure.value.code == "invalid_ai_provider_usage"


def test_llama_malformed_success_shape_is_normalized(monkeypatch):
    settings = configured_settings(monkeypatch)
    fake = FakeLlamaClient([SimpleNamespace(id="bad", metrics=[])])
    provider = LlamaProvider(settings, client=fake, sleeper=lambda _: None)
    with pytest.raises(DomainError) as failure:
        provider.generate(provider_request())
    assert failure.value.code == "invalid_ai_provider_output"


def test_llama_requires_an_explicit_completed_stop_reason(monkeypatch):
    settings = configured_settings(monkeypatch)
    fake = FakeLlamaClient([llama_response('{"status":"ok"}', stop_reason=None)])
    provider = LlamaProvider(settings, client=fake, sleeper=lambda _: None)
    with pytest.raises(DomainError) as failure:
        provider.generate(provider_request())
    assert failure.value.code == "invalid_ai_provider_output"


def test_provider_exception_never_exposes_secret(monkeypatch):
    settings = configured_settings(monkeypatch)
    fake = FakeLlamaClient([RuntimeError("llama-test-secret-value was rejected")])
    provider = LlamaProvider(settings, client=fake, sleeper=lambda _: None)
    with pytest.raises(DomainError) as failure:
        provider.generate(provider_request())
    assert "llama-test-secret-value" not in failure.value.message
    assert failure.value.code == "ai_provider_request_failed"


def test_openai_responses_adapter_validates_structured_output(monkeypatch):
    settings = configured_settings(monkeypatch, openai=True)
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200,
            json={
                "id": "resp-1",
                "model": "openai-test-model",
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": '{"status":"ok"}'}],
                    }
                ],
                "usage": {"input_tokens": 8, "output_tokens": 3, "total_tokens": 11},
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = OpenAIResponsesProvider(settings, client=client, sleeper=lambda _: None)
    result = provider.generate(provider_request())
    assert result.parsed == {"status": "ok"}
    assert result.usage.total_tokens == 11
    request_body = __import__("json").loads(calls[0].content)
    # The sample omits required/additionalProperties, so the adapter keeps
    # schema guidance but relies on mandatory local validation.
    assert request_body["text"]["format"]["strict"] is False
    assert request_body["store"] is False


def test_openai_responses_uses_strict_mode_for_compatible_schema(monkeypatch):
    settings = configured_settings(monkeypatch, openai=True)
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(__import__("json").loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "resp-2",
                "model": "openai-test-model",
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": '{"status":"ok"}'}],
                    }
                ],
                "usage": {"input_tokens": 8, "output_tokens": 3, "total_tokens": 11},
            },
        )

    request = replace(
        provider_request(),
        json_schema={
            "type": "object",
            "properties": {"status": {"type": "string"}},
            "required": ["status"],
            "additionalProperties": False,
        },
    )
    provider = OpenAIResponsesProvider(
        settings,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleeper=lambda _: None,
    )
    provider.generate(request)
    assert seen[0]["text"]["format"]["strict"] is True


@pytest.mark.parametrize(
    ("body", "expected_code"),
    [
        (
            {
                "id": "resp-incomplete",
                "model": "openai-test-model",
                "status": "incomplete",
                "incomplete_details": {"reason": "max_output_tokens"},
                "output": [],
                "usage": {"input_tokens": 8, "output_tokens": 3, "total_tokens": 11},
            },
            "ai_provider_incomplete",
        ),
        (
            {
                "id": "resp-malformed",
                "model": "openai-test-model",
                "status": "completed",
                "output": "not-a-list",
                "usage": {"input_tokens": 8, "output_tokens": 3, "total_tokens": 11},
            },
            "invalid_ai_provider_output",
        ),
        (
            {
                "id": "resp-no-usage",
                "model": "openai-test-model",
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": '{"status":"ok"}'}],
                    }
                ],
            },
            "invalid_ai_provider_usage",
        ),
    ],
)
def test_openai_responses_rejects_incomplete_or_malformed_successes(
    monkeypatch, body, expected_code
):
    settings = configured_settings(monkeypatch, openai=True)
    client = httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body))
    )
    provider = OpenAIResponsesProvider(settings, client=client, sleeper=lambda _: None)
    with pytest.raises(DomainError) as failure:
        provider.generate(provider_request())
    assert failure.value.code == expected_code


def test_real_embedding_adapter_retries_and_validates_dimensions(monkeypatch):
    settings = configured_settings(monkeypatch, embeddings=True)
    attempts = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(429, json={"error": "rate limited"})
        return httpx.Response(
            200,
            json={
                "model": "embedding-test-model",
                "data": [{"index": 0, "embedding": [0.125] * 64}],
                "usage": {"prompt_tokens": 7, "total_tokens": 7},
            },
        )

    provider = OpenAICompatibleEmbeddingProvider(
        settings,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleeper=lambda _: None,
    )
    result = provider.embed_with_usage(["authorized text"])
    assert result.vectors[0] == [0.125] * 64
    assert result.usage.input_tokens == 7
    assert result.usage.output_tokens == 0
    assert result.model == "embedding-test-model"
    assert attempts == 2


def test_embedding_provider_rejects_fake_or_wrong_sized_vectors(monkeypatch):
    settings = configured_settings(monkeypatch, embeddings=True)
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.0]}]})
        )
    )
    provider = OpenAICompatibleEmbeddingProvider(settings, client=client, sleeper=lambda _: None)
    with pytest.raises(DomainError) as failure:
        provider.embed(["text"])
    assert failure.value.code == "invalid_embedding_output"


@pytest.mark.parametrize(
    "body",
    [
        [],
        {
            "data": [{"index": 0, "embedding": [0.125] * 64}],
        },
        {
            "data": [
                {"index": 0, "embedding": [0.125] * 64},
                {"index": 0, "embedding": [0.125] * 64},
            ],
            "usage": {"prompt_tokens": 7, "total_tokens": 7},
        },
        {
            "data": [{"index": 0, "embedding": [0.125] * 64}],
            "usage": {"prompt_tokens": -1, "total_tokens": 7},
        },
    ],
)
def test_embedding_provider_normalizes_malformed_body_and_usage(monkeypatch, body):
    settings = configured_settings(monkeypatch, embeddings=True)
    client = httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body))
    )
    provider = OpenAICompatibleEmbeddingProvider(settings, client=client, sleeper=lambda _: None)
    texts = ["one", "two"] if isinstance(body, dict) and len(body.get("data", [])) == 2 else ["one"]
    with pytest.raises(DomainError) as failure:
        provider.embed(texts)
    assert failure.value.code == "invalid_embedding_output"


def test_provider_endpoints_require_https_except_loopback(monkeypatch):
    monkeypatch.setenv("LLAMA_API_KEY", "llama-test-secret-value")
    monkeypatch.setenv("LLAMA_MODEL", "llama-test-model")
    monkeypatch.setenv("LLAMA_ENDPOINT", "http://provider.example.test/v1")
    with pytest.raises(DomainError) as failure:
        AISettings.from_env()
    assert failure.value.code == "invalid_ai_configuration"
    assert "provider.example.test" not in failure.value.message

    monkeypatch.setenv("LLAMA_ENDPOINT", "http://127.0.0.1:9999/v1")
    assert AISettings.from_env().llama_endpoint == "http://127.0.0.1:9999/v1"

    monkeypatch.setenv("OPENAI_ENDPOINT", "http://provider.example.test/v1/responses")
    with pytest.raises(DomainError) as openai_failure:
        AISettings.from_env()
    assert openai_failure.value.code == "invalid_ai_configuration"

    monkeypatch.delenv("OPENAI_ENDPOINT")
    monkeypatch.setenv("AI_EMBEDDING_ENDPOINT", "http://provider.example.test/v1/embeddings")
    with pytest.raises(DomainError) as embedding_failure:
        AISettings.from_env()
    assert embedding_failure.value.code == "invalid_ai_configuration"
