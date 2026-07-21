import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseMutationConflict, DatabaseService, EventMutationAudit, EventMutationRecord } from './database.service';
import {
  DECISION_INTELLIGENCE_SCHEMA_VERSION,
  MODEL_KINDS,
  ModelKind,
  PREDICTION_KINDS,
  PredictionKnowledgeRecord,
  PredictionFeatureBatch,
  PredictionKind,
  PredictionRun,
  PredictiveModelDefinition,
} from './decision-intelligence.types';
import { DecisionWorkerService } from './decision-worker.service';
import { RequestContext, etag, newId, nowIso, sha256, stableUuid, traceId } from './domain';
import {
  UUID_PATTERN,
  assertExactKeys,
  boundedInteger,
  invalid,
  isoTimestamp,
  normalizedIdentifier,
  notFound,
  optionalUuid,
  plainRecord,
  requiredString,
  safeRecord,
  score,
  uuid,
} from './foundation-validation';
import { ProblemException } from './problem';

const MODEL_KIND = 'predictive_model_definition';
const PREDICTION_RUN_KIND = 'prediction_run';
const FEATURE_BATCH_KIND = 'prediction_feature_batch';
const KNOWLEDGE_KIND = 'prediction_knowledge';
const LEARNING_EVENT_KIND = 'prediction_learning_event';
const DAY_SECONDS = 86_400;
const MODEL_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-z0-9.-]+)?$/i;
const FORECAST_ALGORITHMS = new Set(['linear_trend', 'bounded_linear_trend']);
const TARGET = /^[a-z][a-z0-9_]{0,63}$/;
const FORBIDDEN_TARGET = /(?:^|_)(employee_id|person_id|performance|productivity|attrition|hiring_score)(?:_|$)/;

@Injectable()
export class PredictiveEngineService {
  constructor(private readonly database: DatabaseService, private readonly worker: DecisionWorkerService) {}

  async registerModel(ctx: RequestContext, input: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>> {
    this.assertModelAdmin(ctx);
    assertExactKeys(input, ['name', 'kind', 'prediction_kind', 'algorithm', 'inputs', 'outputs', 'model_version', 'accuracy', 'owner_id', 'trigger', 'status'], 'Model definition');
    const kind = this.modelKind(input.kind);
    const predictionKind = input.prediction_kind === undefined || input.prediction_kind === null ? null : this.predictionKind(input.prediction_kind);
    const algorithm = normalizedIdentifier(input.algorithm, 'algorithm', 120);
    const status = this.modelStatus(input.status ?? 'draft');
    if (status === 'active' && (!predictionKind || !['forecasting', 'classification'].includes(kind) || !FORECAST_ALGORITHMS.has(algorithm))) {
      throw invalid('model_not_executable', 'An active predictive model requires a prediction kind and an approved deterministic forecasting algorithm.');
    }
    const version = requiredString(input.model_version, 'model_version', 64);
    if (!MODEL_VERSION.test(version)) throw invalid('invalid_model_version', 'model_version must be a semantic version.');
    const accuracyInput = input.accuracy === undefined ? {} : plainRecord(input.accuracy, 'accuracy');
    assertExactKeys(accuracyInput, ['score', 'metric', 'validation_count', 'last_validated_at'], 'Model accuracy');
    const validationCount = boundedInteger(accuracyInput.validation_count, 'accuracy.validation_count', 0, 1_000_000, 0);
    const lastValidatedAt = accuracyInput.last_validated_at === undefined || accuracyInput.last_validated_at === null
      ? null : isoTimestamp(accuracyInput.last_validated_at, 'accuracy.last_validated_at');
    if ((validationCount === 0) !== (lastValidatedAt === null)) throw invalid('invalid_model_accuracy', 'Accuracy validation_count and last_validated_at must be supplied together.');
    const modelId = this.resourceId(ctx, 'prediction.model.register', idempotencyKey);
    const timestamp = nowIso();
    const model: PredictiveModelDefinition = {
      model_id: modelId, tenant_id: ctx.tenantId,
      name: requiredString(input.name, 'name', 200), kind, prediction_kind: predictionKind, algorithm,
      inputs: this.descriptors(input.inputs, 'inputs'), outputs: this.descriptors(input.outputs, 'outputs'),
      model_version: version,
      accuracy: {
        score: score(accuracyInput.score, 'accuracy.score', 0),
        metric: requiredString(accuracyInput.metric ?? 'normalized_absolute_accuracy', 'accuracy.metric', 100),
        validation_count: validationCount, last_validated_at: lastValidatedAt,
      },
      owner_id: optionalUuid(input.owner_id, 'owner_id') ?? ctx.actor.actor_id,
      trigger: safeRecord(input.trigger ?? { type: 'manual' }, 'trigger', 16_000),
      status, calibration_bias: 0, learning_revision: 0, version: 1,
      created_at: timestamp, updated_at: timestamp, state_hash: '',
    };
    model.state_hash = this.stateHash(model);
    const committed = await this.commitCreate(ctx, MODEL_KIND, modelId, model, {
      action: 'decision.model.register', idempotencyKey,
      requestHash: sha256({ action: 'model.register', input }),
      eventType: 'com.enterprisedigitaltwin.decision.model-registered.v1', aggregateType: MODEL_KIND,
    });
    if (committed.replayed) return this.modelView(await this.model(ctx.tenantId, modelId), true);
    return this.modelView(model);
  }

  async listModels(ctx: RequestContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    assertExactKeys(input, ['kind', 'prediction_kind', 'status', 'limit', 'cursor'], 'Model list');
    const filters: Record<string, string> = {};
    if (input.kind !== undefined) filters.kind = this.modelKind(input.kind);
    if (input.prediction_kind !== undefined) filters.prediction_kind = this.predictionKind(input.prediction_kind);
    if (input.status !== undefined) filters.status = this.modelStatus(input.status);
    const limit = boundedInteger(input.limit, 'limit', 1, 100, 50);
    const cursor = input.cursor === undefined ? undefined : requiredString(input.cursor, 'cursor', 2_000);
    const page = await this.database.listPage<PredictiveModelDefinition>(ctx.tenantId, MODEL_KIND, { filters, limit, cursor });
    return { items: page.items, has_more: page.nextCursor !== null, next_cursor: page.nextCursor, schema_version: DECISION_INTELLIGENCE_SCHEMA_VERSION };
  }

  async getModel(ctx: RequestContext, modelId: string): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    return this.modelView(await this.model(ctx.tenantId, modelId));
  }

  async createPrediction(ctx: RequestContext, input: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>> {
    this.assertPredictionRun(ctx);
    assertExactKeys(input, ['model_id', 'target', 'horizon_steps', 'observations'], 'Prediction run');
    const model = await this.model(ctx.tenantId, uuid(input.model_id, 'model_id'));
    if (model.status !== 'active' || !model.prediction_kind || !FORECAST_ALGORITHMS.has(model.algorithm) || !['forecasting', 'classification'].includes(model.kind)) {
      throw new ProblemException(HttpStatus.CONFLICT, 'model_not_active', 'The selected model is not active for deterministic prediction.');
    }
    const target = requiredString(input.target, 'target', 64);
    this.assertTarget(model.prediction_kind, target);
    const observations = this.observations(input.observations);
    const horizonSteps = boundedInteger(input.horizon_steps, 'horizon_steps', 1, 36);
    const predictionId = this.resourceId(ctx, 'prediction.run', idempotencyKey);
    const featureBatchId = stableUuid(`${predictionId}:feature-batch`);
    const result = await this.worker.runPrediction(ctx, {
      prediction_id: predictionId, tenant_id: ctx.tenantId, model_id: model.model_id,
      model_version: model.model_version, kind: model.prediction_kind, algorithm: model.algorithm,
      target, requested_at: nowIso(), horizon_steps: horizonSteps, observations, calibration_bias: model.calibration_bias,
    });
    const timestamp = nowIso();
    const dataHash = sha256(observations);
    const featureBatch: PredictionFeatureBatch = {
      feature_batch_id: featureBatchId, tenant_id: ctx.tenantId, prediction_id: predictionId,
      observations, observation_count: observations.length, data_hash: dataHash,
      source: { kind: 'user_supplied_historical_observations', actor_id: ctx.actor.actor_id },
      created_at: timestamp, state_hash: '',
    };
    featureBatch.state_hash = this.stateHash(featureBatch);
    const run: PredictionRun = {
      prediction_id: predictionId, tenant_id: ctx.tenantId, model_id: model.model_id,
      model_version: model.model_version, kind: model.prediction_kind, target, horizon_steps: horizonSteps,
      historical_feature_batch_id: featureBatchId,
      historical_data_hash: dataHash, historical_observation_count: observations.length,
      result: safeRecord(result, 'prediction result', 1_000_000),
      result_sha256: requiredString(result.result_sha256, 'result_sha256', 64),
      status: 'pending_outcome', observed_outcome: null, validation: null,
      version: 1, created_at: timestamp, created_by: ctx.actor.actor_id, updated_at: timestamp, state_hash: '',
    };
    run.state_hash = this.stateHash(run);
    const committed = await this.commit(ctx, [
      { kind: FEATURE_BATCH_KIND, id: featureBatchId, payload: featureBatch },
      { kind: PREDICTION_RUN_KIND, id: predictionId, payload: run },
    ], {
      action: 'decision.prediction.run', idempotencyKey,
      requestHash: sha256({ action: 'prediction.run', model_id: model.model_id, model_version: model.model_version, input }),
      responseRef: predictionId, eventType: 'com.enterprisedigitaltwin.decision.prediction-created.v1',
      aggregateType: PREDICTION_RUN_KIND, aggregateId: predictionId, aggregateVersion: 1,
      expectedRecords: [
        { kind: FEATURE_BATCH_KIND, id: featureBatchId, absent: true },
        { kind: PREDICTION_RUN_KIND, id: predictionId, absent: true },
      ],
    });
    if (committed.replayed) return this.runView(await this.run(ctx.tenantId, predictionId), true);
    return this.runView(run);
  }

  async recordOutcome(
    ctx: RequestContext,
    predictionId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
    ifMatch: string | undefined,
  ): Promise<Record<string, unknown>> {
    this.assertPredictionRun(ctx);
    assertExactKeys(input, ['actual_values', 'observed_at', 'source'], 'Prediction outcome');
    const existing = await this.run(ctx.tenantId, predictionId);
    const actualValues = this.numberArray(input.actual_values, 'actual_values', 1, 36);
    if (actualValues.length !== existing.horizon_steps) throw invalid('outcome_horizon_mismatch', 'actual_values must match the forecast horizon.');
    const source = safeRecord(input.source, 'source', 16_000);
    const observedAt = isoTimestamp(input.observed_at, 'observed_at');
    if (existing.status !== 'pending_outcome') {
      const prior = existing.validation ?? {};
      const exactReplay = existing.status === 'outcome_recorded'
        && JSON.stringify(existing.observed_outcome) === JSON.stringify(actualValues)
        && prior.outcome_observed_at === observedAt
        && prior.outcome_source_hash === sha256(source);
      if (exactReplay) return this.runView(existing, true);
      throw new ProblemException(HttpStatus.CONFLICT, 'prediction_outcome_exists', 'An outcome has already been recorded.');
    }
    this.assertEtag(ifMatch, existing.state_hash);
    const updated: PredictionRun = {
      ...existing, status: 'outcome_recorded', observed_outcome: actualValues,
      validation: { outcome_observed_at: observedAt, outcome_source_hash: sha256(source) },
      version: existing.version + 1, updated_at: nowIso(), state_hash: '',
    };
    updated.state_hash = this.stateHash(updated);
    const committed = await this.commit(ctx, [{ kind: PREDICTION_RUN_KIND, id: predictionId, payload: updated }], {
      action: 'decision.prediction.outcome.record', idempotencyKey,
      requestHash: sha256({ action: 'prediction.outcome.record', prediction_id: predictionId, input }),
      responseRef: predictionId, eventType: 'com.enterprisedigitaltwin.decision.prediction-outcome-recorded.v1',
      aggregateType: PREDICTION_RUN_KIND, aggregateId: predictionId, aggregateVersion: updated.version,
      expectedRecords: [{ kind: PREDICTION_RUN_KIND, id: predictionId, expected: { version: existing.version, state_hash: existing.state_hash } }],
    });
    if (committed.replayed) return this.runView(await this.run(ctx.tenantId, predictionId), true);
    return this.runView(updated);
  }

  async validateOutcome(
    ctx: RequestContext,
    predictionId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
    ifMatch: string | undefined,
  ): Promise<Record<string, unknown>> {
    this.assertPredictionRun(ctx);
    assertExactKeys(input, ['decision', 'corrected_actual_values', 'expert_notes'], 'Prediction validation');
    const existing = await this.run(ctx.tenantId, predictionId);
    const decision = input.decision;
    if (!['confirmed', 'corrected'].includes(String(decision))) throw invalid('invalid_validation_decision', 'decision must be confirmed or corrected.');
    const expertNotes = input.expert_notes === undefined ? null : requiredString(input.expert_notes, 'expert_notes', 2_000);
    if (existing.status === 'validated' || existing.status === 'corrected') {
      const prior = existing.validation ?? {};
      const suppliedCorrection = decision === 'corrected'
        ? this.numberArray(input.corrected_actual_values, 'corrected_actual_values', existing.horizon_steps, existing.horizon_steps)
        : existing.observed_outcome;
      const exactReplay = prior.decision === decision
        && prior.expert_notes === expertNotes
        && JSON.stringify(existing.observed_outcome) === JSON.stringify(suppliedCorrection);
      if (exactReplay) return { ...this.runView(existing, true), model: await this.model(ctx.tenantId, existing.model_id) };
      throw new ProblemException(HttpStatus.CONFLICT, 'prediction_already_validated', 'The prediction outcome has already been validated.');
    }
    this.assertEtag(ifMatch, existing.state_hash);
    if (existing.status !== 'outcome_recorded' || !existing.observed_outcome) throw new ProblemException(HttpStatus.CONFLICT, 'prediction_outcome_not_ready', 'Record the real outcome before validation.');
    const actualValues = decision === 'corrected'
      ? this.numberArray(input.corrected_actual_values, 'corrected_actual_values', existing.horizon_steps, existing.horizon_steps)
      : existing.observed_outcome;
    const forecast = (existing.result.forecast as unknown[] | undefined);
    if (!Array.isArray(forecast) || forecast.length !== existing.horizon_steps) throw new ProblemException(HttpStatus.CONFLICT, 'prediction_forecast_invalid', 'The stored forecast cannot be validated.');
    const metrics = await this.worker.validatePrediction(ctx, { forecast, actual_values: actualValues });
    const accuracyScore = score(metrics.accuracy_score, 'accuracy_score');
    const meanBias = Number(metrics.mean_bias);
    if (!Number.isFinite(meanBias)) throw new ProblemException(HttpStatus.BAD_GATEWAY, 'prediction_validation_invalid', 'The worker returned invalid validation metrics.', true);
    const model = await this.model(ctx.tenantId, existing.model_id);
    if (model.model_version !== existing.model_version) throw new ProblemException(HttpStatus.CONFLICT, 'prediction_model_version_changed', 'The prediction model version no longer matches the run.');
    const validatedAt = nowIso();
    const count = model.accuracy.validation_count;
    const updatedModel: PredictiveModelDefinition = {
      ...model,
      accuracy: {
        score: this.round((model.accuracy.score * count + accuracyScore) / (count + 1)),
        metric: model.accuracy.metric, validation_count: count + 1, last_validated_at: validatedAt,
      },
      calibration_bias: Math.max(-1e9, Math.min(1e9, this.round(model.calibration_bias + meanBias * 0.2))),
      learning_revision: model.learning_revision + 1, version: model.version + 1,
      updated_at: validatedAt, state_hash: '',
    };
    updatedModel.state_hash = this.stateHash(updatedModel);
    const validation = {
      ...metrics, decision, validated_at: validatedAt, validated_by: ctx.actor.actor_id,
      actual_values: actualValues,
      expert_notes: expertNotes,
      model_learning_revision: updatedModel.learning_revision,
    };
    const updatedRun: PredictionRun = {
      ...existing, status: decision === 'confirmed' ? 'validated' : 'corrected', observed_outcome: actualValues,
      validation, version: existing.version + 1, updated_at: validatedAt, state_hash: '',
    };
    updatedRun.state_hash = this.stateHash(updatedRun);
    const learningId = this.resourceId(ctx, 'prediction.learning', idempotencyKey);
    const learningEvent = {
      learning_event_id: learningId, tenant_id: ctx.tenantId, prediction_id: predictionId,
      model_id: model.model_id, model_version: model.model_version, decision,
      accuracy_score: accuracyScore, mean_bias: meanBias, calibration_bias_before: model.calibration_bias,
      calibration_bias_after: updatedModel.calibration_bias, created_at: validatedAt,
    };
    const committed = await this.commit(ctx, [
      { kind: PREDICTION_RUN_KIND, id: predictionId, payload: updatedRun },
      { kind: MODEL_KIND, id: model.model_id, payload: updatedModel },
      { kind: LEARNING_EVENT_KIND, id: learningId, payload: learningEvent },
    ], {
      action: 'decision.prediction.validate', idempotencyKey,
      requestHash: sha256({ action: 'prediction.validate', prediction_id: predictionId, input }),
      responseRef: predictionId, eventType: 'com.enterprisedigitaltwin.decision.prediction-validated.v1',
      aggregateType: PREDICTION_RUN_KIND, aggregateId: predictionId, aggregateVersion: updatedRun.version,
      expectedRecords: [
        { kind: PREDICTION_RUN_KIND, id: predictionId, expected: { version: existing.version, state_hash: existing.state_hash } },
        { kind: MODEL_KIND, id: model.model_id, expected: { version: model.version, state_hash: model.state_hash } },
        { kind: LEARNING_EVENT_KIND, id: learningId, absent: true },
      ],
    });
    if (committed.replayed) return this.runView(await this.run(ctx.tenantId, predictionId), true);
    return { ...this.runView(updatedRun), model: updatedModel };
  }

  async submitKnowledge(ctx: RequestContext, input: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>> {
    this.assertPredictionRun(ctx);
    assertExactKeys(input, ['category', 'model_id', 'prediction_id', 'title', 'content', 'source', 'owner_id'], 'Prediction knowledge');
    const categories = ['historical_outcome', 'technical_specification', 'company_rule', 'correction', 'expert_knowledge'] as const;
    const category = input.category;
    if (typeof category !== 'string' || !categories.includes(category as typeof categories[number])) throw invalid('invalid_knowledge_category', `category must be one of ${categories.join(', ')}.`);
    const modelId = optionalUuid(input.model_id, 'model_id');
    const predictionId = optionalUuid(input.prediction_id, 'prediction_id');
    if (modelId) await this.model(ctx.tenantId, modelId);
    if (predictionId) await this.run(ctx.tenantId, predictionId);
    const knowledgeId = this.resourceId(ctx, 'prediction.knowledge.submit', idempotencyKey);
    const knowledge: PredictionKnowledgeRecord = {
      knowledge_id: knowledgeId, tenant_id: ctx.tenantId, category: category as PredictionKnowledgeRecord['category'],
      model_id: modelId, prediction_id: predictionId, title: requiredString(input.title, 'title', 300),
      content: safeRecord(input.content, 'content', 128_000), source: safeRecord(input.source, 'source', 16_000),
      owner_id: optionalUuid(input.owner_id, 'owner_id') ?? ctx.actor.actor_id,
      status: 'pending_review', created_at: nowIso(), state_hash: '',
    };
    knowledge.state_hash = this.stateHash(knowledge);
    const committed = await this.commitCreate(ctx, KNOWLEDGE_KIND, knowledgeId, knowledge, {
      action: 'decision.prediction_knowledge.submit', idempotencyKey,
      requestHash: sha256({ action: 'prediction_knowledge.submit', input }),
      eventType: 'com.enterprisedigitaltwin.decision.prediction-knowledge-submitted.v1', aggregateType: KNOWLEDGE_KIND,
    });
    if (committed.replayed) return { knowledge: await this.knowledge(ctx.tenantId, knowledgeId), replayed: true };
    return { knowledge };
  }

  async getPrediction(ctx: RequestContext, predictionId: string): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    return this.runView(await this.run(ctx.tenantId, predictionId));
  }

  private observations(value: unknown): Array<{ observed_at: string; value: number; features: Record<string, number> }> {
    if (!Array.isArray(value) || value.length < 3 || value.length > 10_000) throw invalid('invalid_historical_data', 'observations must contain three to 10,000 items.');
    const timestamps = new Set<string>();
    return value.map((raw, index) => {
      const item = plainRecord(raw, `observations[${index}]`);
      assertExactKeys(item, ['observed_at', 'value', 'features'], `observations[${index}]`);
      const observedAt = isoTimestamp(item.observed_at, `observations[${index}].observed_at`);
      if (timestamps.has(observedAt)) throw invalid('duplicate_observation_time', 'Historical observations must have unique timestamps.');
      timestamps.add(observedAt);
      const number = typeof item.value === 'number' ? item.value : Number.NaN;
      if (!Number.isFinite(number) || Math.abs(number) > 1e12) throw invalid('invalid_observation_value', 'Observation values must be finite and bounded.');
      const featureInput = safeRecord(item.features ?? {}, `observations[${index}].features`, 16_000);
      if (Object.keys(featureInput).length > 50) throw invalid('too_many_features', 'Each observation may contain at most 50 features.');
      const features: Record<string, number> = {};
      for (const [name, rawValue] of Object.entries(featureInput)) {
        if (!TARGET.test(name) || FORBIDDEN_TARGET.test(name) || typeof rawValue !== 'number' || !Number.isFinite(rawValue) || Math.abs(rawValue) > 1e12) {
          throw invalid('invalid_prediction_feature', 'Features must be bounded aggregate numeric identifiers.');
        }
        features[name] = rawValue;
      }
      return { observed_at: observedAt, value: number, features };
    });
  }

  private assertTarget(kind: PredictionKind, target: string): void {
    if (kind === 'workforce' && !['headcount', 'workforce_capacity', 'open_positions'].includes(target)) {
      throw invalid('workforce_prediction_prohibited', 'Workforce prediction is limited to aggregate headcount, capacity, or open positions.');
    }
    if (!TARGET.test(target) || FORBIDDEN_TARGET.test(target)) throw invalid('invalid_prediction_target', 'The target must be an aggregate metric identifier.');
  }

  private descriptors(value: unknown, field: string): Array<Record<string, unknown>> {
    if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw invalid('invalid_model_descriptor', `${field} must contain one to 50 descriptors.`);
    return value.map((item, index) => safeRecord(item, `${field}[${index}]`, 16_000));
  }

  private numberArray(value: unknown, field: string, minimum: number, maximum: number): number[] {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw invalid('invalid_number_array', `${field} must contain ${minimum === maximum ? minimum : `${minimum} to ${maximum}`} values.`);
    return value.map((item, index) => {
      if (typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 1e12) throw invalid('invalid_number', `${field}[${index}] must be finite and bounded.`);
      return item;
    });
  }

  private modelKind(value: unknown): ModelKind {
    if (typeof value !== 'string' || !MODEL_KINDS.includes(value as ModelKind)) throw invalid('invalid_model_kind', `kind must be one of ${MODEL_KINDS.join(', ')}.`);
    return value as ModelKind;
  }

  private predictionKind(value: unknown): PredictionKind {
    if (typeof value !== 'string' || !PREDICTION_KINDS.includes(value as PredictionKind)) throw invalid('invalid_prediction_kind', `prediction_kind must be one of ${PREDICTION_KINDS.join(', ')}.`);
    return value as PredictionKind;
  }

  private modelStatus(value: unknown): PredictiveModelDefinition['status'] {
    if (!['draft', 'active', 'retired'].includes(String(value))) throw invalid('invalid_model_status', 'status must be draft, active, or retired.');
    return value as PredictiveModelDefinition['status'];
  }

  private async model(tenantId: string, id: string): Promise<PredictiveModelDefinition> {
    if (!UUID_PATTERN.test(id)) throw notFound();
    const model = await this.database.get<PredictiveModelDefinition>(tenantId, MODEL_KIND, id);
    if (!model || model.tenant_id !== tenantId) throw notFound();
    return model;
  }

  private async run(tenantId: string, id: string): Promise<PredictionRun> {
    if (!UUID_PATTERN.test(id)) throw notFound();
    const run = await this.database.get<PredictionRun>(tenantId, PREDICTION_RUN_KIND, id);
    if (!run || run.tenant_id !== tenantId) throw notFound();
    return run;
  }

  private async knowledge(tenantId: string, id: string): Promise<PredictionKnowledgeRecord> {
    const record = await this.database.get<PredictionKnowledgeRecord>(tenantId, KNOWLEDGE_KIND, id);
    if (!record || record.tenant_id !== tenantId) throw notFound();
    return record;
  }

  private modelView(model: PredictiveModelDefinition, replayed = false): Record<string, unknown> {
    return { model, etag: etag(model.state_hash), ...(replayed ? { replayed: true } : {}) };
  }

  private runView(run: PredictionRun, replayed = false): Record<string, unknown> {
    return { prediction: run, etag: etag(run.state_hash), ...(replayed ? { replayed: true } : {}) };
  }

  private assertEtag(ifMatch: string | undefined, stateHash: string): void {
    if (!ifMatch) throw new ProblemException(HttpStatus.PRECONDITION_REQUIRED, 'if_match_required', 'If-Match is required.');
    if (ifMatch !== etag(stateHash)) throw new ProblemException(HttpStatus.PRECONDITION_FAILED, 'prediction_precondition_failed', 'The prediction changed before the operation.');
  }

  private assertRead(ctx: RequestContext): void {
    if (ctx.actor.capabilities.includes('connector.admin') || ctx.actor.capabilities.includes('simulation.run') || ctx.actor.capabilities.includes('scenario.create')) return;
    throw new ProblemException(HttpStatus.FORBIDDEN, 'prediction_read_denied', 'Prediction access is not permitted.');
  }

  private assertPredictionRun(ctx: RequestContext): void {
    if (ctx.actor.capabilities.includes('connector.admin') || ctx.actor.capabilities.includes('simulation.run')) return;
    throw new ProblemException(HttpStatus.FORBIDDEN, 'prediction_run_denied', 'Prediction execution or feedback is not permitted.');
  }

  private assertModelAdmin(ctx: RequestContext): void {
    if (ctx.actor.capabilities.includes('connector.admin')) return;
    throw new ProblemException(HttpStatus.FORBIDDEN, 'model_registry_write_denied', 'Model registration requires tenant integration administration.');
  }

  private resourceId(ctx: RequestContext, operation: string, key: string): string {
    return stableUuid(`${DECISION_INTELLIGENCE_SCHEMA_VERSION}:${ctx.tenantId}:${ctx.actor.actor_id}:${operation}:${key}`);
  }

  private stateHash(value: object): string {
    const { state_hash: _stateHash, ...domain } = value as Record<string, unknown>;
    return sha256(domain);
  }

  private round(value: number): number { return Math.round(value * 1e8) / 1e8; }

  private commitCreate(ctx: RequestContext, kind: string, id: string, payload: unknown, mutation: { action: string; idempotencyKey: string; requestHash: string; eventType: string; aggregateType: string }): Promise<{ replayed: boolean }> {
    return this.commit(ctx, [{ kind, id, payload }], {
      ...mutation, responseRef: id, aggregateId: id, aggregateVersion: 1,
      expectedRecords: [{ kind, id, absent: true }],
    });
  }

  private async commit(
    ctx: RequestContext,
    records: EventMutationRecord[],
    mutation: {
      action: string; idempotencyKey: string; requestHash: string; responseRef: string; eventType: string;
      aggregateType: string; aggregateId: string; aggregateVersion: number;
      expectedRecords: Array<{ kind: string; id: string; expected?: Record<string, string | number>; absent?: true }>;
    },
  ): Promise<{ replayed: boolean }> {
    const audit: EventMutationAudit = {
      audit_id: newId(), tenant_sequence: 0, action: mutation.action, actor_id: ctx.actor.actor_id,
      resource_type: mutation.aggregateType, resource_id: mutation.aggregateId, occurred_at: nowIso(),
      request_id: ctx.requestId, trace_id: traceId(), details_hash: sha256({ action: mutation.action, aggregate_id: mutation.aggregateId }),
      previous_hash: '', event_hash: '',
    };
    try {
      const result = await this.database.commitEventMutation(ctx.tenantId, records, audit, {
        eventId: stableUuid(`${ctx.tenantId}:${mutation.action}:${mutation.idempotencyKey}:outbox`),
        eventType: mutation.eventType, aggregateType: mutation.aggregateType, aggregateId: mutation.aggregateId,
        aggregateVersion: mutation.aggregateVersion,
        payload: { tenant_id: ctx.tenantId, history_event_id: mutation.responseRef, resource_id: mutation.aggregateId, outbox_position: 0 },
      }, {
        idempotency: {
          operation: `${ctx.actor.actor_id}:${mutation.action}`, key: mutation.idempotencyKey,
          requestHash: mutation.requestHash, responseRef: mutation.responseRef,
          expiresAt: new Date(Date.now() + 7 * 365 * DAY_SECONDS * 1_000).toISOString(),
        }, expectedRecords: mutation.expectedRecords,
      });
      return { replayed: result.replayed === true };
    } catch (error) {
      if (error instanceof DatabaseMutationConflict) throw new ProblemException(HttpStatus.CONFLICT, error.code, error.message, error.code === 'idempotency_request_in_progress');
      throw error;
    }
  }
}
