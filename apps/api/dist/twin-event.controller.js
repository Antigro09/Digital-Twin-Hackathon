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
exports.TwinEventController = void 0;
const common_1 = require("@nestjs/common");
const context_service_1 = require("./context.service");
const request_validation_1 = require("./request-validation");
const twin_event_service_1 = require("./twin-event.service");
let TwinEventController = class TwinEventController {
    contexts;
    events;
    constructor(contexts, events) {
        this.contexts = contexts;
        this.events = events;
    }
    eventTypes(request) {
        return this.events.eventTypes(this.contexts.resolve(request));
    }
    async createEvent(request, body, response) {
        const result = await this.events.createEvent(this.contexts.resolve(request), body, (0, request_validation_1.requireIdempotencyKey)(request));
        this.setEtag(response, result);
        return result;
    }
    listEvents(request, query) {
        return this.events.listEvents(this.contexts.resolve(request), query);
    }
    async event(request, eventId, response) {
        const result = await this.events.getEvent(this.contexts.resolve(request), eventId);
        this.setEtag(response, result);
        return result;
    }
    impactAnalysis(request, eventId, body) {
        return this.events.analyzeEventImpact(this.contexts.resolve(request), eventId, body);
    }
    async createDataPoint(request, body, response) {
        const result = await this.events.createDataPoint(this.contexts.resolve(request), body, (0, request_validation_1.requireIdempotencyKey)(request));
        this.setEtag(response, result);
        return result;
    }
    listDataPoints(request, query) {
        return this.events.listDataPoints(this.contexts.resolve(request), query);
    }
    async dataPoint(request, dataPointId, response) {
        const result = await this.events.getDataPoint(this.contexts.resolve(request), dataPointId);
        this.setEtag(response, result);
        return result;
    }
    setEtag(response, result) {
        if (typeof result.etag === 'string')
            response.header('etag', result.etag);
    }
};
exports.TwinEventController = TwinEventController;
__decorate([
    (0, common_1.Get)('/event-types'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], TwinEventController.prototype, "eventTypes", null);
__decorate([
    (0, common_1.Post)('/events'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], TwinEventController.prototype, "createEvent", null);
__decorate([
    (0, common_1.Get)('/events'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TwinEventController.prototype, "listEvents", null);
__decorate([
    (0, common_1.Get)('/events/:eventId'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('eventId')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], TwinEventController.prototype, "event", null);
__decorate([
    (0, common_1.Post)('/events/:eventId/impact-analysis'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('eventId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], TwinEventController.prototype, "impactAnalysis", null);
__decorate([
    (0, common_1.Post)('/data-points'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], TwinEventController.prototype, "createDataPoint", null);
__decorate([
    (0, common_1.Get)('/data-points'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TwinEventController.prototype, "listDataPoints", null);
__decorate([
    (0, common_1.Get)('/data-points/:dataPointId'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('dataPointId')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], TwinEventController.prototype, "dataPoint", null);
exports.TwinEventController = TwinEventController = __decorate([
    (0, common_1.Controller)('/v1/twin'),
    __metadata("design:paramtypes", [context_service_1.ContextService,
        twin_event_service_1.TwinEventService])
], TwinEventController);
//# sourceMappingURL=twin-event.controller.js.map