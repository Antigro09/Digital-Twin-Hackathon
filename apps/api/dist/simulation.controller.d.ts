import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { DemoStoreService } from './demo-store.service';
export declare class SimulationController {
    private readonly contexts;
    private readonly store;
    constructor(contexts: ContextService, store: DemoStoreService);
    snapshot(request: FastifyRequest, body: {
        project_id?: string;
        as_of?: string;
    }): Record<string, unknown>;
    scenario(request: FastifyRequest, body: Record<string, unknown>, response: FastifyReply): Record<string, unknown>;
    confirm(request: FastifyRequest, scenarioId: string, body: {
        scenario_digest?: string;
    }): Record<string, unknown>;
    simulate(request: FastifyRequest, body: {
        scenario_id?: string;
    }): Promise<Record<string, unknown>>;
    simulation(request: FastifyRequest, simulationId: string): Record<string, unknown>;
    events(request: FastifyRequest, simulationId: string): string;
}
