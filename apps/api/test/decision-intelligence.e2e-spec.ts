import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { demoAuthHeaders } from './demo-auth.helpers';

const admin = demoAuthHeaders('usr_aster_admin');
const limited = demoAuthHeaders('usr_aster_limited');
const beacon = demoAuthHeaders('usr_beacon_analyst');
const key = (suffix: string): string => `decision-${suffix}`.padEnd(32, '0');

describe('Simulation and predictive intelligence foundation (e2e)', () => {
  let app: NestFastifyApplication;
  let companyId = '';
  let revenueId = '';
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeAll(async () => {
    process.env.EDT_DEMO_AUTH = 'true';
    process.env.EDT_FROZEN_CLOCK = 'true';
    delete process.env.DATABASE_URL;
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v1/decision-simulations') {
        return new Response(JSON.stringify({
          schema_version: 'edt.decision-intelligence/1.0.0',
          engine_version: 'decision-simulation/1.0.0',
          result_sha256: 'a'.repeat(64),
          effects: [{ source_node_id: companyId, target_node_id: revenueId, variable: 'price', delta: 0.5, depth: 1 }],
          comparison: [{ node_id: companyId, variable: 'revenue', baseline: 1000, scenario: 1100, absolute_delta: 100, percent_delta: 10 }],
          assumptions: [], warnings: ['Conditional scenario output.'],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (path === '/v1/predictions/validate') {
        return new Response(JSON.stringify({
          mean_absolute_error: 1, mean_absolute_percentage_error: 0.01,
          root_mean_squared_error: 1, mean_bias: 1, accuracy_score: 0.99,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (path === '/v1/predictions') {
        return new Response(JSON.stringify({
          schema_version: 'edt.decision-intelligence/1.0.0', engine_version: 'predictive-baselines/1.0.0',
          result_sha256: 'b'.repeat(64), validation_status: 'pending_outcome',
          forecast: [{ step: 1, value: 140, lower: 135, upper: 145 }, { step: 2, value: 150, lower: 143, upper: 157 }],
          confidence: { score: 0.82, sample_size: 4, fit_r_squared: 0.99, residual_standard_error: 1, basis: ['history'] },
          feature_summary: { observation_count: 4 }, limitations: ['Not causal.'],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const company = await request(app.getHttpServer()).post('/v1/twin/nodes').set(admin)
      .set('idempotency-key', key('company-node')).send({ type_id: 'edt.core/Company', label: 'Aster aggregate' }).expect(201);
    const revenue = await request(app.getHttpServer()).post('/v1/twin/nodes').set(admin)
      .set('idempotency-key', key('revenue-node')).send({ type_id: 'edt.core/RevenueStream', label: 'Subscription revenue' }).expect(201);
    companyId = company.body.node.node_id;
    revenueId = revenue.body.node.node_id;
    await request(app.getHttpServer()).post('/v1/twin/relationships').set(admin)
      .set('idempotency-key', key('serves-edge')).send({
        type_id: 'edt.core/SERVES', source_node_id: companyId, target_node_id: revenueId,
        strength: 0.5, confidence: 1, importance: 1, risk: 0, cost: 0,
      }).expect(201);
  });

  afterAll(async () => {
    fetchMock.mockRestore();
    await app.close();
    delete process.env.EDT_FROZEN_CLOCK;
  });

  it('seals a graph snapshot, confirms a typed branch, runs it, and compares immutable outcomes', async () => {
    await request(app.getHttpServer()).post('/v1/twin/simulation/snapshots').set(limited)
      .set('idempotency-key', key('snapshot-denied')).send({ nodes: [{ node_id: companyId, variables: { price: 10 } }] }).expect(403);

    const snapshot = await request(app.getHttpServer()).post('/v1/twin/simulation/snapshots').set(admin)
      .set('idempotency-key', key('snapshot')).send({
        as_of: '2026-07-13T15:00:00Z',
        nodes: [
          { node_id: companyId, variables: { price: 10, units: 100, revenue: 1000 } },
          { node_id: revenueId, variables: { price: 5, units: 10, revenue: 50 } },
        ],
        assumptions: ['Prices use one consistent currency.'],
      }).expect(201);
    expect(snapshot.body.snapshot.canonical_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.body.snapshot.relationships).toHaveLength(1);
    await request(app.getHttpServer()).get(`/v1/twin/simulation/snapshots/${snapshot.body.snapshot.snapshot_id}`)
      .set(admin).expect(200).expect(({ body }) => expect(body.snapshot.graph_version).toBe(snapshot.body.snapshot.graph_version));

    const scenario = await request(app.getHttpServer()).post('/v1/twin/simulation/scenarios').set(admin)
      .set('idempotency-key', key('scenario')).send({
        snapshot_id: snapshot.body.snapshot.snapshot_id, kind: 'pricing_change', name: 'Price increase',
        changes: [{ node_id: companyId, variable: 'price', operation: 'add', value: 1 }],
        assumptions: ['Unit demand is held constant in this branch.'], max_depth: 4,
      }).expect(201);
    expect(scenario.body.branch.status).toBe('draft');

    const confirmed = await request(app.getHttpServer())
      .post(`/v1/twin/simulation/scenarios/${scenario.body.branch.scenario_id}/branches/${scenario.body.branch.branch_id}/confirm`)
      .set(admin).set('idempotency-key', key('confirm')).set('if-match', scenario.headers.etag)
      .send({ scenario_digest: scenario.body.branch.scenario_digest }).expect(201);
    expect(confirmed.body.branch.status).toBe('confirmed');

    const run = await request(app.getHttpServer()).post('/v1/twin/simulation/runs').set(admin)
      .set('idempotency-key', key('sim-run')).send({ branch_id: confirmed.body.branch.branch_id })
      .expect(({ status, body }) => { if (status !== 201) throw new Error(JSON.stringify(body)); }).expect(201);
    expect(run.body.run.result_sha256).toBe('a'.repeat(64));
    expect(run.body.run.result.comparison[0].absolute_delta).toBe(100);

    const alternate = await request(app.getHttpServer())
      .post(`/v1/twin/simulation/scenarios/${scenario.body.branch.scenario_id}/branches`).set(admin)
      .set('idempotency-key', key('branch')).send({
        parent_branch_id: confirmed.body.branch.branch_id, name: 'Larger increase',
        changes: [{ node_id: companyId, variable: 'price', operation: 'add', value: 2 }],
      }).expect(({ status, body }) => { if (status !== 201) throw new Error(JSON.stringify(body)); }).expect(201);
    expect(alternate.body.branch.parent_branch_id).toBe(confirmed.body.branch.branch_id);
    await request(app.getHttpServer()).get(`/v1/twin/simulation/scenarios/${scenario.body.branch.scenario_id}/branches`)
      .set(admin).expect(200).expect(({ body }) => expect(body.items).toHaveLength(2));

    const alternateConfirmed = await request(app.getHttpServer())
      .post(`/v1/twin/simulation/scenarios/${scenario.body.branch.scenario_id}/branches/${alternate.body.branch.branch_id}/confirm`)
      .set(admin).set('idempotency-key', key('branch-confirm')).set('if-match', alternate.headers.etag)
      .send({ scenario_digest: alternate.body.branch.scenario_digest }).expect(201);
    const alternateRun = await request(app.getHttpServer()).post('/v1/twin/simulation/runs').set(admin)
      .set('idempotency-key', key('alternate-run')).send({ branch_id: alternateConfirmed.body.branch.branch_id }).expect(201);

    await request(app.getHttpServer()).post('/v1/twin/simulation/comparisons').set(admin)
      .send({ simulation_ids: [run.body.run.simulation_id, alternateRun.body.run.simulation_id] }).expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(2));
  });

  it('registers a non-LLM model and completes prediction, outcome, validation, and learning', async () => {
    const model = await request(app.getHttpServer()).post('/v1/twin/prediction/models').set(admin)
      .set('idempotency-key', key('model')).send({
        name: 'Revenue trend baseline', kind: 'forecasting', prediction_kind: 'revenue', algorithm: 'linear_trend',
        inputs: [{ name: 'monthly_revenue', type: 'number' }], outputs: [{ name: 'forecast', type: 'series' }],
        model_version: '1.0.0', owner_id: null, trigger: { type: 'manual' }, status: 'active',
      }).expect(201);
    expect(model.body.model.accuracy.validation_count).toBe(0);
    expect(model.body.model.inputs).toHaveLength(1);

    const prediction = await request(app.getHttpServer()).post('/v1/twin/prediction/runs').set(admin)
      .set('idempotency-key', key('prediction')).send({
        model_id: model.body.model.model_id, target: 'monthly_revenue', horizon_steps: 2,
        observations: [
          { observed_at: '2026-01-01T00:00:00Z', value: 100 },
          { observed_at: '2026-02-01T00:00:00Z', value: 110 },
          { observed_at: '2026-03-01T00:00:00Z', value: 120 },
          { observed_at: '2026-04-01T00:00:00Z', value: 130 },
        ],
      }).expect(({ status, body }) => { if (status !== 201) throw new Error(JSON.stringify(body)); }).expect(201);
    expect(prediction.body.prediction.historical_observation_count).toBe(4);
    expect(prediction.body.prediction.historical_feature_batch_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(prediction.body.prediction.status).toBe('pending_outcome');

    const outcome = await request(app.getHttpServer())
      .post(`/v1/twin/prediction/runs/${prediction.body.prediction.prediction_id}/outcomes`).set(admin)
      .set('idempotency-key', key('outcome')).set('if-match', prediction.headers.etag)
      .send({ actual_values: [141, 151], observed_at: '2026-07-13T15:30:00Z', source: { system: 'finance_ledger', revision: '42' } })
      .expect(201);
    expect(outcome.body.prediction.status).toBe('outcome_recorded');
    await request(app.getHttpServer())
      .post(`/v1/twin/prediction/runs/${prediction.body.prediction.prediction_id}/outcomes`).set(admin)
      .set('idempotency-key', key('outcome')).set('if-match', prediction.headers.etag)
      .send({ actual_values: [141, 151], observed_at: '2026-07-13T15:30:00Z', source: { system: 'finance_ledger', revision: '42' } })
      .expect(201).expect(({ body }) => expect(body.replayed).toBe(true));

    const validation = await request(app.getHttpServer())
      .post(`/v1/twin/prediction/runs/${prediction.body.prediction.prediction_id}/validations`).set(admin)
      .set('idempotency-key', key('validation')).set('if-match', outcome.headers.etag)
      .send({ decision: 'confirmed', expert_notes: 'Ledger close confirmed.' }).expect(201);
    expect(validation.body.prediction.status).toBe('validated');
    expect(validation.body.model.accuracy.validation_count).toBe(1);
    expect(validation.body.model.accuracy.score).toBe(0.99);
    expect(validation.body.model.learning_revision).toBe(1);
    expect(validation.body.model.calibration_bias).toBe(0.2);
    await request(app.getHttpServer())
      .post(`/v1/twin/prediction/runs/${prediction.body.prediction.prediction_id}/validations`).set(admin)
      .set('idempotency-key', key('validation')).set('if-match', outcome.headers.etag)
      .send({ decision: 'confirmed', expert_notes: 'Ledger close confirmed.' }).expect(201)
      .expect(({ body }) => {
        expect(body.replayed).toBe(true);
        expect(body.model.learning_revision).toBe(1);
      });

    await request(app.getHttpServer()).post('/v1/twin/prediction/knowledge').set(admin)
      .set('idempotency-key', key('knowledge')).send({
        category: 'technical_specification', model_id: model.body.model.model_id,
        prediction_id: prediction.body.prediction.prediction_id, title: 'Ledger definition',
        content: { metric: 'monthly_revenue', accounting_basis: 'accrual' },
        source: { system: 'finance_policy', revision: '7' },
      }).expect(201).expect(({ body }) => expect(body.knowledge.status).toBe('pending_review'));

    await request(app.getHttpServer()).get(`/v1/twin/prediction/runs/${prediction.body.prediction.prediction_id}`).set(beacon).expect(404);
  });

  it('rejects individual workforce prediction targets before worker execution', async () => {
    const model = await request(app.getHttpServer()).post('/v1/twin/prediction/models').set(admin)
      .set('idempotency-key', key('workforce-model')).send({
        name: 'Aggregate workforce baseline', kind: 'forecasting', prediction_kind: 'workforce', algorithm: 'linear_trend',
        inputs: [{ name: 'headcount', type: 'number' }], outputs: [{ name: 'forecast', type: 'series' }],
        model_version: '1.0.0', trigger: { type: 'manual' }, status: 'active',
      }).expect(201);
    await request(app.getHttpServer()).post('/v1/twin/prediction/runs').set(admin)
      .set('idempotency-key', key('forbidden-workforce')).send({
        model_id: model.body.model.model_id, target: 'attrition', horizon_steps: 1,
        observations: [
          { observed_at: '2026-01-01T00:00:00Z', value: 10 },
          { observed_at: '2026-02-01T00:00:00Z', value: 11 },
          { observed_at: '2026-03-01T00:00:00Z', value: 12 },
        ],
      }).expect(400).expect(({ body }) => expect(body.code).toBe('workforce_prediction_prohibited'));
  });
});
