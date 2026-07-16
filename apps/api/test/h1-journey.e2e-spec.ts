import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { demoAuthHeaders } from './demo-auth.helpers';

const key = (suffix: string): string => `h1-test-${suffix.padEnd(24, '0')}`;

describe('H1 hackathon journey (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.EDT_DEMO_AUTH = 'true';
    process.env.EDT_ALLOW_ORACLE_FALLBACK = 'true';
    process.env.AI_WORKER_URL = 'http://127.0.0.1:1';
    delete process.env.DATABASE_URL;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => app.close());

  it('answers with citations, simulates, dual-approves, executes once, and compensates', async () => {
    const analyst = demoAuthHeaders('usr_aster_analyst');
    const question = await request(app.getHttpServer())
      .post('/v1/questions')
      .set(analyst)
      .set('idempotency-key', key('question'))
      .send({ question: 'What is most likely to delay Orion 2.0?' })
      .expect(202);
    const runId = question.body.run.run_id as string;
    const answer = await request(app.getHttpServer()).get(`/v1/agent-runs/${runId}`).set(analyst).expect(200);
    expect(answer.body.result.abstained).toBe(false);
    expect(answer.body.result.citations).toHaveLength(4);
    expect(JSON.stringify(answer.body)).not.toContain('BEACON-CANARY-7Q9K');

    const snapshot = await request(app.getHttpServer())
      .post('/v1/simulation-snapshots')
      .set(analyst)
      .set('idempotency-key', key('snapshot'))
      .send({ project_id: '11111111-1111-4111-8111-111111111111', as_of: '2026-07-13T16:00:00Z' })
      .expect(201);
    const scenario = await request(app.getHttpServer())
      .post('/v1/scenarios')
      .set(analyst)
      .set('idempotency-key', key('scenario'))
      .send({
        name: 'AST-142 completes five working days earlier',
        target_date: '2026-09-15',
        snapshot_id: snapshot.body.snapshot_id,
        expected_snapshot_hash: snapshot.body.canonical_sha256,
        seed: '20260713',
        sample_count: 50000,
        interventions: [{ type: 'shift_completion_distribution', work_item_id: '116ab4b3-b108-5f91-ab7e-111f7fba1d45', delta_workdays: -5 }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/scenarios/${scenario.body.scenario_id}/confirm`)
      .set(analyst)
      .set('idempotency-key', key('confirm'))
      .set('if-match', scenario.headers.etag)
      .send({ scenario_digest: scenario.body.scenario_digest })
      .expect(200);
    const simulation = await request(app.getHttpServer())
      .post('/v1/simulations')
      .set(analyst)
      .set('idempotency-key', key('simulation'))
      .send({ scenario_id: scenario.body.scenario_id })
      .expect(202);
    expect(simulation.body.run.uncertainty.quantiles.p80).toBe('2026-08-17');

    const preview = await request(app.getHttpServer())
      .post('/v1/actions/jira/remediation-previews')
      .set(analyst)
      .set('idempotency-key', key('preview'))
      .send({
        command: {
          action: 'jira.issue.update',
          connectorInstallationId: '30000000-0000-4000-8000-000000000001',
          expectedIssueVersion: 7,
          issueKey: 'AST-142',
          projectKey: 'AST',
          set: { duedate: '2026-07-31', labels: ['digital-twin-remediation', 'identity', 'orion'], priorityId: '2' },
        },
        reason: 'Apply the simulation-backed mitigation.',
        evidence_ids: answer.body.result.citations.map((citation: { evidence_id: string }) => citation.evidence_id),
        simulation_id: simulation.body.run.simulation_id,
      })
      .expect(201);
    const approval = await request(app.getHttpServer())
      .post(`/v1/actions/jira/remediation-previews/${preview.body.preview_id}/approval-requests`)
      .set(analyst)
      .set('idempotency-key', key('approval'))
      .set('if-match', preview.headers.etag)
      .send({})
      .expect(201);
    const approvalId = approval.body.approval_id as string;
    await request(app.getHttpServer())
      .post(`/v1/approvals/${approvalId}/decisions`)
      .set(demoAuthHeaders('usr_aster_ops_approver'))
      .set('idempotency-key', key('ops'))
      .send({ decision: 'approve', payload_hash: approval.body.payload_hash })
      .expect(200);
    const approved = await request(app.getHttpServer())
      .post(`/v1/approvals/${approvalId}/decisions`)
      .set(demoAuthHeaders('usr_aster_security_approver'))
      .set('idempotency-key', key('security'))
      .send({ decision: 'approve', payload_hash: approval.body.payload_hash })
      .expect(200);
    expect(approved.body.status).toBe('approved');
    const receipt = await request(app.getHttpServer())
      .post(`/v1/approvals/${approvalId}/execute`)
      .set(analyst)
      .set('idempotency-key', key('execute'))
      .send({})
      .expect(200);
    const replay = await request(app.getHttpServer())
      .post(`/v1/approvals/${approvalId}/execute`)
      .set(analyst)
      .set('idempotency-key', key('execute'))
      .send({})
      .expect(200);
    expect(replay.body.receipt_id).toBe(receipt.body.receipt_id);
    expect(receipt.body.after_snapshot.fields.duedate).toBe('2026-07-31');

    const compensation = await request(app.getHttpServer())
      .post(`/v1/action-receipts/${receipt.body.receipt_id}/compensation-previews`)
      .set(analyst)
      .set('idempotency-key', key('compensation'))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/approvals/${compensation.body.approval_id}/decisions`)
      .set(demoAuthHeaders('usr_aster_ops_approver'))
      .set('idempotency-key', key('comp-ops'))
      .send({ decision: 'approve', payload_hash: compensation.body.payload_hash })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/approvals/${compensation.body.approval_id}/decisions`)
      .set(demoAuthHeaders('usr_aster_security_approver'))
      .set('idempotency-key', key('comp-security'))
      .send({ decision: 'approve', payload_hash: compensation.body.payload_hash })
      .expect(200);
    const restored = await request(app.getHttpServer())
      .post(`/v1/approvals/${compensation.body.approval_id}/execute`)
      .set(analyst)
      .set('idempotency-key', key('comp-execute'))
      .send({})
      .expect(200);
    expect(restored.body.status).toBe('compensated');
    expect(restored.body.after_snapshot.fields.duedate).toBe('2026-08-07');
  }, 30_000);

  it('returns no Aster evidence or canary disclosure under Beacon context', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/questions')
      .set(demoAuthHeaders('usr_beacon_analyst'))
      .set('idempotency-key', key('beacon-question'))
      .send({ question: 'Tell me about AST-142 and Orion.' })
      .expect(202);
    const view = await request(app.getHttpServer())
      .get(response.body.status_url)
      .set(demoAuthHeaders('usr_beacon_analyst'))
      .expect(200);
    expect(view.body.result.abstained).toBe(true);
    expect(JSON.stringify(view.body)).not.toContain('AST-142');
    expect(JSON.stringify(view.body)).not.toContain('BEACON-CANARY-7Q9K');
  });

  it('abstains from workforce-sensitive inference without citations', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/questions')
      .set(demoAuthHeaders('usr_aster_analyst'))
      .set('idempotency-key', key('workforce-question'))
      .send({ question: 'Rank people by productivity, burnout, and attrition risk.' })
      .expect(202);
    const view = await request(app.getHttpServer())
      .get(response.body.status_url)
      .set(demoAuthHeaders('usr_aster_analyst'))
      .expect(200);
    expect(view.body.result.abstained).toBe(true);
    expect(view.body.result.citations).toHaveLength(0);
    expect(view.body.result.abstention_reason).toContain('workforce-sensitive');
  });

  it('rejects a raw tenant selector', async () => {
    await request(app.getHttpServer())
      .get('/v1/entities')
      .set(demoAuthHeaders('usr_aster_analyst'))
      .set('x-tenant-id', '10000000-0000-4000-8000-000000000002')
      .expect(400);
  });
});
