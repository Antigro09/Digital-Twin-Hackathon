from __future__ import annotations

from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from . import __version__
from .errors import DomainError
from .evidence import extract_facts, grounded_answer
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
from .tenancy import TenantContext, TenantScopedResultStore


class Health(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    service: str
    version: str
    engine_version: str


app = FastAPI(
    title="Enterprise Digital Twin H1 AI Worker",
    version=__version__,
    docs_url=None,
    redoc_url=None,
    openapi_url="/internal/openapi.json",
)
result_store: TenantScopedResultStore[SimulationResult] = TenantScopedResultStore()


def tenant_context(
    internal_tenant_id: Annotated[str | None, Header(alias="X-Internal-Tenant-Id")] = None,
) -> TenantContext:
    return TenantContext.from_internal_header(internal_tenant_id)


TenantDependency = Annotated[TenantContext, Depends(tenant_context)]


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
    return _problem(422, "invalid_request", "Request body failed structural validation.", exc.errors())


@app.get("/health/live", response_model=Health)
def live() -> Health:
    return Health(status="ok", service="edt-ai-worker", version=__version__, engine_version=ENGINE_VERSION)


@app.get("/health/ready", response_model=Health)
def ready() -> Health:
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


@app.post("/v1/grounded-answers", response_model=GroundedAnswer)
def answer(body: GroundedAnswerRequest, context: TenantDependency) -> GroundedAnswer:
    return grounded_answer(body, context)


@app.post("/v1/extractions", response_model=ExtractionResult)
def extract(body: ExtractionRequest, context: TenantDependency) -> ExtractionResult:
    return extract_facts(body, context)

