import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { DemoStoreService } from './demo-store.service';
import { requireIdempotencyKey } from './request-validation';

@Controller('/v1')
export class SimulationController {
  constructor(private readonly contexts: ContextService, private readonly store: DemoStoreService) {}

  @Post('/simulation-snapshots')
  @HttpCode(HttpStatus.CREATED)
  snapshot(@Req() request: FastifyRequest, @Body() body: { project_id?: string; as_of?: string }): Record<string, unknown> {
    requireIdempotencyKey(request);
    return this.store.createSnapshot(this.contexts.resolve(request), String(body.project_id ?? ''), String(body.as_of ?? new Date().toISOString()));
  }

  @Post('/scenarios')
  @HttpCode(HttpStatus.CREATED)
  scenario(
    @Req() request: FastifyRequest,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Record<string, unknown> {
    requireIdempotencyKey(request);
    const result = this.store.createScenario(this.contexts.resolve(request), body);
    response.header('etag', String(result.etag));
    return result;
  }

  @Post('/scenarios/:scenarioId/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(
    @Req() request: FastifyRequest,
    @Param('scenarioId') scenarioId: string,
    @Body() body: { scenario_digest?: string },
  ): Record<string, unknown> {
    requireIdempotencyKey(request);
    const ifMatch = typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined;
    return this.store.confirmScenario(this.contexts.resolve(request), scenarioId, String(body.scenario_digest ?? ''), ifMatch);
  }

  @Post('/simulations')
  @HttpCode(HttpStatus.ACCEPTED)
  async simulate(@Req() request: FastifyRequest, @Body() body: { scenario_id?: string }): Promise<Record<string, unknown>> {
    requireIdempotencyKey(request);
    return this.store.runSimulation(this.contexts.resolve(request), String(body.scenario_id ?? ''));
  }

  @Get('/simulations/:simulationId')
  simulation(@Req() request: FastifyRequest, @Param('simulationId') simulationId: string): Record<string, unknown> {
    return this.store.getSimulation(this.contexts.resolve(request), simulationId);
  }

  @Get('/simulations/:simulationId/events')
  @Header('content-type', 'text/event-stream; charset=utf-8')
  @Header('cache-control', 'no-cache, no-store')
  events(@Req() request: FastifyRequest, @Param('simulationId') simulationId: string): string {
    const view = this.store.getSimulation(this.contexts.resolve(request), simulationId);
    return `id: 1\nevent: run.completed\ndata: ${JSON.stringify({ schema_version: 1, simulation_id: simulationId, sequence: 1, result_url: `/v1/simulations/${simulationId}`, state: view })}\n\n`;
  }
}
