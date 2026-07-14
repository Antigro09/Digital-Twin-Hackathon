import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { DemoStoreService } from './demo-store.service';
import { requireIdempotencyKey } from './request-validation';

@Controller('/v1')
export class AgentController {
  constructor(private readonly contexts: ContextService, private readonly store: DemoStoreService) {}

  @Post('/questions')
  @HttpCode(HttpStatus.ACCEPTED)
  async ask(@Req() request: FastifyRequest, @Body() body: { question?: string }): Promise<Record<string, unknown>> {
    requireIdempotencyKey(request);
    return this.store.createQuestion(this.contexts.resolve(request), String(body.question ?? ''));
  }

  @Get('/agent-runs/:runId')
  run(@Req() request: FastifyRequest, @Param('runId') runId: string): Record<string, unknown> {
    return this.store.getAgentRun(this.contexts.resolve(request), runId);
  }

  @Get('/agent-runs/:runId/events')
  @Header('content-type', 'text/event-stream; charset=utf-8')
  @Header('cache-control', 'no-cache, no-store')
  events(@Req() request: FastifyRequest, @Param('runId') runId: string): string {
    const view = this.store.getAgentRun(this.contexts.resolve(request), runId);
    return `id: 1\nevent: run.completed\ndata: ${JSON.stringify({ schema_version: 1, run_id: runId, sequence: 1, result_url: `/v1/agent-runs/${runId}`, state: view })}\n\n`;
  }

  @Post('/agent-runs/:runId/cancel')
  async cancel(
    @Req() request: FastifyRequest,
    @Param('runId') runId: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    requireIdempotencyKey(request);
    const result = await this.store.cancelAgentRun(this.contexts.resolve(request), runId);
    response.status(result.terminal ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return result.view;
  }
}
