import type {
  ActorContext,
  AssetSummary,
  AssetTelemetry,
  AssetTwinSnapshot,
  CitedAnswer,
  ConnectorHealth,
  GraphResult,
  RemediationPreview,
  ScenarioDraft,
  SimulationComparison,
} from "./types";

export const FROZEN_NOW = "2026-07-13T16:00:00Z";

export const ASSETS: AssetSummary[] = [
  {
    assetId: "pump-aster-01",
    name: "Cooling Water Pump P-101",
    assetType: "centrifugal_pump",
    model: "Flowserve Mark 3",
    serialNumber: "P101-AST-2021-0042",
    site: "Aster Pilot Plant · Utility Bay 2",
    status: "running",
    healthScore: 78,
    lifecycleStage: "operation",
    version: 42,
    canControl: true,
  },
];

export const ASSET_TWIN: AssetTwinSnapshot = {
  asset: {
    ...ASSETS[0],
    manufacturer: "Flowserve",
    installedAt: "2021-09-20T14:30:00Z",
    designFlowM3H: 190,
    designHeadM: 52,
    ratedSpeedRpm: 3600,
  },
  components: [
    { componentId: "motor", name: "Drive motor", kind: "motor", status: "normal", description: "250 kW induction motor driving the pump train.", sensorTags: ["P101.SPEED", "P101.MOTOR_TEMP"] },
    { componentId: "coupling", name: "Flexible coupling", kind: "shaft", status: "normal", description: "Guarded flexible coupling between motor and pump shafts.", sensorTags: ["P101.SHAFT_SPEED"] },
    { componentId: "bearing", name: "Drive-end bearing", kind: "bearing", status: "attention", description: "Radial bearing with a rising vibration signature.", sensorTags: ["P101.VIB_DE", "P101.BRG_TEMP"] },
    { componentId: "impeller", name: "Centrifugal impeller", kind: "impeller", status: "normal", description: "Single-stage centrifugal impeller.", sensorTags: ["P101.DISCH_PRESS", "P101.FLOW"] },
    { componentId: "pump", name: "Pump casing", kind: "casing", status: "normal", description: "Single-stage centrifugal volute casing.", sensorTags: ["P101.DISCH_PRESS"] },
    { componentId: "seal", name: "Mechanical seal", kind: "seal", status: "attention", description: "Mechanical seal is approaching its planned synthetic service interval.", sensorTags: ["P101.BRG_TEMP"] },
    { componentId: "inlet", name: "Suction inlet", kind: "inlet", status: "normal", description: "Cooling-water suction connection and isolation valve.", sensorTags: ["P101.SUCT_PRESS"] },
    { componentId: "outlet", name: "Discharge control valve", kind: "valve", status: "normal", description: "Discharge header connection and control valve.", sensorTags: ["P101.DISCH_PRESS"] },
  ],
  predictions: [
    {
      predictionId: "pred-bearing-001",
      componentId: "bearing",
      severity: "warning",
      title: "Bearing wear signature emerging",
      confidence: 0.72,
      horizonHours: 168,
      horizonLabel: "Modeled threshold within 7 days",
      explanation: "Vibration energy at the bearing-pass frequency rose 31% over the last 24 hours while load remained stable.",
      evidence: ["Vibration 4.8 mm/s exceeds the 4.5 mm/s attention threshold", "Bearing temperature trend is +2.1 °C/day", "Flow and speed stayed within ±1.8%"],
      recommendation: "Inspect lubrication and alignment during the next planned maintenance window; do not infer imminent failure from this synthetic signal alone.",
      modelVersion: "pump-anomaly-isolation-forest/1.3.0",
      generatedAt: FROZEN_NOW,
    },
    {
      predictionId: "pred-seal-001",
      componentId: "pump",
      severity: "info",
      title: "Seal condition stable",
      confidence: 0.86,
      horizonHours: 720,
      horizonLabel: "No threshold crossing in 365-day horizon",
      explanation: "Pressure, temperature, and flow residuals remain inside the learned synthetic operating envelope.",
      evidence: ["Discharge pressure residual: 0.08 bar", "Temperature residual: 0.7 °C"],
      recommendation: "Continue routine monitoring.",
      modelVersion: "pump-anomaly-isolation-forest/1.3.0",
      generatedAt: FROZEN_NOW,
    },
  ],
  lifecycle: [
    { eventId: "life-design", stage: "design", status: "complete", date: "2020-11-12", title: "Hydraulic design approved", detail: "Duty point, materials, and NPSH margin approved for cooling-water service.", artifact: "Design package DP-P101-R3" },
    { eventId: "life-manufacture", stage: "manufacture", status: "complete", date: "2021-04-08", title: "Factory acceptance test", detail: "Performance curve and vibration acceptance tests completed.", artifact: "FAT-2021-P101-18" },
    { eventId: "life-commission", stage: "commission", status: "complete", date: "2021-09-20", title: "Commissioned", detail: "Alignment, rotation, interlocks, and baseline sensor readings verified.", artifact: "COM-P101-001" },
    { eventId: "life-service", stage: "operation", status: "current", date: "2021-09-21", title: "Operational service", detail: "Current lifecycle stage · 31,482 synthetic operating hours.", artifact: "CMMS asset P-101" },
    { eventId: "life-maintenance", stage: "maintenance", status: "planned", date: "2026-07-18", title: "Bearing inspection planned", detail: "Inspect lubrication, alignment, and bearing condition against the anomaly evidence.", artifact: "WO-8841" },
    { eventId: "life-decommission", stage: "decommission", status: "planned", date: "2036-09-20", title: "End-of-life review", detail: "Placeholder review; retirement requires a separately approved engineering decision." },
  ],
  control: {
    supportedCommands: ["set_speed_pct", "set_valve_pct", "emergency_stop", "reset"],
    minSpeedPct: 30,
    maxSpeedPct: 100,
    minValvePct: 5,
    maxValvePct: 100,
    state: { version: 42, speedPct: 96, valvePct: 82, emergencyStopped: false, status: "running" },
    mode: "synthetic_sandbox",
  },
  projectionAsOf: FROZEN_NOW,
};

export const ASSET_TELEMETRY: AssetTelemetry = {
  assetId: ASSETS[0].assetId,
  sampledAt: FROZEN_NOW,
  receivedAt: FROZEN_NOW,
  intervalSeconds: 5,
  signals: {
    temperatureC: { label: "Bearing temperature", unit: "°C", status: "normal", valueKind: "observed", warningHigh: 80, criticalHigh: 90 },
    pressureBar: { label: "Discharge pressure", unit: "bar", status: "warning", valueKind: "observed", warningLow: 4.5, criticalLow: 3.5, warningHigh: 8, criticalHigh: 9 },
    vibrationMmS: { label: "Drive-end vibration", unit: "mm/s RMS", status: "warning", valueKind: "observed", warningHigh: 4.5, criticalHigh: 7.1 },
    flowM3H: { label: "Cooling-water flow", unit: "m³/h", status: "normal", valueKind: "derived", warningLow: 57, criticalLow: 48 },
    motorCurrentA: { label: "Motor current", unit: "A", status: "normal", valueKind: "observed", warningHigh: 52, criticalHigh: 60 },
    speedRpm: { label: "Shaft speed", unit: "rpm", status: "warning", valueKind: "observed", warningHigh: 3400, criticalHigh: 3600 },
  },
  points: Array.from({ length: 30 }, (_, index) => {
    const progress = index / 29;
    return {
      timestamp: new Date(new Date(FROZEN_NOW).getTime() - (29 - index) * 5_000).toISOString(),
      temperatureC: Number((71.8 + progress * 2.4 + Math.sin(index * 0.62) * 0.32).toFixed(2)),
      pressureBar: Number((8.38 + Math.sin(index * 0.45) * 0.09).toFixed(2)),
      vibrationMmS: Number((3.52 + progress * 1.28 + Math.sin(index * 0.73) * 0.16).toFixed(2)),
      flowM3H: Number((184.4 + Math.sin(index * 0.38) * 2.1).toFixed(1)),
      motorCurrentA: Number((43.1 + progress * 1.2 + Math.sin(index * 0.53) * 0.28).toFixed(2)),
      speedRpm: Math.round(3475 + Math.sin(index * 0.31) * 14),
    };
  }),
};

export const BEACON_ASSETS: AssetSummary[] = [{
  assetId: "pump-beacon-07",
  name: "Process Water Pump B-07",
  assetType: "centrifugal_pump",
  model: "HM-Aqua-250",
  serialNumber: "BCN-B07-2023-0119",
  site: "Beacon Harbor Works · Process Utility Bay",
  status: "running",
  healthScore: 96,
  lifecycleStage: "operation",
  version: 3,
  canControl: false,
}];

export const BEACON_ASSET_TWIN: AssetTwinSnapshot = {
  asset: {
    ...BEACON_ASSETS[0],
    manufacturer: "Harbor Motion Systems",
    installedAt: "2023-09-01T13:00:00Z",
    designFlowM3H: 72,
    designHeadM: 36,
    ratedSpeedRpm: 3600,
  },
  components: [
    { componentId: "b07-motor", name: "Induction motor", kind: "motor", status: "normal", description: "Healthy synthetic drive motor with stable current and speed.", sensorTags: ["B07.MOTOR", "B07.SPEED"] },
    { componentId: "b07-shaft", name: "Drive shaft", kind: "shaft", status: "normal", description: "Synthetic shaft and coupling assembly.", sensorTags: ["B07.SPEED"] },
    { componentId: "b07-bearing", name: "Drive-end bearing", kind: "bearing", status: "normal", description: "Bearing telemetry remains inside the synthetic operating envelope.", sensorTags: ["B07.VIB", "B07.TEMP"] },
    { componentId: "b07-impeller", name: "Centrifugal impeller", kind: "impeller", status: "normal", description: "Process-water pump impeller.", sensorTags: ["B07.FLOW"] },
    { componentId: "b07-casing", name: "Volute casing", kind: "casing", status: "normal", description: "Process-water pump casing.", sensorTags: ["B07.PRESS"] },
    { componentId: "b07-seal", name: "Mechanical seal", kind: "seal", status: "normal", description: "Mechanical seal remains inside its service interval.", sensorTags: ["B07.TEMP"] },
    { componentId: "b07-valve", name: "Discharge control valve", kind: "valve", status: "normal", description: "Read-only simulated discharge valve.", sensorTags: ["B07.FLOW"] },
  ],
  predictions: [{
    predictionId: "b07-prediction-stable",
    componentId: "b07-bearing",
    severity: "info",
    title: "No failure threshold forecast",
    confidence: 0.91,
    horizonHours: 8760,
    horizonLabel: "No threshold crossing in 365-day horizon",
    explanation: "The deterministic synthetic vibration trend remains below the demonstration threshold.",
    evidence: ["Vibration trend is stable", "Temperature residual remains within 0.4 °C"],
    recommendation: "Continue routine synthetic condition monitoring.",
    modelVersion: "pump-anomaly-isolation-forest/1.3.0",
    generatedAt: FROZEN_NOW,
  }],
  lifecycle: [
    { eventId: "b07-design", stage: "design", status: "complete", date: "2023-01-20", title: "Design complete", detail: "Process-water duty point approved.", artifact: "BCN-DESIGN-PUMP-01" },
    { eventId: "b07-manufacture", stage: "manufacture", status: "complete", date: "2023-06-18", title: "Factory test complete", detail: "Synthetic factory acceptance completed.", artifact: "BCN-MFG-CERT-01" },
    { eventId: "b07-commission", stage: "commission", status: "complete", date: "2023-09-01", title: "Commissioned", detail: "Baseline checks completed.", artifact: "BCN-COMMISSION-01" },
    { eventId: "b07-service", stage: "operation", status: "current", date: "2023-09-01", title: "Operational service", detail: "Current read-only lifecycle stage.", artifact: "BCN-OPS-LEDGER-01" },
    { eventId: "b07-maintenance", stage: "maintenance", status: "planned", date: "2026-08-21", title: "Routine inspection", detail: "Planned condition-monitoring review.", artifact: "BCN-WO-2026-117" },
    { eventId: "b07-decommission", stage: "decommission", status: "planned", date: "2043-09-01", title: "End-of-life review", detail: "Notional lifecycle planning milestone.", artifact: "BCN-LIFECYCLE-PLAN-01" },
  ],
  control: {
    supportedCommands: ["set_speed_pct", "set_valve_pct", "emergency_stop", "reset"],
    minSpeedPct: 30,
    maxSpeedPct: 100,
    minValvePct: 5,
    maxValvePct: 100,
    state: { version: 3, speedPct: 74, valvePct: 72, emergencyStopped: false, status: "running" },
    mode: "synthetic_sandbox",
  },
  projectionAsOf: FROZEN_NOW,
};

export const BEACON_ASSET_TELEMETRY: AssetTelemetry = {
  assetId: BEACON_ASSETS[0].assetId,
  sampledAt: FROZEN_NOW,
  receivedAt: FROZEN_NOW,
  intervalSeconds: 5,
  signals: {
    temperatureC: { label: "Bearing temperature", unit: "°C", status: "normal", valueKind: "observed", warningHigh: 80, criticalHigh: 90 },
    pressureBar: { label: "Discharge pressure", unit: "bar", status: "normal", valueKind: "observed", warningLow: 4.5, criticalLow: 3.5, warningHigh: 8, criticalHigh: 9 },
    vibrationMmS: { label: "Drive-end vibration", unit: "mm/s RMS", status: "normal", valueKind: "observed", warningHigh: 4.5, criticalHigh: 7.1 },
    flowM3H: { label: "Process flow", unit: "m³/h", status: "normal", valueKind: "derived", warningLow: 57, criticalLow: 48 },
    motorCurrentA: { label: "Motor current", unit: "A", status: "normal", valueKind: "observed", warningHigh: 52, criticalHigh: 60 },
    speedRpm: { label: "Motor speed", unit: "rpm", status: "normal", valueKind: "observed", warningHigh: 3400, criticalHigh: 3600 },
  },
  points: ASSET_TELEMETRY.points.map((point, index) => ({
    ...point,
    temperatureC: Number((61.2 + Math.sin(index * 0.42) * 0.18).toFixed(2)),
    pressureBar: Number((6.15 + Math.sin(index * 0.35) * 0.04).toFixed(2)),
    vibrationMmS: Number((1.42 + Math.sin(index * 0.51) * 0.06).toFixed(2)),
    flowM3H: Number((70.8 + Math.sin(index * 0.38) * 0.5).toFixed(2)),
    motorCurrentA: Number((34.5 + Math.sin(index * 0.41) * 0.22).toFixed(2)),
    speedRpm: Math.round(2664 + Math.sin(index * 0.31) * 3),
  })),
};

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
      capabilities: ["graph:read", "questions:ask", "scenario:write", "action:propose", "asset:read", "asset:control.preview", "asset:control.execute"],
    },
    {
      membershipId: "mem_beacon_observer",
      tenantAlias: "tnt_beacon",
      tenantName: "Beacon Works",
      role: "Read-only observer",
      capabilities: ["graph:read", "questions:ask", "asset:read"],
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
