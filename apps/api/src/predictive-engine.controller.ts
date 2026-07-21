import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { PredictiveEngineService } from './predictive-engine.service';
import { requireIdempotencyKey } from './request-validation';

@Controller('/v1/twin/prediction')
export class PredictiveEngineController {
  constructor(private readonly contexts: ContextService, private readonly engine: PredictiveEngineService) {}

  @Post('/models') @HttpCode(HttpStatus.CREATED) @Header('Cache-Control', 'private, no-store')
  async model(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: FastifyReply) {
    return this.withEtag(res, await this.engine.registerModel(this.contexts.resolve(req), body, requireIdempotencyKey(req)));
  }

  @Get('/models') @Header('Cache-Control', 'private, no-store')
  models(@Req() req: FastifyRequest, @Query() query: Record<string, string | undefined>) {
    return this.engine.listModels(this.contexts.resolve(req), query);
  }

  @Get('/models/:modelId') @Header('Cache-Control', 'private, no-store')
  async getModel(@Req() req: FastifyRequest, @Param('modelId') modelId: string, @Res({ passthrough: true }) res: FastifyReply) {
    return this.withEtag(res, await this.engine.getModel(this.contexts.resolve(req), modelId));
  }

  @Post('/runs') @HttpCode(HttpStatus.CREATED) @Header('Cache-Control', 'private, no-store')
  async prediction(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: FastifyReply) {
    return this.withEtag(res, await this.engine.createPrediction(this.contexts.resolve(req), body, requireIdempotencyKey(req)));
  }

  @Get('/runs/:predictionId') @Header('Cache-Control', 'private, no-store')
  async getPrediction(@Req() req: FastifyRequest, @Param('predictionId') predictionId: string, @Res({ passthrough: true }) res: FastifyReply) {
    return this.withEtag(res, await this.engine.getPrediction(this.contexts.resolve(req), predictionId));
  }

  @Post('/runs/:predictionId/outcomes') @Header('Cache-Control', 'private, no-store')
  async outcome(@Req() req: FastifyRequest, @Param('predictionId') predictionId: string, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: FastifyReply) {
    return this.withEtag(res, await this.engine.recordOutcome(this.contexts.resolve(req), predictionId, body, requireIdempotencyKey(req), this.ifMatch(req)));
  }

  @Post('/runs/:predictionId/validations') @Header('Cache-Control', 'private, no-store')
  async validation(@Req() req: FastifyRequest, @Param('predictionId') predictionId: string, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: FastifyReply) {
    return this.withEtag(res, await this.engine.validateOutcome(this.contexts.resolve(req), predictionId, body, requireIdempotencyKey(req), this.ifMatch(req)));
  }

  @Post('/knowledge') @HttpCode(HttpStatus.CREATED) @Header('Cache-Control', 'private, no-store')
  knowledge(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>) {
    return this.engine.submitKnowledge(this.contexts.resolve(req), body, requireIdempotencyKey(req));
  }

  private ifMatch(request: FastifyRequest): string | undefined {
    return typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined;
  }

  private withEtag(response: FastifyReply, result: Record<string, unknown>): Record<string, unknown> {
    if (typeof result.etag === 'string') response.header('etag', result.etag);
    return result;
  }
}
