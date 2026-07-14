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
exports.AgentController = void 0;
const common_1 = require("@nestjs/common");
const context_service_1 = require("./context.service");
const demo_store_service_1 = require("./demo-store.service");
const request_validation_1 = require("./request-validation");
let AgentController = class AgentController {
    contexts;
    store;
    constructor(contexts, store) {
        this.contexts = contexts;
        this.store = store;
    }
    async ask(request, body) {
        (0, request_validation_1.requireIdempotencyKey)(request);
        return this.store.createQuestion(this.contexts.resolve(request), String(body.question ?? ''));
    }
    run(request, runId) {
        return this.store.getAgentRun(this.contexts.resolve(request), runId);
    }
    events(request, runId) {
        const view = this.store.getAgentRun(this.contexts.resolve(request), runId);
        return `id: 1\nevent: run.completed\ndata: ${JSON.stringify({ schema_version: 1, run_id: runId, sequence: 1, result_url: `/v1/agent-runs/${runId}`, state: view })}\n\n`;
    }
    async cancel(request, runId, response) {
        (0, request_validation_1.requireIdempotencyKey)(request);
        const result = await this.store.cancelAgentRun(this.contexts.resolve(request), runId);
        response.status(result.terminal ? common_1.HttpStatus.OK : common_1.HttpStatus.ACCEPTED);
        return result.view;
    }
};
exports.AgentController = AgentController;
__decorate([
    (0, common_1.Post)('/questions'),
    (0, common_1.HttpCode)(common_1.HttpStatus.ACCEPTED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "ask", null);
__decorate([
    (0, common_1.Get)('/agent-runs/:runId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('runId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Object)
], AgentController.prototype, "run", null);
__decorate([
    (0, common_1.Get)('/agent-runs/:runId/events'),
    (0, common_1.Header)('content-type', 'text/event-stream; charset=utf-8'),
    (0, common_1.Header)('cache-control', 'no-cache, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('runId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", String)
], AgentController.prototype, "events", null);
__decorate([
    (0, common_1.Post)('/agent-runs/:runId/cancel'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('runId')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "cancel", null);
exports.AgentController = AgentController = __decorate([
    (0, common_1.Controller)('/v1'),
    __metadata("design:paramtypes", [context_service_1.ContextService, demo_store_service_1.DemoStoreService])
], AgentController);
//# sourceMappingURL=agent.controller.js.map