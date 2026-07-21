import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { demoAuthHeaders } from './demo-auth.helpers';

const admin = demoAuthHeaders('usr_aster_admin');
const analyst = demoAuthHeaders('usr_aster_analyst');
const beacon = demoAuthHeaders('usr_beacon_analyst');
const key = (suffix: string): string => `phase-two-${suffix}`.padEnd(32, '0');
const observedAt = '2026-07-13T15:55:00.000Z';

describe('Phase 2 data and integration foundation (e2e)', () => {
  let app: NestFastifyApplication;
  let applicationId = '';
  let processId = '';
  let connectorId = '';

  beforeAll(async () => {
    process.env.EDT_DEMO_AUTH = 'true';
    process.env.EDT_FROZEN_CLOCK = 'true';
    delete process.env.DATABASE_URL;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const application = await request(app.getHttpServer())
      .post('/v1/twin/nodes').set(admin).set('idempotency-key', key('application'))
      .send({ type_id: 'Application', label: 'Customer Platform', metadata: { classification: 'internal' } }).expect(201);
    applicationId = application.body.node.node_id;
    const processNode = await request(app.getHttpServer())
      .post('/v1/twin/nodes').set(admin).set('idempotency-key', key('process'))
      .send({ type_id: 'Process', label: 'Customer Onboarding', metadata: { classification: 'internal' } }).expect(201);
    processId = processNode.body.node.node_id;
    await request(app.getHttpServer())
      .post('/v1/twin/relationships').set(admin).set('idempotency-key', key('dependency'))
      .send({
        type_id: 'DEPENDS_ON', source_node_id: processId, target_node_id: applicationId,
        strength: 0.9, confidence: 0.95, importance: 1, risk: 0.8,
        metadata: { classification: 'internal' },
      }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.EDT_FROZEN_CLOCK;
  });

  it('publishes the four governed data planes and protects the catalog', async () => {
    const result = await request(app.getHttpServer()).get('/v1/twin/data-architecture').set(admin).expect(200);
    expect(result.body.schema_version).toBe('edt.data-foundation/1.0.0');
    expect(result.body.data_planes).toEqual(expect.arrayContaining([
      expect.objectContaining({ plane_id: 'application_data', storage_kind: 'relational', authority: 'authoritative' }),
      expect.objectContaining({ plane_id: 'graph_data', storage_kind: 'graph', authority: 'derived' }),
      expect.objectContaining({ plane_id: 'ai_knowledge', storage_kind: 'vector', authority: 'specialized' }),
      expect.objectContaining({ plane_id: 'historical_metrics', storage_kind: 'historical', authority: 'specialized' }),
    ]));
    await request(app.getHttpServer()).get('/v1/twin/data-architecture').set(analyst).expect(403);
  });

  it.each([
    ['EmployeeChange', 'employee_change'],
    ['SystemFailure', 'system_failure'],
    ['CustomerChange', 'customer_change'],
    ['FinancialChange', 'financial_change'],
    ['MarketChange', 'market_change'],
    ['OperationalChange', 'operational_change'],
  ])('records and propagates %s events', async (typeName, category) => {
    const created = await request(app.getHttpServer())
      .post('/v1/twin/events').set(admin).set('idempotency-key', key(`event-${category}`))
      .send({
        type_id: typeName,
        occurred_at: observedAt,
        source: {
          source_system: 'phase-two-fixture', source_record_id: `${category}-001`, source_revision: '1',
          observed_at: observedAt, locator: `urn:edt:fixture:${category}:001`,
        },
        affected_node_ids: [applicationId],
        severity: category === 'system_failure' ? 'critical' : 'medium',
        outcome: 'observed',
        classification: 'internal',
        details: { summary: `${category} fixture` },
        reliability_score: 0.9,
        confidence_score: 0.95,
        propagation: { max_depth: 4, max_impacts: 20 },
      }).expect(201);
    expect(created.body.event).toEqual(expect.objectContaining({
      type_id: `edt.event/${typeName}`,
      category,
      affected_node_ids: [applicationId],
      source: expect.objectContaining({ source_system: 'phase-two-fixture' }),
      confidence_score: expect.any(Number),
      data_quality: expect.objectContaining({ duplicate_of: null, stale: false }),
    }));
    expect(created.body.event.propagation.impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_id: processId, depth: 1 }),
    ]));
  });

  it('detects duplicate, conflicting, and stale data while retaining provenance', async () => {
    const point = (suffix: string, value: unknown, sourceId: string, time = observedAt) => request(app.getHttpServer())
      .post('/v1/twin/data-points').set(admin).set('idempotency-key', key(`point-${suffix}`))
      .send({
        subject_node_id: applicationId,
        metric: 'availability.percent',
        value,
        source: {
          source_system: 'monitoring', source_record_id: sourceId, source_revision: '1',
          observed_at: time, locator: `urn:monitoring:${sourceId}`,
        },
        owner_id: applicationId,
        classification: 'internal',
        confidence_score: 0.9,
        reliability_score: 0.95,
        freshness_ttl_seconds: 600,
      });

    const original = await point('original', 99.9, 'availability-001').expect(201);
    expect(original.body.data_point).toEqual(expect.objectContaining({
      owner_id: applicationId, last_updated_at: expect.any(String), reliability_score: 0.95,
      source: expect.objectContaining({ source_system: 'monitoring', source_record_id: 'availability-001' }),
    }));
    const duplicate = await point('duplicate', 99.9, 'availability-001').expect(201);
    expect(duplicate.body.data_point.data_quality.duplicate_of).toBe(original.body.data_point.data_point_id);
    const conflict = await point('conflict', 72.5, 'availability-002').expect(201);
    expect(conflict.body.data_point.data_quality.conflicts_with).toEqual(expect.arrayContaining([
      original.body.data_point.data_point_id, duplicate.body.data_point.data_point_id,
    ]));
    expect(conflict.body.data_point.confidence_score).toBeLessThan(0.9);
    const stale = await point('stale', 60, 'availability-old', '2026-07-01T00:00:00.000Z').expect(201);
    expect(stale.body.data_point.data_quality).toEqual(expect.objectContaining({ stale: true, stale_now: true }));

    const listed = await request(app.getHttpServer()).get('/v1/twin/data-points?metric=availability.percent').set(analyst).expect(200);
    expect(listed.body.items.length).toBeGreaterThanOrEqual(4);
    await request(app.getHttpServer()).get(`/v1/twin/data-points/${original.body.data_point.data_point_id}`).set(beacon).expect(404);
    await request(app.getHttpServer())
      .post('/v1/twin/data-points').set(analyst).set('idempotency-key', key('point-unauthorized'))
      .send({ metric: 'availability.percent', value: 100, source: { source_system: 'monitoring', source_record_id: 'denied' } })
      .expect(403);
  });

  it('registers a governed connector with replay and optimistic concurrency', async () => {
    const definition = {
      name: 'Northstar CRM', kind: 'crm', purpose: 'Synchronize allowlisted customer account metadata.',
      authentication: { kind: 'oauth2', secret_reference: 'vault://tenants/aster/connectors/northstar-crm', scopes: ['crm.accounts.read'] },
      schema: { source_schema_ref: 'urn:edt:schema:northstar-crm-source', normalized_schema_ref: 'urn:edt:schema:customer-observation', version: '1.0.0' },
      mapping: { version: '1.0.0', rules: [{ source_path: '$.account.name', target_path: '$.customer.name', transform: 'string.trim' }] },
      permissions: { read: ['customers.read'], write: [], allowed_classifications: ['internal'] },
      sync: { mode: 'interval', frequency_seconds: 3600 },
      error_handling: { mode: 'retry_with_backoff', max_attempts: 5, initial_backoff_seconds: 5, max_backoff_seconds: 300 },
      reliability_score: 0.92, classification: 'internal', status: 'active',
    };
    const created = await request(app.getHttpServer())
      .post('/v1/twin/connectors').set(admin).set('idempotency-key', key('connector-create'))
      .send(definition).expect(201);
    connectorId = created.body.connector.connector_id;
    expect(created.body.connector).toEqual(expect.objectContaining({ kind: 'crm', execution_state: 'registry_only', credential_material_stored: false }));
    const replay = await request(app.getHttpServer())
      .post('/v1/twin/connectors').set(admin).set('idempotency-key', key('connector-create'))
      .send(definition).expect(201);
    expect(replay.body.replayed).toBe(true);
    await request(app.getHttpServer())
      .patch(`/v1/twin/connectors/${connectorId}`).set(admin).set('if-match', '"sha256:stale"')
      .set('idempotency-key', key('connector-stale')).send({ status: 'suspended' }).expect(412);
    const updated = await request(app.getHttpServer())
      .patch(`/v1/twin/connectors/${connectorId}`).set(admin).set('if-match', created.body.etag)
      .set('idempotency-key', key('connector-update')).send({ status: 'suspended' }).expect(200);
    expect(updated.body.connector.status).toBe('suspended');
    const listed = await request(app.getHttpServer()).get('/v1/twin/connectors?kind=crm&status=suspended').set(admin).expect(200);
    expect(listed.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ connector_id: connectorId })]));
    await request(app.getHttpServer()).get('/v1/twin/connectors').set(analyst).expect(403);
  });

  it('registers MCP authentication, tools, permissions, and connected data', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/twin/mcp-servers').set(admin).set('idempotency-key', key('mcp-create'))
      .send({
        name: 'Customer Context MCP', purpose: 'Provide read-only customer context to approved agents.',
        authentication: { kind: 'service_token', secret_reference: 'vault://tenants/aster/mcp/customer-context', scopes: ['mcp.read'] },
        tools: [{ tool_id: 'customer.lookup', purpose: 'Read an allowlisted customer record.', permissions: ['mcp.read'], side_effects: false }],
        permissions: ['mcp.read'],
        connected_data: [{ data_plane: 'application_data', resource_kind: 'customer', connector_id: connectorId }],
        classification: 'internal', status: 'active',
      }).expect(201);
    expect(created.body.mcp_server).toEqual(expect.objectContaining({
      tools: [expect.objectContaining({ tool_id: 'customer.lookup', side_effects: false })],
      permissions: ['mcp.read'],
      connected_data: [expect.objectContaining({ connector_id: connectorId })],
      execution_state: 'registry_only', transport_endpoint_stored: false,
    }));

    await request(app.getHttpServer())
      .post('/v1/twin/mcp-servers').set(admin).set('idempotency-key', key('mcp-prohibited'))
      .send({
        name: 'Unsafe MCP', purpose: 'Negative policy fixture.',
        authentication: { kind: 'none', secret_reference: null, scopes: [] },
        tools: [{ tool_id: 'database.sql-query', purpose: 'Unsafe arbitrary query.', permissions: ['mcp.read'], side_effects: false }],
        permissions: ['mcp.read'], connected_data: [{ data_plane: 'application_data', resource_kind: 'customer' }],
      }).expect(400).expect(({ body }) => expect(body.code).toBe('mcp_tool_prohibited'));
  });
});
