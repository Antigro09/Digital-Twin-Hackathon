import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DatabaseMutationConflict,
  DatabaseService,
  EventMutationAudit,
  EventMutationRecord,
} from './database.service';
import {
  CanonicalDataSource,
  DATA_FOUNDATION_SCHEMA_VERSION,
  DataFoundationMetadata,
  DataQualityAssessment,
  DEFAULT_EVENT_TYPES,
  EVENT_CATEGORIES,
  EVENT_OUTCOMES,
  EVENT_SEVERITIES,
  EventPropagation,
  EventPropagationImpact,
  TwinDataPoint,
  TwinEventCategory,
  TwinEventOutcome,
  TwinEventSeverity,
  TwinOperationalEvent,
} from './data-foundation.types';
import { RequestContext, etag, newId, nowIso, sha256, stableUuid, traceId } from './domain';
import {
  UUID_PATTERN,
  assertExactKeys,
  boundedInteger,
  classification,
  invalid,
  isoTimestamp,
  notFound,
  optionalString,
  optionalUuid,
  plainRecord,
  requiredString,
  safeJsonValue,
  safeLocator,
  safeRecord,
  score,
  stringArray,
  uuid,
} from './foundation-validation';
import { ProblemException } from './problem';
import { TwinClassification } from './twin-graph.types';
import { TwinGraphService } from './twin-graph.service';

const FOUNDATION_METADATA_KIND = 'twin_data_foundation_metadata';
const EVENT_KIND = 'twin_event';
const DATA_POINT_KIND = 'twin_data_point';
const MAX_EVENT_DETAILS_BYTES = 64 * 1024;
const MAX_DATA_VALUE_BYTES = 64 * 1024;
const MAX_AFFECTED_NODES = 25;
const MAX_QUALITY_CANDIDATES = 100;
const MAX_CONFLICTS = 20;
const MAX_EVENT_PAGE_SIZE = 100;
const CUSTOM_EVENT_TYPE = /^[a-z][a-z0-9.-]{1,63}\/[A-Z][A-Za-z0-9]{0,63}$/;
const DAY_SECONDS = 24 * 60 * 60;
const YEAR_SECONDS = 365 * DAY_SECONDS;

interface FoundationState {
  metadata: DataFoundationMetadata;
  persisted: boolean;
}

interface DataPointDraft {
  dataPointId: string;
  eventId: string | null;
  subjectNodeId: string | null;
  subjectKey: string;
  metric: string;
  value: unknown;
  source: CanonicalDataSource;
  ownerId: string | null;
  reliabilityScore: number;
  declaredConfidenceScore: number;
  freshnessTtlSeconds: number;
  classification: TwinClassification;
}

interface PropagationOptions {
  maxDepth: number;
  maxImpacts: number;
}

/**
 * Append-only operational events and provenance-bearing data points. Event
 * intelligence remains an approval-gated interpretation workflow; this service
 * is the authoritative record of observations and their graph exposure.
 */
@Injectable()
export class TwinEventService {
  constructor(
    private readonly database: DatabaseService,
    private readonly graph: TwinGraphService,
  ) {}

  eventTypes(ctx: RequestContext): Record<string, unknown> {
    this.assertRead(ctx);
    return {
      items: DEFAULT_EVENT_TYPES.map((type) => ({ ...type })),
      custom_type_id_pattern: 'publisher.package/Type',
      schema_version: DATA_FOUNDATION_SCHEMA_VERSION,
    };
  }

  async createEvent(
    ctx: RequestContext,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<Record<string, unknown>> {
    this.assertWrite(ctx);
    assertExactKeys(
      input,
      [
        'type_id', 'category', 'occurred_at', 'source', 'affected_node_ids', 'severity', 'outcome',
        'owner_id', 'classification', 'details', 'confidence_score', 'reliability_score',
        'freshness_ttl_seconds', 'propagation',
      ],
      'Operational event',
    );
    const state = await this.state(ctx.tenantId);
    const eventId = this.eventId(ctx, idempotencyKey);
    const dataPointId = this.dataPointId(ctx, 'event', idempotencyKey);
    const { typeId, category } = this.eventType(input.type_id, input.category);
    const occurredAt = isoTimestamp(input.occurred_at, 'occurred_at');
    const details = safeRecord(input.details ?? {}, 'details', MAX_EVENT_DETAILS_BYTES);
    const affectedNodeIds = this.affectedNodeIds(input.affected_node_ids);
    const affectedClassifications = await this.affectedNodeClassifications(ctx, affectedNodeIds);
    const severity = this.severity(input.severity ?? 'info');
    const outcome = this.outcome(input.outcome ?? 'observed');
    const reliabilityScore = score(input.reliability_score, 'reliability_score', 0.8);
    const declaredConfidenceScore = score(input.confidence_score, 'confidence_score', 1);
    const freshnessTtlSeconds = boundedInteger(input.freshness_ttl_seconds, 'freshness_ttl_seconds', 60, YEAR_SECONDS, DAY_SECONDS);
    const source = this.source(input.source, sha256(details), occurredAt);
    const propagation = await this.propagate(ctx, affectedNodeIds, typeId, category, severity, outcome, this.propagationOptions(input.propagation));
    const requiredClassification = this.maximumClassification([
      ...affectedClassifications,
      ...this.propagationClassifications(propagation),
    ]);
    const eventClassification = this.classificationAtLeast(input.classification, requiredClassification);
    const draft: DataPointDraft = {
      dataPointId,
      eventId,
      subjectNodeId: null,
      subjectKey: `event-targets:${sha256([...affectedNodeIds].sort())}`,
      metric: typeId,
      value: details,
      source,
      ownerId: optionalUuid(input.owner_id, 'owner_id'),
      reliabilityScore,
      declaredConfidenceScore,
      freshnessTtlSeconds,
      classification: eventClassification,
    };
    const point = await this.buildDataPoint(ctx, draft);
    const event: TwinOperationalEvent = {
      event_id: eventId,
      tenant_id: ctx.tenantId,
      type_id: typeId,
      category,
      occurred_at: occurredAt,
      recorded_at: nowIso(),
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
    const committed = await this.commit(
      ctx,
      state,
      nextMetadata,
      [
        { kind: DATA_POINT_KIND, id: point.data_point_id, payload: point },
        { kind: EVENT_KIND, id: event.event_id, payload: event },
      ],
      {
        action: 'twin.event.record',
        requestHash: sha256({ action: 'event.record', input }),
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
      },
    );
    if (committed.replayed) {
      const existing = await this.database.get<TwinOperationalEvent>(ctx.tenantId, EVENT_KIND, event.event_id);
      if (!existing) throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original event response is unavailable.', true);
      return this.eventView(existing, true);
    }
    return this.eventView(event);
  }

  async createDataPoint(
    ctx: RequestContext,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<Record<string, unknown>> {
    this.assertWrite(ctx);
    assertExactKeys(
      input,
      [
        'subject_node_id', 'metric', 'value', 'source', 'owner_id', 'classification',
        'confidence_score', 'reliability_score', 'freshness_ttl_seconds',
      ],
      'Data point',
    );
    const state = await this.state(ctx.tenantId);
    const dataPointId = this.dataPointId(ctx, 'direct', idempotencyKey);
    const subjectNodeId = optionalUuid(input.subject_node_id, 'subject_node_id');
    const subjectClassification = subjectNodeId ? await this.nodeClassification(ctx, subjectNodeId) : undefined;
    const value = safeJsonValue(input.value, 'value', MAX_DATA_VALUE_BYTES);
    const metric = requiredString(input.metric, 'metric', 160);
    const source = this.source(input.source, sha256(value), nowIso());
    const pointClassification = this.classificationAtLeast(input.classification, subjectClassification ?? 'internal');
    const draft: DataPointDraft = {
      dataPointId,
      eventId: null,
      subjectNodeId,
      subjectKey: subjectNodeId ?? `source:${source.source_system}:${source.source_record_id}`,
      metric,
      value,
      source,
      ownerId: optionalUuid(input.owner_id, 'owner_id'),
      reliabilityScore: score(input.reliability_score, 'reliability_score', 0.8),
      declaredConfidenceScore: score(input.confidence_score, 'confidence_score', 1),
      freshnessTtlSeconds: boundedInteger(input.freshness_ttl_seconds, 'freshness_ttl_seconds', 60, YEAR_SECONDS, DAY_SECONDS),
      classification: pointClassification,
    };
    const point = await this.buildDataPoint(ctx, draft);
    const nextMetadata = this.nextMetadata(state);
    const committed = await this.commit(
      ctx,
      state,
      nextMetadata,
      [{ kind: DATA_POINT_KIND, id: point.data_point_id, payload: point }],
      {
        action: 'twin.data_point.record',
        requestHash: sha256({ action: 'data_point.record', input }),
        idempotencyKey,
        responseRef: point.data_point_id,
        eventId: stableUuid(`twin-data-point-outbox:${ctx.tenantId}:${ctx.actor.actor_id}:${idempotencyKey}`),
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
      },
    );
    if (committed.replayed) {
      const existing = await this.database.get<TwinDataPoint>(ctx.tenantId, DATA_POINT_KIND, point.data_point_id);
      if (!existing) throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original data-point response is unavailable.', true);
      return this.dataPointView(existing, true);
    }
    return this.dataPointView(point);
  }

  async listEvents(ctx: RequestContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    assertExactKeys(input, ['type_id', 'category', 'severity', 'outcome', 'limit', 'cursor'], 'Event list');
    const filters: Record<string, string> = {};
    if (input.type_id !== undefined) filters.type_id = requiredString(input.type_id, 'type_id', 128);
    if (input.category !== undefined) filters.category = this.category(input.category);
    if (input.severity !== undefined) filters.severity = this.severity(input.severity);
    if (input.outcome !== undefined) filters.outcome = this.outcome(input.outcome);
    const limit = boundedInteger(input.limit, 'limit', 1, MAX_EVENT_PAGE_SIZE, 50);
    const cursor = input.cursor === undefined ? undefined : requiredString(input.cursor, 'cursor', 2_000);
    const page = await this.page<TwinOperationalEvent>(ctx, EVENT_KIND, { filters, limit: Math.min(500, limit * 5), cursor });
    const items = page.items.filter((event) => this.canReadClassification(ctx, event.classification)).slice(0, limit);
    return {
      items: items.map((event) => this.publicEvent(event)),
      has_more: page.nextCursor !== null || page.items.filter((event) => this.canReadClassification(ctx, event.classification)).length > limit,
      next_cursor: page.nextCursor,
      data_watermark: this.watermark(),
    };
  }

  async getEvent(ctx: RequestContext, eventId: string): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    if (!UUID_PATTERN.test(eventId)) throw notFound();
    const event = await this.database.get<TwinOperationalEvent>(ctx.tenantId, EVENT_KIND, eventId);
    if (!event || event.tenant_id !== ctx.tenantId || !this.canReadClassification(ctx, event.classification)) throw notFound();
    return this.eventView(event);
  }

  async analyzeEventImpact(ctx: RequestContext, eventId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    assertExactKeys(input, ['max_depth', 'max_impacts'], 'Event impact analysis');
    if (!UUID_PATTERN.test(eventId)) throw notFound();
    const event = await this.database.get<TwinOperationalEvent>(ctx.tenantId, EVENT_KIND, eventId);
    if (!event || event.tenant_id !== ctx.tenantId || !this.canReadClassification(ctx, event.classification)) throw notFound();
    return {
      event_id: event.event_id,
      persisted_propagation: this.publicPropagation(event.propagation),
      current_propagation: await this.propagate(
        ctx,
        event.affected_node_ids,
        event.type_id,
        event.category,
        event.severity,
        event.outcome,
        this.propagationOptions(input),
      ),
      immutable_event: true,
    };
  }

  async listDataPoints(ctx: RequestContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    assertExactKeys(input, ['subject_node_id', 'metric', 'limit', 'cursor'], 'Data-point list');
    const filters: Record<string, string> = {};
    if (input.subject_node_id !== undefined) filters.subject_node_id = uuid(input.subject_node_id, 'subject_node_id');
    if (input.metric !== undefined) filters.metric = requiredString(input.metric, 'metric', 160);
    const limit = boundedInteger(input.limit, 'limit', 1, MAX_EVENT_PAGE_SIZE, 50);
    const cursor = input.cursor === undefined ? undefined : requiredString(input.cursor, 'cursor', 2_000);
    const page = await this.page<TwinDataPoint>(ctx, DATA_POINT_KIND, { filters, limit: Math.min(500, limit * 5), cursor });
    const items = page.items.filter((point) => this.canReadClassification(ctx, point.classification)).slice(0, limit);
    return {
      items: items.map((point) => this.publicDataPoint(point)),
      has_more: page.nextCursor !== null || page.items.filter((point) => this.canReadClassification(ctx, point.classification)).length > limit,
      next_cursor: page.nextCursor,
      data_watermark: this.watermark(),
    };
  }

  async getDataPoint(ctx: RequestContext, dataPointId: string): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    if (!UUID_PATTERN.test(dataPointId)) throw notFound();
    const point = await this.database.get<TwinDataPoint>(ctx.tenantId, DATA_POINT_KIND, dataPointId);
    if (!point || point.tenant_id !== ctx.tenantId || !this.canReadClassification(ctx, point.classification)) throw notFound();
    return this.dataPointView(point);
  }

  private async buildDataPoint(ctx: RequestContext, draft: DataPointDraft): Promise<TwinDataPoint> {
    const valueHash = sha256(draft.value);
    const sourceFingerprint = sha256({
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
    const point: TwinDataPoint = {
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
      last_updated_at: nowIso(),
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

  private async assessQuality(
    tenantId: string,
    input: {
      dataPointId: string;
      sourceFingerprint: string;
      valueHash: string;
      subjectKey: string;
      metric: string;
      observedAt: string;
      freshnessTtlSeconds: number;
      reliabilityScore: number;
      declaredConfidenceScore: number;
    },
  ): Promise<DataQualityAssessment> {
    const metricKey = input.metric.toLocaleLowerCase('en-US');
    const [sourcePage, subjectPage] = await Promise.all([
      this.database.listPage<TwinDataPoint>(tenantId, DATA_POINT_KIND, {
        filters: { source_fingerprint: input.sourceFingerprint },
        limit: MAX_QUALITY_CANDIDATES,
      }),
      this.database.listPage<TwinDataPoint>(tenantId, DATA_POINT_KIND, {
        filters: { subject_key: input.subjectKey, metric_key: metricKey },
        limit: MAX_QUALITY_CANDIDATES,
      }),
    ]);
    const candidates = new Map<string, TwinDataPoint>();
    for (const point of [...sourcePage.items, ...subjectPage.items]) {
      if (point.data_point_id !== input.dataPointId && point.tenant_id === tenantId) candidates.set(point.data_point_id, point);
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
    const assessedAt = nowIso();
    const staleAfter = new Date(observationTime + input.freshnessTtlSeconds * 1_000).toISOString();
    const stale = Date.parse(assessedAt) > Date.parse(staleAfter);
    let confidence = input.declaredConfidenceScore * 0.65 + input.reliabilityScore * 0.35;
    if (duplicate) confidence *= 0.95;
    if (conflicts.length) confidence *= 0.6;
    if (stale) confidence *= 0.7;
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

  private async propagate(
    ctx: RequestContext,
    affectedNodeIds: string[],
    typeId: string,
    category: TwinEventCategory,
    severity: TwinEventSeverity,
    outcome: TwinEventOutcome,
    options: PropagationOptions,
  ): Promise<EventPropagation> {
    const perRootLimit = Math.max(1, Math.floor(options.maxImpacts / affectedNodeIds.length));
    const analyses = await Promise.all(affectedNodeIds.map((nodeId) => this.graph.analyzeImpact(ctx, {
      node_id: nodeId,
      change: { kind: 'operational_event', type_id: typeId, category, severity, outcome },
      max_depth: options.maxDepth,
      max_impacts: perRootLimit,
    })));
    const impacts = new Map<string, EventPropagationImpact>();
    let graphVersion = 0;
    let truncated = false;
    for (const analysis of analyses) {
      if (typeof analysis.graph_version === 'number') graphVersion = Math.max(graphVersion, analysis.graph_version);
      truncated ||= analysis.truncated === true;
      const rawImpacts = [
        ...(Array.isArray(analysis.direct_impacts) ? analysis.direct_impacts : []),
        ...(Array.isArray(analysis.downstream_impacts) ? analysis.downstream_impacts : []),
      ];
      for (const rawImpact of rawImpacts) {
        const impact = this.propagationImpact(rawImpact);
        if (!impact) continue;
        const existing = impacts.get(impact.node_id);
        if (!existing || impact.score > existing.score || (impact.score === existing.score && impact.depth < existing.depth)) {
          impacts.set(impact.node_id, impact);
        }
      }
    }
    const ordered = [...impacts.values()]
      .sort((left, right) => right.score - left.score || left.depth - right.depth || left.node_id.localeCompare(right.node_id))
      .slice(0, options.maxImpacts);
    if (impacts.size > ordered.length) truncated = true;
    return {
      calculated_at: nowIso(),
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

  private propagationImpact(value: unknown): EventPropagationImpact | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (
      typeof record.node_id !== 'string' || !UUID_PATTERN.test(record.node_id)
      || typeof record.depth !== 'number' || !Number.isInteger(record.depth)
      || typeof record.score !== 'number' || !Number.isFinite(record.score)
      || !Array.isArray(record.path) || !record.path.every((item) => typeof item === 'string' && UUID_PATTERN.test(item))
      || !Array.isArray(record.relationship_path) || !record.relationship_path.every((item) => typeof item === 'string' && UUID_PATTERN.test(item))
      || typeof record.cumulative_cost !== 'number' || !Number.isFinite(record.cumulative_cost)
      || !record.node || typeof record.node !== 'object' || Array.isArray(record.node)
    ) return undefined;
    return {
      node_id: record.node_id,
      depth: record.depth,
      score: this.round(record.score),
      path: [...record.path] as string[],
      relationship_path: [...record.relationship_path] as string[],
      cumulative_cost: this.round(record.cumulative_cost),
      node: structuredClone(record.node) as Record<string, unknown>,
    };
  }

  private source(raw: unknown, contentHash: string, fallbackObservedAt: string): CanonicalDataSource {
    const source = plainRecord(raw, 'source');
    assertExactKeys(source, ['source_system', 'source_record_id', 'source_revision', 'connector_id', 'observed_at', 'locator'], 'Source');
    const connectorId = source.connector_id === undefined ? undefined : uuid(source.connector_id, 'source.connector_id');
    const locator = safeLocator(source.locator, 'source.locator');
    return {
      source_system: requiredString(source.source_system, 'source.source_system', 120),
      source_record_id: requiredString(source.source_record_id, 'source.source_record_id', 500),
      ...(optionalString(source.source_revision, 'source.source_revision', 200) ? { source_revision: optionalString(source.source_revision, 'source.source_revision', 200) } : {}),
      ...(connectorId ? { connector_id: connectorId } : {}),
      observed_at: isoTimestamp(source.observed_at, 'source.observed_at', fallbackObservedAt),
      content_hash: contentHash,
      ...(locator ? { locator } : {}),
    };
  }

  private eventType(rawType: unknown, rawCategory: unknown): { typeId: string; category: TwinEventCategory } {
    const supplied = requiredString(rawType, 'type_id', 128);
    const standard = DEFAULT_EVENT_TYPES.find((item) => (
      item.type_id === supplied
      || item.type_id.slice(item.type_id.lastIndexOf('/') + 1).toLocaleLowerCase('en-US') === supplied.toLocaleLowerCase('en-US')
    ));
    if (standard) {
      const category = rawCategory === undefined ? standard.category : this.category(rawCategory);
      if (category !== standard.category) throw invalid('event_category_mismatch', `${standard.type_id} must use the ${standard.category} category.`);
      return { typeId: standard.type_id, category };
    }
    if (!CUSTOM_EVENT_TYPE.test(supplied) || supplied.startsWith('edt.event/')) {
      throw invalid('invalid_event_type', 'Custom event type IDs must be namespaced as publisher.package/Type and cannot shadow edt.event/.');
    }
    if (rawCategory === undefined) throw invalid('event_category_required', 'Custom event types must declare one of the supported categories.');
    return { typeId: supplied, category: this.category(rawCategory) };
  }

  private category(value: unknown): TwinEventCategory {
    if (typeof value !== 'string' || !EVENT_CATEGORIES.includes(value as TwinEventCategory)) {
      throw invalid('invalid_event_category', `category must be one of ${EVENT_CATEGORIES.join(', ')}.`);
    }
    return value as TwinEventCategory;
  }

  private severity(value: unknown): TwinEventSeverity {
    if (typeof value !== 'string' || !EVENT_SEVERITIES.includes(value as TwinEventSeverity)) {
      throw invalid('invalid_event_severity', `severity must be one of ${EVENT_SEVERITIES.join(', ')}.`);
    }
    return value as TwinEventSeverity;
  }

  private outcome(value: unknown): TwinEventOutcome {
    if (typeof value !== 'string' || !EVENT_OUTCOMES.includes(value as TwinEventOutcome)) {
      throw invalid('invalid_event_outcome', `outcome must be one of ${EVENT_OUTCOMES.join(', ')}.`);
    }
    return value as TwinEventOutcome;
  }

  private affectedNodeIds(value: unknown): string[] {
    const nodeIds = stringArray(value, 'affected_node_ids', MAX_AFFECTED_NODES, 64);
    if (!nodeIds.length) throw invalid('affected_nodes_required', 'affected_node_ids must contain at least one graph node ID.');
    return nodeIds.map((nodeId, index) => uuid(nodeId, `affected_node_ids[${index}]`));
  }

  private async affectedNodeClassifications(ctx: RequestContext, nodeIds: string[]): Promise<TwinClassification[]> {
    return Promise.all(nodeIds.map((nodeId) => this.nodeClassification(ctx, nodeId)));
  }

  private async nodeClassification(ctx: RequestContext, nodeId: string): Promise<TwinClassification> {
    const response = await this.graph.getNode(ctx, nodeId);
    const node = response.node;
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw notFound();
    const metadata = (node as Record<string, unknown>).metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw notFound();
    return classification((metadata as Record<string, unknown>).classification, 'node.metadata.classification');
  }

  private propagationOptions(value: unknown): PropagationOptions {
    if (value === undefined) return { maxDepth: 4, maxImpacts: 100 };
    const options = plainRecord(value, 'propagation');
    assertExactKeys(options, ['max_depth', 'max_impacts'], 'Propagation');
    return {
      maxDepth: boundedInteger(options.max_depth, 'propagation.max_depth', 1, 6, 4),
      maxImpacts: boundedInteger(options.max_impacts, 'propagation.max_impacts', 1, 250, 100),
    };
  }

  private propagationClassifications(propagation: EventPropagation): TwinClassification[] {
    return propagation.impacts.map((impact) => {
      const nodeClassification = impact.node.classification;
      return classification(nodeClassification, 'propagation.node.classification');
    });
  }

  private classificationAtLeast(value: unknown, minimum: TwinClassification): TwinClassification {
    const supplied = classification(value, 'classification', minimum);
    if (this.classificationRank(supplied) < this.classificationRank(minimum)) {
      throw invalid('classification_weakened', 'Classification cannot be less restrictive than an affected or propagated graph node.');
    }
    return supplied;
  }

  private maximumClassification(values: TwinClassification[]): TwinClassification {
    return values.reduce((current, item) => this.classificationRank(item) > this.classificationRank(current) ? item : current, 'public' as TwinClassification);
  }

  private classificationRank(value: TwinClassification): number {
    return ['public', 'internal', 'confidential', 'restricted'].indexOf(value);
  }

  private async state(tenantId: string): Promise<FoundationState> {
    const metadataId = this.metadataId(tenantId);
    const metadata = await this.database.get<DataFoundationMetadata>(tenantId, FOUNDATION_METADATA_KIND, metadataId);
    if (metadata?.tenant_id === tenantId && metadata.metadata_id === metadataId) return { metadata, persisted: true };
    return {
      persisted: false,
      metadata: {
        metadata_id: metadataId,
        tenant_id: tenantId,
        schema_version: DATA_FOUNDATION_SCHEMA_VERSION,
        version: 0,
        updated_at: nowIso(),
      },
    };
  }

  private nextMetadata(state: FoundationState): DataFoundationMetadata {
    return { ...state.metadata, version: state.metadata.version + 1, updated_at: nowIso() };
  }

  private async commit(
    ctx: RequestContext,
    state: FoundationState,
    nextMetadata: DataFoundationMetadata,
    records: EventMutationRecord[],
    mutation: {
      action: string;
      requestHash: string;
      idempotencyKey: string;
      responseRef: string;
      eventId: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      aggregateVersion: number;
      payload: Record<string, unknown>;
    },
  ): Promise<{ replayed: boolean }> {
    const audit: EventMutationAudit = {
      audit_id: newId(),
      tenant_sequence: 0,
      action: mutation.action,
      actor_id: ctx.actor.actor_id,
      resource_type: mutation.aggregateType,
      resource_id: mutation.aggregateId,
      occurred_at: nowIso(),
      request_id: ctx.requestId,
      trace_id: traceId(),
      details_hash: sha256({ action: mutation.action, aggregate_id: mutation.aggregateId, aggregate_version: mutation.aggregateVersion, response_ref: mutation.responseRef }),
      previous_hash: '',
      event_hash: '',
    };
    try {
      const result = await this.database.commitEventMutation(
        ctx.tenantId,
        [{ kind: FOUNDATION_METADATA_KIND, id: nextMetadata.metadata_id, payload: nextMetadata }, ...records],
        audit,
        {
          eventId: mutation.eventId,
          eventType: mutation.eventType,
          aggregateType: mutation.aggregateType,
          aggregateId: mutation.aggregateId,
          aggregateVersion: mutation.aggregateVersion,
          payload: mutation.payload,
        },
        {
          idempotency: {
            operation: `${ctx.actor.actor_id}:${mutation.action}`,
            key: mutation.idempotencyKey,
            requestHash: mutation.requestHash,
            responseRef: mutation.responseRef,
            // IDs derive from the key and event evidence is retained for audit.
            expiresAt: new Date(Date.now() + 7 * 365 * DAY_SECONDS * 1_000).toISOString(),
          },
          expectedRecords: state.persisted
            ? [{ kind: FOUNDATION_METADATA_KIND, id: state.metadata.metadata_id, expected: { version: state.metadata.version } }]
            : [{ kind: FOUNDATION_METADATA_KIND, id: state.metadata.metadata_id, absent: true }],
        },
      );
      return { replayed: result.replayed === true };
    } catch (error) {
      if (error instanceof DatabaseMutationConflict) {
        throw new ProblemException(HttpStatus.CONFLICT, error.code, error.message, error.code === 'idempotency_request_in_progress');
      }
      throw error;
    }
  }

  private async page<T>(
    ctx: RequestContext,
    kind: string,
    input: { filters: Record<string, string>; limit: number; cursor?: string },
  ): Promise<{ items: T[]; nextCursor: string | null }> {
    try {
      return await this.database.listPage<T>(ctx.tenantId, kind, input);
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('cursor')) throw invalid('invalid_cursor', 'The page cursor is invalid.');
      throw error;
    }
  }

  private eventView(event: TwinOperationalEvent, replayed = false): Record<string, unknown> {
    return {
      event: this.publicEvent(event),
      data_watermark: this.watermark(),
      etag: etag(event.state_hash),
      ...(replayed ? { replayed: true } : {}),
    };
  }

  private dataPointView(point: TwinDataPoint, replayed = false): Record<string, unknown> {
    return {
      data_point: this.publicDataPoint(point),
      data_watermark: this.watermark(),
      etag: etag(point.state_hash),
      ...(replayed ? { replayed: true } : {}),
    };
  }

  private publicEvent(event: TwinOperationalEvent): Record<string, unknown> {
    return {
      ...structuredClone(event),
      data_quality: this.currentQuality(event.data_quality),
    } as unknown as Record<string, unknown>;
  }

  private publicDataPoint(point: TwinDataPoint): Record<string, unknown> {
    return {
      ...structuredClone(point),
      data_quality: this.currentQuality(point.data_quality),
    } as unknown as Record<string, unknown>;
  }

  private publicPropagation(propagation: EventPropagation): Record<string, unknown> {
    return structuredClone(propagation) as unknown as Record<string, unknown>;
  }

  private currentQuality(quality: DataQualityAssessment): Record<string, unknown> {
    const staleNow = Date.parse(nowIso()) > Date.parse(quality.stale_after);
    return { ...structuredClone(quality), stale_now: staleNow };
  }

  private watermark(): Record<string, unknown> {
    return {
      schema_version: DATA_FOUNDATION_SCHEMA_VERSION,
      authoritative_store: 'postgresql',
      graph_propagation: 'bounded_authoritative_graph_analysis',
      historical_recording: 'append_only_event_and_data_point_records',
    };
  }

  private eventHash(event: TwinOperationalEvent): string {
    const { state_hash: _stateHash, ...domain } = event;
    return sha256(domain);
  }

  private dataPointHash(point: TwinDataPoint): string {
    const { state_hash: _stateHash, ...domain } = point;
    return sha256(domain);
  }

  private eventId(ctx: RequestContext, idempotencyKey: string): string {
    return stableUuid(`twin-event:${ctx.tenantId}:${ctx.actor.actor_id}:${idempotencyKey}`);
  }

  private dataPointId(ctx: RequestContext, mode: string, idempotencyKey: string): string {
    return stableUuid(`twin-data-point:${mode}:${ctx.tenantId}:${ctx.actor.actor_id}:${idempotencyKey}`);
  }

  private metadataId(tenantId: string): string {
    return stableUuid(`twin-data-foundation-metadata:${tenantId}`);
  }

  private round(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
  }

  private canReadClassification(ctx: RequestContext, eventClassification: TwinClassification): boolean {
    if (ctx.actor.capabilities.includes('connector.admin')) return true;
    if (eventClassification === 'public') return true;
    if (eventClassification === 'restricted') return false;
    const evidenceCapabilities = ctx.actor.capabilities.filter((capability) => capability.startsWith('evidence.read.'));
    if (evidenceCapabilities.some((capability) => !capability.endsWith('_public'))) return true;
    return ctx.actor.capabilities.includes('scenario.create') && eventClassification === 'internal';
  }

  private assertRead(ctx: RequestContext): void {
    const permitted = ctx.actor.capabilities.includes('connector.admin')
      || ctx.actor.capabilities.includes('scenario.create')
      || ctx.actor.capabilities.some((capability) => capability.startsWith('evidence.read.'));
    if (!permitted || ctx.actor.actor_alias === 'usr_platform_operator') {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'twin_event_read_denied', 'Operational event access is not authorized.');
    }
  }

  private assertWrite(ctx: RequestContext): void {
    if (!ctx.actor.capabilities.includes('connector.admin')) {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'twin_event_write_denied', 'Recording authoritative events and data points requires a tenant integration administrator.');
    }
  }
}
