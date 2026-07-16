import { DatabaseService } from '../src/database.service';
import { DemoStoreService } from '../src/demo-store.service';
import { ASTER_TENANT_ID, BEACON_TENANT_ID, RequestContext } from '../src/domain';
import { EventProjectionError, EventProjectionService } from '../src/event-projection.service';
import { FixtureService } from '../src/fixture.service';

describe('Shared synthetic event projection', () => {
  it('seeds deterministic tenant-scoped JSON snapshots', () => {
    const first = new EventProjectionService();
    const second = new EventProjectionService();
    const aster = first.snapshot(ASTER_TENANT_ID);
    const beacon = first.snapshot(BEACON_TENANT_ID);

    expect(aster.version).toBe(1);
    expect(aster.state_hash).toBe(second.snapshot(ASTER_TENANT_ID).state_hash);
    expect(JSON.parse(JSON.stringify(aster))).toEqual(aster);
    expect(aster.entities.some((entity) => entity.display_name === 'Sarah Chen')).toBe(true);
    expect(beacon.entities.some((entity) => entity.display_name === 'Sarah Chen')).toBe(false);
    expect(beacon.entities.some((entity) => entity.display_name === 'Priya Raman')).toBe(true);
  });

  it('applies an exact departure mutation, preserves relationship history, and creates NEEDS_OWNER', () => {
    const projection = new EventProjectionService();
    const initial = projection.snapshot(ASTER_TENANT_ID);
    const sarah = initial.entities.find((entity) => entity.display_name === 'Sarah Chen');
    const authentication = initial.entities.find((entity) => entity.display_name === 'Authentication Service');
    expect(sarah).toBeDefined();
    expect(authentication).toBeDefined();

    const transition = projection.applyExact(ASTER_TENANT_ID, initial.version, initial.state_hash, [
      { impact_id: 'impact-departed', operation: 'set_state', entity_id: sarah?.entity_id, path: 'state', before: 'active', after: 'departed', value: 'departed' },
      { impact_id: 'impact-reporting', operation: 'modify_relationship', type: 'REPORTS_TO', from_entity_id: sarah?.entity_id, state: 'ended' },
      { impact_id: 'impact-owner', operation: 'remove_relationship', type: 'OWNS', from_entity_id: sarah?.entity_id, to: 'Authentication Service' },
    ]);

    expect(transition.before).toEqual(initial);
    expect(transition.after.version).toBe(2);
    expect(transition.after.state_hash).not.toBe(initial.state_hash);
    expect(transition.after.entities.find((entity) => entity.entity_id === sarah?.entity_id)?.state.state).toBe('departed');
    expect(transition.after.relationships.find((relationship) => relationship.type === 'REPORTS_TO' && relationship.from_entity_id === sarah?.entity_id)?.state).toBe('ended');
    expect(transition.after.relationships.find((relationship) => relationship.type === 'OWNS' && relationship.from_entity_id === sarah?.entity_id)?.state).toBe('removed');
    expect(transition.after.relationships).toContainEqual(expect.objectContaining({
      type: 'NEEDS_OWNER',
      from_entity_id: authentication?.entity_id,
      state: 'active',
    }));
    expect(transition.after.facts).toHaveLength(3);
  });

  it('rejects every unsupported authoritative operation without advancing or storing a fact', () => {
    const projection = new EventProjectionService();
    const initial = projection.snapshot(ASTER_TENANT_ID);

    expect(() => projection.applyExact(ASTER_TENANT_ID, initial.version, initial.state_hash, [
      { impact_id: 'impact-unsupported', operation: 'scenario_delta', entity: 'Payment Platform', target_date_shift_days: 14 },
    ])).toThrow(expect.objectContaining({ code: 'projection_unsupported_operation' }));
    expect(projection.snapshot(ASTER_TENANT_ID)).toEqual(initial);
  });

  it('fails closed on stale bindings and mismatched declared before values without partial effects', () => {
    const projection = new EventProjectionService();
    const initial = projection.snapshot(ASTER_TENANT_ID);
    const sarah = initial.entities.find((entity) => entity.display_name === 'Sarah Chen');

    projection.applyExact(ASTER_TENANT_ID, initial.version, initial.state_hash, [
      { impact_id: 'impact-first', operation: 'set_state', entity_id: sarah?.entity_id, path: 'state', before: 'active', value: 'departed' },
    ]);
    expect(() => projection.applyExact(ASTER_TENANT_ID, initial.version, initial.state_hash, [])).toThrow(
      expect.objectContaining({ code: 'projection_version_changed' }),
    );

    const current = projection.snapshot(ASTER_TENANT_ID);
    expect(() => projection.applyExact(ASTER_TENANT_ID, current.version, current.state_hash, [
      { impact_id: 'impact-wrong-before', operation: 'set_state', entity_id: sarah?.entity_id, path: 'state', before: 'active', value: 'departed' },
      { impact_id: 'impact-never-applied', operation: 'scenario_delta', metric: 'delivery_date' },
    ])).toThrow(expect.objectContaining({ code: 'projection_before_mismatch' }));
    expect(projection.snapshot(ASTER_TENANT_ID)).toEqual(current);
  });

  it('rolls back exact content with a monotonically increasing version and hydrates safely', () => {
    const projection = new EventProjectionService();
    const initial = projection.snapshot(ASTER_TENANT_ID);
    const sarah = initial.entities.find((entity) => entity.display_name === 'Sarah Chen');
    const applied = projection.applyExact(ASTER_TENANT_ID, initial.version, initial.state_hash, [
      { impact_id: 'impact-departed', operation: 'set_state', entity_id: sarah?.entity_id, path: 'state', before: 'active', value: 'departed' },
    ]).after;

    const reloaded = new EventProjectionService();
    expect(reloaded.hydrate(ASTER_TENANT_ID, applied)).toEqual(applied);
    const rollback = reloaded.rollbackExact(ASTER_TENANT_ID, applied.version, applied.state_hash, initial);
    expect(rollback.after.version).toBe(3);
    expect(rollback.after.state_hash).toBe(initial.state_hash);
    expect(() => reloaded.hydrate(ASTER_TENANT_ID, initial)).toThrow(EventProjectionError);
  });

  it('exposes applied event state through entity, graph, and simulation snapshot reads', () => {
    const fixtures = new FixtureService();
    fixtures.onModuleInit();
    const projection = new EventProjectionService();
    const store = new DemoStoreService(fixtures, new DatabaseService(), projection);
    store.onModuleInit();
    const actor = fixtures.getActor('usr_aster_analyst');
    const ctx: RequestContext = {
      tenantId: ASTER_TENANT_ID,
      tenantAlias: 'tnt_aster',
      tenantName: 'Aster Labs',
      actor,
      membershipId: fixtures.membershipId(actor),
      policyVersion: 'h1-policy/1.0.0',
      requestId: 'event-projection-integration-test',
    };
    const before = projection.snapshot(ASTER_TENANT_ID);
    const sarah = before.entities.find((entity) => entity.display_name === 'Sarah Chen');
    const applied = projection.applyExact(ASTER_TENANT_ID, before.version, before.state_hash, [
      { impact_id: 'impact-departed', operation: 'set_state', entity_id: sarah?.entity_id, path: 'state', before: 'active', value: 'departed' },
    ]).after;

    const page = store.listEntities(ctx, 100);
    const projected = page.items.find((entity) => entity.entity_id === sarah?.entity_id);
    expect((projected?.properties as Record<string, unknown>)?.state).toBe('departed');
    expect(store.getEntity(ctx, String(sarah?.entity_id)).event_projection).toEqual({ version: applied.version, state_hash: applied.state_hash });
    const graph = store.traverse(ctx, { template: 'ownership_path', max_nodes: 100 });
    expect((graph.nodes as Array<Record<string, unknown>>).some((entity) => entity.entity_id === sarah?.entity_id)).toBe(true);

    const simulationSnapshot = store.createSnapshot(ctx, '11111111-1111-4111-8111-111111111111', '2026-07-13T16:00:00Z');
    expect(simulationSnapshot.assumptions).toEqual(expect.arrayContaining([
      expect.stringContaining(`projection version ${applied.version}`),
    ]));
    expect(simulationSnapshot.warnings).toEqual(expect.arrayContaining([
      `event_projection_version:${applied.version}`,
      `event_projection_state_hash:${applied.state_hash}`,
    ]));
  });
});
