import { Body, Controller, Header, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { DemoAuthService, DemoSession } from './demo-auth.service';
import { ActorAlias } from './domain';
import { FixtureService } from './fixture.service';
import { ProblemException } from './problem';

@Controller('/v1/demo-auth')
export class DemoAuthController {
  constructor(
    private readonly auth: DemoAuthService,
    private readonly fixtures: FixtureService,
  ) {}

  @Post('/sessions')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'private, no-store')
  createSession(@Req() request: FastifyRequest, @Body() body: Record<string, unknown>): DemoSession {
    this.auth.assertBootstrapKey(request.headers['x-demo-auth-key']);
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'actor_alias' || typeof body.actor_alias !== 'string') {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_demo_session_request', 'The request must contain only actor_alias.');
    }
    try {
      const actor = this.fixtures.getActor(body.actor_alias as ActorAlias);
      return this.auth.issue(actor);
    } catch (error) {
      if (error instanceof ProblemException) throw error;
      throw new ProblemException(HttpStatus.UNAUTHORIZED, 'invalid_demo_credentials', 'The local-demo bootstrap credential is invalid.');
    }
  }
}
