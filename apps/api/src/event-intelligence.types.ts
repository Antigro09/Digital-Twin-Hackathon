export type EventCategory = 'people' | 'project' | 'technology' | 'business' | 'operations' | 'external' | 'unknown';

export type EventConfidenceLevel = 'confirmed' | 'likely' | 'possible' | 'speculative' | 'rejected';

export type EventMode = 'reality' | 'scenario';

export type EventStatus =
  | 'interpreted'
  | 'needs_resolution'
  | 'reviewed'
  | 'approval_pending'
  | 'approved'
  | 'applied'
  | 'rolled_back'
  | 'rejected';

export interface EventTaxonomyEntry {
  code: string;
  category: EventCategory;
  label: string;
  description: string;
  default_mode: EventMode;
  sensitive: boolean;
  example_phrases: string[];
}

export interface ResolutionCandidate {
  entity_id: string;
  entity_type: 'person' | 'team' | 'project' | 'service' | 'database' | 'customer' | 'vendor' | 'asset' | 'external_entity';
  display_name: string;
  confidence: number;
  reasons: string[];
  aliases: string[];
  current_state: Record<string, unknown>;
}

export interface EntityResolution {
  mention: string;
  normalized_mention: string;
  candidates: ResolutionCandidate[];
  selected_entity_id: string | null;
  confidence: number;
  required_confirmation: boolean;
  reasons: string[];
}

export interface EventImpact {
  impact_id: string;
  caused_by: string;
  depth: 0 | 1 | 2 | 3;
  effect_kind: 'node_state' | 'relationship' | 'risk' | 'prediction' | 'workflow' | 'knowledge' | 'recommendation' | 'unknown';
  affected_entity: { entity_id: string | null; entity_type: string; display_name: string };
  affected_relationship: { type: string; from_entity_id: string; to_entity_id: string; operation: 'create' | 'modify' | 'remove' } | null;
  severity: 'informational' | 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  time_horizon: 'immediate' | 'days' | 'weeks' | 'months' | 'unknown';
  explanation: string;
  evidence: string[];
  recommended_action: string | null;
  proposed_mutation: Record<string, unknown> | null;
  live_mutation_eligible: boolean;
}

export interface CausalGraph {
  nodes: Array<{ id: string; kind: 'event' | 'entity' | 'impact'; label: string; depth: number }>;
  edges: Array<{ from: string; to: string; relation: 'affects' | 'causes' | 'may_cause'; confidence: number }>;
  max_depth: 3;
  traversed_nodes: number;
  traversed_edges: number;
  truncated: boolean;
  cycle_paths_suppressed: number;
}

export interface EventGate {
  route: 'reality_update' | 'scenario_branch' | 'rejected';
  live_mutation_allowed: boolean;
  blockers: string[];
  required_approvals: Array<'operations' | 'security'>;
  policy_version: string;
  rationale: string;
}

export interface EventAuditEvidence {
  audit_id: string;
  tenant_sequence: number;
  action: string;
  actor_id: string;
  resource_type: 'event_interpretation' | 'event' | 'event_approval' | 'event_receipt';
  resource_id: string;
  occurred_at: string;
  request_id: string;
  trace_id: string;
  details_hash: string;
  previous_hash: string;
  event_hash: string;
}

export type EventAuditIssueCode =
  | 'empty_chain'
  | 'invalid_records'
  | 'hash_gaps'
  | 'forks'
  | 'orphan_records'
  | 'sequence_gaps'
  | 'incomplete_event_chain';

export interface EventAuditChainDiagnostics {
  total_records: number;
  valid_records: number;
  canonical_records: number;
  invalid_records: number;
  gap_records: number;
  fork_points: number;
  orphan_records: number;
  sequence_gaps: number;
  event_records: number;
  expected_event_records: number;
  invalid_record_ids: string[];
  gap_record_ids: string[];
  fork_previous_hashes: string[];
  orphan_record_ids: string[];
  sequence_gap_record_ids: string[];
  missing_event_audit_ids: string[];
  diagnostics_truncated: boolean;
  issues: EventAuditIssueCode[];
}

export interface EventAuditResponse {
  items: EventAuditEvidence[];
  chain_valid: boolean;
  diagnostics: EventAuditChainDiagnostics;
}

export interface IntelligenceEvent {
  event_id: string;
  interpretation_id: string;
  tenant_id: string;
  version: number;
  status: EventStatus;
  event_type: { code: string; category: EventCategory; label: string };
  source: { kind: 'manual_natural_language'; creator_id: string; source_text_hash: string };
  statement: string;
  occurred_at: { value: string; precision: 'exact' | 'day' | 'relative' | 'unknown'; confidence: number };
  recorded_at: string;
  location: string | null;
  confidence: { score: number; level: EventConfidenceLevel; rationale: string[] };
  verification_status: 'unverified' | 'confirmed' | 'rejected';
  mode: EventMode;
  entity_resolutions: EntityResolution[];
  related_entities: Array<{ entity_id: string; display_name: string; resolution_confidence: number }>;
  evidence: Array<{ evidence_id: string; kind: 'user_statement' | 'synthetic_graph_fact' | 'conflict'; summary: string; confidence: number }>;
  attachments: Array<{ attachment_id: string; media_type: string; object_ref: string; content_hash: string }>;
  historical_references: Array<{ event_id: string; relation: 'conflicts_with' | 'supersedes' | 'reverses' }>;
  impacts: EventImpact[];
  causal_graph: CausalGraph;
  gate: EventGate;
  conflicts: Array<{ event_id: string; reason: string }>;
  unknown_effects: string[];
  safety: {
    untrusted_input: true;
    prompt_injection_detected: boolean;
    confidential_data_redacted: boolean;
    quarantined: boolean;
    flags: string[];
  };
  graph_snapshot_version: number;
  graph_snapshot_hash: string;
  review_notes: string | null;
  reviewed_payload_hash: string | null;
  applied_payload_hash: string | null;
  branch_id: string | null;
  external_write: false;
  synthetic_projection_only: true;
  audit_evidence: EventAuditEvidence;
  etag: string;
}

export interface EventInterpretation {
  interpretation_id: string;
  events: IntelligenceEvent[];
  safety: IntelligenceEvent['safety'];
  limits: {
    max_input_characters: number;
    max_events_per_interpretation: number;
    max_impact_depth: 3;
    max_impacts_per_event: number;
  };
  model: {
    provider: 'deterministic_synthetic_rules';
    model_version: 'event-extractor-rules/1.0.0';
    generative_model_used: false;
  };
}

export interface EventApproval {
  approval_id: string;
  tenant_id: string;
  event_id: string;
  requester_id: string;
  payload_hash: string;
  event_version: number;
  graph_snapshot_version: number;
  graph_snapshot_hash: string;
  status: 'pending' | 'approved' | 'denied' | 'executed' | 'cancelled';
  required_roles: Array<'operations' | 'security'>;
  decisions: Array<{
    decision_id: string;
    actor_id: string;
    role: 'operations' | 'security';
    decision: 'approve' | 'deny';
    payload_hash: string;
    decided_at: string;
  }>;
  reason: string;
  created_at: string;
  expires_at: string;
  approval_kind: 'dual_human' | 'scenario_policy';
  audit_evidence: EventAuditEvidence;
}

export interface EventActionReceipt {
  receipt_id: string;
  tenant_id: string;
  event_id: string;
  approval_id: string;
  action: 'apply_reality' | 'apply_scenario' | 'rollback';
  actor_id: string;
  before_version: number;
  after_version: number;
  graph_version_before: number;
  graph_version_after: number;
  payload_hash: string;
  before_state_hash: string;
  after_state_hash: string;
  applied_changes: Array<Record<string, unknown>>;
  branch_id: string | null;
  status: 'succeeded';
  replayed: boolean;
  outbox_position: number;
  provider: 'synthetic_event_projection';
  external_write: false;
  prohibited_actions_not_executed: string[];
  recorded_at: string;
  audit_evidence: EventAuditEvidence;
}

export interface TimelineEntry {
  timeline_entry_id: string;
  tenant_id: string;
  event_id: string;
  branch_id: string;
  sequence: number;
  occurred_at: string;
  recorded_at: string;
  action: 'baseline' | 'event_applied' | 'event_rolled_back';
  summary: string;
  before_state_hash: string;
  after_state_hash: string;
  graph_version_before: number;
  graph_version_after: number;
  receipt_id: string | null;
  reversible: boolean;
}

export interface ScenarioBranch {
  branch_id: string;
  tenant_id: string;
  name: string;
  parent_branch_id: string | null;
  created_by_event_id: string | null;
  created_at: string;
  mode: 'baseline' | 'scenario';
  status: 'active' | 'rolled_back';
  event_ids: string[];
  base_graph_version: number;
  base_state_hash: string;
  state_hash: string;
}

export interface EventReplay {
  event_id: string;
  mode: EventMode;
  current_status: EventStatus;
  reconstructable: boolean;
  graph: {
    before_version: number;
    after_version: number;
    before_state_hash: string;
    after_state_hash: string;
  } | null;
  entity_changes: Array<{
    entity_id: string;
    display_name: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>;
  relationship_changes: Array<{
    relationship_id: string;
    type: string;
    from_entity_id: string;
    to_entity_id: string;
    before_state: string | null;
    after_state: string | null;
  }>;
  receipts: EventActionReceipt[];
  timeline: TimelineEntry[];
  branch: ScenarioBranch | null;
}

export interface BranchComparison {
  left: ScenarioBranch;
  right: ScenarioBranch;
  same_base_snapshot: boolean;
  common_event_ids: string[];
  left_only_event_ids: string[];
  right_only_event_ids: string[];
  state_hash_equal: boolean;
  timeline: {
    left: TimelineEntry[];
    right: TimelineEntry[];
  };
}
