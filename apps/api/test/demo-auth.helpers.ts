import { randomBytes } from 'node:crypto';
import { DemoAuthService } from '../src/demo-auth.service';
import { ActorAlias } from '../src/domain';
import { FixtureService } from '../src/fixture.service';

process.env.EDT_DEMO_AUTH = 'true';
process.env.EDT_DEMO_AUTH_SECRET ??= randomBytes(48).toString('base64url');
process.env.EDT_DEMO_AUTH_BOOTSTRAP_KEY ??= randomBytes(48).toString('base64url');
process.env.EDT_DEMO_AUTH_TTL_SECONDS = '900';

const fixtures = new FixtureService();
fixtures.onModuleInit();
const auth = new DemoAuthService();
auth.onModuleInit();

export function demoAuthHeaders(actorAlias: ActorAlias): { authorization: string } {
  return { authorization: `Bearer ${demoAccessToken(actorAlias)}` };
}

export function demoAccessToken(actorAlias: ActorAlias, nowSeconds?: number, ttlSeconds?: number): string {
  return auth.issue(fixtures.getActor(actorAlias), nowSeconds, ttlSeconds).access_token;
}

export function demoBootstrapKey(): string {
  return process.env.EDT_DEMO_AUTH_BOOTSTRAP_KEY as string;
}
