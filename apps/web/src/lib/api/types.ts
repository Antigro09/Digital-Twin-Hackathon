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
