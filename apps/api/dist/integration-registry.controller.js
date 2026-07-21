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
exports.IntegrationRegistryController = void 0;
const common_1 = require("@nestjs/common");
const context_service_1 = require("./context.service");
const integration_registry_service_1 = require("./integration-registry.service");
const request_validation_1 = require("./request-validation");
let IntegrationRegistryController = class IntegrationRegistryController {
    contexts;
    registry;
    constructor(contexts, registry) {
        this.contexts = contexts;
        this.registry = registry;
    }
    async createConnector(request, body, response) {
        const result = await this.registry.createConnector(this.contexts.resolve(request), body, (0, request_validation_1.requireIdempotencyKey)(request));
        this.setEtag(response, result);
        return result;
    }
    listConnectors(request, query) {
        return this.registry.listConnectors(this.contexts.resolve(request), query);
    }
    async connector(request, connectorId, response) {
        const result = await this.registry.getConnector(this.contexts.resolve(request), connectorId);
        this.setEtag(response, result);
        return result;
    }
    async updateConnector(request, connectorId, body, response) {
        const result = await this.registry.updateConnector(this.contexts.resolve(request), connectorId, body, (0, request_validation_1.requireIdempotencyKey)(request), this.ifMatch(request));
        this.setEtag(response, result);
        return result;
    }
    async createMcpServer(request, body, response) {
        const result = await this.registry.createMcpServer(this.contexts.resolve(request), body, (0, request_validation_1.requireIdempotencyKey)(request));
        this.setEtag(response, result);
        return result;
    }
    listMcpServers(request, query) {
        return this.registry.listMcpServers(this.contexts.resolve(request), query);
    }
    async mcpServer(request, serverId, response) {
        const result = await this.registry.getMcpServer(this.contexts.resolve(request), serverId);
        this.setEtag(response, result);
        return result;
    }
    async updateMcpServer(request, serverId, body, response) {
        const result = await this.registry.updateMcpServer(this.contexts.resolve(request), serverId, body, (0, request_validation_1.requireIdempotencyKey)(request), this.ifMatch(request));
        this.setEtag(response, result);
        return result;
    }
    ifMatch(request) {
        return typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined;
    }
    setEtag(response, result) {
        if (typeof result.etag === 'string')
            response.header('etag', result.etag);
    }
};
exports.IntegrationRegistryController = IntegrationRegistryController;
__decorate([
    (0, common_1.Post)('/connectors'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], IntegrationRegistryController.prototype, "createConnector", null);
__decorate([
    (0, common_1.Get)('/connectors'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], IntegrationRegistryController.prototype, "listConnectors", null);
__decorate([
    (0, common_1.Get)('/connectors/:connectorId'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('connectorId')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], IntegrationRegistryController.prototype, "connector", null);
__decorate([
    (0, common_1.Patch)('/connectors/:connectorId'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('connectorId')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, Object]),
    __metadata("design:returntype", Promise)
], IntegrationRegistryController.prototype, "updateConnector", null);
__decorate([
    (0, common_1.Post)('/mcp-servers'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], IntegrationRegistryController.prototype, "createMcpServer", null);
__decorate([
    (0, common_1.Get)('/mcp-servers'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], IntegrationRegistryController.prototype, "listMcpServers", null);
__decorate([
    (0, common_1.Get)('/mcp-servers/:serverId'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('serverId')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], IntegrationRegistryController.prototype, "mcpServer", null);
__decorate([
    (0, common_1.Patch)('/mcp-servers/:serverId'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('serverId')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, Object]),
    __metadata("design:returntype", Promise)
], IntegrationRegistryController.prototype, "updateMcpServer", null);
exports.IntegrationRegistryController = IntegrationRegistryController = __decorate([
    (0, common_1.Controller)('/v1/twin'),
    __metadata("design:paramtypes", [context_service_1.ContextService,
        integration_registry_service_1.IntegrationRegistryService])
], IntegrationRegistryController);
//# sourceMappingURL=integration-registry.controller.js.map