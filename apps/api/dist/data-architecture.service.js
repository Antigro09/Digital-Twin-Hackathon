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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataArchitectureService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("./database.service");
const data_foundation_types_1 = require("./data-foundation.types");
const problem_1 = require("./problem");
let DataArchitectureService = class DataArchitectureService {
    database;
    constructor(database) {
        this.database = database;
    }
    async overview(ctx) {
        this.assertAdmin(ctx);
        const relationalHealth = await this.database.health();
        const planes = [
            {
                plane_id: 'application_data',
                storage_kind: 'relational',
                authority: 'authoritative',
                purpose: 'Tenant-scoped transactional application data, canonical events, data quality, connector registry, audit evidence, and outbox records.',
                access_boundary: 'PostgreSQL row-level security with server-derived tenant context.',
                record_classes: ['twin_event', 'twin_data_point', 'twin_connector_definition', 'twin_mcp_server_definition', 'decision_simulation_snapshot', 'decision_scenario_branch', 'decision_simulation_run', 'predictive_model_definition', 'prediction_feature_batch', 'prediction_run', 'prediction_knowledge', 'prediction_learning_event', 'event_audit_evidence', 'outbox'],
                implementation_status: relationalHealth === 'connected' ? 'available' : 'registered_for_projection',
            },
            {
                plane_id: 'graph_data',
                storage_kind: 'graph',
                authority: 'derived',
                purpose: 'Bounded relationship traversal, dependency analysis, impact propagation, and visualization rebuilt from authoritative node, relationship, and event records.',
                access_boundary: 'No arbitrary Cypher; all graph access is tenant-derived, classification-filtered, and bounded.',
                record_classes: ['twin_node', 'twin_relationship', 'twin_graph_history', 'event_propagation_snapshot'],
                implementation_status: 'registered_for_projection',
            },
            {
                plane_id: 'ai_knowledge',
                storage_kind: 'vector',
                authority: 'specialized',
                purpose: 'Tenant-isolated retrieval evidence, embeddings, and AI-run provenance. It is not a source of truth for business facts.',
                access_boundary: 'AI-worker RLS boundary, authorized retrieval only, and no connector credential material in prompts or vectors.',
                record_classes: ['ai_evidence', 'embedding_provenance', 'retrieval_receipts'],
                implementation_status: 'registered_for_projection',
            },
            {
                plane_id: 'historical_metrics',
                storage_kind: 'historical',
                authority: 'specialized',
                purpose: 'Immutable event/data-point history, raw-source retention references, time-series metrics, backtesting, and future cold-storage exports.',
                access_boundary: 'Retention policy, tenant scope, classification, and source provenance apply before export or analytical projection.',
                record_classes: ['twin_event', 'twin_data_point', 'normalized_observation', 'historical_metric', 'prediction_feature_batch', 'prediction_learning_event'],
                implementation_status: 'registered_for_projection',
            },
        ];
        return {
            schema_version: data_foundation_types_1.DATA_FOUNDATION_SCHEMA_VERSION,
            data_planes: planes,
            write_routing: {
                canonical_ingestion: 'application_data',
                graph_projection: 'graph_data',
                ai_indexing: 'ai_knowledge',
                historical_retention: 'historical_metrics',
            },
            invariants: [
                'Application data is authoritative; graph, vector, and analytical representations are rebuildable or specialized.',
                'Every operational observation carries source, owner, timestamps, reliability, confidence, and quality evidence.',
                'No plane accepts caller-selected tenant scope or credential material in records.',
            ],
        };
    }
    assertAdmin(ctx) {
        if (!ctx.actor.capabilities.includes('connector.admin')) {
            throw new problem_1.ProblemException(common_1.HttpStatus.FORBIDDEN, 'data_architecture_read_denied', 'Data architecture access requires a tenant integration administrator.');
        }
    }
};
exports.DataArchitectureService = DataArchitectureService;
exports.DataArchitectureService = DataArchitectureService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], DataArchitectureService);
//# sourceMappingURL=data-architecture.service.js.map