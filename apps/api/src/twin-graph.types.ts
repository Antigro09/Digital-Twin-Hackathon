/**
 * Canonical contracts for the extensible enterprise twin graph.
 *
 * These types intentionally describe the PostgreSQL-authoritative graph model,
 * not the Neo4j projection. A graph projection can be rebuilt from these
 * records and must never be treated as a source of truth.
 */

export const TWIN_GRAPH_SCHEMA_VERSION = 'edt.twin-graph/1.0.0';

export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type TwinClassification = (typeof CLASSIFICATIONS)[number];

export const NODE_STATES = ['active', 'archived'] as const;
export type TwinNodeState = (typeof NODE_STATES)[number];

export const RELATIONSHIP_STATES = ['active', 'archived'] as const;
export type TwinRelationshipState = (typeof RELATIONSHIP_STATES)[number];

export type ImpactDirection = 'forward' | 'reverse' | 'bidirectional' | 'none';

export interface TwinTypeDefinition {
  type_id: string;
  display_name: string;
  domain: string;
  description: string;
  schema_version: string;
  property_schema: Record<string, unknown>;
  is_system: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TwinRelationshipTypeDefinition extends TwinTypeDefinition {
  directional: true;
  impact_direction: ImpactDirection;
  acyclic: boolean;
  allowed_source_types: string[];
  allowed_target_types: string[];
}

export interface TwinSourceData {
  source_system: string;
  source_record_id: string;
  source_revision?: string;
  observed_at: string;
  content_hash?: string;
  classification: TwinClassification;
  locator?: string;
  attributes?: Record<string, unknown>;
}

export interface TwinNode {
  node_id: string;
  tenant_id: string;
  type_id: string;
  label: string;
  properties: Record<string, unknown>;
  metadata: Record<string, unknown> & { classification: TwinClassification };
  owner_id: string | null;
  source_data: TwinSourceData[];
  confidence_score: number;
  simulation_hooks: Array<Record<string, unknown>>;
  ai_capabilities: Array<Record<string, unknown>>;
  state: TwinNodeState;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  state_hash: string;
}

export interface TwinRelationship {
  relationship_id: string;
  tenant_id: string;
  type_id: string;
  source_node_id: string;
  target_node_id: string;
  strength: number;
  confidence: number;
  importance: number;
  risk: number;
  cost: number;
  metadata: Record<string, unknown> & { classification: TwinClassification };
  source_data: TwinSourceData[];
  state: TwinRelationshipState;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  state_hash: string;
}

export interface TwinGraphMetadata {
  metadata_id: string;
  tenant_id: string;
  schema_version: typeof TWIN_GRAPH_SCHEMA_VERSION;
  version: number;
  updated_at: string;
}

export interface TwinGraphHistoryEvent {
  event_id: string;
  tenant_id: string;
  event_type: string;
  resource_kind: 'node' | 'relationship' | 'node_type' | 'relationship_type';
  resource_id: string;
  resource_version: number;
  actor_id: string;
  occurred_at: string;
  before_hash: string | null;
  after_hash: string | null;
  changed_fields: string[];
  details: Record<string, unknown>;
}

export interface TwinGraphTraversalInput {
  start_node_id: string;
  direction?: 'outbound' | 'inbound' | 'both';
  relationship_types?: string[];
  max_depth?: number;
  max_nodes?: number;
}

export interface TwinImpactAnalysisInput {
  node_id: string;
  change?: Record<string, unknown>;
  max_depth?: number;
  max_impacts?: number;
  relationship_types?: string[];
}
