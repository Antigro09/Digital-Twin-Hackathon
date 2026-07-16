import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { EventIntelligenceService } from './event-intelligence.service';
export declare class EventIntelligenceController {
    private readonly contexts;
    private readonly intelligence;
    constructor(contexts: ContextService, intelligence: EventIntelligenceService);
    taxonomy(request: FastifyRequest): object;
    interpret(request: FastifyRequest, body: Record<string, unknown>): Promise<object>;
    events(request: FastifyRequest, pageSize?: string, pageCursor?: string): object;
    event(request: FastifyRequest, eventId: string, response: FastifyReply): object;
    review(request: FastifyRequest, eventId: string, body: Record<string, unknown>, response: FastifyReply): Promise<object>;
    requestApproval(request: FastifyRequest, eventId: string, body: Record<string, unknown>): Promise<object>;
    approval(request: FastifyRequest, approvalId: string): object;
    decide(request: FastifyRequest, approvalId: string, body: Record<string, unknown>): Promise<object>;
    apply(request: FastifyRequest, eventId: string, body: Record<string, unknown>): Promise<object>;
    rollback(request: FastifyRequest, eventId: string, body: Record<string, unknown>): Promise<object>;
    audit(request: FastifyRequest, eventId: string): object;
    replay(request: FastifyRequest, eventId: string): object;
    timeline(request: FastifyRequest): object;
    branches(request: FastifyRequest): object;
    compareBranches(request: FastifyRequest, body: Record<string, unknown>): object;
    private ifMatch;
}
