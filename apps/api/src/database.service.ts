import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, PoolClient } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool?: Pool;

  async onModuleInit(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) {
      if (process.env.EDT_REQUIRE_POSTGRES === 'true') throw new Error('DATABASE_URL is required');
      this.logger.warn('DATABASE_URL is unset; using the explicit synthetic in-memory test profile.');
      return;
    }
    this.pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, statement_timeout: 5_000 });
    await this.pool.query('select 1');
    if (process.env.EDT_AUTO_MIGRATE !== 'false') await this.migrate();
    this.logger.log('PostgreSQL authoritative record store connected.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  get enabled(): boolean {
    return Boolean(this.pool);
  }

  async put(tenantId: string, kind: string, id: string, payload: unknown): Promise<void> {
    if (!this.pool) return;
    await this.withTenant(tenantId, async (client) => {
      await client.query(
        `insert into edt.records(tenant_id, kind, record_id, payload)
         values ($1::uuid, $2, $3::uuid, $4::jsonb)
         on conflict (tenant_id, kind, record_id)
         do update set payload = excluded.payload, updated_at = transaction_timestamp()`,
        [tenantId, kind, id, JSON.stringify(payload)],
      );
    });
  }

  async get<T>(tenantId: string, kind: string, id: string): Promise<T | undefined> {
    if (!this.pool) return undefined;
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<{ payload: T }>(
        'select payload from edt.records where tenant_id = $1::uuid and kind = $2 and record_id = $3::uuid',
        [tenantId, kind, id],
      );
      return result.rows[0]?.payload;
    });
  }

  async list<T>(tenantId: string, kind: string): Promise<T[]> {
    if (!this.pool) return [];
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<{ payload: T }>(
        'select payload from edt.records where tenant_id = $1::uuid and kind = $2 order by created_at, record_id',
        [tenantId, kind],
      );
      return result.rows.map((row) => row.payload);
    });
  }

  async health(): Promise<'connected' | 'in_memory'> {
    if (!this.pool) return 'in_memory';
    await this.pool.query('select 1');
    return 'connected';
  }

  private async withTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error('PostgreSQL is not configured');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role edt_app');
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async migrate(): Promise<void> {
    if (!this.pool) return;
    const candidates = [
      resolve(process.cwd(), 'apps/api/db/migrations/001_init.sql'),
      resolve(process.cwd(), 'db/migrations/001_init.sql'),
      resolve(__dirname, '../db/migrations/001_init.sql'),
    ];
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) throw new Error('Database migration 001_init.sql was not found');
    await this.pool.query(readFileSync(path, 'utf8'));
  }
}
