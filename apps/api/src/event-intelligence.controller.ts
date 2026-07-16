import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { EventIntelligenceService } from './event-intelligence.service';
import { requireIdempotencyKey } from './request-validation';

@Controller('/v1/event-intelligence')
export class EventIntelligenceController {
  constructor(
    private readonly contexts: ContextService,
    private readonly intelligence: EventIntelligenceService,
  ) {}

  @Get('/taxonomy')
  @Header('Cache-Control', 'private, no-store')
  taxonomy(@Req() request: FastifyRequest): object {
    return this.intelligence.taxonomy(this.contexts.resolve(request));
  }

  @Post('/interpretations')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'private, no-store')
  interpret(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>): Promise<object> {
    return this.intelligence.interpret(this.contexts.resolve(request), body, requireIdempotencyKey(request));
  }

  @Get('/events')
  @Header('Cache-Control', 'private, no-store')
  events(
    @Req() request: FastifyRequest,
    @Query('page_size') pageSize?: string,
    @Query('page_cursor') pageCursor?: string,
  ): object {
    return this.intelligence.listEvents(this.contexts.resolve(request), pageSize, pageCursor);
  }

  @Get('/events/:eventId')
  @Header('Cache-Control', 'private, no-store')
  event(
    @Req() request: FastifyRequest,
    @Param('eventId') eventId: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ): object {
    const event = this.intelligence.getEvent(this.contexts.resolve(request), eventId);
    response.header('etag', event.etag);
    return event;
  }

  @Post('/events/:eventId/reviews')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  async review(
    @Req() request: FastifyRequest,
    @Param('eventId') eventId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<object> {
    const event = await this.intelligence.review(
      this.contexts.resolve(request), eventId, body, this.ifMatch(request), requireIdempotencyKey(request),
    );
    response.header('etag', event.etag);
    return event;
  }

  @Post('/events/:eventId/approval-requests')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'private, no-store')
  requestApproval(
    @Req() request: FastifyRequest,
    @Param('eventId') eventId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<object> {
    return this.intelligence.requestApproval(
      this.contexts.resolve(request), eventId, body, this.ifMatch(request), requireIdempotencyKey(request),
    );
  }

  @Get('/approval-requests/:approvalId')
  @Header('Cache-Control', 'private, no-store')
  approval(@Req() request: FastifyRequest, @Param('approvalId') approvalId: string): object {
    return this.intelligence.getApproval(this.contexts.resolve(request), approvalId);
  }

  @Post('/approval-requests/:approvalId/decisions')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  decide(
    @Req() request: FastifyRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<object> {
    return this.intelligence.decideApproval(this.contexts.resolve(request), approvalId, body, requireIdempotencyKey(request));
  }

  @Post('/events/:eventId/apply')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  apply(
    @Req() request: FastifyRequest,
    @Param('eventId') eventId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<object> {
    return this.intelligence.apply(
      this.contexts.resolve(request), eventId, body, this.ifMatch(request), requireIdempotencyKey(request),
    );
  }

  @Post('/events/:eventId/rollback')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  rollback(
    @Req() request: FastifyRequest,
    @Param('eventId') eventId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<object> {
    return this.intelligence.rollback(
      this.contexts.resolve(request), eventId, body, this.ifMatch(request), requireIdempotencyKey(request),
    );
  }

  @Get('/events/:eventId/audit')
  @Header('Cache-Control', 'private, no-store')
  audit(@Req() request: FastifyRequest, @Param('eventId') eventId: string): object {
    return this.intelligence.eventAudit(this.contexts.resolve(request), eventId);
  }

  @Get('/events/:eventId/replay')
  @Header('Cache-Control', 'private, no-store')
  replay(@Req() request: FastifyRequest, @Param('eventId') eventId: string): object {
    return this.intelligence.replay(this.contexts.resolve(request), eventId);
  }

  @Get('/timeline')
  @Header('Cache-Control', 'private, no-store')
  timeline(@Req() request: FastifyRequest): object {
    return this.intelligence.timeline(this.contexts.resolve(request));
  }

  @Get('/branches')
  @Header('Cache-Control', 'private, no-store')
  branches(@Req() request: FastifyRequest): object {
    return this.intelligence.listBranches(this.contexts.resolve(request));
  }

  @Post('/branches/compare')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  compareBranches(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>): object {
    return this.intelligence.compareBranches(this.contexts.resolve(request), body);
  }

  private ifMatch(request: FastifyRequest): string | undefined {
    const value = request.headers['if-match'];
    return typeof value === 'string' ? value : undefined;
  }
}
