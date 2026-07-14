import { proxyActivities } from '@temporalio/workflow';
import type { SyncResult } from './sync-service';

const { syncTenantActivity } = proxyActivities<{ syncTenantActivity(tenantId: string): Promise<SyncResult> }>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 5, initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '30 seconds' },
});

export async function synchronizeTenant(tenantId: string): Promise<SyncResult> {
  return syncTenantActivity(tenantId);
}
