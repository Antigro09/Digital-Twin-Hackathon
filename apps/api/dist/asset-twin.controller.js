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
exports.AssetTwinController = void 0;
const common_1 = require("@nestjs/common");
const asset_twin_service_1 = require("./asset-twin.service");
const context_service_1 = require("./context.service");
const request_validation_1 = require("./request-validation");
let AssetTwinController = class AssetTwinController {
    contexts;
    assets;
    constructor(contexts, assets) {
        this.contexts = contexts;
        this.assets = assets;
    }
    list(request) {
        return this.assets.listAssets(this.contexts.resolve(request));
    }
    twin(request, assetId) {
        return this.assets.getTwin(this.contexts.resolve(request), assetId);
    }
    telemetry(request, assetId, requestedLimit) {
        const limit = requestedLimit === undefined ? 1 : Number(requestedLimit);
        return this.assets.advanceTelemetry(this.contexts.resolve(request), assetId, limit);
    }
    async preview(request, assetId, body, response) {
        return this.createPreview(request, response, assetId, body);
    }
    async previewAlias(request, assetId, body, response) {
        return this.createPreview(request, response, assetId, body);
    }
    execute(request, assetId, previewId) {
        return this.executePreview(request, assetId, previewId);
    }
    executeAlias(request, assetId, body) {
        return this.executePreview(request, assetId, String(body.preview_id ?? ''));
    }
    async createPreview(request, response, assetId, body) {
        const result = await this.assets.previewControl(this.contexts.resolve(request), assetId, body, (0, request_validation_1.requireIdempotencyKey)(request));
        response.header('etag', result.etag);
        response.header('cache-control', 'private, no-store');
        return result;
    }
    executePreview(request, assetId, previewId) {
        const ifMatch = typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined;
        return this.assets.executeControl(this.contexts.resolve(request), assetId, previewId, ifMatch, (0, request_validation_1.requireIdempotencyKey)(request));
    }
};
exports.AssetTwinController = AssetTwinController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], AssetTwinController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('/:assetId/twin'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('assetId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Object)
], AssetTwinController.prototype, "twin", null);
__decorate([
    (0, common_1.Get)('/:assetId/telemetry'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('assetId')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Object)
], AssetTwinController.prototype, "telemetry", null);
__decorate([
    (0, common_1.Post)('/:assetId/control-previews'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('assetId')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, Object]),
    __metadata("design:returntype", Promise)
], AssetTwinController.prototype, "preview", null);
__decorate([
    (0, common_1.Post)('/:assetId/commands/preview'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('assetId')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, Object]),
    __metadata("design:returntype", Promise)
], AssetTwinController.prototype, "previewAlias", null);
__decorate([
    (0, common_1.Post)('/:assetId/control-previews/:previewId/execute'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('assetId')),
    __param(2, (0, common_1.Param)('previewId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], AssetTwinController.prototype, "execute", null);
__decorate([
    (0, common_1.Post)('/:assetId/commands/execute'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('assetId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AssetTwinController.prototype, "executeAlias", null);
exports.AssetTwinController = AssetTwinController = __decorate([
    (0, common_1.Controller)('/v1/assets'),
    __metadata("design:paramtypes", [context_service_1.ContextService,
        asset_twin_service_1.AssetTwinService])
], AssetTwinController);
//# sourceMappingURL=asset-twin.controller.js.map