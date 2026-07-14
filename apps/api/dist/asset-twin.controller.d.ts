import { FastifyReply, FastifyRequest } from 'fastify';
import { AssetTwinService } from './asset-twin.service';
import { ContextService } from './context.service';
export declare class AssetTwinController {
    private readonly contexts;
    private readonly assets;
    constructor(contexts: ContextService, assets: AssetTwinService);
    list(request: FastifyRequest): object;
    twin(request: FastifyRequest, assetId: string): object;
    telemetry(request: FastifyRequest, assetId: string, requestedLimit?: string): object;
    preview(request: FastifyRequest, assetId: string, body: Record<string, unknown>, response: FastifyReply): Promise<object>;
    previewAlias(request: FastifyRequest, assetId: string, body: Record<string, unknown>, response: FastifyReply): Promise<object>;
    execute(request: FastifyRequest, assetId: string, previewId: string): Promise<object>;
    executeAlias(request: FastifyRequest, assetId: string, body: Record<string, unknown>): Promise<object>;
    private createPreview;
    private executePreview;
}
