"""Review-required, provenance-preserving document-to-graph link proposals."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import Field

from .models import StrictModel


class DocumentEntityLink(StrictModel):
    document_id: UUID
    evidence_id: UUID
    entity_id: UUID
    entity_type: str = Field(min_length=1, max_length=100)
    relationship_type: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,63}$")
    confidence: float = Field(ge=0, le=1)
    source_locator: str = Field(min_length=1, max_length=2000)
    status: Literal["PENDING_REVIEW"] = "PENDING_REVIEW"
    graph_mutation_performed: Literal[False] = False


def propose_document_link(*, document_id: UUID, evidence_id: UUID, entity_id: UUID, entity_type: str, relationship_type: str, confidence: float, source_locator: str) -> DocumentEntityLink:
    return DocumentEntityLink(
        document_id=document_id,
        evidence_id=evidence_id,
        entity_id=entity_id,
        entity_type=entity_type,
        relationship_type=relationship_type,
        confidence=confidence,
        source_locator=source_locator,
    )
