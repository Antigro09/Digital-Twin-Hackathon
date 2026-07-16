import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { AiGatewayService } from './ai-gateway.service';
import { ContextService } from './context.service';
import { requireIdempotencyKey } from './request-validation';

@Controller('/v1/ai')
export class AiGatewayController {
  constructor(
    private readonly contexts: ContextService,
    private readonly gateway: AiGatewayService,
  ) {}

  @Get('/status')
  @Header('cache-control', 'private, no-store')
  status(@Req() request: FastifyRequest): Promise<Record<string, unknown>> {
    return this.gateway.status(this.contexts.resolve(request));
  }

  @Get('/activity')
  @Header('cache-control', 'private, no-store')
  activity(
    @Req() request: FastifyRequest,
    @Query('page_size') pageSize?: string,
  ): Promise<Record<string, unknown>> {
    return this.gateway.activity(this.contexts.resolve(request), pageSize);
  }

  @Post('/agent-runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('cache-control', 'private, no-store')
  runAgent(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const context = this.contexts.resolve(request);
    return this.gateway.runAgent(context, body, requireIdempotencyKey(request));
  }

  @Post('/retrieval/query')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  retrieve(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.gateway.retrieve(this.contexts.resolve(request), body);
  }

  @Post('/knowledge/import')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('cache-control', 'private, no-store')
  importDocument(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const context = this.contexts.resolve(request);
    return this.gateway.importDocument(context, body, requireIdempotencyKey(request));
  }

  @Get('/suggestions')
  @Header('cache-control', 'private, no-store')
  suggestions(
    @Req() request: FastifyRequest,
    @Query('page_size') pageSize?: string,
    @Query('review_decision') reviewDecision?: string,
  ): Promise<Record<string, unknown>> {
    return this.gateway.suggestions(this.contexts.resolve(request), pageSize, reviewDecision);
  }

  @Post('/suggestions/:suggestionId/reviews')
  @HttpCode(HttpStatus.CREATED)
  @Header('cache-control', 'private, no-store')
  reviewSuggestion(
    @Req() request: FastifyRequest,
    @Param('suggestionId') suggestionId: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const context = this.contexts.resolve(request);
    return this.gateway.reviewSuggestion(context, suggestionId, body, requireIdempotencyKey(request));
  }

  @Post('/learning/outcomes')
  @HttpCode(HttpStatus.CREATED)
  @Header('cache-control', 'private, no-store')
  recordLearningOutcome(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const context = this.contexts.resolve(request);
    return this.gateway.recordLearningOutcome(context, body, requireIdempotencyKey(request));
  }
}
