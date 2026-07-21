import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { SimulationEngineService } from './simulation-engine.service';
export declare class SimulationEngineController {
    private readonly contexts;
    private readonly engine;
    constructor(contexts: ContextService, engine: SimulationEngineService);
    snapshot(req: FastifyRequest, body: Record<string, unknown>, res: FastifyReply): Promise<Record<string, unknown>>;
    getSnapshot(req: FastifyRequest, snapshotId: string, res: FastifyReply): Promise<Record<string, unknown>>;
    scenario(req: FastifyRequest, body: Record<string, unknown>, res: FastifyReply): Promise<Record<string, unknown>>;
    branches(req: FastifyRequest, scenarioId: string): Promise<Record<string, unknown>>;
    branch(req: FastifyRequest, scenarioId: string, body: Record<string, unknown>, res: FastifyReply): Promise<Record<string, unknown>>;
    confirm(req: FastifyRequest, scenarioId: string, branchId: string, body: Record<string, unknown>, res: FastifyReply): Promise<Record<string, unknown>>;
    run(req: FastifyRequest, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    getRun(req: FastifyRequest, simulationId: string): Promise<Record<string, unknown>>;
    compare(req: FastifyRequest, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    private withEtag;
}
