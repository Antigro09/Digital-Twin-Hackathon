import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
export declare class DatabaseService implements OnModuleInit, OnModuleDestroy {
    private readonly logger;
    private pool?;
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    get enabled(): boolean;
    put(tenantId: string, kind: string, id: string, payload: unknown): Promise<void>;
    get<T>(tenantId: string, kind: string, id: string): Promise<T | undefined>;
    list<T>(tenantId: string, kind: string): Promise<T[]>;
    health(): Promise<'connected' | 'in_memory'>;
    private withTenant;
    private migrate;
}
