import { FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { DataArchitectureService } from './data-architecture.service';
export declare class DataArchitectureController {
    private readonly contexts;
    private readonly architecture;
    constructor(contexts: ContextService, architecture: DataArchitectureService);
    overview(request: FastifyRequest): Promise<Record<string, unknown>>;
}
