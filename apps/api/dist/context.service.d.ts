import { FastifyRequest } from 'fastify';
import { DemoAuthService } from './demo-auth.service';
import { ActorRecord, RequestContext } from './domain';
import { FixtureService } from './fixture.service';
export declare class ContextService {
    private readonly fixtures;
    private readonly auth;
    private readonly handles;
    constructor(fixtures: FixtureService, auth: DemoAuthService);
    resolve(request: FastifyRequest, allowBootstrap?: boolean): RequestContext;
    mint(actor: ActorRecord, membershipId: string, audience: string): {
        handle: string;
        expiresAt: string;
    };
    private requestId;
}
