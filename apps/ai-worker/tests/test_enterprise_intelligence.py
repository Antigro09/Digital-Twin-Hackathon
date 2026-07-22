from datetime import date
from uuid import UUID, uuid4

import pytest

from edt_ai_worker.enterprise_agents import ANALYST_PROFILES
from edt_ai_worker.loops import LOOPS, authorize_loop
from edt_ai_worker.mcp import MCPRegistry, MCPServer, MCPTool
from edt_ai_worker.skills import SkillDefinition, SkillRegistry


TENANT = UUID("10000000-0000-4000-8000-000000000001")


def test_analyst_profiles_are_bounded_and_graph_aware():
    assert set(ANALYST_PROFILES) == {"financial_analyst", "operations_analyst", "risk_analyst", "marketing_analyst"}
    for profile in ANALYST_PROFILES.values():
        assert profile.purpose and profile.tools and profile.permissions
        assert profile.memory and profile.skills and profile.loops and profile.graph_node_types
        assert profile.mutation_authority is False


def test_skill_registry_validates_order_and_permissions():
    skill = SkillDefinition.model_validate({
        "skill_id": "financial_health_review",
        "version": 1,
        "purpose": "Calculate and explain tenant financial health.",
        "required_data": ["authorized_graph"],
        "tools": ["graph.read", "financial.calculate", "explain"],
        "mcp_servers": ["accounting"],
        "allowed_models": ["reasoning"],
        "required_permissions": ["ai.run.financial"],
        "steps": [
            {"step_id": "retrieve_graph", "kind": "retrieve", "tool": "graph.read", "requires": ["authorized_graph"], "output": "financial_subgraph"},
            {"step_id": "calculate", "kind": "calculate", "tool": "financial.calculate", "requires": ["financial_subgraph"], "output": "metrics"},
            {"step_id": "explain", "kind": "explain", "tool": "explain", "requires": ["metrics"], "output": "proposal"},
        ],
    })
    registry = SkillRegistry()
    registry.register(skill)
    with pytest.raises(PermissionError):
        registry.resolve(skill.skill_id, 1, set())
    assert registry.resolve(skill.skill_id, 1, {"ai.run.financial"}) == skill


@pytest.mark.parametrize("endpoint", ["http://crm.example.com/mcp", "https://127.0.0.1/mcp", "https://10.0.0.1/mcp", "https://user:pass@example.com/mcp"])
def test_mcp_registry_rejects_unsafe_endpoints(endpoint):
    with pytest.raises(ValueError):
        MCPServer(uuid4(), TENANT, "CRM", endpoint, "secret://tenant/crm", (MCPTool("customer.read", ("crm.read",)),))


def test_mcp_is_tenant_scoped_permissioned_and_approval_bounded():
    registry = MCPRegistry()
    server = MCPServer(uuid4(), TENANT, "Accounting", "https://accounting.example.com/mcp", "secret://tenant/accounting", (
        MCPTool("invoice.read", ("accounting.read",)),
        MCPTool("invoice.pay", ("accounting.pay",), mutating=True),
    ))
    registry.register({"mcp.admin"}, server)
    with pytest.raises(LookupError):
        registry.authorize_tool(uuid4(), server.server_id, "invoice.read", {"accounting.read"})
    with pytest.raises(PermissionError):
        registry.authorize_tool(TENANT, server.server_id, "invoice.pay", {"accounting.pay"})
    assert registry.authorize_tool(TENANT, server.server_id, "invoice.pay", {"accounting.pay"}, uuid4()).mutating


def test_loops_are_read_or_proposal_only_and_idempotent_by_period():
    assert {item.cadence.value for item in LOOPS.values()} == {"daily", "weekly", "monthly"}
    loop = authorize_loop("monthly_forecasts", {"loop.execute", "graph.read", "simulation.create"})
    assert loop.mutation_authority is False
    assert loop.run_id(TENANT, date(2026, 7, 1)) == loop.run_id(TENANT, date(2026, 7, 1))
