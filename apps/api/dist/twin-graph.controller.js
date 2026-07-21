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
exports.TwinGraphController = void 0;
const common_1 = require("@nestjs/common");
const context_service_1 = require("./context.service");
const request_validation_1 = require("./request-validation");
const twin_graph_service_1 = require("./twin-graph.service");
let TwinGraphController = class TwinGraphController {
    contexts;
    graph;
    constructor(contexts, graph) {
        this.contexts = contexts;
        this.graph = graph;
    }
    listNodeTypes(request) {
        return this.graph.listNodeTypes(this.contexts.resolve(request));
    }
    async createNodeType(request, body, response) {
        const result = await this.graph.createNodeType(this.contexts.resolve(request), body, (0, request_validation_1.requireIdempotencyKey)(request));
        this.setEtag(response, result);
        return result;
    }
    listRelationshipTypes(request) {
        return this.graph.listRelationshipTypes(this.contexts.resolve(request));
    }
    async createRelationshipType(request, body, response) {
        const result = await this.graph.createRelationshipType(this.contexts.resolve(request), body, (0, request_validation_1.requireIdempotencyKey)(request));
        this.setEtag(response, result);
        return result;
    }
    search(request, body) {
        return this.graph.search(this.contexts.resolve(request), body);
    }
    criticalNodes(request, limit) {
        return this.graph.criticalNodes(this.contexts.resolve(request), limit);
    }
    traverse(request, body) {
        return this.graph.traverse(this.contexts.resolve(request), body);
    }
    impactAnalysis(request, body) {
        return this.graph.analyzeImpact(this.contexts.resolve(request), body);
    }
    listNodes(request, query) {
        return this.graph.listNodes(this.contexts.resolve(request), {
            type_id: query.type_id,
            owner_id: query.owner_id,
            state: query.state,
            query: query.query,
            limit: query.limit === undefined ? undefined : Number(query.limit),
        });
    }
    async createNode(request, body, response) {
        const result = await this.graph.createNode(this.contexts.resolve(request), body, (0, request_validation_1.requireIdempotencyKey)(request));
        this.setEtag(response, result);
        return result;
    }
    dependencies(request, nodeId, maxDepth) {
        return this.graph.analyzeDependencies(this.contexts.resolve(request), nodeId, maxDepth);
    }
    node(request, nodeId) {
        return this.graph.getNode(this.contexts.resolve(request), nodeId);
    }
    async updateNode(request, nodeId, body, response) {
        const result = await this.graph.updateNode(this.contexts.resolve(request), nodeId, body, (0, request_validation_1.requireIdempotencyKey)(request), this.ifMatch(request));
        this.setEtag(response, result);
        return result;
    }
    async archiveNode(request, nodeId, response) {
        const result = await this.graph.updateNode(this.contexts.resolve(request), nodeId, { state: 'archived' }, (0, request_validation_1.requireIdempotencyKey)(request), this.ifMatch(request));
        this.setEtag(response, result);
        return result;
    }
    listRelationships(request, query) {
        return this.graph.listRelationships(this.contexts.resolve(request), {
            node_id: query.node_id,
            type_id: query.type_id,
            state: query.state,
            limit: query.limit === undefined ? undefined : Number(query.limit),
        });
    }
    async createRelationship(request, body, response) {
        const result = await this.graph.createRelationship(this.contexts.resolve(request), body, (0, request_validation_1.requireIdempotencyKey)(request));
        this.setEtag(response, result);
        return result;
    }
    relationship(request, relationshipId) {
        return this.graph.getRelationship(this.contexts.resolve(request), relationshipId);
    }
    async updateRelationship(request, relationshipId, body, response) {
        const result = await this.graph.updateRelationship(this.contexts.resolve(request), relationshipId, body, (0, request_validation_1.requireIdempotencyKey)(request), this.ifMatch(request));
        this.setEtag(response, result);
        return result;
    }
    async archiveRelationship(request, relationshipId, response) {
        const result = await this.graph.updateRelationship(this.contexts.resolve(request), relationshipId, { state: 'archived' }, (0, request_validation_1.requireIdempotencyKey)(request), this.ifMatch(request));
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
exports.TwinGraphController = TwinGraphController;
__decorate([
    (0, common_1.Get)('/node-types'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "listNodeTypes", null);
__decorate([
    (0, common_1.Post)('/node-types'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "createNodeType", null);
__decorate([
    (0, common_1.Get)('/relationship-types'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "listRelationshipTypes", null);
__decorate([
    (0, common_1.Post)('/relationship-types'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "createRelationshipType", null);
__decorate([
    (0, common_1.Post)('/search'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "search", null);
__decorate([
    (0, common_1.Get)('/critical-nodes'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "criticalNodes", null);
__decorate([
    (0, common_1.Post)('/traversals'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "traverse", null);
__decorate([
    (0, common_1.Post)('/impact-analysis'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "impactAnalysis", null);
__decorate([
    (0, common_1.Get)('/nodes'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "listNodes", null);
__decorate([
    (0, common_1.Post)('/nodes'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "createNode", null);
__decorate([
    (0, common_1.Get)('/nodes/:nodeId/dependencies'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('nodeId')),
    __param(2, (0, common_1.Query)('max_depth')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "dependencies", null);
__decorate([
    (0, common_1.Get)('/nodes/:nodeId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('nodeId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "node", null);
__decorate([
    (0, common_1.Patch)('/nodes/:nodeId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('nodeId')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "updateNode", null);
__decorate([
    (0, common_1.Delete)('/nodes/:nodeId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('nodeId')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "archiveNode", null);
__decorate([
    (0, common_1.Get)('/relationships'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "listRelationships", null);
__decorate([
    (0, common_1.Post)('/relationships'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "createRelationship", null);
__decorate([
    (0, common_1.Get)('/relationships/:relationshipId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('relationshipId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "relationship", null);
__decorate([
    (0, common_1.Patch)('/relationships/:relationshipId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('relationshipId')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "updateRelationship", null);
__decorate([
    (0, common_1.Delete)('/relationships/:relationshipId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('relationshipId')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], TwinGraphController.prototype, "archiveRelationship", null);
exports.TwinGraphController = TwinGraphController = __decorate([
    (0, common_1.Controller)('/v1/twin'),
    __metadata("design:paramtypes", [context_service_1.ContextService,
        twin_graph_service_1.TwinGraphService])
], TwinGraphController);
//# sourceMappingURL=twin-graph.controller.js.map