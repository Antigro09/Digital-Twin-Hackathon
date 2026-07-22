import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DemoStoreService } from './demo-store.service';
import { RequestContext } from './domain';
import { EventIntelligenceService } from './event-intelligence.service';
import { ProblemException } from './problem';

const AGENT_TYPES = [
  'knowledge_ingestion',
  'entity_resolution',
  'event_understanding',
  'causal_analysis',
  'simulation_planning',
  'prediction_explanation',
  'technical_knowledge',
  'marketing_analyst',
] as const;

type AgentType = (typeof AGENT_TYPES)[number];
type JsonRecord = Record<string, unknown>;

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_AGENT_INPUT_BYTES = 65_536;
const MAX_DOCUMENT_BYTES = 5_242_880;
const MAX_DOCUMENT_BASE64_CHARS = 4 * Math.ceil(MAX_DOCUMENT_BYTES / 3);
const MAX_TEXT_FIELD = 12_000;
const SENSITIVE_KEYS = new Set([
  'api_key', 'apikey', 'authorization', 'cookie', 'credential', 'credentials', 'password',
  'refresh_token', 'secret', 'service_token', 'access_token', 'tenant_id', 'tenantid',
]);
const RESPONSE_SECRET_KEYS = new Set([
  'api_key', 'apikey', 'authorization', 'cookie', 'credential', 'credentials', 'password',
  'refresh_token', 'secret', 'service_token', 'access_token',
]);
const IMPORT_MEDIA_TYPES = new Set([
  'application/csv',
  'application/json',
  'application/pdf',
  'application/xml',
  'application/yaml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/svg+xml',
  'text/csv',
  'text/markdown',
  'text/plain',
  'text/vnd.mermaid',
  'text/xml',
  'text/yaml',
]);

interface WorkerOptions {
  method?: 'GET' | 'POST';
  body?: JsonRecord;
  idempotencyKey?: string;
  timeoutMs?: number;
  operation: string;
  validate: (value: unknown, context: RequestContext) => JsonRecord;
}

@Injectable()
export class AiGatewayService {
  constructor(
    private readonly store: DemoStoreService,
    private readonly events: EventIntelligenceService,
  ) {}

  async status(context: RequestContext): Promise<JsonRecord> {
    return this.callWorker(context, '/v1/ai/status', {
      operation: 'status',
      timeoutMs: 4_000,
      validate: (value, ctx) => this.validateStatus(value, ctx),
    });
  }

  async activity(context: RequestContext, pageSizeInput?: string): Promise<JsonRecord> {
    this.requireAiRead(context);
    const pageSize = this.pageSize(pageSizeInput, 25);
    return this.callWorker(context, `/v1/ai/activity?limit=${pageSize}`, {
      operation: 'activity',
      timeoutMs: 6_000,
      validate: (value, ctx) => this.validateActivity(value, ctx),
    });
  }

  async runAgent(context: RequestContext, input: unknown, idempotencyKey: string): Promise<JsonRecord> {
    const workerIdempotencyKey = this.workerIdempotencyKey(idempotencyKey);
    const body = this.strictRecord(input, 'agent run', ['agent_type', 'input', 'session_id', 'retrieval_query', 'evidence_ids', 'max_evidence_items', 'max_cost_usd']);
    const agentType = this.enumValue(body.agent_type, 'agent_type', AGENT_TYPES);
    this.requireAgentCapability(context, agentType);
    const agentInput = this.sanitizeAgentInput(body.input);
    const forwarded: JsonRecord = { agent_type: agentType, input: agentInput };
    const contextEvidence = this.contextEvidence(context, agentType, agentInput);
    if (contextEvidence.length) forwarded.context_evidence = contextEvidence;
    if (body.session_id !== undefined) forwarded.session_id = this.uuid(body.session_id, 'session_id');
    if (body.retrieval_query !== undefined) forwarded.retrieval_query = this.boundedString(body.retrieval_query, 'retrieval_query', 2, 2_000);
    if (body.evidence_ids !== undefined) forwarded.evidence_ids = this.uuidArray(body.evidence_ids, 'evidence_ids', 100);
    if (body.max_evidence_items !== undefined) forwarded.max_evidence_items = this.integer(body.max_evidence_items, 'max_evidence_items', 1, 20);
    if (body.max_cost_usd !== undefined) forwarded.max_cost_usd = this.number(body.max_cost_usd, 'max_cost_usd', 0.001, 5);
    return this.callWorker(context, '/v1/ai/agent-runs', {
      method: 'POST',
      body: forwarded,
      idempotencyKey: workerIdempotencyKey,
      timeoutMs: 45_000,
      operation: 'agent_run',
      validate: (value, ctx) => this.validateAgentRun(value, ctx),
    });
  }

  async retrieve(context: RequestContext, input: unknown): Promise<JsonRecord> {
    this.requireEvidenceRead(context);
    const body = this.strictRecord(input, 'retrieval query', ['query', 'page_size', 'limit']);
    if (body.page_size !== undefined && body.limit !== undefined) {
      throw this.badRequest('ambiguous_retrieval_limit', 'Use either page_size or limit, not both.');
    }
    const limitValue = body.page_size ?? body.limit ?? 10;
    const forwarded = {
      query: this.boundedString(body.query, 'query', 2, 2_000),
      limit: this.integer(limitValue, 'limit', 1, 20),
      required_permissions: this.contentPermissions(context),
    };
    return this.callWorker(context, '/v1/ai/retrieval/search', {
      method: 'POST',
      body: forwarded,
      timeoutMs: 10_000,
      operation: 'retrieval',
      validate: (value, ctx) => this.validateRetrieval(value, ctx),
    });
  }

  async importDocument(context: RequestContext, input: unknown, idempotencyKey: string): Promise<JsonRecord> {
    const workerIdempotencyKey = this.workerIdempotencyKey(idempotencyKey);
    this.requireCapability(context, 'connector.admin', 'ai_document_import_denied', 'Document import requires connector administration permission.');
    const body = this.strictRecord(input, 'document import', [
      'document_id', 'source_locator', 'filename', 'media_type', 'content_base64', 'classification', 'source_acl',
    ]);
    if (body.source_locator !== undefined && body.filename !== undefined) {
      throw this.badRequest('ambiguous_source_locator', 'Use either source_locator or filename, not both.');
    }
    const source = this.boundedString(body.source_locator ?? body.filename, 'source_locator', 1, 240, /^[^\\/\u0000-\u001f]+$/);
    const mediaType = this.boundedString(body.media_type, 'media_type', 3, 160).toLowerCase();
    if (!IMPORT_MEDIA_TYPES.has(mediaType)) {
      throw new ProblemException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'unsupported_document_media_type', 'The document media type is not allowlisted.');
    }
    const contentBase64 = this.base64Document(body.content_base64);
    const documentId = body.document_id === undefined
      ? this.stableUuid(`ai-document:${context.tenantId}:${workerIdempotencyKey}`)
      : this.uuid(body.document_id, 'document_id');
    const publicClassification = body.classification === undefined
      ? 'internal'
      : this.enumValue(body.classification, 'classification', ['public', 'internal', 'confidential', 'restricted'] as const);
    const sourceAcl = this.sourceAcl(body.source_acl);
    return this.callWorker(context, '/v1/ai/documents/import', {
      method: 'POST',
      body: {
        document_id: documentId,
        source_locator: source,
        media_type: mediaType,
        content_base64: contentBase64,
        classification: publicClassification,
        source_acl: {
          visibility: 'private',
          allowed_actor_ids: [context.actor.actor_id],
          allowed_roles: [],
          required_permissions: ['connector.admin'],
        },
      },
      idempotencyKey: workerIdempotencyKey,
      timeoutMs: 45_000,
      operation: 'document_import',
      validate: (value, ctx) => this.validateDocumentImport(value, ctx, documentId, publicClassification, sourceAcl),
    });
  }

  async suggestions(context: RequestContext, pageSizeInput?: string, decisionInput?: string): Promise<JsonRecord> {
    this.requireAiRead(context);
    const pageSize = this.pageSize(pageSizeInput, 25);
    const search = new URLSearchParams({ limit: String(pageSize) });
    if (decisionInput !== undefined) {
      const publicDecision = this.enumValue(decisionInput, 'review_decision', ['approve', 'reject'] as const);
      search.set('review_decision', publicDecision.toUpperCase());
    }
    return this.callWorker(context, `/v1/ai/suggestions?${search.toString()}`, {
      operation: 'suggestions',
      timeoutMs: 6_000,
      validate: (value, ctx) => this.validateSuggestions(value, ctx),
    });
  }

  async reviewSuggestion(context: RequestContext, suggestionIdInput: string, input: unknown, idempotencyKey: string): Promise<JsonRecord> {
    const workerIdempotencyKey = this.workerIdempotencyKey(idempotencyKey);
    this.requireCapability(context, 'connector.admin', 'ai_suggestion_review_denied', 'Suggestion review requires connector administration permission.');
    const suggestionId = this.uuid(suggestionIdInput, 'suggestion_id');
    const body = this.strictRecord(input, 'suggestion review', ['decision', 'reason']);
    const publicDecision = this.enumValue(body.decision, 'decision', ['approve', 'reject'] as const);
    const decision = publicDecision.toUpperCase() as 'APPROVE' | 'REJECT';
    const forwarded: JsonRecord = { decision };
    const reason = body.reason === undefined ? undefined : this.boundedString(body.reason, 'reason', 1, 1_000);
    if (reason !== undefined) forwarded.note = reason;
    return this.callWorker(context, `/v1/ai/suggestions/${encodeURIComponent(suggestionId)}/reviews`, {
      method: 'POST',
      body: forwarded,
      idempotencyKey: workerIdempotencyKey,
      timeoutMs: 10_000,
      operation: 'suggestion_review',
      validate: (value, ctx) => this.validateSuggestionReview(value, ctx, suggestionId, decision, publicDecision, reason),
    });
  }

  async recordLearningOutcome(context: RequestContext, input: unknown, idempotencyKey: string): Promise<JsonRecord> {
    const workerIdempotencyKey = this.workerIdempotencyKey(idempotencyKey);
    this.requireCapability(
      context,
      'connector.admin',
      'ai_learning_outcome_denied',
      'Validated learning outcomes require connector administration permission.',
    );
    const body = this.strictRecord(input, 'validated learning outcome', [
      'suggestion_id', 'validation', 'outcome_type', 'outcome', 'evidence_ids', 'observed_at', 'note',
    ]);
    const suggestionId = this.uuid(body.suggestion_id, 'suggestion_id');
    const publicValidation = this.enumValue(body.validation, 'validation', ['confirmed', 'corrected'] as const);
    const outcomeType = this.boundedString(
      body.outcome_type,
      'outcome_type',
      1,
      100,
      /^[a-z][a-z0-9_.-]{0,99}$/,
    );
    const outcome = this.sanitizeOutcome(body.outcome);
    const evidenceIds = this.uuidArray(body.evidence_ids, 'evidence_ids', 100);
    if (!evidenceIds.length) {
      throw this.badRequest('invalid_evidence_ids', 'evidence_ids must contain at least one authorized evidence UUID.');
    }
    const observedAt = this.offsetDateTime(body.observed_at, 'observed_at');
    const note = body.note === undefined ? undefined : this.boundedString(body.note, 'note', 1, 2_000);
    const forwarded: JsonRecord = {
      suggestion_id: suggestionId,
      validation: publicValidation.toUpperCase(),
      outcome_type: outcomeType,
      outcome,
      evidence_ids: evidenceIds,
      observed_at: observedAt,
    };
    if (note !== undefined) forwarded.note = note;
    return this.callWorker(context, '/v1/ai/learning/outcomes', {
      method: 'POST',
      body: forwarded,
      idempotencyKey: workerIdempotencyKey,
      timeoutMs: 10_000,
      operation: 'learning_outcome',
      validate: (value, ctx) => this.validateLearningOutcome(
        value,
        ctx,
        suggestionId,
        publicValidation,
        evidenceIds,
      ),
    });
  }

  private async callWorker(context: RequestContext, path: string, options: WorkerOptions): Promise<JsonRecord> {
    const secret = process.env.AI_WORKER_SHARED_SECRET;
    if (!secret || secret.length < 24) {
      throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'ai_gateway_not_configured', 'The AI gateway internal trust configuration is unavailable.', false);
    }
    const endpoint = this.workerEndpoint(path);
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-internal-tenant-id': context.tenantId,
      'x-internal-actor-id': context.actor.actor_id,
      'x-internal-permissions': this.internalPermissions(context).join(','),
      'x-internal-service-token': secret,
      'x-request-id': context.requestId,
    };
    if (options.body) headers['content-type'] = 'application/json';
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: options.method ?? 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(this.timeout(options.timeoutMs ?? 10_000)),
      });
    } catch (error) {
      if (this.isAbort(error)) {
        throw new ProblemException(HttpStatus.GATEWAY_TIMEOUT, 'ai_worker_timeout', 'The AI worker did not respond within the operation deadline.', true);
      }
      throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'ai_worker_unavailable', 'The AI worker is temporarily unavailable.', true);
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw this.invalidWorkerResponse();
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'ai_worker_unavailable', 'The AI worker response could not be read.', true);
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw this.invalidWorkerResponse();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      throw this.invalidWorkerResponse();
    }
    if (!response.ok) throw this.upstreamProblem(response.status, parsed);
    try {
      this.assertSafeWorkerValue(parsed, context);
      return options.validate(parsed, context);
    } catch {
      throw this.invalidWorkerResponse();
    }
  }

  private workerEndpoint(path: string): string {
    const configured = process.env.AI_WORKER_URL ?? 'http://ai-worker:8010';
    let endpoint: URL;
    try {
      endpoint = new URL(configured);
    } catch {
      throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'ai_gateway_not_configured', 'The AI worker endpoint configuration is invalid.');
    }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'ai_gateway_not_configured', 'The AI worker endpoint configuration is invalid.');
    }
    return new URL(path, `${endpoint.origin}/`).toString();
  }

  private timeout(defaultValue: number): number {
    const configured = Number(process.env.AI_WORKER_TIMEOUT_MS ?? defaultValue);
    return Number.isInteger(configured) && configured >= 500 && configured <= 60_000 ? configured : defaultValue;
  }

  private upstreamProblem(status: number, body: unknown): ProblemException {
    const record = this.recordOrUndefined(body);
    const upstreamCode = typeof record?.code === 'string' && /^[a-z0-9_]{1,80}$/.test(record.code)
      ? record.code
      : 'request_failed';
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return new ProblemException(status, `ai_worker_${upstreamCode}`, 'The AI workload capacity limit was reached.', true);
    }
    if ([HttpStatus.REQUEST_TIMEOUT, HttpStatus.BAD_GATEWAY, HttpStatus.SERVICE_UNAVAILABLE, HttpStatus.GATEWAY_TIMEOUT].includes(status)) {
      return new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, `ai_worker_${upstreamCode}`, 'The AI worker is temporarily unavailable.', true);
    }
    const safeStatus = [400, 404, 409, 413, 415, 422].includes(status) ? status : HttpStatus.BAD_GATEWAY;
    return new ProblemException(safeStatus, `ai_worker_${upstreamCode}`, 'The AI worker rejected the sanitized request.', false);
  }

  private validateStatus(value: unknown, context: RequestContext): JsonRecord {
    const record = this.responseRecord(value);
    this.enumValue(record.status, 'status', ['ready', 'degraded'] as const);
    if (!Array.isArray(record.providers) || record.providers.length > 10) throw new Error('providers');
    for (const item of record.providers) {
      const provider = this.responseRecord(item);
      this.enumValue(provider.provider, 'provider', ['llama', 'openai', 'anthropic', 'custom'] as const);
      if (typeof provider.configured !== 'boolean') throw new Error('configured');
      if (provider.model !== null && provider.model !== undefined) this.requiredString(provider.model, 'model');
      if (provider.live_provider_verified !== false) throw new Error('live provider verification');
    }
    if (!Array.isArray(record.agents) || record.agents.length !== AGENT_TYPES.length) throw new Error('agents');
    record.agents.forEach((agent) => this.enumValue(agent, 'agent', AGENT_TYPES));
    if (new Set(record.agents).size !== AGENT_TYPES.length) throw new Error('agents');
    this.requiredString(record.storage_backend, 'storage_backend');
    if (
      typeof record.durable_store_ready !== 'boolean'
      || typeof record.vector_configured !== 'boolean'
      || typeof record.vector_ready !== 'boolean'
    ) throw new Error('readiness');
    if (record.vector_ready === true && record.vector_configured !== true) throw new Error('vector readiness');
    if (!Array.isArray(record.retrieval_modes) || record.retrieval_modes.some((mode) => !['lexical', 'vector'].includes(String(mode)))) throw new Error('retrieval_modes');
    if (record.model_outputs_mutate_state !== false) throw new Error('mutation invariant');
    this.assertTenant(record, context);
    return record;
  }

  private validateActivity(value: unknown, context: RequestContext): JsonRecord {
    const record = this.responseRecord(value);
    const items = record.items;
    if (!Array.isArray(items) || items.length > 100) throw new Error('activity');
    for (const item of items) {
      const activity = this.responseRecord(item);
      this.uuid(activity.activity_id, 'activity_id');
      if (activity.tenant_id !== context.tenantId) throw new Error('activity tenant');
      this.uuid(activity.actor_id, 'actor_id');
      if (activity.agent_type !== null && activity.agent_type !== undefined) this.enumValue(activity.agent_type, 'agent_type', AGENT_TYPES);
      this.enumValue(activity.kind, 'kind', ['agent_run', 'document_import', 'retrieval', 'suggestion_review', 'learning_outcome'] as const);
      this.enumValue(activity.state, 'state', ['running', 'succeeded', 'failed'] as const);
      if (activity.provider !== null && activity.provider !== undefined) this.enumValue(activity.provider, 'provider', ['llama', 'openai', 'anthropic', 'custom'] as const);
      if (activity.model !== null && activity.model !== undefined) this.requiredString(activity.model, 'model');
      this.enumValue(activity.cost_status, 'cost_status', ['priced', 'unpriced', 'not_applicable'] as const);
      if (!Array.isArray(activity.evidence_ids)) throw new Error('evidence_ids');
      this.requiredString(activity.created_at, 'created_at');
    }
    this.assertTenant(record, context);
    return record;
  }

  private validateAgentRun(value: unknown, context: RequestContext): JsonRecord {
    const record = this.responseRecord(value);
    const runId = this.uuid(record.run_id, 'run_id');
    const suggestion = this.validateSuggestion(record.suggestion, context);
    if (suggestion.run_id !== runId) throw new Error('run binding');
    record.suggestion = suggestion;
    const audit = this.responseRecord(record.provider_audit);
    if (audit.provider_request_id !== undefined && audit.provider_request_id !== null) this.requiredString(audit.provider_request_id, 'provider_request_id');
    this.sha256(audit.request_sha256, 'request_sha256');
    this.sha256(audit.response_sha256, 'response_sha256');
    this.nonNegativeInteger(audit.latency_ms, 'latency_ms');
    this.assertTenant(record, context);
    return record;
  }

  private validateRetrieval(value: unknown, context: RequestContext): JsonRecord {
    const record = this.responseRecord(value);
    const items = record.items ?? record.results;
    if (!Array.isArray(items) || items.length > 20) throw new Error('items');
    for (const item of items) {
      const evidence = this.responseRecord(item);
      this.uuid(evidence.evidence_id, 'evidence_id');
      this.uuid(evidence.document_id, 'document_id');
      this.requiredString(evidence.source_locator, 'source_locator');
      this.requiredString(evidence.media_type, 'media_type');
      this.enumValue(evidence.classification, 'classification', ['public', 'internal', 'confidential', 'restricted'] as const);
      if (typeof evidence.snippet !== 'string' || typeof evidence.relevance !== 'number' || typeof evidence.confidence !== 'number') throw new Error('retrieval score');
      this.requiredString(evidence.indexed_at, 'indexed_at');
      if (!Array.isArray(evidence.security_flags)) throw new Error('security flags');
    }
    this.sha256(record.query_sha256, 'query_sha256');
    if (record.permission_trimmed !== true) throw new Error('permission invariant');
    this.assertTenant(record, context);
    return record;
  }

  private validateDocumentImport(
    value: unknown,
    context: RequestContext,
    documentId: string,
    classification: string,
    sourceAcl: JsonRecord,
  ): JsonRecord {
    const record = this.responseRecord(value);
    if (record.document_id !== documentId) throw new Error('document_id');
    this.uuid(record.import_id, 'import_id');
    this.enumValue(record.status, 'status', ['INDEXED', 'QUARANTINED'] as const);
    this.nonNegativeInteger(record.chunks_indexed, 'chunks_indexed');
    this.nonNegativeInteger(record.chunks_quarantined, 'chunks_quarantined');
    this.uuidArray(record.evidence_ids, 'evidence_ids', 1_000);
    this.requiredString(record.media_type, 'media_type');
    this.sha256(record.content_sha256, 'content_sha256');
    this.requiredString(record.parser, 'parser');
    this.requiredString(record.imported_at, 'imported_at');
    if (record.model_invoked !== false) throw new Error('model invocation invariant');
    this.assertTenant(record, context);
    return { ...record, classification, source_acl: sourceAcl };
  }

  private validateSuggestionReview(
    value: unknown,
    context: RequestContext,
    suggestionId: string,
    workerDecision: string,
    publicDecision: string,
    reason?: string,
  ): JsonRecord {
    const record = this.responseRecord(value);
    this.uuid(record.review_id, 'review_id');
    this.uuid(record.reviewer_id, 'reviewer_id');
    if (record.suggestion_id !== suggestionId || record.decision !== workerDecision) throw new Error('review binding');
    if (record.reviewer_id !== context.actor.actor_id) throw new Error('reviewer binding');
    if (record.suggestion_status !== 'PENDING_REVIEW' || record.mutation_performed !== false) throw new Error('mutation invariant');
    if (workerDecision === 'APPROVE') this.uuid(record.validated_memory_id, 'validated_memory_id');
    if (workerDecision === 'REJECT' && record.validated_memory_id !== null && record.validated_memory_id !== undefined) throw new Error('rejected memory invariant');
    this.requiredString(record.reviewed_at, 'reviewed_at');
    this.assertTenant(record, context);
    const result: JsonRecord = { ...record, decision: publicDecision };
    if (reason !== undefined) result.reason = reason;
    return result;
  }

  private validateLearningOutcome(
    value: unknown,
    context: RequestContext,
    suggestionId: string,
    publicValidation: 'confirmed' | 'corrected',
    evidenceIds: string[],
  ): JsonRecord {
    const record = this.responseRecord(value);
    this.uuid(record.memory_id, 'memory_id');
    if (record.suggestion_id !== suggestionId || record.reviewer_id !== context.actor.actor_id) {
      throw new Error('learning outcome binding');
    }
    this.uuid(record.reviewer_id, 'reviewer_id');
    if (record.status !== 'VALIDATED' || record.validation !== publicValidation.toUpperCase()) {
      throw new Error('learning validation');
    }
    const returnedEvidence = this.uuidArray(record.evidence_ids, 'evidence_ids', 100);
    if (
      returnedEvidence.length !== evidenceIds.length
      || returnedEvidence.some((item, index) => item !== evidenceIds[index])
    ) throw new Error('learning evidence binding');
    this.requiredString(record.persisted_at, 'persisted_at');
    if (record.graph_mutation_performed !== false || record.simulation_mutation_performed !== false) {
      throw new Error('learning mutation invariant');
    }
    this.assertTenant(record, context);
    return { ...record, validation: publicValidation };
  }

  private assertSafeWorkerValue(value: unknown, context: RequestContext, depth = 0): void {
    if (depth > 12) throw new Error('response nesting');
    if (Array.isArray(value)) {
      if (value.length > 1_000) throw new Error('response array');
      value.forEach((item) => this.assertSafeWorkerValue(item, context, depth + 1));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value as JsonRecord)) {
      const normalized = key.toLowerCase().replaceAll('-', '_');
      if (this.isSensitiveKey(normalized, RESPONSE_SECRET_KEYS)) throw new Error('secret-shaped response');
      if (normalized === 'tenant_id' && nested !== context.tenantId) throw new Error('cross-tenant response');
      this.assertSafeWorkerValue(nested, context, depth + 1);
    }
  }

  private sanitizeAgentInput(value: unknown): JsonRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw this.badRequest('invalid_agent_input', 'input must be a JSON object.');
    }
    if (Object.keys(value).length === 0) throw this.badRequest('invalid_agent_input', 'input must contain at least one field.');
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_AGENT_INPUT_BYTES) {
      throw new ProblemException(HttpStatus.PAYLOAD_TOO_LARGE, 'agent_input_too_large', `Agent input must not exceed ${MAX_AGENT_INPUT_BYTES} bytes.`);
    }
    return this.sanitizeJson(value, 0) as JsonRecord;
  }

  private sanitizeOutcome(value: unknown): JsonRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
      throw this.badRequest('invalid_outcome', 'outcome must be a non-empty JSON object.');
    }
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_AGENT_INPUT_BYTES) {
      throw new ProblemException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'outcome_too_large',
        `outcome must not exceed ${MAX_AGENT_INPUT_BYTES} bytes.`,
      );
    }
    return this.sanitizeJson(value, 0) as JsonRecord;
  }

  private offsetDateTime(value: unknown, label: string): string {
    const raw = this.boundedString(value, label, 20, 40);
    if (!/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(raw) || Number.isNaN(Date.parse(raw))) {
      throw this.badRequest(`invalid_${label}`, `${label} must be an RFC 3339 timestamp with an explicit offset.`);
    }
    return new Date(raw).toISOString();
  }

  private sanitizeJson(value: unknown, depth: number): unknown {
    if (depth > 8) throw this.badRequest('agent_input_too_deep', 'Agent input nesting exceeds the supported limit.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.length > MAX_TEXT_FIELD) throw this.badRequest('agent_input_field_too_large', 'An agent input text field exceeds the supported limit.');
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw this.badRequest('invalid_agent_input_number', 'Agent input numbers must be finite.');
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > 100) throw this.badRequest('agent_input_array_too_large', 'Agent input arrays are limited to 100 items.');
      return value.map((item) => this.sanitizeJson(item, depth + 1));
    }
    if (!value || typeof value !== 'object') throw this.badRequest('invalid_agent_input', 'Agent input must contain only JSON values.');
    const entries = Object.entries(value as JsonRecord);
    if (entries.length > 100) throw this.badRequest('agent_input_object_too_large', 'Agent input objects are limited to 100 fields.');
    const output: JsonRecord = {};
    for (const [key, nested] of entries) {
      const normalized = key.toLowerCase().replaceAll('-', '_');
      if (['context_evidence', 'digital_twin_context', 'server_context', 'system_context'].includes(normalized)) {
        throw this.badRequest('server_derived_agent_field', `${key.slice(0, 64)} is reserved for server-derived AI context.`);
      }
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || this.isSensitiveKey(normalized, SENSITIVE_KEYS) || key === '__proto__' || key === 'constructor') {
        throw this.badRequest('unsafe_agent_input_field', `Agent input field ${key.slice(0, 64)} is not permitted.`);
      }
      output[key] = this.sanitizeJson(nested, depth + 1);
    }
    return output;
  }

  private base64Document(value: unknown): string {
    if (typeof value !== 'string' || value.length < 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
      throw this.badRequest('invalid_document_encoding', 'content_base64 must be canonical base64.');
    }
    const encoded = value;
    if (encoded.length > MAX_DOCUMENT_BASE64_CHARS) {
      throw new ProblemException(HttpStatus.PAYLOAD_TOO_LARGE, 'document_too_large', `The decoded document must not exceed ${MAX_DOCUMENT_BYTES} bytes.`);
    }
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length === 0 || decoded.toString('base64') !== encoded) throw this.badRequest('invalid_document_encoding', 'content_base64 must be canonical base64.');
    if (decoded.length > MAX_DOCUMENT_BYTES) throw new ProblemException(HttpStatus.PAYLOAD_TOO_LARGE, 'document_too_large', `The decoded document must not exceed ${MAX_DOCUMENT_BYTES} bytes.`);
    return encoded;
  }

  private requireAgentCapability(context: RequestContext, agentType: AgentType): void {
    const required: Record<AgentType, string> = {
      knowledge_ingestion: 'connector.admin',
      entity_resolution: 'connector.admin',
      event_understanding: 'scenario.create',
      causal_analysis: 'simulation.run',
      simulation_planning: 'simulation.run',
      prediction_explanation: 'simulation.run',
      technical_knowledge: 'connector.admin',
      marketing_analyst: 'simulation.run',
    };
    this.requireCapability(context, required[agentType], 'ai_agent_capability_denied', 'The authenticated actor is not permitted to run this AI capability.');
  }

  private requireAiRead(context: RequestContext): void {
    if (context.actor.capabilities.includes('connector.admin') || context.actor.capabilities.some((item) => item.startsWith('evidence.read.'))) return;
    throw new ProblemException(HttpStatus.FORBIDDEN, 'ai_read_denied', 'AI tenant content access is not authorized.');
  }

  private requireEvidenceRead(context: RequestContext): void {
    if (context.actor.capabilities.some((item) => item.startsWith('evidence.read.'))) return;
    throw new ProblemException(HttpStatus.FORBIDDEN, 'ai_retrieval_denied', 'Permission-aware retrieval is not authorized.');
  }

  private requireCapability(context: RequestContext, capability: string, code: string, detail: string): void {
    if (!context.actor.capabilities.includes(capability)) throw new ProblemException(HttpStatus.FORBIDDEN, code, detail);
  }

  private contentPermissions(context: RequestContext): string[] {
    return context.actor.capabilities.filter((item) => item === 'connector.admin' || item.startsWith('evidence.read.')).sort();
  }

  private internalPermissions(context: RequestContext): string[] {
    const trustedWorkerCapabilities: string[] = [];
    if (context.actor.capabilities.some((item) => item.startsWith('evidence.read.'))) {
      trustedWorkerCapabilities.push('knowledge.read', 'ai.read');
    }
    if (context.actor.capabilities.includes('connector.admin')) {
      trustedWorkerCapabilities.push('knowledge.import', 'ai.review', 'ai.read', 'ai.run');
    }
    if (context.actor.capabilities.includes('scenario.create') || context.actor.capabilities.includes('simulation.run')) {
      trustedWorkerCapabilities.push('ai.run');
    }
    return [...new Set([
      ...context.actor.capabilities,
      ...context.actor.roles.map((role) => `role:${role}`),
      ...trustedWorkerCapabilities,
    ])].sort();
  }

  private contextEvidence(context: RequestContext, agentType: AgentType, input: JsonRecord): JsonRecord[] {
    if (agentType === 'event_understanding') {
      const content = this.boundedContextContent({
        trust: 'untrusted_user_input',
        instructions_allowed: false,
        statement: input,
      });
      return [this.contextEvidenceItem(
        context,
        'user_input',
        `edt://user-input/events/${this.contentHash(content).slice(0, 24)}`,
        content,
        'internal',
        1,
        'ai.run',
      )];
    }
    if (!['causal_analysis', 'simulation_planning', 'prediction_explanation', 'marketing_analyst'].includes(agentType)) return [];
    const evidence: JsonRecord[] = [];
    const traversal = this.store.traverse(context, { template: 'delivery_dependencies', max_nodes: 25 });
    const graphNodes = Array.isArray(traversal.nodes) ? traversal.nodes.slice(0, 20) : [];
    const visibleGraphRefs = new Set<string>();
    for (const node of graphNodes) {
      const record = this.recordOrUndefined(node);
      if (typeof record?.entity_id === 'string') visibleGraphRefs.add(record.entity_id);
      const properties = this.recordOrUndefined(record?.properties);
      if (typeof properties?.key === 'string') visibleGraphRefs.add(properties.key);
    }
    const graphRelationships = (Array.isArray(traversal.relationships) ? traversal.relationships : [])
      .filter((item) => {
        const relationship = this.recordOrUndefined(item);
        const from = relationship?.from ?? relationship?.from_entity_id;
        const to = relationship?.to ?? relationship?.to_entity_id;
        return typeof from === 'string' && typeof to === 'string' && visibleGraphRefs.has(from) && visibleGraphRefs.has(to);
      })
      .slice(0, 60);
    const graphContent = this.boundedContextContent({
      trust: 'untrusted_data',
      instructions_allowed: false,
      nodes: graphNodes,
      relationships: graphRelationships,
      truncated: traversal.truncated,
      projection_generation: traversal.projection_generation,
      data_watermark: traversal.data_watermark,
    });
    evidence.push(this.contextEvidenceItem(
      context,
      'graph',
      `edt://graph/permission-filtered/${this.contentHash(graphContent).slice(0, 24)}`,
      graphContent,
      this.contextClassification(traversal.nodes),
      1,
      'knowledge.read',
    ));

    const eventId = input.event_id === undefined ? undefined : this.uuid(input.event_id, 'event_id');
    const recentEvents = eventId
      ? [this.events.getEvent(context, eventId)]
      : this.events.listEvents(context, '5').items.slice(-5);
    for (const event of recentEvents) {
      const content = this.boundedContextContent({
        trust: 'untrusted_data',
        instructions_allowed: false,
        event_id: event.event_id,
        version: event.version,
        status: event.status,
        event_type: event.event_type,
        statement: event.statement,
        occurred_at: event.occurred_at,
        confidence: event.confidence,
        verification_status: event.verification_status,
        mode: event.mode,
        related_entities: event.related_entities.slice(0, 20),
        evidence: event.evidence.slice(0, 20),
        impacts: event.impacts.slice(0, 20),
        causal_graph: event.causal_graph,
        unknown_effects: event.unknown_effects.slice(0, 20),
        graph_snapshot_version: event.graph_snapshot_version,
        graph_snapshot_hash: event.graph_snapshot_hash,
      });
      evidence.push(this.contextEvidenceItem(
        context,
        'event',
        `edt://events/${event.event_id}/versions/${event.version}`,
        content,
        'internal',
        event.confidence.score,
        'knowledge.read',
      ));
    }

    if (input.simulation_id !== undefined) {
      const simulationId = this.uuid(input.simulation_id, 'simulation_id');
      const simulation = this.store.getSimulation(context, simulationId);
      const content = this.boundedContextContent({
        trust: 'untrusted_data',
        instructions_allowed: false,
        ...simulation,
      });
      evidence.push(this.contextEvidenceItem(
        context,
        'simulation',
        `edt://simulations/${simulationId}`,
        content,
        'internal',
        1,
        'simulation.run',
      ));
    }
    if (evidence.length > 50) throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'ai_context_limit_exceeded', 'The bounded server-derived AI context exceeded its evidence-item limit.');
    return evidence;
  }

  private contextEvidenceItem(
    context: RequestContext,
    sourceType: 'graph' | 'event' | 'simulation' | 'prediction' | 'user_input',
    sourceLocator: string,
    content: string,
    classification: 'public' | 'internal' | 'confidential' | 'restricted',
    confidence: number,
    requiredPermission: string,
  ): JsonRecord {
    return {
      evidence_id: this.stableUuid(`ai-context:${context.tenantId}:${sourceType}:${sourceLocator}:${this.contentHash(content)}`),
      source_locator: sourceLocator,
      content,
      source_type: sourceType,
      classification,
      confidence: Math.max(0, Math.min(1, confidence)),
      source_acl: {
        visibility: 'private',
        allowed_actor_ids: [context.actor.actor_id],
        allowed_roles: [],
        required_permissions: [requiredPermission],
      },
    };
  }

  private boundedContextContent(value: unknown): string {
    const serialized = JSON.stringify(this.sanitizeServerContext(value, 0));
    if (Buffer.byteLength(serialized, 'utf8') <= 4_000) return serialized;
    let preview = serialized.slice(0, 3_500);
    let bounded = JSON.stringify({
      trust: 'untrusted_data',
      instructions_allowed: false,
      truncated: true,
      full_content_sha256: this.contentHash(serialized),
      preview,
    });
    while (Buffer.byteLength(bounded, 'utf8') > 4_000 && preview.length > 500) {
      preview = preview.slice(0, preview.length - 250);
      bounded = JSON.stringify({
        trust: 'untrusted_data',
        instructions_allowed: false,
        truncated: true,
        full_content_sha256: this.contentHash(serialized),
        preview,
      });
    }
    return bounded;
  }

  private sanitizeServerContext(value: unknown, depth: number): unknown {
    if (depth > 6) return '[depth-limited]';
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return value.slice(0, 1_000);
    if (Array.isArray(value)) return value.slice(0, 25).map((item) => this.sanitizeServerContext(item, depth + 1));
    if (!value || typeof value !== 'object') return null;
    const result: JsonRecord = {};
    for (const [key, nested] of Object.entries(value as JsonRecord).slice(0, 40)) {
      const normalized = key.toLowerCase().replaceAll('-', '_');
      if (normalized === 'tenant_id' || this.isSensitiveKey(normalized, RESPONSE_SECRET_KEYS)) continue;
      result[key] = this.sanitizeServerContext(nested, depth + 1);
    }
    return result;
  }

  private contextClassification(nodes: unknown): 'internal' | 'restricted' {
    if (!Array.isArray(nodes)) return 'internal';
    return nodes.some((node) => this.recordOrUndefined(node)?.classification === 'restricted') ? 'restricted' : 'internal';
  }

  private contentHash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private sourceAcl(value: unknown): JsonRecord {
    if (value === undefined) return { visibility: 'private' };
    const record = this.strictRecord(value, 'source_acl', ['visibility']);
    const visibility = this.enumValue(record.visibility, 'source_acl_visibility', ['private'] as const);
    return { visibility };
  }

  private validateSuggestions(value: unknown, context: RequestContext): JsonRecord {
    const record = this.responseRecord(value);
    if (!Array.isArray(record.items) || record.items.length > 100) throw new Error('suggestions');
    const mayReviewTenantSuggestions = context.actor.capabilities.includes('connector.admin');
    record.items = record.items.map((item) => this.validateSuggestion(item, context, !mayReviewTenantSuggestions));
    this.assertTenant(record, context);
    return record;
  }

  private validateSuggestion(value: unknown, context: RequestContext, requireCurrentActor = true): JsonRecord {
    const suggestion = this.responseRecord(value);
    this.uuid(suggestion.suggestion_id, 'suggestion_id');
    this.uuid(suggestion.run_id, 'run_id');
    if (suggestion.tenant_id !== context.tenantId) throw new Error('suggestion tenant binding');
    this.uuid(suggestion.actor_id, 'actor_id');
    if (requireCurrentActor && suggestion.actor_id !== context.actor.actor_id) throw new Error('suggestion actor binding');
    this.enumValue(suggestion.agent_type, 'agent_type', AGENT_TYPES);
    if (suggestion.status !== 'PENDING_REVIEW' || suggestion.mutation_performed !== false) throw new Error('suggestion mutation invariant');
    if (typeof suggestion.confidence !== 'number' || suggestion.confidence < 0 || suggestion.confidence > 1) throw new Error('confidence');
    if (!Array.isArray(suggestion.evidence) || suggestion.evidence.length < 1 || suggestion.evidence.length > 100) throw new Error('evidence');
    for (const item of suggestion.evidence) {
      const evidence = this.responseRecord(item);
      this.uuid(evidence.evidence_id, 'evidence_id');
      this.requiredString(evidence.source_locator, 'source_locator');
    }
    this.responseRecord(suggestion.output);
    this.enumValue(suggestion.provider, 'provider', ['llama', 'openai', 'anthropic', 'custom'] as const);
    this.requiredString(suggestion.model, 'model');
    const usage = this.responseRecord(suggestion.usage);
    this.nonNegativeInteger(usage.input_tokens, 'input_tokens');
    this.nonNegativeInteger(usage.output_tokens, 'output_tokens');
    this.nonNegativeInteger(usage.total_tokens, 'total_tokens');
    if ((usage.total_tokens as number) < (usage.input_tokens as number) + (usage.output_tokens as number)) throw new Error('token total');
    if (suggestion.cost_usd !== null && suggestion.cost_usd !== undefined && typeof suggestion.cost_usd !== 'number' && typeof suggestion.cost_usd !== 'string') throw new Error('cost');
    this.enumValue(suggestion.cost_status, 'cost_status', ['priced', 'unpriced'] as const);
    if (typeof suggestion.cached !== 'boolean') throw new Error('cached');
    this.requiredString(suggestion.created_at, 'created_at');
    const result: JsonRecord = { ...suggestion };
    delete result.effective_review;
    if (suggestion.effective_review !== undefined && suggestion.effective_review !== null) {
      const review = this.responseRecord(suggestion.effective_review);
      this.uuid(review.review_id, 'review_id');
      this.uuid(review.reviewer_id, 'reviewer_id');
      const decision = this.enumValue(review.decision, 'decision', ['APPROVE', 'REJECT'] as const);
      this.requiredString(review.reviewed_at, 'reviewed_at');
      result.review_decision = decision.toLowerCase();
      result.reviewed_at = review.reviewed_at;
    }
    return result;
  }

  private strictRecord(value: unknown, label: string, allowed: readonly string[]): JsonRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw this.badRequest('invalid_ai_request', `${label} must be a JSON object.`);
    const record = value as JsonRecord;
    const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
    if (unknown.length) throw this.badRequest('unknown_ai_request_field', `${label} contains unsupported field(s): ${unknown.sort().join(', ')}.`);
    return record;
  }

  private pageSize(value: string | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    return this.integer(Number(value), 'page_size', 1, 100);
  }

  private workerIdempotencyKey(value: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value)) {
      throw this.badRequest('invalid_idempotency_key', 'Idempotency-Key must contain 16 to 128 safe characters.');
    }
    return value;
  }

  private integer(value: unknown, label: string, minimum: number, maximum: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
      throw this.badRequest(`invalid_${label}`, `${label} must be an integer from ${minimum} to ${maximum}.`);
    }
    return value;
  }

  private number(value: unknown, label: string, minimum: number, maximum: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      throw this.badRequest(`invalid_${label}`, `${label} must be between ${minimum} and ${maximum}.`);
    }
    return value;
  }

  private boundedString(value: unknown, label: string, minimum: number, maximum: number, pattern?: RegExp): string {
    if (typeof value !== 'string' || value.length < minimum || value.length > maximum || (pattern && !pattern.test(value))) {
      throw this.badRequest(`invalid_${label}`, `${label} must be a valid string containing ${minimum} to ${maximum} characters.`);
    }
    return value;
  }

  private requiredString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length < 1 || value.length > 5_000) throw new Error(label);
    return value;
  }

  private enumValue<T extends string>(value: unknown, label: string, values: readonly T[]): T {
    if (typeof value !== 'string' || !values.includes(value as T)) {
      throw this.badRequest(`invalid_${label}`, `${label} must be one of: ${values.join(', ')}.`);
    }
    return value as T;
  }

  private uuid(value: unknown, label: string): string {
    return this.boundedString(value, label, 36, 36, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  }

  private uuidArray(value: unknown, label: string, maximum: number): string[] {
    if (!Array.isArray(value) || value.length > maximum) throw this.badRequest(`invalid_${label}`, `${label} must be an array containing no more than ${maximum} UUIDs.`);
    const result = value.map((item) => this.uuid(item, label));
    if (new Set(result).size !== result.length) throw this.badRequest(`invalid_${label}`, `${label} must not contain duplicates.`);
    return result;
  }

  private sha256(value: unknown, label: string): string {
    return this.boundedString(value, label, 64, 64, /^[a-f0-9]{64}$/);
  }

  private nonNegativeInteger(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(label);
    return value;
  }

  private responseRecord(value: unknown): JsonRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('response object');
    return value as JsonRecord;
  }

  private recordOrUndefined(value: unknown): JsonRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
  }

  private isSensitiveKey(normalized: string, exact: ReadonlySet<string>): boolean {
    return exact.has(normalized)
      || /(^|_)(api_key|authorization|cookie|credentials?|password|secret|service_token|access_token|refresh_token)$/.test(normalized);
  }

  private stableUuid(value: string): string {
    const bytes = createHash('sha256').update(value, 'utf8').digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  private assertTenant(record: JsonRecord, context: RequestContext): void {
    if (record.tenant_id !== undefined && record.tenant_id !== context.tenantId) throw new Error('tenant');
  }

  private isAbort(error: unknown): boolean {
    return error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
  }

  private invalidWorkerResponse(): ProblemException {
    return new ProblemException(HttpStatus.BAD_GATEWAY, 'invalid_ai_worker_response', 'The AI worker returned a response that failed gateway validation.', false);
  }

  private badRequest(code: string, detail: string): ProblemException {
    return new ProblemException(HttpStatus.BAD_REQUEST, code, detail, false);
  }
}
