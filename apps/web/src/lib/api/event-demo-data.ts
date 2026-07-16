import type { EventInterpretation, EventIntent, EventScenarioBranch, EventTimelineEntry } from "./types";
import { FROZEN_NOW } from "./demo-data";

const clone = <T,>(value: T): T => structuredClone(value);

const PEOPLE_EVENT: EventInterpretation = {
  previewId: "event-preview-sarah-departure-v1",
  eventId: "evt-sarah-departure-20260714",
  input: "Sarah, the lead backend engineer, left the company today.",
  title: "Lead backend engineer departure",
  eventType: "person.employment.departed",
  category: "people",
  occurredAt: "2026-07-14T09:00:00-04:00",
  location: null,
  source: "Manual report by Maya Chen",
  confidence: 0.93,
  confidenceLevel: "confirmed",
  verificationStatus: "unverified",
  processingMode: "reality_review",
  modeReason: "The statement is phrased as an event that occurred, but it has only one unverified manual source.",
  entityResolutions: [
    {
      mention: "Sarah, the lead backend engineer",
      requiredConfirmation: true,
      candidates: [
        { entityId: "person-sarah-kim", label: "Sarah Kim", entityType: "Person", confidence: 0.94, reason: "Current lead backend engineer on the Payment Platform; exact first name and role match.", selected: false },
        { entityId: "person-sarah-ibrahim", label: "Sarah Ibrahim", entityType: "Person", confidence: 0.42, reason: "Name match, but listed as a data engineering contractor on Atlas.", selected: false },
      ],
    },
    {
      mention: "the company",
      requiredConfirmation: false,
      candidates: [
        { entityId: "org-aster-labs", label: "Aster Labs", entityType: "Organization", confidence: 1, reason: "Derived from the active tenant context, not from the event text.", selected: true },
      ],
    },
  ],
  nodes: [
    { nodeId: "event", label: "Sarah departure", kind: "event", effectOrder: "event", severity: "info", confidence: 0.78, timeHorizon: "Reported today", change: "Candidate reality event", explanation: "A user reported that the matched employee left Aster Labs today.", evidence: ["Manual report only; employment system verification is not present."] },
    { nodeId: "person", label: "Sarah Kim", kind: "person", effectOrder: "direct", severity: "high", confidence: 0.94, timeHorizon: "Immediate", change: "Active → Departed", explanation: "The selected person node would receive an employment end date and departed state.", evidence: ["94% entity match from name and role", "Human confirmation required"] },
    { nodeId: "ownership", label: "Authentication Service", kind: "relationship", effectOrder: "direct", severity: "high", confidence: 0.91, timeHorizon: "Immediate", change: "OWNS removed; NEEDS_OWNER proposed", explanation: "Current graph evidence assigns Sarah as the primary service owner. Removing the employment relationship leaves no confirmed replacement.", evidence: ["OWNS edge in projection v1842", "No secondary owner recorded"] },
    { nodeId: "access", label: "Source permissions", kind: "process", effectOrder: "direct", severity: "critical", confidence: 0.88, timeHorizon: "Within 4 hours", change: "Revocation workflow recommended", explanation: "Offboarding normally requires credential and source-access revocation, but this preview does not call an identity provider.", evidence: ["Offboarding control CTRL-IAM-07", "No live identity-system confirmation"] },
    { nodeId: "delivery", label: "Payment Platform delivery", kind: "risk", effectOrder: "second", severity: "high", confidence: 0.73, timeHorizon: "Next 30 days", change: "Risk 30% → 65%", explanation: "Three open work items depend on the ownerless service and have no recorded technical delegate.", evidence: ["3 open dependency edges", "Ownership gap", "Estimate is conditional, not observed fact"] },
    { nodeId: "knowledge", label: "Knowledge continuity", kind: "risk", effectOrder: "second", severity: "medium", confidence: 0.69, timeHorizon: "Next 14 days", change: "Continuity risk increases", explanation: "Documentation remains available, but 240 pages have no confirmed maintainer after the proposed ownership change.", evidence: ["240 authored pages", "Authorship does not imply unique knowledge"] },
    { nodeId: "forecast", label: "Orion launch forecast", kind: "prediction", effectOrder: "third", severity: "high", confidence: 0.61, timeHorizon: "Next 60 days", change: "p80 Aug 24 → Sep 7", explanation: "A bounded scenario run propagates the ownership gap through recorded delivery dependencies.", evidence: ["Seeded scenario branch", "Model-fit confidence 61%", "No individual productivity inference"] },
    { nodeId: "mitigation", label: "Interim service owner", kind: "recommendation", effectOrder: "long_term", severity: "medium", confidence: 0.76, timeHorizon: "Within 7 days", change: "Assign qualified interim owner", explanation: "Confirm an accountable owner and handoff plan before changing the source-of-truth relationship.", evidence: ["Reduces a single-owner dependency", "Requires engineering approval"] },
    { nodeId: "unknown", label: "Unrecorded responsibilities", kind: "unknown", effectOrder: "unknown", severity: "unknown", confidence: null, timeHorizon: "Unknown", change: "Impact cannot be quantified", explanation: "Informal support, tacit knowledge, and untracked systems may exist outside the authorized graph.", evidence: ["Absence of graph evidence is not evidence of absence"] },
  ],
  edges: [
    { edgeId: "edge-event-person", fromNodeId: "event", toNodeId: "person", relation: "changes state", effectOrder: "direct", confidence: 0.78, explanation: "The reported departure would change the matched employee state after review.", evidence: ["Manual report"] },
    { edgeId: "edge-person-ownership", fromNodeId: "person", toNodeId: "ownership", relation: "removes ownership", effectOrder: "direct", confidence: 0.91, explanation: "The current OWNS relationship cannot remain active for a departed identity.", evidence: ["Current OWNS edge"] },
    { edgeId: "edge-person-access", fromNodeId: "person", toNodeId: "access", relation: "triggers review", effectOrder: "direct", confidence: 0.88, explanation: "A departure should initiate, but does not itself prove completion of, access revocation.", evidence: ["Offboarding policy"] },
    { edgeId: "edge-ownership-delivery", fromNodeId: "ownership", toNodeId: "delivery", relation: "raises risk", effectOrder: "second", confidence: 0.73, explanation: "The recorded dependency path has no replacement owner.", evidence: ["3 open work dependencies"] },
    { edgeId: "edge-person-knowledge", fromNodeId: "person", toNodeId: "knowledge", relation: "creates gap", effectOrder: "second", confidence: 0.69, explanation: "Maintainer coverage becomes ambiguous, while the documents themselves remain intact.", evidence: ["Documentation authorship projection"] },
    { edgeId: "edge-delivery-forecast", fromNodeId: "delivery", toNodeId: "forecast", relation: "shifts forecast", effectOrder: "third", confidence: 0.61, explanation: "The risk delta is used as a conditional scenario input, not a causal fact.", evidence: ["Seeded simulation result"] },
    { edgeId: "edge-delivery-mitigation", fromNodeId: "delivery", toNodeId: "mitigation", relation: "motivates", effectOrder: "long_term", confidence: 0.76, explanation: "Restoring accountable ownership is the least expansive recorded mitigation.", evidence: ["Ownership policy"] },
    { edgeId: "edge-person-unknown", fromNodeId: "person", toNodeId: "unknown", relation: "may affect", effectOrder: "unknown", confidence: null, explanation: "The graph cannot enumerate responsibilities that were never recorded.", evidence: [] },
  ],
  stateDeltas: [
    { deltaId: "delta-employment", subject: "Sarah Kim", field: "employment_status", before: "Active", after: "Departed", operation: "update", confidence: 0.78 },
    { deltaId: "delta-end-date", subject: "Sarah Kim", field: "employment_end_date", before: "Not set", after: "July 14, 2026", operation: "update", confidence: 0.78 },
    { deltaId: "delta-ownership", subject: "Authentication Service", field: "OWNS", before: "Sarah Kim", after: "NEEDS_OWNER: Lead backend engineer", operation: "update", confidence: 0.91 },
    { deltaId: "delta-access", subject: "Sarah Kim", field: "source_access", before: "Active", after: "Revocation review queued", operation: "uncertain", confidence: 0.88 },
  ],
  riskDeltas: [
    { deltaId: "risk-delivery", label: "Payment Platform delivery risk", kind: "risk", before: "30%", after: "65%", direction: "increase", confidence: 0.73, explanation: "Conditional estimate from the recorded owner and dependency graph." },
    { deltaId: "prediction-launch", label: "Orion launch p80", kind: "prediction", before: "Aug 24, 2026", after: "Sep 7, 2026", direction: "changed", confidence: 0.61, explanation: "Seeded scenario output; it is not a guaranteed delivery date." },
    { deltaId: "risk-knowledge", label: "Knowledge continuity", kind: "risk", before: "Monitored", after: "Elevated", direction: "increase", confidence: 0.69, explanation: "Authorship and ownership evidence identify a gap but cannot measure tacit knowledge." },
  ],
  recommendations: [
    { recommendationId: "rec-verify", title: "Verify the departure", rationale: "Confirm the effective date and status in the authoritative people system before changing reality.", urgency: "now", owner: "People operations" },
    { recommendationId: "rec-owner", title: "Nominate an interim service owner", rationale: "Restore accountable Authentication Service coverage without assuming who is qualified.", urgency: "next_7_days", owner: "Platform engineering" },
    { recommendationId: "rec-handoff", title: "Inventory ownership and access", rationale: "Review recorded and unrecorded responsibilities, then validate access revocation separately.", urgency: "next_7_days", owner: "Security + engineering" },
  ],
  assumptions: ["Sarah Kim is the person referenced", "Today means July 14, 2026 in the active tenant timezone", "Current ownership edges are complete enough for bounded impact analysis"],
  unknowns: ["Authoritative employment-system status", "Replacement owner", "Informal or unrecorded responsibilities", "Whether access has already been revoked"],
  warnings: ["Manual event text is untrusted input and was not executed as instructions.", "Predicted effects are conditional estimates, not verified causal facts.", "No external identity, HR, Jira, GitHub, PLC, or customer system will be changed."],
  evidence: ["Manual event statement", "Authorized graph projection v1842", "Synthetic offboarding policy CTRL-IAM-07", "Seeded scenario engine pert-mt19937-beta/2.0.0"],
  model: { provider: "Deterministic synthetic rules", version: "event-extractor-rules/1.0.0", generativeModelUsed: false },
  graphSnapshotVersion: 1842,
  graphSnapshotHash: "sha256:4d79b612a401ea398b2e320e766594a92c0f57a5810cddbe1c7b99ff0ea89617",
  digest: "sha256:7b58cf473b673a6f965639aa51f44c1e220bd3146632de3adbfd82717f06c88f",
  etag: "\"event-preview-sarah-v1\"",
  expiresAt: "2026-07-14T16:15:00Z",
  canApplyToTwin: true,
  externalWrite: false,
};

export const EVENT_TIMELINE: EventTimelineEntry[] = [
  { timelineEntryId: "timeline-outage-applied", eventId: "evt-outage-20260711", title: "Identity database outage resolved", eventType: "technology.database.outage", occurredAt: "2026-07-11T14:05:00Z", recordedAt: "2026-07-11T17:18:00Z", status: "applied", confidenceLevel: "confirmed", confidence: 1, effectCount: 6, graphVersionBefore: 1840, graphVersionAfter: 1841, rollbackAvailable: true, receiptId: "event-receipt-outage", summary: "Three-hour synthetic outage and recovery recorded with service and SLA impacts." },
  { timelineEntryId: "timeline-regulation-scenario", eventId: "evt-regulation-20260708", title: "Draft regional AI regulation", eventType: "external.regulation.proposed", occurredAt: "2026-07-08T10:00:00Z", recordedAt: "2026-07-08T10:14:00Z", status: "scenario", confidenceLevel: "possible", confidence: 0.66, effectCount: 9, graphVersionBefore: 1840, graphVersionAfter: 1840, rollbackAvailable: false, receiptId: "event-receipt-regulation", summary: "Unconfirmed external proposal remains isolated in scenario branch evt-regulation." },
  { timelineEntryId: "timeline-reorg-rollback", eventId: "evt-reorg-20260702", title: "Identity team reporting-line correction", eventType: "people.manager.changed", occurredAt: "2026-07-02T13:00:00Z", recordedAt: "2026-07-02T13:41:00Z", status: "rolled_back", confidenceLevel: "rejected", confidence: 0.18, effectCount: 0, graphVersionBefore: 1838, graphVersionAfter: 1839, rollbackAvailable: false, receiptId: "event-receipt-reorg-rollback", summary: "Conflicting source evidence caused the proposed mutation to be reversed." },
];

export const EVENT_BRANCHES: EventScenarioBranch[] = [
  {
    branchId: "branch-aster-baseline",
    name: "Aster Labs reality",
    createdAt: "2026-07-01T00:00:00Z",
    mode: "baseline",
    status: "active",
    eventIds: ["evt-outage-20260711"],
    baseGraphVersion: 1838,
    baseGraphHash: "sha256:c3af8f31a00f9fe4e4ead380503f38fd2c8a726dc41d9f21bf24b1e66237840f",
    stateHash: "sha256:4d79b612a401ea398b2e320e766594a92c0f57a5810cddbe1c7b99ff0ea89617",
  },
  {
    branchId: "branch-regulation-scenario",
    name: "Draft regional AI regulation",
    parentBranchId: "branch-aster-baseline",
    createdByEventId: "evt-regulation-20260708",
    createdAt: "2026-07-08T10:14:00Z",
    mode: "scenario",
    status: "active",
    eventIds: ["evt-regulation-20260708"],
    baseGraphVersion: 1840,
    baseGraphHash: "sha256:edac530499530df1c64f8fc9379aa404892d56a954b63f629cc819160185e549",
    stateHash: "sha256:a507d1f188f52344327bfc0d8c2ce2720ef86183499021616a71c22b89db8db8",
  },
];

export function buildDemoEventInterpretation(input: string, intent: EventIntent): EventInterpretation {
  const result = clone(PEOPLE_EVENT);
  result.input = input.trim();
  const normalized = result.input.toLowerCase();
  const hypothetical = intent === "scenario" || (intent === "auto" && /\b(what if|might|may|could|possibly|potential)\b/.test(normalized));

  if (/\b(ignore|disregard)\b.{0,60}\b(previous|system|developer|instructions?)\b|\b(drop database|delete all|grant admin|bypass approval|disable audit)\b/i.test(result.input)) {
    applyQuarantinedDemo(result);
    return result;
  }

  if (/\b(database|aws|outage)\b/.test(normalized)) {
    applyDatabaseDemo(result, hypothetical);
  } else if (/\b(customer|contract|client)\b/.test(normalized)) {
    applyCustomerDemo(result);
  }

  if (hypothetical) {
    result.processingMode = "scenario_only";
    result.modeReason = "Conditional or uncertain language was detected, so the event is isolated from the reality graph.";
    result.confidence = 0.65;
    result.confidenceLevel = "possible";
    result.verificationStatus = "unverified";
    result.canApplyToTwin = false;
  } else if (intent === "reality") {
    result.modeReason = "The user explicitly requested reality review; human verification and entity confirmation still gate any twin mutation.";
  }
  return result;
}

function applyQuarantinedDemo(result: EventInterpretation) {
  result.previewId = "event-preview-quarantined-v1";
  result.eventId = "evt-quarantined-input-20260714";
  result.title = "Instruction-like input quarantined";
  result.eventType = "unknown.untrusted_input";
  result.category = "unknown";
  result.confidence = 0;
  result.confidenceLevel = "rejected";
  result.verificationStatus = "disputed";
  result.processingMode = "rejected";
  result.modeReason = "The input contains instruction-like content that is not eligible for extraction, graph mutation, or scenario execution.";
  result.entityResolutions = [];
  result.nodes = [
    { nodeId: "event", label: "Quarantined input", kind: "event", effectOrder: "event", severity: "critical", confidence: 0, timeHorizon: "Immediate", change: "No event created", explanation: "The statement remains audit data and was not treated as instructions.", evidence: ["Deterministic prompt-injection pattern"] },
    { nodeId: "unknown", label: "Underlying factual claim", kind: "unknown", effectOrder: "unknown", severity: "unknown", confidence: null, timeHorizon: "Unknown", change: "Not analyzed", explanation: "Remove instruction-like content and submit a plain factual description for a new review.", evidence: [] },
  ];
  result.edges = [{ edgeId: "edge-quarantine", fromNodeId: "event", toNodeId: "unknown", relation: "prevents analysis", effectOrder: "unknown", confidence: 1, explanation: "Quarantine stops propagation before entity resolution or tools.", evidence: ["Input safety policy"] }];
  result.stateDeltas = [];
  result.riskDeltas = [];
  result.recommendations = [{ recommendationId: "rec-rephrase", title: "Rephrase as a factual event report", rationale: "Remove commands, secrets, and attempts to alter system behavior.", urgency: "now", owner: "Reporter" }];
  result.assumptions = [];
  result.unknowns = ["Whether the text contains a legitimate underlying event"];
  result.warnings = ["Potential prompt injection detected.", "No entity resolution, graph mutation, scenario, tool call, or external write was performed."];
  result.evidence = ["Untrusted manual input safety scan"];
  result.digest = "sha256:9fe7c094653652cbe63abfdd47d2af22a4896e1d8473743394111ab5a3dcb725";
  result.canApplyToTwin = false;
}

function applyCustomerDemo(result: EventInterpretation) {
  result.previewId = "event-preview-customer-risk-v1";
  result.eventId = "evt-customer-risk-20260714";
  result.digest = "sha256:46a1cbf15baa8b1c9af8e18806d38285c5b2374eaa253dbf4cbe4aa9ea6e73ee";
  result.title = "Potential strategic customer loss";
  result.eventType = "business.customer.at_risk";
  result.category = "business";
  result.entityResolutions = [{ mention: "our biggest customer", requiredConfirmation: true, candidates: [
    { entityId: "customer-northstar", label: "Northstar Bank", entityType: "Customer", confidence: 0.89, reason: "Largest active account by synthetic annual contract value; phrase match is contextual, not exact.", selected: false },
    { entityId: "customer-apex", label: "Apex Retail", entityType: "Customer", confidence: 0.38, reason: "Second-largest account; no direct phrase match.", selected: false },
  ] }];
  result.nodes = [
    { nodeId: "event", label: "Customer may leave", kind: "event", effectOrder: "event", severity: "info", confidence: 0.65, timeHorizon: "Potential future", change: "Scenario candidate", explanation: "The statement expresses a possible loss, not an observed customer departure.", evidence: ["Manual statement with uncertainty language"] },
    { nodeId: "customer", label: "Northstar Bank", kind: "relationship", effectOrder: "direct", severity: "high", confidence: 0.89, timeHorizon: "Immediate review", change: "Healthy → At risk (scenario)", explanation: "The selected customer is a contextual match that still requires human confirmation.", evidence: ["Largest synthetic account", "No CRM churn event"] },
    { nodeId: "renewal", label: "Renewal workflow", kind: "process", effectOrder: "direct", severity: "high", confidence: 0.72, timeHorizon: "Next 30 days", change: "Escalation proposed", explanation: "An at-risk account may require an owned executive and success-plan review.", evidence: ["Renewal in 84 days", "No confirmed cancellation"] },
    { nodeId: "revenue", label: "Revenue forecast", kind: "prediction", effectOrder: "second", severity: "high", confidence: 0.58, timeHorizon: "Next quarter", change: "Baseline → Conditional -12%", explanation: "The scenario removes the synthetic renewal value; it does not predict that the customer will actually leave.", evidence: ["Synthetic contract value", "Conditional branch only"] },
    { nodeId: "roadmap", label: "Payment roadmap", kind: "risk", effectOrder: "second", severity: "medium", confidence: 0.54, timeHorizon: "Next 60 days", change: "Priority assumptions may change", explanation: "Two roadmap items are linked to Northstar requirements, but a loss would not automatically cancel them.", evidence: ["2 customer-requirement links"] },
    { nodeId: "portfolio", label: "Portfolio plan", kind: "prediction", effectOrder: "third", severity: "medium", confidence: 0.43, timeHorizon: "Next 2 quarters", change: "Investment mix uncertain", explanation: "Downstream planning effects depend on leadership choices that the graph cannot infer.", evidence: ["Confidence below 50%", "Decision-dependent"] },
    { nodeId: "engage", label: "Validate customer concern", kind: "recommendation", effectOrder: "long_term", severity: "medium", confidence: 0.84, timeHorizon: "Within 7 days", change: "Human outreach recommended", explanation: "Verify the concern with the account owner before treating the scenario as reality.", evidence: ["Least-expansive mitigation"] },
    { nodeId: "unknown", label: "Customer decision drivers", kind: "unknown", effectOrder: "unknown", severity: "unknown", confidence: null, timeHorizon: "Unknown", change: "Not represented", explanation: "The twin does not know private customer deliberations, competitive offers, or unrecorded concerns.", evidence: [] },
  ];
  result.edges = [
    { edgeId: "edge-event-customer", fromNodeId: "event", toNodeId: "customer", relation: "may change", effectOrder: "direct", confidence: 0.65, explanation: "Uncertain language creates a scenario state, not a customer-status fact.", evidence: ["Manual statement"] },
    { edgeId: "edge-customer-renewal", fromNodeId: "customer", toNodeId: "renewal", relation: "triggers review", effectOrder: "direct", confidence: 0.72, explanation: "An at-risk scenario warrants review of the upcoming renewal.", evidence: ["Renewal in 84 days"] },
    { edgeId: "edge-customer-revenue", fromNodeId: "customer", toNodeId: "revenue", relation: "changes scenario", effectOrder: "second", confidence: 0.58, explanation: "The conditional forecast excludes the renewal value.", evidence: ["Synthetic contract value"] },
    { edgeId: "edge-customer-roadmap", fromNodeId: "customer", toNodeId: "roadmap", relation: "may affect", effectOrder: "second", confidence: 0.54, explanation: "Customer-linked requirements may be reprioritized after a separate decision.", evidence: ["2 requirement links"] },
    { edgeId: "edge-revenue-portfolio", fromNodeId: "revenue", toNodeId: "portfolio", relation: "may influence", effectOrder: "third", confidence: 0.43, explanation: "Leadership might alter the portfolio; this is not automatic causation.", evidence: [] },
    { edgeId: "edge-customer-engage", fromNodeId: "customer", toNodeId: "engage", relation: "motivates", effectOrder: "long_term", confidence: 0.84, explanation: "Primary verification is the safest next step.", evidence: ["Scenario governance policy"] },
    { edgeId: "edge-customer-unknown", fromNodeId: "customer", toNodeId: "unknown", relation: "may depend on", effectOrder: "unknown", confidence: null, explanation: "Unobserved decision drivers cannot be modeled.", evidence: [] },
  ];
  result.stateDeltas = [
    { deltaId: "delta-customer-health", subject: "Northstar Bank", field: "relationship_health", before: "Healthy", after: "At risk (scenario only)", operation: "uncertain", confidence: 0.65 },
    { deltaId: "delta-renewal", subject: "Northstar renewal", field: "workflow_state", before: "Planned", after: "Escalation proposed", operation: "uncertain", confidence: 0.72 },
  ];
  result.riskDeltas = [
    { deltaId: "risk-retention", label: "Northstar retention risk", kind: "risk", before: "20%", after: "55%", direction: "increase", confidence: 0.58, explanation: "User-defined conditional scenario; not a churn probability." },
    { deltaId: "prediction-revenue", label: "Next-quarter revenue scenario", kind: "prediction", before: "Baseline", after: "-12% if renewal is removed", direction: "decrease", confidence: 0.58, explanation: "Arithmetic scenario delta from synthetic contract value, not a revenue forecast claim." },
  ];
  result.recommendations = [
    { recommendationId: "rec-customer-verify", title: "Validate the concern with the account owner", rationale: "Confirm source evidence before changing customer reality state.", urgency: "now", owner: "Customer success" },
    { recommendationId: "rec-customer-plan", title: "Draft a bounded retention scenario", rationale: "Compare an intervention without assuming customer intent or writing to CRM.", urgency: "next_7_days", owner: "Account team" },
  ];
  result.assumptions = ["Northstar Bank is the referenced customer", "The scenario removes only the recorded renewal value", "Customer-linked roadmap items remain independently reviewable"];
  result.unknowns = ["Whether the customer is actually considering departure", "Decision drivers and competitor offers", "Leadership response to any revenue change"];
}

function applyDatabaseDemo(result: EventInterpretation, hypothetical: boolean) {
  result.previewId = "event-preview-database-outage-v1";
  result.eventId = "evt-database-outage-20260713";
  result.digest = "sha256:ab81cb052f5149b3e0c2af0a8e240def5d923ca4434cd7f8bc6f31d32fd5ea0";
  result.title = "Database service outage";
  result.eventType = "technology.database.outage";
  result.category = "technology";
  result.entityResolutions = [{ mention: "our AWS database", requiredConfirmation: true, candidates: [
    { entityId: "database-identity-prod", label: "Identity Production Database", entityType: "Database", confidence: 0.91, reason: "Only AWS-hosted production database in the authorized graph; phrase remains ambiguous.", selected: false },
    { entityId: "database-analytics-prod", label: "Analytics Warehouse", entityType: "Database", confidence: 0.47, reason: "AWS-hosted database, but no application-role match in the statement.", selected: false },
  ] }];
  result.nodes = [
    { nodeId: "event", label: "3-hour database outage", kind: "event", effectOrder: "event", severity: "high", confidence: 0.93, timeHorizon: "Yesterday", change: hypothetical ? "Potential outage" : "Reported outage", explanation: "The duration is extracted from the statement; recovery and incident evidence remain unverified.", evidence: ["Manual statement"] },
    { nodeId: "database", label: "Identity Production Database", kind: "system", effectOrder: "direct", severity: "critical", confidence: 0.91, timeHorizon: "Immediate", change: "Available → Unavailable for 3 hours", explanation: "The selected database is the strongest authorized entity match.", evidence: ["91% contextual match", "Human confirmation required"] },
    { nodeId: "applications", label: "Dependent applications", kind: "system", effectOrder: "direct", severity: "high", confidence: 0.86, timeHorizon: "During outage", change: "Availability degraded", explanation: "Three applications have direct runtime dependencies on the database.", evidence: ["3 direct DEPENDS_ON relationships"] },
    { nodeId: "sla", label: "Customer SLA exposure", kind: "risk", effectOrder: "second", severity: "high", confidence: 0.74, timeHorizon: "Next 7 days", change: "Breach review required", explanation: "A three-hour outage overlaps the synthetic monthly availability threshold, but customer-impact evidence is incomplete.", evidence: ["Synthetic SLA threshold", "Customer traffic not verified"] },
    { nodeId: "recovery", label: "Recovery workflow", kind: "process", effectOrder: "second", severity: "medium", confidence: 0.82, timeHorizon: "Within 24 hours", change: "Incident review proposed", explanation: "Validate recovery time, cause, and data integrity before closing the event.", evidence: ["Incident response control"] },
    { nodeId: "renewal-risk", label: "Renewal risk", kind: "prediction", effectOrder: "third", severity: "medium", confidence: 0.38, timeHorizon: "Next quarter", change: "Direction uncertain", explanation: "The graph lacks customer-impact and sentiment evidence, so commercial impact cannot be supported.", evidence: ["Low-confidence downstream effect"] },
    { nodeId: "unknown", label: "Data integrity impact", kind: "unknown", effectOrder: "unknown", severity: "unknown", confidence: null, timeHorizon: "Unknown", change: "Not verified", explanation: "Availability loss does not prove data loss or corruption.", evidence: [] },
  ];
  result.edges = [
    { edgeId: "edge-event-db", fromNodeId: "event", toNodeId: "database", relation: "changes availability", effectOrder: "direct", confidence: 0.91, explanation: "The report maps to the selected database after confirmation.", evidence: ["Manual statement"] },
    { edgeId: "edge-db-apps", fromNodeId: "database", toNodeId: "applications", relation: "degrades", effectOrder: "direct", confidence: 0.86, explanation: "Direct runtime dependencies propagate database unavailability.", evidence: ["3 dependency edges"] },
    { edgeId: "edge-apps-sla", fromNodeId: "applications", toNodeId: "sla", relation: "may expose", effectOrder: "second", confidence: 0.74, explanation: "Customer-facing degradation may affect the SLA calculation.", evidence: ["Impact verification missing"] },
    { edgeId: "edge-db-recovery", fromNodeId: "database", toNodeId: "recovery", relation: "triggers review", effectOrder: "second", confidence: 0.82, explanation: "Incident controls call for a recovery review.", evidence: ["Incident policy"] },
    { edgeId: "edge-sla-renewal", fromNodeId: "sla", toNodeId: "renewal-risk", relation: "may influence", effectOrder: "third", confidence: 0.38, explanation: "Commercial impact is too weakly evidenced to represent as fact.", evidence: [] },
    { edgeId: "edge-db-unknown", fromNodeId: "database", toNodeId: "unknown", relation: "may affect", effectOrder: "unknown", confidence: null, explanation: "Data integrity must be checked independently.", evidence: [] },
  ];
  result.stateDeltas = [
    { deltaId: "delta-db-availability", subject: "Identity Production Database", field: "availability_state", before: "Available", after: "Reported unavailable for 3 hours", operation: "update", confidence: 0.91 },
    { deltaId: "delta-incident", subject: "Database incident workflow", field: "status", before: "Not opened", after: "Review proposed", operation: "create", confidence: 0.82 },
  ];
  result.riskDeltas = [
    { deltaId: "risk-sla", label: "Monthly SLA exposure", kind: "risk", before: "Within target", after: "Review required", direction: "increase", confidence: 0.74, explanation: "Conditional on verified customer-facing downtime." },
    { deltaId: "prediction-renewal", label: "Customer renewal effect", kind: "prediction", before: "No supported change", after: "Unknown", direction: "unknown", confidence: 0.38, explanation: "Insufficient customer-impact evidence; no commercial prediction is claimed." },
  ];
  result.recommendations = [
    { recommendationId: "rec-outage-verify", title: "Verify incident scope and recovery", rationale: "Confirm the database, duration, recovery state, and data integrity from primary telemetry.", urgency: "now", owner: "Site reliability" },
    { recommendationId: "rec-outage-review", title: "Run the bounded dependency review", rationale: "Inspect direct application and SLA links without unbounded graph fan-out.", urgency: "next_7_days", owner: "Incident commander" },
  ];
  result.assumptions = ["Identity Production Database is the affected AWS database", "Three hours describes the full availability incident", "Only authorized direct dependencies are included"];
  result.unknowns = ["Recovery and data-integrity status", "Actual customer traffic impact", "Root cause"];
}

export function getDemoEventTimeline(): EventTimelineEntry[] {
  return clone(EVENT_TIMELINE);
}

export function getDemoEventBranches(): EventScenarioBranch[] {
  return clone(EVENT_BRANCHES);
}

export const EVENT_DEMO_NOW = FROZEN_NOW;
