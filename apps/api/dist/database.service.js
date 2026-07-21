"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var DatabaseService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = exports.DatabaseMutationConflict = void 0;
const common_1 = require("@nestjs/common");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const pg_1 = require("pg");
const domain_1 = require("./domain");
class DatabaseMutationConflict extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'DatabaseMutationConflict';
    }
}
exports.DatabaseMutationConflict = DatabaseMutationConflict;
let DatabaseService = DatabaseService_1 = class DatabaseService {
    logger = new common_1.Logger(DatabaseService_1.name);
    inMemoryOutboxByTenant = new Map();
    inMemoryRecords = new Map();
    inMemoryRecordCreatedAt = new Map();
    inMemoryIdempotency = new Map();
    inMemoryAuditTail = new Map();
    nextInMemoryOutboxPosition = 1;
    initialization;
    pool;
    onModuleInit() {
        return this.ready();
    }
    ready() {
        this.initialization ??= this.initialize();
        return this.initialization;
    }
    async initialize() {
        const url = process.env.DATABASE_URL;
        if (!url) {
            if (process.env.EDT_REQUIRE_POSTGRES === 'true')
                throw new Error('DATABASE_URL is required');
            this.logger.warn('DATABASE_URL is unset; using the explicit synthetic in-memory test profile.');
            return;
        }
        this.pool = new pg_1.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, statement_timeout: 5_000 });
        await this.pool.query('select 1');
        if (process.env.EDT_AUTO_MIGRATE !== 'false')
            await this.migrate();
        this.logger.log('PostgreSQL authoritative record store connected.');
    }
    async onModuleDestroy() {
        await this.pool?.end();
    }
    get enabled() {
        return Boolean(this.pool);
    }
    async put(tenantId, kind, id, payload) {
        if (!this.pool) {
            if (kind === 'event_audit_evidence') {
                const audit = this.asEventMutationAudit(payload);
                this.bindAuditToTail(tenantId, audit, this.inMemoryAuditTail.get(tenantId));
                this.inMemoryAuditTail.set(tenantId, structuredClone(audit));
            }
            const serialized = JSON.stringify(payload);
            if (serialized === undefined)
                throw new TypeError(`record ${kind}/${id} is not JSON-serializable.`);
            const key = this.inMemoryRecordKey(tenantId, kind, id);
            if (!this.inMemoryRecords.has(key))
                this.inMemoryRecordCreatedAt.set(key, new Date().toISOString());
            this.inMemoryRecords.set(key, JSON.parse(serialized));
            return;
        }
        if (kind === 'event_audit_evidence') {
            const audit = this.asEventMutationAudit(payload);
            await this.withTenant(tenantId, async (client) => {
                await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [tenantId]);
                const tail = await client.query(`select tenant_sequence, event_hash
             from edt.audit_events
            where tenant_id = $1::uuid
            order by edt.audit_events.tenant_sequence desc
            limit 1`, [tenantId]);
                const tailRow = tail.rows[0];
                this.bindAuditToTail(tenantId, audit, tailRow ? {
                    ...audit,
                    tenant_sequence: Number(tailRow.tenant_sequence),
                    event_hash: tailRow.event_hash,
                } : undefined);
                const serialized = this.serializeJson(audit, 'audit payload');
                await this.upsertRecord(client, tenantId, kind, id, serialized);
                await client.query(`insert into edt.audit_events(
             tenant_id, tenant_sequence, event_id, payload, previous_hash, event_hash, occurred_at
           )
           values ($1::uuid, $2, $3::uuid, $4::jsonb, $5, $6, $7::timestamptz)`, [tenantId, audit.tenant_sequence, audit.audit_id, serialized, audit.previous_hash, audit.event_hash, audit.occurred_at]);
            });
            return;
        }
        await this.withTenant(tenantId, async (client) => {
            await client.query(`insert into edt.records(tenant_id, kind, record_id, payload)
         values ($1::uuid, $2, $3::uuid, $4::jsonb)
         on conflict (tenant_id, kind, record_id)
         do update set payload = excluded.payload, updated_at = transaction_timestamp()`, [tenantId, kind, id, JSON.stringify(payload)]);
        });
    }
    async get(tenantId, kind, id) {
        if (!this.pool) {
            const value = this.inMemoryRecords.get(this.inMemoryRecordKey(tenantId, kind, id));
            return value === undefined ? undefined : structuredClone(value);
        }
        return this.withTenant(tenantId, async (client) => {
            const result = await client.query('select payload from edt.records where tenant_id = $1::uuid and kind = $2 and record_id = $3::uuid', [tenantId, kind, id]);
            return result.rows[0]?.payload;
        });
    }
    async list(tenantId, kind) {
        if (!this.pool) {
            const prefix = `${tenantId}:${kind}:`;
            return [...this.inMemoryRecords.entries()]
                .filter(([key]) => key.startsWith(prefix))
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([, value]) => structuredClone(value));
        }
        return this.withTenant(tenantId, async (client) => {
            const result = await client.query('select payload from edt.records where tenant_id = $1::uuid and kind = $2 order by created_at, record_id', [tenantId, kind]);
            return result.rows.map((row) => row.payload);
        });
    }
    async listPage(tenantId, kind, options = {}) {
        const filters = options.filters ?? {};
        const limit = options.limit ?? 100;
        this.validatePageOptions(filters, limit);
        const cursor = options.cursor === undefined ? undefined : this.decodeRecordCursor(options.cursor);
        if (!this.pool) {
            const prefix = `${tenantId}:${kind}:`;
            const candidates = [...this.inMemoryRecords.entries()]
                .filter(([key]) => key.startsWith(prefix))
                .map(([key, value]) => ({
                key,
                recordId: key.slice(prefix.length),
                createdAt: this.inMemoryRecordCreatedAt.get(key) ?? '',
                value,
            }))
                .filter((candidate) => this.matchesPayloadFilters(candidate.value, filters))
                .filter((candidate) => !cursor || this.beforeCursor(candidate.createdAt, candidate.recordId, cursor))
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.recordId.localeCompare(left.recordId));
            const page = candidates.slice(0, limit);
            const next = candidates.length > limit ? page[page.length - 1] : undefined;
            return {
                items: page.map((candidate) => structuredClone(candidate.value)),
                nextCursor: next ? this.encodeRecordCursor(next.createdAt, next.recordId) : null,
            };
        }
        return this.withTenant(tenantId, async (client) => {
            const parameters = [tenantId, kind, JSON.stringify(filters)];
            let cursorClause = '';
            if (cursor) {
                parameters.push(cursor.createdAt, cursor.recordId);
                cursorClause = ` and (created_at, record_id) < ($${parameters.length - 1}::timestamptz, $${parameters.length}::uuid)`;
            }
            parameters.push(limit + 1);
            const result = await client.query(`select payload, created_at, record_id::text as record_id
           from edt.records
          where tenant_id = $1::uuid
            and kind = $2
            and payload @> $3::jsonb${cursorClause}
          order by created_at desc, record_id desc
          limit $${parameters.length}`, parameters);
            const page = result.rows.slice(0, limit);
            const next = result.rows.length > limit ? page[page.length - 1] : undefined;
            return {
                items: page.map((row) => row.payload),
                nextCursor: next ? this.encodeRecordCursor(this.recordCreatedAt(next.created_at), next.record_id) : null,
            };
        });
    }
    async commitEventMutation(tenantId, records, audit, outbox, guard) {
        this.serializeJson(outbox.payload, 'outbox payload');
        if (guard)
            this.validateGuard(guard);
        if (!this.pool) {
            const replay = guard ? this.inMemoryReplay(tenantId, guard) : undefined;
            if (replay)
                return replay;
            if (guard)
                this.assertInMemoryExpectedRecords(tenantId, guard.expectedRecords);
            const existing = this.findInMemoryOutbox(outbox.eventId);
            if (existing && existing.tenantId !== tenantId) {
                throw new Error(`Outbox event ${outbox.eventId} already belongs to another tenant.`);
            }
            const outboxPosition = existing?.outboxPosition ?? this.nextInMemoryOutboxPosition;
            if (existing)
                return { outboxPosition };
            this.bindAuditToTail(tenantId, audit, this.inMemoryAuditTail.get(tenantId));
            const positionedOutboxPayload = this.serializeJson(this.withOutboxPosition(outbox.payload, outboxPosition), 'outbox payload');
            const positionedRecords = records.map((record) => ({
                ...record,
                payload: this.jsonClone(this.withOutboxPosition(record.payload, outboxPosition), `record ${record.kind}/${record.id}`),
            }));
            const auditPayload = this.jsonClone(audit, 'audit payload');
            const entry = {
                tenantId,
                outboxPosition,
                eventId: outbox.eventId,
                eventType: outbox.eventType,
                aggregateType: outbox.aggregateType,
                aggregateId: outbox.aggregateId,
                aggregateVersion: outbox.aggregateVersion,
                payload: JSON.parse(positionedOutboxPayload),
            };
            for (const record of positionedRecords) {
                const key = this.inMemoryRecordKey(tenantId, record.kind, record.id);
                if (!this.inMemoryRecords.has(key))
                    this.inMemoryRecordCreatedAt.set(key, new Date().toISOString());
                this.inMemoryRecords.set(key, record.payload);
            }
            const auditKey = this.inMemoryRecordKey(tenantId, 'event_audit_evidence', audit.audit_id);
            if (!this.inMemoryRecords.has(auditKey))
                this.inMemoryRecordCreatedAt.set(auditKey, new Date().toISOString());
            this.inMemoryRecords.set(auditKey, auditPayload);
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
            await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [tenantId]);
            if (guard) {
                const replay = await this.reserveIdempotency(client, tenantId, guard);
                if (replay)
                    return replay;
                await this.assertExpectedRecords(client, tenantId, guard.expectedRecords);
            }
            const tail = await client.query(`select tenant_sequence, event_hash
           from edt.audit_events
          where tenant_id = $1::uuid
          order by edt.audit_events.tenant_sequence desc
          limit 1`, [tenantId]);
            const tailRow = tail.rows[0];
            this.bindAuditToTail(tenantId, audit, tailRow ? {
                ...audit,
                tenant_sequence: Number(tailRow.tenant_sequence),
                event_hash: tailRow.event_hash,
            } : undefined);
            const serializedOutboxPayload = this.serializeJson(outbox.payload, 'outbox payload');
            const serializedAudit = this.serializeJson(audit, 'audit payload');
            const outboxResult = await client.query(`with inserted as (
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
         limit 1`, [
                tenantId,
                outbox.eventId,
                outbox.eventType,
                outbox.aggregateType,
                outbox.aggregateId,
                outbox.aggregateVersion,
                serializedOutboxPayload,
            ]);
            const outboxPosition = Number(outboxResult.rows[0]?.outbox_id);
            if (!Number.isSafeInteger(outboxPosition) || outboxPosition < 1) {
                throw new Error(`Outbox event ${outbox.eventId} could not be reserved for tenant ${tenantId}.`);
            }
            const positionedOutboxPayload = this.serializeJson(this.withOutboxPosition(outbox.payload, outboxPosition), 'outbox payload');
            await client.query(`update edt.outbox
            set payload = $3::jsonb
          where tenant_id = $1::uuid and event_id = $2::uuid`, [tenantId, outbox.eventId, positionedOutboxPayload]);
            for (const record of records) {
                await this.upsertRecord(client, tenantId, record.kind, record.id, this.serializeJson(this.withOutboxPosition(record.payload, outboxPosition), `record ${record.kind}/${record.id}`));
            }
            await this.upsertRecord(client, tenantId, 'event_audit_evidence', audit.audit_id, serializedAudit);
            await client.query(`insert into edt.audit_events(
           tenant_id, tenant_sequence, event_id, payload, previous_hash, event_hash, occurred_at
         )
         values ($1::uuid, $2, $3::uuid, $4::jsonb, $5, $6, $7::timestamptz)`, [
                tenantId,
                audit.tenant_sequence,
                audit.audit_id,
                serializedAudit,
                audit.previous_hash,
                audit.event_hash,
                audit.occurred_at,
            ]);
            if (guard) {
                await client.query(`update edt.idempotency
              set state = 'succeeded', response_ref = $4::uuid
            where tenant_id = $1::uuid and operation = $2 and idempotency_key = $3`, [tenantId, guard.idempotency.operation, guard.idempotency.key, guard.idempotency.responseRef]);
            }
            return { outboxPosition };
        });
    }
    getInMemoryOutbox(tenantId) {
        return Object.freeze((this.inMemoryOutboxByTenant.get(tenantId) ?? []).map((entry) => Object.freeze({
            ...entry,
            payload: JSON.parse(JSON.stringify(entry.payload)),
        })));
    }
    async health() {
        if (!this.pool)
            return 'in_memory';
        await this.pool.query('select 1');
        return 'connected';
    }
    validateGuard(guard) {
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
            if (!record.kind || !record.id || (record.absent !== true && !Object.keys(record.expected ?? {}).length)) {
                throw new TypeError('Every authoritative event mutation record guard must declare expected fields or require an absent record.');
            }
            if (record.absent === true && record.expected !== undefined) {
                throw new TypeError('An authoritative event mutation record guard cannot require both an absent record and expected fields.');
            }
            if (record.expected)
                this.serializeJson(record.expected, `guard ${record.kind}/${record.id}`);
        }
    }
    inMemoryReplay(tenantId, guard) {
        const existing = this.inMemoryIdempotency.get(this.inMemoryIdempotencyKey(tenantId, guard));
        if (!existing)
            return undefined;
        if (existing.requestHash !== guard.idempotency.requestHash) {
            throw new DatabaseMutationConflict('idempotency_key_reused', 'The Idempotency-Key was already used with a different request.');
        }
        return { outboxPosition: existing.outboxPosition, replayed: true, responseRef: existing.responseRef };
    }
    assertInMemoryExpectedRecords(tenantId, records) {
        for (const record of records) {
            const payload = this.inMemoryRecords.get(this.inMemoryRecordKey(tenantId, record.kind, record.id));
            this.assertExpectedPayload(record, payload);
        }
    }
    async reserveIdempotency(client, tenantId, guard) {
        const { idempotency } = guard;
        const inserted = await client.query(`insert into edt.idempotency(
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
       returning response_ref`, [tenantId, idempotency.operation, idempotency.key, idempotency.requestHash, idempotency.responseRef, idempotency.expiresAt]);
        if (inserted.rows.length)
            return undefined;
        const existing = await client.query(`select request_hash::text, response_ref::text, state
         from edt.idempotency
        where tenant_id = $1::uuid and operation = $2 and idempotency_key = $3
        for update`, [tenantId, idempotency.operation, idempotency.key]);
        const row = existing.rows[0];
        if (!row)
            throw new DatabaseMutationConflict('idempotency_state_missing', 'The authoritative idempotency reservation is unavailable.');
        if (row.request_hash !== idempotency.requestHash) {
            throw new DatabaseMutationConflict('idempotency_key_reused', 'The Idempotency-Key was already used with a different request.');
        }
        if (row.state !== 'succeeded' || !row.response_ref) {
            throw new DatabaseMutationConflict('idempotency_request_in_progress', 'An identical event mutation is already in progress.');
        }
        const receipt = await client.query(`select payload
         from edt.records
        where tenant_id = $1::uuid and kind = 'event_action_receipt' and record_id = $2::uuid`, [tenantId, row.response_ref]);
        let outboxPosition = Number(receipt.rows[0]?.payload?.outbox_position);
        if (!Number.isSafeInteger(outboxPosition) || outboxPosition < 1) {
            const historyOutbox = await client.query(`select outbox_id
           from edt.outbox
          where tenant_id = $1::uuid
            and payload->>'history_event_id' = $2::text
          order by outbox_id desc
          limit 1`, [tenantId, row.response_ref]);
            outboxPosition = Number(historyOutbox.rows[0]?.outbox_id);
        }
        if (!Number.isSafeInteger(outboxPosition) || outboxPosition < 1) {
            throw new DatabaseMutationConflict('idempotency_response_missing', 'The authoritative idempotent response is unavailable.');
        }
        return { outboxPosition, replayed: true, responseRef: row.response_ref };
    }
    async assertExpectedRecords(client, tenantId, records) {
        for (const record of records) {
            const result = await client.query(`select payload
           from edt.records
          where tenant_id = $1::uuid and kind = $2 and record_id = $3::uuid
          for update`, [tenantId, record.kind, record.id]);
            this.assertExpectedPayload(record, result.rows[0]?.payload);
        }
    }
    assertExpectedPayload(record, payload) {
        if (record.absent === true) {
            if (payload === undefined)
                return;
            throw new DatabaseMutationConflict('authoritative_record_exists', `The authoritative ${record.kind} record already exists.`);
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new DatabaseMutationConflict('authoritative_record_missing', `The authoritative ${record.kind} record is unavailable.`);
        }
        const actual = payload;
        for (const [field, expected] of Object.entries(record.expected ?? {})) {
            if (actual[field] === expected)
                continue;
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
    bindAuditToTail(tenantId, audit, tail) {
        audit.tenant_sequence = (tail?.tenant_sequence ?? 0) + 1;
        audit.previous_hash = tail?.event_hash ?? '0'.repeat(64);
        const { event_hash: _eventHash, ...base } = audit;
        audit.event_hash = (0, domain_1.sha256)({ ...base, tenant_id: tenantId });
    }
    asEventMutationAudit(payload) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new TypeError('Event audit evidence must be an object.');
        }
        const audit = payload;
        const requiredStrings = [
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
        return payload;
    }
    inMemoryRecordKey(tenantId, kind, id) {
        return `${tenantId}:${kind}:${id}`;
    }
    validatePageOptions(filters, limit) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
            throw new TypeError('Record page limit must be an integer between 1 and 500.');
        }
        for (const [key, value] of Object.entries(filters)) {
            if (!/^[a-z][a-z0-9_]{0,63}$/.test(key))
                throw new TypeError(`Record filter ${key} is invalid.`);
            if (value !== null && typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') {
                throw new TypeError(`Record filter ${key} must be a JSON primitive.`);
            }
            if (typeof value === 'number' && !Number.isFinite(value))
                throw new TypeError(`Record filter ${key} must be finite.`);
        }
    }
    matchesPayloadFilters(payload, filters) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload))
            return false;
        const record = payload;
        return Object.entries(filters).every(([key, value]) => record[key] === value);
    }
    encodeRecordCursor(createdAt, recordId) {
        return Buffer.from(JSON.stringify({ created_at: createdAt, record_id: recordId }), 'utf8').toString('base64url');
    }
    decodeRecordCursor(value) {
        try {
            const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
            if (typeof decoded.created_at !== 'string' || Number.isNaN(Date.parse(decoded.created_at)) || typeof decoded.record_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(decoded.record_id)) {
                throw new TypeError('invalid cursor');
            }
            return { createdAt: decoded.created_at, recordId: decoded.record_id };
        }
        catch {
            throw new TypeError('Record page cursor is invalid.');
        }
    }
    beforeCursor(createdAt, recordId, cursor) {
        return createdAt < cursor.createdAt || (createdAt === cursor.createdAt && recordId < cursor.recordId);
    }
    recordCreatedAt(value) {
        return typeof value === 'string' ? value : value.toISOString();
    }
    inMemoryIdempotencyKey(tenantId, guard) {
        return `${tenantId}:${guard.idempotency.operation}:${guard.idempotency.key}`;
    }
    jsonClone(value, label) {
        return JSON.parse(this.serializeJson(value, label));
    }
    async withTenant(tenantId, fn) {
        if (!this.pool)
            throw new Error('PostgreSQL is not configured');
        const client = await this.pool.connect();
        try {
            await client.query('begin');
            await client.query('set local role edt_app');
            await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
            const result = await fn(client);
            await client.query('commit');
            return result;
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async upsertRecord(client, tenantId, kind, id, serializedPayload) {
        await client.query(`insert into edt.records(tenant_id, kind, record_id, payload)
       values ($1::uuid, $2, $3::uuid, $4::jsonb)
       on conflict (tenant_id, kind, record_id)
       do update set payload = excluded.payload, updated_at = transaction_timestamp()`, [tenantId, kind, id, serializedPayload]);
    }
    findInMemoryOutbox(eventId) {
        for (const entries of this.inMemoryOutboxByTenant.values()) {
            const entry = entries.find((candidate) => candidate.eventId === eventId);
            if (entry)
                return entry;
        }
        return undefined;
    }
    withOutboxPosition(payload, outboxPosition) {
        if (payload !== null
            && typeof payload === 'object'
            && !Array.isArray(payload)
            && typeof payload.outbox_position === 'number') {
            return { ...payload, outbox_position: outboxPosition };
        }
        return payload;
    }
    serializeJson(value, label) {
        this.assertJsonSafe(value, label, new Set());
        const serialized = JSON.stringify(value);
        if (serialized === undefined)
            throw new TypeError(`${label} is not JSON-safe.`);
        return serialized;
    }
    assertJsonSafe(value, path, ancestors) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean')
            return;
        if (typeof value === 'number') {
            if (!Number.isFinite(value))
                throw new TypeError(`${path} contains a non-finite number.`);
            return;
        }
        if (typeof value !== 'object')
            throw new TypeError(`${path} contains a non-JSON value.`);
        const object = value;
        if (ancestors.has(object))
            throw new TypeError(`${path} contains a circular reference.`);
        const prototype = Object.getPrototypeOf(object);
        const crossRealmPlainObject = Object.prototype.toString.call(value) === '[object Object]'
            && typeof prototype?.constructor?.name === 'string'
            && prototype.constructor.name === 'Object';
        if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null && !crossRealmPlainObject) {
            throw new TypeError(`${path} contains a non-plain object.`);
        }
        if (Object.getOwnPropertySymbols(object).length)
            throw new TypeError(`${path} contains symbol keys.`);
        ancestors.add(object);
        if (Array.isArray(value)) {
            value.forEach((item, index) => this.assertJsonSafe(item, `${path}[${index}]`, ancestors));
        }
        else {
            Object.entries(value).forEach(([key, item]) => this.assertJsonSafe(item, `${path}.${key}`, ancestors));
        }
        ancestors.delete(object);
    }
    async migrate() {
        if (!this.pool)
            return;
        const candidates = [
            (0, node_path_1.resolve)(process.cwd(), 'apps/api/db/migrations'),
            (0, node_path_1.resolve)(process.cwd(), 'db/migrations'),
            (0, node_path_1.resolve)(__dirname, '../db/migrations'),
        ];
        const directory = candidates.find((candidate) => (0, node_fs_1.existsSync)((0, node_path_1.resolve)(candidate, '001_init.sql')));
        if (!directory)
            throw new Error('Database migration directory containing 001_init.sql was not found');
        const migrations = (0, node_fs_1.readdirSync)(directory)
            .filter((name) => /^\d{3,}_[a-z0-9_]+\.sql$/i.test(name))
            .sort((left, right) => left.localeCompare(right));
        if (!migrations.length || migrations[0] !== '001_init.sql') {
            throw new Error('Database migrations must begin with 001_init.sql.');
        }
        for (const name of migrations) {
            const sql = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(directory, name), 'utf8');
            if (name !== '001_init.sql') {
                await this.pool.query(`create table if not exists edt.schema_migrations (
          migration_name text primary key,
          checksum char(64) not null,
          applied_at timestamptz not null default transaction_timestamp()
        )`);
                const applied = await this.pool.query('select checksum from edt.schema_migrations where migration_name = $1', [name]);
                const checksum = (0, domain_1.sha256)(sql);
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
                }
                catch (error) {
                    await client.query('rollback');
                    throw error;
                }
                finally {
                    client.release();
                }
                continue;
            }
            const checksum = (0, domain_1.sha256)(sql);
            const ledgerExists = await this.pool.query(`select to_regclass('edt.schema_migrations') is not null as exists`);
            if (ledgerExists.rows[0]?.exists) {
                const applied = await this.pool.query('select checksum from edt.schema_migrations where migration_name = $1', [name]);
                if (applied.rows[0]) {
                    if (applied.rows[0].checksum !== checksum) {
                        throw new Error('Applied migration 001_init.sql has a different checksum; create a new migration instead of editing it.');
                    }
                    continue;
                }
            }
            await this.pool.query(sql);
            await this.pool.query(`create table if not exists edt.schema_migrations (
        migration_name text primary key,
        checksum char(64) not null,
        applied_at timestamptz not null default transaction_timestamp()
      )`);
            await this.pool.query(`insert into edt.schema_migrations(migration_name, checksum)
         values ($1, $2)
         on conflict (migration_name) do update set checksum = excluded.checksum
         where edt.schema_migrations.checksum = excluded.checksum`, [name, checksum]);
            const verified = await this.pool.query('select checksum from edt.schema_migrations where migration_name = $1', [name]);
            if (verified.rows[0]?.checksum !== checksum) {
                throw new Error('Applied migration 001_init.sql has a different checksum; create a new migration instead of editing it.');
            }
        }
    }
};
exports.DatabaseService = DatabaseService;
exports.DatabaseService = DatabaseService = DatabaseService_1 = __decorate([
    (0, common_1.Injectable)()
], DatabaseService);
//# sourceMappingURL=database.service.js.map