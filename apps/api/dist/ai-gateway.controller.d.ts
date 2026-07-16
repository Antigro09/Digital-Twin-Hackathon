import { FastifyRequest } from 'fastify';
import { AiGatewayService } from './ai-gateway.service';
import { ContextService } from './context.service';
export declare class AiGatewayController {
    private readonly contexts;
    private readonly gateway;
    constructor(contexts: ContextService, gateway: AiGatewayService);
    status(request: FastifyRequest): Promise<Record<string, unknown>>;
    activity(request: FastifyRequest, pageSize?: string): Promise<Record<string, unknown>>;
    runAgent(request: FastifyRequest, body: unknown): Promise<Record<string, unknown>>;
    retrieve(request: FastifyRequest, body: unknown): Promise<Record<string, unknown>>;
    importDocument(request: FastifyRequest, body: unknown): Promise<Record<string, unknown>>;
    suggestions(request: FastifyRequest, pageSize?: string, reviewDecision?: string): Promise<Record<string, unknown>>;
    reviewSuggestion(request: FastifyRequest, suggestionId: string, body: unknown): Promise<Record<string, unknown>>;
    recordLearningOutcome(request: FastifyRequest, body: unknown): Promise<Record<string, unknown>>;
}
