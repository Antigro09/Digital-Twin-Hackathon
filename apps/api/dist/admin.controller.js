"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const context_service_1 = require("./context.service");
const database_service_1 = require("./database.service");
const demo_store_service_1 = require("./demo-store.service");
const fixture_service_1 = require("./fixture.service");
let AdminController = class AdminController {
    contexts;
    fixtures;
    database;
    store;
    constructor(contexts, fixtures, database, store) {
        this.contexts = contexts;
        this.fixtures = fixtures;
        this.database = database;
        this.store = store;
    }
    health() {
        return { status: 'ok', workload: 'api', version: '1.0.0' };
    }
    async ready() {
        return { status: 'ready', postgres: await this.database.health(), fixtures: 'loaded' };
    }
    me(request) {
        const ctx = this.contexts.resolve(request, true);
        return {
            actor: this.publicActor(ctx),
            active_context: this.publicContext(ctx),
            memberships: [{ membership_id: ctx.membershipId, tenant_name: ctx.tenantName, tenant_alias: ctx.tenantAlias, roles: ctx.actor.roles }],
            capabilities: ctx.actor.capabilities,
        };
    }
    selectContext(request, body, response) {
        const ctx = this.contexts.resolve(request, true);
        const result = this.contexts.mint(ctx.actor, String(body.membership_id ?? ''), String(body.audience ?? 'edt-web'));
        response.header('cache-control', 'private, no-store');
        if (body.delivery === 'browser_cookie') {
            response.header('set-cookie', `EDT-Context=${result.handle}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900`);
            return { active_context: this.publicContext(ctx), expires_at: result.expiresAt, delivery: 'browser_cookie' };
        }
        return { active_context: this.publicContext(ctx), expires_at: result.expiresAt, delivery: 'sdk_header', context_handle: result.handle };
    }
    connectors(request) {
        return this.store.connectors(this.contexts.resolve(request));
    }
    audit(request) {
        return this.store.listAudit(this.contexts.resolve(request), 100);
    }
    publicActor(ctx) {
        return {
            actor_id: ctx.actor.actor_id,
            actor_type: 'human',
            tenant_id: ctx.tenantId,
            principal_ref: ctx.actor.principal_ref,
            status: 'active',
            assurance_level: ctx.actor.roles.some((role) => role.includes('approver')) ? 'aal2' : 'aal1',
            authenticates: true,
            display_name: ctx.actor.actor_alias,
        };
    }
    publicContext(ctx) {
        return {
            tenant_id: ctx.tenantId,
            membership_id: ctx.membershipId,
            actor: this.publicActor(ctx),
            active_delegations: [],
            purpose: 'interactive_read',
            policy_version: ctx.policyVersion,
            authorized_at: new Date().toISOString(),
            home_region: 'us-east-1',
            trace_context: { traceparent: '00-00000000000000000000000000000000-0000000000000000-01', request_id: ctx.requestId, tenant_safe_baggage: {} },
            derived_by_server: true,
        };
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Get)('/healthz'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], AdminController.prototype, "health", null);
__decorate([
    (0, common_1.Get)('/readyz'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "ready", null);
__decorate([
    (0, common_1.Get)('/v1/me'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], AdminController.prototype, "me", null);
__decorate([
    (0, common_1.Post)('/v1/context-selections'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Object)
], AdminController.prototype, "selectContext", null);
__decorate([
    (0, common_1.Get)('/v1/connectors'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], AdminController.prototype, "connectors", null);
__decorate([
    (0, common_1.Get)('/v1/audit-events'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], AdminController.prototype, "audit", null);
exports.AdminController = AdminController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [context_service_1.ContextService,
        fixture_service_1.FixtureService,
        database_service_1.DatabaseService,
        demo_store_service_1.DemoStoreService])
], AdminController);
//# sourceMappingURL=admin.controller.js.map