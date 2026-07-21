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
exports.PredictiveEngineController = void 0;
const common_1 = require("@nestjs/common");
const context_service_1 = require("./context.service");
const predictive_engine_service_1 = require("./predictive-engine.service");
const request_validation_1 = require("./request-validation");
let PredictiveEngineController = class PredictiveEngineController {
    contexts;
    engine;
    constructor(contexts, engine) {
        this.contexts = contexts;
        this.engine = engine;
    }
    async model(req, body, res) {
        return this.withEtag(res, await this.engine.registerModel(this.contexts.resolve(req), body, (0, request_validation_1.requireIdempotencyKey)(req)));
    }
    models(req, query) {
        return this.engine.listModels(this.contexts.resolve(req), query);
    }
    async getModel(req, modelId, res) {
        return this.withEtag(res, await this.engine.getModel(this.contexts.resolve(req), modelId));
    }
    async prediction(req, body, res) {
        return this.withEtag(res, await this.engine.createPrediction(this.contexts.resolve(req), body, (0, request_validation_1.requireIdempotencyKey)(req)));
    }
    async getPrediction(req, predictionId, res) {
        return this.withEtag(res, await this.engine.getPrediction(this.contexts.resolve(req), predictionId));
    }
    async outcome(req, predictionId, body, res) {
        return this.withEtag(res, await this.engine.recordOutcome(this.contexts.resolve(req), predictionId, body, (0, request_validation_1.requireIdempotencyKey)(req), this.ifMatch(req)));
    }
    async validation(req, predictionId, body, res) {
        return this.withEtag(res, await this.engine.validateOutcome(this.contexts.resolve(req), predictionId, body, (0, request_validation_1.requireIdempotencyKey)(req), this.ifMatch(req)));
    }
    knowledge(req, body) {
        return this.engine.submitKnowledge(this.contexts.resolve(req), body, (0, request_validation_1.requireIdempotencyKey)(req));
    }
    ifMatch(request) {
        return typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined;
    }
    withEtag(response, result) {
        if (typeof result.etag === 'string')
            response.header('etag', result.etag);
        return result;
    }
};
exports.PredictiveEngineController = PredictiveEngineController;
__decorate([
    (0, common_1.Post)('/models'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], PredictiveEngineController.prototype, "model", null);
__decorate([
    (0, common_1.Get)('/models'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PredictiveEngineController.prototype, "models", null);
__decorate([
    (0, common_1.Get)('/models/:modelId'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('modelId')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], PredictiveEngineController.prototype, "getModel", null);
__decorate([
    (0, common_1.Post)('/runs'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], PredictiveEngineController.prototype, "prediction", null);
__decorate([
    (0, common_1.Get)('/runs/:predictionId'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('predictionId')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], PredictiveEngineController.prototype, "getPrediction", null);
__decorate([
    (0, common_1.Post)('/runs/:predictionId/outcomes'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('predictionId')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, Object]),
    __metadata("design:returntype", Promise)
], PredictiveEngineController.prototype, "outcome", null);
__decorate([
    (0, common_1.Post)('/runs/:predictionId/validations'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('predictionId')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, Object]),
    __metadata("design:returntype", Promise)
], PredictiveEngineController.prototype, "validation", null);
__decorate([
    (0, common_1.Post)('/knowledge'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PredictiveEngineController.prototype, "knowledge", null);
exports.PredictiveEngineController = PredictiveEngineController = __decorate([
    (0, common_1.Controller)('/v1/twin/prediction'),
    __metadata("design:paramtypes", [context_service_1.ContextService, predictive_engine_service_1.PredictiveEngineService])
], PredictiveEngineController);
//# sourceMappingURL=predictive-engine.controller.js.map