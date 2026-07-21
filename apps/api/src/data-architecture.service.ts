import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { DATA_FOUNDATION_SCHEMA_VERSION, UnifiedDataPlane } from './data-foundation.types';
import { RequestContext } from './domain';
import { ProblemException } from './problem';

/**
 * Declares the ownership boundary between application records, the graph
 * projection, isolated AI knowledge, and retained historical measurements.
 * This is a catalog, not a cross-store query shortcut: callers must use the
 * owning plane's governed service interface.
 */
@Injectable()
export class DataArchitectureService {
  constructor(private readonly database: DatabaseService) {}

  async overview(ctx: RequestContext): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    const relationalHealth = await this.database.health();
    const planes: UnifiedDataPlane[] = [
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
      schema_version: DATA_FOUNDATION_SCHEMA_VERSION,
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

  private assertAdmin(ctx: RequestContext): void {
    if (!ctx.actor.capabilities.includes('connector.admin')) {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'data_architecture_read_denied', 'Data architecture access requires a tenant integration administrator.');
    }
  }
}
