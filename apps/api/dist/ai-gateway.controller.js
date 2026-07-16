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
exports.AiGatewayController = void 0;
const common_1 = require("@nestjs/common");
const ai_gateway_service_1 = require("./ai-gateway.service");
const context_service_1 = require("./context.service");
const request_validation_1 = require("./request-validation");
let AiGatewayController = class AiGatewayController {
    contexts;
    gateway;
    constructor(contexts, gateway) {
        this.contexts = contexts;
        this.gateway = gateway;
    }
    status(request) {
        return this.gateway.status(this.contexts.resolve(request));
    }
    activity(request, pageSize) {
        return this.gateway.activity(this.contexts.resolve(request), pageSize);
    }
    runAgent(request, body) {
        const context = this.contexts.resolve(request);
        return this.gateway.runAgent(context, body, (0, request_validation_1.requireIdempotencyKey)(request));
    }
    retrieve(request, body) {
        return this.gateway.retrieve(this.contexts.resolve(request), body);
    }
    importDocument(request, body) {
        const context = this.contexts.resolve(request);
        return this.gateway.importDocument(context, body, (0, request_validation_1.requireIdempotencyKey)(request));
    }
    suggestions(request, pageSize, reviewDecision) {
        return this.gateway.suggestions(this.contexts.resolve(request), pageSize, reviewDecision);
    }
    reviewSuggestion(request, suggestionId, body) {
        const context = this.contexts.resolve(request);
        return this.gateway.reviewSuggestion(context, suggestionId, body, (0, request_validation_1.requireIdempotencyKey)(request));
    }
    recordLearningOutcome(request, body) {
        const context = this.contexts.resolve(request);
        return this.gateway.recordLearningOutcome(context, body, (0, request_validation_1.requireIdempotencyKey)(request));
    }
};
exports.AiGatewayController = AiGatewayController;
__decorate([
    (0, common_1.Get)('/status'),
    (0, common_1.Header)('cache-control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AiGatewayController.prototype, "status", null);
__decorate([
    (0, common_1.Get)('/activity'),
    (0, common_1.Header)('cache-control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('page_size')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AiGatewayController.prototype, "activity", null);
__decorate([
    (0, common_1.Post)('/agent-runs'),
    (0, common_1.HttpCode)(common_1.HttpStatus.ACCEPTED),
    (0, common_1.Header)('cache-control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AiGatewayController.prototype, "runAgent", null);
__decorate([
    (0, common_1.Post)('/retrieval/query'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('cache-control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AiGatewayController.prototype, "retrieve", null);
__decorate([
    (0, common_1.Post)('/knowledge/import'),
    (0, common_1.HttpCode)(common_1.HttpStatus.ACCEPTED),
    (0, common_1.Header)('cache-control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AiGatewayController.prototype, "importDocument", null);
__decorate([
    (0, common_1.Get)('/suggestions'),
    (0, common_1.Header)('cache-control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('page_size')),
    __param(2, (0, common_1.Query)('review_decision')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], AiGatewayController.prototype, "suggestions", null);
__decorate([
    (0, common_1.Post)('/suggestions/:suggestionId/reviews'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('cache-control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('suggestionId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AiGatewayController.prototype, "reviewSuggestion", null);
__decorate([
    (0, common_1.Post)('/learning/outcomes'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('cache-control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AiGatewayController.prototype, "recordLearningOutcome", null);
exports.AiGatewayController = AiGatewayController = __decorate([
    (0, common_1.Controller)('/v1/ai'),
    __metadata("design:paramtypes", [context_service_1.ContextService,
        ai_gateway_service_1.AiGatewayService])
], AiGatewayController);
//# sourceMappingURL=ai-gateway.controller.js.map