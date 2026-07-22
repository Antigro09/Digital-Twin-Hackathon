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

export type EventConfidenceLevel = "confirmed" | "likely" | "possible" | "speculative" | "rejected";
export type EventIntent = "auto" | "reality" | "scenario";
export type EventEffectOrder = "event" | "direct" | "second" | "third" | "long_term" | "unknown";

export type EventEntityCandidate = {
  entityId: string;
  label: string;
  entityType: string;
  confidence: number;
  reason: string;
  selected: boolean;
};

export type EventEntityResolution = {
  mention: string;
  candidates: EventEntityCandidate[];
  requiredConfirmation: boolean;
};

export type EventImpactNode = {
  nodeId: string;
  label: string;
  kind: "event" | "person" | "system" | "project" | "process" | "relationship" | "risk" | "prediction" | "recommendation" | "unknown";
  effectOrder: EventEffectOrder;
  severity: "info" | "low" | "medium" | "high" | "critical" | "unknown";
  confidence: number | null;
  timeHorizon: string;
  change: string;
  explanation: string;
  evidence: string[];
};

export type EventImpactEdge = {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  relation: string;
  effectOrder: EventEffectOrder;
  confidence: number | null;
  explanation: string;
  evidence: string[];
};

export type EventStateDelta = {
  deltaId: string;
  subject: string;
  field: string;
  before: string;
  after: string;
  operation: "create" | "update" | "remove" | "uncertain";
  confidence: number | null;
};

export type EventRiskDelta = {
  deltaId: string;
  label: string;
  kind: "risk" | "prediction";
  before: string;
  after: string;
  direction: "increase" | "decrease" | "changed" | "unknown";
  confidence: number | null;
  explanation: string;
};

export type EventRecommendation = {
  recommendationId: string;
  title: string;
  rationale: string;
  urgency: "now" | "next_7_days" | "next_30_days" | "monitor";
  owner: string;
};

export type EventInterpretation = {
  previewId: string;
  eventId: string;
  input: string;
  title: string;
  eventType: string;
  category: "people" | "project" | "technology" | "business" | "operational" | "external" | "unknown";
  occurredAt: string | null;
  location: string | null;
  source: string;
  confidence: number;
  confidenceLevel: EventConfidenceLevel;
  verificationStatus: "unverified" | "partially_verified" | "verified" | "disputed";
  processingMode: "reality_review" | "scenario_only" | "rejected";
  modeReason: string;
  entityResolutions: EventEntityResolution[];
  nodes: EventImpactNode[];
  edges: EventImpactEdge[];
  stateDeltas: EventStateDelta[];
  riskDeltas: EventRiskDelta[];
  recommendations: EventRecommendation[];
  assumptions: string[];
  unknowns: string[];
  warnings: string[];
  evidence: string[];
  model: { provider: string; version: string; generativeModelUsed: boolean };
  graphSnapshotVersion: number;
  graphSnapshotHash: string;
  digest: string;
  etag: string;
  expiresAt: string;
  canApplyToTwin: boolean;
  externalWrite: false;
  additionalEvents?: EventInterpretation[];
};

export type EventDecisionReceipt = {
  receiptId: string;
  eventId: string;
  previewId: string;
  decision: "applied" | "scenario_branched" | "rolled_back";
  status: "succeeded" | "rejected";
  idempotencyKey: string;
  digest: string;
  recordedAt: string;
  eventVersionBefore: number;
  eventVersionAfter: number;
  graphVersionBefore: number;
  graphVersionAfter: number;
  outboxPosition: number;
  beforeStateHash?: string;
  afterStateHash?: string;
  replayed: boolean;
  auditEventId: string;
  rollbackAvailable: boolean;
  externalWrite: false;
  message: string;
};

export type EventReview = {
  eventId: string;
  previewId: string;
  eventVersion: number;
  status: "reviewed" | "approval_pending" | "approved";
  targetMode: "reality" | "scenario";
  selectedEntityIds: string[];
  reviewedPayloadHash: string;
  etag: string;
  reviewedInterpretation: EventInterpretation;
};

export type EventApprovalDecision = {
  role: "operations" | "security";
  approverId: string;
  decidedAt: string;
  payloadHash: string;
};

export type EventApproval = {
  approvalId: string;
  eventId: string;
  eventVersion: number;
  graphSnapshotVersion: number;
  graphSnapshotHash: string;
  payloadHash: string;
  status: "pending" | "approved" | "denied" | "executed";
  requiredRoles: Array<"operations" | "security">;
  decisions: EventApprovalDecision[];
  expiresAt: string;
  approvalKind: "dual_human" | "scenario_policy";
};

export type EventTimelineEntry = {
  timelineEntryId: string;
  eventId: string;
  title: string;
  eventType: string;
  occurredAt: string;
  recordedAt: string;
  status: "applied" | "scenario" | "rolled_back" | "rejected";
  confidenceLevel: EventConfidenceLevel;
  confidence: number;
  effectCount: number;
  graphVersionBefore: number;
  graphVersionAfter: number;
  rollbackAvailable: boolean;
  receiptId?: string;
  summary: string;
};

export type EventScenarioBranch = {
  branchId: string;
  name: string;
  parentBranchId?: string;
  createdByEventId?: string;
  createdAt: string;
  mode: "baseline" | "scenario";
  status: "active" | "rolled_back";
  eventIds: string[];
  baseGraphVersion: number;
  baseGraphHash: string;
  stateHash: string;
};

export type EventReplay = {
  eventId: string;
  mode: "reality" | "scenario";
  currentStatus: string;
  reconstructable: boolean;
  graph?: {
    beforeVersion: number;
    afterVersion: number;
    beforeStateHash: string;
    afterStateHash: string;
  };
  entityChanges: Array<{
    entityId: string;
    displayName: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>;
  relationshipChanges: Array<{
    relationshipId: string;
    type: string;
    fromEntityId: string;
    toEntityId: string;
    beforeState: string | null;
    afterState: string | null;
  }>;
  receipts: Array<{
    receiptId: string;
    action: "apply_reality" | "apply_scenario" | "rollback";
    recordedAt: string;
    graphVersionBefore: number;
    graphVersionAfter: number;
    outboxPosition: number;
  }>;
  timeline: Array<{
    timelineEntryId: string;
    action: "baseline" | "event_applied" | "event_rolled_back";
    recordedAt: string;
    receiptId?: string;
  }>;
  branch?: EventScenarioBranch;
};

export type EventBranchComparison = {
  left: EventScenarioBranch;
  right: EventScenarioBranch;
  sameBaseSnapshot: boolean;
  commonEventIds: string[];
  leftOnlyEventIds: string[];
  rightOnlyEventIds: string[];
  stateHashEqual: boolean;
};

export type AiExecutionMode = "connected" | "offline_ui_preview";
export type AiAgentType = "knowledge_ingestion" | "entity_resolution" | "event_understanding" | "causal_analysis" | "simulation_planning" | "prediction_explanation" | "technical_knowledge" | "marketing_analyst";
export type AiAgentRunStatus = "queued" | "running" | "succeeded" | "PENDING_REVIEW" | "approved" | "rejected" | "failed" | "cancelled";
export type AiSuggestionStatus = "PENDING_REVIEW";
export type AiClassification = "public" | "internal" | "confidential" | "restricted";
export type AiSourceAcl = { visibility: "private" };

export type AiEvidence = {
  evidenceId: string;
  label: string;
  source: string;
  sourceKey: string;
  excerpt: string;
  confidence: number | null;
  classification: AiClassification | "not_reported";
};

export type AiUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  currency: "USD" | null;
};

export type AiProviderReadiness = {
  provider: string;
  displayName: string;
  status: "ready" | "degraded" | "unavailable" | "offline_preview";
  detail: string;
  approvedModels: string[];
  capabilities: string[];
  liveVerified: boolean;
  lastCheckedAt: string;
};

export type AiAgentProfile = {
  agentType: AiAgentType;
  label: string;
  purpose: string;
  authorityBoundary: string;
  canRun: boolean;
};

export type AiStatus = {
  executionMode: AiExecutionMode;
  profile: string;
  providerReadiness: AiProviderReadiness[];
  agentProfiles: AiAgentProfile[];
  knowledgeImport: {
    enabled: boolean;
    storeReady: boolean;
    authorized: boolean;
    maxBytes: number;
    allowedMediaTypes: string[];
    classifications: AiClassification[];
    sourceAcl: AiSourceAcl;
  };
  canReviewSuggestions: boolean;
  checkedAt: string;
};

export type AiAgentActivity = {
  runId: string;
  agentType?: AiAgentType;
  agentLabel: string;
  status: AiAgentRunStatus;
  taskSummary: string;
  initiatedBy: string;
  provider: string;
  model: string;
  startedAt: string;
  completedAt?: string;
  evidenceCount: number;
  toolInvocationCount: number;
};

export type AiActivityFeed = {
  active: AiAgentActivity[];
  recent: AiAgentActivity[];
  pageSize: number;
  nextCursor?: string;
};

export type AiAgentRunInput = {
  agentType: AiAgentType;
  input: string;
  retrievalQuery?: string;
  maxEvidenceItems?: number;
};

export type AiAgentResult = {
  run: AiAgentActivity;
  status: "PENDING_REVIEW";
  output: string;
  confidence: number;
  evidence: AiEvidence[];
  provider: string;
  model: string;
  usage: AiUsage;
  warnings: string[];
  causalChain: AiCausalStep[];
  affectedNodes: AiAffectedNode[];
  limitations: string[];
  structuredOutput?: Record<string, unknown>;
  reviewNotice: string;
  executionMode: AiExecutionMode;
};

export type AiKnowledgeImportInput = {
  filename: string;
  mediaType: string;
  contentBase64: string;
  classification: AiClassification;
  sourceAcl: AiSourceAcl;
};

export type AiKnowledgeImportResult = {
  importId: string;
  filename: string;
  status: "accepted" | "indexed" | "rejected";
  classification: AiClassification;
  sourceAcl: AiSourceAcl;
  byteCount: number;
  contentHash: string;
  message: string;
  acceptedAt: string;
  executionMode: AiExecutionMode;
};

export type AiSuggestion = {
  suggestionId: string;
  title: string;
  summary: string;
  proposedAction: string;
  status: AiSuggestionStatus;
  confidence: number;
  evidence: AiEvidence[];
  provider: string;
  model: string;
  usage: AiUsage;
  createdAt: string;
  reviewDecision?: "approve" | "reject";
  reviewedAt?: string;
  reviewReason?: string;
  noGraphMutation: true;
  executionMode: AiExecutionMode;
  structuredOutput?: Record<string, unknown>;
};

export type AiSuggestionReview = {
  suggestionId: string;
  decision: "approve" | "reject";
  reason: string;
};

export type AiCausalStep = {
  step: number;
  fromNode: string;
  relationship: string;
  toNode: string;
  explanation: string;
  evidenceIds: string[];
};

export type AiAffectedNode = {
  nodeId: string | null;
  label: string;
  kind: string;
  effect: string;
};

export type AiExplainResult = {
  query: string;
  summary: string;
  confidence: number | null;
  causalChain: AiCausalStep[];
  evidence: AiEvidence[];
  affectedNodes: AiAffectedNode[];
  provider: string;
  model: string;
  generatedAt: string;
  runId?: string;
  status: "retrieval_only" | "PENDING_REVIEW";
  limitations: string[];
  executionMode: AiExecutionMode;
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
  readonly sourceMode: "demo" | "connected";
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
  interpretEvent(input: string, intent: EventIntent, signal?: AbortSignal): Promise<EventInterpretation>;
  reviewEvent(
    previewId: string,
    digest: string,
    targetMode: "reality" | "scenario",
    selectedEntityIds: string[],
    signal?: AbortSignal,
  ): Promise<EventReview>;
  requestEventApproval(review: EventReview, signal?: AbortSignal): Promise<EventApproval>;
  approveEvent(approvalId: string, role: "operations" | "security", payloadHash: string, signal?: AbortSignal): Promise<EventApproval>;
  applyReviewedEvent(review: EventReview, approval: EventApproval, signal?: AbortSignal): Promise<EventDecisionReceipt>;
  decideEvent(
    previewId: string,
    digest: string,
    decision: "apply" | "branch_scenario",
    selectedEntityIds: string[],
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<EventDecisionReceipt>;
  getEventTimeline(signal?: AbortSignal): Promise<EventTimelineEntry[]>;
  getEventBranches(signal?: AbortSignal): Promise<EventScenarioBranch[]>;
  getEventReplay(eventId: string, signal?: AbortSignal): Promise<EventReplay>;
  compareEventBranches(leftBranchId: string, rightBranchId: string, signal?: AbortSignal): Promise<EventBranchComparison>;
  rollbackEvent(eventId: string, receiptId: string, idempotencyKey: string, signal?: AbortSignal): Promise<EventDecisionReceipt>;
  getAiStatus(signal?: AbortSignal): Promise<AiStatus>;
  getAiActivity(pageSize?: number, signal?: AbortSignal): Promise<AiActivityFeed>;
  runAiAgent(input: AiAgentRunInput, signal?: AbortSignal): Promise<AiAgentResult>;
  queryAiRetrieval(query: string, limit?: number, classifications?: AiClassification[], signal?: AbortSignal): Promise<AiExplainResult>;
  importAiKnowledge(input: AiKnowledgeImportInput, signal?: AbortSignal): Promise<AiKnowledgeImportResult>;
  getAiSuggestions(signal?: AbortSignal): Promise<AiSuggestion[]>;
  reviewAiSuggestion(input: AiSuggestionReview, signal?: AbortSignal): Promise<AiSuggestion>;
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
