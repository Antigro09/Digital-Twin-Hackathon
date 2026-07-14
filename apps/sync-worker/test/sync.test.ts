import { describe, expect, it } from 'vitest';
import { loadFixtures } from '../src/fixtures';
import { ProviderSimulator } from '../src/provider-simulator';
import { SyncService } from '../src/sync-service';

describe('H1 synchronization worker', () => {
  it('is deterministic and tenant isolated under duplicate synchronization', async () => {
    const service = new SyncService(loadFixtures());
    const first = await service.syncTenant('10000000-0000-4000-8000-000000000001');
    const second = await service.syncTenant('10000000-0000-4000-8000-000000000001');
    const beacon = await service.syncTenant('10000000-0000-4000-8000-000000000002');
    expect(second.state_digest).toBe(first.state_digest);
    expect(second.external_effect_count).toBe(0);
    expect(beacon.state_digest).not.toBe(first.state_digest);
    await service.close();
  });

  it('executes the exact Jira mutation once and rejects payload drift', () => {
    const simulator = new ProviderSimulator(loadFixtures());
    const body = { version: 7, fields: { duedate: '2026-07-31', labels: ['digital-twin-remediation', 'identity', 'orion'], priority: { id: '2' } } };
    const first = simulator.updateJira('AST-142', body, '0123456789abcdef');
    const replay = simulator.updateJira('AST-142', body, '0123456789abcdef');
    expect(replay).toEqual(first);
    expect(simulator.putCount).toBe(1);
    expect(() => simulator.updateJira('AST-142', { ...body, version: 8 }, 'fedcba9876543210')).toThrow('payload_not_allowlisted');
  });
});
