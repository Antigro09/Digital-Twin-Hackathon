import { FastifyRequest } from 'fastify';
import { DemoAuthService, DemoSession } from './demo-auth.service';
import { FixtureService } from './fixture.service';
export declare class DemoAuthController {
    private readonly auth;
    private readonly fixtures;
    constructor(auth: DemoAuthService, fixtures: FixtureService);
    createSession(request: FastifyRequest, body: Record<string, unknown>): DemoSession;
}
