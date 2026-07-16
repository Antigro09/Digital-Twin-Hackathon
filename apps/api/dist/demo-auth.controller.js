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
exports.DemoAuthController = void 0;
const common_1 = require("@nestjs/common");
const demo_auth_service_1 = require("./demo-auth.service");
const fixture_service_1 = require("./fixture.service");
const problem_1 = require("./problem");
let DemoAuthController = class DemoAuthController {
    auth;
    fixtures;
    constructor(auth, fixtures) {
        this.auth = auth;
        this.fixtures = fixtures;
    }
    createSession(request, body) {
        this.auth.assertBootstrapKey(request.headers['x-demo-auth-key']);
        const keys = Object.keys(body);
        if (keys.length !== 1 || keys[0] !== 'actor_alias' || typeof body.actor_alias !== 'string') {
            throw new problem_1.ProblemException(common_1.HttpStatus.BAD_REQUEST, 'invalid_demo_session_request', 'The request must contain only actor_alias.');
        }
        try {
            const actor = this.fixtures.getActor(body.actor_alias);
            return this.auth.issue(actor);
        }
        catch (error) {
            if (error instanceof problem_1.ProblemException)
                throw error;
            throw new problem_1.ProblemException(common_1.HttpStatus.UNAUTHORIZED, 'invalid_demo_credentials', 'The local-demo bootstrap credential is invalid.');
        }
    }
};
exports.DemoAuthController = DemoAuthController;
__decorate([
    (0, common_1.Post)('/sessions'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Object)
], DemoAuthController.prototype, "createSession", null);
exports.DemoAuthController = DemoAuthController = __decorate([
    (0, common_1.Controller)('/v1/demo-auth'),
    __metadata("design:paramtypes", [demo_auth_service_1.DemoAuthService,
        fixture_service_1.FixtureService])
], DemoAuthController);
//# sourceMappingURL=demo-auth.controller.js.map