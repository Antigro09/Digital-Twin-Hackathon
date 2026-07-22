from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, FastAPI, Header, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from . import __version__
from .errors import DomainError
from .evidence import extract_facts, grounded_answer
from .decision_engines import run_decision_simulation, run_prediction, validate_prediction
from .decision_models import (
    DecisionSimulationRequest,
    DecisionSimulationResult,
    PredictionValidationRequest,
    PredictionValidationResult,
    PredictiveRequest,
    PredictiveResult,
)
from .factory import create_gateway
from .gateway import AIGateway
from .intelligence_models import (
    AIStatus,
    ActivityList,
    AgentRunRequest,
    AgentRunResult,
    DocumentImportReceipt,
    DocumentImportRequest,
    LearningMemoryReceipt,
    RetrievalSearchRequest,
    RetrievalSearchResult,
    ReviewReceipt,
    ReviewRequest,
    SuggestionList,
    SuggestionRecord,
    ValidatedOutcomeRequest,
)
from .models import (
    ExtractionRequest,
    ExtractionResult,
    GroundedAnswer,
    GroundedAnswerRequest,
    SealSnapshotRequest,
    SimulationRequest,
    SimulationResult,
    SimulationSnapshot,
)
from .simulation import ENGINE_VERSION, run_simulation
from .snapshot import seal_snapshot
from .tenancy import ActorContext, TenantContext, TenantScopedResultStore, require_internal_service_token


class Health(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    service: str
    version: str
    engine_version: str


class WorkerLanding(BaseModel):
    """Safe browser-facing description for the host-local internal worker."""

    model_config = ConfigDict(extra="forbid")
    service: str
    status: str
    ui_url: str
    readiness_url: str


app = FastAPI(
    title="Enterprise Digital Twin AI Gateway and Simulation Worker",
    version=__version__,
    docs_url=None,
    redoc_url=None,
    openapi_url="/internal/openapi.json",
)
result_store: TenantScopedResultStore[SimulationResult] = TenantScopedResultStore()


def tenant_context(
    internal_tenant_id: Annotated[str | None, Header(alias="X-Internal-Tenant-Id")] = None,
    internal_service_token: Annotated[str | None, Header(alias="X-Internal-Service-Token")] = None,
) -> TenantContext:
    require_internal_service_token(internal_service_token)
    return TenantContext.from_internal_header(internal_tenant_id)


TenantDependency = Annotated[TenantContext, Depends(tenant_context)]


def actor_context(
    tenant: TenantDependency,
    internal_actor_id: Annotated[str | None, Header(alias="X-Internal-Actor-Id")] = None,
    internal_permissions: Annotated[str | None, Header(alias="X-Internal-Permissions")] = None,
) -> ActorContext:
    return ActorContext.from_internal_headers(tenant, internal_actor_id, internal_permissions)


ActorDependency = Annotated[ActorContext, Depends(actor_context)]


@lru_cache(maxsize=1)
def ai_gateway() -> AIGateway:
    return create_gateway()


GatewayDependency = Annotated[AIGateway, Depends(ai_gateway)]


def _problem(status: int, code: str, detail: str, details: Any | None = None) -> JSONResponse:
    body: dict[str, Any] = {
        "type": f"urn:enterprise-digital-twin:problem:{code}",
        "title": code.replace("_", " "),
        "status": status,
        "detail": detail,
        "code": code,
    }
    if details:
        body["errors"] = details
    return JSONResponse(status_code=status, content=body, media_type="application/problem+json")


@app.exception_handler(DomainError)
async def domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
    return _problem(exc.status_code, exc.code, exc.message, exc.details)


@app.exception_handler(RequestValidationError)
async def request_validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    redacted = [
        {"loc": error.get("loc"), "type": error.get("type"), "msg": error.get("msg")}
        for error in exc.errors()
    ]
    return _problem(422, "invalid_request", "Request body failed structural validation.", redacted)


@app.get("/", response_model=WorkerLanding, include_in_schema=False)
def landing() -> WorkerLanding:
    return WorkerLanding(
        service="edt-ai-worker",
        status="running",
        ui_url="http://localhost:3000",
        readiness_url="/health/ready",
    )


@app.get("/health/live", response_model=Health)
def live() -> Health:
    return Health(status="ok", service="edt-ai-worker", version=__version__, engine_version=ENGINE_VERSION)


@app.get("/health/ready", response_model=Health)
def ready() -> Health:
    gateway = ai_gateway()
    if not gateway.store.health():
        raise DomainError(
            "ai_store_unavailable",
            "The required durable AI store is unavailable.",
            status_code=503,
        )
    return Health(status="ready", service="edt-ai-worker", version=__version__, engine_version=ENGINE_VERSION)


@app.post("/v1/snapshots/seal", response_model=SimulationSnapshot)
def seal(body: SealSnapshotRequest, context: TenantDependency) -> SimulationSnapshot:
    snapshot = seal_snapshot(body.snapshot, context)
    context.assert_response_isolated(snapshot)
    return snapshot


@app.post("/v1/simulations", response_model=SimulationResult)
def simulate(body: SimulationRequest, context: TenantDependency) -> SimulationResult:
    result = run_simulation(body, context)
    result_store.put(context, result.result_sha256, result)
    return result


@app.get("/v1/simulation-results/{result_sha256}", response_model=SimulationResult)
def get_result(result_sha256: str, context: TenantDependency) -> SimulationResult:
    result = result_store.get(context, result_sha256)
    if result is None:
        raise DomainError("simulation_result_not_found", "No result exists in this tenant scope.", status_code=404)
    context.assert_response_isolated(result)
    return result


@app.post("/v1/decision-simulations", response_model=DecisionSimulationResult)
def decision_simulation(body: DecisionSimulationRequest, context: TenantDependency) -> DecisionSimulationResult:
    result = run_decision_simulation(body, context)
    context.assert_response_isolated(result)
    return result


@app.post("/v1/predictions", response_model=PredictiveResult)
def prediction(body: PredictiveRequest, context: TenantDependency) -> PredictiveResult:
    result = run_prediction(body, context)
    context.assert_response_isolated(result)
    return result


@app.post("/v1/predictions/validate", response_model=PredictionValidationResult)
def prediction_validation(body: PredictionValidationRequest, _: TenantDependency) -> PredictionValidationResult:
    return validate_prediction(body)


@app.post(
    "/v1/grounded-answers",
    response_model=GroundedAnswer,
    deprecated=True,
    description="Deprecated deterministic evidence verifier. It does not invoke an AI model.",
)
def answer(body: GroundedAnswerRequest, context: TenantDependency, response: Response) -> GroundedAnswer:
    """Deprecated deterministic evidence verifier; this endpoint is not an AI model."""
    response.headers["Deprecation"] = "true"
    response.headers["Link"] = '</v1/ai/agent-runs>; rel="successor-version"'
    return grounded_answer(body, context)


@app.post(
    "/v1/extractions",
    response_model=ExtractionResult,
    deprecated=True,
    description="Deprecated deterministic known-fact copier. It does not invoke an AI model.",
)
def extract(body: ExtractionRequest, context: TenantDependency, response: Response) -> ExtractionResult:
    """Deprecated deterministic known-fact copier; this endpoint is not an AI model."""
    response.headers["Deprecation"] = "true"
    response.headers["Link"] = '</v1/ai/agent-runs>; rel="successor-version"'
    return extract_facts(body, context)


@app.post("/v1/evidence/verify-answer", response_model=GroundedAnswer)
def verify_answer(body: GroundedAnswerRequest, context: TenantDependency) -> GroundedAnswer:
    return grounded_answer(body, context)


@app.post("/v1/evidence/extract-known-facts", response_model=ExtractionResult)
def extract_known_facts(body: ExtractionRequest, context: TenantDependency) -> ExtractionResult:
    return extract_facts(body, context)


@app.get("/v1/ai/status", response_model=AIStatus)
def intelligence_status(_: ActorDependency, gateway: GatewayDependency) -> AIStatus:
    return gateway.status()


@app.get("/v1/ai/activity", response_model=ActivityList)
def intelligence_activity(
    context: ActorDependency,
    gateway: GatewayDependency,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ActivityList:
    return gateway.activity(context, limit=limit)


@app.post("/v1/ai/agent-runs", response_model=AgentRunResult)
def run_intelligence_agent(
    body: AgentRunRequest,
    context: ActorDependency,
    gateway: GatewayDependency,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
) -> AgentRunResult:
    return gateway.run_agent(body, context, idempotency_key)


@app.post("/v1/ai/retrieval/search", response_model=RetrievalSearchResult)
def search_knowledge(
    body: RetrievalSearchRequest,
    context: ActorDependency,
    gateway: GatewayDependency,
) -> RetrievalSearchResult:
    return gateway.retrieval(body, context)


@app.post("/v1/ai/documents/import", response_model=DocumentImportReceipt)
def import_knowledge(
    body: DocumentImportRequest,
    context: ActorDependency,
    gateway: GatewayDependency,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
) -> DocumentImportReceipt:
    return gateway.import_document(body, context, idempotency_key)


@app.get("/v1/ai/suggestions", response_model=SuggestionList)
def list_suggestions(
    context: ActorDependency,
    gateway: GatewayDependency,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    review_decision: Annotated[str | None, Query(pattern=r"^(APPROVE|REJECT)$")] = None,
) -> SuggestionList:
    return gateway.suggestions(context, limit=limit, review_decision=review_decision)


@app.get("/v1/ai/suggestions/{suggestion_id}", response_model=SuggestionRecord)
def get_suggestion(
    suggestion_id: UUID,
    context: ActorDependency,
    gateway: GatewayDependency,
) -> SuggestionRecord:
    return gateway.suggestion(context, suggestion_id)


@app.post("/v1/ai/suggestions/{suggestion_id}/reviews", response_model=ReviewReceipt)
def review_suggestion(
    suggestion_id: UUID,
    body: ReviewRequest,
    context: ActorDependency,
    gateway: GatewayDependency,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
) -> ReviewReceipt:
    return gateway.review(context, suggestion_id, body, idempotency_key)


@app.post("/v1/ai/learning/outcomes", response_model=LearningMemoryReceipt)
def record_learning_outcome(
    body: ValidatedOutcomeRequest,
    context: ActorDependency,
    gateway: GatewayDependency,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
) -> LearningMemoryReceipt:
    return gateway.record_validated_outcome(body, context, idempotency_key)
