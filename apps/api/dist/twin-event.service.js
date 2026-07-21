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
exports.TwinEventService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("./database.service");
const data_foundation_types_1 = require("./data-foundation.types");
const domain_1 = require("./domain");
const foundation_validation_1 = require("./foundation-validation");
const problem_1 = require("./problem");
const twin_graph_service_1 = require("./twin-graph.service");
const FOUNDATION_METADATA_KIND = 'twin_data_foundation_metadata';
const EVENT_KIND = 'twin_event';
const DATA_POINT_KIND = 'twin_data_point';
const MAX_EVENT_DETAILS_BYTES = 64 * 1024;
const MAX_DATA_VALUE_BYTES = 64 * 1024;
const MAX_AFFECTED_NODES = 25;
const MAX_QUALITY_CANDIDATES = 500;
const MAX_CONFLICTS = 20;
const MAX_EVENT_PAGE_SIZE = 100;
const CUSTOM_EVENT_TYPE = /^[a-z][a-z0-9.-]{1,63}\/[A-Z][A-Za-z0-9]{0,63}$/;
const DAY_SECONDS = 24 * 60 * 60;
const YEAR_SECONDS = 365 * DAY_SECONDS;
let TwinEventService = class TwinEventService {
    database;
    graph;
    constructor(database, graph) {
        this.database = database;
        this.graph = graph;
    }
    eventTypes(ctx) {
        this.assertRead(ctx);
        return {
            items: data_foundation_types_1.DEFAULT_EVENT_TYPES.map((type) => ({ ...type })),
            custom_type_id_pattern: 'publisher.package/Type',
            schema_version: data_foundation_types_1.DATA_FOUNDATION_SCHEMA_VERSION,
        };
    }
    async createEvent(ctx, input, idempotencyKey) {
        this.assertWrite(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, [
            'type_id', 'category', 'occurred_at', 'source', 'affected_node_ids', 'severity', 'outcome',
            'owner_id', 'classification', 'details', 'confidence_score', 'reliability_score',
            'freshness_ttl_seconds', 'propagation',
        ], 'Operational event');
        const state = await this.state(ctx.tenantId);
        const eventId = this.eventId(ctx, idempotencyKey);
        const dataPointId = this.dataPointId(ctx, 'event', idempotencyKey);
        const { typeId, category } = this.eventType(input.type_id, input.category);
        const occurredAt = (0, foundation_validation_1.isoTimestamp)(input.occurred_at, 'occurred_at');
        const details = (0, foundation_validation_1.safeRecord)(input.details ?? {}, 'details', MAX_EVENT_DETAILS_BYTES);
        const affectedNodeIds = this.affectedNodeIds(input.affected_node_ids);
        const affectedClassifications = await this.affectedNodeClassifications(ctx, affectedNodeIds);
        const severity = this.severity(input.severity ?? 'info');
        const outcome = this.outcome(input.outcome ?? 'observed');
        const reliabilityScore = (0, foundation_validation_1.score)(input.reliability_score, 'reliability_score', 0.8);
        const declaredConfidenceScore = (0, foundation_validation_1.score)(input.confidence_score, 'confidence_score', 1);
        const freshnessTtlSeconds = (0, foundation_validation_1.boundedInteger)(input.freshness_ttl_seconds, 'freshness_ttl_seconds', 60, YEAR_SECONDS, DAY_SECONDS);
        const source = this.source(input.source, (0, domain_1.sha256)(details), occurredAt);
        const propagation = await this.propagate(ctx, affectedNodeIds, typeId, category, severity, outcome, this.propagationOptions(input.propagation));
        const requiredClassification = this.maximumClassification([
            ...affectedClassifications,
            ...this.propagationClassifications(propagation),
        ]);
        const eventClassification = this.classificationAtLeast(input.classification, requiredClassification);
        const draft = {
            dataPointId,
            eventId,
            subjectNodeId: null,
            subjectKey: `event-targets:${(0, domain_1.sha256)([...affectedNodeIds].sort())}`,
            metric: typeId,
            value: details,
            source,
            ownerId: (0, foundation_validation_1.optionalUuid)(input.owner_id, 'owner_id'),
            reliabilityScore,
            declaredConfidenceScore,
            freshnessTtlSeconds,
            classification: eventClassification,
        };
        const point = await this.buildDataPoint(ctx, draft);
        const event = {
            event_id: eventId,
            tenant_id: ctx.tenantId,
            type_id: typeId,
            category,
            occurred_at: occurredAt,
            recorded_at: (0, domain_1.nowIso)(),
            source,
            affected_node_ids: affectedNodeIds,
            severity,
            outcome,
            owner_id: draft.ownerId,
            classification: eventClassification,
            data_point_id: point.data_point_id,
            confidence_score: point.confidence_score,
            data_quality: point.data_quality,
            propagation,
            details,
            state_hash: '',
        };
        event.state_hash = this.eventHash(event);
        const nextMetadata = this.nextMetadata(state);
        const committed = await this.commit(ctx, state, nextMetadata, [
            { kind: DATA_POINT_KIND, id: point.data_point_id, payload: point },
            { kind: EVENT_KIND, id: event.event_id, payload: event },
        ], {
            action: 'twin.event.record',
            requestHash: (0, domain_1.sha256)({ action: 'event.record', input }),
            idempotencyKey,
            responseRef: event.event_id,
            eventId: event.event_id,
            eventType: 'com.enterprisedigitaltwin.twin.operational-event-recorded.v1',
            aggregateType: 'twin_event',
            aggregateId: event.event_id,
            aggregateVersion: 1,
            payload: {
                tenant_id: ctx.tenantId,
                event_id: event.event_id,
                data_point_id: point.data_point_id,
                graph_version: propagation.graph_version,
                history_event_id: event.event_id,
                outbox_position: 0,
            },
        });
        if (committed.replayed) {
            const existing = await this.database.get(ctx.tenantId, EVENT_KIND, event.event_id);
            if (!existing)
                throw new problem_1.ProblemException(common_1.HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original event response is unavailable.', true);
            return this.eventView(existing, true);
        }
        return this.eventView(event);
    }
    async createDataPoint(ctx, input, idempotencyKey) {
        this.assertWrite(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, [
            'subject_node_id', 'metric', 'value', 'source', 'owner_id', 'classification',
            'confidence_score', 'reliability_score', 'freshness_ttl_seconds',
        ], 'Data point');
        const state = await this.state(ctx.tenantId);
        const dataPointId = this.dataPointId(ctx, 'direct', idempotencyKey);
        const subjectNodeId = (0, foundation_validation_1.optionalUuid)(input.subject_node_id, 'subject_node_id');
        const subjectClassification = subjectNodeId ? await this.nodeClassification(ctx, subjectNodeId) : undefined;
        const value = (0, foundation_validation_1.safeJsonValue)(input.value, 'value', MAX_DATA_VALUE_BYTES);
        const metric = (0, foundation_validation_1.requiredString)(input.metric, 'metric', 160);
        const source = this.source(input.source, (0, domain_1.sha256)(value), (0, domain_1.nowIso)());
        const pointClassification = this.classificationAtLeast(input.classification, subjectClassification ?? 'internal');
        const draft = {
            dataPointId,
            eventId: null,
            subjectNodeId,
            subjectKey: subjectNodeId ?? `source:${source.source_system}:${source.source_record_id}`,
            metric,
            value,
            source,
            ownerId: (0, foundation_validation_1.optionalUuid)(input.owner_id, 'owner_id'),
            reliabilityScore: (0, foundation_validation_1.score)(input.reliability_score, 'reliability_score', 0.8),
            declaredConfidenceScore: (0, foundation_validation_1.score)(input.confidence_score, 'confidence_score', 1),
            freshnessTtlSeconds: (0, foundation_validation_1.boundedInteger)(input.freshness_ttl_seconds, 'freshness_ttl_seconds', 60, YEAR_SECONDS, DAY_SECONDS),
            classification: pointClassification,
        };
        const point = await this.buildDataPoint(ctx, draft);
        const nextMetadata = this.nextMetadata(state);
        const committed = await this.commit(ctx, state, nextMetadata, [{ kind: DATA_POINT_KIND, id: point.data_point_id, payload: point }], {
            action: 'twin.data_point.record',
            requestHash: (0, domain_1.sha256)({ action: 'data_point.record', input }),
            idempotencyKey,
            responseRef: point.data_point_id,
            eventId: (0, domain_1.stableUuid)(`twin-data-point-outbox:${ctx.tenantId}:${ctx.actor.actor_id}:${idempotencyKey}`),
            eventType: 'com.enterprisedigitaltwin.twin.data-point-recorded.v1',
            aggregateType: 'twin_data_point',
            aggregateId: point.data_point_id,
            aggregateVersion: 1,
            payload: {
                tenant_id: ctx.tenantId,
                data_point_id: point.data_point_id,
                history_event_id: point.data_point_id,
                outbox_position: 0,
            },
        });
        if (committed.replayed) {
            const existing = await this.database.get(ctx.tenantId, DATA_POINT_KIND, point.data_point_id);
            if (!existing)
                throw new problem_1.ProblemException(common_1.HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original data-point response is unavailable.', true);
            return this.dataPointView(existing, true);
        }
        return this.dataPointView(point);
    }
    async listEvents(ctx, input) {
        this.assertRead(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['type_id', 'category', 'severity', 'outcome', 'limit', 'cursor'], 'Event list');
        const filters = {};
        if (input.type_id !== undefined)
            filters.type_id = (0, foundation_validation_1.requiredString)(input.type_id, 'type_id', 128);
        if (input.category !== undefined)
            filters.category = this.category(input.category);
        if (input.severity !== undefined)
            filters.severity = this.severity(input.severity);
        if (input.outcome !== undefined)
            filters.outcome = this.outcome(input.outcome);
        const limit = (0, foundation_validation_1.boundedInteger)(input.limit, 'limit', 1, MAX_EVENT_PAGE_SIZE, 50);
        const cursor = input.cursor === undefined ? undefined : (0, foundation_validation_1.requiredString)(input.cursor, 'cursor', 2_000);
        const page = await this.page(ctx, EVENT_KIND, { filters, limit: Math.min(500, limit * 5), cursor });
        const items = page.items.filter((event) => this.canReadClassification(ctx, event.classification)).slice(0, limit);
        return {
            items: items.map((event) => this.publicEvent(event)),
            has_more: page.nextCursor !== null || page.items.filter((event) => this.canReadClassification(ctx, event.classification)).length > limit,
            next_cursor: page.nextCursor,
            data_watermark: this.watermark(),
        };
    }
    async getEvent(ctx, eventId) {
        this.assertRead(ctx);
        if (!foundation_validation_1.UUID_PATTERN.test(eventId))
            throw (0, foundation_validation_1.notFound)();
        const event = await this.database.get(ctx.tenantId, EVENT_KIND, eventId);
        if (!event || event.tenant_id !== ctx.tenantId || !this.canReadClassification(ctx, event.classification))
            throw (0, foundation_validation_1.notFound)();
        return this.eventView(event);
    }
    async analyzeEventImpact(ctx, eventId, input) {
        this.assertRead(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['max_depth', 'max_impacts'], 'Event impact analysis');
        if (!foundation_validation_1.UUID_PATTERN.test(eventId))
            throw (0, foundation_validation_1.notFound)();
        const event = await this.database.get(ctx.tenantId, EVENT_KIND, eventId);
        if (!event || event.tenant_id !== ctx.tenantId || !this.canReadClassification(ctx, event.classification))
            throw (0, foundation_validation_1.notFound)();
        return {
            event_id: event.event_id,
            persisted_propagation: this.publicPropagation(event.propagation),
            current_propagation: await this.propagate(ctx, event.affected_node_ids, event.type_id, event.category, event.severity, event.outcome, this.propagationOptions(input)),
            immutable_event: true,
        };
    }
    async listDataPoints(ctx, input) {
        this.assertRead(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['subject_node_id', 'metric', 'limit', 'cursor'], 'Data-point list');
        const filters = {};
        if (input.subject_node_id !== undefined)
            filters.subject_node_id = (0, foundation_validation_1.uuid)(input.subject_node_id, 'subject_node_id');
        if (input.metric !== undefined)
            filters.metric = (0, foundation_validation_1.requiredString)(input.metric, 'metric', 160);
        const limit = (0, foundation_validation_1.boundedInteger)(input.limit, 'limit', 1, MAX_EVENT_PAGE_SIZE, 50);
        const cursor = input.cursor === undefined ? undefined : (0, foundation_validation_1.requiredString)(input.cursor, 'cursor', 2_000);
        const page = await this.page(ctx, DATA_POINT_KIND, { filters, limit: Math.min(500, limit * 5), cursor });
        const items = page.items.filter((point) => this.canReadClassification(ctx, point.classification)).slice(0, limit);
        return {
            items: items.map((point) => this.publicDataPoint(point)),
            has_more: page.nextCursor !== null || page.items.filter((point) => this.canReadClassification(ctx, point.classification)).length > limit,
            next_cursor: page.nextCursor,
            data_watermark: this.watermark(),
        };
    }
    async getDataPoint(ctx, dataPointId) {
        this.assertRead(ctx);
        if (!foundation_validation_1.UUID_PATTERN.test(dataPointId))
            throw (0, foundation_validation_1.notFound)();
        const point = await this.database.get(ctx.tenantId, DATA_POINT_KIND, dataPointId);
        if (!point || point.tenant_id !== ctx.tenantId || !this.canReadClassification(ctx, point.classification))
            throw (0, foundation_validation_1.notFound)();
        return this.dataPointView(point);
    }
    async buildDataPoint(ctx, draft) {
        const valueHash = (0, domain_1.sha256)(draft.value);
        const sourceFingerprint = (0, domain_1.sha256)({
            source_system: draft.source.source_system,
            source_record_id: draft.source.source_record_id,
            source_revision: draft.source.source_revision ?? null,
        });
        const observedAt = draft.source.observed_at;
        const quality = await this.assessQuality(ctx.tenantId, {
            dataPointId: draft.dataPointId,
            sourceFingerprint,
            valueHash,
            subjectKey: draft.subjectKey,
            metric: draft.metric,
            observedAt,
            freshnessTtlSeconds: draft.freshnessTtlSeconds,
            reliabilityScore: draft.reliabilityScore,
            declaredConfidenceScore: draft.declaredConfidenceScore,
        });
        const point = {
            data_point_id: draft.dataPointId,
            tenant_id: ctx.tenantId,
            event_id: draft.eventId,
            subject_node_id: draft.subjectNodeId,
            subject_key: draft.subjectKey,
            metric: draft.metric,
            metric_key: draft.metric.toLocaleLowerCase('en-US'),
            value: draft.value,
            source: draft.source,
            source_fingerprint: sourceFingerprint,
            owner_id: draft.ownerId,
            observed_at: observedAt,
            last_updated_at: (0, domain_1.nowIso)(),
            reliability_score: draft.reliabilityScore,
            confidence_score: quality.confidence_score,
            freshness_ttl_seconds: draft.freshnessTtlSeconds,
            classification: draft.classification,
            value_hash: valueHash,
            data_quality: quality,
            state_hash: '',
        };
        point.state_hash = this.dataPointHash(point);
        return point;
    }
    async assessQuality(tenantId, input) {
        const metricKey = input.metric.toLocaleLowerCase('en-US');
        const [sourcePage, subjectPage] = await Promise.all([
            this.database.listPage(tenantId, DATA_POINT_KIND, {
                filters: { source_fingerprint: input.sourceFingerprint },
                limit: MAX_QUALITY_CANDIDATES,
            }),
            this.database.listPage(tenantId, DATA_POINT_KIND, {
                filters: { subject_key: input.subjectKey, metric_key: metricKey },
                limit: MAX_QUALITY_CANDIDATES,
            }),
        ]);
        const candidates = new Map();
        for (const point of [...sourcePage.items, ...subjectPage.items]) {
            if (point.data_point_id !== input.dataPointId && point.tenant_id === tenantId)
                candidates.set(point.data_point_id, point);
        }
        const duplicate = [...candidates.values()]
            .filter((point) => point.source_fingerprint === input.sourceFingerprint && point.value_hash === input.valueHash)
            .sort((left, right) => left.last_updated_at.localeCompare(right.last_updated_at) || left.data_point_id.localeCompare(right.data_point_id))[0];
        const observationTime = Date.parse(input.observedAt);
        const conflicts = [...candidates.values()]
            .filter((point) => point.subject_key === input.subjectKey && point.metric_key === metricKey)
            .filter((point) => point.value_hash !== input.valueHash)
            .filter((point) => Math.abs(Date.parse(point.observed_at) - observationTime) <= DAY_SECONDS * 1_000)
            .sort((left, right) => right.observed_at.localeCompare(left.observed_at) || left.data_point_id.localeCompare(right.data_point_id))
            .slice(0, MAX_CONFLICTS)
            .map((point) => point.data_point_id);
        const assessedAt = (0, domain_1.nowIso)();
        const staleAfter = new Date(observationTime + input.freshnessTtlSeconds * 1_000).toISOString();
        const stale = Date.parse(assessedAt) > Date.parse(staleAfter);
        let confidence = input.declaredConfidenceScore * 0.65 + input.reliabilityScore * 0.35;
        if (duplicate)
            confidence *= 0.95;
        if (conflicts.length)
            confidence *= 0.6;
        if (stale)
            confidence *= 0.7;
        const rationale = [
            `Declared confidence ${this.round(input.declaredConfidenceScore)} combined with source reliability ${this.round(input.reliabilityScore)}.`,
            duplicate ? `Duplicate of ${duplicate.data_point_id}; retained as an immutable observation linked to the first matching source revision.` : 'No matching source fingerprint and value hash was found.',
            conflicts.length ? `${conflicts.length} conflicting observation(s) share this subject and metric within the one-day conflict window.` : 'No conflicting value was found in the one-day subject-and-metric window.',
            stale ? `Observation is stale after ${staleAfter}.` : `Observation remains fresh until ${staleAfter}.`,
        ];
        return {
            assessed_at: assessedAt,
            method: 'deterministic_provenance_quality/1.0.0',
            source_fingerprint: input.sourceFingerprint,
            value_hash: input.valueHash,
            duplicate_of: duplicate?.data_point_id ?? null,
            conflicts_with: conflicts,
            stale,
            stale_after: staleAfter,
            confidence_score: this.round(Math.max(0, Math.min(1, confidence))),
            rationale,
        };
    }
    async propagate(ctx, affectedNodeIds, typeId, category, severity, outcome, options) {
        const perRootLimit = Math.max(1, Math.floor(options.maxImpacts / affectedNodeIds.length));
        const analyses = await Promise.all(affectedNodeIds.map((nodeId) => this.graph.analyzeImpact(ctx, {
            node_id: nodeId,
            change: { kind: 'operational_event', type_id: typeId, category, severity, outcome },
            max_depth: options.maxDepth,
            max_impacts: perRootLimit,
        })));
        const impacts = new Map();
        let graphVersion = 0;
        let truncated = false;
        for (const analysis of analyses) {
            if (typeof analysis.graph_version === 'number')
                graphVersion = Math.max(graphVersion, analysis.graph_version);
            truncated ||= analysis.truncated === true;
            const rawImpacts = [
                ...(Array.isArray(analysis.direct_impacts) ? analysis.direct_impacts : []),
                ...(Array.isArray(analysis.downstream_impacts) ? analysis.downstream_impacts : []),
            ];
            for (const rawImpact of rawImpacts) {
                const impact = this.propagationImpact(rawImpact);
                if (!impact)
                    continue;
                const existing = impacts.get(impact.node_id);
                if (!existing || impact.score > existing.score || (impact.score === existing.score && impact.depth < existing.depth)) {
                    impacts.set(impact.node_id, impact);
                }
            }
        }
        const ordered = [...impacts.values()]
            .sort((left, right) => right.score - left.score || left.depth - right.depth || left.node_id.localeCompare(right.node_id))
            .slice(0, options.maxImpacts);
        if (impacts.size > ordered.length)
            truncated = true;
        return {
            calculated_at: (0, domain_1.nowIso)(),
            graph_version: graphVersion,
            max_depth: options.maxDepth,
            max_impacts: options.maxImpacts,
            impacts: ordered,
            truncated,
            method: {
                name: 'bounded_weighted_dependency_propagation',
                version: '1.0.0',
                note: 'Scores express graph-structural exposure from declared relationship attributes; they are not causal proof or a financial forecast.',
            },
        };
    }
    propagationImpact(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return undefined;
        const record = value;
        if (typeof record.node_id !== 'string' || !foundation_validation_1.UUID_PATTERN.test(record.node_id)
            || typeof record.depth !== 'number' || !Number.isInteger(record.depth)
            || typeof record.score !== 'number' || !Number.isFinite(record.score)
            || !Array.isArray(record.path) || !record.path.every((item) => typeof item === 'string' && foundation_validation_1.UUID_PATTERN.test(item))
            || !Array.isArray(record.relationship_path) || !record.relationship_path.every((item) => typeof item === 'string' && foundation_validation_1.UUID_PATTERN.test(item))
            || typeof record.cumulative_cost !== 'number' || !Number.isFinite(record.cumulative_cost)
            || !record.node || typeof record.node !== 'object' || Array.isArray(record.node))
            return undefined;
        return {
            node_id: record.node_id,
            depth: record.depth,
            score: this.round(record.score),
            path: [...record.path],
            relationship_path: [...record.relationship_path],
            cumulative_cost: this.round(record.cumulative_cost),
            node: structuredClone(record.node),
        };
    }
    source(raw, contentHash, fallbackObservedAt) {
        const source = (0, foundation_validation_1.plainRecord)(raw, 'source');
        (0, foundation_validation_1.assertExactKeys)(source, ['source_system', 'source_record_id', 'source_revision', 'connector_id', 'observed_at', 'locator'], 'Source');
        const connectorId = source.connector_id === undefined ? undefined : (0, foundation_validation_1.uuid)(source.connector_id, 'source.connector_id');
        const locator = (0, foundation_validation_1.safeLocator)(source.locator, 'source.locator');
        return {
            source_system: (0, foundation_validation_1.requiredString)(source.source_system, 'source.source_system', 120),
            source_record_id: (0, foundation_validation_1.requiredString)(source.source_record_id, 'source.source_record_id', 500),
            ...((0, foundation_validation_1.optionalString)(source.source_revision, 'source.source_revision', 200) ? { source_revision: (0, foundation_validation_1.optionalString)(source.source_revision, 'source.source_revision', 200) } : {}),
            ...(connectorId ? { connector_id: connectorId } : {}),
            observed_at: (0, foundation_validation_1.isoTimestamp)(source.observed_at, 'source.observed_at', fallbackObservedAt),
            content_hash: contentHash,
            ...(locator ? { locator } : {}),
        };
    }
    eventType(rawType, rawCategory) {
        const supplied = (0, foundation_validation_1.requiredString)(rawType, 'type_id', 128);
        const standard = data_foundation_types_1.DEFAULT_EVENT_TYPES.find((item) => (item.type_id === supplied
            || item.type_id.slice(item.type_id.lastIndexOf('/') + 1).toLocaleLowerCase('en-US') === supplied.toLocaleLowerCase('en-US')));
        if (standard) {
            const category = rawCategory === undefined ? standard.category : this.category(rawCategory);
            if (category !== standard.category)
                throw (0, foundation_validation_1.invalid)('event_category_mismatch', `${standard.type_id} must use the ${standard.category} category.`);
            return { typeId: standard.type_id, category };
        }
        if (!CUSTOM_EVENT_TYPE.test(supplied) || supplied.startsWith('edt.event/')) {
            throw (0, foundation_validation_1.invalid)('invalid_event_type', 'Custom event type IDs must be namespaced as publisher.package/Type and cannot shadow edt.event/.');
        }
        if (rawCategory === undefined)
            throw (0, foundation_validation_1.invalid)('event_category_required', 'Custom event types must declare one of the supported categories.');
        return { typeId: supplied, category: this.category(rawCategory) };
    }
    category(value) {
        if (typeof value !== 'string' || !data_foundation_types_1.EVENT_CATEGORIES.includes(value)) {
            throw (0, foundation_validation_1.invalid)('invalid_event_category', `category must be one of ${data_foundation_types_1.EVENT_CATEGORIES.join(', ')}.`);
        }
        return value;
    }
    severity(value) {
        if (typeof value !== 'string' || !data_foundation_types_1.EVENT_SEVERITIES.includes(value)) {
            throw (0, foundation_validation_1.invalid)('invalid_event_severity', `severity must be one of ${data_foundation_types_1.EVENT_SEVERITIES.join(', ')}.`);
        }
        return value;
    }
    outcome(value) {
        if (typeof value !== 'string' || !data_foundation_types_1.EVENT_OUTCOMES.includes(value)) {
            throw (0, foundation_validation_1.invalid)('invalid_event_outcome', `outcome must be one of ${data_foundation_types_1.EVENT_OUTCOMES.join(', ')}.`);
        }
        return value;
    }
    affectedNodeIds(value) {
        const nodeIds = (0, foundation_validation_1.stringArray)(value, 'affected_node_ids', MAX_AFFECTED_NODES, 64);
        if (!nodeIds.length)
            throw (0, foundation_validation_1.invalid)('affected_nodes_required', 'affected_node_ids must contain at least one graph node ID.');
        return nodeIds.map((nodeId, index) => (0, foundation_validation_1.uuid)(nodeId, `affected_node_ids[${index}]`));
    }
    async affectedNodeClassifications(ctx, nodeIds) {
        return Promise.all(nodeIds.map((nodeId) => this.nodeClassification(ctx, nodeId)));
    }
    async nodeClassification(ctx, nodeId) {
        const response = await this.graph.getNode(ctx, nodeId);
        const node = response.node;
        if (!node || typeof node !== 'object' || Array.isArray(node))
            throw (0, foundation_validation_1.notFound)();
        const metadata = node.metadata;
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
            throw (0, foundation_validation_1.notFound)();
        return (0, foundation_validation_1.classification)(metadata.classification, 'node.metadata.classification');
    }
    propagationOptions(value) {
        if (value === undefined)
            return { maxDepth: 4, maxImpacts: 100 };
        const options = (0, foundation_validation_1.plainRecord)(value, 'propagation');
        (0, foundation_validation_1.assertExactKeys)(options, ['max_depth', 'max_impacts'], 'Propagation');
        return {
            maxDepth: (0, foundation_validation_1.boundedInteger)(options.max_depth, 'propagation.max_depth', 1, 6, 4),
            maxImpacts: (0, foundation_validation_1.boundedInteger)(options.max_impacts, 'propagation.max_impacts', 1, 250, 100),
        };
    }
    propagationClassifications(propagation) {
        return propagation.impacts.map((impact) => {
            const nodeClassification = impact.node.classification;
            return (0, foundation_validation_1.classification)(nodeClassification, 'propagation.node.classification');
        });
    }
    classificationAtLeast(value, minimum) {
        const supplied = (0, foundation_validation_1.classification)(value, 'classification', minimum);
        if (this.classificationRank(supplied) < this.classificationRank(minimum)) {
            throw (0, foundation_validation_1.invalid)('classification_weakened', 'Classification cannot be less restrictive than an affected or propagated graph node.');
        }
        return supplied;
    }
    maximumClassification(values) {
        return values.reduce((current, item) => this.classificationRank(item) > this.classificationRank(current) ? item : current, 'public');
    }
    classificationRank(value) {
        return ['public', 'internal', 'confidential', 'restricted'].indexOf(value);
    }
    async state(tenantId) {
        const metadataId = this.metadataId(tenantId);
        const metadata = await this.database.get(tenantId, FOUNDATION_METADATA_KIND, metadataId);
        if (metadata?.tenant_id === tenantId && metadata.metadata_id === metadataId)
            return { metadata, persisted: true };
        return {
            persisted: false,
            metadata: {
                metadata_id: metadataId,
                tenant_id: tenantId,
                schema_version: data_foundation_types_1.DATA_FOUNDATION_SCHEMA_VERSION,
                version: 0,
                updated_at: (0, domain_1.nowIso)(),
            },
        };
    }
    nextMetadata(state) {
        return { ...state.metadata, version: state.metadata.version + 1, updated_at: (0, domain_1.nowIso)() };
    }
    async commit(ctx, state, nextMetadata, records, mutation) {
        const audit = {
            audit_id: (0, domain_1.newId)(),
            tenant_sequence: 0,
            action: mutation.action,
            actor_id: ctx.actor.actor_id,
            resource_type: mutation.aggregateType,
            resource_id: mutation.aggregateId,
            occurred_at: (0, domain_1.nowIso)(),
            request_id: ctx.requestId,
            trace_id: (0, domain_1.traceId)(),
            details_hash: (0, domain_1.sha256)({ action: mutation.action, aggregate_id: mutation.aggregateId, aggregate_version: mutation.aggregateVersion, response_ref: mutation.responseRef }),
            previous_hash: '',
            event_hash: '',
        };
        try {
            const result = await this.database.commitEventMutation(ctx.tenantId, [{ kind: FOUNDATION_METADATA_KIND, id: nextMetadata.metadata_id, payload: nextMetadata }, ...records], audit, {
                eventId: mutation.eventId,
                eventType: mutation.eventType,
                aggregateType: mutation.aggregateType,
                aggregateId: mutation.aggregateId,
                aggregateVersion: mutation.aggregateVersion,
                payload: mutation.payload,
            }, {
                idempotency: {
                    operation: `${ctx.actor.actor_id}:${mutation.action}`,
                    key: mutation.idempotencyKey,
                    requestHash: mutation.requestHash,
                    responseRef: mutation.responseRef,
                    expiresAt: new Date(Date.now() + 7 * 365 * DAY_SECONDS * 1_000).toISOString(),
                },
                expectedRecords: state.persisted
                    ? [{ kind: FOUNDATION_METADATA_KIND, id: state.metadata.metadata_id, expected: { version: state.metadata.version } }]
                    : [{ kind: FOUNDATION_METADATA_KIND, id: state.metadata.metadata_id, absent: true }],
            });
            return { replayed: result.replayed === true };
        }
        catch (error) {
            if (error instanceof database_service_1.DatabaseMutationConflict) {
                throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, error.code, error.message, error.code === 'idempotency_request_in_progress');
            }
            throw error;
        }
    }
    async page(ctx, kind, input) {
        try {
            return await this.database.listPage(ctx.tenantId, kind, input);
        }
        catch (error) {
            if (error instanceof TypeError && error.message.includes('cursor'))
                throw (0, foundation_validation_1.invalid)('invalid_cursor', 'The page cursor is invalid.');
            throw error;
        }
    }
    eventView(event, replayed = false) {
        return {
            event: this.publicEvent(event),
            data_watermark: this.watermark(),
            etag: (0, domain_1.etag)(event.state_hash),
            ...(replayed ? { replayed: true } : {}),
        };
    }
    dataPointView(point, replayed = false) {
        return {
            data_point: this.publicDataPoint(point),
            data_watermark: this.watermark(),
            etag: (0, domain_1.etag)(point.state_hash),
            ...(replayed ? { replayed: true } : {}),
        };
    }
    publicEvent(event) {
        return {
            ...structuredClone(event),
            data_quality: this.currentQuality(event.data_quality),
        };
    }
    publicDataPoint(point) {
        return {
            ...structuredClone(point),
            data_quality: this.currentQuality(point.data_quality),
        };
    }
    publicPropagation(propagation) {
        return structuredClone(propagation);
    }
    currentQuality(quality) {
        const staleNow = Date.parse((0, domain_1.nowIso)()) > Date.parse(quality.stale_after);
        return { ...structuredClone(quality), stale_now: staleNow };
    }
    watermark() {
        return {
            schema_version: data_foundation_types_1.DATA_FOUNDATION_SCHEMA_VERSION,
            authoritative_store: 'postgresql',
            graph_propagation: 'bounded_authoritative_graph_analysis',
            historical_recording: 'append_only_event_and_data_point_records',
        };
    }
    eventHash(event) {
        const { state_hash: _stateHash, ...domain } = event;
        return (0, domain_1.sha256)(domain);
    }
    dataPointHash(point) {
        const { state_hash: _stateHash, ...domain } = point;
        return (0, domain_1.sha256)(domain);
    }
    eventId(ctx, idempotencyKey) {
        return (0, domain_1.stableUuid)(`twin-event:${ctx.tenantId}:${ctx.actor.actor_id}:${idempotencyKey}`);
    }
    dataPointId(ctx, mode, idempotencyKey) {
        return (0, domain_1.stableUuid)(`twin-data-point:${mode}:${ctx.tenantId}:${ctx.actor.actor_id}:${idempotencyKey}`);
    }
    metadataId(tenantId) {
        return (0, domain_1.stableUuid)(`twin-data-foundation-metadata:${tenantId}`);
    }
    round(value) {
        return Math.round(value * 1_000_000) / 1_000_000;
    }
    canReadClassification(ctx, eventClassification) {
        if (ctx.actor.capabilities.includes('connector.admin'))
            return true;
        if (eventClassification === 'public')
            return true;
        if (eventClassification === 'restricted')
            return false;
        const evidenceCapabilities = ctx.actor.capabilities.filter((capability) => capability.startsWith('evidence.read.'));
        if (evidenceCapabilities.some((capability) => !capability.endsWith('_public')))
            return true;
        return ctx.actor.capabilities.includes('scenario.create') && eventClassification === 'internal';
    }
    assertRead(ctx) {
        const permitted = ctx.actor.capabilities.includes('connector.admin')
            || ctx.actor.capabilities.includes('scenario.create')
            || ctx.actor.capabilities.some((capability) => capability.startsWith('evidence.read.'));
        if (!permitted || ctx.actor.actor_alias === 'usr_platform_operator') {
            throw new problem_1.ProblemException(common_1.HttpStatus.FORBIDDEN, 'twin_event_read_denied', 'Operational event access is not authorized.');
        }
    }
    assertWrite(ctx) {
        if (!ctx.actor.capabilities.includes('connector.admin')) {
            throw new problem_1.ProblemException(common_1.HttpStatus.FORBIDDEN, 'twin_event_write_denied', 'Recording authoritative events and data points requires a tenant integration administrator.');
        }
    }
};
exports.TwinEventService = TwinEventService;
exports.TwinEventService = TwinEventService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        twin_graph_service_1.TwinGraphService])
], TwinEventService);
//# sourceMappingURL=twin-event.service.js.map