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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const demo_auth_service_1 = require("./demo-auth.service");
const domain_1 = require("./domain");
const fixture_service_1 = require("./fixture.service");
const problem_1 = require("./problem");
let ContextService = class ContextService {
    fixtures;
    auth;
    handles = new Map();
    constructor(fixtures, auth) {
        this.fixtures = fixtures;
        this.auth = auth;
    }
    resolve(request, allowBootstrap = false) {
        if (request.headers['x-tenant-id']) {
            throw new problem_1.ProblemException(common_1.HttpStatus.BAD_REQUEST, 'raw_tenant_selector_rejected', 'Tenant scope is derived by the server; X-Tenant-ID is never accepted.');
        }
        if (request.headers['x-demo-actor']) {
            throw new problem_1.ProblemException(common_1.HttpStatus.BAD_REQUEST, 'legacy_actor_selector_rejected', 'X-Demo-Actor is not authentication and is never accepted.');
        }
        const principal = this.auth.authenticate(request.headers.authorization);
        let actor;
        try {
            actor = this.fixtures.getActor(principal.actorAlias);
        }
        catch {
            throw new problem_1.ProblemException(common_1.HttpStatus.UNAUTHORIZED, 'invalid_actor', 'Authentication failed.');
        }
        if (actor.actor_id !== principal.actorId || actor.tenant_id !== principal.tenantId) {
            throw new problem_1.ProblemException(common_1.HttpStatus.UNAUTHORIZED, 'invalid_actor', 'Authentication failed.');
        }
        const membershipId = this.fixtures.membershipId(actor);
        const supplied = request.headers['x-edt-context'];
        let handle;
        if (typeof supplied === 'string') {
            handle = this.handles.get(supplied);
            if (!handle || handle.actorId !== actor.actor_id || handle.expiresAt <= Date.now()) {
                throw new problem_1.ProblemException(common_1.HttpStatus.UNAUTHORIZED, 'invalid_context', 'The opaque context handle is invalid or expired.');
            }
        }
        else if (!allowBootstrap) {
            handle = undefined;
        }
        const tenant = this.fixtures.tenantForId(handle?.tenantId ?? actor.tenant_id);
        return {
            tenantId: tenant.id,
            tenantAlias: tenant.alias,
            tenantName: tenant.name,
            actor,
            membershipId,
            contextHandle: handle?.handle,
            policyVersion: 'h1-policy/1.0.0',
            requestId: this.requestId(request),
        };
    }
    mint(actor, membershipId, audience) {
        if (this.fixtures.membershipId(actor) !== membershipId) {
            throw new problem_1.ProblemException(common_1.HttpStatus.NOT_FOUND, 'membership_not_found', 'Membership was not found.');
        }
        const handle = `edt_ctx_${(0, node_crypto_1.randomBytes)(32).toString('base64url')}`;
        const expiresAt = Date.now() + 15 * 60 * 1000;
        this.handles.set(handle, { handle, actorId: actor.actor_id, membershipId, tenantId: actor.tenant_id, audience, expiresAt });
        return { handle, expiresAt: new Date(expiresAt).toISOString() };
    }
    requestId(request) {
        const value = request.headers['x-request-id'];
        return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) ? value : (0, domain_1.newId)();
    }
};
exports.ContextService = ContextService;
exports.ContextService = ContextService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [fixture_service_1.FixtureService,
        demo_auth_service_1.DemoAuthService])
], ContextService);
//# sourceMappingURL=context.service.js.map