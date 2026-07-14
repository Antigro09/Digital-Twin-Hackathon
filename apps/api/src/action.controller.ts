import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { DemoStoreService } from './demo-store.service';
import { requireIdempotencyKey } from './request-validation';

@Controller('/v1')
export class ActionController {
  constructor(private readonly contexts: ContextService, private readonly store: DemoStoreService) {}

  @Post('/actions/jira/remediation-previews')
  @HttpCode(HttpStatus.CREATED)
  async preview(
    @Req() request: FastifyRequest,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Record<string, unknown>> {
    requireIdempotencyKey(request);
    const result = await this.store.createPreview(this.contexts.resolve(request), body);
    response.header('etag', String(result.etag));
    return result;
  }

  @Post('/actions/jira/remediation-previews/:previewId/approval-requests')
  @HttpCode(HttpStatus.CREATED)
  async requestApproval(@Req() request: FastifyRequest, @Param('previewId') previewId: string): Promise<Record<string, unknown>> {
    const key = requireIdempotencyKey(request);
    const ifMatch = typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined;
    return this.store.requestApproval(this.contexts.resolve(request), previewId, ifMatch, key);
  }

  @Get('/approvals/:approvalId')
  approval(@Req() request: FastifyRequest, @Param('approvalId') approvalId: string): Record<string, unknown> {
    return this.store.getApproval(this.contexts.resolve(request), approvalId);
  }

  @Post('/approvals/:approvalId/decisions')
  @HttpCode(HttpStatus.OK)
  async decide(
    @Req() request: FastifyRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    requireIdempotencyKey(request);
    return this.store.decideApproval(this.contexts.resolve(request), approvalId, body);
  }

  @Post('/approvals/:approvalId/execute')
  @HttpCode(HttpStatus.OK)
  async execute(@Req() request: FastifyRequest, @Param('approvalId') approvalId: string): Promise<object> {
    const key = requireIdempotencyKey(request);
    return this.store.executeApproval(this.contexts.resolve(request), approvalId, key);
  }

  @Post('/action-receipts/:receiptId/compensation-previews')
  @HttpCode(HttpStatus.CREATED)
  async compensate(@Req() request: FastifyRequest, @Param('receiptId') receiptId: string): Promise<Record<string, unknown>> {
    const key = requireIdempotencyKey(request);
    return this.store.createCompensationApproval(this.contexts.resolve(request), receiptId, key);
  }
}
