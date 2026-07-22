import { TwinClassification } from './twin-graph.types';

/**
 * Contracts for the operational-data and integration foundation. PostgreSQL
 * records are authoritative; graph/vector/history planes are independently
 * rebuildable projections or specialized stores.
 */
export const DATA_FOUNDATION_SCHEMA_VERSION = 'edt.data-foundation/1.0.0';

export const EVENT_CATEGORIES = [
  'employee_change',
  'system_failure',
  'customer_change',
  'financial_change',
  'market_change',
  'operational_change',
] as const;
export type TwinEventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type TwinEventSeverity = (typeof EVENT_SEVERITIES)[number];

export const EVENT_OUTCOMES = ['observed', 'mitigated', 'resolved', 'failed', 'unknown'] as const;
export type TwinEventOutcome = (typeof EVENT_OUTCOMES)[number];

export const DATA_PLANE_IDS = ['application_data', 'graph_data', 'ai_knowledge', 'historical_metrics'] as const;
export type DataPlaneId = (typeof DATA_PLANE_IDS)[number];

export const CONNECTOR_KINDS = ['erp', 'crm', 'hris', 'accounting', 'api', 'database', 'document'] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

export const CONNECTOR_STATUSES = ['draft', 'active', 'suspended', 'archived'] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

export const DEFAULT_EVENT_TYPES: ReadonlyArray<{
  type_id: string;
  category: TwinEventCategory;
  display_name: string;
  description: string;
}> = [
  { type_id: 'edt.event/EmployeeChange', category: 'employee_change', display_name: 'Employee change', description: 'A workforce, role, ownership, or employment change.' },
  { type_id: 'edt.event/SystemFailure', category: 'system_failure', display_name: 'System failure', description: 'A technology service, application, infrastructure, or API failure.' },
  { type_id: 'edt.event/CustomerChange', category: 'customer_change', display_name: 'Customer change', description: 'A customer, account, contract, or service-consumption change.' },
  { type_id: 'edt.event/FinancialChange', category: 'financial_change', display_name: 'Financial change', description: 'A revenue, expense, cost, liability, or investment change.' },
  { type_id: 'edt.event/MarketChange', category: 'market_change', display_name: 'Market change', description: 'An external market, competitor, regulatory, or macroeconomic change.' },
  { type_id: 'edt.event/OperationalChange', category: 'operational_change', display_name: 'Operational change', description: 'A process, workflow, task, asset, equipment, or delivery change.' },
  { type_id: 'edt.event/MarketingFunnelTransition', category: 'customer_change', display_name: 'Marketing funnel transition', description: 'An aggregate cohort movement to the next marketing funnel stage; individual propensity records are prohibited.' },
] as const;

export interface CanonicalDataSource {
  source_system: string;
  source_record_id: string;
  source_revision?: string;
  connector_id?: string;
  observed_at: string;
  content_hash: string;
  locator?: string;
}

export interface DataQualityAssessment {
  assessed_at: string;
  method: 'deterministic_provenance_quality/1.0.0';
  source_fingerprint: string;
  value_hash: string;
  duplicate_of: string | null;
  conflicts_with: string[];
  stale: boolean;
  stale_after: string;
  confidence_score: number;
  rationale: string[];
}

export interface TwinDataPoint {
  data_point_id: string;
  tenant_id: string;
  event_id: string | null;
  subject_node_id: string | null;
  subject_key: string;
  metric: string;
  metric_key: string;
  value: unknown;
  source: CanonicalDataSource;
  source_fingerprint: string;
  owner_id: string | null;
  observed_at: string;
  last_updated_at: string;
  reliability_score: number;
  confidence_score: number;
  freshness_ttl_seconds: number;
  classification: TwinClassification;
  value_hash: string;
  data_quality: DataQualityAssessment;
  state_hash: string;
}

export interface EventPropagationImpact {
  node_id: string;
  depth: number;
  score: number;
  path: string[];
  relationship_path: string[];
  cumulative_cost: number;
  node: Record<string, unknown>;
}

export interface EventPropagation {
  calculated_at: string;
  graph_version: number;
  max_depth: number;
  max_impacts: number;
  impacts: EventPropagationImpact[];
  truncated: boolean;
  method: {
    name: 'bounded_weighted_dependency_propagation';
    version: string;
    note: string;
  };
}

export interface TwinOperationalEvent {
  event_id: string;
  tenant_id: string;
  type_id: string;
  category: TwinEventCategory;
  occurred_at: string;
  recorded_at: string;
  source: CanonicalDataSource;
  affected_node_ids: string[];
  severity: TwinEventSeverity;
  outcome: TwinEventOutcome;
  owner_id: string | null;
  classification: TwinClassification;
  data_point_id: string;
  confidence_score: number;
  data_quality: DataQualityAssessment;
  propagation: EventPropagation;
  details: Record<string, unknown>;
  state_hash: string;
}

export interface DataFoundationMetadata {
  metadata_id: string;
  tenant_id: string;
  schema_version: typeof DATA_FOUNDATION_SCHEMA_VERSION;
  version: number;
  updated_at: string;
}

export interface SecretReferenceAuthentication {
  kind: 'oauth2' | 'api_key' | 'service_account' | 'database_credentials' | 'mutual_tls' | 'none';
  secret_reference: string | null;
  scopes: string[];
}

export interface ConnectorSchemaConfiguration {
  source_schema_ref: string;
  normalized_schema_ref: string;
  version: string;
}

export interface ConnectorMappingRule {
  source_path: string;
  target_path: string;
  transform?: string;
}

export interface ConnectorMappingConfiguration {
  version: string;
  rules: ConnectorMappingRule[];
}

export interface ConnectorPermissions {
  read: string[];
  write: string[];
  allowed_classifications: TwinClassification[];
}

export interface ConnectorSyncPolicy {
  mode: 'manual' | 'interval' | 'webhook' | 'hybrid';
  frequency_seconds: number | null;
}

export interface ConnectorErrorHandling {
  mode: 'fail_closed' | 'retry_with_backoff' | 'dead_letter';
  max_attempts: number;
  initial_backoff_seconds: number;
  max_backoff_seconds: number;
}

export interface TwinConnectorDefinition {
  connector_id: string;
  tenant_id: string;
  name: string;
  name_key: string;
  kind: ConnectorKind;
  purpose: string;
  authentication: SecretReferenceAuthentication;
  schema: ConnectorSchemaConfiguration;
  mapping: ConnectorMappingConfiguration;
  permissions: ConnectorPermissions;
  sync: ConnectorSyncPolicy;
  error_handling: ConnectorErrorHandling;
  owner_id: string | null;
  reliability_score: number;
  classification: TwinClassification;
  status: ConnectorStatus;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  state_hash: string;
}

export interface McpAuthentication {
  kind: 'oauth2_client_credentials' | 'oauth2_delegated' | 'service_token' | 'none';
  secret_reference: string | null;
  scopes: string[];
}

export interface McpToolDefinition {
  tool_id: string;
  purpose: string;
  permissions: string[];
  side_effects: boolean;
}

export interface McpConnectedData {
  data_plane: DataPlaneId;
  resource_kind: string;
  connector_id?: string;
}

export interface TwinMcpServerDefinition {
  mcp_server_id: string;
  tenant_id: string;
  name: string;
  name_key: string;
  purpose: string;
  authentication: McpAuthentication;
  tools: McpToolDefinition[];
  permissions: string[];
  connected_data: McpConnectedData[];
  owner_id: string | null;
  classification: TwinClassification;
  status: ConnectorStatus;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  state_hash: string;
}

export interface IntegrationRegistryMetadata {
  metadata_id: string;
  tenant_id: string;
  schema_version: typeof DATA_FOUNDATION_SCHEMA_VERSION;
  version: number;
  updated_at: string;
}

export interface UnifiedDataPlane {
  plane_id: DataPlaneId;
  storage_kind: 'relational' | 'graph' | 'vector' | 'historical';
  authority: 'authoritative' | 'derived' | 'specialized';
  purpose: string;
  access_boundary: string;
  record_classes: string[];
  implementation_status: 'available' | 'registered_for_projection' | 'planned';
}
