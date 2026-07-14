import { FastifyReply, FastifyRequest } from 'fastify';
import { ContextService } from './context.service';
import { DatabaseService } from './database.service';
import { DemoStoreService } from './demo-store.service';
import { FixtureService } from './fixture.service';
export declare class AdminController {
    private readonly contexts;
    private readonly fixtures;
    private readonly database;
    private readonly store;
    constructor(contexts: ContextService, fixtures: FixtureService, database: DatabaseService, store: DemoStoreService);
    health(): Record<string, unknown>;
    ready(): Promise<Record<string, unknown>>;
    me(request: FastifyRequest): Record<string, unknown>;
    selectContext(request: FastifyRequest, body: {
        membership_id?: string;
        audience?: string;
        delivery?: string;
    }, response: FastifyReply): Record<string, unknown>;
    connectors(request: FastifyRequest): object;
    audit(request: FastifyRequest): object;
    private publicActor;
    private publicContext;
}
