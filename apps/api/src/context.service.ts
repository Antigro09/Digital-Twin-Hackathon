import { HttpStatus, Injectable } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { ActorRecord, RequestContext, newId } from './domain';
import { FixtureService } from './fixture.service';
import { ProblemException } from './problem';

interface HandleRecord {
  handle: string;
  actorId: string;
  membershipId: string;
  tenantId: string;
  audience: string;
  expiresAt: number;
}

@Injectable()
export class ContextService {
  private readonly handles = new Map<string, HandleRecord>();

  constructor(private readonly fixtures: FixtureService) {}

  resolve(request: FastifyRequest, allowBootstrap = false): RequestContext {
    if (request.headers['x-tenant-id']) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'raw_tenant_selector_rejected', 'Tenant scope is derived by the server; X-Tenant-ID is never accepted.');
    }
    const actorHeader = request.headers['x-demo-actor'];
    if (process.env.EDT_DEMO_AUTH === 'false' && actorHeader) {
      throw new ProblemException(HttpStatus.UNAUTHORIZED, 'demo_auth_disabled', 'Synthetic actor selection is disabled.');
    }
    let actor: ActorRecord;
    try {
      actor = this.fixtures.getActor(typeof actorHeader === 'string' ? actorHeader : undefined);
    } catch {
      throw new ProblemException(HttpStatus.UNAUTHORIZED, 'invalid_actor', 'Authentication failed.');
    }
    const membershipId = this.fixtures.membershipId(actor);
    const supplied = request.headers['x-edt-context'];
    let handle: HandleRecord | undefined;
    if (typeof supplied === 'string') {
      handle = this.handles.get(supplied);
      if (!handle || handle.actorId !== actor.actor_id || handle.expiresAt <= Date.now()) {
        throw new ProblemException(HttpStatus.UNAUTHORIZED, 'invalid_context', 'The opaque context handle is invalid or expired.');
      }
    } else if (!allowBootstrap) {
      // The synthetic H1 profile derives the actor's sole membership without exposing a tenant selector.
      handle = undefined;
    }
    const tenant = this.fixtures.tenantForId(handle?.tenantId ?? actor.tenant_id);
    return {
      tenantId: tenant.id,
      tenantAlias: tenant.alias,
      tenantName: tenant.name,
      actor,
      membershipId,
      contextHandle: handle?.handle,
      policyVersion: 'h1-policy/1.0.0',
      requestId: this.requestId(request),
    };
  }

  mint(actor: ActorRecord, membershipId: string, audience: string): { handle: string; expiresAt: string } {
    if (this.fixtures.membershipId(actor) !== membershipId) {
      throw new ProblemException(HttpStatus.NOT_FOUND, 'membership_not_found', 'Membership was not found.');
    }
    const handle = `edt_ctx_${randomBytes(32).toString('base64url')}`;
    const expiresAt = Date.now() + 15 * 60 * 1000;
    this.handles.set(handle, { handle, actorId: actor.actor_id, membershipId, tenantId: actor.tenant_id, audience, expiresAt });
    return { handle, expiresAt: new Date(expiresAt).toISOString() };
  }

  private requestId(request: FastifyRequest): string {
    const value = request.headers['x-request-id'];
    return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) ? value : newId();
  }
}
