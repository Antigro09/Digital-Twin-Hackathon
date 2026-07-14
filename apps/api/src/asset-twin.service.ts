import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import {
  AssetAnomaly,
  AssetAuditEvidence,
  AssetComponent,
  AssetControlCommand,
  AssetControlPreview,
  AssetControlReceipt,
  AssetControlState,
  AssetLocation,
  AssetPrediction,
  AssetTelemetryMetric,
  AssetTwinSnapshot,
  LifecycleEvent,
  LifecycleStage,
  MaintenanceItem,
  PhysicalAsset,
  TelemetryFrame,
  TelemetryReading,
  TelemetryThresholds,
} from './asset-twin.types';
import { DatabaseService } from './database.service';
import {
  ASTER_TENANT_ID,
  BEACON_TENANT_ID,
  RequestContext,
  addSeconds,
  etag,
  newId,
  nowIso,
  sha256,
  stableUuid,
  traceId,
} from './domain';
import { ProblemException } from './problem';

export const ASTER_PUMP_ASSET_ID = stableUuid('asset:tnt_aster:pump-p-101');
export const BEACON_PUMP_ASSET_ID = stableUuid('asset:tnt_beacon:pump-b-07');

const ANALYTICS_MODEL_VERSION = 'asset-analytics-ewma-ols/1.0.0';
const TELEMETRY_INTERVAL_SECONDS = 5;
const MAX_HISTORY_FRAMES = 120;

interface AssetRuntime {
  tenantId: string;
  profile: 'degrading' | 'healthy';
  base: Omit<PhysicalAsset, 'operational_status' | 'health_score' | 'current_alerts' | 'last_telemetry_at'>;
  components: AssetComponent[];
  history: TelemetryFrame[];
  historyPhase: number;
  lastTelemetryWallClockMs: number;
  control: AssetControlState;
  lifecycle: {
    stages: LifecycleStage[];
    events: LifecycleEvent[];
    maintenance: MaintenanceItem[];
  };
}

interface IdempotencyRecord {
  requestHash: string;
  resourceId: string;
}

interface RegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
}

@Injectable()
export class AssetTwinService implements OnModuleInit {
  private readonly assets = new Map<string, AssetRuntime>();
  private readonly previews = new Map<string, AssetControlPreview>();
  private readonly receipts = new Map<string, AssetControlReceipt>();
  private readonly previewIdempotency = new Map<string, IdempotencyRecord>();
  private readonly executionIdempotency = new Map<string, IdempotencyRecord>();
  private readonly auditByTenant = new Map<string, AssetAuditEvidence[]>();

  constructor(private readonly database: DatabaseService) {}

  onModuleInit(): void {
    const aster = this.createAsterPump();
    const beacon = this.createBeaconPump();
    this.assets.set(aster.base.asset_id, aster);
    this.assets.set(beacon.base.asset_id, beacon);
  }

  listAssets(ctx: RequestContext): { items: Array<PhysicalAsset & { can_control: boolean }>; next_cursor: null; has_more: false } {
    this.assertReadCapability(ctx);
    const items = [...this.assets.values()]
      .filter((asset) => asset.tenantId === ctx.tenantId)
      .map((asset) => ({ ...this.publicAsset(asset), can_control: this.canControl(ctx) }));
    return { items, next_cursor: null, has_more: false };
  }

  getTwin(ctx: RequestContext, assetId: string): AssetTwinSnapshot {
    const asset = this.assetForContext(ctx, assetId);
    const analytics = this.analytics(asset);
    const current = asset.history.at(-1);
    if (!current) throw this.notFound();
    return {
      asset: { ...this.publicAsset(asset, analytics.anomalies), can_control: this.canControl(ctx) },
      visualization: {
        kind: 'procedural_3d',
        model_url: null,
        coordinate_system: 'right_handed_y_up',
        dimensions_m: { length: 2.8, width: 1.3, height: 1.55 },
        component_anchors: asset.components.map((component) => ({ component_id: component.component_id, ...component.spatial_anchor })),
        camera: { position: [4.2, 2.6, 4.8], target: [0, 0.65, 0] },
      },
      components: structuredClone(asset.components),
      current_telemetry: structuredClone(current),
      telemetry_history: structuredClone(asset.history),
      analytics,
      lifecycle: {
        current_stage: 'operation',
        stages: structuredClone(asset.lifecycle.stages),
        events: structuredClone(asset.lifecycle.events),
        maintenance: structuredClone(asset.lifecycle.maintenance),
      },
      control: {
        state: structuredClone(asset.control),
        limits: { speed_pct: { min: 30, max: 100 }, valve_pct: { min: 5, max: 100 } },
        available_commands: [
          { type: 'set_speed_pct', value_required: true, safe_range: { min: 30, max: 100, unit: 'percent' }, description: 'Set simulated motor speed within the allowlisted operating envelope.' },
          { type: 'set_valve_pct', value_required: true, safe_range: { min: 5, max: 100, unit: 'percent' }, description: 'Set simulated discharge valve position within the anti-deadhead envelope.' },
          { type: 'emergency_stop', value_required: false, safe_range: null, description: 'Latch a simulated emergency stop and set speed to zero.' },
          { type: 'reset', value_required: false, safe_range: null, description: 'Clear a simulated emergency-stop latch without restarting the pump.' },
        ],
        simulation_only: true,
      },
      data_watermark: { telemetry_sequence: current.sequence, observed_at: current.observed_at, model_version: ANALYTICS_MODEL_VERSION },
    };
  }

  advanceTelemetry(
    ctx: RequestContext,
    assetId: string,
    limit: number,
  ): {
    asset_id: string;
    stream_status: 'live_simulation';
    samples: TelemetryFrame[];
    current_telemetry: TelemetryFrame;
    control_state: AssetControlState;
    health: { score: number; status: 'healthy' | 'watch' | 'warning' | 'critical' };
    synthetic: true;
  } {
    const asset = this.assetForContext(ctx, assetId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 120) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_telemetry_limit', 'limit must be an integer between 1 and 120.');
    }
    const prior = asset.history.at(-1);
    if (!prior) throw this.notFound();

    // Polling observes the simulator clock; it does not accelerate it. In the
    // frozen-clock test profile, one deterministic tick is produced per read.
    const wallClockNow = Date.now();
    const elapsedSteps = Math.floor((wallClockNow - asset.lastTelemetryWallClockMs) / (TELEMETRY_INTERVAL_SECONDS * 1000));
    const steps = process.env.EDT_FROZEN_CLOCK === 'true' ? 1 : Math.min(12, Math.max(0, elapsedSteps));
    for (let step = 0; step < steps; step += 1) {
      const current = asset.history.at(-1);
      if (!current) throw this.notFound();
      asset.historyPhase += TELEMETRY_INTERVAL_SECONDS / (6 * 60 * 60);
      const observedAt = addSeconds(current.observed_at, TELEMETRY_INTERVAL_SECONDS);
      asset.history.push(this.telemetryFrame(asset, current.sequence + 1, observedAt, asset.historyPhase, asset.control));
    }
    if (steps > 0) {
      asset.lastTelemetryWallClockMs = wallClockNow;
      if (asset.history.length > MAX_HISTORY_FRAMES) asset.history.splice(0, asset.history.length - MAX_HISTORY_FRAMES);
    }
    const samples = asset.history.slice(-limit);
    const analytics = this.analytics(asset);
    const current = asset.history.at(-1);
    if (!current) throw this.notFound();
    const healthScore = this.healthScore(current, analytics.anomalies);
    return {
      asset_id: assetId,
      stream_status: 'live_simulation',
      samples: structuredClone(samples),
      current_telemetry: structuredClone(current),
      control_state: structuredClone(asset.control),
      health: { score: healthScore, status: this.healthStatus(healthScore) },
      synthetic: true,
    };
  }

  async previewControl(
    ctx: RequestContext,
    assetId: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<AssetControlPreview & { etag: string }> {
    const asset = this.assetForContext(ctx, assetId);
    this.assertControlCapability(ctx, 'asset.control.preview');
    this.assertExactKeys(body, ['command', 'expected_version', 'reason'], 'control preview');
    const idempotencyScope = `${ctx.tenantId}:${ctx.actor.actor_id}:${assetId}:preview:${idempotencyKey}`;
    const requestHash = sha256(body);
    const replay = this.previewIdempotency.get(idempotencyScope);
    if (replay) {
      if (replay.requestHash !== requestHash) this.idempotencyConflict();
      const prior = this.previews.get(replay.resourceId);
      if (!prior) throw this.notFound();
      return this.publicPreview(prior);
    }

    const command = this.parseCommand(body.command);
    const expectedVersion = Number(body.expected_version);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'expected_version_required', 'expected_version must be a positive integer.');
    }
    if (asset.control.version !== expectedVersion) {
      throw new ProblemException(HttpStatus.CONFLICT, 'asset_version_changed', 'The asset control state no longer matches expected_version.');
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 8 || reason.length > 500) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'control_reason_required', 'reason must contain 8 to 500 characters.');
    }

    const createdAt = nowIso();
    const previewId = newId();
    const beforeState = structuredClone(asset.control);
    const afterState = this.applyCommand(beforeState, command, createdAt);
    const payload = {
      tenant_id: ctx.tenantId,
      asset_id: assetId,
      command,
      expected_version: expectedVersion,
      reason,
      execution_mode: 'simulation',
      external_write: false,
    };
    const payloadHash = sha256(payload);
    const safetyChecks = this.safetyChecks(command, beforeState);
    const previewHash = sha256({
      preview_id: previewId,
      requester_id: ctx.actor.actor_id,
      payload_hash: payloadHash,
      before_state: beforeState,
      after_state: afterState,
      safety_checks: safetyChecks,
      created_at: createdAt,
      expires_at: addSeconds(createdAt, 600),
    });
    const audit = await this.appendAudit(ctx, 'asset.control.preview', 'asset_control_preview', previewId, payloadHash);
    const preview: AssetControlPreview = {
      preview_id: previewId,
      tenant_id: ctx.tenantId,
      asset_id: assetId,
      requester_id: ctx.actor.actor_id,
      command,
      expected_version: expectedVersion,
      reason,
      before_state: beforeState,
      after_state: afterState,
      safety: { accepted: true, policy_version: 'asset-control-simulation/1.0.0', checks: safetyChecks },
      payload_hash: payloadHash,
      preview_hash: previewHash,
      created_at: createdAt,
      expires_at: addSeconds(createdAt, 600),
      status: 'ready',
      execution_mode: 'simulation',
      external_write: false,
      audit_evidence: audit,
    };
    this.previews.set(previewId, preview);
    this.previewIdempotency.set(idempotencyScope, { requestHash, resourceId: previewId });
    await this.database.put(ctx.tenantId, 'asset_control_preview', previewId, preview);
    return this.publicPreview(preview);
  }

  async executeControl(
    ctx: RequestContext,
    assetId: string,
    previewId: string,
    ifMatch: string | undefined,
    idempotencyKey: string,
  ): Promise<AssetControlReceipt> {
    const asset = this.assetForContext(ctx, assetId);
    this.assertControlCapability(ctx, 'asset.control.execute');
    const replayScope = `${ctx.tenantId}:${ctx.actor.actor_id}:${assetId}:execute:${idempotencyKey}`;
    const requestHash = sha256({ preview_id: previewId, if_match: ifMatch });
    const replay = this.executionIdempotency.get(replayScope);
    if (replay) {
      if (replay.requestHash !== requestHash) this.idempotencyConflict();
      const receipt = this.receipts.get(replay.resourceId);
      if (!receipt) throw this.notFound();
      return structuredClone(receipt);
    }

    const preview = this.previews.get(previewId);
    if (!preview || preview.tenant_id !== ctx.tenantId || preview.asset_id !== assetId) throw this.notFound();
    if (preview.requester_id !== ctx.actor.actor_id) throw this.notFound();
    if (!ifMatch) {
      throw new ProblemException(HttpStatus.PRECONDITION_REQUIRED, 'if_match_required', 'If-Match is required for exact-preview execution.');
    }
    if (ifMatch !== etag(preview.preview_hash)) {
      throw new ProblemException(HttpStatus.PRECONDITION_FAILED, 'control_preview_changed', 'The control preview ETag does not match.');
    }
    if (preview.status !== 'ready') {
      throw new ProblemException(HttpStatus.CONFLICT, 'control_preview_not_ready', 'The control preview has already been consumed.');
    }
    if (this.isExpired(preview.expires_at)) {
      throw new ProblemException(HttpStatus.GONE, 'control_preview_expired', 'The control preview expired.');
    }
    if (asset.control.version !== preview.expected_version || sha256(asset.control) !== sha256(preview.before_state)) {
      throw new ProblemException(HttpStatus.CONFLICT, 'asset_version_changed', 'The asset control state changed after preview.');
    }

    const beforeState = structuredClone(asset.control);
    asset.control = structuredClone(preview.after_state);
    preview.status = 'executed';
    const receiptId = newId();
    const audit = await this.appendAudit(ctx, 'asset.control.execute_simulation', 'asset_control_receipt', receiptId, preview.payload_hash);
    const receipt: AssetControlReceipt = {
      receipt_id: receiptId,
      tenant_id: ctx.tenantId,
      asset_id: assetId,
      preview_id: previewId,
      requester_id: ctx.actor.actor_id,
      command: structuredClone(preview.command),
      before_state: beforeState,
      after_state: structuredClone(asset.control),
      payload_hash: preview.payload_hash,
      idempotency_key: idempotencyKey,
      provider: 'synthetic_asset_simulator',
      provider_request_id: `simulated-control-${newId()}`,
      status: 'succeeded',
      simulation: true,
      external_write: false,
      recorded_at: nowIso(),
      audit_evidence: audit,
    };
    this.receipts.set(receiptId, receipt);
    this.executionIdempotency.set(replayScope, { requestHash, resourceId: receiptId });
    await this.database.put(ctx.tenantId, 'asset_control_receipt', receiptId, receipt);
    await this.database.put(ctx.tenantId, 'physical_asset', assetId, { control: asset.control, last_receipt_id: receiptId });
    await this.database.put(ctx.tenantId, 'asset_control_preview', previewId, preview);
    return structuredClone(receipt);
  }

  private assetForContext(ctx: RequestContext, assetId: string): AssetRuntime {
    const asset = this.assets.get(assetId);
    if (!asset || asset.tenantId !== ctx.tenantId) throw this.notFound();
    this.assertReadCapability(ctx);
    return asset;
  }

  private assertReadCapability(ctx: RequestContext): void {
    if (!ctx.actor.capabilities.includes('asset.read')) {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'asset_read_denied', 'Physical-asset access is not authorized.');
    }
  }

  private canControl(ctx: RequestContext): boolean {
    return ctx.actor.capabilities.includes('asset.control.preview') && ctx.actor.capabilities.includes('asset.control.execute');
  }

  private assertControlCapability(ctx: RequestContext, capability: 'asset.control.preview' | 'asset.control.execute'): void {
    if (!ctx.actor.capabilities.includes(capability)) {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'asset_control_denied', 'Simulated asset control is not authorized.');
    }
  }

  private parseCommand(value: unknown): AssetControlCommand {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'control_command_required', 'command must be an object.');
    }
    const record = value as Record<string, unknown>;
    const type = record.type;
    if (!['set_speed_pct', 'set_valve_pct', 'emergency_stop', 'reset'].includes(String(type))) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'unsupported_control_command', 'The control command is not allowlisted.');
    }
    if (type === 'set_speed_pct' || type === 'set_valve_pct') {
      this.assertExactKeys(record, ['type', 'value'], 'control command');
      const numericValue = Number(record.value);
      if (!Number.isFinite(numericValue)) {
        throw new ProblemException(HttpStatus.BAD_REQUEST, 'control_value_required', 'This command requires a finite numeric value.');
      }
      const [minimum, maximum] = type === 'set_speed_pct' ? [30, 100] : [5, 100];
      if (numericValue < minimum || numericValue > maximum) {
        throw new ProblemException(HttpStatus.BAD_REQUEST, 'unsafe_control_value', `${type} must be between ${minimum} and ${maximum} percent.`);
      }
      return { type, value: this.round(numericValue, 2) };
    }
    this.assertExactKeys(record, ['type'], 'control command');
    if (record.value !== undefined) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'unexpected_control_value', `${String(type)} does not accept a value.`);
    }
    return { type: type as 'emergency_stop' | 'reset' };
  }

  private applyCommand(before: AssetControlState, command: AssetControlCommand, updatedAt: string): AssetControlState {
    const after = structuredClone(before);
    if (command.type === 'emergency_stop') {
      after.speed_pct = 0;
      after.speed_rpm = 0;
      after.emergency_stopped = true;
      after.operating_mode = 'emergency_stopped';
    } else if (command.type === 'reset') {
      if (!before.emergency_stopped) {
        throw new ProblemException(HttpStatus.CONFLICT, 'reset_not_permitted', 'Reset is only valid while the emergency-stop latch is active.');
      }
      after.speed_pct = 0;
      after.speed_rpm = 0;
      after.emergency_stopped = false;
      after.operating_mode = 'stopped';
    } else {
      if (before.emergency_stopped) {
        throw new ProblemException(HttpStatus.CONFLICT, 'emergency_stop_latched', 'Clear the emergency-stop latch before changing an actuator setpoint.');
      }
      if (command.type === 'set_speed_pct') {
        after.speed_pct = command.value as number;
        after.speed_rpm = this.round((command.value as number) * 36, 0);
        after.operating_mode = 'manual';
      } else {
        after.valve_pct = command.value as number;
        after.operating_mode = 'manual';
      }
    }
    after.version += 1;
    after.updated_at = updatedAt;
    return after;
  }

  private safetyChecks(command: AssetControlCommand, before: AssetControlState): Array<{ check: string; passed: true; detail: string }> {
    const checks: Array<{ check: string; passed: true; detail: string }> = [
      { check: 'simulation_boundary', passed: true, detail: 'The provider is an in-process synthetic simulator; no PLC, SCADA, or physical actuator is connected.' },
      { check: 'expected_version', passed: true, detail: `Control state version ${before.version} matches the requested version.` },
      { check: 'command_allowlist', passed: true, detail: `${command.type} is an allowlisted demonstration command.` },
    ];
    if (command.value !== undefined) {
      checks.push({ check: 'safe_range', passed: true, detail: `${command.value}% is inside the command-specific safety envelope.` });
    }
    return checks;
  }

  private publicPreview(preview: AssetControlPreview): AssetControlPreview & { etag: string } {
    return { ...structuredClone(preview), etag: etag(preview.preview_hash) };
  }

  private publicAsset(asset: AssetRuntime, suppliedAnomalies?: AssetAnomaly[]): PhysicalAsset {
    const current = asset.history.at(-1);
    if (!current) throw this.notFound();
    const anomalies = suppliedAnomalies ?? this.analytics(asset).anomalies;
    const healthScore = this.healthScore(current, anomalies);
    return {
      ...asset.base,
      operational_status: asset.control.emergency_stopped ? 'emergency_stopped' : asset.control.speed_pct === 0 ? 'stopped' : 'running',
      health_score: healthScore,
      current_alerts: anomalies.filter((anomaly) => anomaly.severity === 'warning' || anomaly.severity === 'critical').length
        + current.readings.filter((reading) => reading.status !== 'normal').length,
      last_telemetry_at: current.observed_at,
    };
  }

  private analytics(asset: AssetRuntime): AssetTwinSnapshot['analytics'] {
    const contributions = this.analyticsContributions(asset.history);
    const squared = contributions.reduce((total, item) => total + item.z_score ** 2, 0);
    const anomalyScore = this.round(Math.min(10, Math.sqrt(squared / Math.max(contributions.length, 1))), 2);
    const severity: AssetAnomaly['severity'] = anomalyScore >= 6 ? 'critical' : anomalyScore >= 3.5 ? 'warning' : anomalyScore >= 2 ? 'watch' : 'none';
    const detectedAt = asset.history.at(-1)?.observed_at ?? nowIso();
    const anomaly: AssetAnomaly = {
      anomaly_id: stableUuid(`asset-anomaly:${asset.base.asset_id}:${detectedAt}`),
      detected_at: detectedAt,
      severity,
      anomaly_score: anomalyScore,
      model_version: ANALYTICS_MODEL_VERSION,
      method: 'multivariate_ewma_z_score',
      summary: severity === 'none'
        ? 'No statistically material multivariate deviation is present in the synthetic window.'
        : `The synthetic telemetry window shows a ${severity} multivariate shift led by ${contributions[0]?.signal ?? 'the monitored signals'}.`,
      contributions,
    };
    const prediction = this.failurePrediction(asset.base.asset_id, asset.history, contributions);
    return {
      anomalies: [anomaly],
      predictions: [prediction],
      model_card: {
        model_version: ANALYTICS_MODEL_VERSION,
        anomaly_detection: { algorithm: 'multivariate_ewma_z_score', ewma_alpha: 0.35, baseline_samples: 12, warning_z_score: 3.5, critical_z_score: 6 },
        prediction: { algorithm: 'ordinary_least_squares_trend_to_threshold', target_signal: 'vibration_mm_s', failure_threshold: 7.1 },
        evaluated_on: 'deterministic_synthetic_fixture_only',
        intended_use: 'Explain an interactive digital-twin demonstration and exercise maintenance workflow controls.',
        limitations: [
          'The telemetry, labels, and failure threshold are synthetic and do not establish real-world predictive validity.',
          'The linear trend assumes the observed synthetic regime continues and does not model interventions or changing load.',
          'A qualified reliability engineer must validate sensors, thresholds, and maintenance decisions for any real asset.',
        ],
      },
    };
  }

  private analyticsContributions(history: TelemetryFrame[]) {
    const signals: AssetTelemetryMetric[] = ['vibration_mm_s', 'temperature_c', 'motor_current_a', 'discharge_pressure_bar'];
    const raw = signals.map((signal) => {
      const values = history.map((frame) => this.reading(frame, signal).value);
      const baseline = values.slice(0, Math.min(12, values.length));
      const baselineMean = this.mean(baseline);
      const standardDeviation = Math.max(this.standardDeviation(baseline, baselineMean), this.minimumDeviation(signal));
      let ewma = baseline[0] ?? 0;
      for (const value of values) ewma = 0.35 * value + 0.65 * ewma;
      const zScore = this.round(Math.max(-8, Math.min(8, (ewma - baselineMean) / standardDeviation)), 3);
      return {
        signal,
        current_value: values.at(-1) ?? 0,
        baseline_mean: this.round(baselineMean, 3),
        ewma_value: this.round(ewma, 3),
        z_score: zScore,
        contribution: 0,
        direction: zScore >= 0 ? 'above_baseline' as const : 'below_baseline' as const,
      };
    });
    const total = raw.reduce((sum, item) => sum + Math.abs(item.z_score), 0) || 1;
    return raw
      .map((item) => ({ ...item, contribution: this.round(Math.abs(item.z_score) / total, 3) }))
      .sort((left, right) => right.contribution - left.contribution);
  }

  private failurePrediction(assetId: string, history: TelemetryFrame[], contributions: ReturnType<AssetTwinService['analyticsContributions']>): AssetPrediction {
    const firstAt = new Date(history[0]?.observed_at ?? nowIso()).getTime();
    const x = history.map((frame) => (new Date(frame.observed_at).getTime() - firstAt) / 86_400_000);
    const y = history.map((frame) => this.reading(frame, 'vibration_mm_s').value);
    const regression = this.regression(x, y);
    const current = y.at(-1) ?? 0;
    const remaining = regression.slope > 0.001 ? (7.1 - current) / regression.slope : Number.POSITIVE_INFINITY;
    const horizonDays = remaining > 0 && remaining <= 365 ? this.round(remaining, 1) : null;
    const generatedAt = history.at(-1)?.observed_at ?? nowIso();
    const predictedAt = horizonDays === null ? null : new Date(new Date(generatedAt).getTime() + horizonDays * 86_400_000).toISOString();
    const confidenceScore = this.round(Math.max(0.05, Math.min(0.98, regression.rSquared * 0.9)), 2);
    return {
      prediction_id: stableUuid(`asset-prediction:${assetId}:${generatedAt}:${history[0]?.sequence ?? 0}`),
      generated_at: generatedAt,
      predicted_failure_mode: horizonDays === null ? 'no_failure_mode_indicated' : 'drive_end_bearing_degradation',
      target_signal: 'vibration_mm_s',
      model_version: ANALYTICS_MODEL_VERSION,
      method: 'ordinary_least_squares_trend_to_threshold',
      slope_per_day: this.round(regression.slope, 4),
      failure_threshold: 7.1,
      predicted_threshold_at: predictedAt,
      horizon_days: horizonDays,
      estimated_remaining_useful_life_days: horizonDays,
      confidence: {
        score: confidenceScore,
        basis: `Coefficient of determination R²=${this.round(regression.rSquared, 3)} over ${history.length} deterministic synthetic samples.`,
      },
      recommended_maintenance: horizonDays === null
        ? 'Continue synthetic condition monitoring; no threshold crossing occurs inside the 365-day demonstration horizon.'
        : `Inspect and lubricate the drive-end bearing within ${Math.max(1, Math.floor(horizonDays * 0.5))} days, before the modeled threshold crossing.`,
      contributions: contributions.slice(0, 3),
      caveat: 'Synthetic demonstration only: this forecast is not trained or validated on real equipment and must not control maintenance or safety decisions.',
    };
  }

  private createAsterPump(): AssetRuntime {
    const assetId = ASTER_PUMP_ASSET_ID;
    const location: AssetLocation = { site: 'Aster Riverbend Plant', area: 'Cooling Water Hall', line: 'Orion Assembly Line 2', coordinates: { x: 18.4, y: 0, z: 7.2 } };
    const control: AssetControlState = { version: 12, speed_pct: 82, speed_rpm: 2952, valve_pct: 68, emergency_stopped: false, operating_mode: 'automatic', updated_at: '2026-07-13T15:45:00Z' };
    const components = this.components(assetId, '2021-03-18', 'degrading');
    const history = this.initialHistory('degrading', assetId, control);
    return {
      tenantId: ASTER_TENANT_ID,
      profile: 'degrading',
      base: {
        asset_id: assetId,
        display_name: 'Cooling Water Pump P-101',
        asset_type: 'centrifugal_pump',
        manufacturer: 'Northstar Industrial',
        model: 'NS-CWP-400',
        serial_number: 'AST-P101-2021-0042',
        commissioned_at: '2021-04-02T14:00:00Z',
        location,
        specifications: { design_flow_m3h: 75, design_head_m: 48, rated_speed_rpm: 3600, max_operating_pressure_bar: 9 },
        synthetic: true,
      },
      components,
      history,
      historyPhase: 36,
      lastTelemetryWallClockMs: Date.now(),
      control,
      lifecycle: this.lifecycle(assetId, components, false),
    };
  }

  private createBeaconPump(): AssetRuntime {
    const assetId = BEACON_PUMP_ASSET_ID;
    const location: AssetLocation = { site: 'Beacon Harbor Works', area: 'Process Utility Bay', line: 'Water Loop B', coordinates: { x: 4.5, y: 0, z: 12.1 } };
    const control: AssetControlState = { version: 3, speed_pct: 74, speed_rpm: 2664, valve_pct: 72, emergency_stopped: false, operating_mode: 'automatic', updated_at: '2026-07-13T15:42:00Z' };
    const components = this.components(assetId, '2023-08-11', 'healthy');
    const history = this.initialHistory('healthy', assetId, control);
    return {
      tenantId: BEACON_TENANT_ID,
      profile: 'healthy',
      base: {
        asset_id: assetId,
        display_name: 'Process Water Pump B-07',
        asset_type: 'centrifugal_pump',
        manufacturer: 'Harbor Motion Systems',
        model: 'HM-Aqua-250',
        serial_number: 'BCN-B07-2023-0119',
        commissioned_at: '2023-09-01T13:00:00Z',
        location,
        specifications: { design_flow_m3h: 70.8, design_head_m: 44, rated_speed_rpm: 3600, max_operating_pressure_bar: 9 },
        synthetic: true,
      },
      components,
      history,
      historyPhase: 36,
      lastTelemetryWallClockMs: Date.now(),
      control,
      lifecycle: this.lifecycle(assetId, components, true),
    };
  }

  private initialHistory(profile: AssetRuntime['profile'], assetId: string, control: AssetControlState): TelemetryFrame[] {
    const holder = { profile, base: { asset_id: assetId } } as AssetRuntime;
    const start = new Date(nowIso()).getTime() - 36 * 6 * 60 * 60 * 1000;
    return Array.from({ length: 37 }, (_unused, index) =>
      this.telemetryFrame(holder, 1000 + index, new Date(start + index * 6 * 60 * 60 * 1000).toISOString(), index, control));
  }

  private telemetryFrame(asset: Pick<AssetRuntime, 'profile' | 'base'>, sequence: number, observedAt: string, phase: number, control: AssetControlState): TelemetryFrame {
    const healthy = asset.profile === 'healthy';
    const running = !control.emergency_stopped && control.speed_pct > 0;
    const speedRatio = running ? control.speed_pct / (healthy ? 74 : 82) : 0;
    const values: Record<AssetTelemetryMetric, number> = {
      temperature_c: running ? (healthy ? 61.2 + 0.004 * phase : 68 + 0.078 * phase) + 0.28 * Math.sin(phase * 0.55) + (speedRatio - 1) * 2.2 : 42,
      discharge_pressure_bar: running ? (healthy ? 6.15 - 0.001 * phase : 6.4 - 0.009 * phase) * speedRatio + 0.04 * Math.sin(phase * 0.43) : 0.15,
      vibration_mm_s: running ? (healthy ? 1.42 + 0.002 * phase : 2.25 + 0.032 * phase) * Math.max(0.5, speedRatio) + 0.08 * Math.sin(phase * 0.81) : 0.08,
      flow_l_min: running ? ((healthy ? 1180 - 0.1 * phase : 1250 - 1.15 * phase) * speedRatio * (control.valve_pct / (healthy ? 72 : 68))) + 6 * Math.sin(phase * 0.31) : 0,
      motor_current_a: running ? (healthy ? 34.5 + 0.006 * phase : 38 + 0.07 * phase) * speedRatio + 0.35 * Math.sin(phase * 0.67) : 0.4,
      speed_rpm: running ? control.speed_rpm + 3 * Math.sin(phase * 0.72) : 0,
    };
    const definitions: Array<[AssetTelemetryMetric, string, string, TelemetryThresholds]> = [
      ['temperature_c', 'Bearing temperature', '°C', { warning_high: 80, critical_high: 90 }],
      ['discharge_pressure_bar', 'Discharge pressure', 'bar', { warning_low: 4.5, critical_low: 3.5, warning_high: 8, critical_high: 9 }],
      ['vibration_mm_s', 'Drive-end vibration', 'mm/s RMS', { warning_high: 4.5, critical_high: 7.1 }],
      ['flow_l_min', 'Process flow', 'L/min', { warning_low: 950, critical_low: 800 }],
      ['motor_current_a', 'Motor current', 'A', { warning_high: 52, critical_high: 60 }],
      ['speed_rpm', 'Motor speed', 'rpm', { warning_high: 3400, critical_high: 3600 }],
    ];
    return {
      sequence,
      observed_at: observedAt,
      source: 'synthetic_iot_gateway',
      synthetic: true,
      readings: definitions.map(([metric, label, unit, thresholds]) => ({
        sensor_id: stableUuid(`sensor:${asset.base.asset_id}:${metric}`),
        metric,
        label,
        value: this.round(values[metric], metric === 'flow_l_min' || metric === 'speed_rpm' ? 0 : 2),
        unit,
        status: this.readingStatus(values[metric], thresholds, running),
        quality: 'good',
        thresholds,
      })),
    };
  }

  private readingStatus(value: number, thresholds: TelemetryThresholds, running: boolean): TelemetryReading['status'] {
    if (!running) return 'normal';
    if ((thresholds.critical_low !== undefined && value <= thresholds.critical_low) || (thresholds.critical_high !== undefined && value >= thresholds.critical_high)) return 'critical';
    if ((thresholds.warning_low !== undefined && value <= thresholds.warning_low) || (thresholds.warning_high !== undefined && value >= thresholds.warning_high)) return 'warning';
    return 'normal';
  }

  private components(assetId: string, installedAt: string, profile: AssetRuntime['profile']): AssetComponent[] {
    const create = (
      key: string,
      name: string,
      componentType: AssetComponent['component_type'],
      status: AssetComponent['status'],
      life: number,
      hours: number,
      sensorMetrics: AssetTelemetryMetric[],
      anchor: AssetComponent['spatial_anchor'],
    ): AssetComponent => ({
      component_id: stableUuid(`component:${assetId}:${key}`),
      name,
      component_type: componentType,
      description: this.componentDescription(componentType),
      status,
      installed_at: installedAt,
      expected_life_hours: life,
      operating_hours: hours,
      sensor_ids: sensorMetrics.map((metric) => stableUuid(`sensor:${assetId}:${metric}`)),
      spatial_anchor: anchor,
    });
    const isHealthy = profile === 'healthy';
    const operatingHours = isHealthy ? 18_240 : 31_420;
    return [
      create('motor', 'Induction motor', 'motor', 'healthy', 60_000, operatingHours, ['motor_current_a', 'speed_rpm'], { x: -0.9, y: 0.72, z: 0 }),
      create('shaft', 'Drive shaft', 'shaft', 'healthy', 70_000, operatingHours, ['speed_rpm'], { x: -0.2, y: 0.66, z: 0 }),
      create('bearing', 'Drive-end bearing', 'bearing', isHealthy ? 'healthy' : 'watch', 40_000, operatingHours, ['temperature_c', 'vibration_mm_s'], { x: 0.08, y: 0.68, z: 0 }),
      create('impeller', 'Centrifugal impeller', 'impeller', 'healthy', 50_000, operatingHours, ['discharge_pressure_bar', 'flow_l_min'], { x: 0.68, y: 0.62, z: 0 }),
      create('casing', 'Volute casing', 'casing', 'healthy', 100_000, operatingHours, ['discharge_pressure_bar'], { x: 0.72, y: 0.62, z: 0 }),
      create('seal', 'Mechanical seal', 'seal', isHealthy ? 'healthy' : 'service_due', 25_000, isHealthy ? operatingHours : 21_600, ['temperature_c'], { x: 0.32, y: 0.61, z: 0 }),
      create('valve', 'Discharge control valve', 'valve', 'healthy', 45_000, operatingHours, ['flow_l_min'], { x: 1.18, y: 0.9, z: 0 }),
    ];
  }

  private componentDescription(componentType: AssetComponent['component_type']): string {
    const descriptions: Record<AssetComponent['component_type'], string> = {
      motor: 'Variable-speed electric drive supplying shaft torque.',
      shaft: 'Aligned rotating element coupling the motor to the hydraulic assembly.',
      bearing: 'Drive-end rolling bearing monitored for heat and vibration.',
      impeller: 'Rotating hydraulic element that imparts energy to the process fluid.',
      casing: 'Pressure-containing volute that converts velocity into discharge head.',
      seal: 'Mechanical seal limiting leakage along the rotating shaft.',
      valve: 'Simulated discharge actuator regulating delivered flow.',
    };
    return descriptions[componentType];
  }

  private lifecycle(assetId: string, components: AssetComponent[], beacon: boolean): AssetRuntime['lifecycle'] {
    const prefix = beacon ? 'BCN' : 'AST';
    const stages: LifecycleStage[] = [
      { stage: 'design', status: 'completed', started_at: beacon ? '2022-11-03' : '2020-06-12', completed_at: beacon ? '2023-01-20' : '2020-09-30', evidence_ref: `${prefix}-DESIGN-PUMP-01` },
      { stage: 'manufacture', status: 'completed', started_at: beacon ? '2023-02-01' : '2020-10-12', completed_at: beacon ? '2023-06-18' : '2021-02-12', evidence_ref: `${prefix}-MFG-CERT-01` },
      { stage: 'commissioning', status: 'completed', started_at: beacon ? '2023-08-11' : '2021-03-18', completed_at: beacon ? '2023-09-01' : '2021-04-02', evidence_ref: `${prefix}-COMMISSION-01` },
      { stage: 'operation', status: 'current', started_at: beacon ? '2023-09-01' : '2021-04-02', completed_at: null, evidence_ref: `${prefix}-OPS-LEDGER-01` },
      { stage: 'service', status: 'planned', started_at: '2026-07-24', completed_at: null, evidence_ref: `${prefix}-WO-2026-117` },
      { stage: 'decommissioning', status: 'planned', started_at: beacon ? '2043-09-01' : '2041-04-02', completed_at: null, evidence_ref: `${prefix}-LIFECYCLE-PLAN-01` },
    ];
    const events: LifecycleEvent[] = [
      { event_id: stableUuid(`lifecycle:${assetId}:design`), event_type: 'design_approved', occurred_at: stages[0].completed_at as string, title: 'Hydraulic design approved', description: 'Synthetic design review approved the pump duty point and materials.', work_order_ref: null },
      { event_id: stableUuid(`lifecycle:${assetId}:manufactured`), event_type: 'manufactured', occurred_at: stages[1].completed_at as string, title: 'Factory acceptance completed', description: 'Synthetic factory test met the design head and flow envelope.', work_order_ref: null },
      { event_id: stableUuid(`lifecycle:${assetId}:installed`), event_type: 'installed', occurred_at: stages[2].completed_at as string, title: 'Asset commissioned', description: 'Alignment, rotation, and baseline vibration checks completed.', work_order_ref: `${prefix}-COMMISSION-01` },
      { event_id: stableUuid(`lifecycle:${assetId}:inspection`), event_type: 'inspection', occurred_at: '2026-06-19T14:00:00Z', title: 'Monthly condition inspection', description: beacon ? 'No actionable condition findings.' : 'Drive-end vibration remained below the operational alarm but showed a rising trend.', work_order_ref: `${prefix}-WO-2026-096` },
      { event_id: stableUuid(`lifecycle:${assetId}:maintenance`), event_type: 'maintenance', occurred_at: '2026-04-07T13:30:00Z', title: 'Preventive lubrication service', description: 'Bearing lubrication and seal inspection completed using a synthetic work order.', work_order_ref: `${prefix}-WO-2026-041` },
      { event_id: stableUuid(`lifecycle:${assetId}:decommission`), event_type: 'decommission_planned', occurred_at: '2026-01-10T12:00:00Z', title: 'Lifecycle plan reviewed', description: 'The notional decommissioning horizon was reviewed; no physical action was scheduled.', work_order_ref: null },
    ];
    const bearing = components.find((component) => component.component_type === 'bearing') as AssetComponent;
    const seal = components.find((component) => component.component_type === 'seal') as AssetComponent;
    const maintenance: MaintenanceItem[] = [
      { maintenance_id: stableUuid(`maintenance:${assetId}:completed`), kind: 'preventive', status: 'completed', title: 'Quarterly lubrication', due_at: '2026-04-07T13:30:00Z', component_id: bearing.component_id, rationale: 'Time-based synthetic maintenance plan.' },
      { maintenance_id: stableUuid(`maintenance:${assetId}:seal`), kind: 'inspection', status: 'scheduled', title: 'Mechanical seal inspection', due_at: '2026-07-24T13:00:00Z', component_id: seal.component_id, rationale: 'Scheduled service interval and operating-hour counter.' },
      { maintenance_id: stableUuid(`maintenance:${assetId}:bearing`), kind: 'condition_based', status: 'recommended', title: 'Drive-end bearing condition check', due_at: beacon ? '2026-08-21T13:00:00Z' : '2026-07-27T13:00:00Z', component_id: bearing.component_id, rationale: beacon ? 'Routine synthetic condition-monitoring review.' : 'Rising multivariate EWMA/z-score signal and least-squares vibration trend.' },
    ];
    return { stages, events, maintenance };
  }

  private healthScore(frame: TelemetryFrame, anomalies: AssetAnomaly[]): number {
    const anomalyPenalty = (anomalies[0]?.anomaly_score ?? 0) * 4;
    const thresholdPenalty = frame.readings.filter((reading) => reading.status === 'warning').length * 8
      + frame.readings.filter((reading) => reading.status === 'critical').length * 18;
    return Math.max(0, Math.min(100, Math.round(100 - anomalyPenalty - thresholdPenalty)));
  }

  private healthStatus(score: number): 'healthy' | 'watch' | 'warning' | 'critical' {
    return score >= 90 ? 'healthy' : score >= 75 ? 'watch' : score >= 50 ? 'warning' : 'critical';
  }

  private reading(frame: TelemetryFrame, metric: AssetTelemetryMetric): TelemetryReading {
    const value = frame.readings.find((reading) => reading.metric === metric);
    if (!value) throw new Error(`Synthetic telemetry is missing ${metric}`);
    return value;
  }

  private regression(x: number[], y: number[]): RegressionResult {
    const xMean = this.mean(x);
    const yMean = this.mean(y);
    let numerator = 0;
    let denominator = 0;
    for (let index = 0; index < Math.min(x.length, y.length); index += 1) {
      numerator += (x[index] - xMean) * (y[index] - yMean);
      denominator += (x[index] - xMean) ** 2;
    }
    const slope = denominator === 0 ? 0 : numerator / denominator;
    const intercept = yMean - slope * xMean;
    let residual = 0;
    let total = 0;
    for (let index = 0; index < y.length; index += 1) {
      residual += (y[index] - (intercept + slope * x[index])) ** 2;
      total += (y[index] - yMean) ** 2;
    }
    return { slope, intercept, rSquared: total === 0 ? 0 : Math.max(0, 1 - residual / total) };
  }

  private minimumDeviation(signal: AssetTelemetryMetric): number {
    const minimums: Record<AssetTelemetryMetric, number> = {
      temperature_c: 0.25,
      discharge_pressure_bar: 0.04,
      vibration_mm_s: 0.08,
      flow_l_min: 6,
      motor_current_a: 0.3,
      speed_rpm: 4,
    };
    return minimums[signal];
  }

  private assertExactKeys(record: Record<string, unknown>, allowlist: string[], label: string): void {
    const unexpected = Object.keys(record).filter((key) => !allowlist.includes(key));
    if (unexpected.length) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'unknown_request_field', `${label} contains unsupported field(s): ${unexpected.sort().join(', ')}.`);
    }
  }

  private mean(values: number[]): number {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  private standardDeviation(values: number[], mean: number): number {
    if (values.length < 2) return 0;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  }

  private round(value: number, precision: number): number {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  }

  private async appendAudit(
    ctx: RequestContext,
    action: string,
    resourceType: AssetAuditEvidence['resource_type'],
    resourceId: string,
    detailsHash: string,
  ): Promise<AssetAuditEvidence> {
    const current = this.auditByTenant.get(ctx.tenantId) ?? [];
    const previousHash = current.at(-1)?.event_hash ?? '0'.repeat(64);
    const base = {
      event_id: newId(),
      tenant_sequence: current.length + 1,
      action,
      actor_id: ctx.actor.actor_id,
      resource_type: resourceType,
      resource_id: resourceId,
      occurred_at: nowIso(),
      request_id: ctx.requestId,
      trace_id: traceId(),
      details_hash: detailsHash,
      previous_hash: previousHash,
    };
    const event: AssetAuditEvidence = { ...base, event_hash: sha256({ ...base, tenant_id: ctx.tenantId }) };
    current.push(event);
    this.auditByTenant.set(ctx.tenantId, current);
    await this.database.put(ctx.tenantId, 'asset_audit_event', event.event_id, event);
    return event;
  }

  private isExpired(expiresAt: string): boolean {
    const reference = process.env.EDT_FROZEN_CLOCK === 'true' ? new Date(nowIso()).getTime() : Date.now();
    return new Date(expiresAt).getTime() <= reference;
  }

  private idempotencyConflict(): never {
    throw new ProblemException(HttpStatus.CONFLICT, 'idempotency_key_reused', 'The Idempotency-Key was already used with a different request.');
  }

  private notFound(): ProblemException {
    return new ProblemException(HttpStatus.NOT_FOUND, 'not_found', 'The resource was not found.');
  }
}
