import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { demoAuthHeaders } from './demo-auth.helpers';

const admin = demoAuthHeaders('usr_aster_admin');
const analyst = demoAuthHeaders('usr_aster_analyst');
const limited = demoAuthHeaders('usr_aster_limited');
const beacon = demoAuthHeaders('usr_beacon_analyst');
const key = (suffix: string): string => `twin-graph-${suffix}`.padEnd(32, '0');

describe('Extensible enterprise twin graph (e2e)', () => {
  let app: NestFastifyApplication;
  let employeeId = '';
  let applicationId = '';
  let processId = '';
  let customerId = '';
  let applicationEtag = '';

  beforeAll(async () => {
    process.env.EDT_DEMO_AUTH = 'true';
    process.env.EDT_FROZEN_CLOCK = 'true';
    delete process.env.DATABASE_URL;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.EDT_FROZEN_CLOCK;
  });

  it('publishes the default extensible type catalog and protects graph writes', async () => {
    const types = await request(app.getHttpServer()).get('/v1/twin/node-types').set(analyst).expect(200);
    expect(types.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type_id: 'edt.core/Company' }),
      expect.objectContaining({ type_id: 'edt.core/CloudResource' }),
      expect.objectContaining({ type_id: 'edt.core/RevenueStream' }),
    ]));
    expect(types.body.items).toHaveLength(30);

    await request(app.getHttpServer())
      .post('/v1/twin/node-types')
      .set(analyst)
      .set('idempotency-key', key('unauthorized-type'))
      .send({ type_id: 'acme.ops/Capability', display_name: 'Capability', domain: 'Operations' })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('twin_graph_write_denied'));

    const custom = await request(app.getHttpServer())
      .post('/v1/twin/node-types')
      .set(admin)
      .set('idempotency-key', key('custom-type'))
      .send({
        type_id: 'acme.operations/Capability',
        display_name: 'Capability',
        domain: 'Operations',
        description: 'Tenant-defined operational capability.',
        property_schema: {
          type: 'object',
          required: ['level'],
          properties: { level: { type: 'integer' } },
          additionalProperties: false,
        },
      })
      .expect(201);
    expect(custom.body.node_type.type_id).toBe('acme.operations/Capability');

    const replay = await request(app.getHttpServer())
      .post('/v1/twin/node-types')
      .set(admin)
      .set('idempotency-key', key('custom-type'))
      .send({
        type_id: 'acme.operations/Capability',
        display_name: 'Capability',
        domain: 'Operations',
        description: 'Tenant-defined operational capability.',
        property_schema: {
          type: 'object',
          required: ['level'],
          properties: { level: { type: 'integer' } },
          additionalProperties: false,
        },
      })
      .expect(201);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.node_type.type_id).toBe(custom.body.node_type.type_id);

    await request(app.getHttpServer())
      .post('/v1/twin/nodes')
      .set(admin)
      .set('idempotency-key', key('typed-property'))
      .send({ type_id: 'acme.operations/Capability', label: 'Invalid typed node', properties: { level: 'high' } })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('typed_property_invalid'));
  });

  it('models nodes and weighted relationships, then explains structural impact', async () => {
    const createNode = async (suffix: string, body: Record<string, unknown>) => {
      const response = await request(app.getHttpServer())
        .post('/v1/twin/nodes')
        .set(admin)
        .set('idempotency-key', key(`node-${suffix}`))
        .send(body)
        .expect(201);
      return response;
    };

    const employee = await createNode('employee', {
      type_id: 'Employee',
      label: 'Jordan Rivera',
      properties: { employment_status: 'active' },
      metadata: { classification: 'internal' },
      simulation_hooks: [{ hook_id: 'departure-impact', enabled: true }],
      ai_capabilities: [{ capability: 'ownership-review', mode: 'suggest_only' }],
    });
    employeeId = employee.body.node.node_id;
    expect(employee.body.node.source_data[0].source_system).toBe('manual');
    expect(employee.body.node.simulation_hooks[0].hook_id).toBe('departure-impact');
    expect(employee.body.node.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'node.created' }),
    ]));

    const application = await createNode('application', {
      type_id: 'Application',
      label: 'Order Orchestrator',
      properties: { tier: 'critical', lifecycle: 'production' },
      owner_id: employeeId,
      metadata: { classification: 'internal' },
      confidence_score: 0.95,
    });
    applicationId = application.body.node.node_id;
    applicationEtag = application.headers.etag as string;

    const process = await createNode('process', {
      type_id: 'Process',
      label: 'Order-to-Cash',
      properties: { business_criticality: 'high' },
      metadata: { classification: 'internal' },
    });
    processId = process.body.node.node_id;

    const customer = await createNode('customer', {
      type_id: 'Customer',
      label: 'Northstar Manufacturing',
      properties: { account_tier: 'strategic' },
      metadata: { classification: 'internal' },
    });
    customerId = customer.body.node.node_id;

    const createRelationship = async (suffix: string, body: Record<string, unknown>) => request(app.getHttpServer())
      .post('/v1/twin/relationships')
      .set(admin)
      .set('idempotency-key', key(`relationship-${suffix}`))
      .send(body)
      .expect(201);

    await createRelationship('owner', {
      type_id: 'OWNS', source_node_id: employeeId, target_node_id: applicationId,
      strength: 1, confidence: 1, importance: 0.9, risk: 0.8, cost: 100_000,
      metadata: { classification: 'internal' },
    });
    await createRelationship('dependency', {
      type_id: 'DEPENDS_ON', source_node_id: processId, target_node_id: applicationId,
      strength: 0.95, confidence: 0.9, importance: 1, risk: 0.8, cost: 500_000,
      metadata: { classification: 'internal' },
    });
    await createRelationship('customer-impact', {
      type_id: 'SERVES', source_node_id: processId, target_node_id: customerId,
      strength: 0.9, confidence: 0.95, importance: 0.9, risk: 0.7, cost: 1_000_000,
      metadata: { classification: 'internal' },
    });

    const dependencies = await request(app.getHttpServer())
      .get(`/v1/twin/nodes/${processId}/dependencies?max_depth=4`)
      .set(analyst)
      .expect(200);
    expect(dependencies.body.prerequisites).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_id: applicationId, depth: 1 }),
    ]));

    const impact = await request(app.getHttpServer())
      .post('/v1/twin/impact-analysis')
      .set(analyst)
      .send({ node_id: applicationId, change: { kind: 'availability_loss' }, max_depth: 4 })
      .expect(200);
    expect(impact.body.direct_impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_id: processId, score: expect.any(Number) }),
    ]));
    expect(impact.body.downstream_impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_id: customerId, depth: 2, score: expect.any(Number) }),
    ]));
    expect(impact.body.method.note).toContain('not causal proof');

    const traversal = await request(app.getHttpServer())
      .post('/v1/twin/traversals')
      .set(analyst)
      .send({ start_node_id: applicationId, direction: 'both', max_depth: 2, max_nodes: 20 })
      .expect(200);
    expect(traversal.body.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_id: employeeId }),
      expect.objectContaining({ node_id: processId }),
    ]));

    const critical = await request(app.getHttpServer()).get('/v1/twin/critical-nodes').set(analyst).expect(200);
    expect(critical.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_id: applicationId, criticality_score: expect.any(Number) }),
    ]));

    await request(app.getHttpServer())
      .post('/v1/twin/relationships')
      .set(admin)
      .set('idempotency-key', key('dependency-cycle'))
      .send({ type_id: 'DEPENDS_ON', source_node_id: applicationId, target_node_id: processId, metadata: { classification: 'internal' } })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('relationship_cycle'));
  });

  it('enforces optimistic concurrency, history, secret rejection, and tenant-safe reads', async () => {
    const updated = await request(app.getHttpServer())
      .patch(`/v1/twin/nodes/${applicationId}`)
      .set(admin)
      .set('if-match', applicationEtag)
      .set('idempotency-key', key('application-update'))
      .send({ properties: { tier: 'critical', lifecycle: 'production', maintenance_window: '2026-08-01' } })
      .expect(200);
    expect(updated.body.node.version).toBe(2);
    expect(updated.body.etag).not.toBe(applicationEtag);

    await request(app.getHttpServer())
      .patch(`/v1/twin/nodes/${applicationId}`)
      .set(admin)
      .set('if-match', applicationEtag)
      .set('idempotency-key', key('application-stale'))
      .send({ label: 'Stale attempt' })
      .expect(412)
      .expect(({ body }) => expect(body.code).toBe('graph_precondition_failed'));

    const detail = await request(app.getHttpServer()).get(`/v1/twin/nodes/${applicationId}`).set(analyst).expect(200);
    expect(detail.body.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'node.created' }),
      expect.objectContaining({ event_type: 'node.updated' }),
    ]));

    await request(app.getHttpServer())
      .post('/v1/twin/nodes')
      .set(admin)
      .set('idempotency-key', key('secret-rejection'))
      .send({ type_id: 'Application', label: 'Unsafe', properties: { api_key: 'do-not-store-this' } })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('secret_property_rejected'));

    await request(app.getHttpServer()).get(`/v1/twin/nodes/${applicationId}`).set(beacon).expect(404);
    await request(app.getHttpServer()).get(`/v1/twin/nodes/${applicationId}`).set(limited).expect(404);
    const limitedList = await request(app.getHttpServer()).get('/v1/twin/nodes').set(limited).expect(200);
    expect(limitedList.body.items).toHaveLength(0);

    const archived = await request(app.getHttpServer())
      .delete(`/v1/twin/nodes/${employeeId}`)
      .set(admin)
      .set('if-match', (await request(app.getHttpServer()).get(`/v1/twin/nodes/${employeeId}`).set(admin).expect(200)).headers.etag as string)
      .set('idempotency-key', key('archive-owner'))
      .expect(200);
    expect(archived.body.node.state).toBe('archived');
    expect(archived.body.archived_relationship_count).toBe(1);
  });
});
