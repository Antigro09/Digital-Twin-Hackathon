from __future__ import annotations

from .embeddings import OpenAICompatibleEmbeddingProvider
from .gateway import AIGateway
from .intelligence_models import ProviderName
from .memory import ControlledMemory
from .providers import AnthropicMessagesProvider, CustomEndpointProvider, LlamaProvider, OpenAIResponsesProvider
from .rag import KnowledgeIndex
from .routing import ModelRouter
from .settings import AISettings
from .storage import DurableRecordStore


def create_gateway(settings: AISettings | None = None) -> AIGateway:
    settings = settings or AISettings.from_env()
    store = DurableRecordStore(settings.store_dsn, required=settings.store_backend_required)
    providers = {}
    if settings.llama_api_key and settings.llama_model:
        providers[ProviderName.LLAMA] = LlamaProvider(settings)
    if settings.openai_api_key and settings.openai_model:
        providers[ProviderName.OPENAI] = OpenAIResponsesProvider(settings)
    if settings.anthropic_api_key and settings.anthropic_model:
        providers[ProviderName.ANTHROPIC] = AnthropicMessagesProvider(settings)
    if settings.custom_api_key and settings.custom_model and settings.custom_endpoint:
        providers[ProviderName.CUSTOM] = CustomEndpointProvider(settings)
    embedding_provider = None
    if settings.embedding_api_key and settings.embedding_model:
        embedding_provider = OpenAICompatibleEmbeddingProvider(settings)
    knowledge = KnowledgeIndex(
        store,
        embedding_provider=embedding_provider,
        embedding_model=settings.embedding_model,
        max_candidates=settings.max_retrieval_candidates,
    )
    return AIGateway(
        settings=settings,
        store=store,
        knowledge=knowledge,
        memory=ControlledMemory(store, session_ttl_minutes=settings.session_ttl_minutes),
        router=ModelRouter(settings, providers),
        providers=providers,
    )
