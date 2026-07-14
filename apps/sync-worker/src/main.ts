import { NativeConnection, Worker } from '@temporalio/worker';
import Fastify from 'fastify';
import { resolve } from 'node:path';
import { loadFixtures } from './fixtures';
import { ProviderSimulator } from './provider-simulator';
import { SyncService } from './sync-service';

async function main(): Promise<void> {
  const fixtures = loadFixtures();
  const provider = new ProviderSimulator(fixtures);
  const sync = new SyncService(fixtures);
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] }, bodyLimit: 1_048_576, requestTimeout: 10_000 });

  app.get('/healthz', async () => ({ workload: 'sync-worker', version: '1.0.0', ...(await sync.health()) }));
  app.post<{ Body: { tenant_id?: string } }>('/v1/sync/run', async (request, reply) => {
    const tenantId = String(request.body?.tenant_id ?? '');
    if (!/^10000000-0000-4000-8000-00000000000[12]$/.test(tenantId)) return reply.code(404).send({ code: 'tenant_not_found' });
    return reply.send(await sync.syncTenant(tenantId));
  });
  app.get<{ Params: { owner: string; repo: string; number: string } }>('/provider/github/repos/:owner/:repo/pulls/:number', async (request, reply) => {
    const result = provider.getGitHub(request.params.owner, request.params.repo, request.params.number);
    return result ? reply.send(result) : reply.code(404).send({ message: 'Not Found' });
  });
  app.get<{ Params: { issueKey: string } }>('/provider/jira/rest/api/3/issue/:issueKey', async (request, reply) => {
    const result = provider.getJira(request.params.issueKey);
    return result ? reply.send(result) : reply.code(404).send({ errorMessages: ['Issue does not exist or you do not have permission to see it.'] });
  });
  app.put<{ Params: { issueKey: string }; Body: Record<string, unknown> }>('/provider/jira/rest/api/3/issue/:issueKey', async (request, reply) => {
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16) return reply.code(400).send({ code: 'idempotency_key_required' });
    try {
      return reply.send(provider.updateJira(request.params.issueKey, request.body, idempotencyKey));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'provider_error';
      return reply.code(code === 'source_version_conflict' ? 409 : 400).send({ code });
    }
  });

  let temporalWorker: Worker | undefined;
  if (process.env.TEMPORAL_ADDRESS) {
    const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
    temporalWorker = await Worker.create({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
      taskQueue: process.env.TEMPORAL_SYNC_TASK_QUEUE ?? 'edt-sync-v1',
      workflowsPath: resolve(__dirname, 'workflows.js'),
      activities: { syncTenantActivity: (tenantId: string) => sync.syncTenant(tenantId) },
    });
    void temporalWorker.run();
  }

  const close = async (): Promise<void> => {
    temporalWorker?.shutdown();
    await sync.close();
    await app.close();
  };
  process.on('SIGTERM', () => void close());
  process.on('SIGINT', () => void close());
  await app.listen({ port: Number(process.env.PORT ?? 8090), host: '0.0.0.0' });
}

void main();
