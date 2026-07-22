"""Normalized, secret-safe audit events for user, data, AI and policy actions."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field, field_validator

from .models import StrictModel

_SENSITIVE_KEYS = {"api_key", "authorization", "cookie", "credential", "password", "refresh_token", "secret", "access_token"}


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): "[REDACTED]" if str(key).casefold() in _SENSITIVE_KEYS else _redact(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


class EnterpriseAuditEvent(StrictModel):
    event_id: UUID
    tenant_id: UUID
    actor_id: UUID
    occurred_at: datetime
    category: Literal["user_action", "data_change", "ai_action", "model_update", "permission_change"]
    action: str = Field(min_length=1, max_length=200)
    resource_type: str = Field(min_length=1, max_length=100)
    resource_id: str = Field(min_length=1, max_length=500)
    previous_value: Any
    new_value: Any
    reason: str = Field(min_length=1, max_length=2000)
    policy_decision: str = Field(min_length=1, max_length=100)
    request_id: str = Field(min_length=1, max_length=200)
    explanation: str = Field(min_length=1, max_length=4000)

    @field_validator("occurred_at")
    @classmethod
    def aware_time(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("audit time must include an offset")
        return value

    @field_validator("previous_value", "new_value", mode="before")
    @classmethod
    def redact_values(cls, value: Any) -> Any:
        return _redact(value)
