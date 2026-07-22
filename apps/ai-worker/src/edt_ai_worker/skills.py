"""Declarative, reusable and statically validated AI workflows."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator, model_validator

from .models import StrictModel


class SkillStep(StrictModel):
    step_id: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    kind: Literal["retrieve", "calculate", "model", "mcp_read", "simulate", "explain"]
    tool: str = Field(min_length=2, max_length=120)
    requires: list[str] = Field(default_factory=list, max_length=30)
    output: str = Field(min_length=2, max_length=120)


class SkillDefinition(StrictModel):
    skill_id: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    version: int = Field(ge=1)
    purpose: str = Field(min_length=10, max_length=1000)
    required_data: list[str] = Field(min_length=1, max_length=100)
    tools: list[str] = Field(min_length=1, max_length=50)
    mcp_servers: list[str] = Field(default_factory=list, max_length=20)
    allowed_models: list[str] = Field(min_length=1, max_length=20)
    required_permissions: list[str] = Field(min_length=1, max_length=50)
    steps: list[SkillStep] = Field(min_length=1, max_length=30)

    @field_validator("required_data", "tools", "mcp_servers", "allowed_models", "required_permissions")
    @classmethod
    def unique_values(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)) or any(not item.strip() for item in value):
            raise ValueError("skill lists must contain unique non-empty values")
        return value

    @model_validator(mode="after")
    def valid_dag(self) -> "SkillDefinition":
        produced: set[str] = set(self.required_data)
        ids: set[str] = set()
        for step in self.steps:
            if step.step_id in ids or any(item not in produced for item in step.requires):
                raise ValueError("skill steps must be unique and reference prior data")
            if step.tool not in self.tools or step.output in produced:
                raise ValueError("skill step tool/output is invalid")
            ids.add(step.step_id)
            produced.add(step.output)
        return self


class SkillRegistry:
    def __init__(self) -> None:
        self._items: dict[tuple[str, int], SkillDefinition] = {}

    def register(self, skill: SkillDefinition) -> None:
        key = (skill.skill_id, skill.version)
        if key in self._items:
            raise ValueError("skill_version_exists")
        self._items[key] = skill

    def resolve(self, skill_id: str, version: int, permissions: set[str]) -> SkillDefinition:
        skill = self._items.get((skill_id, version))
        if skill is None:
            raise ValueError("skill_not_found")
        if not set(skill.required_permissions).issubset(permissions):
            raise PermissionError("skill_permission_denied")
        return skill
