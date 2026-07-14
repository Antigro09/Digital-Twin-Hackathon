import { OnModuleInit } from '@nestjs/common';
import { ActorAlias, ActorRecord, RelationshipRecord, SourceObjectRecord, TenantAlias } from './domain';
interface SeedManifest {
    tenants: Array<{
        tenant_alias: TenantAlias;
        tenant_id: string;
        display_name: string;
        jira_installation_id: string;
        github_installation_id: string;
    }>;
    fixture: {
        fixture_version: string;
        simulation_seed: string;
        frozen_clock: string;
    };
}
interface IdentityFixture {
    actors: Array<{
        actor_alias: ActorAlias;
        actor_id: string;
        tenant_id: string;
        principal_ref: string;
    }>;
}
interface PermissionFixture {
    acl_classes: Record<string, {
        allowed_actors: ActorAlias[];
        denied_actors: ActorAlias[];
    }>;
    roles: Record<ActorAlias, {
        grants: string[];
        denials: string[];
    }>;
}
interface SourceFixture {
    source_objects: SourceObjectRecord[];
    relationships: RelationshipRecord[];
}
export declare class FixtureService implements OnModuleInit {
    private fixtureRoot;
    seed: SeedManifest;
    identities: IdentityFixture;
    permissions: PermissionFixture;
    sources: SourceFixture;
    oracle: Record<string, unknown>;
    onModuleInit(): void;
    private findFixtureRoot;
    private read;
    getActor(alias: string | undefined): ActorRecord;
    tenantForId(tenantId: string): {
        alias: TenantAlias;
        name: string;
        id: string;
    };
    membershipId(actor: ActorRecord): string;
    canRead(actor: ActorRecord, source: SourceObjectRecord): boolean;
    visibleSources(actor: ActorRecord): SourceObjectRecord[];
    tenantRelationships(tenantId: string): RelationshipRecord[];
    assertFrozenTenants(): void;
}
export {};
