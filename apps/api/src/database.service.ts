import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { sha256 } from './domain';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface EventMutationRecord<TPayload = unknown> {
  kind: string;
  id: string;
  payload: TPayload;
}

export interface EventMutationAudit {
  audit_id: string;
  tenant_sequence: number;
  action: string;
  actor_id: string;
  resource_type: string;
  resource_id: string;
  occurred_at: string;
  request_id: string;
  trace_id: string;
  details_hash: string;
  previous_hash: string;
  event_hash: string;
}

export interface EventMutationOutbox<TPayload = unknown> {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: TPayload;
}

export interface EventMutationCommitResult {
  outboxPosition: number;
  replayed?: boolean;
  responseRef?: string;
}

export interface EventMutationIdempotencyGuard {
  operation: string;
  key: string;
  requestHash: string;
  responseRef: string;
  expiresAt: string;
}

export interface EventMutationExpectedRecord {
  kind: string;
  id: string;
  expected: Record<string, JsonPrimitive>;
}

export interface EventMutationGuard {
  idempotency: EventMutationIdempotencyGuard;
  expectedRecords: readonly EventMutationExpectedRecord[];
}

export class DatabaseMutationConflict extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'DatabaseMutationConflict';
  }
}

export interface InMemoryOutboxEntry {
  readonly tenantId: string;
  readonly outboxPosition: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly payload: JsonValue;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly inMemoryOutboxByTenant = new Map<string, InMemoryOutboxEntry[]>();
  private readonly inMemoryRecords = new Map<string, unknown>();
  private readonly inMemoryIdempotency = new Map<string, { requestHash: string; responseRef: string; outboxPosition: number }>();
  private readonly inMemoryAuditTail = new Map<string, EventMutationAudit>();
  private nextInMemoryOutboxPosition = 1;
  private initialization?: Promise<void>;
  private pool?: Pool;

  onModuleInit(): Promise<void> {
    return this.ready();
  }

  ready(): Promise<void> {
    this.initialization ??= this.initialize();
    return this.initialization;
  }

  private async initialize(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) {
      if (process.env.EDT_REQUIRE_POSTGRES === 'true') throw new Error('DATABASE_URL is required');
      this.logger.warn('DATABASE_URL is unset; using the explicit synthetic in-memory test profile.');
      return;
    }
    this.pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, statement_timeout: 5_000 });
    await this.pool.query('select 1');
    if (process.env.EDT_AUTO_MIGRATE !== 'false') await this.migrate();
    this.logger.log('PostgreSQL authoritative record store connected.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  get enabled(): boolean {
    return Boolean(this.pool);
  }

  async put(tenantId: string, kind: string, id: string, payload: unknown): Promise<void> {
    if (!this.pool) {
      if (kind === 'event_audit_evidence') {
        const audit = this.asEventMutationAudit(payload);
        this.bindAuditToTail(tenantId, audit, this.inMemoryAuditTail.get(tenantId));
        this.inMemoryAuditTail.set(tenantId, structuredClone(audit));
      }
      const serialized = JSON.stringify(payload);
      if (serialized === undefined) throw new TypeError(`record ${kind}/${id} is not JSON-serializable.`);
      this.inMemoryRecords.set(this.inMemoryRecordKey(tenantId, kind, id), JSON.parse(serialized) as unknown);
      return;
    }
    if (kind === 'event_audit_evidence') {
      const audit = this.asEventMutationAudit(payload);
      await this.withTenant(tenantId, async (client) => {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [tenantId]);
        const tail = await client.query<{ tenant_sequence: string; event_hash: string }>(
          `select tenant_sequence, event_hash
             from edt.audit_events
            where tenant_id = $1::uuid
            order by edt.audit_events.tenant_sequence desc
            limit 1`,
          [tenantId],
        );
        const tailRow = tail.rows[0];
        this.bindAuditToTail(tenantId, audit, tailRow ? {
          ...audit,
          tenant_sequence: Number(tailRow.tenant_sequence),
          event_hash: tailRow.event_hash,
        } : undefined);
        const serialized = this.serializeJson(audit, 'audit payload');
        await this.upsertRecord(client, tenantId, kind, id, serialized);
        await client.query(
          `insert into edt.audit_events(
             tenant_id, tenant_sequence, event_id, payload, previous_hash, event_hash, occurred_at
           )
           values ($1::uuid, $2, $3::uuid, $4::jsonb, $5, $6, $7::timestamptz)`,
          [tenantId, audit.tenant_sequence, audit.audit_id, serialized, audit.previous_hash, audit.event_hash, audit.occurred_at],
        );
      });
      return;
    }
    await this.withTenant(tenantId, async (client) => {
      await client.query(
        `insert into edt.records(tenant_id, kind, record_id, payload)
         values ($1::uuid, $2, $3::uuid, $4::jsonb)
         on conflict (tenant_id, kind, record_id)
         do update set payload = excluded.payload, updated_at = transaction_timestamp()`,
        [tenantId, kind, id, JSON.stringify(payload)],
      );
    });
  }

  async get<T>(tenantId: string, kind: string, id: string): Promise<T | undefined> {
    if (!this.pool) {
      const value = this.inMemoryRecords.get(this.inMemoryRecordKey(tenantId, kind, id));
      return value === undefined ? undefined : structuredClone(value) as T;
    }
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<{ payload: T }>(
        'select payload from edt.records where tenant_id = $1::uuid and kind = $2 and record_id = $3::uuid',
        [tenantId, kind, id],
      );
      return result.rows[0]?.payload;
    });
  }

  async list<T>(tenantId: string, kind: string): Promise<T[]> {
    if (!this.pool) {
      const prefix = `${tenantId}:${kind}:`;
      return [...this.inMemoryRecords.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, value]) => structuredClone(value) as T);
    }
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<{ payload: T }>(
        'select payload from edt.records where tenant_id = $1::uuid and kind = $2 order by created_at, record_id',
        [tenantId, kind],
      );
      return result.rows.map((row) => row.payload);
    });
  }

  async commitEventMutation<TRecordPayload = unknown, TOutboxPayload = unknown>(
    tenantId: string,
    records: readonly EventMutationRecord<TRecordPayload>[],
    audit: EventMutationAudit,
    outbox: EventMutationOutbox<TOutboxPayload>,
    guard?: EventMutationGuard,
  ): Promise<EventMutationCommitResult> {
    this.serializeJson(outbox.payload, 'outbox payload');
    if (guard) this.validateGuard(guard);

    if (!this.pool) {
      const replay = guard ? this.inMemoryReplay(tenantId, guard) : undefined;
      if (replay) return replay;
      if (guard) this.assertInMemoryExpectedRecords(tenantId, guard.expectedRecords);
      const existing = this.findInMemoryOutbox(outbox.eventId);
      if (existing && existing.tenantId !== tenantId) {
        throw new Error(`Outbox event ${outbox.eventId} already belongs to another tenant.`);
      }
      const outboxPosition = existing?.outboxPosition ?? this.nextInMemoryOutboxPosition;
      if (existing) return { outboxPosition };

      this.bindAuditToTail(tenantId, audit, this.inMemoryAuditTail.get(tenantId));
      const positionedOutboxPayload = this.serializeJson(
        this.withOutboxPosition(outbox.payload, outboxPosition),
        'outbox payload',
      );
      const positionedRecords = records.map((record) => ({
        ...record,
        payload: this.jsonClone(
          this.withOutboxPosition(record.payload, outboxPosition),
          `record ${record.kind}/${record.id}`,
        ),
      }));
      const auditPayload = this.jsonClone(audit, 'audit payload');
      const entry: InMemoryOutboxEntry = {
        tenantId,
        outboxPosition,
        eventId: outbox.eventId,
        eventType: outbox.eventType,
        aggregateType: outbox.aggregateType,
        aggregateId: outbox.aggregateId,
        aggregateVersion: outbox.aggregateVersion,
        payload: JSON.parse(positionedOutboxPayload) as JsonValue,
      };
      for (const record of positionedRecords) {
        this.inMemoryRecords.set(this.inMemoryRecordKey(tenantId, record.kind, record.id), record.payload);
      }
      this.inMemoryRecords.set(this.inMemoryRecordKey(tenantId, 'event_audit_evidence', audit.audit_id), auditPayload);
      this.inMemoryOutboxByTenant.set(tenantId, [...(this.inMemoryOutboxByTenant.get(tenantId) ?? []), entry]);
      this.inMemoryAuditTail.set(tenantId, structuredClone(audit));
      if (guard) {
        this.inMemoryIdempotency.set(this.inMemoryIdempotencyKey(tenantId, guard), {
          requestHash: guard.idempotency.requestHash,
          responseRef: guard.idempotency.responseRef,
          outboxPosition,
        });
      }
      this.nextInMemoryOutboxPosition += 1;
      return { outboxPosition };
    }

    return this.withTenant(tenantId, async (client) => {
      // One tenant-scoped transaction at a time owns the audit tail and mutation
      // guards. The row-level comparisons below remain the actual CAS predicates.
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [tenantId]);
      if (guard) {
        const replay = await this.reserveIdempotency(client, tenantId, guard);
        if (replay) return replay;
        await this.assertExpectedRecords(client, tenantId, guard.expectedRecords);
      }
      const tail = await client.query<{ tenant_sequence: string; event_hash: string }>(
        `select tenant_sequence, event_hash
           from edt.audit_events
          where tenant_id = $1::uuid
          order by edt.audit_events.tenant_sequence desc
          limit 1`,
        [tenantId],
      );
      const tailRow = tail.rows[0];
      this.bindAuditToTail(tenantId, audit, tailRow ? {
        ...audit,
        tenant_sequence: Number(tailRow.tenant_sequence),
        event_hash: tailRow.event_hash,
      } : undefined);
      const serializedOutboxPayload = this.serializeJson(outbox.payload, 'outbox payload');
      const serializedAudit = this.serializeJson(audit, 'audit payload');
      const outboxResult = await client.query<{ outbox_id: string }>(
        `with inserted as (
           insert into edt.outbox(
             tenant_id, event_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload
           )
           values ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7::jsonb)
           on conflict (event_id) do nothing
           returning outbox_id
         )
         select outbox_id from inserted
         union all
         select outbox_id from edt.outbox
          where tenant_id = $1::uuid and event_id = $2::uuid
         limit 1`,
        [
          tenantId,
          outbox.eventId,
          outbox.eventType,
          outbox.aggregateType,
          outbox.aggregateId,
          outbox.aggregateVersion,
          serializedOutboxPayload,
        ],
      );
      const outboxPosition = Number(outboxResult.rows[0]?.outbox_id);
      if (!Number.isSafeInteger(outboxPosition) || outboxPosition < 1) {
        throw new Error(`Outbox event ${outbox.eventId} could not be reserved for tenant ${tenantId}.`);
      }
      const positionedOutboxPayload = this.serializeJson(
        this.withOutboxPosition(outbox.payload, outboxPosition),
        'outbox payload',
      );
      await client.query(
        `update edt.outbox
            set payload = $3::jsonb
          where tenant_id = $1::uuid and event_id = $2::uuid`,
        [tenantId, outbox.eventId, positionedOutboxPayload],
      );

      for (const record of records) {
        await this.upsertRecord(
          client,
          tenantId,
          record.kind,
          record.id,
          this.serializeJson(this.withOutboxPosition(record.payload, outboxPosition), `record ${record.kind}/${record.id}`),
        );
      }
      await this.upsertRecord(client, tenantId, 'event_audit_evidence', audit.audit_id, serializedAudit);
      await client.query(
        `insert into edt.audit_events(
           tenant_id, tenant_sequence, event_id, payload, previous_hash, event_hash, occurred_at
         )
         values ($1::uuid, $2, $3::uuid, $4::jsonb, $5, $6, $7::timestamptz)`,
        [
          tenantId,
          audit.tenant_sequence,
          audit.audit_id,
          serializedAudit,
          audit.previous_hash,
          audit.event_hash,
          audit.occurred_at,
        ],
      );
      if (guard) {
        await client.query(
          `update edt.idempotency
              set state = 'succeeded', response_ref = $4::uuid
            where tenant_id = $1::uuid and operation = $2 and idempotency_key = $3`,
          [tenantId, guard.idempotency.operation, guard.idempotency.key, guard.idempotency.responseRef],
        );
      }
      return { outboxPosition };
    });
  }

  getInMemoryOutbox(tenantId: string): readonly InMemoryOutboxEntry[] {
    return Object.freeze((this.inMemoryOutboxByTenant.get(tenantId) ?? []).map((entry) => Object.freeze({
      ...entry,
      payload: JSON.parse(JSON.stringify(entry.payload)) as JsonValue,
    })));
  }

  async health(): Promise<'connected' | 'in_memory'> {
    if (!this.pool) return 'in_memory';
    await this.pool.query('select 1');
    return 'connected';
  }

  private validateGuard(guard: EventMutationGuard): void {
    const { idempotency } = guard;
    if (!idempotency.operation.trim() || idempotency.operation.length > 500) {
      throw new TypeError('Event mutation idempotency operation is invalid.');
    }
    if (idempotency.key.length < 16 || idempotency.key.length > 128) {
      throw new TypeError('Event mutation idempotency key must contain 16 to 128 characters.');
    }
    if (!/^[a-f0-9]{64}$/.test(idempotency.requestHash)) {
      throw new TypeError('Event mutation idempotency request hash is invalid.');
    }
    if (!idempotency.responseRef || Number.isNaN(new Date(idempotency.expiresAt).getTime())) {
      throw new TypeError('Event mutation idempotency response reference or expiry is invalid.');
    }
    for (const record of guard.expectedRecords) {
      if (!record.kind || !record.id || !Object.keys(record.expected).length) {
        throw new TypeError('Every authoritative event mutation record guard must declare expected fields.');
      }
      this.serializeJson(record.expected, `guard ${record.kind}/${record.id}`);
    }
  }

  private inMemoryReplay(tenantId: string, guard: EventMutationGuard): EventMutationCommitResult | undefined {
    const existing = this.inMemoryIdempotency.get(this.inMemoryIdempotencyKey(tenantId, guard));
    if (!existing) return undefined;
    if (existing.requestHash !== guard.idempotency.requestHash) {
      throw new DatabaseMutationConflict('idempotency_key_reused', 'The Idempotency-Key was already used with a different request.');
    }
    return { outboxPosition: existing.outboxPosition, replayed: true, responseRef: existing.responseRef };
  }

  private assertInMemoryExpectedRecords(tenantId: string, records: readonly EventMutationExpectedRecord[]): void {
    for (const record of records) {
      const payload = this.inMemoryRecords.get(this.inMemoryRecordKey(tenantId, record.kind, record.id));
      this.assertExpectedPayload(record, payload);
    }
  }

  private async reserveIdempotency(
    client: PoolClient,
    tenantId: string,
    guard: EventMutationGuard,
  ): Promise<EventMutationCommitResult | undefined> {
    const { idempotency } = guard;
    const inserted = await client.query(
      `insert into edt.idempotency(
         tenant_id, operation, idempotency_key, request_hash, response_ref, state, expires_at
       )
       values ($1::uuid, $2, $3, $4, $5::uuid, 'running', $6::timestamptz)
       on conflict (tenant_id, operation, idempotency_key)
       do update set request_hash = excluded.request_hash,
                     response_ref = excluded.response_ref,
                     state = 'running',
                     created_at = transaction_timestamp(),
                     expires_at = excluded.expires_at
         where edt.idempotency.expires_at <= transaction_timestamp()
       returning response_ref`,
      [tenantId, idempotency.operation, idempotency.key, idempotency.requestHash, idempotency.responseRef, idempotency.expiresAt],
    );
    if (inserted.rows.length) return undefined;

    const existing = await client.query<{ request_hash: string; response_ref: string | null; state: string }>(
      `select request_hash::text, response_ref::text, state
         from edt.idempotency
        where tenant_id = $1::uuid and operation = $2 and idempotency_key = $3
        for update`,
      [tenantId, idempotency.operation, idempotency.key],
    );
    const row = existing.rows[0];
    if (!row) throw new DatabaseMutationConflict('idempotency_state_missing', 'The authoritative idempotency reservation is unavailable.');
    if (row.request_hash !== idempotency.requestHash) {
      throw new DatabaseMutationConflict('idempotency_key_reused', 'The Idempotency-Key was already used with a different request.');
    }
    if (row.state !== 'succeeded' || !row.response_ref) {
      throw new DatabaseMutationConflict('idempotency_request_in_progress', 'An identical event mutation is already in progress.');
    }
    const receipt = await client.query<{ payload: { outbox_position?: unknown } }>(
      `select payload
         from edt.records
        where tenant_id = $1::uuid and kind = 'event_action_receipt' and record_id = $2::uuid`,
      [tenantId, row.response_ref],
    );
    let outboxPosition = Number(receipt.rows[0]?.payload?.outbox_position);
    // Generic domain mutations (for example, graph history events) use their
    // durable history event as the idempotency response reference rather than
    // manufacturing an action receipt. Their transactional outbox payload
    // binds that response reference through history_event_id.
    if (!Number.isSafeInteger(outboxPosition) || outboxPosition < 1) {
      const historyOutbox = await client.query<{ outbox_id: string }>(
        `select outbox_id
           from edt.outbox
          where tenant_id = $1::uuid
            and payload->>'history_event_id' = $2::text
          order by outbox_id desc
          limit 1`,
        [tenantId, row.response_ref],
      );
      outboxPosition = Number(historyOutbox.rows[0]?.outbox_id);
    }
    if (!Number.isSafeInteger(outboxPosition) || outboxPosition < 1) {
      throw new DatabaseMutationConflict('idempotency_response_missing', 'The authoritative idempotent response is unavailable.');
    }
    return { outboxPosition, replayed: true, responseRef: row.response_ref };
  }

  private async assertExpectedRecords(
    client: PoolClient,
    tenantId: string,
    records: readonly EventMutationExpectedRecord[],
  ): Promise<void> {
    for (const record of records) {
      const result = await client.query<{ payload: unknown }>(
        `select payload
           from edt.records
          where tenant_id = $1::uuid and kind = $2 and record_id = $3::uuid
          for update`,
        [tenantId, record.kind, record.id],
      );
      this.assertExpectedPayload(record, result.rows[0]?.payload);
    }
  }

  private assertExpectedPayload(record: EventMutationExpectedRecord, payload: unknown): void {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new DatabaseMutationConflict('authoritative_record_missing', `The authoritative ${record.kind} record is unavailable.`);
    }
    const actual = payload as Record<string, unknown>;
    for (const [field, expected] of Object.entries(record.expected)) {
      if (actual[field] === expected) continue;
      const projection = record.kind === 'event_projection_snapshot';
      const code = field === 'state_hash' && projection
        ? 'projection_hash_changed'
        : field === 'version' && projection
          ? 'projection_version_changed'
          : field === 'version'
            ? 'event_version_changed'
            : field === 'etag'
              ? 'event_precondition_failed'
              : 'authoritative_record_changed';
      throw new DatabaseMutationConflict(code, `The authoritative ${record.kind} ${field} changed before commit.`);
    }
  }

  private bindAuditToTail(tenantId: string, audit: EventMutationAudit, tail?: EventMutationAudit): void {
    audit.tenant_sequence = (tail?.tenant_sequence ?? 0) + 1;
    audit.previous_hash = tail?.event_hash ?? '0'.repeat(64);
    const { event_hash: _eventHash, ...base } = audit;
    audit.event_hash = sha256({ ...base, tenant_id: tenantId });
  }

  private asEventMutationAudit(payload: unknown): EventMutationAudit {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('Event audit evidence must be an object.');
    }
    const audit = payload as Partial<EventMutationAudit>;
    const requiredStrings: Array<keyof EventMutationAudit> = [
      'audit_id',
      'action',
      'actor_id',
      'resource_type',
      'resource_id',
      'occurred_at',
      'request_id',
      'trace_id',
      'details_hash',
      'previous_hash',
      'event_hash',
    ];
    if (requiredStrings.some((field) => typeof audit[field] !== 'string')) {
      throw new TypeError('Event audit evidence is missing a required field.');
    }
    return payload as EventMutationAudit;
  }

  private inMemoryRecordKey(tenantId: string, kind: string, id: string): string {
    return `${tenantId}:${kind}:${id}`;
  }

  private inMemoryIdempotencyKey(tenantId: string, guard: EventMutationGuard): string {
    return `${tenantId}:${guard.idempotency.operation}:${guard.idempotency.key}`;
  }

  private jsonClone(value: unknown, label: string): unknown {
    return JSON.parse(this.serializeJson(value, label)) as unknown;
  }

  private async withTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error('PostgreSQL is not configured');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role edt_app');
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertRecord(
    client: PoolClient,
    tenantId: string,
    kind: string,
    id: string,
    serializedPayload: string,
  ): Promise<void> {
    await client.query(
      `insert into edt.records(tenant_id, kind, record_id, payload)
       values ($1::uuid, $2, $3::uuid, $4::jsonb)
       on conflict (tenant_id, kind, record_id)
       do update set payload = excluded.payload, updated_at = transaction_timestamp()`,
      [tenantId, kind, id, serializedPayload],
    );
  }

  private findInMemoryOutbox(eventId: string): InMemoryOutboxEntry | undefined {
    for (const entries of this.inMemoryOutboxByTenant.values()) {
      const entry = entries.find((candidate) => candidate.eventId === eventId);
      if (entry) return entry;
    }
    return undefined;
  }

  private withOutboxPosition(payload: unknown, outboxPosition: number): unknown {
    if (
      payload !== null
      && typeof payload === 'object'
      && !Array.isArray(payload)
      && typeof (payload as { outbox_position?: unknown }).outbox_position === 'number'
    ) {
      return { ...payload, outbox_position: outboxPosition };
    }
    return payload;
  }

  private serializeJson(value: unknown, label: string): string {
    this.assertJsonSafe(value, label, new Set<object>());
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError(`${label} is not JSON-safe.`);
    return serialized;
  }

  private assertJsonSafe(value: unknown, path: string, ancestors: Set<object>): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number.`);
      return;
    }
    if (typeof value !== 'object') throw new TypeError(`${path} contains a non-JSON value.`);

    const object = value as object;
    if (ancestors.has(object)) throw new TypeError(`${path} contains a circular reference.`);
    const prototype = Object.getPrototypeOf(object);
    const crossRealmPlainObject = Object.prototype.toString.call(value) === '[object Object]'
      && typeof (prototype as { constructor?: { name?: unknown } } | null)?.constructor?.name === 'string'
      && (prototype as { constructor: { name: string } }).constructor.name === 'Object';
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null && !crossRealmPlainObject) {
      throw new TypeError(`${path} contains a non-plain object.`);
    }
    if (Object.getOwnPropertySymbols(object).length) throw new TypeError(`${path} contains symbol keys.`);

    ancestors.add(object);
    if (Array.isArray(value)) {
      value.forEach((item, index) => this.assertJsonSafe(item, `${path}[${index}]`, ancestors));
    } else {
      Object.entries(value as Record<string, unknown>).forEach(([key, item]) => this.assertJsonSafe(item, `${path}.${key}`, ancestors));
    }
    ancestors.delete(object);
  }

  private async migrate(): Promise<void> {
    if (!this.pool) return;
    const candidates = [
      resolve(process.cwd(), 'apps/api/db/migrations'),
      resolve(process.cwd(), 'db/migrations'),
      resolve(__dirname, '../db/migrations'),
    ];
    const directory = candidates.find((candidate) => existsSync(resolve(candidate, '001_init.sql')));
    if (!directory) throw new Error('Database migration directory containing 001_init.sql was not found');
    const migrations = readdirSync(directory)
      .filter((name) => /^\d{3,}_[a-z0-9_]+\.sql$/i.test(name))
      .sort((left, right) => left.localeCompare(right));
    if (!migrations.length || migrations[0] !== '001_init.sql') {
      throw new Error('Database migrations must begin with 001_init.sql.');
    }
    for (const name of migrations) {
      const sql = readFileSync(resolve(directory, name), 'utf8');
      if (name !== '001_init.sql') {
        await this.pool.query(`create table if not exists edt.schema_migrations (
          migration_name text primary key,
          checksum char(64) not null,
          applied_at timestamptz not null default transaction_timestamp()
        )`);
        const applied = await this.pool.query<{ checksum: string }>(
          'select checksum from edt.schema_migrations where migration_name = $1',
          [name],
        );
        const checksum = sha256(sql);
        if (applied.rows[0]) {
          if (applied.rows[0].checksum !== checksum) {
            throw new Error(`Applied migration ${name} has a different checksum; create a new migration instead of editing it.`);
          }
          continue;
        }
        const client = await this.pool.connect();
        try {
          await client.query('begin');
          await client.query(sql);
          await client.query('insert into edt.schema_migrations(migration_name, checksum) values ($1, $2)', [name, checksum]);
          await client.query('commit');
        } catch (error) {
          await client.query('rollback');
          throw error;
        } finally {
          client.release();
        }
        continue;
      }
      const checksum = sha256(sql);
      const ledgerExists = await this.pool.query<{ exists: boolean }>(
        `select to_regclass('edt.schema_migrations') is not null as exists`,
      );
      if (ledgerExists.rows[0]?.exists) {
        const applied = await this.pool.query<{ checksum: string }>(
          'select checksum from edt.schema_migrations where migration_name = $1',
          [name],
        );
        if (applied.rows[0]) {
          if (applied.rows[0].checksum !== checksum) {
            throw new Error('Applied migration 001_init.sql has a different checksum; create a new migration instead of editing it.');
          }
          continue;
        }
      }
      // Existing demo databases predate the migration ledger. Run the
      // idempotent baseline once, then record its immutable checksum.
      await this.pool.query(sql);
      await this.pool.query(`create table if not exists edt.schema_migrations (
        migration_name text primary key,
        checksum char(64) not null,
        applied_at timestamptz not null default transaction_timestamp()
      )`);
      await this.pool.query(
        `insert into edt.schema_migrations(migration_name, checksum)
         values ($1, $2)
         on conflict (migration_name) do update set checksum = excluded.checksum
         where edt.schema_migrations.checksum = excluded.checksum`,
        [name, checksum],
      );
      const verified = await this.pool.query<{ checksum: string }>('select checksum from edt.schema_migrations where migration_name = $1', [name]);
      if (verified.rows[0]?.checksum !== checksum) {
        throw new Error('Applied migration 001_init.sql has a different checksum; create a new migration instead of editing it.');
      }
    }
  }
}
