import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { TwinEventService } from './twin-event.service';
export declare class TwinEventController {
    private readonly contexts;
    private readonly events;
    constructor(contexts: ContextService, events: TwinEventService);
    eventTypes(request: FastifyRequest): Record<string, unknown>;
    createEvent(request: FastifyRequest, body: Record<string, unknown>, response: FastifyReply): Promise<Record<string, unknown>>;
    listEvents(request: FastifyRequest, query: Record<string, string | undefined>): Promise<Record<string, unknown>>;
    event(request: FastifyRequest, eventId: string, response: FastifyReply): Promise<Record<string, unknown>>;
    impactAnalysis(request: FastifyRequest, eventId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    createDataPoint(request: FastifyRequest, body: Record<string, unknown>, response: FastifyReply): Promise<Record<string, unknown>>;
    listDataPoints(request: FastifyRequest, query: Record<string, string | undefined>): Promise<Record<string, unknown>>;
    dataPoint(request: FastifyRequest, dataPointId: string, response: FastifyReply): Promise<Record<string, unknown>>;
    private setEtag;
}
