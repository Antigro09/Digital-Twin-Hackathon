import { RequestContext } from './domain';
export declare class DecisionWorkerService {
    runSimulation(ctx: RequestContext, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
    runPrediction(ctx: RequestContext, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
    validatePrediction(ctx: RequestContext, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
    private call;
}
