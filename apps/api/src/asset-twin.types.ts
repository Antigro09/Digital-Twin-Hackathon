export type AssetTelemetryMetric =
  | 'temperature_c'
  | 'discharge_pressure_bar'
  | 'vibration_mm_s'
  | 'flow_l_min'
  | 'motor_current_a'
  | 'speed_rpm';

export type ReadingStatus = 'normal' | 'warning' | 'critical';

export interface AssetLocation {
  site: string;
  area: string;
  line: string;
  coordinates: { x: number; y: number; z: number };
}

export interface PhysicalAsset {
  asset_id: string;
  display_name: string;
  asset_type: 'centrifugal_pump';
  manufacturer: string;
  model: string;
  serial_number: string;
  commissioned_at: string;
  location: AssetLocation;
  specifications: {
    design_flow_m3h: number;
    design_head_m: number;
    rated_speed_rpm: number;
    max_operating_pressure_bar: number;
  };
  operational_status: 'running' | 'stopped' | 'emergency_stopped';
  health_score: number;
  current_alerts: number;
  last_telemetry_at: string;
  synthetic: true;
}

export interface AssetComponent {
  component_id: string;
  name: string;
  component_type: 'motor' | 'shaft' | 'bearing' | 'impeller' | 'casing' | 'seal' | 'valve';
  description: string;
  status: 'healthy' | 'watch' | 'service_due';
  installed_at: string;
  expected_life_hours: number;
  operating_hours: number;
  sensor_ids: string[];
  spatial_anchor: { x: number; y: number; z: number };
}

export interface TelemetryThresholds {
  warning_low?: number;
  critical_low?: number;
  warning_high?: number;
  critical_high?: number;
}

export interface TelemetryReading {
  sensor_id: string;
  metric: AssetTelemetryMetric;
  label: string;
  value: number;
  unit: string;
  status: ReadingStatus;
  quality: 'good';
  thresholds: TelemetryThresholds;
}

export interface TelemetryFrame {
  sequence: number;
  observed_at: string;
  source: 'synthetic_iot_gateway';
  synthetic: true;
  readings: TelemetryReading[];
}

export interface AnalyticsContribution {
  signal: AssetTelemetryMetric;
  current_value: number;
  baseline_mean: number;
  ewma_value: number;
  z_score: number;
  contribution: number;
  direction: 'above_baseline' | 'below_baseline';
}

export interface AssetAnomaly {
  anomaly_id: string;
  detected_at: string;
  severity: 'none' | 'watch' | 'warning' | 'critical';
  anomaly_score: number;
  model_version: string;
  method: 'multivariate_ewma_z_score';
  summary: string;
  contributions: AnalyticsContribution[];
}

export interface AssetPrediction {
  prediction_id: string;
  generated_at: string;
  predicted_failure_mode: 'drive_end_bearing_degradation' | 'no_failure_mode_indicated';
  target_signal: 'vibration_mm_s';
  model_version: string;
  method: 'ordinary_least_squares_trend_to_threshold';
  slope_per_day: number;
  failure_threshold: number;
  predicted_threshold_at: string | null;
  horizon_days: number | null;
  estimated_remaining_useful_life_days: number | null;
  confidence: { score: number; basis: string };
  recommended_maintenance: string;
  contributions: AnalyticsContribution[];
  caveat: string;
}

export interface AnalyticsModelCard {
  model_version: string;
  anomaly_detection: {
    algorithm: 'multivariate_ewma_z_score';
    ewma_alpha: number;
    baseline_samples: number;
    warning_z_score: number;
    critical_z_score: number;
  };
  prediction: {
    algorithm: 'ordinary_least_squares_trend_to_threshold';
    target_signal: 'vibration_mm_s';
    failure_threshold: number;
  };
  evaluated_on: 'deterministic_synthetic_fixture_only';
  intended_use: string;
  limitations: string[];
}

export interface LifecycleStage {
  stage: 'design' | 'manufacture' | 'commissioning' | 'operation' | 'service' | 'decommissioning';
  status: 'completed' | 'current' | 'planned';
  started_at: string;
  completed_at: string | null;
  evidence_ref: string;
}

export interface LifecycleEvent {
  event_id: string;
  event_type: 'design_approved' | 'manufactured' | 'installed' | 'inspection' | 'maintenance' | 'component_replaced' | 'decommission_planned';
  occurred_at: string;
  title: string;
  description: string;
  work_order_ref: string | null;
}

export interface MaintenanceItem {
  maintenance_id: string;
  kind: 'inspection' | 'preventive' | 'condition_based';
  status: 'completed' | 'scheduled' | 'recommended';
  title: string;
  due_at: string;
  component_id: string;
  rationale: string;
}

export type AssetControlCommandType = 'set_speed_pct' | 'set_valve_pct' | 'emergency_stop' | 'reset';

export interface AssetControlCommand {
  type: AssetControlCommandType;
  value?: number;
}

export interface AssetControlState {
  version: number;
  speed_pct: number;
  speed_rpm: number;
  valve_pct: number;
  emergency_stopped: boolean;
  operating_mode: 'automatic' | 'manual' | 'stopped' | 'emergency_stopped';
  updated_at: string;
}

export interface AssetAuditEvidence {
  event_id: string;
  tenant_sequence: number;
  action: string;
  actor_id: string;
  resource_type: 'physical_asset' | 'asset_control_preview' | 'asset_control_receipt';
  resource_id: string;
  occurred_at: string;
  request_id: string;
  trace_id: string;
  details_hash: string;
  previous_hash: string;
  event_hash: string;
}

export interface AssetControlPreview {
  preview_id: string;
  tenant_id: string;
  asset_id: string;
  requester_id: string;
  command: AssetControlCommand;
  expected_version: number;
  reason: string;
  before_state: AssetControlState;
  after_state: AssetControlState;
  safety: {
    accepted: true;
    policy_version: string;
    checks: Array<{ check: string; passed: true; detail: string }>;
  };
  payload_hash: string;
  preview_hash: string;
  created_at: string;
  expires_at: string;
  status: 'ready' | 'executed';
  execution_mode: 'simulation';
  external_write: false;
  audit_evidence: AssetAuditEvidence;
}

export interface AssetControlReceipt {
  receipt_id: string;
  tenant_id: string;
  asset_id: string;
  preview_id: string;
  requester_id: string;
  command: AssetControlCommand;
  before_state: AssetControlState;
  after_state: AssetControlState;
  payload_hash: string;
  idempotency_key: string;
  provider: 'synthetic_asset_simulator';
  provider_request_id: string;
  status: 'succeeded';
  simulation: true;
  external_write: false;
  recorded_at: string;
  audit_evidence: AssetAuditEvidence;
}

export interface AssetTwinSnapshot {
  asset: PhysicalAsset & { can_control: boolean };
  visualization: {
    kind: 'procedural_3d';
    model_url: null;
    coordinate_system: 'right_handed_y_up';
    dimensions_m: { length: number; width: number; height: number };
    component_anchors: Array<{ component_id: string; x: number; y: number; z: number }>;
    camera: { position: [number, number, number]; target: [number, number, number] };
  };
  components: AssetComponent[];
  current_telemetry: TelemetryFrame;
  telemetry_history: TelemetryFrame[];
  analytics: {
    anomalies: AssetAnomaly[];
    predictions: AssetPrediction[];
    model_card: AnalyticsModelCard;
  };
  lifecycle: {
    current_stage: 'operation';
    stages: LifecycleStage[];
    events: LifecycleEvent[];
    maintenance: MaintenanceItem[];
  };
  control: {
    state: AssetControlState;
    limits: {
      speed_pct: { min: number; max: number };
      valve_pct: { min: number; max: number };
    };
    available_commands: Array<{
      type: AssetControlCommandType;
      value_required: boolean;
      safe_range: { min: number; max: number; unit: 'percent' } | null;
      description: string;
    }>;
    simulation_only: true;
  };
  data_watermark: { telemetry_sequence: number; observed_at: string; model_version: string };
}
