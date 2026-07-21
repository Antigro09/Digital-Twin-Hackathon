"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PredictiveEngineService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("./database.service");
const decision_intelligence_types_1 = require("./decision-intelligence.types");
const decision_worker_service_1 = require("./decision-worker.service");
const domain_1 = require("./domain");
const foundation_validation_1 = require("./foundation-validation");
const problem_1 = require("./problem");
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
let PredictiveEngineService = class PredictiveEngineService {
    database;
    worker;
    constructor(database, worker) {
        this.database = database;
        this.worker = worker;
    }
    async registerModel(ctx, input, idempotencyKey) {
        this.assertModelAdmin(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['name', 'kind', 'prediction_kind', 'algorithm', 'inputs', 'outputs', 'model_version', 'accuracy', 'owner_id', 'trigger', 'status'], 'Model definition');
        const kind = this.modelKind(input.kind);
        const predictionKind = input.prediction_kind === undefined || input.prediction_kind === null ? null : this.predictionKind(input.prediction_kind);
        const algorithm = (0, foundation_validation_1.normalizedIdentifier)(input.algorithm, 'algorithm', 120);
        const status = this.modelStatus(input.status ?? 'draft');
        if (status === 'active' && (!predictionKind || !['forecasting', 'classification'].includes(kind) || !FORECAST_ALGORITHMS.has(algorithm))) {
            throw (0, foundation_validation_1.invalid)('model_not_executable', 'An active predictive model requires a prediction kind and an approved deterministic forecasting algorithm.');
        }
        const version = (0, foundation_validation_1.requiredString)(input.model_version, 'model_version', 64);
        if (!MODEL_VERSION.test(version))
            throw (0, foundation_validation_1.invalid)('invalid_model_version', 'model_version must be a semantic version.');
        const accuracyInput = input.accuracy === undefined ? {} : (0, foundation_validation_1.plainRecord)(input.accuracy, 'accuracy');
        (0, foundation_validation_1.assertExactKeys)(accuracyInput, ['score', 'metric', 'validation_count', 'last_validated_at'], 'Model accuracy');
        const validationCount = (0, foundation_validation_1.boundedInteger)(accuracyInput.validation_count, 'accuracy.validation_count', 0, 1_000_000, 0);
        const lastValidatedAt = accuracyInput.last_validated_at === undefined || accuracyInput.last_validated_at === null
            ? null : (0, foundation_validation_1.isoTimestamp)(accuracyInput.last_validated_at, 'accuracy.last_validated_at');
        if ((validationCount === 0) !== (lastValidatedAt === null))
            throw (0, foundation_validation_1.invalid)('invalid_model_accuracy', 'Accuracy validation_count and last_validated_at must be supplied together.');
        const modelId = this.resourceId(ctx, 'prediction.model.register', idempotencyKey);
        const timestamp = (0, domain_1.nowIso)();
        const model = {
            model_id: modelId, tenant_id: ctx.tenantId,
            name: (0, foundation_validation_1.requiredString)(input.name, 'name', 200), kind, prediction_kind: predictionKind, algorithm,
            inputs: this.descriptors(input.inputs, 'inputs'), outputs: this.descriptors(input.outputs, 'outputs'),
            model_version: version,
            accuracy: {
                score: (0, foundation_validation_1.score)(accuracyInput.score, 'accuracy.score', 0),
                metric: (0, foundation_validation_1.requiredString)(accuracyInput.metric ?? 'normalized_absolute_accuracy', 'accuracy.metric', 100),
                validation_count: validationCount, last_validated_at: lastValidatedAt,
            },
            owner_id: (0, foundation_validation_1.optionalUuid)(input.owner_id, 'owner_id') ?? ctx.actor.actor_id,
            trigger: (0, foundation_validation_1.safeRecord)(input.trigger ?? { type: 'manual' }, 'trigger', 16_000),
            status, calibration_bias: 0, learning_revision: 0, version: 1,
            created_at: timestamp, updated_at: timestamp, state_hash: '',
        };
        model.state_hash = this.stateHash(model);
        const committed = await this.commitCreate(ctx, MODEL_KIND, modelId, model, {
            action: 'decision.model.register', idempotencyKey,
            requestHash: (0, domain_1.sha256)({ action: 'model.register', input }),
            eventType: 'com.enterprisedigitaltwin.decision.model-registered.v1', aggregateType: MODEL_KIND,
        });
        if (committed.replayed)
            return this.modelView(await this.model(ctx.tenantId, modelId), true);
        return this.modelView(model);
    }
    async listModels(ctx, input) {
        this.assertRead(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['kind', 'prediction_kind', 'status', 'limit', 'cursor'], 'Model list');
        const filters = {};
        if (input.kind !== undefined)
            filters.kind = this.modelKind(input.kind);
        if (input.prediction_kind !== undefined)
            filters.prediction_kind = this.predictionKind(input.prediction_kind);
        if (input.status !== undefined)
            filters.status = this.modelStatus(input.status);
        const limit = (0, foundation_validation_1.boundedInteger)(input.limit, 'limit', 1, 100, 50);
        const cursor = input.cursor === undefined ? undefined : (0, foundation_validation_1.requiredString)(input.cursor, 'cursor', 2_000);
        const page = await this.database.listPage(ctx.tenantId, MODEL_KIND, { filters, limit, cursor });
        return { items: page.items, has_more: page.nextCursor !== null, next_cursor: page.nextCursor, schema_version: decision_intelligence_types_1.DECISION_INTELLIGENCE_SCHEMA_VERSION };
    }
    async getModel(ctx, modelId) {
        this.assertRead(ctx);
        return this.modelView(await this.model(ctx.tenantId, modelId));
    }
    async createPrediction(ctx, input, idempotencyKey) {
        this.assertPredictionRun(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['model_id', 'target', 'horizon_steps', 'observations'], 'Prediction run');
        const model = await this.model(ctx.tenantId, (0, foundation_validation_1.uuid)(input.model_id, 'model_id'));
        if (model.status !== 'active' || !model.prediction_kind || !FORECAST_ALGORITHMS.has(model.algorithm) || !['forecasting', 'classification'].includes(model.kind)) {
            throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'model_not_active', 'The selected model is not active for deterministic prediction.');
        }
        const target = (0, foundation_validation_1.requiredString)(input.target, 'target', 64);
        this.assertTarget(model.prediction_kind, target);
        const observations = this.observations(input.observations);
        const horizonSteps = (0, foundation_validation_1.boundedInteger)(input.horizon_steps, 'horizon_steps', 1, 36);
        const predictionId = this.resourceId(ctx, 'prediction.run', idempotencyKey);
        const featureBatchId = (0, domain_1.stableUuid)(`${predictionId}:feature-batch`);
        const result = await this.worker.runPrediction(ctx, {
            prediction_id: predictionId, tenant_id: ctx.tenantId, model_id: model.model_id,
            model_version: model.model_version, kind: model.prediction_kind, algorithm: model.algorithm,
            target, requested_at: (0, domain_1.nowIso)(), horizon_steps: horizonSteps, observations, calibration_bias: model.calibration_bias,
        });
        const timestamp = (0, domain_1.nowIso)();
        const dataHash = (0, domain_1.sha256)(observations);
        const featureBatch = {
            feature_batch_id: featureBatchId, tenant_id: ctx.tenantId, prediction_id: predictionId,
            observations, observation_count: observations.length, data_hash: dataHash,
            source: { kind: 'user_supplied_historical_observations', actor_id: ctx.actor.actor_id },
            created_at: timestamp, state_hash: '',
        };
        featureBatch.state_hash = this.stateHash(featureBatch);
        const run = {
            prediction_id: predictionId, tenant_id: ctx.tenantId, model_id: model.model_id,
            model_version: model.model_version, kind: model.prediction_kind, target, horizon_steps: horizonSteps,
            historical_feature_batch_id: featureBatchId,
            historical_data_hash: dataHash, historical_observation_count: observations.length,
            result: (0, foundation_validation_1.safeRecord)(result, 'prediction result', 1_000_000),
            result_sha256: (0, foundation_validation_1.requiredString)(result.result_sha256, 'result_sha256', 64),
            status: 'pending_outcome', observed_outcome: null, validation: null,
            version: 1, created_at: timestamp, created_by: ctx.actor.actor_id, updated_at: timestamp, state_hash: '',
        };
        run.state_hash = this.stateHash(run);
        const committed = await this.commit(ctx, [
            { kind: FEATURE_BATCH_KIND, id: featureBatchId, payload: featureBatch },
            { kind: PREDICTION_RUN_KIND, id: predictionId, payload: run },
        ], {
            action: 'decision.prediction.run', idempotencyKey,
            requestHash: (0, domain_1.sha256)({ action: 'prediction.run', model_id: model.model_id, model_version: model.model_version, input }),
            responseRef: predictionId, eventType: 'com.enterprisedigitaltwin.decision.prediction-created.v1',
            aggregateType: PREDICTION_RUN_KIND, aggregateId: predictionId, aggregateVersion: 1,
            expectedRecords: [
                { kind: FEATURE_BATCH_KIND, id: featureBatchId, absent: true },
                { kind: PREDICTION_RUN_KIND, id: predictionId, absent: true },
            ],
        });
        if (committed.replayed)
            return this.runView(await this.run(ctx.tenantId, predictionId), true);
        return this.runView(run);
    }
    async recordOutcome(ctx, predictionId, input, idempotencyKey, ifMatch) {
        this.assertPredictionRun(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['actual_values', 'observed_at', 'source'], 'Prediction outcome');
        const existing = await this.run(ctx.tenantId, predictionId);
        const actualValues = this.numberArray(input.actual_values, 'actual_values', 1, 36);
        if (actualValues.length !== existing.horizon_steps)
            throw (0, foundation_validation_1.invalid)('outcome_horizon_mismatch', 'actual_values must match the forecast horizon.');
        const source = (0, foundation_validation_1.safeRecord)(input.source, 'source', 16_000);
        const observedAt = (0, foundation_validation_1.isoTimestamp)(input.observed_at, 'observed_at');
        if (existing.status !== 'pending_outcome') {
            const prior = existing.validation ?? {};
            const exactReplay = existing.status === 'outcome_recorded'
                && JSON.stringify(existing.observed_outcome) === JSON.stringify(actualValues)
                && prior.outcome_observed_at === observedAt
                && prior.outcome_source_hash === (0, domain_1.sha256)(source);
            if (exactReplay)
                return this.runView(existing, true);
            throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'prediction_outcome_exists', 'An outcome has already been recorded.');
        }
        this.assertEtag(ifMatch, existing.state_hash);
        const updated = {
            ...existing, status: 'outcome_recorded', observed_outcome: actualValues,
            validation: { outcome_observed_at: observedAt, outcome_source_hash: (0, domain_1.sha256)(source) },
            version: existing.version + 1, updated_at: (0, domain_1.nowIso)(), state_hash: '',
        };
        updated.state_hash = this.stateHash(updated);
        const committed = await this.commit(ctx, [{ kind: PREDICTION_RUN_KIND, id: predictionId, payload: updated }], {
            action: 'decision.prediction.outcome.record', idempotencyKey,
            requestHash: (0, domain_1.sha256)({ action: 'prediction.outcome.record', prediction_id: predictionId, input }),
            responseRef: predictionId, eventType: 'com.enterprisedigitaltwin.decision.prediction-outcome-recorded.v1',
            aggregateType: PREDICTION_RUN_KIND, aggregateId: predictionId, aggregateVersion: updated.version,
            expectedRecords: [{ kind: PREDICTION_RUN_KIND, id: predictionId, expected: { version: existing.version, state_hash: existing.state_hash } }],
        });
        if (committed.replayed)
            return this.runView(await this.run(ctx.tenantId, predictionId), true);
        return this.runView(updated);
    }
    async validateOutcome(ctx, predictionId, input, idempotencyKey, ifMatch) {
        this.assertPredictionRun(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['decision', 'corrected_actual_values', 'expert_notes'], 'Prediction validation');
        const existing = await this.run(ctx.tenantId, predictionId);
        const decision = input.decision;
        if (!['confirmed', 'corrected'].includes(String(decision)))
            throw (0, foundation_validation_1.invalid)('invalid_validation_decision', 'decision must be confirmed or corrected.');
        const expertNotes = input.expert_notes === undefined ? null : (0, foundation_validation_1.requiredString)(input.expert_notes, 'expert_notes', 2_000);
        if (existing.status === 'validated' || existing.status === 'corrected') {
            const prior = existing.validation ?? {};
            const suppliedCorrection = decision === 'corrected'
                ? this.numberArray(input.corrected_actual_values, 'corrected_actual_values', existing.horizon_steps, existing.horizon_steps)
                : existing.observed_outcome;
            const exactReplay = prior.decision === decision
                && prior.expert_notes === expertNotes
                && JSON.stringify(existing.observed_outcome) === JSON.stringify(suppliedCorrection);
            if (exactReplay)
                return { ...this.runView(existing, true), model: await this.model(ctx.tenantId, existing.model_id) };
            throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'prediction_already_validated', 'The prediction outcome has already been validated.');
        }
        this.assertEtag(ifMatch, existing.state_hash);
        if (existing.status !== 'outcome_recorded' || !existing.observed_outcome)
            throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'prediction_outcome_not_ready', 'Record the real outcome before validation.');
        const actualValues = decision === 'corrected'
            ? this.numberArray(input.corrected_actual_values, 'corrected_actual_values', existing.horizon_steps, existing.horizon_steps)
            : existing.observed_outcome;
        const forecast = existing.result.forecast;
        if (!Array.isArray(forecast) || forecast.length !== existing.horizon_steps)
            throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'prediction_forecast_invalid', 'The stored forecast cannot be validated.');
        const metrics = await this.worker.validatePrediction(ctx, { forecast, actual_values: actualValues });
        const accuracyScore = (0, foundation_validation_1.score)(metrics.accuracy_score, 'accuracy_score');
        const meanBias = Number(metrics.mean_bias);
        if (!Number.isFinite(meanBias))
            throw new problem_1.ProblemException(common_1.HttpStatus.BAD_GATEWAY, 'prediction_validation_invalid', 'The worker returned invalid validation metrics.', true);
        const model = await this.model(ctx.tenantId, existing.model_id);
        if (model.model_version !== existing.model_version)
            throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'prediction_model_version_changed', 'The prediction model version no longer matches the run.');
        const validatedAt = (0, domain_1.nowIso)();
        const count = model.accuracy.validation_count;
        const updatedModel = {
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
        const updatedRun = {
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
            requestHash: (0, domain_1.sha256)({ action: 'prediction.validate', prediction_id: predictionId, input }),
            responseRef: predictionId, eventType: 'com.enterprisedigitaltwin.decision.prediction-validated.v1',
            aggregateType: PREDICTION_RUN_KIND, aggregateId: predictionId, aggregateVersion: updatedRun.version,
            expectedRecords: [
                { kind: PREDICTION_RUN_KIND, id: predictionId, expected: { version: existing.version, state_hash: existing.state_hash } },
                { kind: MODEL_KIND, id: model.model_id, expected: { version: model.version, state_hash: model.state_hash } },
                { kind: LEARNING_EVENT_KIND, id: learningId, absent: true },
            ],
        });
        if (committed.replayed)
            return this.runView(await this.run(ctx.tenantId, predictionId), true);
        return { ...this.runView(updatedRun), model: updatedModel };
    }
    async submitKnowledge(ctx, input, idempotencyKey) {
        this.assertPredictionRun(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['category', 'model_id', 'prediction_id', 'title', 'content', 'source', 'owner_id'], 'Prediction knowledge');
        const categories = ['historical_outcome', 'technical_specification', 'company_rule', 'correction', 'expert_knowledge'];
        const category = input.category;
        if (typeof category !== 'string' || !categories.includes(category))
            throw (0, foundation_validation_1.invalid)('invalid_knowledge_category', `category must be one of ${categories.join(', ')}.`);
        const modelId = (0, foundation_validation_1.optionalUuid)(input.model_id, 'model_id');
        const predictionId = (0, foundation_validation_1.optionalUuid)(input.prediction_id, 'prediction_id');
        if (modelId)
            await this.model(ctx.tenantId, modelId);
        if (predictionId)
            await this.run(ctx.tenantId, predictionId);
        const knowledgeId = this.resourceId(ctx, 'prediction.knowledge.submit', idempotencyKey);
        const knowledge = {
            knowledge_id: knowledgeId, tenant_id: ctx.tenantId, category: category,
            model_id: modelId, prediction_id: predictionId, title: (0, foundation_validation_1.requiredString)(input.title, 'title', 300),
            content: (0, foundation_validation_1.safeRecord)(input.content, 'content', 128_000), source: (0, foundation_validation_1.safeRecord)(input.source, 'source', 16_000),
            owner_id: (0, foundation_validation_1.optionalUuid)(input.owner_id, 'owner_id') ?? ctx.actor.actor_id,
            status: 'pending_review', created_at: (0, domain_1.nowIso)(), state_hash: '',
        };
        knowledge.state_hash = this.stateHash(knowledge);
        const committed = await this.commitCreate(ctx, KNOWLEDGE_KIND, knowledgeId, knowledge, {
            action: 'decision.prediction_knowledge.submit', idempotencyKey,
            requestHash: (0, domain_1.sha256)({ action: 'prediction_knowledge.submit', input }),
            eventType: 'com.enterprisedigitaltwin.decision.prediction-knowledge-submitted.v1', aggregateType: KNOWLEDGE_KIND,
        });
        if (committed.replayed)
            return { knowledge: await this.knowledge(ctx.tenantId, knowledgeId), replayed: true };
        return { knowledge };
    }
    async getPrediction(ctx, predictionId) {
        this.assertRead(ctx);
        return this.runView(await this.run(ctx.tenantId, predictionId));
    }
    observations(value) {
        if (!Array.isArray(value) || value.length < 3 || value.length > 10_000)
            throw (0, foundation_validation_1.invalid)('invalid_historical_data', 'observations must contain three to 10,000 items.');
        const timestamps = new Set();
        return value.map((raw, index) => {
            const item = (0, foundation_validation_1.plainRecord)(raw, `observations[${index}]`);
            (0, foundation_validation_1.assertExactKeys)(item, ['observed_at', 'value', 'features'], `observations[${index}]`);
            const observedAt = (0, foundation_validation_1.isoTimestamp)(item.observed_at, `observations[${index}].observed_at`);
            if (timestamps.has(observedAt))
                throw (0, foundation_validation_1.invalid)('duplicate_observation_time', 'Historical observations must have unique timestamps.');
            timestamps.add(observedAt);
            const number = typeof item.value === 'number' ? item.value : Number.NaN;
            if (!Number.isFinite(number) || Math.abs(number) > 1e12)
                throw (0, foundation_validation_1.invalid)('invalid_observation_value', 'Observation values must be finite and bounded.');
            const featureInput = (0, foundation_validation_1.safeRecord)(item.features ?? {}, `observations[${index}].features`, 16_000);
            if (Object.keys(featureInput).length > 50)
                throw (0, foundation_validation_1.invalid)('too_many_features', 'Each observation may contain at most 50 features.');
            const features = {};
            for (const [name, rawValue] of Object.entries(featureInput)) {
                if (!TARGET.test(name) || FORBIDDEN_TARGET.test(name) || typeof rawValue !== 'number' || !Number.isFinite(rawValue) || Math.abs(rawValue) > 1e12) {
                    throw (0, foundation_validation_1.invalid)('invalid_prediction_feature', 'Features must be bounded aggregate numeric identifiers.');
                }
                features[name] = rawValue;
            }
            return { observed_at: observedAt, value: number, features };
        });
    }
    assertTarget(kind, target) {
        if (kind === 'workforce' && !['headcount', 'workforce_capacity', 'open_positions'].includes(target)) {
            throw (0, foundation_validation_1.invalid)('workforce_prediction_prohibited', 'Workforce prediction is limited to aggregate headcount, capacity, or open positions.');
        }
        if (!TARGET.test(target) || FORBIDDEN_TARGET.test(target))
            throw (0, foundation_validation_1.invalid)('invalid_prediction_target', 'The target must be an aggregate metric identifier.');
    }
    descriptors(value, field) {
        if (!Array.isArray(value) || value.length < 1 || value.length > 50)
            throw (0, foundation_validation_1.invalid)('invalid_model_descriptor', `${field} must contain one to 50 descriptors.`);
        return value.map((item, index) => (0, foundation_validation_1.safeRecord)(item, `${field}[${index}]`, 16_000));
    }
    numberArray(value, field, minimum, maximum) {
        if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
            throw (0, foundation_validation_1.invalid)('invalid_number_array', `${field} must contain ${minimum === maximum ? minimum : `${minimum} to ${maximum}`} values.`);
        return value.map((item, index) => {
            if (typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 1e12)
                throw (0, foundation_validation_1.invalid)('invalid_number', `${field}[${index}] must be finite and bounded.`);
            return item;
        });
    }
    modelKind(value) {
        if (typeof value !== 'string' || !decision_intelligence_types_1.MODEL_KINDS.includes(value))
            throw (0, foundation_validation_1.invalid)('invalid_model_kind', `kind must be one of ${decision_intelligence_types_1.MODEL_KINDS.join(', ')}.`);
        return value;
    }
    predictionKind(value) {
        if (typeof value !== 'string' || !decision_intelligence_types_1.PREDICTION_KINDS.includes(value))
            throw (0, foundation_validation_1.invalid)('invalid_prediction_kind', `prediction_kind must be one of ${decision_intelligence_types_1.PREDICTION_KINDS.join(', ')}.`);
        return value;
    }
    modelStatus(value) {
        if (!['draft', 'active', 'retired'].includes(String(value)))
            throw (0, foundation_validation_1.invalid)('invalid_model_status', 'status must be draft, active, or retired.');
        return value;
    }
    async model(tenantId, id) {
        if (!foundation_validation_1.UUID_PATTERN.test(id))
            throw (0, foundation_validation_1.notFound)();
        const model = await this.database.get(tenantId, MODEL_KIND, id);
        if (!model || model.tenant_id !== tenantId)
            throw (0, foundation_validation_1.notFound)();
        return model;
    }
    async run(tenantId, id) {
        if (!foundation_validation_1.UUID_PATTERN.test(id))
            throw (0, foundation_validation_1.notFound)();
        const run = await this.database.get(tenantId, PREDICTION_RUN_KIND, id);
        if (!run || run.tenant_id !== tenantId)
            throw (0, foundation_validation_1.notFound)();
        return run;
    }
    async knowledge(tenantId, id) {
        const record = await this.database.get(tenantId, KNOWLEDGE_KIND, id);
        if (!record || record.tenant_id !== tenantId)
            throw (0, foundation_validation_1.notFound)();
        return record;
    }
    modelView(model, replayed = false) {
        return { model, etag: (0, domain_1.etag)(model.state_hash), ...(replayed ? { replayed: true } : {}) };
    }
    runView(run, replayed = false) {
        return { prediction: run, etag: (0, domain_1.etag)(run.state_hash), ...(replayed ? { replayed: true } : {}) };
    }
    assertEtag(ifMatch, stateHash) {
        if (!ifMatch)
            throw new problem_1.ProblemException(common_1.HttpStatus.PRECONDITION_REQUIRED, 'if_match_required', 'If-Match is required.');
        if (ifMatch !== (0, domain_1.etag)(stateHash))
            throw new problem_1.ProblemException(common_1.HttpStatus.PRECONDITION_FAILED, 'prediction_precondition_failed', 'The prediction changed before the operation.');
    }
    assertRead(ctx) {
        if (ctx.actor.capabilities.includes('connector.admin') || ctx.actor.capabilities.includes('simulation.run') || ctx.actor.capabilities.includes('scenario.create'))
            return;
        throw new problem_1.ProblemException(common_1.HttpStatus.FORBIDDEN, 'prediction_read_denied', 'Prediction access is not permitted.');
    }
    assertPredictionRun(ctx) {
        if (ctx.actor.capabilities.includes('connector.admin') || ctx.actor.capabilities.includes('simulation.run'))
            return;
        throw new problem_1.ProblemException(common_1.HttpStatus.FORBIDDEN, 'prediction_run_denied', 'Prediction execution or feedback is not permitted.');
    }
    assertModelAdmin(ctx) {
        if (ctx.actor.capabilities.includes('connector.admin'))
            return;
        throw new problem_1.ProblemException(common_1.HttpStatus.FORBIDDEN, 'model_registry_write_denied', 'Model registration requires tenant integration administration.');
    }
    resourceId(ctx, operation, key) {
        return (0, domain_1.stableUuid)(`${decision_intelligence_types_1.DECISION_INTELLIGENCE_SCHEMA_VERSION}:${ctx.tenantId}:${ctx.actor.actor_id}:${operation}:${key}`);
    }
    stateHash(value) {
        const { state_hash: _stateHash, ...domain } = value;
        return (0, domain_1.sha256)(domain);
    }
    round(value) { return Math.round(value * 1e8) / 1e8; }
    commitCreate(ctx, kind, id, payload, mutation) {
        return this.commit(ctx, [{ kind, id, payload }], {
            ...mutation, responseRef: id, aggregateId: id, aggregateVersion: 1,
            expectedRecords: [{ kind, id, absent: true }],
        });
    }
    async commit(ctx, records, mutation) {
        const audit = {
            audit_id: (0, domain_1.newId)(), tenant_sequence: 0, action: mutation.action, actor_id: ctx.actor.actor_id,
            resource_type: mutation.aggregateType, resource_id: mutation.aggregateId, occurred_at: (0, domain_1.nowIso)(),
            request_id: ctx.requestId, trace_id: (0, domain_1.traceId)(), details_hash: (0, domain_1.sha256)({ action: mutation.action, aggregate_id: mutation.aggregateId }),
            previous_hash: '', event_hash: '',
        };
        try {
            const result = await this.database.commitEventMutation(ctx.tenantId, records, audit, {
                eventId: (0, domain_1.stableUuid)(`${ctx.tenantId}:${mutation.action}:${mutation.idempotencyKey}:outbox`),
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
        }
        catch (error) {
            if (error instanceof database_service_1.DatabaseMutationConflict)
                throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, error.code, error.message, error.code === 'idempotency_request_in_progress');
            throw error;
        }
    }
};
exports.PredictiveEngineService = PredictiveEngineService;
exports.PredictiveEngineService = PredictiveEngineService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService, decision_worker_service_1.DecisionWorkerService])
], PredictiveEngineService);
//# sourceMappingURL=predictive-engine.service.js.map