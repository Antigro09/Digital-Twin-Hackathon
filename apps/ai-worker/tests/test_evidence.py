from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import pytest

from edt_ai_worker.errors import DomainError
from edt_ai_worker.evidence import extract_facts, grounded_answer
from edt_ai_worker.models import ExtractionRequest, GroundedAnswerRequest
from edt_ai_worker.tenancy import BEACON_TENANT_ID


EVIDENCE_ID = UUID("90000000-0000-4000-8000-000000000001")


def evidence(tenant_id, *, statement="AST-142 blocks the Orion launch.", risk="high"):
    return {
        "evidence_id": str(EVIDENCE_ID),
        "tenant_id": str(tenant_id),
        "source_type": "jira",
        "source_locator": "jira://AST/AST-142@7",
        "supported_statements": [statement],
        "facts": {"launch_risk": risk, "issue_key": "AST-142"},
        "classification": "internal",
    }


def test_grounded_answer_emits_only_exact_supported_statement(aster_context):
    request = GroundedAnswerRequest.model_validate(
        {
            "question": "What blocks launch?",
            "evidence": [evidence(aster_context.tenant_id)],
            "proposed_claims": [
                {"statement": "AST-142 blocks the Orion launch.", "evidence_ids": [str(EVIDENCE_ID)]},
                {"statement": "The launch will certainly fail.", "evidence_ids": [str(EVIDENCE_ID)]},
            ],
            "data_watermark": datetime(2026, 7, 13, 9, tzinfo=timezone.utc),
        }
    )
    result = grounded_answer(request, aster_context)
    assert result.status == "answered"
    assert "AST-142 blocks" in result.answer
    assert "certainly fail" not in result.answer
    assert result.unsupported_claims == ["The launch will certainly fail."]
    assert [item.evidence_id for item in result.citations] == [EVIDENCE_ID]


def test_grounded_answer_abstains_without_support(aster_context):
    request = GroundedAnswerRequest.model_validate(
        {
            "question": "Will launch succeed?",
            "evidence": [evidence(aster_context.tenant_id)],
            "proposed_claims": [],
            "data_watermark": "2026-07-13T09:00:00Z",
        }
    )
    assert grounded_answer(request, aster_context).status == "abstained"


def test_extraction_copies_facts_and_does_not_infer(aster_context):
    request = ExtractionRequest.model_validate(
        {
            "evidence": [evidence(aster_context.tenant_id)],
            "fields": ["issue_key", "owner"],
        }
    )
    result = extract_facts(request, aster_context)
    assert result.extracted[0].field == "issue_key"
    assert result.extracted[0].value == "AST-142"
    assert result.missing_fields == ["owner"]


def test_evidence_from_other_tenant_is_rejected(aster_context):
    request = GroundedAnswerRequest.model_validate(
        {
            "question": "What blocks launch?",
            "evidence": [evidence(BEACON_TENANT_ID)],
            "proposed_claims": [],
            "data_watermark": "2026-07-13T09:00:00Z",
        }
    )
    with pytest.raises(DomainError) as failure:
        grounded_answer(request, aster_context)
    assert failure.value.code == "cross_tenant_binding"

