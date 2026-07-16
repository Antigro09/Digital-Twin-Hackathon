import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import {
  DatabaseService,
  EventMutationAudit,
  EventMutationCommitResult,
  EventMutationOutbox,
  EventMutationRecord,
} from '../src/database.service';
import { ASTER_TENANT_ID, BEACON_TENANT_ID, sha256 } from '../src/domain';
import { EVENT_CHANGED_SCHEMA_HASH, EVENT_CHANGED_SCHEMA_ID } from '../src/event-intelligence.service';
import { EventAuditEvidence, IntelligenceEvent } from '../src/event-intelligence.types';
import { demoAuthHeaders } from './demo-auth.helpers';

const analyst = demoAuthHeaders('usr_aster_analyst');
const beaconAnalyst = demoAuthHeaders('usr_beacon_analyst');
const operations = demoAuthHeaders('usr_aster_ops_approver');
const security = demoAuthHeaders('usr_aster_security_approver');
const idempotencyKey = (suffix: string): string => `restart-hydration-${suffix.padEnd(24, '0')}`;

interface StoredRecord {
  tenantId: string;
  kind: string;
  id: string;
  payload: unknown;
}

interface StoredOutbox {
  tenantId: string;
  eventId: string;
  outboxPosition: number;
  payload: unknown;
}

/**
 * An enabled, process-external persistence double. The same instance is injected
 * into two separately compiled Nest applications to exercise the production
 * onModuleInit hydration path without requiring a PostgreSQL process in CI.
 */
class SharedMemoryDatabase extends DatabaseService {
  private readonly records = new Map<string, StoredRecord>();
  private readonly outboxByEventId = new Map<string, StoredOutbox>();
  private nextOutboxPosition = 1;

  override async onModuleInit(): Promise<void> {}

  override async onModuleDestroy(): Promise<void> {}

  override get enabled(): boolean {
    return true;
  }

  override async put(tenantId: string, kind: string, id: string, payload: unknown): Promise<void> {
    this.records.set(this.recordKey(tenantId, kind, id), {
      tenantId,
      kind,
      id,
      payload: structuredClone(payload),
    });
  }

  override async get<T>(tenantId: string, kind: string, id: string): Promise<T | undefined> {
    const record = this.records.get(this.recordKey(tenantId, kind, id));
    return record ? structuredClone(record.payload) as T : undefined;
  }

  override async list<T>(tenantId: string, kind: string): Promise<T[]> {
    return [...this.records.values()]
      .filter((record) => record.tenantId === tenantId && record.kind === kind)
      .map((record) => structuredClone(record.payload) as T);
  }

  override async commitEventMutation<TRecordPayload = unknown, TOutboxPayload = unknown>(
    tenantId: string,
    records: readonly EventMutationRecord<TRecordPayload>[],
    audit: EventMutationAudit,
    outbox: EventMutationOutbox<TOutboxPayload>,
  ): Promise<EventMutationCommitResult> {
    const existing = this.outboxByEventId.get(outbox.eventId);
    if (existing && existing.tenantId !== tenantId) throw new Error('Cross-tenant outbox event collision.');
    const outboxPosition = existing?.outboxPosition ?? this.nextOutboxPosition;
    if (!existing) {
      this.nextOutboxPosition += 1;
      this.outboxByEventId.set(outbox.eventId, {
        tenantId,
        eventId: outbox.eventId,
        outboxPosition,
        payload: structuredClone(this.assignOutboxPosition(outbox.payload, outboxPosition)),
      });
    }
    for (const record of records) {
      await this.put(
        tenantId,
        record.kind,
        record.id,
        this.assignOutboxPosition(record.payload, outboxPosition),
      );
    }
    await this.put(tenantId, 'event_audit_evidence', audit.audit_id, audit);
    return { outboxPosition };
  }

  outbox(tenantId: string): StoredOutbox[] {
    return [...this.outboxByEventId.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => structuredClone(entry));
  }

  private recordKey(tenantId: string, kind: string, id: string): string {
    return `${tenantId}:${kind}:${id}`;
  }

  private assignOutboxPosition(payload: unknown, outboxPosition: number): unknown {
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
}

describe('Event Intelligence durable restart hydration (e2e)', () => {
  const database = new SharedMemoryDatabase();
  let app: NestFastifyApplication | undefined;

  const createApp = async (): Promise<NestFastifyApplication> => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue(database)
      .compile();
    const created = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await created.init();
    await created.getHttpAdapter().getInstance().ready();
    return created;
  };

  beforeAll(() => {
    process.env.EDT_DEMO_AUTH = 'true';
    process.env.EDT_FROZEN_CLOCK = 'true';
    delete process.env.DATABASE_URL;
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.EDT_FROZEN_CLOCK;
  });

  it('recreates event state, projection, replay evidence, idempotency, and rollback from durable records', async () => {
    app = await createApp();
    let event = (await request(app.getHttpServer())
      .post('/v1/event-intelligence/interpretations')
      .set(analyst)
      .set('idempotency-key', idempotencyKey('interpret'))
      .send({ text: 'Sarah Chen, the lead backend engineer, definitely left the company today.', requested_mode: 'reality' })
      .expect(201)).body.events[0];
    const selected = event.entity_resolutions[0].candidates.find(
      (candidate: { display_name: string }) => candidate.display_name === 'Sarah Chen',
    );
    expect(selected).toBeDefined();

    event = (await request(app.getHttpServer())
      .post(`/v1/event-intelligence/events/${event.event_id}/reviews`)
      .set(analyst)
      .set('idempotency-key', idempotencyKey('review'))
      .set('if-match', event.etag)
      .send({
        expected_version: event.version,
        verification_status: 'confirmed',
        target_mode: 'reality',
        entity_resolutions: [{ mention: event.entity_resolutions[0].mention, selected_entity_id: selected.entity_id }],
        notes: 'Confirm the synthetic departure and bind every projected effect to Sarah Chen.',
      })
      .expect(200)).body;

    const approval = (await request(app.getHttpServer())
      .post(`/v1/event-intelligence/events/${event.event_id}/approval-requests`)
      .set(analyst)
      .set('idempotency-key', idempotencyKey('approval'))
      .set('if-match', event.etag)
      .send({
        expected_version: event.version,
        reviewed_payload_hash: event.reviewed_payload_hash,
        reason: 'Approve the exact synthetic reality projection for restart verification.',
      })
      .expect(201)).body;
    expect(approval.status).toBe('pending');

    await request(app.getHttpServer())
      .post(`/v1/event-intelligence/approval-requests/${approval.approval_id}/decisions`)
      .set(operations)
      .set('idempotency-key', idempotencyKey('operations'))
      .send({ decision: 'approve', payload_hash: approval.payload_hash })
      .expect(200);
    const approved = await request(app.getHttpServer())
      .post(`/v1/event-intelligence/approval-requests/${approval.approval_id}/decisions`)
      .set(security)
      .set('idempotency-key', idempotencyKey('security'))
      .send({ decision: 'approve', payload_hash: approval.payload_hash })
      .expect(200);
    expect(approved.body.status).toBe('approved');

    const approvedEvent = (await request(app.getHttpServer())
      .get(`/v1/event-intelligence/events/${event.event_id}`)
      .set(analyst)
      .expect(200)).body;
    const applyBody = {
      expected_version: approvedEvent.version,
      reviewed_payload_hash: approvedEvent.reviewed_payload_hash,
      approval_id: approval.approval_id,
    };
    const applied = (await request(app.getHttpServer())
      .post(`/v1/event-intelligence/events/${event.event_id}/apply`)
      .set(analyst)
      .set('idempotency-key', idempotencyKey('apply'))
      .set('if-match', approvedEvent.etag)
      .send(applyBody)
      .expect(200)).body;
    expect(applied.action).toBe('apply_reality');
    expect(applied.outbox_position).toBe(1);
    expect(database.outbox(ASTER_TENANT_ID)).toHaveLength(1);
    expect(database.outbox(ASTER_TENANT_ID)[0].payload).toEqual(expect.objectContaining({
      dataschema: EVENT_CHANGED_SCHEMA_ID,
      schema_hash: EVENT_CHANGED_SCHEMA_HASH,
      outbox_position: applied.outbox_position,
      data: expect.objectContaining({
        approval_id: approval.approval_id,
        receipt_id: applied.receipt_id,
      }),
    }));

    await app.close();
    app = undefined;
    app = await createApp();

    const hydratedEvent = (await request(app.getHttpServer())
      .get(`/v1/event-intelligence/events/${event.event_id}`)
      .set(analyst)
      .expect(200)).body;
    expect(hydratedEvent).toEqual(expect.objectContaining({
      event_id: event.event_id,
      status: 'applied',
      applied_payload_hash: applied.payload_hash,
      branch_id: applied.branch_id,
    }));

    const hydratedApproval = (await request(app.getHttpServer())
      .get(`/v1/event-intelligence/approval-requests/${approval.approval_id}`)
      .set(analyst)
      .expect(200)).body;
    expect(hydratedApproval.status).toBe('executed');
    expect(hydratedApproval.decisions).toHaveLength(2);
    expect(hydratedApproval.graph_snapshot_version).toBe(applied.graph_version_before);

    const replay = (await request(app.getHttpServer())
      .get(`/v1/event-intelligence/events/${event.event_id}/replay`)
      .set(analyst)
      .expect(200)).body;
    expect(replay.reconstructable).toBe(true);
    expect(replay.graph).toEqual({
      before_version: applied.graph_version_before,
      after_version: applied.graph_version_after,
      before_state_hash: applied.before_state_hash,
      after_state_hash: applied.after_state_hash,
    });
    expect(replay.receipts).toEqual([
      expect.objectContaining({ receipt_id: applied.receipt_id, outbox_position: applied.outbox_position }),
    ]);
    expect(replay.timeline).toEqual([
      expect.objectContaining({
        action: 'event_applied',
        receipt_id: applied.receipt_id,
        graph_version_after: applied.graph_version_after,
      }),
    ]);
    expect(replay.branch).toEqual(expect.objectContaining({
      branch_id: applied.branch_id,
      event_ids: expect.arrayContaining([event.event_id]),
      state_hash: applied.after_state_hash,
    }));
    expect(replay.entity_changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity_id: selected.entity_id,
        before: expect.objectContaining({ state: 'active' }),
        after: expect.objectContaining({ state: 'departed' }),
      }),
    ]));
    const applications = await database.list<Record<string, unknown>>(ASTER_TENANT_ID, 'event_application');
    expect(applications).toEqual([
      expect.objectContaining({
        event_id: event.event_id,
        approval_id: approval.approval_id,
        before_graph_version: applied.graph_version_before,
        after_graph_version: applied.graph_version_after,
      }),
    ]);

    const projected = (await request(app.getHttpServer())
      .get(`/v1/entities/${selected.entity_id}`)
      .set(analyst)
      .expect(200)).body;
    expect(projected.entity.properties.state).toBe('departed');
    expect(projected.event_projection).toEqual({
      version: applied.graph_version_after,
      state_hash: applied.after_state_hash,
    });
    const traversal = (await request(app.getHttpServer())
      .post('/v1/graph/traversals')
      .set(analyst)
      .send({ template: 'ownership_path', max_nodes: 100 })
      .expect(201)).body;
    expect(traversal.projection_generation).toBe(applied.graph_version_after);
    expect(traversal.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'NEEDS_OWNER', state: 'active' }),
    ]));

    const idempotentReplay = (await request(app.getHttpServer())
      .post(`/v1/event-intelligence/events/${event.event_id}/apply`)
      .set(analyst)
      .set('idempotency-key', idempotencyKey('apply'))
      .set('if-match', approvedEvent.etag)
      .send(applyBody)
      .expect(200)).body;
    expect(idempotentReplay).toEqual(expect.objectContaining({
      receipt_id: applied.receipt_id,
      outbox_position: applied.outbox_position,
      replayed: true,
    }));
    expect(database.outbox(ASTER_TENANT_ID)).toHaveLength(1);

    const rollback = (await request(app.getHttpServer())
      .post(`/v1/event-intelligence/events/${event.event_id}/rollback`)
      .set(operations)
      .set('idempotency-key', idempotencyKey('rollback'))
      .set('if-match', hydratedEvent.etag)
      .send({
        expected_version: hydratedEvent.version,
        applied_payload_hash: hydratedEvent.applied_payload_hash,
        reason: 'Restore the exact pre-event projection after proving restart hydration.',
      })
      .expect(200)).body;
    expect(rollback).toEqual(expect.objectContaining({
      action: 'rollback',
      before_state_hash: applied.after_state_hash,
      after_state_hash: applied.before_state_hash,
      outbox_position: 2,
    }));
    expect(database.outbox(ASTER_TENANT_ID)).toHaveLength(2);

    const restored = (await request(app.getHttpServer())
      .get(`/v1/entities/${selected.entity_id}`)
      .set(analyst)
      .expect(200)).body;
    expect(restored.entity.properties.state).toBe('active');
    const replayAfterRollback = (await request(app.getHttpServer())
      .get(`/v1/event-intelligence/events/${event.event_id}/replay`)
      .set(analyst)
      .expect(200)).body;
    expect(replayAfterRollback.current_status).toBe('rolled_back');
    expect(replayAfterRollback.receipts.map((receipt: { receipt_id: string }) => receipt.receipt_id)).toEqual([
      applied.receipt_id,
      rollback.receipt_id,
    ]);
    expect(replayAfterRollback.timeline.map((entry: { action: string }) => entry.action)).toEqual([
      'event_applied',
      'event_rolled_back',
    ]);
  });

  it('surfaces invalid, gapped, forked, orphaned, empty, and incomplete audit chains and blocks new audited mutation', async () => {
    const events = await database.list<IntelligenceEvent>(ASTER_TENANT_ID, 'intelligence_event');
    const event = events[0];
    expect(event).toBeDefined();
    const audits = (await database.list<EventAuditEvidence>(ASTER_TENANT_ID, 'event_audit_evidence'))
      .sort((left, right) => left.tenant_sequence - right.tenant_sequence);
    expect(audits.length).toBeGreaterThan(0);
    const root = audits[0];
    const tail = audits.at(-1) as EventAuditEvidence;
    const makeValidAudit = (candidate: Omit<EventAuditEvidence, 'event_hash'>): EventAuditEvidence => {
      const { event_hash: _ignored, ...base } = candidate as EventAuditEvidence;
      return { ...base, event_hash: sha256({ ...base, tenant_id: ASTER_TENANT_ID }) };
    };
    const fork = makeValidAudit({
      ...root,
      audit_id: '70000000-0000-4000-8000-000000000101',
      tenant_sequence: 1,
      action: 'event.audit.fixture.fork',
      resource_id: event.event_id,
      details_hash: '1'.repeat(64),
      previous_hash: '0'.repeat(64),
    });
    const gap = makeValidAudit({
      ...tail,
      audit_id: '70000000-0000-4000-8000-000000000102',
      tenant_sequence: tail.tenant_sequence + 1,
      action: 'event.audit.fixture.gap',
      resource_id: event.event_id,
      details_hash: '2'.repeat(64),
      previous_hash: 'a'.repeat(64),
    });
    const invalid: EventAuditEvidence = {
      ...tail,
      audit_id: '70000000-0000-4000-8000-000000000103',
      tenant_sequence: tail.tenant_sequence + 1,
      action: 'event.audit.fixture.invalid',
      resource_id: event.event_id,
      details_hash: '3'.repeat(64),
      previous_hash: tail.event_hash,
      event_hash: 'f'.repeat(64),
    };
    await database.put(ASTER_TENANT_ID, 'event_audit_evidence', fork.audit_id, fork);
    await database.put(ASTER_TENANT_ID, 'event_audit_evidence', gap.audit_id, gap);
    await database.put(ASTER_TENANT_ID, 'event_audit_evidence', invalid.audit_id, invalid);

    const beaconEvent: IntelligenceEvent = {
      ...structuredClone(event),
      event_id: '71000000-0000-4000-8000-000000000101',
      interpretation_id: '71000000-0000-4000-8000-000000000102',
      tenant_id: BEACON_TENANT_ID,
      version: 1,
      status: 'interpreted',
      source: {
        ...structuredClone(event.source),
        creator_id: '20000000-0000-4000-8000-000000000006',
      },
      reviewed_payload_hash: null,
      applied_payload_hash: null,
      branch_id: null,
      audit_evidence: {
        ...structuredClone(event.audit_evidence),
        audit_id: '71000000-0000-4000-8000-000000000103',
        resource_id: '71000000-0000-4000-8000-000000000101',
      },
    };
    await database.put(BEACON_TENANT_ID, 'intelligence_event', beaconEvent.event_id, beaconEvent);

    await app?.close();
    app = await createApp();

    const unhealthy = (await request(app.getHttpServer())
      .get(`/v1/event-intelligence/events/${event.event_id}/audit`)
      .set(analyst)
      .expect(200)).body;
    expect(unhealthy.chain_valid).toBe(false);
    expect(unhealthy.diagnostics).toEqual(expect.objectContaining({
      invalid_records: 1,
      gap_records: 1,
      fork_points: 1,
      diagnostics_truncated: false,
    }));
    expect(unhealthy.diagnostics.orphan_records).toBeGreaterThanOrEqual(2);
    expect(unhealthy.diagnostics.issues).toEqual(expect.arrayContaining([
      'invalid_records', 'hash_gaps', 'forks', 'orphan_records',
    ]));

    const empty = (await request(app.getHttpServer())
      .get(`/v1/event-intelligence/events/${beaconEvent.event_id}/audit`)
      .set(beaconAnalyst)
      .expect(200)).body;
    expect(empty.chain_valid).toBe(false);
    expect(empty.diagnostics.total_records).toBe(0);
    expect(empty.diagnostics.event_records).toBe(0);
    expect(empty.diagnostics.missing_event_audit_ids).toContain(beaconEvent.audit_evidence.audit_id);
    expect(empty.diagnostics.issues).toEqual(expect.arrayContaining(['empty_chain', 'incomplete_event_chain']));

    await request(app.getHttpServer())
      .post('/v1/event-intelligence/interpretations')
      .set(analyst)
      .set('idempotency-key', idempotencyKey('unhealthy-audit-create'))
      .send({ text: 'The Payment Platform project was delayed today.', requested_mode: 'scenario' })
      .expect(503)
      .expect(({ body: problem }) => expect(problem.code).toBe('audit_chain_unhealthy'));
  });
});
