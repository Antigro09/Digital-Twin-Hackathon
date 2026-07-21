export declare const DECISION_INTELLIGENCE_SCHEMA_VERSION: "edt.decision-intelligence/1.0.0";
export declare const SCENARIO_KINDS: readonly ["hiring", "pricing_change", "supplier_failure", "expansion", "budget_change"];
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];
export declare const PREDICTION_KINDS: readonly ["revenue", "expense", "customer_churn", "workforce", "risk"];
export type PredictionKind = (typeof PREDICTION_KINDS)[number];
export declare const MODEL_KINDS: readonly ["forecasting", "optimization", "anomaly_detection", "computer_vision", "classification"];
export type ModelKind = (typeof MODEL_KINDS)[number];
export interface DecisionSnapshotNode {
    node_id: string;
    type_id: string;
    label: string;
    variables: Record<string, number>;
}
export interface DecisionSnapshotRelationship {
    relationship_id: string;
    source_node_id: string;
    target_node_id: string;
    impact_direction: 'forward' | 'reverse' | 'bidirectional' | 'none';
    strength: number;
    confidence: number;
    importance: number;
}
export interface DecisionSnapshot {
    schema_version: typeof DECISION_INTELLIGENCE_SCHEMA_VERSION;
    snapshot_id: string;
    tenant_id: string;
    as_of: string;
    graph_version: number;
    nodes: DecisionSnapshotNode[];
    relationships: DecisionSnapshotRelationship[];
    assumptions: string[];
    canonical_sha256: string;
    created_at: string;
    created_by: string;
    state_hash: string;
}
export interface ScenarioChange {
    node_id: string;
    variable: string;
    operation: 'set' | 'add' | 'multiply';
    value: number;
}
export interface DecisionScenarioBranch {
    scenario_id: string;
    branch_id: string;
    parent_branch_id: string | null;
    tenant_id: string;
    snapshot_id: string;
    snapshot_hash: string;
    kind: ScenarioKind;
    name: string;
    changes: ScenarioChange[];
    assumptions: string[];
    max_depth: number;
    rule_version: 'business-derived-metrics/1.0.0';
    status: 'draft' | 'confirmed';
    scenario_digest: string;
    version: number;
    created_at: string;
    created_by: string;
    confirmed_at: string | null;
    confirmed_by: string | null;
    state_hash: string;
}
export interface DecisionSimulationRun {
    simulation_id: string;
    tenant_id: string;
    snapshot_id: string;
    scenario_id: string;
    branch_id: string;
    status: 'succeeded';
    engine_version: string;
    result: Record<string, unknown>;
    result_sha256: string;
    created_at: string;
    created_by: string;
    state_hash: string;
}
export interface ModelAccuracy {
    score: number;
    metric: string;
    validation_count: number;
    last_validated_at: string | null;
}
export interface PredictiveModelDefinition {
    model_id: string;
    tenant_id: string;
    name: string;
    kind: ModelKind;
    prediction_kind: PredictionKind | null;
    algorithm: string;
    inputs: Array<Record<string, unknown>>;
    outputs: Array<Record<string, unknown>>;
    model_version: string;
    accuracy: ModelAccuracy;
    owner_id: string;
    trigger: Record<string, unknown>;
    status: 'draft' | 'active' | 'retired';
    calibration_bias: number;
    learning_revision: number;
    version: number;
    created_at: string;
    updated_at: string;
    state_hash: string;
}
export interface PredictionRun {
    prediction_id: string;
    tenant_id: string;
    model_id: string;
    model_version: string;
    kind: PredictionKind;
    target: string;
    horizon_steps: number;
    historical_feature_batch_id: string;
    historical_data_hash: string;
    historical_observation_count: number;
    result: Record<string, unknown>;
    result_sha256: string;
    status: 'pending_outcome' | 'outcome_recorded' | 'validated' | 'corrected';
    observed_outcome: number[] | null;
    validation: Record<string, unknown> | null;
    version: number;
    created_at: string;
    created_by: string;
    updated_at: string;
    state_hash: string;
}
export interface PredictionFeatureBatch {
    feature_batch_id: string;
    tenant_id: string;
    prediction_id: string;
    observations: Array<{
        observed_at: string;
        value: number;
        features: Record<string, number>;
    }>;
    observation_count: number;
    data_hash: string;
    source: {
        kind: 'user_supplied_historical_observations';
        actor_id: string;
    };
    created_at: string;
    state_hash: string;
}
export interface PredictionKnowledgeRecord {
    knowledge_id: string;
    tenant_id: string;
    category: 'historical_outcome' | 'technical_specification' | 'company_rule' | 'correction' | 'expert_knowledge';
    model_id: string | null;
    prediction_id: string | null;
    title: string;
    content: Record<string, unknown>;
    source: Record<string, unknown>;
    owner_id: string;
    status: 'pending_review';
    created_at: string;
    state_hash: string;
}
