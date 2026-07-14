import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { DatabaseService } from './database.service';
import { DemoStoreService } from './demo-store.service';
import { FixtureService } from './fixture.service';

@Controller()
export class AdminController {
  constructor(
    private readonly contexts: ContextService,
    private readonly fixtures: FixtureService,
    private readonly database: DatabaseService,
    private readonly store: DemoStoreService,
  ) {}

  @Get('/healthz')
  health(): Record<string, unknown> {
    return { status: 'ok', workload: 'api', version: '1.0.0' };
  }

  @Get('/readyz')
  async ready(): Promise<Record<string, unknown>> {
    return { status: 'ready', postgres: await this.database.health(), fixtures: 'loaded' };
  }

  @Get('/v1/me')
  me(@Req() request: FastifyRequest): Record<string, unknown> {
    const ctx = this.contexts.resolve(request, true);
    return {
      actor: this.publicActor(ctx),
      active_context: this.publicContext(ctx),
      memberships: [{ membership_id: ctx.membershipId, tenant_name: ctx.tenantName, tenant_alias: ctx.tenantAlias, roles: ctx.actor.roles }],
      capabilities: ctx.actor.capabilities,
    };
  }

  @Post('/v1/context-selections')
  @HttpCode(HttpStatus.CREATED)
  selectContext(
    @Req() request: FastifyRequest,
    @Body() body: { membership_id?: string; audience?: string; delivery?: string },
    @Res({ passthrough: true }) response: FastifyReply,
  ): Record<string, unknown> {
    const ctx = this.contexts.resolve(request, true);
    const result = this.contexts.mint(ctx.actor, String(body.membership_id ?? ''), String(body.audience ?? 'edt-web'));
    response.header('cache-control', 'private, no-store');
    if (body.delivery === 'browser_cookie') {
      response.header('set-cookie', `EDT-Context=${result.handle}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900`);
      return { active_context: this.publicContext(ctx), expires_at: result.expiresAt, delivery: 'browser_cookie' };
    }
    return { active_context: this.publicContext(ctx), expires_at: result.expiresAt, delivery: 'sdk_header', context_handle: result.handle };
  }

  @Get('/v1/connectors')
  connectors(@Req() request: FastifyRequest): object {
    return this.store.connectors(this.contexts.resolve(request));
  }

  @Get('/v1/audit-events')
  audit(@Req() request: FastifyRequest): object {
    return this.store.listAudit(this.contexts.resolve(request), 100);
  }

  private publicActor(ctx: ReturnType<ContextService['resolve']>): Record<string, unknown> {
    return {
      actor_id: ctx.actor.actor_id,
      actor_type: 'human',
      tenant_id: ctx.tenantId,
      principal_ref: ctx.actor.principal_ref,
      status: 'active',
      assurance_level: ctx.actor.roles.some((role) => role.includes('approver')) ? 'aal2' : 'aal1',
      authenticates: true,
      display_name: ctx.actor.actor_alias,
    };
  }

  private publicContext(ctx: ReturnType<ContextService['resolve']>): Record<string, unknown> {
    return {
      tenant_id: ctx.tenantId,
      membership_id: ctx.membershipId,
      actor: this.publicActor(ctx),
      active_delegations: [],
      purpose: 'interactive_read',
      policy_version: ctx.policyVersion,
      authorized_at: new Date().toISOString(),
      home_region: 'us-east-1',
      trace_context: { traceparent: '00-00000000000000000000000000000000-0000000000000000-01', request_id: ctx.requestId, tenant_safe_baggage: {} },
      derived_by_server: true,
    };
  }
}
