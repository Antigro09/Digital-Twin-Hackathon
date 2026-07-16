import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ActorAlias, ActorRecord } from './domain';
import { ProblemException } from './problem';

interface DemoTokenHeader {
  alg: 'HS256';
  kid: 'edt-local-demo-v1';
  typ: 'JWT';
}

interface DemoTokenClaims {
  iss: 'edt-local-demo';
  aud: 'edt-api';
  sub: ActorAlias;
  actor_id: string;
  tenant_id: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface DemoSession {
  access_token: string;
  token_type: 'Bearer';
  expires_at: string;
  expires_in: number;
  actor_alias: ActorAlias;
}

export interface AuthenticatedDemoPrincipal {
  actorAlias: ActorAlias;
  actorId: string;
  tenantId: string;
  tokenId: string;
  expiresAt: string;
}

const TOKEN_HEADER: DemoTokenHeader = { alg: 'HS256', kid: 'edt-local-demo-v1', typ: 'JWT' };
const MAX_TOKEN_TTL_SECONDS = 15 * 60;
const MIN_SECRET_CHARACTERS = 32;

@Injectable()
export class DemoAuthService implements OnModuleInit {
  onModuleInit(): void {
    if (this.enabled) this.configuration();
  }

  get enabled(): boolean {
    return process.env.EDT_DEMO_AUTH === 'true';
  }

  issue(actor: ActorRecord, nowSeconds = Math.floor(Date.now() / 1_000), requestedTtlSeconds?: number): DemoSession {
    this.assertEnabled();
    const { signingSecret, ttlSeconds } = this.configuration();
    const effectiveTtl = requestedTtlSeconds ?? ttlSeconds;
    if (!Number.isSafeInteger(effectiveTtl) || effectiveTtl < 1 || effectiveTtl > MAX_TOKEN_TTL_SECONDS) {
      throw new Error(`Demo access-token TTL must be between 1 and ${MAX_TOKEN_TTL_SECONDS} seconds.`);
    }
    const claims: DemoTokenClaims = {
      iss: 'edt-local-demo',
      aud: 'edt-api',
      sub: actor.actor_alias,
      actor_id: actor.actor_id,
      tenant_id: actor.tenant_id,
      iat: nowSeconds,
      exp: nowSeconds + effectiveTtl,
      jti: randomUUID(),
    };
    const encodedHeader = this.encode(TOKEN_HEADER);
    const encodedClaims = this.encode(claims);
    const signature = this.sign(`${encodedHeader}.${encodedClaims}`, signingSecret);
    return {
      access_token: `${encodedHeader}.${encodedClaims}.${signature}`,
      token_type: 'Bearer',
      expires_at: new Date(claims.exp * 1_000).toISOString(),
      expires_in: effectiveTtl,
      actor_alias: actor.actor_alias,
    };
  }

  authenticate(authorization: string | string[] | undefined): AuthenticatedDemoPrincipal {
    this.assertEnabled();
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      throw new ProblemException(HttpStatus.UNAUTHORIZED, 'demo_bearer_required', 'A signed local-demo Bearer token is required.');
    }
    const token = authorization.slice('Bearer '.length).trim();
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) this.invalidToken();

    const [encodedHeader, encodedClaims, suppliedSignature] = parts;
    const { signingSecret } = this.configuration();
    const expectedSignature = this.sign(`${encodedHeader}.${encodedClaims}`, signingSecret);
    const supplied = Buffer.from(suppliedSignature, 'base64url');
    const expected = Buffer.from(expectedSignature, 'base64url');
    if (supplied.toString('base64url') !== suppliedSignature || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) this.invalidToken();

    const header = this.decode<Partial<DemoTokenHeader>>(encodedHeader);
    const claims = this.decode<Partial<DemoTokenClaims>>(encodedClaims);
    if (header.alg !== TOKEN_HEADER.alg || header.typ !== TOKEN_HEADER.typ || header.kid !== TOKEN_HEADER.kid) this.invalidToken();
    if (claims.iss !== 'edt-local-demo' || claims.aud !== 'edt-api') this.invalidToken();
    if (
      typeof claims.sub !== 'string'
      || typeof claims.actor_id !== 'string'
      || typeof claims.tenant_id !== 'string'
      || typeof claims.jti !== 'string'
      || !Number.isSafeInteger(claims.iat)
      || !Number.isSafeInteger(claims.exp)
    ) this.invalidToken();

    const issuedAt = Number(claims.iat);
    const expiresAt = Number(claims.exp);
    const now = Math.floor(Date.now() / 1_000);
    if (issuedAt > now + 30 || expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TOKEN_TTL_SECONDS) {
      throw new ProblemException(HttpStatus.UNAUTHORIZED, 'demo_token_expired', 'The local-demo access token is expired or outside its permitted lifetime.');
    }
    return {
      actorAlias: claims.sub as ActorAlias,
      actorId: claims.actor_id as string,
      tenantId: claims.tenant_id as string,
      tokenId: claims.jti as string,
      expiresAt: new Date(expiresAt * 1_000).toISOString(),
    };
  }

  assertBootstrapKey(value: string | string[] | undefined): void {
    this.assertEnabled();
    const { bootstrapKey } = this.configuration();
    if (typeof value !== 'string') this.invalidBootstrapKey();
    const supplied = createHmac('sha256', bootstrapKey).update(value as string, 'utf8').digest();
    const expected = createHmac('sha256', bootstrapKey).update(bootstrapKey, 'utf8').digest();
    if (!timingSafeEqual(supplied, expected)) this.invalidBootstrapKey();
  }

  private configuration(): { signingSecret: string; bootstrapKey: string; ttlSeconds: number } {
    const signingSecret = process.env.EDT_DEMO_AUTH_SECRET ?? '';
    const bootstrapKey = process.env.EDT_DEMO_AUTH_BOOTSTRAP_KEY ?? '';
    if (signingSecret.length < MIN_SECRET_CHARACTERS) {
      throw new Error(`EDT_DEMO_AUTH_SECRET must contain at least ${MIN_SECRET_CHARACTERS} characters when EDT_DEMO_AUTH=true.`);
    }
    if (bootstrapKey.length < MIN_SECRET_CHARACTERS) {
      throw new Error(`EDT_DEMO_AUTH_BOOTSTRAP_KEY must contain at least ${MIN_SECRET_CHARACTERS} characters when EDT_DEMO_AUTH=true.`);
    }
    const configuredTtl = Number(process.env.EDT_DEMO_AUTH_TTL_SECONDS ?? MAX_TOKEN_TTL_SECONDS);
    const ttlSeconds = Number.isSafeInteger(configuredTtl) && configuredTtl >= 60 && configuredTtl <= MAX_TOKEN_TTL_SECONDS
      ? configuredTtl
      : MAX_TOKEN_TTL_SECONDS;
    return { signingSecret, bootstrapKey, ttlSeconds };
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new ProblemException(HttpStatus.UNAUTHORIZED, 'demo_auth_disabled', 'Local-demo authentication is disabled; configure an external identity provider.');
    }
  }

  private encode(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  }

  private decode<T>(value: string): T {
    try {
      const bytes = Buffer.from(value, 'base64url');
      if (bytes.toString('base64url') !== value) this.invalidToken();
      return JSON.parse(bytes.toString('utf8')) as T;
    } catch (error) {
      if (error instanceof ProblemException) throw error;
      return this.invalidToken();
    }
  }

  private sign(input: string, secret: string): string {
    return createHmac('sha256', secret).update(input, 'utf8').digest('base64url');
  }

  private invalidToken(): never {
    throw new ProblemException(HttpStatus.UNAUTHORIZED, 'invalid_demo_token', 'The local-demo access token is invalid.');
  }

  private invalidBootstrapKey(): never {
    throw new ProblemException(HttpStatus.UNAUTHORIZED, 'invalid_demo_credentials', 'The local-demo bootstrap credential is invalid.');
  }
}
