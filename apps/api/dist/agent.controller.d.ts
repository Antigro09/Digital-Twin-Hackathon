import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { DemoStoreService } from './demo-store.service';
export declare class AgentController {
    private readonly contexts;
    private readonly store;
    constructor(contexts: ContextService, store: DemoStoreService);
    ask(request: FastifyRequest, body: {
        question?: string;
    }): Promise<Record<string, unknown>>;
    run(request: FastifyRequest, runId: string): Record<string, unknown>;
    events(request: FastifyRequest, runId: string): string;
    cancel(request: FastifyRequest, runId: string, response: FastifyReply): Promise<Record<string, unknown>>;
}
