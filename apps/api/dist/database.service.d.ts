import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
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
    expected?: Record<string, JsonPrimitive>;
    absent?: true;
}
export interface EventMutationGuard {
    idempotency: EventMutationIdempotencyGuard;
    expectedRecords: readonly EventMutationExpectedRecord[];
}
export declare class DatabaseMutationConflict extends Error {
    readonly code: string;
    constructor(code: string, message: string);
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
export interface RecordListPageOptions {
    filters?: Record<string, JsonPrimitive>;
    limit?: number;
    cursor?: string;
}
export interface RecordListPage<T> {
    items: T[];
    nextCursor: string | null;
}
export declare class DatabaseService implements OnModuleInit, OnModuleDestroy {
    private readonly logger;
    private readonly inMemoryOutboxByTenant;
    private readonly inMemoryRecords;
    private readonly inMemoryRecordCreatedAt;
    private readonly inMemoryIdempotency;
    private readonly inMemoryAuditTail;
    private nextInMemoryOutboxPosition;
    private initialization?;
    private pool?;
    onModuleInit(): Promise<void>;
    ready(): Promise<void>;
    private initialize;
    onModuleDestroy(): Promise<void>;
    get enabled(): boolean;
    put(tenantId: string, kind: string, id: string, payload: unknown): Promise<void>;
    get<T>(tenantId: string, kind: string, id: string): Promise<T | undefined>;
    list<T>(tenantId: string, kind: string): Promise<T[]>;
    listPage<T>(tenantId: string, kind: string, options?: RecordListPageOptions): Promise<RecordListPage<T>>;
    commitEventMutation<TRecordPayload = unknown, TOutboxPayload = unknown>(tenantId: string, records: readonly EventMutationRecord<TRecordPayload>[], audit: EventMutationAudit, outbox: EventMutationOutbox<TOutboxPayload>, guard?: EventMutationGuard): Promise<EventMutationCommitResult>;
    getInMemoryOutbox(tenantId: string): readonly InMemoryOutboxEntry[];
    health(): Promise<'connected' | 'in_memory'>;
    private validateGuard;
    private inMemoryReplay;
    private assertInMemoryExpectedRecords;
    private reserveIdempotency;
    private assertExpectedRecords;
    private assertExpectedPayload;
    private bindAuditToTail;
    private asEventMutationAudit;
    private inMemoryRecordKey;
    private validatePageOptions;
    private matchesPayloadFilters;
    private encodeRecordCursor;
    private decodeRecordCursor;
    private beforeCursor;
    private recordCreatedAt;
    private inMemoryIdempotencyKey;
    private jsonClone;
    private withTenant;
    private upsertRecord;
    private findInMemoryOutbox;
    private withOutboxPosition;
    private serializeJson;
    private assertJsonSafe;
    private migrate;
}
