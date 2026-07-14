"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FixtureService = void 0;
const common_1 = require("@nestjs/common");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const yaml_1 = require("yaml");
const domain_1 = require("./domain");
let FixtureService = class FixtureService {
    fixtureRoot = '';
    seed;
    identities;
    permissions;
    sources;
    oracle;
    onModuleInit() {
        this.fixtureRoot = this.findFixtureRoot();
        this.seed = this.read('seed-manifest.yaml');
        this.identities = this.read('identity-mappings.yaml');
        this.permissions = this.read('permission-matrix.yaml');
        this.sources = this.read('source-fixtures.yaml');
        this.oracle = this.read('ground-truth-oracle.yaml');
    }
    findFixtureRoot() {
        const configured = process.env.EDT_FIXTURE_ROOT;
        const candidates = [
            configured,
            (0, node_path_1.resolve)(process.cwd(), 'docs/enterprise-digital-twin/fixtures/h1'),
            (0, node_path_1.resolve)(process.cwd(), '../../docs/enterprise-digital-twin/fixtures/h1'),
            (0, node_path_1.resolve)(__dirname, '../../../docs/enterprise-digital-twin/fixtures/h1'),
            (0, node_path_1.resolve)(__dirname, '../../../../docs/enterprise-digital-twin/fixtures/h1'),
        ].filter((item) => Boolean(item));
        const found = candidates.find((candidate) => (0, node_fs_1.existsSync)((0, node_path_1.resolve)(candidate, 'seed-manifest.yaml')));
        if (!found)
            throw new Error(`H1 fixture root not found. Checked: ${candidates.join(', ')}`);
        return found;
    }
    read(name) {
        return (0, yaml_1.parse)((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(this.fixtureRoot, name), 'utf8'));
    }
    getActor(alias) {
        const requested = (alias || 'usr_aster_analyst');
        const fixtureActor = this.identities.actors.find((actor) => actor.actor_alias === requested);
        if (!fixtureActor)
            throw new Error('Unknown synthetic actor');
        const policy = this.permissions.roles[requested] ?? { grants: [], denials: [] };
        const roles = [];
        if (policy.grants.includes('action.approve.operations'))
            roles.push('operations_approver');
        if (policy.grants.includes('action.approve.security'))
            roles.push('security_approver');
        if (policy.grants.includes('connector.admin'))
            roles.push('tenant_admin');
        if (requested.endsWith('_analyst'))
            roles.push('analyst');
        return { ...fixtureActor, roles, capabilities: [...policy.grants] };
    }
    tenantForId(tenantId) {
        const tenant = this.seed.tenants.find((item) => item.tenant_id === tenantId);
        if (!tenant)
            throw new Error('Unknown fixture tenant');
        return { alias: tenant.tenant_alias, name: tenant.display_name, id: tenant.tenant_id };
    }
    membershipId(actor) {
        return (0, domain_1.sha256)(`membership:${actor.actor_id}:${actor.tenant_id}`).slice(0, 8) + '-0000-4000-8000-' + (0, domain_1.sha256)(actor.actor_id).slice(0, 12);
    }
    canRead(actor, source) {
        if (actor.tenant_id !== source.tenant_id)
            return false;
        return this.permissions.acl_classes[source.acl_class]?.allowed_actors.includes(actor.actor_alias) ?? false;
    }
    visibleSources(actor) {
        return this.sources.source_objects.filter((source) => this.canRead(actor, source));
    }
    tenantRelationships(tenantId) {
        return this.sources.relationships.filter((relationship) => relationship.tenant_id === tenantId);
    }
    assertFrozenTenants() {
        const ids = this.seed.tenants.map((tenant) => tenant.tenant_id).sort();
        if (ids.join(',') !== [domain_1.ASTER_TENANT_ID, domain_1.BEACON_TENANT_ID].sort().join(',')) {
            throw new Error('H1 seed must contain exactly the frozen Aster and Beacon tenants');
        }
    }
};
exports.FixtureService = FixtureService;
exports.FixtureService = FixtureService = __decorate([
    (0, common_1.Injectable)()
], FixtureService);
//# sourceMappingURL=fixture.service.js.map