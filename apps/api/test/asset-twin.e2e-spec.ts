import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { ASTER_PUMP_ASSET_ID, BEACON_PUMP_ASSET_ID } from '../src/asset-twin.service';

const aster = { 'x-demo-actor': 'usr_aster_analyst' };
const beacon = { 'x-demo-actor': 'usr_beacon_analyst' };
const key = (suffix: string): string => `asset-test-${suffix.padEnd(28, '0')}`;

describe('Synthetic physical-asset digital twin (e2e)', () => {
  let app: NestFastifyApplication;

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

  it('lists exactly one tenant-scoped asset and hides cross-tenant identifiers', async () => {
    const asterList = await request(app.getHttpServer()).get('/v1/assets').set(aster).expect(200);
    expect(asterList.headers['cache-control']).toBe('private, no-store');
    expect(asterList.body.items).toHaveLength(1);
    expect(asterList.body.items[0].asset_id).toBe(ASTER_PUMP_ASSET_ID);
    expect(asterList.body.items[0].display_name).toBe('Cooling Water Pump P-101');
    expect(asterList.body.items[0].can_control).toBe(true);
    expect(JSON.stringify(asterList.body)).not.toContain('Process Water Pump B-07');

    const beaconList = await request(app.getHttpServer()).get('/v1/assets').set(beacon).expect(200);
    expect(beaconList.body.items).toHaveLength(1);
    expect(beaconList.body.items[0].asset_id).toBe(BEACON_PUMP_ASSET_ID);
    expect(beaconList.body.items[0].can_control).toBe(false);
    expect(JSON.stringify(beaconList.body)).not.toContain('P-101');

    await request(app.getHttpServer()).get(`/v1/assets/${ASTER_PUMP_ASSET_ID}/twin`).set(beacon).expect(404);
    await request(app.getHttpServer()).get(`/v1/assets/${BEACON_PUMP_ASSET_ID}/twin`).set(aster).expect(404);
  });

  it('returns telemetry, transparent model-backed analytics, and complete lifecycle evidence', async () => {
    const response = await request(app.getHttpServer()).get(`/v1/assets/${ASTER_PUMP_ASSET_ID}/twin`).set(aster).expect(200);
    expect(response.body.asset.synthetic).toBe(true);
    expect(response.body.asset.can_control).toBe(true);
    expect(response.body.visualization.kind).toBe('procedural_3d');
    expect(response.body.components).toHaveLength(7);
    expect(response.body.current_telemetry.readings).toHaveLength(6);
    expect(response.body.telemetry_history).toHaveLength(37);

    const analytics = response.body.analytics;
    expect(analytics.model_card.anomaly_detection.algorithm).toBe('multivariate_ewma_z_score');
    expect(analytics.model_card.prediction.algorithm).toBe('ordinary_least_squares_trend_to_threshold');
    expect(analytics.model_card.evaluated_on).toBe('deterministic_synthetic_fixture_only');
    expect(analytics.anomalies[0].contributions.length).toBeGreaterThanOrEqual(3);
    expect(analytics.predictions[0].predicted_failure_mode).toBe('drive_end_bearing_degradation');
    expect(analytics.predictions[0].horizon_days).toBeGreaterThan(0);
    expect(analytics.predictions[0].confidence.basis).toContain('R²=');
    expect(analytics.predictions[0].recommended_maintenance).toContain('bearing');
    expect(analytics.predictions[0].caveat).toContain('Synthetic demonstration only');

    expect(response.body.lifecycle.current_stage).toBe('operation');
    expect(response.body.lifecycle.stages.map((stage: { stage: string }) => stage.stage)).toEqual([
      'design', 'manufacture', 'commissioning', 'operation', 'service', 'decommissioning',
    ]);
    expect(response.body.lifecycle.events.length).toBeGreaterThanOrEqual(6);
    expect(response.body.lifecycle.maintenance.some((item: { status: string }) => item.status === 'recommended')).toBe(true);
    expect(response.body.control.available_commands.map((item: { type: string }) => item.type)).toEqual([
      'set_speed_pct', 'set_valve_pct', 'emergency_stop', 'reset',
    ]);
    expect(response.body.control.simulation_only).toBe(true);

    const beaconTwin = await request(app.getHttpServer()).get(`/v1/assets/${BEACON_PUMP_ASSET_ID}/twin`).set(beacon).expect(200);
    expect(beaconTwin.body.asset.can_control).toBe(false);
    expect(beaconTwin.body.components).toHaveLength(7);
    expect(beaconTwin.body.components.every((component: { status: string }) => component.status === 'healthy')).toBe(true);
    expect(beaconTwin.body.analytics.predictions[0].predicted_failure_mode).toBe('no_failure_mode_indicated');
  });

  it('advances deterministic real-time telemetry without crossing tenant boundaries', async () => {
    const before = await request(app.getHttpServer()).get(`/v1/assets/${ASTER_PUMP_ASSET_ID}/twin`).set(aster).expect(200);
    const sequence = before.body.current_telemetry.sequence as number;
    const advanced = await request(app.getHttpServer())
      .get(`/v1/assets/${ASTER_PUMP_ASSET_ID}/telemetry?limit=2`)
      .set(aster)
      .expect(200);
    expect(advanced.body.stream_status).toBe('live_simulation');
    expect(advanced.body.synthetic).toBe(true);
    expect(advanced.body.samples).toHaveLength(2);
    expect(advanced.body.samples[0].sequence).toBe(sequence);
    expect(advanced.body.current_telemetry.sequence).toBe(sequence + 1);
    expect(advanced.body.samples[0].observed_at).not.toBe(advanced.body.samples[1].observed_at);
    await request(app.getHttpServer()).get(`/v1/assets/${ASTER_PUMP_ASSET_ID}/telemetry?limit=0`).set(aster).expect(400);
    await request(app.getHttpServer()).get(`/v1/assets/${ASTER_PUMP_ASSET_ID}/telemetry`).set(beacon).expect(404);
  });

  it('rejects unsafe, stale, malformed, and unauthorized control previews', async () => {
    await request(app.getHttpServer())
      .post(`/v1/assets/${ASTER_PUMP_ASSET_ID}/commands/preview`)
      .set(aster)
      .set('idempotency-key', key('unsafe-speed'))
      .send({ command: { type: 'set_speed_pct', value: 101 }, expected_version: 12, reason: 'Unsafe speed test.' })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('unsafe_control_value'));

    await request(app.getHttpServer())
      .post(`/v1/assets/${ASTER_PUMP_ASSET_ID}/commands/preview`)
      .set(aster)
      .set('idempotency-key', key('stale-version'))
      .send({ command: { type: 'set_speed_pct', value: 75 }, expected_version: 11, reason: 'Stale version test.' })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('asset_version_changed'));

    await request(app.getHttpServer())
      .post(`/v1/assets/${ASTER_PUMP_ASSET_ID}/commands/preview`)
      .set(aster)
      .set('idempotency-key', key('unknown-field'))
      .send({ command: { type: 'set_speed_pct', value: 75, override: true }, expected_version: 12, reason: 'Reject extra field.' })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('unknown_request_field'));

    await request(app.getHttpServer())
      .post(`/v1/assets/${BEACON_PUMP_ASSET_ID}/commands/preview`)
      .set(beacon)
      .set('idempotency-key', key('beacon-control'))
      .send({ command: { type: 'set_speed_pct', value: 75 }, expected_version: 3, reason: 'Beacon has read-only access.' })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('asset_control_denied'));
  });

  it('previews exact state, executes only the simulation, detects concurrency, and replays idempotently', async () => {
    const body = { command: { type: 'set_speed_pct', value: 76 }, expected_version: 12, reason: 'Reduce load during bearing inspection.' };
    const preview = await request(app.getHttpServer())
      .post(`/v1/assets/${ASTER_PUMP_ASSET_ID}/commands/preview`)
      .set(aster)
      .set('idempotency-key', key('speed-preview'))
      .send(body)
      .expect(201);
    expect(preview.body.before_state.version).toBe(12);
    expect(preview.body.after_state.version).toBe(13);
    expect(preview.body.after_state.speed_pct).toBe(76);
    expect(preview.body.execution_mode).toBe('simulation');
    expect(preview.body.external_write).toBe(false);
    expect(preview.body.safety.checks.some((check: { check: string }) => check.check === 'simulation_boundary')).toBe(true);
    expect(preview.body.audit_evidence.event_hash).toMatch(/^[0-9a-f]{64}$/);

    const previewReplay = await request(app.getHttpServer())
      .post(`/v1/assets/${ASTER_PUMP_ASSET_ID}/commands/preview`)
      .set(aster)
      .set('idempotency-key', key('speed-preview'))
      .send(body)
      .expect(201);
    expect(previewReplay.body.preview_id).toBe(preview.body.preview_id);

    const concurrent = await request(app.getHttpServer())
      .post(`/v1/assets/${ASTER_PUMP_ASSET_ID}/control-previews`)
      .set(aster)
      .set('idempotency-key', key('concurrent-preview'))
      .send({ command: { type: 'set_valve_pct', value: 64 }, expected_version: 12, reason: 'Concurrent preview for conflict test.' })
      .expect(201);

    const receipt = await request(app.getHttpServer())
      .post(`/v1/assets/${ASTER_PUMP_ASSET_ID}/commands/execute`)
      .set(aster)
      .set('idempotency-key', key('speed-execute'))
      .set('if-match', preview.headers.etag)
      .send({ preview_id: preview.body.preview_id })
      .expect(200);
    expect(receipt.body.status).toBe('succeeded');
    expect(receipt.body.simulation).toBe(true);
    expect(receipt.body.external_write).toBe(false);
    expect(receipt.body.provider).toBe('synthetic_asset_simulator');
    expect(receipt.body.after_state.version).toBe(13);
    expect(receipt.body.audit_evidence.previous_hash).toBe(preview.body.audit_evidence.event_hash === concurrent.body.audit_evidence.event_hash
      ? preview.body.audit_evidence.event_hash
      : concurrent.body.audit_evidence.event_hash);

    const replay = await request(app.getHttpServer())
      .post(`/v1/assets/${ASTER_PUMP_ASSET_ID}/commands/execute`)
      .set(aster)
      .set('idempotency-key', key('speed-execute'))
      .set('if-match', preview.headers.etag)
      .send({ preview_id: preview.body.preview_id })
      .expect(200);
    expect(replay.body.receipt_id).toBe(receipt.body.receipt_id);

    await request(app.getHttpServer())
      .post(`/v1/assets/${ASTER_PUMP_ASSET_ID}/control-previews/${concurrent.body.preview_id}/execute`)
      .set(aster)
      .set('idempotency-key', key('concurrent-execute'))
      .set('if-match', concurrent.headers.etag)
      .send({})
      .expect(409)
      .expect(({ body: responseBody }) => expect(responseBody.code).toBe('asset_version_changed'));

    const twin = await request(app.getHttpServer()).get(`/v1/assets/${ASTER_PUMP_ASSET_ID}/twin`).set(aster).expect(200);
    expect(twin.body.control.state.speed_pct).toBe(76);
    expect(twin.body.control.state.version).toBe(13);
  });

  it('supports valve adjustment and a safe emergency-stop/reset sequence', async () => {
    let version = 13;
    const execute = async (suffix: string, command: Record<string, unknown>) => {
      const preview = await request(app.getHttpServer())
        .post(`/v1/assets/${ASTER_PUMP_ASSET_ID}/commands/preview`)
        .set(aster)
        .set('idempotency-key', key(`${suffix}-preview`))
        .send({ command, expected_version: version, reason: `Exercise the ${suffix} simulated control safely.` })
        .expect(201);
      const receipt = await request(app.getHttpServer())
        .post(`/v1/assets/${ASTER_PUMP_ASSET_ID}/commands/execute`)
        .set(aster)
        .set('idempotency-key', key(`${suffix}-execute`))
        .set('if-match', preview.headers.etag)
        .send({ preview_id: preview.body.preview_id })
        .expect(200);
      version += 1;
      return receipt.body;
    };

    const valve = await execute('valve', { type: 'set_valve_pct', value: 62 });
    expect(valve.after_state.valve_pct).toBe(62);

    const stopped = await execute('emergency-stop', { type: 'emergency_stop' });
    expect(stopped.after_state.emergency_stopped).toBe(true);
    expect(stopped.after_state.speed_pct).toBe(0);

    await request(app.getHttpServer())
      .post(`/v1/assets/${ASTER_PUMP_ASSET_ID}/commands/preview`)
      .set(aster)
      .set('idempotency-key', key('latched-speed'))
      .send({ command: { type: 'set_speed_pct', value: 70 }, expected_version: version, reason: 'Must fail while emergency stop is latched.' })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('emergency_stop_latched'));

    const reset = await execute('reset', { type: 'reset' });
    expect(reset.after_state.emergency_stopped).toBe(false);
    expect(reset.after_state.operating_mode).toBe('stopped');
    expect(reset.after_state.speed_pct).toBe(0);
    expect(reset.after_state.version).toBe(16);
  });
});
