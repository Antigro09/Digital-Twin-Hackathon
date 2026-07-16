from __future__ import annotations

import hmac
import os
import re
from dataclasses import dataclass
from typing import Any, Generic, TypeVar
from uuid import UUID

from .canonical import canonical_json_bytes
from .errors import DomainError


ASTER_TENANT_ID = UUID("10000000-0000-4000-8000-000000000001")
BEACON_TENANT_ID = UUID("10000000-0000-4000-8000-000000000002")
H1_TENANTS = frozenset((ASTER_TENANT_ID, BEACON_TENANT_ID))
_PERMISSION = re.compile(r"^[a-z0-9][a-z0-9:_.*-]{0,99}$")


@dataclass(frozen=True)
class TenantContext:
    tenant_id: UUID

    def __post_init__(self) -> None:
        if self.tenant_id not in H1_TENANTS:
            raise DomainError(
                "tenant_not_in_h1_fixture",
                "The worker accepts only the two frozen synthetic H1 tenants.",
                status_code=403,
            )

    @classmethod
    def from_internal_header(cls, raw: str | None) -> "TenantContext":
        if not raw:
            raise DomainError(
                "missing_tenant_context",
                "The authenticated upstream tenant context is required.",
                status_code=401,
            )
        try:
            tenant_id = UUID(raw)
        except (ValueError, AttributeError) as exc:
            raise DomainError(
                "invalid_tenant_context",
                "The upstream tenant context is not a UUID.",
                status_code=401,
            ) from exc
        if tenant_id not in H1_TENANTS:
            raise DomainError(
                "tenant_not_in_h1_fixture",
                "The worker accepts only the two frozen synthetic H1 tenants.",
                status_code=403,
            )
        return cls(tenant_id)

    def require_binding(self, tenant_id: UUID, resource: str) -> None:
        if tenant_id != self.tenant_id:
            raise DomainError(
                "cross_tenant_binding",
                f"{resource} is not bound to the authenticated tenant.",
                status_code=403,
            )

    def assert_response_isolated(self, payload: Any) -> None:
        other = BEACON_TENANT_ID if self.tenant_id == ASTER_TENANT_ID else ASTER_TENANT_ID
        other_markers = (
            (str(BEACON_TENANT_ID), "tnt_beacon", "Beacon Works")
            if other == BEACON_TENANT_ID
            else (str(ASTER_TENANT_ID), "tnt_aster", "Aster Labs")
        )
        serialised = canonical_json_bytes(payload).decode("utf-8").casefold()
        if any(marker.casefold() in serialised for marker in other_markers):
            raise DomainError(
                "cross_tenant_response_detected",
                "An outbound payload contained the other H1 tenant identifier.",
                status_code=500,
            )


@dataclass(frozen=True)
class ActorContext:
    tenant: TenantContext
    actor_id: UUID
    permissions: frozenset[str]

    @classmethod
    def from_internal_headers(
        cls,
        tenant: TenantContext,
        actor_raw: str | None,
        permissions_raw: str | None,
    ) -> "ActorContext":
        if not actor_raw:
            raise DomainError(
                "missing_actor_context",
                "The authenticated upstream actor context is required.",
                status_code=401,
            )
        try:
            actor_id = UUID(actor_raw)
        except (ValueError, AttributeError) as exc:
            raise DomainError(
                "invalid_actor_context",
                "The upstream actor context is invalid.",
                status_code=401,
            ) from exc
        raw_values = (permissions_raw or "").split(",")
        permissions = frozenset(item.strip().casefold() for item in raw_values if item.strip())
        if len(permissions) > 200 or any(not _PERMISSION.fullmatch(item) for item in permissions):
            raise DomainError(
                "invalid_permission_context",
                "The upstream permission context is invalid.",
                status_code=401,
            )
        return cls(tenant=tenant, actor_id=actor_id, permissions=permissions)

    @property
    def tenant_id(self) -> UUID:
        return self.tenant.tenant_id

    def may_access(self, required: set[str] | frozenset[str] | list[str]) -> bool:
        required_set = set(required)
        return required_set.issubset(self.permissions) or "*" in self.permissions

    def require(self, required: set[str] | frozenset[str] | list[str], resource: str) -> None:
        if not self.may_access(required):
            raise DomainError(
                "permission_denied",
                f"The actor is not authorized to access {resource}.",
                status_code=403,
            )


def require_internal_service_token(raw: str | None) -> None:
    """Fail closed with one generic response and never expose the configured secret."""

    expected = os.getenv("AI_WORKER_SHARED_SECRET", "")
    if not expected:
        return
    supplied = raw or ""
    if not hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
        raise DomainError(
            "invalid_internal_authentication",
            "Internal service authentication failed.",
            status_code=401,
        )


T = TypeVar("T")


class TenantScopedResultStore(Generic[T]):
    """Minimal in-memory store that makes tenant qualification structurally mandatory."""

    def __init__(self) -> None:
        self._values: dict[tuple[UUID, str], T] = {}

    def put(self, context: TenantContext, key: str, value: T) -> None:
        context.assert_response_isolated(value)
        self._values[(context.tenant_id, key)] = value

    def get(self, context: TenantContext, key: str) -> T | None:
        return self._values.get((context.tenant_id, key))

    def count_for(self, context: TenantContext) -> int:
        return sum(1 for tenant_id, _ in self._values if tenant_id == context.tenant_id)
