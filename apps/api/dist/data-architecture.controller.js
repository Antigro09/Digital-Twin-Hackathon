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
exports.DataArchitectureController = void 0;
const common_1 = require("@nestjs/common");
const context_service_1 = require("./context.service");
const data_architecture_service_1 = require("./data-architecture.service");
let DataArchitectureController = class DataArchitectureController {
    contexts;
    architecture;
    constructor(contexts, architecture) {
        this.contexts = contexts;
        this.architecture = architecture;
    }
    overview(request) {
        return this.architecture.overview(this.contexts.resolve(request));
    }
};
exports.DataArchitectureController = DataArchitectureController;
__decorate([
    (0, common_1.Get)('/data-architecture'),
    (0, common_1.Header)('Cache-Control', 'private, no-store'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DataArchitectureController.prototype, "overview", null);
exports.DataArchitectureController = DataArchitectureController = __decorate([
    (0, common_1.Controller)('/v1/twin'),
    __metadata("design:paramtypes", [context_service_1.ContextService,
        data_architecture_service_1.DataArchitectureService])
], DataArchitectureController);
//# sourceMappingURL=data-architecture.controller.js.map