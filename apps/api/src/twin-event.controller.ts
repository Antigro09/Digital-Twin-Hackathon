import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { requireIdempotencyKey } from './request-validation';
import { TwinEventService } from './twin-event.service';

@Controller('/v1/twin')
export class TwinEventController {
  constructor(
    private readonly contexts: ContextService,
    private readonly events: TwinEventService,
  ) {}

  @Get('/event-types')
  @Header('Cache-Control', 'private, no-store')
  eventTypes(@Req() request: FastifyRequest): Record<string, unknown> {
    return this.events.eventTypes(this.contexts.resolve(request));
  }

  @Post('/events')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'private, no-store')
  async createEvent(
    @Req() request: FastifyRequest,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.events.createEvent(this.contexts.resolve(request), body, requireIdempotencyKey(request));
    this.setEtag(response, result);
    return result;
  }

  @Get('/events')
  @Header('Cache-Control', 'private, no-store')
  listEvents(@Req() request: FastifyRequest, @Query() query: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    return this.events.listEvents(this.contexts.resolve(request), query);
  }

  @Get('/events/:eventId')
  @Header('Cache-Control', 'private, no-store')
  async event(
    @Req() request: FastifyRequest,
    @Param('eventId') eventId: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.events.getEvent(this.contexts.resolve(request), eventId);
    this.setEtag(response, result);
    return result;
  }

  @Post('/events/:eventId/impact-analysis')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  impactAnalysis(
    @Req() request: FastifyRequest,
    @Param('eventId') eventId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.events.analyzeEventImpact(this.contexts.resolve(request), eventId, body);
  }

  @Post('/data-points')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'private, no-store')
  async createDataPoint(
    @Req() request: FastifyRequest,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.events.createDataPoint(this.contexts.resolve(request), body, requireIdempotencyKey(request));
    this.setEtag(response, result);
    return result;
  }

  @Get('/data-points')
  @Header('Cache-Control', 'private, no-store')
  listDataPoints(@Req() request: FastifyRequest, @Query() query: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    return this.events.listDataPoints(this.contexts.resolve(request), query);
  }

  @Get('/data-points/:dataPointId')
  @Header('Cache-Control', 'private, no-store')
  async dataPoint(
    @Req() request: FastifyRequest,
    @Param('dataPointId') dataPointId: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    const result = await this.events.getDataPoint(this.contexts.resolve(request), dataPointId);
    this.setEtag(response, result);
    return result;
  }

  private setEtag(response: FastifyReply, result: Record<string, unknown>): void {
    if (typeof result.etag === 'string') response.header('etag', result.etag);
  }
}
