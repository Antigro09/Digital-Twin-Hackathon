import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { requireIdempotencyKey } from './request-validation';
import { SimulationEngineService } from './simulation-engine.service';

@Controller('/v1/twin/simulation')
export class SimulationEngineController {
  constructor(private readonly contexts: ContextService, private readonly engine: SimulationEngineService) {}

  @Post('/snapshots') @HttpCode(HttpStatus.CREATED) @Header('Cache-Control', 'private, no-store')
  async snapshot(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: FastifyReply) {
    return this.withEtag(res, await this.engine.createSnapshot(this.contexts.resolve(req), body, requireIdempotencyKey(req)));
  }

  @Get('/snapshots/:snapshotId') @Header('Cache-Control', 'private, no-store')
  async getSnapshot(@Req() req: FastifyRequest, @Param('snapshotId') snapshotId: string, @Res({ passthrough: true }) res: FastifyReply) {
    return this.withEtag(res, await this.engine.getSnapshot(this.contexts.resolve(req), snapshotId));
  }

  @Post('/scenarios') @HttpCode(HttpStatus.CREATED) @Header('Cache-Control', 'private, no-store')
  async scenario(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: FastifyReply) {
    return this.withEtag(res, await this.engine.createScenario(this.contexts.resolve(req), body, requireIdempotencyKey(req)));
  }

  @Get('/scenarios/:scenarioId/branches') @Header('Cache-Control', 'private, no-store')
  branches(@Req() req: FastifyRequest, @Param('scenarioId') scenarioId: string) {
    return this.engine.listBranches(this.contexts.resolve(req), scenarioId);
  }

  @Post('/scenarios/:scenarioId/branches') @HttpCode(HttpStatus.CREATED) @Header('Cache-Control', 'private, no-store')
  async branch(@Req() req: FastifyRequest, @Param('scenarioId') scenarioId: string, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: FastifyReply) {
    return this.withEtag(res, await this.engine.createBranch(this.contexts.resolve(req), scenarioId, body, requireIdempotencyKey(req)));
  }

  @Post('/scenarios/:scenarioId/branches/:branchId/confirm') @Header('Cache-Control', 'private, no-store')
  async confirm(@Req() req: FastifyRequest, @Param('scenarioId') scenarioId: string, @Param('branchId') branchId: string, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: FastifyReply) {
    const ifMatch = typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : undefined;
    return this.withEtag(res, await this.engine.confirmBranch(this.contexts.resolve(req), scenarioId, branchId, body, requireIdempotencyKey(req), ifMatch));
  }

  @Post('/runs') @HttpCode(HttpStatus.CREATED) @Header('Cache-Control', 'private, no-store')
  run(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>) {
    return this.engine.run(this.contexts.resolve(req), body, requireIdempotencyKey(req));
  }

  @Get('/runs/:simulationId') @Header('Cache-Control', 'private, no-store')
  getRun(@Req() req: FastifyRequest, @Param('simulationId') simulationId: string) {
    return this.engine.getRun(this.contexts.resolve(req), simulationId);
  }

  @Post('/comparisons') @HttpCode(HttpStatus.OK) @Header('Cache-Control', 'private, no-store')
  compare(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>) {
    return this.engine.compareRuns(this.contexts.resolve(req), body);
  }

  private withEtag(response: FastifyReply, result: Record<string, unknown>): Record<string, unknown> {
    if (typeof result.etag === 'string') response.header('etag', result.etag);
    return result;
  }
}
