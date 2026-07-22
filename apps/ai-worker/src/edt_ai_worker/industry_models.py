"""Versioned tenant industry packages, independent of core graph code."""

from __future__ import annotations

from pydantic import Field, model_validator

from .models import StrictModel


class RelationshipType(StrictModel):
    name: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,63}$")
    source_types: list[str] = Field(min_length=1, max_length=50)
    target_types: list[str] = Field(min_length=1, max_length=50)


class IndustryPackage(StrictModel):
    package_id: str = Field(pattern=r"^[a-z][a-z0-9_-]{1,63}$")
    version: int = Field(ge=1)
    node_types: list[str] = Field(min_length=1, max_length=200)
    relationships: list[RelationshipType] = Field(default_factory=list, max_length=300)
    rules: list[str] = Field(default_factory=list, max_length=200)
    simulations: list[str] = Field(default_factory=list, max_length=100)
    ai_models: list[str] = Field(default_factory=list, max_length=100)
    workflows: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def references_declared_nodes(self) -> "IndustryPackage":
        nodes = set(self.node_types)
        if len(nodes) != len(self.node_types):
            raise ValueError("node types must be unique")
        for relation in self.relationships:
            if not set(relation.source_types + relation.target_types).issubset(nodes):
                raise ValueError("relationship references an undeclared node type")
        return self


INDUSTRY_PACKAGES = {
    "construction": IndustryPackage.model_validate({"package_id": "construction", "version": 1, "node_types": ["Project", "Subcontractor", "Equipment", "Material", "Site", "ChangeOrder"], "relationships": [{"name": "USES_EQUIPMENT", "source_types": ["Project", "Site"], "target_types": ["Equipment"]}, {"name": "SUPPLIES_MATERIAL", "source_types": ["Subcontractor"], "target_types": ["Material"]}], "rules": ["change_order_budget_impact"], "simulations": ["schedule_cost_scenario"], "ai_models": ["delay_risk"], "workflows": ["change_order_review"]}),
    "manufacturing": IndustryPackage.model_validate({"package_id": "manufacturing", "version": 1, "node_types": ["Machine", "ProductionLine", "Supplier", "Inventory", "QualityIssue"], "relationships": [{"name": "PART_OF_LINE", "source_types": ["Machine"], "target_types": ["ProductionLine"]}, {"name": "CAUSES_QUALITY_ISSUE", "source_types": ["Machine", "Supplier"], "target_types": ["QualityIssue"]}], "rules": ["inventory_reorder"], "simulations": ["line_failure_scenario"], "ai_models": ["failure_prediction"], "workflows": ["quality_review"]}),
    "software": IndustryPackage.model_validate({"package_id": "software", "version": 1, "node_types": ["Application", "Repository", "CloudResource", "Deployment", "Customer"], "relationships": [{"name": "DEPLOYED_FROM", "source_types": ["Deployment"], "target_types": ["Repository"]}, {"name": "RUNS_ON", "source_types": ["Application", "Deployment"], "target_types": ["CloudResource"]}], "rules": ["deployment_policy"], "simulations": ["regional_outage_scenario"], "ai_models": ["churn_prediction"], "workflows": ["deployment_approval"]}),
}


class IndustryRegistry:
    def __init__(self) -> None:
        self._packages: dict[tuple[str, int], IndustryPackage] = {(item.package_id, item.version): item for item in INDUSTRY_PACKAGES.values()}

    def register(self, package: IndustryPackage) -> None:
        key = (package.package_id, package.version)
        if key in self._packages:
            raise ValueError("industry_package_version_exists")
        self._packages[key] = package

    def resolve(self, package_id: str, version: int) -> IndustryPackage:
        try:
            return self._packages[(package_id, version)]
        except KeyError as exc:
            raise LookupError("industry_package_not_found") from exc
