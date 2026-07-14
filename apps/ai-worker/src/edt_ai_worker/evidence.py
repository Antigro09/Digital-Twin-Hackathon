from __future__ import annotations

import re
import unicodedata

from .errors import DomainError
from .models import (
    Citation,
    ExtractedFact,
    ExtractionRequest,
    ExtractionResult,
    GroundedAnswer,
    GroundedAnswerRequest,
)
from .tenancy import TenantContext


def _normalise_statement(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold().strip()
    return re.sub(r"\s+", " ", value).rstrip(" .")


def grounded_answer(request: GroundedAnswerRequest, context: TenantContext) -> GroundedAnswer:
    evidence_by_id = {}
    for item in request.evidence:
        context.require_binding(item.tenant_id, f"evidence:{item.evidence_id}")
        if item.evidence_id in evidence_by_id:
            raise DomainError("duplicate_evidence", f"Evidence ID {item.evidence_id} appears more than once.")
        evidence_by_id[item.evidence_id] = item

    supported: list[str] = []
    unsupported: list[str] = []
    citation_ids = set()
    for claim in request.proposed_claims:
        cited = [evidence_by_id.get(evidence_id) for evidence_id in claim.evidence_ids]
        statement = _normalise_statement(claim.statement)
        is_supported = bool(cited) and all(item is not None for item in cited) and any(
            statement in {_normalise_statement(candidate) for candidate in item.supported_statements}
            for item in cited
            if item is not None
        )
        if is_supported:
            supported.append(claim.statement.strip())
            citation_ids.update(claim.evidence_ids)
        else:
            unsupported.append(claim.statement.strip())

    citations = [
        Citation(
            evidence_id=evidence_by_id[evidence_id].evidence_id,
            source_type=evidence_by_id[evidence_id].source_type,
            source_locator=evidence_by_id[evidence_id].source_locator,
        )
        for evidence_id in sorted(citation_ids, key=lambda value: value.bytes)
    ]
    if not supported:
        result = GroundedAnswer(
            status="abstained",
            answer="I cannot support an answer from the accessible evidence provided.",
            citations=[],
            unsupported_claims=unsupported,
            data_watermark=request.data_watermark,
            warnings=["evidence_only_stub_no_external_model"],
        )
    else:
        result = GroundedAnswer(
            status="answered",
            answer=" ".join(statement if statement.endswith((".", "!", "?")) else f"{statement}." for statement in supported),
            citations=citations,
            unsupported_claims=unsupported,
            data_watermark=request.data_watermark,
            warnings=["unsupported_proposed_claims_omitted"] if unsupported else [],
        )
    context.assert_response_isolated(result)
    return result


def extract_facts(request: ExtractionRequest, context: TenantContext) -> ExtractionResult:
    ordered_evidence = sorted(request.evidence, key=lambda item: item.evidence_id.bytes)
    for item in ordered_evidence:
        context.require_binding(item.tenant_id, f"evidence:{item.evidence_id}")

    extracted: list[ExtractedFact] = []
    missing: list[str] = []
    warnings: list[str] = []
    for field in dict.fromkeys(request.fields):
        candidates = [(item.evidence_id, item.facts[field]) for item in ordered_evidence if field in item.facts]
        if not candidates:
            missing.append(field)
            continue
        first_value = candidates[0][1]
        if any(value != first_value for _, value in candidates[1:]):
            missing.append(field)
            warnings.append(f"conflicting_evidence:{field}")
            continue
        extracted.append(ExtractedFact(field=field, value=first_value, evidence_id=candidates[0][0]))
    result = ExtractionResult(extracted=extracted, missing_fields=missing, warnings=warnings)
    context.assert_response_isolated(result)
    return result
