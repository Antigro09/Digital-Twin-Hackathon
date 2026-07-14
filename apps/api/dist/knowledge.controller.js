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
exports.KnowledgeController = void 0;
const common_1 = require("@nestjs/common");
const context_service_1 = require("./context.service");
const demo_store_service_1 = require("./demo-store.service");
const problem_1 = require("./problem");
let KnowledgeController = class KnowledgeController {
    contexts;
    store;
    constructor(contexts, store) {
        this.contexts = contexts;
        this.store = store;
    }
    entities(request, pageSize) {
        const size = pageSize ? Number(pageSize) : 50;
        if (!Number.isInteger(size) || size < 1 || size > 100)
            throw new problem_1.ProblemException(common_1.HttpStatus.BAD_REQUEST, 'invalid_page_size', 'page_size must be between 1 and 100.');
        return this.store.listEntities(this.contexts.resolve(request), size);
    }
    entity(request, entityId) {
        return this.store.getEntity(this.contexts.resolve(request), entityId);
    }
    traversal(request, body) {
        return this.store.traverse(this.contexts.resolve(request), body);
    }
};
exports.KnowledgeController = KnowledgeController;
__decorate([
    (0, common_1.Get)('/entities'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('page_size')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Object)
], KnowledgeController.prototype, "entities", null);
__decorate([
    (0, common_1.Get)('/entities/:entityId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('entityId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Object)
], KnowledgeController.prototype, "entity", null);
__decorate([
    (0, common_1.Post)('/graph/traversals'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Object)
], KnowledgeController.prototype, "traversal", null);
exports.KnowledgeController = KnowledgeController = __decorate([
    (0, common_1.Controller)('/v1'),
    __metadata("design:paramtypes", [context_service_1.ContextService, demo_store_service_1.DemoStoreService])
], KnowledgeController);
//# sourceMappingURL=knowledge.controller.js.map