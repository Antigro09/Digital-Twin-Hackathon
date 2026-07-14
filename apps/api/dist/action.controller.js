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
exports.ActionController = void 0;
const common_1 = require("@nestjs/common");
const context_service_1 = require("./context.service");
const demo_store_service_1 = require("./demo-store.service");
const request_validation_1 = require("./request-validation");
let ActionController = class ActionController {
    contexts;
    store;
    constructor(contexts, store) {
        this.contexts = contexts;
        this.store = store;
    }
    async preview(request, body, response) {
        (0, request_validation_1.requireIdempotencyKey)(request);
        const result = await this.store.createPreview(this.contexts.resolve(request), body);
        response.header('etag', String(result.etag));
        return result;
    }
    async requestApproval(request, previewId) {
        const key = (0, request_validation_1.requireIdempotencyKey)(request);
        const ifMatch = typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined;
        return this.store.requestApproval(this.contexts.resolve(request), previewId, ifMatch, key);
    }
    approval(request, approvalId) {
        return this.store.getApproval(this.contexts.resolve(request), approvalId);
    }
    async decide(request, approvalId, body) {
        (0, request_validation_1.requireIdempotencyKey)(request);
        return this.store.decideApproval(this.contexts.resolve(request), approvalId, body);
    }
    async execute(request, approvalId) {
        const key = (0, request_validation_1.requireIdempotencyKey)(request);
        return this.store.executeApproval(this.contexts.resolve(request), approvalId, key);
    }
    async compensate(request, receiptId) {
        const key = (0, request_validation_1.requireIdempotencyKey)(request);
        return this.store.createCompensationApproval(this.contexts.resolve(request), receiptId, key);
    }
};
exports.ActionController = ActionController;
__decorate([
    (0, common_1.Post)('/actions/jira/remediation-previews'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], ActionController.prototype, "preview", null);
__decorate([
    (0, common_1.Post)('/actions/jira/remediation-previews/:previewId/approval-requests'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('previewId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ActionController.prototype, "requestApproval", null);
__decorate([
    (0, common_1.Get)('/approvals/:approvalId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('approvalId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Object)
], ActionController.prototype, "approval", null);
__decorate([
    (0, common_1.Post)('/approvals/:approvalId/decisions'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('approvalId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ActionController.prototype, "decide", null);
__decorate([
    (0, common_1.Post)('/approvals/:approvalId/execute'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('approvalId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ActionController.prototype, "execute", null);
__decorate([
    (0, common_1.Post)('/action-receipts/:receiptId/compensation-previews'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('receiptId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ActionController.prototype, "compensate", null);
exports.ActionController = ActionController = __decorate([
    (0, common_1.Controller)('/v1'),
    __metadata("design:paramtypes", [context_service_1.ContextService, demo_store_service_1.DemoStoreService])
], ActionController);
//# sourceMappingURL=action.controller.js.map