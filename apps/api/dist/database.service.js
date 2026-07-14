"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var DatabaseService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
const common_1 = require("@nestjs/common");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const pg_1 = require("pg");
let DatabaseService = DatabaseService_1 = class DatabaseService {
    logger = new common_1.Logger(DatabaseService_1.name);
    pool;
    async onModuleInit() {
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
        if (!this.pool)
            return;
        await this.withTenant(tenantId, async (client) => {
            await client.query(`insert into edt.records(tenant_id, kind, record_id, payload)
         values ($1::uuid, $2, $3::uuid, $4::jsonb)
         on conflict (tenant_id, kind, record_id)
         do update set payload = excluded.payload, updated_at = transaction_timestamp()`, [tenantId, kind, id, JSON.stringify(payload)]);
        });
    }
    async get(tenantId, kind, id) {
        if (!this.pool)
            return undefined;
        return this.withTenant(tenantId, async (client) => {
            const result = await client.query('select payload from edt.records where tenant_id = $1::uuid and kind = $2 and record_id = $3::uuid', [tenantId, kind, id]);
            return result.rows[0]?.payload;
        });
    }
    async list(tenantId, kind) {
        if (!this.pool)
            return [];
        return this.withTenant(tenantId, async (client) => {
            const result = await client.query('select payload from edt.records where tenant_id = $1::uuid and kind = $2 order by created_at, record_id', [tenantId, kind]);
            return result.rows.map((row) => row.payload);
        });
    }
    async health() {
        if (!this.pool)
            return 'in_memory';
        await this.pool.query('select 1');
        return 'connected';
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
    async migrate() {
        if (!this.pool)
            return;
        const candidates = [
            (0, node_path_1.resolve)(process.cwd(), 'apps/api/db/migrations/001_init.sql'),
            (0, node_path_1.resolve)(process.cwd(), 'db/migrations/001_init.sql'),
            (0, node_path_1.resolve)(__dirname, '../db/migrations/001_init.sql'),
        ];
        const path = candidates.find((candidate) => (0, node_fs_1.existsSync)(candidate));
        if (!path)
            throw new Error('Database migration 001_init.sql was not found');
        await this.pool.query((0, node_fs_1.readFileSync)(path, 'utf8'));
    }
};
exports.DatabaseService = DatabaseService;
exports.DatabaseService = DatabaseService = DatabaseService_1 = __decorate([
    (0, common_1.Injectable)()
], DatabaseService);
//# sourceMappingURL=database.service.js.map