"""Mandatory governance envelope for authoritative and derived data."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from .models import StrictModel


class LineageHop(StrictModel):
    source_id: str = Field(min_length=1, max_length=500)
    operation: str = Field(min_length=1, max_length=100)
    occurred_at: datetime
    actor_id: UUID | None = None


class GovernanceEnvelope(StrictModel):
    source_system: str = Field(min_length=1, max_length=200)
    source_locator: str = Field(min_length=1, max_length=2000)
    owner_id: UUID
    quality_score: float = Field(ge=0, le=1)
    quality_method: str = Field(min_length=1, max_length=500)
    classification: Literal["public", "internal", "confidential", "restricted"]
    retention_policy: str = Field(min_length=1, max_length=100)
    retention_until: datetime | None = None
    legal_hold: bool = False
    encryption_key_ref: str = Field(pattern=r"^kms://[A-Za-z0-9/_-]+$")
    lineage: list[LineageHop] = Field(min_length=1, max_length=100)

    @field_validator("retention_until")
    @classmethod
    def aware_retention(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("retention time must include an offset")
        return value

    def can_delete(self, now: datetime) -> bool:
        return not self.legal_hold and self.retention_until is not None and now >= self.retention_until
