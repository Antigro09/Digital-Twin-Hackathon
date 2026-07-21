import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ActionController } from './action.controller';
import { AdminController } from './admin.controller';
import { AgentController } from './agent.controller';
import { AiGatewayController } from './ai-gateway.controller';
import { AiGatewayService } from './ai-gateway.service';
import { AssetTwinController } from './asset-twin.controller';
import { AssetTwinService } from './asset-twin.service';
import { ContextService } from './context.service';
import { DatabaseService } from './database.service';
import { DemoStoreService } from './demo-store.service';
import { DemoAuthController } from './demo-auth.controller';
import { DemoAuthService } from './demo-auth.service';
import { EventIntelligenceController } from './event-intelligence.controller';
import { EventIntelligenceService } from './event-intelligence.service';
import { EventProjectionService } from './event-projection.service';
import { FixtureService } from './fixture.service';
import { KnowledgeController } from './knowledge.controller';
import { SimulationController } from './simulation.controller';
import { TwinGraphController } from './twin-graph.controller';
import { TwinGraphService } from './twin-graph.service';

@Module({
  controllers: [DemoAuthController, AdminController, KnowledgeController, AgentController, SimulationController, ActionController, AssetTwinController, EventIntelligenceController, AiGatewayController, TwinGraphController],
  providers: [FixtureService, DemoAuthService, ContextService, DatabaseService, EventProjectionService, DemoStoreService, AssetTwinService, EventIntelligenceService, AiGatewayService, TwinGraphService],
})
export class AppModule implements NestModule {
  configure(_consumer: MiddlewareConsumer): void {
    // Cross-cutting authorization is deliberately implemented in the server-derived
    // ContextService used by every /v1 controller. No raw tenant middleware exists.
  }
}
