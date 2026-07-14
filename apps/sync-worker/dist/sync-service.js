"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncService = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const neo4j_driver_1 = __importDefault(require("neo4j-driver"));
const pg_1 = require("pg");
const canonical_1 = require("./canonical");
class SyncService {
    fixtures;
    pool;
    s3;
    graph;
    bucket;
    s3Ready = false;
    memory = new Map();
    constructor(fixtures) {
        this.fixtures = fixtures;
        if (process.env.DATABASE_URL)
            this.pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL, max: 4, statement_timeout: 10_000 });
        if (process.env.S3_ENDPOINT) {
            this.s3 = new client_s3_1.S3Client({
                endpoint: process.env.S3_ENDPOINT,
                region: process.env.S3_REGION ?? 'us-east-1',
                forcePathStyle: true,
                credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minio', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minio-development-only' },
            });
        }
        if (process.env.NEO4J_URI)
            this.graph = neo4j_driver_1.default.driver(process.env.NEO4J_URI, neo4j_driver_1.default.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'neo4j-development-only'));
        this.bucket = process.env.S3_SOURCE_BUCKET ?? 'edt-source-payloads';
    }
    async close() {
        await this.pool?.end();
        await this.graph?.close();
    }
    async health() {
        if (this.pool)
            await this.pool.query('select 1');
        if (this.graph)
            await this.graph.verifyConnectivity();
        return { status: 'ok', postgres: this.pool ? 'connected' : 'in_memory', object_store: this.s3 ? 'connected' : 'in_memory', graph: this.graph ? 'connected' : 'in_memory' };
    }
    async syncTenant(tenantId) {
        const sources = this.fixtures.source_objects
            .filter((source) => source.tenant_id === tenantId)
            .sort((a, b) => `${a.provider}:${a.source_key}:${a.source_revision}`.localeCompare(`${b.provider}:${b.source_key}:${b.source_revision}`, 'en'));
        if (!sources.length)
            throw new Error('tenant_not_found');
        const relationships = this.fixtures.relationships.filter((relationship) => relationship.tenant_id === tenantId);
        if (this.s3)
            await this.ensureBucket();
        let outboxPosition = 0;
        for (const source of sources) {
            const observation = this.normalize(source);
            this.memory.set(`${tenantId}:${source.provider}:${source.source_key}`, structuredClone(source));
            if (this.s3)
                await this.storeRaw(source);
            if (this.pool)
                outboxPosition = await this.persistObservation(tenantId, source, observation);
            if (this.graph)
                await this.projectSource(source);
        }
        if (this.graph)
            await this.projectRelationships(tenantId, relationships);
        const digestDomain = { sources, relationships };
        const providerRevisions = Object.fromEntries(sources.map((source) => [`${source.provider}:${source.source_key}`, source.source_revision]));
        const stateDigest = (0, canonical_1.sha256)(digestDomain);
        return {
            tenant_id: tenantId,
            source_count: sources.length,
            relationship_count: relationships.length,
            inserted_or_updated: sources.length,
            external_effect_count: 0,
            state_digest: stateDigest,
            cursor: { provider_revisions: providerRevisions, digest: (0, canonical_1.sha256)(providerRevisions) },
            projection_checkpoint: { outbox_position: outboxPosition || sources.length, projection_generation: 1 },
        };
    }
    normalize(source) {
        return {
            observation_id: (0, canonical_1.stableUuid)(`observation:${source.tenant_id}:${source.provider}:${source.source_key}:${source.source_revision}`),
            tenant_id: source.tenant_id,
            installation_id: source.installation_id,
            provider: source.provider,
            object_type: source.provider === 'jira' ? 'jira_issue' : 'github_pull_request',
            source_key: source.source_key,
            source_revision: source.source_revision,
            observed_at: source.observed_at,
            content_hash: (0, canonical_1.sha256)(source),
            acl_class: source.acl_class,
            untrusted_content: true,
            fields: source.fields,
            mapping_version: `${source.provider}-h1/1.0.0`,
        };
    }
    async ensureBucket() {
        if (!this.s3 || this.s3Ready)
            return;
        try {
            await this.s3.send(new client_s3_1.HeadBucketCommand({ Bucket: this.bucket }));
        }
        catch {
            await this.s3.send(new client_s3_1.CreateBucketCommand({ Bucket: this.bucket }));
        }
        this.s3Ready = true;
    }
    async storeRaw(source) {
        if (!this.s3)
            return;
        const body = (0, canonical_1.canonicalize)(source);
        const hash = (0, canonical_1.sha256)(body);
        await this.s3.send(new client_s3_1.PutObjectCommand({
            Bucket: this.bucket,
            Key: `${source.tenant_id}/raw/${source.provider}/${hash}.json`,
            Body: body,
            ContentType: 'application/json',
            Metadata: { sha256: hash, tenant: source.tenant_id, revision: source.source_revision },
        }));
    }
    async persistObservation(tenantId, source, observation) {
        if (!this.pool)
            return 0;
        const client = await this.pool.connect();
        try {
            await client.query('begin');
            await client.query('set local role edt_app');
            await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
            const observationId = String(observation.observation_id);
            await client.query(`insert into edt.records(tenant_id, kind, record_id, payload)
         values ($1::uuid, 'normalized_observation', $2::uuid, $3::jsonb)
         on conflict (tenant_id, kind, record_id) do update set payload=excluded.payload, updated_at=transaction_timestamp()`, [tenantId, observationId, JSON.stringify(observation)]);
            const eventId = (0, canonical_1.stableUuid)(`event:${observationId}`);
            const outbox = await client.query(`insert into edt.outbox(tenant_id,event_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload)
         values ($1::uuid,$2::uuid,'com.enterprisedigitaltwin.ingestion.observation-accepted.v1','observation',$3::uuid,1,$4::jsonb)
         on conflict(event_id) do update set payload=excluded.payload
         returning outbox_id`, [tenantId, eventId, observationId, JSON.stringify({ source_object_id: source.source_object_id, observation })]);
            await client.query('commit');
            return Number(outbox.rows[0].outbox_id);
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async projectSource(source) {
        if (!this.graph)
            return;
        const session = this.graph.session();
        try {
            await session.executeWrite((tx) => tx.run(`merge (n:SourceObject {tenant_id: $tenant_id, source_object_id: $source_object_id})
         set n.provider=$provider, n.source_key=$source_key, n.source_revision=$source_revision,
             n.classification=$classification, n.acl_hash=$acl_hash, n.projection_generation=1`, { tenant_id: source.tenant_id, source_object_id: source.source_object_id, provider: source.provider, source_key: source.source_key, source_revision: source.source_revision, classification: source.acl_class.includes('private') || source.acl_class.includes('restricted') ? 'restricted' : 'internal', acl_hash: (0, canonical_1.sha256)(source.acl_class) }));
        }
        finally {
            await session.close();
        }
    }
    async projectRelationships(tenantId, relationships) {
        if (!this.graph)
            return;
        const session = this.graph.session();
        try {
            for (const relationship of relationships) {
                await session.executeWrite((tx) => tx.run(`merge (a:ProjectionRef {tenant_id:$tenant_id, source_key:$from})
           merge (b:ProjectionRef {tenant_id:$tenant_id, source_key:$to})
           merge (a)-[r:RELATED {tenant_id:$tenant_id, relationship_id:$relationship_id}]->(b)
           set r.type=$type, r.projection_generation=1`, { tenant_id: tenantId, from: relationship.from, to: relationship.to, relationship_id: relationship.source_relationship_id, type: relationship.type }));
            }
        }
        finally {
            await session.close();
        }
    }
}
exports.SyncService = SyncService;
//# sourceMappingURL=sync-service.js.map