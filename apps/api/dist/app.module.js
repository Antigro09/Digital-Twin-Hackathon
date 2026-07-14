"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const action_controller_1 = require("./action.controller");
const admin_controller_1 = require("./admin.controller");
const agent_controller_1 = require("./agent.controller");
const context_service_1 = require("./context.service");
const database_service_1 = require("./database.service");
const demo_store_service_1 = require("./demo-store.service");
const fixture_service_1 = require("./fixture.service");
const knowledge_controller_1 = require("./knowledge.controller");
const simulation_controller_1 = require("./simulation.controller");
let AppModule = class AppModule {
    configure(_consumer) {
    }
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        controllers: [admin_controller_1.AdminController, knowledge_controller_1.KnowledgeController, agent_controller_1.AgentController, simulation_controller_1.SimulationController, action_controller_1.ActionController],
        providers: [fixture_service_1.FixtureService, context_service_1.ContextService, database_service_1.DatabaseService, demo_store_service_1.DemoStoreService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map