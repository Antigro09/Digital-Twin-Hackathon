"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const worker_1 = require("@temporalio/worker");
const fastify_1 = __importDefault(require("fastify"));
const node_path_1 = require("node:path");
const fixtures_1 = require("./fixtures");
const provider_simulator_1 = require("./provider-simulator");
const sync_service_1 = require("./sync-service");
async function main() {
    const fixtures = (0, fixtures_1.loadFixtures)();
    const provider = new provider_simulator_1.ProviderSimulator(fixtures);
    const sync = new sync_service_1.SyncService(fixtures);
    const app = (0, fastify_1.default)({ logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] }, bodyLimit: 1_048_576, requestTimeout: 10_000 });
    app.get('/healthz', async () => ({ workload: 'sync-worker', version: '1.0.0', ...(await sync.health()) }));
    app.post('/v1/sync/run', async (request, reply) => {
        const tenantId = String(request.body?.tenant_id ?? '');
        if (!/^10000000-0000-4000-8000-00000000000[12]$/.test(tenantId))
            return reply.code(404).send({ code: 'tenant_not_found' });
        return reply.send(await sync.syncTenant(tenantId));
    });
    app.get('/provider/github/repos/:owner/:repo/pulls/:number', async (request, reply) => {
        const result = provider.getGitHub(request.params.owner, request.params.repo, request.params.number);
        return result ? reply.send(result) : reply.code(404).send({ message: 'Not Found' });
    });
    app.get('/provider/jira/rest/api/3/issue/:issueKey', async (request, reply) => {
        const result = provider.getJira(request.params.issueKey);
        return result ? reply.send(result) : reply.code(404).send({ errorMessages: ['Issue does not exist or you do not have permission to see it.'] });
    });
    app.put('/provider/jira/rest/api/3/issue/:issueKey', async (request, reply) => {
        const idempotencyKey = request.headers['idempotency-key'];
        if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16)
            return reply.code(400).send({ code: 'idempotency_key_required' });
        try {
            return reply.send(provider.updateJira(request.params.issueKey, request.body, idempotencyKey));
        }
        catch (error) {
            const code = error instanceof Error ? error.message : 'provider_error';
            return reply.code(code === 'source_version_conflict' ? 409 : 400).send({ code });
        }
    });
    let temporalWorker;
    if (process.env.TEMPORAL_ADDRESS) {
        const connection = await worker_1.NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
        temporalWorker = await worker_1.Worker.create({
            connection,
            namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
            taskQueue: process.env.TEMPORAL_SYNC_TASK_QUEUE ?? 'edt-sync-v1',
            workflowsPath: (0, node_path_1.resolve)(__dirname, 'workflows.js'),
            activities: { syncTenantActivity: (tenantId) => sync.syncTenant(tenantId) },
        });
        void temporalWorker.run();
    }
    const close = async () => {
        temporalWorker?.shutdown();
        await sync.close();
        await app.close();
    };
    process.on('SIGTERM', () => void close());
    process.on('SIGINT', () => void close());
    await app.listen({ port: Number(process.env.PORT ?? 8090), host: '0.0.0.0' });
}
void main();
//# sourceMappingURL=main.js.map