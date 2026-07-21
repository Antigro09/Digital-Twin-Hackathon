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
const ai_gateway_controller_1 = require("./ai-gateway.controller");
const ai_gateway_service_1 = require("./ai-gateway.service");
const asset_twin_controller_1 = require("./asset-twin.controller");
const asset_twin_service_1 = require("./asset-twin.service");
const context_service_1 = require("./context.service");
const data_architecture_controller_1 = require("./data-architecture.controller");
const data_architecture_service_1 = require("./data-architecture.service");
const database_service_1 = require("./database.service");
const demo_store_service_1 = require("./demo-store.service");
const demo_auth_controller_1 = require("./demo-auth.controller");
const demo_auth_service_1 = require("./demo-auth.service");
const event_intelligence_controller_1 = require("./event-intelligence.controller");
const event_intelligence_service_1 = require("./event-intelligence.service");
const event_projection_service_1 = require("./event-projection.service");
const fixture_service_1 = require("./fixture.service");
const integration_registry_controller_1 = require("./integration-registry.controller");
const integration_registry_service_1 = require("./integration-registry.service");
const knowledge_controller_1 = require("./knowledge.controller");
const decision_worker_service_1 = require("./decision-worker.service");
const predictive_engine_controller_1 = require("./predictive-engine.controller");
const predictive_engine_service_1 = require("./predictive-engine.service");
const simulation_controller_1 = require("./simulation.controller");
const simulation_engine_controller_1 = require("./simulation-engine.controller");
const simulation_engine_service_1 = require("./simulation-engine.service");
const twin_graph_controller_1 = require("./twin-graph.controller");
const twin_graph_service_1 = require("./twin-graph.service");
const twin_event_controller_1 = require("./twin-event.controller");
const twin_event_service_1 = require("./twin-event.service");
let AppModule = class AppModule {
    configure(_consumer) {
    }
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        controllers: [
            demo_auth_controller_1.DemoAuthController,
            admin_controller_1.AdminController,
            knowledge_controller_1.KnowledgeController,
            agent_controller_1.AgentController,
            simulation_controller_1.SimulationController,
            action_controller_1.ActionController,
            asset_twin_controller_1.AssetTwinController,
            event_intelligence_controller_1.EventIntelligenceController,
            ai_gateway_controller_1.AiGatewayController,
            twin_graph_controller_1.TwinGraphController,
            twin_event_controller_1.TwinEventController,
            data_architecture_controller_1.DataArchitectureController,
            integration_registry_controller_1.IntegrationRegistryController,
            simulation_engine_controller_1.SimulationEngineController,
            predictive_engine_controller_1.PredictiveEngineController,
        ],
        providers: [
            fixture_service_1.FixtureService,
            demo_auth_service_1.DemoAuthService,
            context_service_1.ContextService,
            database_service_1.DatabaseService,
            event_projection_service_1.EventProjectionService,
            demo_store_service_1.DemoStoreService,
            asset_twin_service_1.AssetTwinService,
            event_intelligence_service_1.EventIntelligenceService,
            ai_gateway_service_1.AiGatewayService,
            twin_graph_service_1.TwinGraphService,
            twin_event_service_1.TwinEventService,
            data_architecture_service_1.DataArchitectureService,
            integration_registry_service_1.IntegrationRegistryService,
            decision_worker_service_1.DecisionWorkerService,
            simulation_engine_service_1.SimulationEngineService,
            predictive_engine_service_1.PredictiveEngineService,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map