import type {
  ActorContext,
  CitedAnswer,
  ConnectorHealth,
  GraphResult,
  RemediationPreview,
  ScenarioDraft,
  SimulationComparison,
} from "./types";

export const FROZEN_NOW = "2026-07-13T16:00:00Z";

export const MEMBERSHIPS: ActorContext = {
  actor: {
    id: "20000000-0000-4000-8000-000000000001",
    displayName: "Maya Chen",
    initials: "MC",
  },
  activeMembershipId: "mem_aster_operator",
  expiresAt: "2026-07-13T17:00:00Z",
  memberships: [
    {
      membershipId: "mem_aster_operator",
      tenantAlias: "tnt_aster",
      tenantName: "Aster Labs",
      role: "Program operator",
      capabilities: ["graph:read", "questions:ask", "scenario:write", "action:propose"],
    },
    {
      membershipId: "mem_beacon_observer",
      tenantAlias: "tnt_beacon",
      tenantName: "Beacon Works",
      role: "Read-only observer",
      capabilities: ["graph:read", "questions:ask"],
    },
  ],
};

export const CONNECTOR_HEALTH: ConnectorHealth[] = [
  {
    provider: "GitHub",
    state: "healthy",
    lastSyncedAt: "2026-07-13T15:47:00Z",
    freshnessMinutes: 13,
    detail: "12 repositories · metadata read-only",
  },
  {
    provider: "Jira",
    state: "healthy",
    lastSyncedAt: "2026-07-13T15:46:30Z",
    freshnessMinutes: 14,
    detail: "4 allowlisted projects · AST remediation enabled",
  },
];

const evidence = {
  ast142: {
    id: "aster-jira-AST-142-v7",
    label: "AST-142 · Complete SSO cutover",
    source: "Jira" as const,
    sourceKey: "AST-142",
    revision: "7",
    observedAt: "2026-07-13T15:45:00Z",
    confidence: 1,
    access: "full" as const,
    excerpt: "In Progress · due 2026-08-07 · Identity team",
  },
  ast173: {
    id: "aster-jira-AST-173-v4",
    label: "AST-173 · Build Orion release candidate",
    source: "Jira" as const,
    sourceKey: "AST-173",
    revision: "4",
    observedAt: "2026-07-13T15:46:00Z",
    confidence: 1,
    access: "full" as const,
    excerpt: "Open · blocked by AST-142 · Release team",
  },
  ast201: {
    id: "aster-jira-AST-201-v3",
    label: "AST-201 · Complete launch certification",
    source: "Jira" as const,
    sourceKey: "AST-201",
    revision: "3",
    observedAt: "2026-07-13T15:46:30Z",
    confidence: 1,
    access: "full" as const,
    excerpt: "Open · gates Orion 2.0 GA · Security team",
  },
  pr184: {
    id: "aster-github-identity-service-pr-184",
    label: "identity-service#184 · Finalize token migration",
    source: "GitHub" as const,
    sourceKey: "aster-labs/identity-service#184",
    revision: "sha256:pr184-revision-12",
    observedAt: "2026-07-13T15:47:00Z",
    confidence: 1,
    access: "full" as const,
    excerpt: "Open · 0 of 1 required security reviews",
  },
};

export const ASTER_GRAPH: GraphResult = {
  tenantName: "Aster Labs",
  title: "Orion 2.0 launch dependency path",
  boundedDepth: 4,
  projectionAsOf: "2026-07-13T15:47:00Z",
  dataWatermark: "projection:aster:0001842",
  evidence: Object.values(evidence),
  nodes: [
    { id: "pr184", label: "PR #184", title: "Token migration", kind: "code", status: "Review missing", owner: "Identity", evidenceIds: [evidence.pr184.id] },
    { id: "ast142", label: "AST-142", title: "SSO cutover", kind: "work", status: "In progress", owner: "Identity", evidenceIds: [evidence.ast142.id, evidence.pr184.id] },
    { id: "ast173", label: "AST-173", title: "Release candidate", kind: "work", status: "Blocked", owner: "Release", evidenceIds: [evidence.ast173.id] },
    { id: "ast201", label: "AST-201", title: "Launch certification", kind: "work", status: "Blocked", owner: "Security", evidenceIds: [evidence.ast201.id] },
    { id: "orion", label: "Orion 2.0", title: "General availability", kind: "milestone", status: "At risk", owner: "Product", evidenceIds: [evidence.ast201.id] },
  ],
  edges: [
    { id: "edge-pr-142", from: "pr184", to: "ast142", type: "IMPLEMENTS", evidenceId: evidence.pr184.id },
    { id: "edge-142-173", from: "ast142", to: "ast173", type: "BLOCKS", evidenceId: evidence.ast173.id },
    { id: "edge-173-201", from: "ast173", to: "ast201", type: "BLOCKS", evidenceId: evidence.ast201.id },
    { id: "edge-201-orion", from: "ast201", to: "orion", type: "GATES", evidenceId: evidence.ast201.id },
  ],
};

export const BEACON_GRAPH: GraphResult = {
  tenantName: "Beacon Works",
  title: "Launch dependency view",
  boundedDepth: 2,
  projectionAsOf: "2026-07-13T15:44:30Z",
  dataWatermark: "projection:beacon:0000914",
  evidence: [],
  nodes: [],
  edges: [],
};

export const GROUNDED_ANSWER: CitedAnswer = {
  question: "What is most likely to delay Orion 2.0, what evidence supports that conclusion, and what information is still missing?",
  answer:
    "AST-142, the SSO cutover, is the strongest recorded launch blocker. It blocks AST-173, which blocks AST-201 and the Orion 2.0 GA milestone. The linked identity-service PR #184 is still missing its required security review. OPS-61 and PROD-88 remain secondary risks, but neither is on the p80 critical path.",
  confidence: "high",
  citations: [
    { number: 1, claim: "AST-142 is active and due 2026-08-07.", evidence: evidence.ast142 },
    { number: 2, claim: "AST-142 blocks the release candidate.", evidence: evidence.ast173 },
    { number: 3, claim: "Certification gates Orion 2.0 GA.", evidence: evidence.ast201 },
    { number: 4, claim: "PR #184 has no required security approval yet.", evidence: evidence.pr184 },
  ],
  missingData: [
    "Future security review completion time",
    "Unrecorded work outside connected sources",
    "External validity of synthetic duration distributions",
  ],
  caveat: "This is a grounded explanation over deterministic synthetic data, not a production prediction or an assessment of individual performance.",
  runId: "50000000-0000-4000-8000-000000000001",
  completedAt: FROZEN_NOW,
};

export const SCENARIO_DRAFT: ScenarioDraft = {
  id: "60000000-0000-4000-8000-000000000001",
  name: "Accelerate AST-142 by five workdays",
  status: "draft",
  basedOnSnapshot: "sha256:8d5b1a77486280e95017815af70b1fe2fd20101a9a896ce77c49288c207a1270",
  snapshotAsOf: "2026-07-13T15:47:00Z",
  intervention: {
    type: "shift_completion_distribution",
    workItemId: "116ab4b3-b108-5f91-ab7e-111f7fba1d45",
    workItemKey: "AST-142",
    deltaWorkdays: -5,
  },
  seed: "20260713",
  sampleCount: 50000,
  modelVersion: "pert-monte-carlo/1.0.0",
  assumptions: [
    "Seeded PERT distributions use explicit synthetic work-item estimates.",
    "Weekends are non-working days; no additional holidays are introduced.",
    "The intervention shifts AST-142 only; it does not infer individual productivity.",
  ],
  digest: "sha256:99f5bb9eaa944a892acb09914e22ee276e3dfac2346775b83840f9f923087a52",
  etag: '"scenario-draft-v1"',
};

export const SIMULATION: SimulationComparison = {
  runId: "70000000-0000-4000-8000-000000000001",
  status: "succeeded",
  seed: "20260713",
  sampleCount: 50000,
  baseline: { p50: "2026-08-20", p80: "2026-08-24", p95: "2026-08-27" },
  scenario: { p50: "2026-08-13", p80: "2026-08-17", p95: "2026-08-20" },
  deltaDays: { p50: "-5", p80: "-5", p95: "-5" },
  probabilityOfImprovement: 1,
  baselineCriticalPath: [
    { key: "AST-142", title: "SSO cutover", criticality: 0.91 },
    { key: "AST-173", title: "Release candidate", criticality: 0.88 },
    { key: "AST-201", title: "Launch certification", criticality: 0.84 },
  ],
  scenarioCriticalPath: [
    { key: "AST-142", title: "SSO cutover", criticality: 0.72, change: -0.19 },
    { key: "AST-173", title: "Release candidate", criticality: 0.81, change: -0.07 },
    { key: "AST-201", title: "Launch certification", criticality: 0.78, change: -0.06 },
  ],
  sensitivity: [
    { key: "AST-142", label: "SSO cutover duration", score: 0.68 },
    { key: "AST-201", label: "Certification duration", score: 0.41 },
    { key: "AST-173", label: "Release candidate duration", score: 0.36 },
  ],
  warnings: ["Synthetic estimates have no external predictive validity.", "Future review completion time is unknown."],
  resultHash: "sha256:a32067fa34ed4004e0f735895b5aeec501e7faeb58af6d173339c570792a6a52",
  completedAt: FROZEN_NOW,
};

export const REMEDIATION: RemediationPreview = {
  previewId: "80000000-0000-4000-8000-000000000001",
  issueKey: "AST-142",
  summary: "Complete SSO cutover",
  before: { version: 7, dueDate: "2026-08-07", priorityId: "3", priorityName: "Medium", labels: ["identity", "orion"] },
  after: { version: 8, dueDate: "2026-07-31", priorityId: "2", priorityName: "High", labels: ["digital-twin-remediation", "identity", "orion"] },
  payload: {
    action: "jira.issue.update",
    connectorInstallationId: "30000000-0000-4000-8000-000000000001",
    expectedIssueVersion: 7,
    issueKey: "AST-142",
    projectKey: "AST",
    set: { dueDate: "2026-07-31", labels: ["digital-twin-remediation", "identity", "orion"], priorityId: "2" },
    tenantId: "10000000-0000-4000-8000-000000000001",
  },
  payloadHash: "sha256:5162df2bba1ac021a6f0c75f12ec13327b173f02b111efebfaea315803f4c7e0",
  scope: "One issue in the allowlisted synthetic Jira project AST; no comments, assignments, or linked issues change.",
  risks: ["Moves the due date seven calendar days earlier", "Raises priority from Medium to High", "May conflict if Jira version is no longer 7"],
  rollback: "Restore the exact version-7 values only if the post-action snapshot is unchanged.",
  expiresAt: "2026-07-13T16:15:00Z",
};
