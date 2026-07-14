import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AssetTwinService } from './asset-twin.service';
import { ContextService } from './context.service';
import { requireIdempotencyKey } from './request-validation';

@Controller('/v1/assets')
export class AssetTwinController {
  constructor(
    private readonly contexts: ContextService,
    private readonly assets: AssetTwinService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Req() request: FastifyRequest): object {
    return this.assets.listAssets(this.contexts.resolve(request));
  }

  @Get('/:assetId/twin')
  @Header('Cache-Control', 'private, no-store')
  twin(@Req() request: FastifyRequest, @Param('assetId') assetId: string): object {
    return this.assets.getTwin(this.contexts.resolve(request), assetId);
  }

  @Get('/:assetId/telemetry')
  @Header('Cache-Control', 'private, no-store')
  telemetry(
    @Req() request: FastifyRequest,
    @Param('assetId') assetId: string,
    @Query('limit') requestedLimit?: string,
  ): object {
    const limit = requestedLimit === undefined ? 1 : Number(requestedLimit);
    return this.assets.advanceTelemetry(this.contexts.resolve(request), assetId, limit);
  }

  @Post('/:assetId/control-previews')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'private, no-store')
  async preview(
    @Req() request: FastifyRequest,
    @Param('assetId') assetId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<object> {
    return this.createPreview(request, response, assetId, body);
  }

  @Post('/:assetId/commands/preview')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'private, no-store')
  async previewAlias(
    @Req() request: FastifyRequest,
    @Param('assetId') assetId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<object> {
    return this.createPreview(request, response, assetId, body);
  }

  @Post('/:assetId/control-previews/:previewId/execute')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  execute(
    @Req() request: FastifyRequest,
    @Param('assetId') assetId: string,
    @Param('previewId') previewId: string,
  ): Promise<object> {
    return this.executePreview(request, assetId, previewId);
  }

  @Post('/:assetId/commands/execute')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  executeAlias(
    @Req() request: FastifyRequest,
    @Param('assetId') assetId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<object> {
    return this.executePreview(request, assetId, String(body.preview_id ?? ''));
  }

  private async createPreview(
    request: FastifyRequest,
    response: FastifyReply,
    assetId: string,
    body: Record<string, unknown>,
  ): Promise<object> {
    const result = await this.assets.previewControl(this.contexts.resolve(request), assetId, body, requireIdempotencyKey(request));
    response.header('etag', result.etag);
    response.header('cache-control', 'private, no-store');
    return result;
  }

  private executePreview(request: FastifyRequest, assetId: string, previewId: string): Promise<object> {
    const ifMatch = typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined;
    return this.assets.executeControl(this.contexts.resolve(request), assetId, previewId, ifMatch, requireIdempotencyKey(request));
  }
}
