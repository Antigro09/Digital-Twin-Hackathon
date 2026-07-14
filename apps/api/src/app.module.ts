import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ActionController } from './action.controller';
import { AdminController } from './admin.controller';
import { AgentController } from './agent.controller';
import { AssetTwinController } from './asset-twin.controller';
import { AssetTwinService } from './asset-twin.service';
import { ContextService } from './context.service';
import { DatabaseService } from './database.service';
import { DemoStoreService } from './demo-store.service';
import { FixtureService } from './fixture.service';
import { KnowledgeController } from './knowledge.controller';
import { SimulationController } from './simulation.controller';

@Module({
  controllers: [AdminController, KnowledgeController, AgentController, SimulationController, ActionController, AssetTwinController],
  providers: [FixtureService, ContextService, DatabaseService, DemoStoreService, AssetTwinService],
})
export class AppModule implements NestModule {
  configure(_consumer: MiddlewareConsumer): void {
    // Cross-cutting authorization is deliberately implemented in the server-derived
    // ContextService used by every /v1 controller. No raw tenant middleware exists.
  }
}
