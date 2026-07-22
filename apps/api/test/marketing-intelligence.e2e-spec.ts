import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { demoAuthHeaders } from './demo-auth.helpers';

const admin = demoAuthHeaders('usr_aster_admin');
const beacon = demoAuthHeaders('usr_beacon_analyst');
const key = (value: string) => `marketing-${value}`.padEnd(32, '0');

describe('Marketing intelligence graph integration (e2e)', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.EDT_DEMO_AUTH = 'true';
    delete process.env.DATABASE_URL;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init(); await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => { await app.close(); });

  it('registers marketing in the existing graph catalog and traverses campaign value paths', async () => {
    const types = await request(app.getHttpServer()).get('/v1/twin/node-types').set(admin).expect(200);
    expect(types.body.items.map((item: { type_id: string }) => item.type_id)).toEqual(expect.arrayContaining([
      'edt.core/MarketingDepartment', 'edt.core/Campaign', 'edt.core/CustomerSegment', 'edt.core/Lead', 'edt.core/MarketingChannel', 'edt.core/MarketTrend',
    ]));
    const relationships = await request(app.getHttpServer()).get('/v1/twin/relationship-types').set(admin).expect(200);
    expect(relationships.body.items.map((item: { type_id: string }) => item.type_id)).toEqual(expect.arrayContaining(['edt.core/TARGETS', 'edt.core/GENERATES', 'edt.core/IMPACTS_REVENUE']));

    const campaign = await request(app.getHttpServer()).post('/v1/twin/nodes').set(admin).set('idempotency-key', key('campaign')).send({ type_id: 'edt.core/Campaign', label: 'Enterprise launch campaign' }).expect(201);
    const segment = await request(app.getHttpServer()).post('/v1/twin/nodes').set(admin).set('idempotency-key', key('segment')).send({ type_id: 'edt.core/CustomerSegment', label: 'Enterprise buyers' }).expect(201);
    await request(app.getHttpServer()).post('/v1/twin/relationships').set(admin).set('idempotency-key', key('targets')).send({ type_id: 'edt.core/TARGETS', source_node_id: campaign.body.node.node_id, target_node_id: segment.body.node.node_id, strength: .8, confidence: .9, importance: .8, risk: .1, cost: 0 }).expect(201);
    await request(app.getHttpServer()).post('/v1/twin/traversals').set(admin).send({ start_node_id: campaign.body.node.node_id, direction: 'outbound', relationship_types: ['edt.core/TARGETS'], max_depth: 2, max_nodes: 20 }).expect(200).expect(({ body }) => expect(body.nodes).toHaveLength(2));
    await request(app.getHttpServer()).post('/v1/twin/events').set(admin).set('idempotency-key', key('funnel-event')).send({
      type_id: 'MarketingFunnelTransition', occurred_at: '2026-07-22T12:00:00Z',
      source: { source_system: 'crm', source_record_id: 'cohort-42', observed_at: '2026-07-22T12:00:00Z' },
      affected_node_ids: [campaign.body.node.node_id, segment.body.node.node_id], classification: 'confidential',
      details: { campaign_id: campaign.body.node.node_id, segment_id: segment.body.node.node_id, from_stage: 'interest', to_stage: 'lead', cohort_count: 20 },
    }).expect(201).expect(({ body }) => expect(body.event.type_id).toBe('edt.event/MarketingFunnelTransition'));
    await request(app.getHttpServer()).post('/v1/twin/events').set(admin).set('idempotency-key', key('bad-funnel-event')).send({
      type_id: 'MarketingFunnelTransition', occurred_at: '2026-07-22T12:00:00Z',
      source: { source_system: 'crm', source_record_id: 'person-42', observed_at: '2026-07-22T12:00:00Z' },
      affected_node_ids: [campaign.body.node.node_id], details: { campaign_id: campaign.body.node.node_id, segment_id: segment.body.node.node_id, from_stage: 'awareness', to_stage: 'qualified_lead', cohort_count: 1 },
    }).expect(400).expect(({ body }) => expect(body.code).toBe('invalid_funnel_transition'));
    await request(app.getHttpServer()).post('/v1/twin/events').set(admin).set('idempotency-key', key('unverified-funnel-node')).send({
      type_id: 'MarketingFunnelTransition', occurred_at: '2026-07-22T12:00:00Z',
      source: { source_system: 'crm', source_record_id: 'cohort-43', observed_at: '2026-07-22T12:00:00Z' },
      affected_node_ids: [campaign.body.node.node_id], details: { campaign_id: campaign.body.node.node_id, segment_id: segment.body.node.node_id, from_stage: 'interest', to_stage: 'lead', cohort_count: 1 },
    }).expect(400).expect(({ body }) => expect(body.code).toBe('invalid_funnel_nodes'));
    await request(app.getHttpServer()).post('/v1/twin/events').set(admin).set('idempotency-key', key('wrong-funnel-types')).send({
      type_id: 'MarketingFunnelTransition', occurred_at: '2026-07-22T12:00:00Z',
      source: { source_system: 'crm', source_record_id: 'cohort-44', observed_at: '2026-07-22T12:00:00Z' },
      affected_node_ids: [campaign.body.node.node_id, segment.body.node.node_id], details: { campaign_id: segment.body.node.node_id, segment_id: campaign.body.node.node_id, from_stage: 'interest', to_stage: 'lead', cohort_count: 1 },
    }).expect(400).expect(({ body }) => expect(body.code).toBe('invalid_funnel_node_types'));
    await request(app.getHttpServer()).get(`/v1/twin/nodes/${campaign.body.node.node_id}`).set(beacon).expect(404);
  });

  it('rejects individual identifiers and sensitive traits from aggregate conversion prediction', async () => {
    const model = await request(app.getHttpServer()).post('/v1/twin/prediction/models').set(admin)
      .set('idempotency-key', key('conversion-model')).send({
        name: 'Aggregate conversion baseline', kind: 'forecasting', prediction_kind: 'marketing_conversion', algorithm: 'bounded_linear_trend',
        inputs: [{ name: 'segment_funnel_counts', type: 'number' }], outputs: [{ name: 'aggregate_conversion_rate', type: 'series' }],
        model_version: '1.0.0', trigger: { type: 'manual' }, status: 'active',
      }).expect(201);
    const observations: Array<{ observed_at: string; value: number; features: Record<string, number> }> = [1, 2, 3].map((month) => ({
      observed_at: `2026-0${month}-01T00:00:00Z`, value: month / 10, features: { inferred_religion_score: month },
    }));
    await request(app.getHttpServer()).post('/v1/twin/prediction/runs').set(admin)
      .set('idempotency-key', key('sensitive-conversion')).send({
        model_id: model.body.model.model_id, target: 'aggregate_conversion_rate', horizon_steps: 1, observations,
      }).expect(400).expect(({ body }) => expect(body.code).toBe('marketing_sensitive_feature_prohibited'));
    observations[0].features = { hashed_customer_id: 42 };
    observations[1].features = {};
    observations[2].features = {};
    await request(app.getHttpServer()).post('/v1/twin/prediction/runs').set(admin)
      .set('idempotency-key', key('identified-conversion')).send({
        model_id: model.body.model.model_id, target: 'aggregate_conversion_rate', horizon_steps: 1, observations,
      }).expect(400).expect(({ body }) => expect(body.code).toBe('marketing_sensitive_feature_prohibited'));
  });
});
