import { FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { DemoStoreService } from './demo-store.service';
export declare class KnowledgeController {
    private readonly contexts;
    private readonly store;
    constructor(contexts: ContextService, store: DemoStoreService);
    entities(request: FastifyRequest, pageSize?: string): object;
    entity(request: FastifyRequest, entityId: string): Record<string, unknown>;
    traversal(request: FastifyRequest, body: Record<string, unknown>): Record<string, unknown>;
}
