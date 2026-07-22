"""Central fail-closed RBAC/ABAC policy decisions shared by AI and tool boundaries."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from uuid import UUID


class Role(str, Enum):
    EXECUTIVE = "executive"
    MANAGER = "manager"
    EMPLOYEE = "employee"


ROLE_GRANTS = {
    Role.EXECUTIVE: frozenset({"graph.read", "financial.read", "risk.read", "simulation.create", "ai.run"}),
    Role.MANAGER: frozenset({"graph.read", "department.read", "project.read", "simulation.create", "ai.run"}),
    Role.EMPLOYEE: frozenset({"graph.read", "owned.read", "ai.run"}),
}


@dataclass(frozen=True)
class Subject:
    tenant_id: UUID
    actor_id: UUID
    roles: frozenset[Role]
    permissions: frozenset[str]
    departments: frozenset[str]
    projects: frozenset[UUID]
    locations: frozenset[str]
    authentication_methods: frozenset[str]


@dataclass(frozen=True)
class Resource:
    tenant_id: UUID
    owner_id: UUID | None
    department: str | None
    project_id: UUID | None
    location: str | None
    sensitivity: str


@dataclass(frozen=True)
class Decision:
    allowed: bool
    reason: str
    policy_version: str = "enterprise-v1"


class PolicyEngine:
    def decide(self, subject: Subject, action: str, resource: Resource, *, require_mfa: bool = False) -> Decision:
        if subject.tenant_id != resource.tenant_id:
            return Decision(False, "tenant_boundary")
        if require_mfa and not ({"mfa", "otp", "webauthn"} & subject.authentication_methods):
            return Decision(False, "mfa_required")
        effective = set(subject.permissions)
        for role in subject.roles:
            effective.update(ROLE_GRANTS[role])
        if action not in effective:
            return Decision(False, "permission_missing")
        if resource.sensitivity == "restricted" and Role.EXECUTIVE not in subject.roles:
            return Decision(False, "sensitivity_denied")
        if Role.EXECUTIVE in subject.roles:
            return Decision(True, "executive_scope")
        if resource.owner_id == subject.actor_id:
            return Decision(True, "owner_scope")
        if resource.department and resource.department in subject.departments:
            return Decision(True, "department_scope")
        if resource.project_id and resource.project_id in subject.projects:
            return Decision(True, "project_scope")
        if resource.location and resource.location in subject.locations:
            return Decision(True, "location_scope")
        return Decision(False, "attribute_scope_denied")
