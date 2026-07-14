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
exports.SimulationController = void 0;
const common_1 = require("@nestjs/common");
const context_service_1 = require("./context.service");
const demo_store_service_1 = require("./demo-store.service");
const request_validation_1 = require("./request-validation");
let SimulationController = class SimulationController {
    contexts;
    store;
    constructor(contexts, store) {
        this.contexts = contexts;
        this.store = store;
    }
    snapshot(request, body) {
        (0, request_validation_1.requireIdempotencyKey)(request);
        return this.store.createSnapshot(this.contexts.resolve(request), String(body.project_id ?? ''), String(body.as_of ?? new Date().toISOString()));
    }
    scenario(request, body, response) {
        (0, request_validation_1.requireIdempotencyKey)(request);
        const result = this.store.createScenario(this.contexts.resolve(request), body);
        response.header('etag', String(result.etag));
        return result;
    }
    confirm(request, scenarioId, body) {
        (0, request_validation_1.requireIdempotencyKey)(request);
        const ifMatch = typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined;
        return this.store.confirmScenario(this.contexts.resolve(request), scenarioId, String(body.scenario_digest ?? ''), ifMatch);
    }
    async simulate(request, body) {
        (0, request_validation_1.requireIdempotencyKey)(request);
        return this.store.runSimulation(this.contexts.resolve(request), String(body.scenario_id ?? ''));
    }
    simulation(request, simulationId) {
        return this.store.getSimulation(this.contexts.resolve(request), simulationId);
    }
    events(request, simulationId) {
        const view = this.store.getSimulation(this.contexts.resolve(request), simulationId);
        return `id: 1\nevent: run.completed\ndata: ${JSON.stringify({ schema_version: 1, simulation_id: simulationId, sequence: 1, result_url: `/v1/simulations/${simulationId}`, state: view })}\n\n`;
    }
};
exports.SimulationController = SimulationController;
__decorate([
    (0, common_1.Post)('/simulation-snapshots'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Object)
], SimulationController.prototype, "snapshot", null);
__decorate([
    (0, common_1.Post)('/scenarios'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Object)
], SimulationController.prototype, "scenario", null);
__decorate([
    (0, common_1.Post)('/scenarios/:scenarioId/confirm'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('scenarioId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Object)
], SimulationController.prototype, "confirm", null);
__decorate([
    (0, common_1.Post)('/simulations'),
    (0, common_1.HttpCode)(common_1.HttpStatus.ACCEPTED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SimulationController.prototype, "simulate", null);
__decorate([
    (0, common_1.Get)('/simulations/:simulationId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('simulationId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Object)
], SimulationController.prototype, "simulation", null);
__decorate([
    (0, common_1.Get)('/simulations/:simulationId/events'),
    (0, common_1.Header)('content-type', 'text/event-stream; charset=utf-8'),
    (0, common_1.Header)('cache-control', 'no-cache, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('simulationId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", String)
], SimulationController.prototype, "events", null);
exports.SimulationController = SimulationController = __decorate([
    (0, common_1.Controller)('/v1'),
    __metadata("design:paramtypes", [context_service_1.ContextService, demo_store_service_1.DemoStoreService])
], SimulationController);
//# sourceMappingURL=simulation.controller.js.map