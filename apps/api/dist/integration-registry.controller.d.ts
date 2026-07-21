import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { IntegrationRegistryService } from './integration-registry.service';
export declare class IntegrationRegistryController {
    private readonly contexts;
    private readonly registry;
    constructor(contexts: ContextService, registry: IntegrationRegistryService);
    createConnector(request: FastifyRequest, body: Record<string, unknown>, response: FastifyReply): Promise<Record<string, unknown>>;
    listConnectors(request: FastifyRequest, query: Record<string, string | undefined>): Promise<Record<string, unknown>>;
    connector(request: FastifyRequest, connectorId: string, response: FastifyReply): Promise<Record<string, unknown>>;
    updateConnector(request: FastifyRequest, connectorId: string, body: Record<string, unknown>, response: FastifyReply): Promise<Record<string, unknown>>;
    createMcpServer(request: FastifyRequest, body: Record<string, unknown>, response: FastifyReply): Promise<Record<string, unknown>>;
    listMcpServers(request: FastifyRequest, query: Record<string, string | undefined>): Promise<Record<string, unknown>>;
    mcpServer(request: FastifyRequest, serverId: string, response: FastifyReply): Promise<Record<string, unknown>>;
    updateMcpServer(request: FastifyRequest, serverId: string, body: Record<string, unknown>, response: FastifyReply): Promise<Record<string, unknown>>;
    private ifMatch;
    private setEtag;
}
