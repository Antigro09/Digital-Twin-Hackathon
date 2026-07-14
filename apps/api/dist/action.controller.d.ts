import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { DemoStoreService } from './demo-store.service';
export declare class ActionController {
    private readonly contexts;
    private readonly store;
    constructor(contexts: ContextService, store: DemoStoreService);
    preview(request: FastifyRequest, body: Record<string, unknown>, response: FastifyReply): Promise<Record<string, unknown>>;
    requestApproval(request: FastifyRequest, previewId: string): Promise<Record<string, unknown>>;
    approval(request: FastifyRequest, approvalId: string): Record<string, unknown>;
    decide(request: FastifyRequest, approvalId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    execute(request: FastifyRequest, approvalId: string): Promise<object>;
    compensate(request: FastifyRequest, receiptId: string): Promise<Record<string, unknown>>;
}
