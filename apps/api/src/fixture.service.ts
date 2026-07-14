import { Injectable, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  ActorAlias,
  ActorRecord,
  ASTER_TENANT_ID,
  BEACON_TENANT_ID,
  RelationshipRecord,
  SourceObjectRecord,
  TenantAlias,
  sha256,
} from './domain';

interface SeedManifest {
  tenants: Array<{
    tenant_alias: TenantAlias;
    tenant_id: string;
    display_name: string;
    jira_installation_id: string;
    github_installation_id: string;
  }>;
  fixture: { fixture_version: string; simulation_seed: string; frozen_clock: string };
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
  acl_classes: Record<string, { allowed_actors: ActorAlias[]; denied_actors: ActorAlias[] }>;
  roles: Record<ActorAlias, { grants: string[]; denials: string[] }>;
}

interface SourceFixture {
  source_objects: SourceObjectRecord[];
  relationships: RelationshipRecord[];
}

@Injectable()
export class FixtureService implements OnModuleInit {
  private fixtureRoot = '';
  seed!: SeedManifest;
  identities!: IdentityFixture;
  permissions!: PermissionFixture;
  sources!: SourceFixture;
  oracle!: Record<string, unknown>;

  onModuleInit(): void {
    this.fixtureRoot = this.findFixtureRoot();
    this.seed = this.read<SeedManifest>('seed-manifest.yaml');
    this.identities = this.read<IdentityFixture>('identity-mappings.yaml');
    this.permissions = this.read<PermissionFixture>('permission-matrix.yaml');
    this.sources = this.read<SourceFixture>('source-fixtures.yaml');
    this.oracle = this.read<Record<string, unknown>>('ground-truth-oracle.yaml');
  }

  private findFixtureRoot(): string {
    const configured = process.env.EDT_FIXTURE_ROOT;
    const candidates = [
      configured,
      resolve(process.cwd(), 'docs/enterprise-digital-twin/fixtures/h1'),
      resolve(process.cwd(), '../../docs/enterprise-digital-twin/fixtures/h1'),
      resolve(__dirname, '../../../docs/enterprise-digital-twin/fixtures/h1'),
      resolve(__dirname, '../../../../docs/enterprise-digital-twin/fixtures/h1'),
    ].filter((item): item is string => Boolean(item));
    const found = candidates.find((candidate) => existsSync(resolve(candidate, 'seed-manifest.yaml')));
    if (!found) throw new Error(`H1 fixture root not found. Checked: ${candidates.join(', ')}`);
    return found;
  }

  private read<T>(name: string): T {
    return parse(readFileSync(resolve(this.fixtureRoot, name), 'utf8')) as T;
  }

  getActor(alias: string | undefined): ActorRecord {
    const requested = (alias || 'usr_aster_analyst') as ActorAlias;
    const fixtureActor = this.identities.actors.find((actor) => actor.actor_alias === requested);
    if (!fixtureActor) throw new Error('Unknown synthetic actor');
    const policy = this.permissions.roles[requested] ?? { grants: [], denials: [] };
    const roles: string[] = [];
    if (policy.grants.includes('action.approve.operations')) roles.push('operations_approver');
    if (policy.grants.includes('action.approve.security')) roles.push('security_approver');
    if (policy.grants.includes('connector.admin')) roles.push('tenant_admin');
    if (requested.endsWith('_analyst')) roles.push('analyst');
    return { ...fixtureActor, roles, capabilities: [...policy.grants] };
  }

  tenantForId(tenantId: string): { alias: TenantAlias; name: string; id: string } {
    const tenant = this.seed.tenants.find((item) => item.tenant_id === tenantId);
    if (!tenant) throw new Error('Unknown fixture tenant');
    return { alias: tenant.tenant_alias, name: tenant.display_name, id: tenant.tenant_id };
  }

  membershipId(actor: ActorRecord): string {
    return sha256(`membership:${actor.actor_id}:${actor.tenant_id}`).slice(0, 8) + '-0000-4000-8000-' + sha256(actor.actor_id).slice(0, 12);
  }

  canRead(actor: ActorRecord, source: SourceObjectRecord): boolean {
    if (actor.tenant_id !== source.tenant_id) return false;
    return this.permissions.acl_classes[source.acl_class]?.allowed_actors.includes(actor.actor_alias) ?? false;
  }

  visibleSources(actor: ActorRecord): SourceObjectRecord[] {
    return this.sources.source_objects.filter((source) => this.canRead(actor, source));
  }

  tenantRelationships(tenantId: string): RelationshipRecord[] {
    return this.sources.relationships.filter((relationship) => relationship.tenant_id === tenantId);
  }

  assertFrozenTenants(): void {
    const ids = this.seed.tenants.map((tenant) => tenant.tenant_id).sort();
    if (ids.join(',') !== [ASTER_TENANT_ID, BEACON_TENANT_ID].sort().join(',')) {
      throw new Error('H1 seed must contain exactly the frozen Aster and Beacon tenants');
    }
  }
}
