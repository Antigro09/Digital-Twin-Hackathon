import { Pool, PoolClient } from 'pg';
import { DatabaseMutationConflict, DatabaseService, EventMutationAudit, EventMutationGuard } from '../src/database.service';

const TENANT_ONE = '10000000-0000-4000-8000-000000000001';
const TENANT_TWO = '10000000-0000-4000-8000-000000000002';

function audit(id = '70000000-0000-4000-8000-000000000001'): EventMutationAudit {
  return {
    audit_id: id,
    tenant_sequence: 1,
    action: 'event.applied',
    actor_id: 'actor_test',
    resource_type: 'event_receipt',
    resource_id: '71000000-0000-4000-8000-000000000001',
    occurred_at: '2026-07-15T13:00:00.000Z',
    request_id: 'request_test',
    trace_id: 'trace_test',
    details_hash: 'd'.repeat(64),
    previous_hash: '0'.repeat(64),
    event_hash: 'e'.repeat(64),
  };
}

describe('DatabaseService event mutation commit', () => {
  it('enforces authoritative record CAS, durable idempotency, and one audit tail in memory', async () => {
    const database = new DatabaseService();
    const eventId = '73000000-0000-4000-8000-000000000010';
    const projectionId = '73000000-0000-4000-8000-000000000011';
    const receiptId = '74000000-0000-4000-8000-000000000010';
    await database.put(TENANT_ONE, 'intelligence_event', eventId, { version: 5, status: 'approved', etag: '"event-v5"' });
    await database.put(TENANT_ONE, 'event_projection_snapshot', projectionId, { version: 3, state_hash: 'a'.repeat(64) });
    const priorAudit = audit('70000000-0000-4000-8000-000000000010');
    await database.put(TENANT_ONE, 'event_audit_evidence', priorAudit.audit_id, priorAudit);

    const guard: EventMutationGuard = {
      idempotency: {
        operation: 'actor_test:apply:event_test',
        key: 'apply-event-key-0001',
        requestHash: 'b'.repeat(64),
        responseRef: receiptId,
        expiresAt: '2026-07-16T13:00:00.000Z',
      },
      expectedRecords: [
        { kind: 'intelligence_event', id: eventId, expected: { version: 5, status: 'approved', etag: '"event-v5"' } },
        { kind: 'event_projection_snapshot', id: projectionId, expected: { version: 3, state_hash: 'a'.repeat(64) } },
      ],
    };
    const mutationAudit = audit('70000000-0000-4000-8000-000000000011');
    const outbox = {
      eventId: '72000000-0000-4000-8000-000000000010',
      eventType: 'com.enterprisedigitaltwin.event.applied.v1',
      aggregateType: 'intelligence_event',
      aggregateId: eventId,
      aggregateVersion: 6,
      payload: { decision: 'applied', outbox_position: 0 },
    };

    await expect(database.commitEventMutation(
      TENANT_ONE,
      [
        { kind: 'intelligence_event', id: eventId, payload: { version: 6, status: 'applied', etag: '"event-v6"' } },
        { kind: 'event_action_receipt', id: receiptId, payload: { receipt_id: receiptId, outbox_position: 0 } },
        { kind: 'event_projection_snapshot', id: projectionId, payload: { version: 4, state_hash: 'c'.repeat(64) } },
      ],
      mutationAudit,
      outbox,
      guard,
    )).resolves.toEqual({ outboxPosition: 1 });
    expect(mutationAudit).toMatchObject({ tenant_sequence: 2, previous_hash: priorAudit.event_hash });

    await expect(database.commitEventMutation(
      TENANT_ONE,
      [],
      audit('70000000-0000-4000-8000-000000000012'),
      { ...outbox, eventId: '72000000-0000-4000-8000-000000000011' },
      guard,
    )).resolves.toEqual({ outboxPosition: 1, replayed: true, responseRef: receiptId });

    await expect(database.commitEventMutation(
      TENANT_ONE,
      [],
      audit('70000000-0000-4000-8000-000000000013'),
      { ...outbox, eventId: '72000000-0000-4000-8000-000000000012' },
      { ...guard, idempotency: { ...guard.idempotency, requestHash: 'd'.repeat(64) } },
    )).rejects.toMatchObject<Partial<DatabaseMutationConflict>>({ code: 'idempotency_key_reused' });

    await expect(database.commitEventMutation(
      TENANT_ONE,
      [],
      audit('70000000-0000-4000-8000-000000000014'),
      { ...outbox, eventId: '72000000-0000-4000-8000-000000000013' },
      {
        ...guard,
        idempotency: { ...guard.idempotency, key: 'apply-event-key-0002', responseRef: '74000000-0000-4000-8000-000000000011' },
      },
    )).rejects.toMatchObject<Partial<DatabaseMutationConflict>>({ code: 'event_version_changed' });
  });

  it('keeps an idempotent tenant-scoped outbox in the explicit in-memory profile', async () => {
    const database = new DatabaseService();
    const outbox = {
      eventId: '72000000-0000-4000-8000-000000000001',
      eventType: 'com.enterprisedigitaltwin.event.applied.v1',
      aggregateType: 'intelligence_event',
      aggregateId: '73000000-0000-4000-8000-000000000001',
      aggregateVersion: 2,
      payload: { decision: 'applied', outbox_position: 0 },
    };

    await expect(database.commitEventMutation(
      TENANT_ONE,
      [{ kind: 'event_action_receipt', id: '74000000-0000-4000-8000-000000000001', payload: { outbox_position: 0 } }],
      audit(),
      outbox,
    )).resolves.toEqual({ outboxPosition: 1 });
    await expect(database.commitEventMutation(TENANT_ONE, [], audit(), outbox)).resolves.toEqual({ outboxPosition: 1 });

    const firstSnapshot = database.getInMemoryOutbox(TENANT_ONE);
    expect(firstSnapshot).toHaveLength(1);
    expect(firstSnapshot[0]).toMatchObject({ tenantId: TENANT_ONE, outboxPosition: 1, eventId: outbox.eventId });
    (firstSnapshot[0].payload as { decision: string }).decision = 'tampered';
    expect(database.getInMemoryOutbox(TENANT_ONE)[0].payload).toEqual({ decision: 'applied', outbox_position: 1 });

    await database.commitEventMutation(
      TENANT_TWO,
      [],
      audit('70000000-0000-4000-8000-000000000002'),
      { ...outbox, eventId: '72000000-0000-4000-8000-000000000002', aggregateId: '73000000-0000-4000-8000-000000000002' },
    );
    expect(database.getInMemoryOutbox(TENANT_ONE)).toHaveLength(1);
    expect(database.getInMemoryOutbox(TENANT_TWO)).toHaveLength(1);
    expect(database.getInMemoryOutbox(TENANT_TWO)[0].outboxPosition).toBe(2);
  });

  it('orders the authoritative audit tail numerically after sequence nine', async () => {
    const previousHash = '9'.repeat(64);
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('from edt.audit_events') && sql.includes('limit 1')) {
        return { rows: [{ tenant_sequence: '10', event_hash: previousHash }] };
      }
      return { rows: [] };
    });
    const client = { query, release: jest.fn() } as unknown as PoolClient;
    const pool = { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
    const database = new DatabaseService();
    (database as unknown as { pool: Pool }).pool = pool;
    const nextAudit = audit('70000000-0000-4000-8000-000000000020');

    await database.put(TENANT_ONE, 'event_audit_evidence', nextAudit.audit_id, nextAudit);

    expect(nextAudit).toMatchObject({ tenant_sequence: 11, previous_hash: previousHash });
    const tailSql = (query.mock.calls as unknown as Array<[string]>).find(([sql]) => sql.includes('from edt.audit_events'))?.[0] ?? '';
    expect(tailSql).toContain('select tenant_sequence, event_hash');
    expect(tailSql).toContain('order by edt.audit_events.tenant_sequence desc');
    expect(tailSql).not.toContain('tenant_sequence::text');
  });

  it('reserves the outbox before records and persists its position in record payloads', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('with inserted as')) return { rows: [{ outbox_id: '73' }] };
      return { rows: [] };
    });
    const client = { query, release: jest.fn() } as unknown as PoolClient;
    const pool = { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
    const database = new DatabaseService();
    (database as unknown as { pool: Pool }).pool = pool;

    const result = await database.commitEventMutation(
      TENANT_ONE,
      [{
        kind: 'event_action_receipt',
        id: '74000000-0000-4000-8000-000000000001',
        payload: { receipt_id: '74000000-0000-4000-8000-000000000001', outbox_position: 0 },
      }],
      audit(),
      {
        eventId: '72000000-0000-4000-8000-000000000001',
        eventType: 'com.enterprisedigitaltwin.event.applied.v1',
        aggregateType: 'intelligence_event',
        aggregateId: '73000000-0000-4000-8000-000000000001',
        aggregateVersion: 2,
        payload: { decision: 'applied', outbox_position: 0 },
      },
    );

    expect(result).toEqual({ outboxPosition: 73 });
    const calls = query.mock.calls as unknown as Array<[string, unknown[]?]>;
    const auditTailQuery = calls.find(([sql]) => sql.includes('from edt.audit_events') && sql.includes('limit 1'))?.[0] ?? '';
    expect(auditTailQuery).toContain('select tenant_sequence, event_hash');
    expect(auditTailQuery).toContain('order by edt.audit_events.tenant_sequence desc');
    expect(auditTailQuery).not.toContain('tenant_sequence::text');
    const outboxIndex = calls.findIndex(([sql]) => sql.includes('with inserted as'));
    const receiptIndex = calls.findIndex(([sql, parameters]) => sql.includes('insert into edt.records') && parameters?.[1] === 'event_action_receipt');
    expect(outboxIndex).toBeGreaterThan(-1);
    expect(receiptIndex).toBeGreaterThan(outboxIndex);
    const outboxPayloadUpdate = calls.find(([sql]) => sql.includes('update edt.outbox'));
    expect(JSON.parse(String(outboxPayloadUpdate?.[1]?.[2]))).toMatchObject({ outbox_position: 73 });
    expect(JSON.parse(String(calls[receiptIndex][1]?.[3]))).toMatchObject({ outbox_position: 73 });
    expect(calls.some(([sql]) => sql.includes('insert into edt.audit_events'))).toBe(true);
    expect(calls.at(-1)?.[0]).toBe('commit');
  });
});
