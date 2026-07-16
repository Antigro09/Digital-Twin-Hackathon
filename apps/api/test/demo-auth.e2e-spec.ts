import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { demoAccessToken, demoAuthHeaders, demoBootstrapKey } from './demo-auth.helpers';

describe('Signed local-demo authentication (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    process.env.EDT_DEMO_AUTH = 'true';
    await app.close();
  });

  it('fails closed without authentication and rejects the legacy actor selector', async () => {
    await request(app.getHttpServer())
      .get('/v1/me')
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('demo_bearer_required'));

    await request(app.getHttpServer())
      .get('/v1/me')
      .set('x-demo-actor', 'usr_aster_analyst')
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('legacy_actor_selector_rejected'));
  });

  it('exchanges the bootstrap credential for short-lived signed actor tokens', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/demo-auth/sessions')
      .set('x-demo-auth-key', demoBootstrapKey())
      .send({ actor_alias: 'usr_aster_analyst' })
      .expect(201);

    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual(expect.objectContaining({
      token_type: 'Bearer',
      actor_alias: 'usr_aster_analyst',
      expires_in: 900,
      access_token: expect.stringMatching(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
    }));
    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${response.body.access_token}`)
      .expect(200);
    expect(me.body.actor.display_name).toBe('usr_aster_analyst');
    expect(me.body.active_context.derived_by_server).toBe(true);
  });

  it('binds separate operations and security tokens to distinct fixture principals', async () => {
    const operations = await request(app.getHttpServer()).get('/v1/me').set(demoAuthHeaders('usr_aster_ops_approver')).expect(200);
    const security = await request(app.getHttpServer()).get('/v1/me').set(demoAuthHeaders('usr_aster_security_approver')).expect(200);

    expect(operations.body.actor.actor_id).not.toBe(security.body.actor.actor_id);
    expect(operations.body.actor.assurance_level).toBe('aal2');
    expect(security.body.actor.assurance_level).toBe('aal2');
    expect(operations.body.capabilities).toContain('action.approve.operations');
    expect(security.body.capabilities).toContain('action.approve.security');
  });

  it('keeps authentication mandatory when minting and using an opaque context handle', async () => {
    const headers = demoAuthHeaders('usr_beacon_analyst');
    const me = await request(app.getHttpServer()).get('/v1/me').set(headers).expect(200);
    const selection = await request(app.getHttpServer())
      .post('/v1/context-selections')
      .set(headers)
      .send({ membership_id: me.body.memberships[0].membership_id, audience: 'auth-test', delivery: 'sdk_header' })
      .expect(201);

    await request(app.getHttpServer())
      .get('/v1/me')
      .set('x-edt-context', selection.body.context_handle)
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('demo_bearer_required'));
    const contextual = await request(app.getHttpServer())
      .get('/v1/me')
      .set(headers)
      .set('x-edt-context', selection.body.context_handle)
      .expect(200);
    expect(contextual.body.active_context.tenant_id).toBe(me.body.active_context.tenant_id);
  });

  it('rejects wrong bootstrap credentials, altered signatures, expired tokens, and disabled demo auth', async () => {
    await request(app.getHttpServer())
      .post('/v1/demo-auth/sessions')
      .set('x-demo-auth-key', 'wrong-credential-that-is-long-enough-to-test')
      .send({ actor_alias: 'usr_aster_analyst' })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('invalid_demo_credentials'));

    const token = demoAccessToken('usr_aster_analyst');
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${token.slice(0, -1)}${last}`)
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('invalid_demo_token'));

    const expired = demoAccessToken('usr_aster_analyst', Math.floor(Date.now() / 1_000) - 120, 60);
    await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${expired}`)
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('demo_token_expired'));

    const validWhileEnabled = demoAuthHeaders('usr_aster_analyst');
    process.env.EDT_DEMO_AUTH = 'false';
    await request(app.getHttpServer())
      .get('/v1/me')
      .set(validWhileEnabled)
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('demo_auth_disabled'));
    process.env.EDT_DEMO_AUTH = 'true';
  });
});
