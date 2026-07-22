"""Tenant-scoped MCP registry and deny-by-default tool authorization."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from urllib.parse import urlparse
from uuid import UUID


@dataclass(frozen=True)
class MCPTool:
    name: str
    required_permissions: tuple[str, ...]
    mutating: bool = False


@dataclass(frozen=True)
class MCPServer:
    server_id: UUID
    tenant_id: UUID
    name: str
    endpoint: str
    secret_ref: str
    tools: tuple[MCPTool, ...]
    enabled: bool = True

    def __post_init__(self) -> None:
        parsed = urlparse(self.endpoint)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            raise ValueError("invalid_mcp_endpoint")
        host = parsed.hostname.casefold().rstrip(".")
        if host == "localhost" or host.endswith(".localhost"):
            raise ValueError("invalid_mcp_endpoint")
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            address = None
        if address and (address.is_private or address.is_loopback or address.is_link_local or address.is_multicast or address.is_reserved):
            raise ValueError("invalid_mcp_endpoint")
        if not self.secret_ref.startswith("secret://"):
            raise ValueError("invalid_mcp_secret_reference")
        names = [tool.name for tool in self.tools]
        if not names or len(names) != len(set(names)):
            raise ValueError("invalid_mcp_tools")


class MCPRegistry:
    def __init__(self) -> None:
        self._servers: dict[tuple[UUID, UUID], MCPServer] = {}

    def register(self, actor_permissions: set[str], server: MCPServer) -> None:
        if "mcp.admin" not in actor_permissions:
            raise PermissionError("mcp_admin_denied")
        key = (server.tenant_id, server.server_id)
        if key in self._servers:
            raise ValueError("mcp_server_exists")
        self._servers[key] = server

    def authorize_tool(self, tenant_id: UUID, server_id: UUID, tool_name: str, permissions: set[str], approval_id: UUID | None = None) -> MCPTool:
        server = self._servers.get((tenant_id, server_id))
        if server is None or not server.enabled:
            raise LookupError("mcp_server_not_found")
        tool = next((item for item in server.tools if item.name == tool_name), None)
        if tool is None or not set(tool.required_permissions).issubset(permissions):
            raise PermissionError("mcp_tool_denied")
        if tool.mutating and approval_id is None:
            raise PermissionError("mcp_approval_required")
        return tool
