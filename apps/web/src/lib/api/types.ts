export type TenantAlias = "tnt_aster" | "tnt_beacon";

export type Membership = {
  membershipId: string;
  tenantAlias: TenantAlias;
  tenantName: string;
  role: string;
  capabilities: string[];
};

export type ActorContext = {
  actor: { id: string; displayName: string; initials: string };
  activeMembershipId: string;
  memberships: Membership[];
  expiresAt: string;
};

export type SourceState = "healthy" | "stale" | "revoked";

export type ConnectorHealth = {
  provider: "GitHub" | "Jira";
  state: SourceState;
  lastSyncedAt: string;
  freshnessMinutes: number;
  detail: string;
};

export type EvidenceRef = {
  id: string;
  label: string;
  source: "GitHub" | "Jira";
  sourceKey: string;
  revision: string;
  observedAt: string;
  confidence: number;
  access: "full" | "restricted" | "revoked";
  excerpt?: string;
};

export type GraphNodeKind = "work" | "code" | "milestone";

export type GraphNode = {
  id: string;
  label: string;
  title: string;
  kind: GraphNodeKind;
  status: string;
  owner: string;
  evidenceIds: string[];
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  type: "IMPLEMENTS" | "BLOCKS" | "GATES";
  evidenceId: string;
};

export type GraphResult = {
  tenantName: string;
  title: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  evidence: EvidenceRef[];
  boundedDepth: number;
  projectionAsOf: string;
  dataWatermark: string;
};

export type Citation = {
  number: number;
  claim: string;
  evidence: EvidenceRef;
};

export type AnswerMode = "grounded" | "restricted" | "unsafe";

export type CitedAnswer = {
  question: string;
  answer: string;
  confidence: "high" | "medium" | "abstained";
  citations: Citation[];
  missingData: string[];
  caveat: string;
  abstentionReason?: string;
  redactedSourceCount?: number;
  runId: string;
  completedAt: string;
};

export type ScenarioIntervention = {
  type: "shift_completion_distribution";
  workItemId: string;
  workItemKey: "AST-142";
  deltaWorkdays: number;
};

export type ScenarioDraft = {
  id: string;
  name: string;
  status: "draft" | "confirmed";
  basedOnSnapshot: string;
  snapshotAsOf: string;
  intervention: ScenarioIntervention;
  seed: string;
  sampleCount: 50000;
  modelVersion: "pert-monte-carlo/1.0.0";
  assumptions: string[];
  digest: string;
  etag: string;
  confirmedAt?: string;
};

export type Forecast = {
  p50: string;
  p80: string;
  p95: string;
};

export type CriticalPathItem = {
  key: string;
  title: string;
  criticality: number;
  change?: number;
};

export type SimulationComparison = {
  runId: string;
  status: "succeeded";
  seed: string;
  sampleCount: number;
  baseline: Forecast;
  scenario: Forecast;
  deltaDays: Forecast;
  probabilityOfImprovement: number;
  baselineCriticalPath: CriticalPathItem[];
  scenarioCriticalPath: CriticalPathItem[];
  sensitivity: Array<{ key: string; label: string; score: number }>;
  warnings: string[];
  resultHash: string;
  completedAt: string;
};

export type JiraSnapshot = {
  version: number;
  dueDate: string;
  priorityId: string;
  priorityName: string;
  labels: string[];
};

export type ExactJiraPayload = {
  action: "jira.issue.update";
  connectorInstallationId: string;
  expectedIssueVersion: 7;
  issueKey: "AST-142";
  projectKey: "AST";
  set: { dueDate: "2026-07-31"; labels: string[]; priorityId: "2" };
  tenantId: string;
};

export type RemediationPreview = {
  previewId: string;
  issueKey: "AST-142";
  summary: string;
  before: JiraSnapshot;
  after: JiraSnapshot;
  payload: ExactJiraPayload;
  payloadHash: string;
  scope: string;
  risks: string[];
  rollback: string;
  expiresAt: string;
};

export type ApprovalRole = "operations" | "security";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ApprovalDecision = {
  role: ApprovalRole;
  approverId: string;
  approverName: string;
  decidedAt: string;
  payloadHash: string;
};

export type ApprovalRequest = {
  approvalId: string;
  status: ApprovalStatus;
  payloadHash: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  requiredRoles: ApprovalRole[];
  decisions: ApprovalDecision[];
};

export type ActionReceipt = {
  receiptId: string;
  status: "succeeded";
  issueKey: "AST-142";
  providerRequestId: string;
  idempotencyKey: string;
  payloadHash: string;
  before: JiraSnapshot;
  after: JiraSnapshot;
  executedAt: string;
  jiraPutCount: 1;
  replayed: boolean;
  rollbackExpiresAt: string;
  auditEventIds: string[];
};

export type CompensationPreview = {
  compensationId: string;
  approvalId: string;
  payloadHash: string;
  status: "pending" | "approved" | "conflict" | "compensated";
  decisions: ApprovalDecision[];
  expectedCurrent: JiraSnapshot;
  restoreTo: JiraSnapshot;
  guard: string;
  expiresAt: string;
};

export type DemoState = "live" | "loading" | "empty" | "error" | "stale" | "revoked";

export type AssetOperatingStatus = "running" | "idle" | "maintenance" | "offline";
export type AssetComponentStatus = "normal" | "attention" | "critical";

export type AssetSummary = {
  assetId: string;
  name: string;
  assetType: "centrifugal_pump";
  model: string;
  serialNumber: string;
  site: string;
  status: AssetOperatingStatus;
  healthScore: number;
  lifecycleStage: "design" | "manufacture" | "commission" | "operation" | "service" | "maintenance" | "decommission";
  version: number;
  canControl: boolean;
};

export type AssetComponent = {
  componentId: string;
  name: string;
  kind: "motor" | "shaft" | "bearing" | "impeller" | "casing" | "seal" | "valve" | "inlet";
  status: AssetComponentStatus;
  description: string;
  sensorTags: string[];
};

export type TelemetryPoint = {
  timestamp: string;
  temperatureC: number;
  pressureBar: number;
  vibrationMmS: number;
  flowM3H: number;
  motorCurrentA: number;
  speedRpm: number;
};

export type AssetTelemetryMetric = Exclude<keyof TelemetryPoint, "timestamp">;

export type AssetTelemetrySignal = {
  label: string;
  unit: string;
  status: "normal" | "warning" | "critical";
  valueKind: "observed" | "derived";
  warningLow?: number;
  criticalLow?: number;
  warningHigh?: number;
  criticalHigh?: number;
};

export type AssetTelemetry = {
  assetId: string;
  sampledAt: string;
  receivedAt: string;
  intervalSeconds: number;
  points: TelemetryPoint[];
  signals: Record<AssetTelemetryMetric, AssetTelemetrySignal>;
};

export type FailurePrediction = {
  predictionId: string;
  componentId: string;
  severity: "info" | "warning" | "critical";
  title: string;
  confidence: number;
  horizonHours: number;
  horizonLabel: string;
  explanation: string;
  evidence: string[];
  recommendation: string;
  modelVersion: string;
  generatedAt: string;
};

export type LifecycleEvent = {
  eventId: string;
  stage: "design" | "manufacture" | "commission" | "operation" | "service" | "maintenance" | "decommission";
  status: "complete" | "current" | "planned";
  date: string;
  title: string;
  detail: string;
  artifact?: string;
};

export type AssetTwinSnapshot = {
  asset: AssetSummary & {
    manufacturer: string;
    installedAt: string;
    designFlowM3H: number;
    designHeadM: number;
    ratedSpeedRpm: number;
  };
  components: AssetComponent[];
  predictions: FailurePrediction[];
  lifecycle: LifecycleEvent[];
  control: {
    supportedCommands: Array<"set_speed_pct" | "set_valve_pct" | "emergency_stop" | "reset">;
    minSpeedPct: number;
    maxSpeedPct: number;
    minValvePct: number;
    maxValvePct: number;
    state: AssetControlState;
    mode: "synthetic_sandbox";
  };
  projectionAsOf: string;
};

export type AssetCommand =
  | { type: "set_speed_pct"; value: number }
  | { type: "set_valve_pct"; value: number }
  | { type: "emergency_stop" }
  | { type: "reset" };

export type AssetControlState = {
  version: number;
  speedPct: number;
  valvePct: number;
  emergencyStopped: boolean;
  status: AssetOperatingStatus;
};

export type AssetCommandPreview = {
  previewId: string;
  assetId: string;
  command: AssetCommand;
  expectedAssetVersion: number;
  payloadHash: string;
  currentState: AssetControlState;
  predictedState: AssetControlState;
  safetyChecks: Array<{ check: string; passed: boolean; detail: string }>;
  risks: string[];
  expiresAt: string;
  executionMode: "simulation";
  externalWrite: false;
};

export type AssetCommandReceipt = {
  receiptId: string;
  assetId: string;
  status: "succeeded" | "rejected";
  command: AssetCommand;
  assetVersionBefore: number;
  assetVersionAfter: number;
  idempotencyKey: string;
  payloadHash: string;
  executedAt: string;
  replayed: boolean;
  auditEventId: string;
  simulation: true;
  externalWrite: false;
};

export type DemoSnapshot = {
  actor: ActorContext;
  connectorHealth: ConnectorHealth[];
  graph: GraphResult;
  answer: CitedAnswer;
  scenario: ScenarioDraft;
  simulation: SimulationComparison;
  remediation: RemediationPreview;
};

export interface DigitalTwinApi {
  getActorContext(signal?: AbortSignal): Promise<ActorContext>;
  selectMembership(membershipId: string, signal?: AbortSignal): Promise<ActorContext>;
  getConnectorHealth(signal?: AbortSignal): Promise<ConnectorHealth[]>;
  traverseLaunchGraph(signal?: AbortSignal): Promise<GraphResult>;
  askLaunchRisk(question: string, mode: AnswerMode, signal?: AbortSignal): Promise<CitedAnswer>;
  createScenario(deltaWorkdays: number, signal?: AbortSignal): Promise<ScenarioDraft>;
  confirmScenario(scenarioId: string, digest: string, etag: string, signal?: AbortSignal): Promise<ScenarioDraft>;
  runSimulation(scenarioId: string, signal?: AbortSignal): Promise<SimulationComparison>;
  previewRemediation(signal?: AbortSignal): Promise<RemediationPreview>;
  requestApproval(previewId: string, payloadHash: string, signal?: AbortSignal): Promise<ApprovalRequest>;
  approve(
    approvalId: string,
    role: ApprovalRole,
    payloadHash: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApprovalRequest>;
  execute(approvalId: string, idempotencyKey: string, signal?: AbortSignal): Promise<ActionReceipt>;
  previewCompensation(receiptId: string, signal?: AbortSignal): Promise<CompensationPreview>;
  approveCompensation(
    compensationId: string,
    role: ApprovalRole,
    payloadHash: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<CompensationPreview>;
  compensate(compensationId: string, idempotencyKey: string, signal?: AbortSignal): Promise<CompensationPreview>;
  getAssets(signal?: AbortSignal): Promise<AssetSummary[]>;
  getAssetTwin(assetId: string, signal?: AbortSignal): Promise<AssetTwinSnapshot>;
  getAssetTelemetry(assetId: string, limit?: number, signal?: AbortSignal): Promise<AssetTelemetry>;
  previewAssetCommand(assetId: string, command: AssetCommand, signal?: AbortSignal): Promise<AssetCommandPreview>;
  executeAssetCommand(
    assetId: string,
    previewId: string,
    payloadHash: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<AssetCommandReceipt>;
}

export class ApiProblem extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ApiProblem";
  }
}
