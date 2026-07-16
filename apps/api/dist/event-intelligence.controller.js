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
exports.EventIntelligenceController = void 0;
const common_1 = require("@nestjs/common");
const context_service_1 = require("./context.service");
const event_intelligence_service_1 = require("./event-intelligence.service");
const request_validation_1 = require("./request-validation");
let EventIntelligenceController = class EventIntelligenceController {
    contexts;
    intelligence;
    constructor(contexts, intelligence) {
        this.contexts = contexts;
        this.intelligence = intelligence;
    }
    taxonomy(request) {
        return this.intelligence.taxonomy(this.contexts.resolve(request));
    }
    interpret(request, body) {
        return this.intelligence.interpret(this.contexts.resolve(request), body, (0, request_validation_1.requireIdempotencyKey)(request));
    }
    events(request, pageSize, pageCursor) {
        return this.intelligence.listEvents(this.contexts.resolve(request), pageSize, pageCursor);
    }
    event(request, eventId, response) {
        const event = this.intelligence.getEvent(this.contexts.resolve(request), eventId);
        response.header('etag', event.etag);
        return event;
    }
    async review(request, eventId, body, response) {
        const event = await this.intelligence.review(this.contexts.resolve(request), eventId, body, this.ifMatch(request), (0, request_validation_1.requireIdempotencyKey)(request));
        response.header('etag', event.etag);
        return event;
    }
    requestApproval(request, eventId, body) {
        return this.intelligence.requestApproval(this.contexts.resolve(request), eventId, body, this.ifMatch(request), (0, request_validation_1.requireIdempotencyKey)(request));
    }
    approval(request, approvalId) {
        return this.intelligence.getApproval(this.contexts.resolve(request), approvalId);
    }
    decide(request, approvalId, body) {
        return this.intelligence.decideApproval(this.contexts.resolve(request), approvalId, body, (0, request_validation_1.requireIdempotencyKey)(request));
    }
    apply(request, eventId, body) {
        return this.intelligence.apply(this.contexts.resolve(request), eventId, body, this.ifMatch(request), (0, request_validation_1.requireIdempotencyKey)(request));
    }
    rollback(request, eventId, body) {
        return this.intelligence.rollback(this.contexts.resolve(request), eventId, body, this.ifMatch(request), (0, request_validation_1.requireIdempotencyKey)(request));
    }
    audit(request, eventId) {
        return this.intelligence.eventAudit(this.contexts.resolve(request), eventId);
    }
    replay(request, eventId) {
        return this.intelligence.replay(this.contexts.resolve(request), eventId);
    }
    timeline(request) {
        return this.intelligence.timeline(this.contexts.resolve(request));
    }
    branches(request) {
        return this.intelligence.listBranches(this.contexts.resolve(request));
    }
    compareBranches(request, body) {
        return this.intelligence.compareBranches(this.contexts.resolve(request), body);
    }
    ifMatch(request) {
        const value = request.headers['if-match'];
        return typeof value === 'string' ? value : undefined;
    }
};
exports.EventIntelligenceController = EventIntelligenceController;
__decorate([
    (0, common_1.Get)('/taxonomy'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], EventIntelligenceController.prototype, "taxonomy", null);
__decorate([
    (0, common_1.Post)('/interpretations'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], EventIntelligenceController.prototype, "interpret", null);
__decorate([
    (0, common_1.Get)('/events'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('page_size')),
    __param(2, (0, common_1.Query)('page_cursor')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Object)
], EventIntelligenceController.prototype, "events", null);
__decorate([
    (0, common_1.Get)('/events/:eventId'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('eventId')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Object)
], EventIntelligenceController.prototype, "event", null);
__decorate([
    (0, common_1.Post)('/events/:eventId/reviews'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('eventId')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, Object]),
    __metadata("design:returntype", Promise)
], EventIntelligenceController.prototype, "review", null);
__decorate([
    (0, common_1.Post)('/events/:eventId/approval-requests'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('eventId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], EventIntelligenceController.prototype, "requestApproval", null);
__decorate([
    (0, common_1.Get)('/approval-requests/:approvalId'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('approvalId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Object)
], EventIntelligenceController.prototype, "approval", null);
__decorate([
    (0, common_1.Post)('/approval-requests/:approvalId/decisions'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('approvalId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], EventIntelligenceController.prototype, "decide", null);
__decorate([
    (0, common_1.Post)('/events/:eventId/apply'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('eventId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], EventIntelligenceController.prototype, "apply", null);
__decorate([
    (0, common_1.Post)('/events/:eventId/rollback'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('eventId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], EventIntelligenceController.prototype, "rollback", null);
__decorate([
    (0, common_1.Get)('/events/:eventId/audit'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('eventId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Object)
], EventIntelligenceController.prototype, "audit", null);
__decorate([
    (0, common_1.Get)('/events/:eventId/replay'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('eventId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Object)
], EventIntelligenceController.prototype, "replay", null);
__decorate([
    (0, common_1.Get)('/timeline'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], EventIntelligenceController.prototype, "timeline", null);
__decorate([
    (0, common_1.Get)('/branches'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], EventIntelligenceController.prototype, "branches", null);
__decorate([
    (0, common_1.Post)('/branches/compare'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Object)
], EventIntelligenceController.prototype, "compareBranches", null);
exports.EventIntelligenceController = EventIntelligenceController = __decorate([
    (0, common_1.Controller)('/v1/event-intelligence'),
    __metadata("design:paramtypes", [context_service_1.ContextService,
        event_intelligence_service_1.EventIntelligenceService])
], EventIntelligenceController);
//# sourceMappingURL=event-intelligence.controller.js.map