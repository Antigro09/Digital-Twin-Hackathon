import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { TwinGraphService } from './twin-graph.service';
export declare class TwinGraphController {
    private readonly contexts;
    private readonly graph;
    constructor(contexts: ContextService, graph: TwinGraphService);
    listNodeTypes(request: FastifyRequest): Promise<Record<string, unknown>>;
    createNodeType(request: FastifyRequest, body: Record<string, unknown>, response: FastifyReply): Promise<Record<string, unknown>>;
    listRelationshipTypes(request: FastifyRequest): Promise<Record<string, unknown>>;
    createRelationshipType(request: FastifyRequest, body: Record<string, unknown>, response: FastifyReply): Promise<Record<string, unknown>>;
    search(request: FastifyRequest, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    criticalNodes(request: FastifyRequest, limit?: string): Promise<Record<string, unknown>>;
    traverse(request: FastifyRequest, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    impactAnalysis(request: FastifyRequest, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    listNodes(request: FastifyRequest, query: Record<string, string | undefined>): Promise<Record<string, unknown>>;
    createNode(request: FastifyRequest, body: Record<string, unknown>, response: FastifyReply): Promise<Record<string, unknown>>;
    dependencies(request: FastifyRequest, nodeId: string, maxDepth?: string): Promise<Record<string, unknown>>;
    node(request: FastifyRequest, nodeId: string): Promise<Record<string, unknown>>;
    updateNode(request: FastifyRequest, nodeId: string, body: Record<string, unknown>, response: FastifyReply): Promise<Record<string, unknown>>;
    archiveNode(request: FastifyRequest, nodeId: string, response: FastifyReply): Promise<Record<string, unknown>>;
    listRelationships(request: FastifyRequest, query: Record<string, string | undefined>): Promise<Record<string, unknown>>;
    createRelationship(request: FastifyRequest, body: Record<string, unknown>, response: FastifyReply): Promise<Record<string, unknown>>;
    relationship(request: FastifyRequest, relationshipId: string): Promise<Record<string, unknown>>;
    updateRelationship(request: FastifyRequest, relationshipId: string, body: Record<string, unknown>, response: FastifyReply): Promise<Record<string, unknown>>;
    archiveRelationship(request: FastifyRequest, relationshipId: string, response: FastifyReply): Promise<Record<string, unknown>>;
    private ifMatch;
    private setEtag;
}
