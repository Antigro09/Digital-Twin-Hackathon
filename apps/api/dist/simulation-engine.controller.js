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
exports.SimulationEngineController = void 0;
const common_1 = require("@nestjs/common");
const context_service_1 = require("./context.service");
const request_validation_1 = require("./request-validation");
const simulation_engine_service_1 = require("./simulation-engine.service");
let SimulationEngineController = class SimulationEngineController {
    contexts;
    engine;
    constructor(contexts, engine) {
        this.contexts = contexts;
        this.engine = engine;
    }
    async snapshot(req, body, res) {
        return this.withEtag(res, await this.engine.createSnapshot(this.contexts.resolve(req), body, (0, request_validation_1.requireIdempotencyKey)(req)));
    }
    async getSnapshot(req, snapshotId, res) {
        return this.withEtag(res, await this.engine.getSnapshot(this.contexts.resolve(req), snapshotId));
    }
    async scenario(req, body, res) {
        return this.withEtag(res, await this.engine.createScenario(this.contexts.resolve(req), body, (0, request_validation_1.requireIdempotencyKey)(req)));
    }
    branches(req, scenarioId) {
        return this.engine.listBranches(this.contexts.resolve(req), scenarioId);
    }
    async branch(req, scenarioId, body, res) {
        return this.withEtag(res, await this.engine.createBranch(this.contexts.resolve(req), scenarioId, body, (0, request_validation_1.requireIdempotencyKey)(req)));
    }
    async confirm(req, scenarioId, branchId, body, res) {
        const ifMatch = typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : undefined;
        return this.withEtag(res, await this.engine.confirmBranch(this.contexts.resolve(req), scenarioId, branchId, body, (0, request_validation_1.requireIdempotencyKey)(req), ifMatch));
    }
    run(req, body) {
        return this.engine.run(this.contexts.resolve(req), body, (0, request_validation_1.requireIdempotencyKey)(req));
    }
    getRun(req, simulationId) {
        return this.engine.getRun(this.contexts.resolve(req), simulationId);
    }
    compare(req, body) {
        return this.engine.compareRuns(this.contexts.resolve(req), body);
    }
    withEtag(response, result) {
        if (typeof result.etag === 'string')
            response.header('etag', result.etag);
        return result;
    }
};
exports.SimulationEngineController = SimulationEngineController;
__decorate([
    (0, common_1.Post)('/snapshots'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], SimulationEngineController.prototype, "snapshot", null);
__decorate([
    (0, common_1.Get)('/snapshots/:snapshotId'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('snapshotId')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], SimulationEngineController.prototype, "getSnapshot", null);
__decorate([
    (0, common_1.Post)('/scenarios'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], SimulationEngineController.prototype, "scenario", null);
__decorate([
    (0, common_1.Get)('/scenarios/:scenarioId/branches'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('scenarioId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SimulationEngineController.prototype, "branches", null);
__decorate([
    (0, common_1.Post)('/scenarios/:scenarioId/branches'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('scenarioId')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, Object]),
    __metadata("design:returntype", Promise)
], SimulationEngineController.prototype, "branch", null);
__decorate([
    (0, common_1.Post)('/scenarios/:scenarioId/branches/:branchId/confirm'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('scenarioId')),
    __param(2, (0, common_1.Param)('branchId')),
    __param(3, (0, common_1.Body)()),
    __param(4, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], SimulationEngineController.prototype, "confirm", null);
__decorate([
    (0, common_1.Post)('/runs'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], SimulationEngineController.prototype, "run", null);
__decorate([
    (0, common_1.Get)('/runs/:simulationId'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('simulationId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SimulationEngineController.prototype, "getRun", null);
__decorate([
    (0, common_1.Post)('/comparisons'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], SimulationEngineController.prototype, "compare", null);
exports.SimulationEngineController = SimulationEngineController = __decorate([
    (0, common_1.Controller)('/v1/twin/simulation'),
    __metadata("design:paramtypes", [context_service_1.ContextService, simulation_engine_service_1.SimulationEngineService])
], SimulationEngineController);
//# sourceMappingURL=simulation-engine.controller.js.map