from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Generic, TypeVar
from uuid import UUID

from .canonical import canonical_json_bytes
from .errors import DomainError


ASTER_TENANT_ID = UUID("10000000-0000-4000-8000-000000000001")
BEACON_TENANT_ID = UUID("10000000-0000-4000-8000-000000000002")
H1_TENANTS = frozenset((ASTER_TENANT_ID, BEACON_TENANT_ID))


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
