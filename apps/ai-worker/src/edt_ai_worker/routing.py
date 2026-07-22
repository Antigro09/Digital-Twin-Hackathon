from __future__ import annotations

from dataclasses import dataclass

from .agents import AgentSpec
from .errors import DomainError
from .intelligence_models import ProviderName
from .providers import AIProvider
from .settings import AISettings


@dataclass(frozen=True)
class ModelRoute:
    provider: ProviderName
    model: str
    temperature: float
    max_input_tokens: int
    max_output_tokens: int


class ModelRouter:
    def __init__(self, settings: AISettings, providers: dict[ProviderName, AIProvider]) -> None:
        self.settings = settings
        self.providers = providers

    def route(self, spec: AgentSpec) -> tuple[ModelRoute, AIProvider]:
        selected = self.settings.reasoning_provider if spec.high_reasoning else self.settings.default_provider
        provider_name = ProviderName(selected)
        provider = self.providers.get(provider_name)
        if provider is None:
            raise DomainError(
                "ai_provider_not_configured",
                "The selected AI provider is not configured.",
                status_code=503,
            )
        if provider_name == ProviderName.LLAMA:
            model = self.settings.llama_reasoning_model if spec.high_reasoning else self.settings.llama_model
        elif provider_name == ProviderName.OLLAMA:
            model = self.settings.ollama_model
        elif provider_name == ProviderName.OPENAI:
            model = self.settings.openai_model
        elif provider_name == ProviderName.ANTHROPIC:
            model = self.settings.anthropic_model
        else:
            model = self.settings.custom_model
        if not model:
            raise DomainError(
                "ai_provider_not_configured",
                "The selected AI model is not configured.",
                status_code=503,
            )
        return (
            ModelRoute(
                provider=provider_name,
                model=model,
                temperature=spec.temperature,
                max_input_tokens=self.settings.max_input_tokens,
                max_output_tokens=self.settings.max_output_tokens,
            ),
            provider,
        )
