import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { PredictiveEngineService } from './predictive-engine.service';
export declare class PredictiveEngineController {
    private readonly contexts;
    private readonly engine;
    constructor(contexts: ContextService, engine: PredictiveEngineService);
    model(req: FastifyRequest, body: Record<string, unknown>, res: FastifyReply): Promise<Record<string, unknown>>;
    models(req: FastifyRequest, query: Record<string, string | undefined>): Promise<Record<string, unknown>>;
    getModel(req: FastifyRequest, modelId: string, res: FastifyReply): Promise<Record<string, unknown>>;
    prediction(req: FastifyRequest, body: Record<string, unknown>, res: FastifyReply): Promise<Record<string, unknown>>;
    getPrediction(req: FastifyRequest, predictionId: string, res: FastifyReply): Promise<Record<string, unknown>>;
    outcome(req: FastifyRequest, predictionId: string, body: Record<string, unknown>, res: FastifyReply): Promise<Record<string, unknown>>;
    validation(req: FastifyRequest, predictionId: string, body: Record<string, unknown>, res: FastifyReply): Promise<Record<string, unknown>>;
    knowledge(req: FastifyRequest, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    private ifMatch;
    private withEtag;
}
