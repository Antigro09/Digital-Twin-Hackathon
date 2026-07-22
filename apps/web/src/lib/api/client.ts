import {
  ASSETS,
  ASSET_TELEMETRY,
  ASSET_TWIN,
  BEACON_ASSETS,
  BEACON_ASSET_TELEMETRY,
  BEACON_ASSET_TWIN,
  ASTER_GRAPH,
  BEACON_GRAPH,
  CONNECTOR_HEALTH,
  FROZEN_NOW,
  GROUNDED_ANSWER,
  MEMBERSHIPS,
  REMEDIATION,
  SCENARIO_DRAFT,
  SIMULATION,
} from "./demo-data";
import { buildDemoEventInterpretation, getDemoEventBranches, getDemoEventTimeline } from "./event-demo-data";
import {
  AI_DEMO_ACTIVITY,
  AI_DEMO_STATUS,
  AI_DEMO_SUGGESTIONS,
} from "./ai-demo-data";
import type {
  ActionReceipt,
  ActorContext,
  AiActivityFeed,
  AiAgentActivity,
  AiAgentResult,
  AiAgentRunInput,
  AiAgentRunStatus,
  AiClassification,
  AiEvidence,
  AiExplainResult,
  AiKnowledgeImportInput,
  AiKnowledgeImportResult,
  AiProviderReadiness,
  AiStatus,
  AiSuggestion,
  AiSuggestionReview,
  AiUsage,
  AssetCommand,
  AssetCommandPreview,
  AssetCommandReceipt,
  AssetComponent,
  AssetControlState,
  AssetSummary,
  AssetTelemetry,
  AssetTwinSnapshot,
  AnswerMode,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRole,
  CitedAnswer,
  CompensationPreview,
  ConnectorHealth,
  DigitalTwinApi,
  GraphResult,
  FailurePrediction,
  EventDecisionReceipt,
  EventBranchComparison,
  EventApproval,
  EventIntent,
  EventInterpretation,
  EventReview,
  EventReplay,
  EventScenarioBranch,
  EventTimelineEntry,
  LifecycleEvent,
  RemediationPreview,
  ScenarioDraft,
  SimulationComparison,
  TwinGraph,
  TwinNodeSummary,
  TwinRelationship,
} from "./types";
import { ApiProblem } from "./types";

const clone = <T,>(value: T): T => structuredClone(value);

const sleep = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("The request was cancelled.", "AbortError"));
      },
      { once: true },
    );
  });

export class DemoDigitalTwinApi implements DigitalTwinApi {
  readonly sourceMode = "demo" as const;
  private actor = clone(MEMBERSHIPS);
  private scenario = clone(SCENARIO_DRAFT);
  private approval?: ApprovalRequest;
  private receipt?: ActionReceipt;
  private compensation?: CompensationPreview;
  private controlState = clone(ASSET_TWIN.control.state);
  private telemetry = clone(ASSET_TELEMETRY);
  private beaconTelemetry = clone(BEACON_ASSET_TELEMETRY);
  private telemetryTick = 0;
  private assetPreview?: AssetCommandPreview;
  private assetReceipt?: AssetCommandReceipt;
  private eventInterpretation?: EventInterpretation;
  private eventTimeline = getDemoEventTimeline();
  private eventBranches = getDemoEventBranches();
  private eventReceipts = new Map<string, EventDecisionReceipt>();
  private eventReview?: EventReview;
  private eventApproval?: EventApproval;
  private aiSuggestions = clone(AI_DEMO_SUGGESTIONS);
  private aiActivity = clone(AI_DEMO_ACTIVITY);
  private twinNodes: TwinNodeSummary[] = [];
  private twinRelationships: TwinRelationship[] = [];

  private async delay(signal?: AbortSignal) {
    await sleep(90, signal);
  }

  async getActorContext(signal?: AbortSignal): Promise<ActorContext> {
    await this.delay(signal);
    return clone(this.actor);
  }

  async selectMembership(membershipId: string, signal?: AbortSignal): Promise<ActorContext> {
    await this.delay(signal);
    const membership = this.actor.memberships.find((candidate) => candidate.membershipId === membershipId);
    if (!membership) throw new ApiProblem("That membership is not available to this actor.", 403, "membership_denied", false);
    this.actor.activeMembershipId = membershipId;
    return clone(this.actor);
  }

  async getConnectorHealth(signal?: AbortSignal): Promise<ConnectorHealth[]> {
    await this.delay(signal);
    if (this.actor.activeMembershipId === "mem_beacon_observer") {
      return [
        { ...CONNECTOR_HEALTH[0], detail: "8 repositories · metadata read-only" },
        {
          provider: "Jira",
          state: "revoked",
          lastSyncedAt: "2026-07-13T15:12:00Z",
          freshnessMinutes: 48,
          detail: "Authorization revoked; projections are no longer queryable",
        },
      ];
    }
    return clone(CONNECTOR_HEALTH);
  }

  async getTwinGraph(signal?: AbortSignal): Promise<TwinGraph> {
    await this.delay(signal);
    return { nodes: clone(this.twinNodes), relationships: clone(this.twinRelationships), nodeTypes: [
      { type_id: "edt.core/Employee", display_name: "Employee", domain: "core", description: "A person in the organization" },
      { type_id: "edt.core/Department", display_name: "Department", domain: "core", description: "An organizational department" },
      { type_id: "edt.core/Project", display_name: "Project", domain: "core", description: "A company initiative" },
    ], relationshipTypes: [
      { type_id: "edt.core/WORKS_ON", display_name: "Works on", domain: "core", description: "Connects a person to work", allowed_source_types: [], allowed_target_types: [] },
      { type_id: "edt.core/REPORTS_TO", display_name: "Reports to", domain: "core", description: "Connects a person to their manager", allowed_source_types: [], allowed_target_types: [] },
      { type_id: "edt.core/RELATES_TO", display_name: "Relates to", domain: "core", description: "A general relationship", allowed_source_types: [], allowed_target_types: [] },
    ], graphVersion: 1, dataWatermark: "demo graph" };
  }

  async createTwinNode(input: { typeId: string; label: string }, signal?: AbortSignal): Promise<TwinNodeSummary> {
    await this.delay(signal);
    const node: TwinNodeSummary = { node_id: `demo-node-${Date.now()}`, type_id: input.typeId, label: input.label, classification: "internal", state: "active", version: 1, updated_at: new Date().toISOString() };
    this.twinNodes.push(node); return clone(node);
  }

  async createTwinRelationship(input: { typeId: string; sourceNodeId: string; targetNodeId: string }, signal?: AbortSignal): Promise<TwinRelationship> {
    await this.delay(signal);
    const relationship: TwinRelationship = { relationship_id: `demo-relationship-${Date.now()}`, type_id: input.typeId, source_node_id: input.sourceNodeId, target_node_id: input.targetNodeId, state: "active" };
    this.twinRelationships.push(relationship); return clone(relationship);
  }

  async interpretEvent(input: string, intent: EventIntent, signal?: AbortSignal): Promise<EventInterpretation> {
    await this.delay(signal);
    if (!input.trim()) throw new ApiProblem("Describe what happened before analyzing the event.", 400, "event_text_required", false);
    if (input.length > 4_000) throw new ApiProblem("Event text must be 4,000 characters or fewer.", 413, "event_text_too_large", false);
    this.eventInterpretation = buildDemoEventInterpretation(input, intent);
    if (this.actor.activeMembershipId === "mem_beacon_observer") {
      this.eventInterpretation.canApplyToTwin = false;
      this.eventInterpretation.modeReason = "This membership can analyze an isolated scenario but cannot review or mutate the tenant reality graph.";
    }
    return clone(this.eventInterpretation);
  }

  async reviewEvent(
    previewId: string,
    digest: string,
    targetMode: "reality" | "scenario",
    selectedEntityIds: string[],
    signal?: AbortSignal,
  ): Promise<EventReview> {
    await this.delay(signal);
    if (this.actor.activeMembershipId !== "mem_aster_operator") {
      throw new ApiProblem("This membership may interpret events but cannot review or record them.", 403, "event_review_denied", false);
    }
    const event = this.eventInterpretation;
    if (!event || event.previewId !== previewId || event.digest !== digest) {
      throw new ApiProblem("The exact event interpretation changed. Analyze it again before review.", 412, "event_preview_mismatch", false);
    }
    if (event.processingMode === "rejected") {
      throw new ApiProblem("Quarantined or rejected input cannot become a graph change or scenario.", 422, "event_quarantined", false);
    }
    if (event.entityResolutions.some((item) => item.requiredConfirmation && !item.candidates.some((candidate) => selectedEntityIds.includes(candidate.entityId)))) {
      throw new ApiProblem("Resolve every required entity match before review.", 409, "event_entity_resolution_required", false);
    }
    if (targetMode === "reality" && (!event.canApplyToTwin || this.actor.activeMembershipId !== "mem_aster_operator")) {
      throw new ApiProblem("This event can only be reviewed as an isolated scenario.", 403, "event_reality_review_denied", false);
    }
    const reviewedInterpretation = clone(event);
    reviewedInterpretation.entityResolutions = reviewedInterpretation.entityResolutions.map((resolution) => ({
      ...resolution,
      candidates: resolution.candidates.map((candidate) => ({
        ...candidate,
        selected: selectedEntityIds.includes(candidate.entityId),
      })),
    }));
    const selectedPerson = reviewedInterpretation.entityResolutions[0]?.candidates.find((candidate) => candidate.selected);
    if (selectedPerson && selectedPerson.label !== "Sarah Kim" && reviewedInterpretation.category === "people") {
      reviewedInterpretation.nodes = reviewedInterpretation.nodes.map((node) => node.kind === "person" ? { ...node, label: selectedPerson.label } : node);
      reviewedInterpretation.stateDeltas = reviewedInterpretation.stateDeltas.map((delta) => delta.subject === "Sarah Kim" ? { ...delta, subject: selectedPerson.label } : delta);
      reviewedInterpretation.assumptions = reviewedInterpretation.assumptions.map((assumption) => assumption === "Sarah Kim is the person referenced" ? `${selectedPerson.label} is the person selected by the reviewer` : assumption);
    }
    reviewedInterpretation.verificationStatus = targetMode === "reality" ? "verified" : "unverified";
    reviewedInterpretation.processingMode = targetMode === "reality" ? "reality_review" : "scenario_only";
    reviewedInterpretation.modeReason = targetMode === "reality"
      ? "The server-sealed review binds the confirmed entity selection and exact synthetic graph snapshot."
      : "The server-sealed review remains isolated from the reality projection.";
    reviewedInterpretation.etag = '"event-reviewed-v2"';
    this.eventInterpretation = reviewedInterpretation;
    this.eventReview = {
      eventId: event.eventId,
      previewId,
      eventVersion: 1,
      status: "reviewed",
      targetMode,
      selectedEntityIds: clone(selectedEntityIds),
      reviewedPayloadHash: event.digest,
      etag: '"event-reviewed-v2"',
      reviewedInterpretation: clone(reviewedInterpretation),
    };
    return clone(this.eventReview);
  }

  async requestEventApproval(review: EventReview, signal?: AbortSignal): Promise<EventApproval> {
    await this.delay(signal);
    if (!this.eventReview || review.reviewedPayloadHash !== this.eventReview.reviewedPayloadHash) {
      throw new ApiProblem("Review the exact event payload before requesting approval.", 412, "event_review_mismatch", false);
    }
    const scenario = review.targetMode === "scenario";
    this.eventApproval = {
      approvalId: `event-approval-${review.eventId}`,
      eventId: review.eventId,
      eventVersion: review.eventVersion,
      graphSnapshotVersion: this.eventInterpretation?.graphSnapshotVersion ?? 0,
      graphSnapshotHash: this.eventInterpretation?.graphSnapshotHash ?? "",
      payloadHash: review.reviewedPayloadHash,
      status: scenario ? "approved" : "pending",
      requiredRoles: scenario ? [] : ["operations", "security"],
      decisions: [],
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      approvalKind: scenario ? "scenario_policy" : "dual_human",
    };
    return clone(this.eventApproval);
  }

  async approveEvent(approvalId: string, role: "operations" | "security", payloadHash: string, signal?: AbortSignal): Promise<EventApproval> {
    await this.delay(signal);
    const approval = this.eventApproval;
    if (!approval || approval.approvalId !== approvalId || approval.payloadHash !== payloadHash) {
      throw new ApiProblem("The approval is not bound to this reviewed payload.", 412, "event_approval_payload_mismatch", false);
    }
    if (!approval.requiredRoles.includes(role)) throw new ApiProblem("That approval role is not required.", 409, "event_approval_role_not_required", false);
    if (!approval.decisions.some((item) => item.role === role)) {
      approval.decisions.push({
        role,
        approverId: role === "operations" ? "usr_aster_ops_approver" : "usr_aster_security_approver",
        decidedAt: new Date().toISOString(),
        payloadHash,
      });
    }
    approval.status = approval.requiredRoles.every((requiredRole) => approval.decisions.some((decision) => decision.role === requiredRole)) ? "approved" : "pending";
    return clone(approval);
  }

  async applyReviewedEvent(review: EventReview, approval: EventApproval, signal?: AbortSignal): Promise<EventDecisionReceipt> {
    await this.delay(signal);
    if (!this.eventReview || !this.eventApproval || approval.status !== "approved" || approval.payloadHash !== review.reviewedPayloadHash) {
      throw new ApiProblem("The exact reviewed event requires its complete approval before it can be recorded.", 409, "event_approval_incomplete", false);
    }
    return this.decideEvent(
      review.previewId,
      review.reviewedPayloadHash,
      review.targetMode === "scenario" ? "branch_scenario" : "apply",
      review.selectedEntityIds,
      `event-${review.targetMode}-${review.eventId}-v${review.eventVersion}`,
      signal,
    );
  }

  async decideEvent(
    previewId: string,
    digest: string,
    decision: "apply" | "branch_scenario",
    selectedEntityIds: string[],
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<EventDecisionReceipt> {
    await this.delay(signal);
    const prior = this.eventReceipts.get(idempotencyKey);
    if (prior) return { ...clone(prior), replayed: true };
    const event = this.eventInterpretation;
    if (!event || event.previewId !== previewId || event.digest !== digest) {
      throw new ApiProblem("The exact event interpretation changed. Analyze it again before review.", 412, "event_preview_mismatch", false);
    }
    if (!selectedEntityIds.includes("person-sarah-kim") && event.category === "people") {
      throw new ApiProblem("Confirm the affected person before recording a decision.", 409, "entity_confirmation_required", false);
    }
    if (decision === "apply" && (this.actor.activeMembershipId !== "mem_aster_operator" || !event.canApplyToTwin)) {
      throw new ApiProblem("This event is not eligible to update the tenant reality graph.", 403, "event_apply_denied", false);
    }
    const isScenario = decision === "branch_scenario";
    const receipt: EventDecisionReceipt = {
      receiptId: `event-receipt-${isScenario ? "scenario" : "apply"}-001`,
      eventId: event.eventId,
      previewId,
      decision: isScenario ? "scenario_branched" : "applied",
      status: "succeeded",
      idempotencyKey,
      digest,
      recordedAt: new Date().toISOString(),
      eventVersionBefore: 1,
      eventVersionAfter: 2,
      graphVersionBefore: 1842,
      graphVersionAfter: isScenario ? 1842 : 1843,
      outboxPosition: isScenario ? 42 : 43,
      beforeStateHash: "sha256:4d79b612a401ea398b2e320e766594a92c0f57a5810cddbe1c7b99ff0ea89617",
      afterStateHash: isScenario ? "sha256:4d79b612a401ea398b2e320e766594a92c0f57a5810cddbe1c7b99ff0ea89617" : "sha256:d5ad603499f647f51ce5fca395322df187e7719c1fc4749d0285f8b9728d1594",
      replayed: false,
      auditEventId: `audit-${event.eventId}-${isScenario ? "branch" : "apply"}`,
      rollbackAvailable: !isScenario,
      externalWrite: false,
      message: isScenario
        ? "An isolated scenario branch was created. The reality graph and external systems were not changed."
        : "The reviewed event was applied to the synthetic tenant projection only. External systems were not changed.",
    };
    this.eventReceipts.set(idempotencyKey, clone(receipt));
    if (!isScenario) {
      this.eventTimeline = this.eventTimeline.map((entry) => entry.status === "applied" ? { ...entry, rollbackAvailable: false } : entry);
    } else {
      this.eventBranches = [
        {
          branchId: `branch-${event.eventId}`,
          name: event.title,
          parentBranchId: "branch-aster-baseline",
          createdByEventId: event.eventId,
          createdAt: receipt.recordedAt,
          mode: "scenario",
          status: "active",
          eventIds: [event.eventId],
          baseGraphVersion: receipt.graphVersionBefore,
          baseGraphHash: receipt.beforeStateHash ?? event.graphSnapshotHash,
          stateHash: event.digest,
        },
        ...this.eventBranches.filter((branch) => branch.createdByEventId !== event.eventId),
      ];
    }
    this.eventTimeline = [
      {
        timelineEntryId: `timeline-${event.eventId}-${isScenario ? "scenario" : "applied"}-${receipt.graphVersionAfter}`,
        eventId: event.eventId,
        title: event.title,
        eventType: event.eventType,
        occurredAt: event.occurredAt ?? receipt.recordedAt,
        recordedAt: receipt.recordedAt,
        status: isScenario ? "scenario" : "applied",
        confidenceLevel: event.confidenceLevel,
        confidence: event.confidence,
        effectCount: event.nodes.length - 1,
        graphVersionBefore: receipt.graphVersionBefore,
        graphVersionAfter: receipt.graphVersionAfter,
        rollbackAvailable: receipt.rollbackAvailable,
        receiptId: receipt.receiptId,
        summary: receipt.message,
      },
      ...this.eventTimeline.filter((item) => item.eventId !== event.eventId),
    ];
    return clone(receipt);
  }

  async getEventTimeline(signal?: AbortSignal): Promise<EventTimelineEntry[]> {
    await this.delay(signal);
    if (this.actor.activeMembershipId === "mem_beacon_observer") return [];
    return clone(this.eventTimeline);
  }

  async getEventBranches(signal?: AbortSignal): Promise<EventScenarioBranch[]> {
    await this.delay(signal);
    if (this.actor.activeMembershipId === "mem_beacon_observer") return [];
    return clone(this.eventBranches);
  }

  async rollbackEvent(eventId: string, receiptId: string, idempotencyKey: string, signal?: AbortSignal): Promise<EventDecisionReceipt> {
    await this.delay(signal);
    const prior = this.eventReceipts.get(idempotencyKey);
    if (prior) return { ...clone(prior), replayed: true };
    if (this.actor.activeMembershipId !== "mem_aster_operator") {
      throw new ApiProblem("This membership cannot roll back reality events.", 403, "event_rollback_denied", false);
    }
    const entry = this.eventTimeline.find((item) => item.eventId === eventId && item.receiptId === receiptId);
    if (!entry?.rollbackAvailable) throw new ApiProblem("This event has no rollback available.", 409, "event_rollback_unavailable", false);
    const receipt: EventDecisionReceipt = {
      receiptId: `event-rollback-${eventId}`,
      eventId,
      previewId: this.eventInterpretation?.previewId ?? "historical-event",
      decision: "rolled_back",
      status: "succeeded",
      idempotencyKey,
      digest: this.eventInterpretation?.digest ?? "sha256:historical-event",
      recordedAt: new Date().toISOString(),
      eventVersionBefore: 2,
      eventVersionAfter: 3,
      graphVersionBefore: entry.graphVersionAfter,
      graphVersionAfter: entry.graphVersionAfter + 1,
      outboxPosition: 44,
      beforeStateHash: "sha256:d5ad603499f647f51ce5fca395322df187e7719c1fc4749d0285f8b9728d1594",
      afterStateHash: "sha256:4d79b612a401ea398b2e320e766594a92c0f57a5810cddbe1c7b99ff0ea89617",
      replayed: false,
      auditEventId: `audit-${eventId}-rollback`,
      rollbackAvailable: false,
      externalWrite: false,
      message: "The synthetic graph mutation was compensated. Source records and external systems were not changed.",
    };
    entry.rollbackAvailable = false;
    this.eventTimeline = [
      {
        ...entry,
        timelineEntryId: `timeline-${eventId}-rollback-${receipt.graphVersionAfter}`,
        status: "rolled_back",
        recordedAt: receipt.recordedAt,
        graphVersionBefore: receipt.graphVersionBefore,
        graphVersionAfter: receipt.graphVersionAfter,
        rollbackAvailable: false,
        receiptId: receipt.receiptId,
        summary: receipt.message,
      },
      ...this.eventTimeline,
    ];
    this.eventReceipts.set(idempotencyKey, clone(receipt));
    return clone(receipt);
  }

  async getEventReplay(eventId: string, signal?: AbortSignal): Promise<EventReplay> {
    await this.delay(signal);
    const timeline = this.eventTimeline.filter((entry) => entry.eventId === eventId);
    if (!timeline.length) throw new ApiProblem("Event history was not found.", 404, "event_not_found", false);
    const branch = this.eventBranches.find((candidate) => candidate.createdByEventId === eventId || candidate.eventIds.includes(eventId));
    const receipts = [...this.eventReceipts.values()].filter((candidate) => candidate.eventId === eventId);
    const current = this.eventInterpretation?.eventId === eventId ? this.eventInterpretation : undefined;
    const latest = timeline[0];
    return {
      eventId,
      mode: latest.status === "scenario" ? "scenario" : "reality",
      currentStatus: latest.status,
      reconstructable: true,
      graph: {
        beforeVersion: latest.graphVersionBefore,
        afterVersion: latest.graphVersionAfter,
        beforeStateHash: receipts.at(-1)?.beforeStateHash ?? branch?.baseGraphHash ?? "sha256:demo-history-before",
        afterStateHash: receipts.at(-1)?.afterStateHash ?? branch?.stateHash ?? "sha256:demo-history-after",
      },
      entityChanges: current ? current.stateDeltas.filter((delta) => delta.operation !== "create").map((delta) => ({
        entityId: delta.deltaId,
        displayName: delta.subject,
        before: { [delta.field]: delta.before },
        after: { [delta.field]: delta.after },
      })) : [],
      relationshipChanges: [],
      receipts: receipts.map((candidate) => ({
        receiptId: candidate.receiptId,
        action: candidate.decision === "rolled_back" ? "rollback" : candidate.decision === "scenario_branched" ? "apply_scenario" : "apply_reality",
        recordedAt: candidate.recordedAt,
        graphVersionBefore: candidate.graphVersionBefore,
        graphVersionAfter: candidate.graphVersionAfter,
        outboxPosition: candidate.outboxPosition,
      })),
      timeline: timeline.map((entry) => ({
        timelineEntryId: entry.timelineEntryId,
        action: entry.status === "rolled_back" ? "event_rolled_back" : "event_applied",
        recordedAt: entry.recordedAt,
        receiptId: entry.receiptId,
      })),
      branch: branch ? clone(branch) : undefined,
    };
  }

  async compareEventBranches(leftBranchId: string, rightBranchId: string, signal?: AbortSignal): Promise<EventBranchComparison> {
    await this.delay(signal);
    const left = this.eventBranches.find((branch) => branch.branchId === leftBranchId);
    const right = this.eventBranches.find((branch) => branch.branchId === rightBranchId);
    if (!left || !right) throw new ApiProblem("Scenario branch was not found.", 404, "branch_not_found", false);
    const leftEvents = new Set(left.eventIds);
    const rightEvents = new Set(right.eventIds);
    return {
      left: clone(left),
      right: clone(right),
      sameBaseSnapshot: left.baseGraphVersion === right.baseGraphVersion && left.baseGraphHash === right.baseGraphHash,
      commonEventIds: [...leftEvents].filter((eventId) => rightEvents.has(eventId)),
      leftOnlyEventIds: [...leftEvents].filter((eventId) => !rightEvents.has(eventId)),
      rightOnlyEventIds: [...rightEvents].filter((eventId) => !leftEvents.has(eventId)),
      stateHashEqual: left.stateHash === right.stateHash,
    };
  }

  async traverseLaunchGraph(signal?: AbortSignal): Promise<GraphResult> {
    await this.delay(signal);
    return clone(this.actor.activeMembershipId === "mem_beacon_observer" ? BEACON_GRAPH : ASTER_GRAPH);
  }

  async askLaunchRisk(question: string, mode: AnswerMode, signal?: AbortSignal): Promise<CitedAnswer> {
    await this.delay(signal);
    if (this.actor.activeMembershipId === "mem_beacon_observer") {
      return {
        question,
        answer: "I can’t answer from the sources currently available to this membership.",
        confidence: "abstained",
        citations: [],
        missingData: ["Jira evidence is unavailable after connector authorization was revoked"],
        caveat: "No restricted source identifier or excerpt is included.",
        abstentionReason: "The evidence required to support a launch-risk answer is not authorized.",
        redactedSourceCount: 1,
        runId: "50000000-0000-4000-8000-000000000004",
        completedAt: FROZEN_NOW,
      };
    }
    if (mode === "unsafe") {
      return {
        question,
        answer: "I can’t rank people or infer productivity from work metadata.",
        confidence: "abstained",
        citations: [],
        missingData: [],
        caveat: "Employment scoring and individual performance inference are excluded from this system.",
        abstentionReason: "The request asks for an excluded workforce-sensitive inference.",
        runId: "50000000-0000-4000-8000-000000000003",
        completedAt: FROZEN_NOW,
      };
    }
    if (mode === "restricted") {
      const answer = clone(GROUNDED_ANSWER);
      answer.question = question;
      answer.answer = "AST-142 is on the recorded launch dependency path, but I can’t verify the restricted identity-review claim with your current permissions.";
      answer.confidence = "medium";
      answer.citations = answer.citations.filter((citation) => citation.evidence.source === "Jira").slice(0, 3);
      answer.missingData = ["Restricted GitHub review state", ...answer.missingData];
      answer.abstentionReason = "One supporting source is outside the active authorization intersection.";
      answer.redactedSourceCount = 1;
      answer.runId = "50000000-0000-4000-8000-000000000002";
      return answer;
    }
    return { ...clone(GROUNDED_ANSWER), question };
  }

  async createScenario(deltaWorkdays: number, signal?: AbortSignal): Promise<ScenarioDraft> {
    await this.delay(signal);
    this.scenario = clone(SCENARIO_DRAFT);
    this.scenario.intervention.deltaWorkdays = deltaWorkdays;
    this.scenario.name = `Accelerate AST-142 by ${Math.abs(deltaWorkdays)} workdays`;
    return clone(this.scenario);
  }

  async confirmScenario(scenarioId: string, digest: string, etag: string, signal?: AbortSignal): Promise<ScenarioDraft> {
    await this.delay(signal);
    if (scenarioId !== this.scenario.id || digest !== this.scenario.digest || etag !== this.scenario.etag) {
      throw new ApiProblem("The scenario draft changed. Refresh it before confirming.", 412, "scenario_precondition_failed", false);
    }
    this.scenario.status = "confirmed";
    this.scenario.confirmedAt = FROZEN_NOW;
    this.scenario.etag = '"scenario-confirmed-v1"';
    return clone(this.scenario);
  }

  async runSimulation(scenarioId: string, signal?: AbortSignal): Promise<SimulationComparison> {
    await this.delay(signal);
    if (scenarioId !== this.scenario.id || this.scenario.status !== "confirmed") {
      throw new ApiProblem("Confirm the immutable scenario before simulation.", 409, "scenario_not_confirmed", false);
    }
    return clone(SIMULATION);
  }

  async previewRemediation(signal?: AbortSignal): Promise<RemediationPreview> {
    await this.delay(signal);
    if (this.actor.activeMembershipId !== "mem_aster_operator") {
      throw new ApiProblem("This membership cannot propose external actions.", 403, "action_denied", false);
    }
    return clone(REMEDIATION);
  }

  async requestApproval(previewId: string, payloadHash: string, signal?: AbortSignal): Promise<ApprovalRequest> {
    await this.delay(signal);
    if (previewId !== REMEDIATION.previewId || payloadHash !== REMEDIATION.payloadHash) {
      throw new ApiProblem("The approved payload no longer matches the preview.", 409, "payload_mismatch", false);
    }
    this.approval = {
      approvalId: "90000000-0000-4000-8000-000000000001",
      status: "pending",
      payloadHash,
      requestedBy: "Maya Chen",
      requestedAt: FROZEN_NOW,
      expiresAt: "2026-07-13T16:15:00Z",
      requiredRoles: ["operations", "security"],
      decisions: [],
    };
    return clone(this.approval);
  }

  async approve(
    approvalId: string,
    role: ApprovalRole,
    payloadHash: string,
    _idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApprovalRequest> {
    await this.delay(signal);
    if (!this.approval || this.approval.approvalId !== approvalId) throw new ApiProblem("Approval not found.", 404, "approval_not_found", false);
    if (this.approval.payloadHash !== payloadHash) throw new ApiProblem("Payload mutation invalidated this approval.", 409, "payload_mismatch", false);
    if (this.approval.decisions.some((decision) => decision.role === role)) return clone(this.approval);
    const decision: ApprovalDecision =
      role === "operations"
        ? { role, approverId: "20000000-0000-4000-8000-000000000003", approverName: "Owen Brooks", decidedAt: FROZEN_NOW, payloadHash }
        : { role, approverId: "20000000-0000-4000-8000-000000000004", approverName: "Samira Patel", decidedAt: FROZEN_NOW, payloadHash };
    this.approval.decisions.push(decision);
    if (this.approval.decisions.length === 2) this.approval.status = "approved";
    return clone(this.approval);
  }

  async execute(approvalId: string, idempotencyKey: string, signal?: AbortSignal): Promise<ActionReceipt> {
    await this.delay(signal);
    if (!this.approval || approvalId !== this.approval.approvalId || this.approval.status !== "approved") {
      throw new ApiProblem("Both distinct approvals are required.", 409, "approval_incomplete", false);
    }
    if (this.receipt) return { ...clone(this.receipt), replayed: true };
    this.receipt = {
      receiptId: "a0000000-0000-4000-8000-000000000001",
      status: "succeeded",
      issueKey: "AST-142",
      providerRequestId: "jira-req-h1-0001",
      idempotencyKey,
      payloadHash: REMEDIATION.payloadHash,
      before: clone(REMEDIATION.before),
      after: clone(REMEDIATION.after),
      executedAt: FROZEN_NOW,
      jiraPutCount: 1,
      replayed: false,
      rollbackExpiresAt: "2026-07-14T16:00:00Z",
      auditEventIds: ["aud-proposal-001", "aud-ops-approval-001", "aud-sec-approval-001", "aud-execution-001"],
    };
    return clone(this.receipt);
  }

  async previewCompensation(receiptId: string, signal?: AbortSignal): Promise<CompensationPreview> {
    await this.delay(signal);
    if (!this.receipt || receiptId !== this.receipt.receiptId) throw new ApiProblem("Action receipt not found.", 404, "receipt_not_found", false);
    this.compensation = {
      compensationId: "b0000000-0000-4000-8000-000000000001",
      approvalId: "b0000000-0000-4000-8000-000000000001",
      payloadHash: "sha256:compensation-ast142-v8",
      status: "pending",
      decisions: [],
      expectedCurrent: clone(this.receipt.after),
      restoreTo: clone(this.receipt.before),
      guard: "Compare-and-set: restore only while Jira still matches the exact post-action snapshot.",
      expiresAt: this.receipt.rollbackExpiresAt,
    };
    return clone(this.compensation);
  }

  async approveCompensation(
    compensationId: string,
    role: ApprovalRole,
    payloadHash: string,
    _idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<CompensationPreview> {
    await this.delay(signal);
    if (!this.compensation || compensationId !== this.compensation.compensationId) {
      throw new ApiProblem("Compensation approval not found.", 404, "compensation_not_found", false);
    }
    if (payloadHash !== this.compensation.payloadHash) {
      throw new ApiProblem("The compensation payload changed.", 409, "payload_mismatch", false);
    }
    if (!this.compensation.decisions.some((decision) => decision.role === role)) {
      this.compensation.decisions.push(
        role === "operations"
          ? { role, approverId: "20000000-0000-4000-8000-000000000003", approverName: "Owen Brooks", decidedAt: FROZEN_NOW, payloadHash }
          : { role, approverId: "20000000-0000-4000-8000-000000000004", approverName: "Samira Patel", decidedAt: FROZEN_NOW, payloadHash },
      );
    }
    if (this.compensation.decisions.length === 2) this.compensation.status = "approved";
    return clone(this.compensation);
  }

  async compensate(compensationId: string, _idempotencyKey: string, signal?: AbortSignal): Promise<CompensationPreview> {
    await this.delay(signal);
    if (!this.compensation || compensationId !== this.compensation.compensationId) {
      throw new ApiProblem("Compensation preview not found.", 404, "compensation_not_found", false);
    }
    if (this.compensation.status !== "approved") {
      throw new ApiProblem("Both distinct rollback approvals are required.", 409, "approval_incomplete", false);
    }
    this.compensation.status = "compensated";
    return clone(this.compensation);
  }

  async getAiStatus(signal?: AbortSignal): Promise<AiStatus> {
    await this.delay(signal);
    if (this.actor.activeMembershipId === "mem_beacon_observer") {
      throw new ApiProblem("This membership is not delegated access to the AI control plane.", 403, "ai_access_denied", false);
    }
    return clone(AI_DEMO_STATUS);
  }

  async getAiActivity(pageSize = 10, signal?: AbortSignal): Promise<AiActivityFeed> {
    await this.delay(signal);
    if (this.actor.activeMembershipId === "mem_beacon_observer") {
      throw new ApiProblem("This membership is not delegated access to AI activity.", 403, "ai_access_denied", false);
    }
    return { ...clone(this.aiActivity), pageSize };
  }

  async runAiAgent(input: AiAgentRunInput, signal?: AbortSignal): Promise<AiAgentResult> {
    await this.delay(signal);
    throw new ApiProblem("No AI provider is configured in offline demo mode. Connect the live AI facade to run an agent.", 503, "ai_provider_unavailable", false);
  }

  async queryAiRetrieval(query: string, _limit = 5, _classifications?: AiClassification[], signal?: AbortSignal): Promise<AiExplainResult> {
    await this.delay(signal);
    throw new ApiProblem("No live private AI corpus is available in offline demo mode.", 503, "ai_corpus_unavailable", false);
  }

  async importAiKnowledge(input: AiKnowledgeImportInput, signal?: AbortSignal): Promise<AiKnowledgeImportResult> {
    await this.delay(signal);
    throw new ApiProblem("Knowledge import requires the connected AI facade; offline demo mode does not retain or index files.", 503, "ai_provider_unavailable", false);
  }

  async getAiSuggestions(signal?: AbortSignal): Promise<AiSuggestion[]> {
    await this.delay(signal);
    if (this.actor.activeMembershipId === "mem_beacon_observer") {
      throw new ApiProblem("This membership cannot view AI suggestions.", 403, "ai_suggestions_denied", false);
    }
    return clone(this.aiSuggestions);
  }

  async reviewAiSuggestion(input: AiSuggestionReview, signal?: AbortSignal): Promise<AiSuggestion> {
    await this.delay(signal);
    throw new ApiProblem("Offline demo mode has no AI suggestions to review.", 503, "ai_provider_unavailable", false);
  }

  async getAssets(signal?: AbortSignal): Promise<AssetSummary[]> {
    await this.delay(signal);
    if (this.actor.activeMembershipId === "mem_beacon_observer") return clone(BEACON_ASSETS);
    return ASSETS.map((asset) => ({ ...clone(asset), status: this.controlState.status, version: this.controlState.version }));
  }

  async getAssetTwin(assetId: string, signal?: AbortSignal): Promise<AssetTwinSnapshot> {
    await this.delay(signal);
    this.assertAssetAccess(assetId);
    if (this.actor.activeMembershipId === "mem_beacon_observer") return clone(BEACON_ASSET_TWIN);
    const twin = clone(ASSET_TWIN);
    twin.asset.status = this.controlState.status;
    twin.asset.version = this.controlState.version;
    twin.control.state = clone(this.controlState);
    twin.projectionAsOf = this.telemetry.sampledAt;
    return twin;
  }

  async getAssetTelemetry(assetId: string, limit = 30, signal?: AbortSignal): Promise<AssetTelemetry> {
    await this.delay(signal);
    this.assertAssetAccess(assetId);
    const beacon = this.actor.activeMembershipId === "mem_beacon_observer";
    const stream = beacon ? this.beaconTelemetry : this.telemetry;
    const controlState = beacon ? BEACON_ASSET_TWIN.control.state : this.controlState;
    this.telemetryTick += 1;
    const previous = stream.points.at(-1)!;
    const index = stream.points.length + this.telemetryTick;
    const stopped = controlState.emergencyStopped;
    const speedRatio = stopped ? 0 : controlState.speedPct / (beacon ? 74 : 96);
    const next = {
      timestamp: new Date(new Date(previous.timestamp).getTime() + this.telemetry.intervalSeconds * 1_000).toISOString(),
      temperatureC: Number((previous.temperatureC + (stopped ? -0.22 : 0.03) + Math.sin(index * 0.61) * 0.08).toFixed(2)),
      pressureBar: Number((stopped ? Math.max(0.2, previous.pressureBar - 0.72) : (beacon ? 6.15 : 8.38) * speedRatio + Math.sin(index * 0.43) * (beacon ? 0.04 : 0.08)).toFixed(2)),
      vibrationMmS: Number((stopped ? Math.max(0.08, previous.vibrationMmS - 0.55) : (beacon ? 1.42 : 4.72) + Math.sin(index * 0.71) * (beacon ? 0.06 : 0.17)).toFixed(2)),
      flowM3H: Number((stopped ? Math.max(0, previous.flowM3H - 18) : (beacon ? 70.8 : 184.4) * speedRatio * (controlState.valvePct / (beacon ? 72 : 82)) + Math.sin(index * 0.37) * (beacon ? 0.4 : 1.8)).toFixed(1)),
      motorCurrentA: Number((stopped ? 0.4 : (beacon ? 34.5 : 44.1) * speedRatio + Math.sin(index * 0.57) * 0.25).toFixed(2)),
      speedRpm: stopped ? 0 : Math.round(3600 * controlState.speedPct / 100 + Math.sin(index * 0.29) * (beacon ? 3 : 8)),
    };
    stream.points.push(next);
    stream.points = stream.points.slice(-Math.max(1, Math.min(limit, 120)));
    stream.sampledAt = next.timestamp;
    stream.receivedAt = new Date().toISOString();
    (Object.keys(stream.signals) as Array<keyof AssetTelemetry["signals"]>).forEach((key) => {
      const signalDefinition = stream.signals[key];
      const value = next[key];
      const critical = (signalDefinition.criticalLow !== undefined && value <= signalDefinition.criticalLow)
        || (signalDefinition.criticalHigh !== undefined && value >= signalDefinition.criticalHigh);
      const warning = (signalDefinition.warningLow !== undefined && value <= signalDefinition.warningLow)
        || (signalDefinition.warningHigh !== undefined && value >= signalDefinition.warningHigh);
      signalDefinition.status = critical ? "critical" : warning ? "warning" : "normal";
    });
    return clone(stream);
  }

  async previewAssetCommand(assetId: string, command: AssetCommand, signal?: AbortSignal): Promise<AssetCommandPreview> {
    await this.delay(signal);
    this.assertAssetAccess(assetId);
    if (this.actor.activeMembershipId !== "mem_aster_operator") throw new ApiProblem("This membership cannot preview asset control commands.", 403, "asset_control_denied", false);
    const after = this.applyAssetCommand(this.controlState, command);
    const fingerprint = `${command.type}-${"value" in command ? command.value : "none"}-v${this.controlState.version}`;
    const checks = [
      { check: "Tenant and asset scope", passed: true, detail: "Command is bound to Aster Labs and P-101 only." },
      { check: "Fresh state version", passed: true, detail: `Expected control state version ${this.controlState.version}.` },
      { check: "Synthetic execution boundary", passed: true, detail: "No PLC, actuator, or external system is connected." },
    ];
    if (command.type === "set_speed_pct") checks.push({ check: "Speed envelope", passed: true, detail: `${command.value}% is inside the approved 30–100% range.` });
    if (command.type === "set_valve_pct") checks.push({ check: "Valve envelope", passed: true, detail: `${command.value}% is inside the approved 5–100% range.` });
    this.assetPreview = {
      previewId: `asset-preview-${this.controlState.version}-${command.type}`,
      assetId,
      command: clone(command),
      expectedAssetVersion: this.controlState.version,
      payloadHash: `sha256:demo-${fingerprint}`,
      currentState: clone(this.controlState),
      predictedState: after,
      safetyChecks: checks,
      risks: command.type === "emergency_stop"
        ? ["Immediately reduces simulated speed and flow to zero", "Reset requires a separate preview after the stop"]
        : ["Changing the operating point can alter pressure, flow, and vibration", "Preview expires if control state changes"],
      expiresAt: new Date(new Date(FROZEN_NOW).getTime() + 15 * 60_000).toISOString(),
      executionMode: "simulation",
      externalWrite: false,
    };
    this.assetReceipt = undefined;
    return clone(this.assetPreview);
  }

  async executeAssetCommand(
    assetId: string,
    previewId: string,
    payloadHash: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<AssetCommandReceipt> {
    await this.delay(signal);
    this.assertAssetAccess(assetId);
    if (!this.assetPreview || this.assetPreview.previewId !== previewId || this.assetPreview.payloadHash !== payloadHash) {
      throw new ApiProblem("The exact command preview is no longer current.", 409, "asset_command_payload_mismatch", false);
    }
    if (this.assetReceipt) {
      if (this.assetReceipt.idempotencyKey !== idempotencyKey) throw new ApiProblem("This preview has already been consumed.", 409, "asset_preview_consumed", false);
      return { ...clone(this.assetReceipt), replayed: true };
    }
    if (this.assetPreview.expectedAssetVersion !== this.controlState.version) {
      throw new ApiProblem("The asset control state changed after preview.", 409, "asset_version_conflict", true);
    }
    const before = clone(this.controlState);
    this.controlState = clone(this.assetPreview.predictedState);
    this.assetReceipt = {
      receiptId: `asset-receipt-${this.controlState.version}`,
      assetId,
      status: "succeeded",
      command: clone(this.assetPreview.command),
      assetVersionBefore: before.version,
      assetVersionAfter: this.controlState.version,
      idempotencyKey,
      payloadHash,
      executedAt: this.telemetry.sampledAt,
      replayed: false,
      auditEventId: `audit-asset-control-${this.controlState.version}`,
      simulation: true,
      externalWrite: false,
    };
    return clone(this.assetReceipt);
  }

  private assertAssetAccess(assetId: string) {
    const expected = this.actor.activeMembershipId === "mem_aster_operator" ? ASSETS[0].assetId : BEACON_ASSETS[0].assetId;
    if (assetId !== expected) {
      throw new ApiProblem("Asset not found in this tenant scope.", 404, "asset_not_found", false);
    }
  }

  private applyAssetCommand(state: AssetControlState, command: AssetCommand): AssetControlState {
    const next = { ...clone(state), version: state.version + 1 };
    if (command.type === "set_speed_pct") {
      if (command.value < 30 || command.value > 100) throw new ApiProblem("Speed must be between 30% and 100%.", 422, "unsafe_setpoint", false);
      if (state.emergencyStopped) throw new ApiProblem("Reset the emergency stop before changing speed.", 409, "emergency_stop_active", false);
      next.speedPct = command.value;
      next.status = "running";
    } else if (command.type === "set_valve_pct") {
      if (command.value < 5 || command.value > 100) throw new ApiProblem("Valve position must be between 5% and 100%.", 422, "unsafe_setpoint", false);
      if (state.emergencyStopped) throw new ApiProblem("Reset the emergency stop before changing the valve.", 409, "emergency_stop_active", false);
      next.valvePct = command.value;
    } else if (command.type === "emergency_stop") {
      next.speedPct = 0;
      next.emergencyStopped = true;
      next.status = "offline";
    } else {
      if (!state.emergencyStopped) throw new ApiProblem("The emergency stop is not active.", 409, "reset_not_required", false);
      next.emergencyStopped = false;
      next.status = "idle";
    }
    return next;
  }
}

type FetchOptions = RequestInit & { signal?: AbortSignal };
type Wire = Record<string, any>;

export type DemoBearerToken = { accessToken: string; expiresAt: string };
export type DemoTokenProvider = (actorAlias: string, signal?: AbortSignal) => Promise<DemoBearerToken>;

export const browserDemoTokenProvider: DemoTokenProvider = async (actorAlias, signal) => {
  const response = await fetch("/api/demo-auth/session", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ actor_alias: actorAlias }),
    signal,
  });
  const payload = await response.json().catch(() => ({})) as Wire;
  if (!response.ok) {
    throw new ApiProblem(String(payload.detail ?? "Trusted local-demo authentication failed."), response.status, String(payload.code ?? "demo_auth_failed"), false);
  }
  if (payload.token_type !== "Bearer"
    || payload.actor_alias !== actorAlias
    || typeof payload.access_token !== "string"
    || typeof payload.expires_at !== "string") {
    throw new ApiProblem("Trusted local-demo authentication returned an invalid session.", 502, "invalid_demo_session", false);
  }
  return { accessToken: payload.access_token, expiresAt: payload.expires_at };
};

export class FetchDigitalTwinApi implements DigitalTwinApi {
  readonly sourceMode = "connected" as const;
  private actor = clone(MEMBERSHIPS);
  private actorAlias = "usr_aster_admin";
  private lastEvidenceIds: string[] = [];
  private snapshot?: Wire;
  private scenario?: ScenarioDraft;
  private simulationId?: string;
  private previewWire?: Wire;
  private previewEtag?: string;
  private receipt?: ActionReceipt;
  private compensationWire?: Wire;
  private assetControlStates = new Map<string, AssetControlState>();
  private assetCommandPreviews = new Map<string, { preview: AssetCommandPreview; etag: string }>();
  private assetCommandReceipts = new Map<string, AssetCommandReceipt>();
  private eventWires = new Map<string, Wire>();
  private eventPreviewWires = new Map<string, Wire>();
  private eventModelWires = new Map<string, Wire>();
  private eventApprovalWires = new Map<string, Wire>();
  private eventReceiptWires = new Map<string, Wire>();
  private aiSuggestions = new Map<string, AiSuggestion>();
  private serverCapabilities = new Set<string>();
  private demoTokens = new Map<string, { accessToken: string; expiresAtMilliseconds: number }>();
  private demoTokenRequests = new Map<string, Promise<{ accessToken: string; expiresAtMilliseconds: number }>>();

  constructor(private readonly baseUrl: string, private readonly tokenProvider: DemoTokenProvider = browserDemoTokenProvider) {}

  private async envelope<T>(path: string, options: FetchOptions = {}, actorAlias = this.actorAlias): Promise<{ data: T; response: Response }> {
    const perform = async (forceRefresh = false) => {
      const accessToken = await this.demoAccessToken(actorAlias, options.signal, forceRefresh);
      return fetch(`${this.baseUrl}${path}`, {
        credentials: "include",
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...options.headers,
          Authorization: `Bearer ${accessToken}`,
        },
      });
    };
    let response = await perform();
    if (response.status === 401) {
      this.demoTokens.delete(actorAlias);
      response = await perform(true);
    }
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as { detail?: string; code?: string; retryable?: boolean };
      throw new ApiProblem(problem.detail ?? `Request failed (${response.status}).`, response.status, problem.code ?? "api_error", problem.retryable ?? response.status >= 500);
    }
    return { data: (await response.json()) as T, response };
  }

  private async demoAccessToken(actorAlias: string, signal?: AbortSignal, forceRefresh = false): Promise<string> {
    const cached = this.demoTokens.get(actorAlias);
    if (!forceRefresh && cached && cached.expiresAtMilliseconds - Date.now() > 30_000) return cached.accessToken;
    if (!forceRefresh) {
      const pending = this.demoTokenRequests.get(actorAlias);
      if (pending) return (await pending).accessToken;
    }
    const request = this.tokenProvider(actorAlias, signal).then((token) => {
      const expiresAtMilliseconds = Date.parse(token.expiresAt);
      if (!token.accessToken || !Number.isFinite(expiresAtMilliseconds) || expiresAtMilliseconds <= Date.now()) {
        throw new ApiProblem("Trusted local-demo authentication returned an expired session.", 502, "invalid_demo_session", false);
      }
      const cachedToken = { accessToken: token.accessToken, expiresAtMilliseconds };
      this.demoTokens.set(actorAlias, cachedToken);
      return cachedToken;
    });
    this.demoTokenRequests.set(actorAlias, request);
    try {
      return (await request).accessToken;
    } finally {
      if (this.demoTokenRequests.get(actorAlias) === request) this.demoTokenRequests.delete(actorAlias);
    }
  }

  private async request<T>(path: string, options: FetchOptions = {}, actorAlias = this.actorAlias): Promise<T> {
    return (await this.envelope<T>(path, options, actorAlias)).data;
  }

  private key(label: string): string {
    const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `edt-web-${label}-${nonce}`;
  }

  private mutation(label: string): Record<string, string> {
    return { "Idempotency-Key": this.key(label) };
  }

  async getActorContext(signal?: AbortSignal): Promise<ActorContext> {
    const identity = await this.request<Wire>("/v1/me", { signal });
    this.captureServerCapabilities(identity);
    this.actor.expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    return clone(this.actor);
  }

  async selectMembership(membershipId: string, signal?: AbortSignal): Promise<ActorContext> {
    const membership = this.actor.memberships.find((candidate) => candidate.membershipId === membershipId);
    if (!membership) throw new ApiProblem("That membership is not available to this actor.", 403, "membership_denied", false);
    const previous = this.actorAlias;
    this.actorAlias = membership.membershipId === "mem_aster_graph_admin"
      ? "usr_aster_admin"
      : membership.tenantAlias === "tnt_aster" ? "usr_aster_analyst" : "usr_beacon_analyst";
    try {
      const identity = await this.request<Wire>("/v1/me", { signal });
      this.captureServerCapabilities(identity);
    } catch (error) {
      this.actorAlias = previous;
      throw error;
    }
    this.actor.activeMembershipId = membershipId;
    this.actor.expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    this.snapshot = undefined;
    this.scenario = undefined;
    this.simulationId = undefined;
    this.previewWire = undefined;
    this.previewEtag = undefined;
    this.receipt = undefined;
    this.compensationWire = undefined;
    this.assetControlStates.clear();
    this.assetCommandPreviews.clear();
    this.assetCommandReceipts.clear();
    this.eventWires.clear();
    this.eventPreviewWires.clear();
    this.eventModelWires.clear();
    this.eventApprovalWires.clear();
    this.eventReceiptWires.clear();
    return clone(this.actor);
  }

  async getConnectorHealth(signal?: AbortSignal): Promise<ConnectorHealth[]> {
    const page = await this.request<Wire>("/v1/connectors", { signal });
    return (page.items as Wire[]).map((item) => ({
      provider: item.provider === "github" ? "GitHub" : "Jira",
      state: item.status === "healthy" ? "healthy" : item.status === "revoked" ? "revoked" : "stale",
      lastSyncedAt: String(item.last_reconciled_at),
      freshnessMinutes: Math.ceil(Number(item.freshness_seconds) / 60),
      detail: item.provider === "github" ? "Metadata read-only · permission-filtered" : "Allowlisted synthetic project · governed write enabled",
    }));
  }

  async traverseLaunchGraph(signal?: AbortSignal): Promise<GraphResult> {
    const result = await this.request<Wire>("/v1/graph/traversals", {
      method: "POST",
      body: JSON.stringify({ template: "delivery_dependencies", root_ref: { type: "milestone", key: "Orion 2.0 General Availability" }, max_depth: 4, max_nodes: 100 }),
      signal,
    });
    const graph = clone(this.actor.activeMembershipId === "mem_aster_operator" ? ASTER_GRAPH : BEACON_GRAPH);
    graph.projectionAsOf = String(result.data_watermark?.observed_at ?? graph.projectionAsOf);
    graph.dataWatermark = `projection:${this.actor.activeMembershipId}:${String(result.data_watermark?.outbox_position ?? 0)}`;
    return graph;
  }

  async getTwinGraph(signal?: AbortSignal): Promise<TwinGraph> {
    const [nodes, relationships, nodeTypes, relationshipTypes] = await Promise.all([
      this.request<Wire>("/v1/twin/nodes?state=active&limit=100", { signal }),
      this.request<Wire>("/v1/twin/relationships?state=active&limit=200", { signal }),
      this.request<Wire>("/v1/twin/node-types", { signal }),
      this.request<Wire>("/v1/twin/relationship-types", { signal }),
    ]);
    return {
      nodes: (nodes.items as TwinNodeSummary[] ?? []), relationships: (relationships.items as TwinRelationship[] ?? []),
      nodeTypes: (nodeTypes.items as TwinGraph["nodeTypes"] ?? []), relationshipTypes: (relationshipTypes.items as TwinGraph["relationshipTypes"] ?? []),
      graphVersion: Number(nodes.graph_version ?? relationships.graph_version ?? 0), dataWatermark: String(nodes.data_watermark ?? "not reported"),
    };
  }

  async createTwinNode(input: { typeId: string; label: string }, signal?: AbortSignal): Promise<TwinNodeSummary> {
    const response = await this.request<Wire>("/v1/twin/nodes", { method: "POST", headers: this.mutation("twin-node"), body: JSON.stringify({ type_id: input.typeId, label: input.label }), signal });
    return response.node as TwinNodeSummary;
  }

  async createTwinRelationship(input: { typeId: string; sourceNodeId: string; targetNodeId: string }, signal?: AbortSignal): Promise<TwinRelationship> {
    const response = await this.request<Wire>("/v1/twin/relationships", { method: "POST", headers: this.mutation("twin-relationship"), body: JSON.stringify({ type_id: input.typeId, source_node_id: input.sourceNodeId, target_node_id: input.targetNodeId }), signal });
    return response.relationship as TwinRelationship;
  }

  async askLaunchRisk(question: string, mode: AnswerMode, signal?: AbortSignal): Promise<CitedAnswer> {
    const queued = await this.request<Wire>("/v1/questions", {
      method: "POST",
      headers: this.mutation("question"),
      body: JSON.stringify({ question }),
      signal,
    });
    const view = await this.request<Wire>(String(queued.status_url), { signal });
    const result = view.result as Wire;
    const run = view.run as Wire;
    this.lastEvidenceIds = (result.citations as Wire[] ?? []).map((citation) => String(citation.evidence_id));
    if (result.abstained) {
      return {
        question,
        answer: String(result.answer),
        confidence: "abstained",
        citations: [],
        missingData: (result.missing_information as unknown[] ?? []).map(String),
        caveat: "No inaccessible locator, excerpt, or cross-tenant identifier is returned.",
        abstentionReason: String(result.abstention_reason ?? "Evidence threshold not met."),
        runId: String(run.run_id),
        completedAt: String(run.completed_at),
      };
    }
    const evidenceById = new Map(ASTER_GRAPH.evidence.map((item) => [item.id, item]));
    let citations = (result.citations as Wire[]).map((citation, index) => {
      const sourceId = String(citation.source_object_id);
      const evidence = clone(evidenceById.get(sourceId) ?? ASTER_GRAPH.evidence[index]);
      return { number: index + 1, claim: String((result.claims as Wire[])?.[Math.min(index, (result.claims as Wire[]).length - 1)]?.statement ?? result.answer), evidence };
    });
    if (mode === "restricted") citations = citations.filter((citation) => citation.evidence.source === "Jira").slice(0, 3);
    return {
      question,
      answer: String(result.answer),
      confidence: mode === "restricted" ? "medium" : "high",
      citations,
      missingData: (result.missing_information as unknown[] ?? []).map(String),
      caveat: "Grounded in the authorized synthetic source revisions at the displayed projection watermark; this is not a workforce assessment or causal forecast.",
      abstentionReason: mode === "restricted" ? "One supporting source is outside the selected presentation scope." : undefined,
      redactedSourceCount: mode === "restricted" ? 1 : undefined,
      runId: String(run.run_id),
      completedAt: String(run.completed_at),
    };
  }

  async createScenario(deltaWorkdays: number, signal?: AbortSignal): Promise<ScenarioDraft> {
    const snapshot = await this.request<Wire>("/v1/simulation-snapshots", {
      method: "POST",
      headers: this.mutation("snapshot"),
      body: JSON.stringify({ project_id: "11111111-1111-4111-8111-111111111111", as_of: FROZEN_NOW }),
      signal,
    });
    this.snapshot = snapshot;
    const response = await this.envelope<Wire>("/v1/scenarios", {
      method: "POST",
      headers: this.mutation("scenario"),
      body: JSON.stringify({
        name: `Accelerate AST-142 by ${Math.abs(deltaWorkdays)} workdays`,
        target_date: "2026-09-15",
        snapshot_id: snapshot.snapshot_id,
        expected_snapshot_hash: snapshot.canonical_sha256,
        seed: "20260713",
        sample_count: 50000,
        interventions: [{ type: "shift_completion_distribution", work_item_id: "116ab4b3-b108-5f91-ab7e-111f7fba1d45", delta_workdays: deltaWorkdays }],
      }),
      signal,
    });
    this.scenario = {
      id: String(response.data.scenario_id),
      name: String(response.data.name),
      status: "draft",
      basedOnSnapshot: `sha256:${snapshot.canonical_sha256}`,
      snapshotAsOf: String(snapshot.as_of),
      intervention: { type: "shift_completion_distribution", workItemId: "116ab4b3-b108-5f91-ab7e-111f7fba1d45", workItemKey: "AST-142", deltaWorkdays },
      seed: "20260713",
      sampleCount: 50000,
      modelVersion: "pert-monte-carlo/1.0.0",
      assumptions: [
        "Seeded PERT distributions use explicit synthetic work-item estimates.",
        "Weekends are non-working days; no additional holidays are introduced.",
        "The intervention shifts AST-142 only; it does not infer individual productivity.",
      ],
      digest: `sha256:${response.data.scenario_digest}`,
      etag: response.response.headers.get("etag") ?? String(response.data.etag),
    };
    return clone(this.scenario);
  }

  async confirmScenario(scenarioId: string, digest: string, etag: string, signal?: AbortSignal): Promise<ScenarioDraft> {
    if (!this.scenario || this.scenario.id !== scenarioId) throw new ApiProblem("Scenario not found.", 404, "scenario_not_found", false);
    const confirmed = await this.request<Wire>(`/v1/scenarios/${scenarioId}/confirm`, {
      method: "POST",
      headers: { ...this.mutation("scenario-confirm"), "If-Match": etag },
      body: JSON.stringify({ scenario_digest: digest.replace(/^sha256:/, "") }),
      signal,
    });
    this.scenario = { ...this.scenario, status: "confirmed", confirmedAt: String(confirmed.confirmed_at), etag: `"sha256:${confirmed.scenario_digest}"` };
    return clone(this.scenario);
  }

  async runSimulation(scenarioId: string, signal?: AbortSignal): Promise<SimulationComparison> {
    const response = await this.request<Wire>("/v1/simulations", {
      method: "POST",
      headers: this.mutation("simulation"),
      body: JSON.stringify({ scenario_id: scenarioId }),
      signal,
    });
    const run = response.run as Wire;
    const comparison = (run.comparison ?? run.baseline_comparison ?? {}) as Wire;
    const baseline = (comparison.baseline_quantiles ?? comparison.baseline_forecast ?? SIMULATION.baseline) as Wire;
    const scenario = (comparison.scenario_quantiles ?? comparison.scenario_forecast ?? run.uncertainty?.quantiles ?? SIMULATION.scenario) as Wire;
    const delta = (comparison.delta_workdays ?? comparison.paired_deltas ?? {}) as Wire;
    this.simulationId = String(run.simulation_id);
    return {
      runId: this.simulationId,
      status: "succeeded",
      seed: String(run.seed),
      sampleCount: Number(run.sample_count),
      baseline: { p50: String(baseline.p50), p80: String(baseline.p80), p95: String(baseline.p95) },
      scenario: { p50: String(scenario.p50), p80: String(scenario.p80), p95: String(scenario.p95) },
      deltaDays: {
        p50: String(delta.p50 ?? comparison.p50_delta_workdays ?? "—"),
        p80: String(delta.p80 ?? comparison.p80_delta_workdays ?? "—"),
        p95: String(delta.p95 ?? comparison.p95_delta_workdays ?? "—"),
      },
      probabilityOfImprovement: Number(comparison.probability_of_improvement ?? 0),
      baselineCriticalPath: clone(SIMULATION.baselineCriticalPath),
      scenarioCriticalPath: clone(SIMULATION.scenarioCriticalPath),
      sensitivity: (run.sensitivity as Wire[] ?? []).slice(0, 3).map((item, index) => ({
        key: index === 0 ? "AST-142" : index === 1 ? "AST-201" : "AST-173",
        label: index === 0 ? "SSO cutover duration" : index === 1 ? "Certification duration" : "Release candidate duration",
        score: Math.abs(Number(item.correlation ?? item.score ?? 0)),
      })),
      warnings: [...(run.warnings as unknown[] ?? []), ...(run.missing_data as unknown[] ?? [])].map(String),
      resultHash: `sha256:${run.result_sha256}`,
      completedAt: String(run.completed_at),
    };
  }

  async previewRemediation(signal?: AbortSignal): Promise<RemediationPreview> {
    if (!this.simulationId || this.lastEvidenceIds.length === 0) {
      throw new ApiProblem("Run the cited analysis and confirmed simulation before proposing remediation.", 409, "governance_evidence_required", false);
    }
    const response = await this.envelope<Wire>("/v1/actions/jira/remediation-previews", {
      method: "POST",
      headers: this.mutation("remediation-preview"),
      body: JSON.stringify({
        command: {
          action: "jira.issue.update",
          connectorInstallationId: "30000000-0000-4000-8000-000000000001",
          expectedIssueVersion: 7,
          issueKey: "AST-142",
          projectKey: "AST",
          set: { duedate: "2026-07-31", labels: ["digital-twin-remediation", "identity", "orion"], priorityId: "2" },
        },
        reason: "Apply the simulation-backed mitigation.",
        evidence_ids: this.lastEvidenceIds,
        simulation_id: this.simulationId,
      }),
      signal,
    });
    this.previewWire = response.data;
    this.previewEtag = response.response.headers.get("etag") ?? String(response.data.etag);
    const before = this.mapSnapshot(response.data.before);
    return {
      previewId: String(response.data.preview_id),
      issueKey: "AST-142",
      summary: "Complete SSO cutover",
      before,
      after: { version: before.version + 1, dueDate: "2026-07-31", priorityId: "2", priorityName: "High", labels: ["digital-twin-remediation", "identity", "orion"] },
      payload: {
        action: "jira.issue.update",
        connectorInstallationId: "30000000-0000-4000-8000-000000000001",
        expectedIssueVersion: 7,
        issueKey: "AST-142",
        projectKey: "AST",
        set: { dueDate: "2026-07-31", labels: ["digital-twin-remediation", "identity", "orion"], priorityId: "2" },
        tenantId: "10000000-0000-4000-8000-000000000001",
      },
      payloadHash: `sha256:${response.data.payload_hash}`,
      scope: "One issue in the allowlisted synthetic Jira project AST; no comments, assignments, or linked issues change.",
      risks: ["Moves the due date seven calendar days earlier", "Raises priority from Medium to High", "Stops if Jira no longer matches the exact version-7 snapshot"],
      rollback: "Restore the exact recorded values only if the post-action snapshot is unchanged, under a fresh two-person grant.",
      expiresAt: String(response.data.expires_at),
    };
  }

  async requestApproval(previewId: string, payloadHash: string, signal?: AbortSignal): Promise<ApprovalRequest> {
    if (!this.previewWire || previewId !== this.previewWire.preview_id || payloadHash.replace(/^sha256:/, "") !== this.previewWire.payload_hash) {
      throw new ApiProblem("The exact preview is no longer current.", 409, "payload_mismatch", false);
    }
    const approval = await this.request<Wire>(`/v1/actions/jira/remediation-previews/${previewId}/approval-requests`, {
      method: "POST",
      headers: { ...this.mutation("approval-request"), "If-Match": String(this.previewEtag) },
      body: "{}",
      signal,
    });
    return this.mapApproval(approval);
  }

  async approve(approvalId: string, role: ApprovalRole, payloadHash: string, idempotencyKey: string, signal?: AbortSignal): Promise<ApprovalRequest> {
    const approval = await this.request<Wire>(`/v1/approvals/${approvalId}/decisions`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ decision: "approve", payload_hash: payloadHash.replace(/^sha256:/, "") }),
      signal,
    }, role === "operations" ? "usr_aster_ops_approver" : "usr_aster_security_approver");
    return this.mapApproval(approval);
  }

  async execute(approvalId: string, idempotencyKey: string, signal?: AbortSignal): Promise<ActionReceipt> {
    const raw = await this.request<Wire>(`/v1/approvals/${approvalId}/execute`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: "{}",
      signal,
    });
    const replayed = this.receipt?.receiptId === String(raw.receipt_id);
    this.receipt = {
      receiptId: String(raw.receipt_id),
      status: "succeeded",
      issueKey: "AST-142",
      providerRequestId: String(raw.provider_request_id),
      idempotencyKey: String(raw.idempotency_key),
      payloadHash: `sha256:${raw.payload_hash}`,
      before: this.mapSnapshot(raw.before_snapshot),
      after: this.mapSnapshot(raw.after_snapshot),
      executedAt: String(raw.recorded_at),
      jiraPutCount: 1,
      replayed,
      rollbackExpiresAt: new Date(new Date(String(raw.recorded_at)).getTime() + 24 * 60 * 60 * 1000).toISOString(),
      auditEventIds: [...(raw.decision_ids as string[] ?? []), String(raw.receipt_id)],
    };
    return clone(this.receipt);
  }

  async previewCompensation(receiptId: string, signal?: AbortSignal): Promise<CompensationPreview> {
    if (!this.receipt || this.receipt.receiptId !== receiptId) throw new ApiProblem("Action receipt not found.", 404, "receipt_not_found", false);
    this.compensationWire = await this.request<Wire>(`/v1/action-receipts/${receiptId}/compensation-previews`, {
      method: "POST",
      headers: this.mutation("compensation-preview"),
      body: "{}",
      signal,
    });
    return this.mapCompensation(this.compensationWire);
  }

  async approveCompensation(compensationId: string, role: ApprovalRole, payloadHash: string, idempotencyKey: string, signal?: AbortSignal): Promise<CompensationPreview> {
    this.compensationWire = await this.request<Wire>(`/v1/approvals/${compensationId}/decisions`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ decision: "approve", payload_hash: payloadHash.replace(/^sha256:/, "") }),
      signal,
    }, role === "operations" ? "usr_aster_ops_approver" : "usr_aster_security_approver");
    return this.mapCompensation(this.compensationWire);
  }

  async compensate(compensationId: string, idempotencyKey: string, signal?: AbortSignal): Promise<CompensationPreview> {
    if (!this.compensationWire || this.compensationWire.status !== "approved") {
      throw new ApiProblem("Both distinct rollback approvals are required.", 409, "approval_incomplete", false);
    }
    const receipt = await this.request<Wire>(`/v1/approvals/${compensationId}/execute`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: "{}",
      signal,
    });
    const value = this.mapCompensation(this.compensationWire);
    value.status = receipt.status === "compensated" ? "compensated" : "conflict";
    return value;
  }

  async getAiStatus(signal?: AbortSignal): Promise<AiStatus> {
    const raw = await this.request<Wire>("/v1/ai/status", { signal });
    if (!raw || typeof raw !== "object" || typeof raw.status !== "string") {
      throw this.invalidAiResponse("Provider status is missing.");
    }
    if (raw.model_outputs_mutate_state !== false) throw this.invalidAiResponse("The facade did not confirm the no-mutation invariant.");
    const overallStatus = this.mapAiProviderStatus(raw.status);
    const providersRaw = raw.providers;
    if (providersRaw !== undefined && !Array.isArray(providersRaw)) {
      throw this.invalidAiResponse("Provider readiness must be an array.");
    }
    const providerReadiness: AiProviderReadiness[] = Array.isArray(providersRaw) && providersRaw.length
      ? providersRaw.map((provider) => this.mapAiProvider(provider as Wire))
      : [{
          provider: "ai-facade",
          displayName: "AI capability facade",
          status: overallStatus,
          detail: `The facade reported ${String(raw.status).replaceAll("_", " ")}; provider-level details were not disclosed.`,
          approvedModels: [],
          capabilities: [],
          liveVerified: false,
          lastCheckedAt: String(raw.checked_at ?? raw.observed_at ?? new Date().toISOString()),
        }];
    const advertisedTypes = Array.isArray(raw.agents) ? new Set(raw.agents.map(String)) : undefined;
    const agentProfiles = AI_DEMO_STATUS.agentProfiles.map((profile) => ({
      ...profile,
      canRun: overallStatus === "ready" && (!advertisedTypes || advertisedTypes.has(profile.agentType)) && this.canRunAiAgent(profile.agentType),
    }));
    const policy = (raw.knowledge_import ?? raw.import_policy ?? {}) as Wire;
    const storeReady = raw.durable_store_ready === true && policy.enabled !== false;
    const importAuthorized = this.hasServerCapability("connector.admin", "connector:admin");
    return {
      executionMode: "connected",
      profile: String(raw.profile ?? raw.environment ?? "Connected AI facade"),
      providerReadiness,
      agentProfiles,
      knowledgeImport: {
        enabled: storeReady && importAuthorized,
        storeReady,
        authorized: importAuthorized,
        maxBytes: this.positiveInteger(policy.max_bytes, 5 * 1024 * 1024),
        allowedMediaTypes: Array.isArray(policy.allowed_media_types) ? policy.allowed_media_types.map(String) : clone(AI_DEMO_STATUS.knowledgeImport.allowedMediaTypes),
        classifications: Array.isArray(policy.classifications)
          ? policy.classifications.map((item) => this.mapAiClassification(item))
          : clone(AI_DEMO_STATUS.knowledgeImport.classifications),
        sourceAcl: { visibility: "private" },
      },
      canReviewSuggestions: this.hasServerCapability("connector.admin", "connector:admin"),
      checkedAt: String(raw.checked_at ?? raw.observed_at ?? new Date().toISOString()),
    };
  }

  async getAiActivity(pageSize = 10, signal?: AbortSignal): Promise<AiActivityFeed> {
    const size = Math.max(1, Math.min(100, Math.trunc(pageSize)));
    const raw = await this.request<Wire>(`/v1/ai/activity?page_size=${size}`, { signal });
    if (!Array.isArray(raw.items)) throw this.invalidAiResponse("Agent activity items are missing.");
    const items = raw.items.map((item) => this.mapAiActivity(item as Wire));
    return {
      active: items.filter((item) => item.status === "queued" || item.status === "running"),
      recent: items.filter((item) => item.status !== "queued" && item.status !== "running"),
      pageSize: size,
      nextCursor: typeof raw.next_cursor === "string" ? raw.next_cursor : undefined,
    };
  }

  async runAiAgent(input: AiAgentRunInput, signal?: AbortSignal): Promise<AiAgentResult> {
    const agentInput = this.aiAgentInput(input);
    const raw = await this.request<Wire>("/v1/ai/agent-runs", {
      method: "POST",
      headers: this.mutation("ai-agent-run"),
      body: JSON.stringify({
        agent_type: input.agentType,
        input: agentInput,
        ...(input.retrievalQuery ? { retrieval_query: input.retrievalQuery } : {}),
        ...(input.maxEvidenceItems ? { max_evidence_items: input.maxEvidenceItems } : {}),
      }),
      signal,
    });
    return this.mapAiAgentResult(raw, input);
  }

  async queryAiRetrieval(query: string, limit = 5, _classifications: AiClassification[] = ["internal"], signal?: AbortSignal): Promise<AiExplainResult> {
    const size = Math.max(1, Math.min(20, Math.trunc(limit)));
    const raw = await this.request<Wire>("/v1/ai/retrieval/query", {
      method: "POST",
      body: JSON.stringify({ query, limit: size }),
      signal,
    });
    if (!Array.isArray(raw.items)) throw this.invalidAiResponse("Retrieval evidence items are missing.");
    if (raw.permission_trimmed !== true) throw this.invalidAiResponse("Retrieval did not confirm permission trimming.");
    const evidence = raw.items.map((item) => this.mapAiEvidence(item as Wire));
    const chainRaw = raw.causal_chain ?? raw.explanation?.causal_chain ?? [];
    const nodesRaw = raw.affected_nodes ?? raw.explanation?.affected_nodes ?? [];
    if (!Array.isArray(chainRaw) || !Array.isArray(nodesRaw)) throw this.invalidAiResponse("Explanation structure is invalid.");
    const confidenceValue = raw.confidence ?? raw.explanation?.confidence;
    const confidence = confidenceValue === undefined || confidenceValue === null ? null : this.confidenceOrThrow(confidenceValue, "Explanation confidence");
    return {
      query,
      summary: typeof raw.summary === "string"
        ? raw.summary
        : typeof raw.explanation?.summary === "string"
          ? raw.explanation.summary
          : `Retrieved ${evidence.length} authorized evidence item${evidence.length === 1 ? "" : "s"}. The facade did not return a causal chain, so no relationship was inferred.`,
      confidence,
      causalChain: chainRaw.map((step, index) => this.mapAiCausalStep(step as Wire, index)),
      evidence,
      affectedNodes: nodesRaw.map((node, index) => this.mapAiAffectedNode(node, index)),
      provider: String(raw.provider ?? raw.explanation?.provider ?? "not reported"),
      model: String(raw.model ?? raw.explanation?.model ?? "not reported"),
      generatedAt: String(raw.generated_at ?? raw.explanation?.generated_at ?? new Date().toISOString()),
      status: "retrieval_only",
      limitations: [
        ...(evidence.length ? [] : ["No evidence exists in the authorized private corpus for this query."]),
        ...(chainRaw.length ? [] : ["The retrieval response did not include a causal chain; no relationship was inferred by the UI."]),
        ...(nodesRaw.length ? [] : ["The retrieval response did not identify affected nodes."]),
      ],
      executionMode: "connected",
    };
  }

  async importAiKnowledge(input: AiKnowledgeImportInput, signal?: AbortSignal): Promise<AiKnowledgeImportResult> {
    const raw = await this.request<Wire>("/v1/ai/knowledge/import", {
      method: "POST",
      headers: this.mutation("ai-knowledge-import"),
      body: JSON.stringify({
        filename: input.filename,
        media_type: input.mediaType,
        content_base64: input.contentBase64,
        classification: input.classification,
        source_acl: input.sourceAcl,
      }),
      signal,
    });
    const importId = raw.document_id ?? raw.import_id;
    if (typeof importId !== "string" || typeof raw.status !== "string") throw this.invalidAiResponse("Knowledge import receipt is incomplete.");
    const status = String(raw.status).toLowerCase();
    if (!["accepted", "indexed", "rejected", "queued", "quarantined"].includes(status)) throw this.invalidAiResponse("Knowledge import status is invalid.");
    const sourceAcl = raw.source_acl as Wire | undefined;
    if (sourceAcl && sourceAcl.visibility !== "private") throw this.invalidAiResponse("Knowledge import returned an expansive ACL.");
    return {
      importId,
      filename: String(raw.filename ?? input.filename),
      status: status === "indexed" ? "indexed" : status === "rejected" || status === "quarantined" ? "rejected" : "accepted",
      classification: this.mapAiClassification(raw.classification ?? input.classification),
      sourceAcl: { visibility: "private" },
      byteCount: this.positiveInteger(raw.byte_count, Math.floor(input.contentBase64.length * 3 / 4)),
      contentHash: this.optionalSha(raw.content_sha256 ?? raw.content_hash ?? raw.sha256) ?? "sha256:not-reported",
      message: String(raw.message ?? (status === "quarantined"
        ? `The document was quarantined; ${this.nonNegativeInteger(raw.chunks_quarantined, 0)} chunk(s) require review.`
        : `The document was permission-filtered and indexed as ${this.nonNegativeInteger(raw.chunks_indexed, 0)} chunk(s).`)),
      acceptedAt: String(raw.imported_at ?? raw.accepted_at ?? raw.created_at ?? new Date().toISOString()),
      executionMode: "connected",
    };
  }

  async getAiSuggestions(signal?: AbortSignal): Promise<AiSuggestion[]> {
    const raw = await this.request<Wire>("/v1/ai/suggestions", { signal });
    if (!Array.isArray(raw.items)) throw this.invalidAiResponse("AI suggestion items are missing.");
    const suggestions = raw.items.map((item) => this.mapAiSuggestion(item as Wire));
    this.aiSuggestions = new Map(suggestions.map((item) => [item.suggestionId, item]));
    return suggestions;
  }

  async reviewAiSuggestion(input: AiSuggestionReview, signal?: AbortSignal): Promise<AiSuggestion> {
    const current = this.aiSuggestions.get(input.suggestionId);
    if (!current) throw new ApiProblem("AI suggestion was not found in the reviewed list.", 404, "ai_suggestion_not_found", false);
    const raw = await this.request<Wire>(`/v1/ai/suggestions/${encodeURIComponent(input.suggestionId)}/reviews`, {
      method: "POST",
      headers: this.mutation("ai-suggestion-review"),
      body: JSON.stringify({ decision: input.decision, reason: input.reason }),
      signal,
    });
    if (String(raw.suggestion_id) !== input.suggestionId || String(raw.decision).toLowerCase() !== input.decision || raw.mutation_performed !== false) {
      throw this.invalidAiResponse("Suggestion review was not safely acknowledged.");
    }
    const reviewed: AiSuggestion = {
      ...current,
      status: "PENDING_REVIEW",
      reviewDecision: input.decision,
      reviewedAt: String(raw.reviewed_at ?? raw.created_at ?? new Date().toISOString()),
      reviewReason: input.reason,
      noGraphMutation: true,
    };
    this.aiSuggestions.set(reviewed.suggestionId, reviewed);
    return clone(reviewed);
  }

  async getAssets(signal?: AbortSignal): Promise<AssetSummary[]> {
    const page = await this.request<Wire>("/v1/assets", { signal });
    return (page.items as Wire[] ?? []).map((raw) => this.mapAsset(raw));
  }

  async getAssetTwin(assetId: string, signal?: AbortSignal): Promise<AssetTwinSnapshot> {
    const raw = await this.request<Wire>(`/v1/assets/${encodeURIComponent(assetId)}/twin`, { signal });
    const assetRaw = (raw.asset ?? raw) as Wire;
    const summary = this.mapAsset(assetRaw);
    const controlRaw = (raw.control?.state ?? raw.control_state ?? {}) as Wire;
    const controlState = this.mapAssetControlState(controlRaw, summary.version);
    this.assetControlStates.set(assetId, controlState);

    const components = (raw.components as Wire[] ?? []).map((component, index) => ({
      componentId: String(component.component_id ?? component.id ?? `component-${index}`),
      name: String(component.display_name ?? component.name ?? component.label ?? `Component ${index + 1}`),
      kind: this.mapComponentKind(String(component.kind ?? component.component_type ?? component.type ?? "pump")),
      status: this.mapComponentStatus(String(component.status ?? component.condition ?? "normal")),
      description: String(component.description ?? component.detail ?? `${String(component.name ?? component.component_type ?? "Asset component")} has ${Number(component.operating_hours ?? 0).toLocaleString()} recorded synthetic operating hours${component.installed_at ? ` since ${String(component.installed_at).slice(0, 10)}` : ""}.`),
      sensorTags: (component.sensor_tags ?? component.sensor_ids ?? component.sensors ?? []).map(String),
    }));

    const analytics = (raw.analytics ?? {}) as Wire;
    const bearingComponentId = components.find((component) => component.kind === "bearing")?.componentId ?? components[0]?.componentId ?? "unknown-component";
    const pumpComponentId = components.find((component) => component.kind === "casing")?.componentId
      ?? components.find((component) => component.kind === "impeller")?.componentId
      ?? bearingComponentId;
    const predictionSource = (analytics.predictions as Wire[] ?? []);
    const predictions = predictionSource.map((prediction, index) => {
      const confidence = (prediction.confidence ?? {}) as Wire;
      const predictionConfidence = Number(prediction.probability ?? confidence.score ?? prediction.score ?? 0);
      const failureMode = String(prediction.predicted_failure_mode ?? prediction.failure_mode ?? "operating_anomaly");
      const horizonDays = prediction.horizon_days === null ? 365 : Number(prediction.horizon_days ?? 7);
      const contributions = (prediction.contributions as Wire[] ?? []);
      return {
        predictionId: String(prediction.prediction_id ?? prediction.anomaly_id ?? prediction.id ?? `prediction-${index}`),
        componentId: String(prediction.component_id ?? prediction.component_ref ?? (failureMode.includes("bearing") ? bearingComponentId : pumpComponentId)),
        severity: this.mapPredictionSeverity(String(prediction.severity ?? prediction.level ?? (failureMode === "no_failure_mode_indicated" ? "info" : "warning"))),
        title: String(prediction.title ?? prediction.name ?? (failureMode === "drive_end_bearing_degradation" ? "Drive-end bearing degradation forecast" : "No failure threshold forecast")),
        confidence: predictionConfidence > 1 ? predictionConfidence / 100 : predictionConfidence,
        horizonHours: Math.max(1, Math.round(Number(prediction.horizon_hours ?? prediction.time_to_event_hours ?? horizonDays * 24))),
        horizonLabel: prediction.horizon_days === null || failureMode === "no_failure_mode_indicated"
          ? "No threshold crossing in 365-day horizon"
          : `Modeled threshold within ${Number(prediction.horizon_days ?? horizonDays).toFixed(1)} days`,
        explanation: String(prediction.explanation ?? prediction.rationale ?? confidence.basis ?? prediction.caveat ?? "Telemetry differs from the learned operating envelope."),
        evidence: contributions.length
          ? contributions.map((item) => `${String(item.signal).replaceAll("_", " ")}: ${Number(item.current_value).toFixed(2)} (${Number(item.contribution * 100).toFixed(0)}% contribution, z=${Number(item.z_score).toFixed(2)})`)
          : (prediction.evidence ?? prediction.drivers ?? prediction.signals ?? []).map(String),
        recommendation: String(prediction.recommended_maintenance ?? prediction.recommendation ?? prediction.recommended_action ?? "Continue monitoring."),
        modelVersion: String(prediction.model_version ?? analytics.model_card?.model_version ?? analytics.model_card?.version ?? "asset-anomaly/1.0.0"),
        generatedAt: String(prediction.generated_at ?? prediction.observed_at ?? raw.current_telemetry?.observed_at ?? new Date().toISOString()),
      } as FailurePrediction;
    });

    (analytics.anomalies as Wire[] ?? []).forEach((anomaly, index) => {
      const contributions = (anomaly.contributions as Wire[] ?? []);
      const leadingSignal = String(contributions[0]?.signal ?? "");
      predictions.push({
        predictionId: String(anomaly.anomaly_id ?? `anomaly-${index}`),
        componentId: leadingSignal.includes("vibration") || leadingSignal.includes("temperature") ? bearingComponentId : pumpComponentId,
        severity: this.mapPredictionSeverity(String(anomaly.severity ?? "info")),
        title: String(anomaly.summary ?? "Current multivariate operating anomaly"),
        confidence: Math.min(1, Number(anomaly.anomaly_score ?? 0) / 10),
        horizonHours: 24,
        horizonLabel: "Current-condition detector signal",
        explanation: `Current-condition detector using ${String(anomaly.method ?? "multivariate telemetry analysis").replaceAll("_", " ")}.`,
        evidence: contributions.map((item) => `${String(item.signal).replaceAll("_", " ")}: z=${Number(item.z_score).toFixed(2)}, ${Number(item.contribution * 100).toFixed(0)}% contribution`),
        recommendation: "Review the contributing signals with a qualified operator; the synthetic detector does not authorize maintenance or control.",
        modelVersion: String(anomaly.model_version ?? analytics.model_card?.model_version ?? "asset-anomaly/1.0.0"),
        generatedAt: String(anomaly.detected_at ?? raw.current_telemetry?.observed_at ?? new Date().toISOString()),
      });
    });

    const lifecycle = (raw.lifecycle ?? {}) as Wire;
    const lifecycleStages = (lifecycle.stages as Wire[] ?? []);
    const recordedEvents = (lifecycle.events as Wire[] ?? []);
    const lifecycleSource = lifecycleStages.length ? lifecycleStages : recordedEvents;
    const lifecycleEvents = lifecycleSource.map((event, index) => {
      const recorded = lifecycleStages.length ? recordedEvents[Math.min(index, recordedEvents.length - 1)] ?? {} : event;
      const stageValue = String(event.stage ?? event.event_type ?? event.type ?? event.name ?? "service");
      return {
        eventId: String(event.event_id ?? event.id ?? `lifecycle-stage-${stageValue}`),
        stage: this.mapLifecycleStage(stageValue),
        status: this.mapLifecycleStatus(String(event.status ?? "complete")),
        date: String(event.completed_at ?? event.date ?? event.occurred_at ?? event.started_at ?? event.planned_at ?? ""),
        title: String(event.title ?? recorded.title ?? this.lifecycleTitle(stageValue)),
        detail: String(event.detail ?? event.description ?? recorded.description ?? `The ${stageValue.replaceAll("_", " ")} stage is ${String(event.status ?? "recorded")}.`),
        artifact: event.evidence_ref ?? event.artifact ?? event.document_ref ?? recorded.work_order_ref ? String(event.evidence_ref ?? event.artifact ?? event.document_ref ?? recorded.work_order_ref) : undefined,
      };
    });

    const commandDescriptors = (raw.control?.available_commands as Array<string | Wire> ?? []);
    const available = commandDescriptors.map((item) => String(typeof item === "string" ? item : item.type));
    const safeRange = (type: string) => (commandDescriptors.find((item) => typeof item !== "string" && item.type === type) as Wire | undefined)?.safe_range as Wire | undefined;
    return {
      asset: {
        ...summary,
        version: controlState.version,
        lifecycleStage: this.mapLifecycleStage(String(raw.lifecycle?.current_stage ?? summary.lifecycleStage)),
        manufacturer: String(assetRaw.manufacturer ?? "Unknown manufacturer"),
        installedAt: String(assetRaw.installed_at ?? assetRaw.commissioned_at ?? lifecycleEvents.find((event) => event.stage === "commission")?.date ?? ""),
        designFlowM3H: Number(assetRaw.design_flow_m3h ?? assetRaw.rated_flow_m3h ?? assetRaw.specifications?.design_flow_m3h ?? 0),
        designHeadM: Number(assetRaw.design_head_m ?? assetRaw.rated_head_m ?? assetRaw.specifications?.design_head_m ?? 0),
        ratedSpeedRpm: Number(assetRaw.rated_speed_rpm ?? assetRaw.specifications?.rated_speed_rpm ?? 3600),
      },
      components,
      predictions,
      lifecycle: lifecycleEvents,
      control: {
        supportedCommands: available.filter((command): command is AssetTwinSnapshot["control"]["supportedCommands"][number] => ["set_speed_pct", "set_valve_pct", "emergency_stop", "reset"].includes(command)),
        minSpeedPct: Number(raw.control?.limits?.speed_pct?.min ?? safeRange("set_speed_pct")?.min ?? 30),
        maxSpeedPct: Number(raw.control?.limits?.speed_pct?.max ?? safeRange("set_speed_pct")?.max ?? 100),
        minValvePct: Number(raw.control?.limits?.valve_pct?.min ?? safeRange("set_valve_pct")?.min ?? 5),
        maxValvePct: Number(raw.control?.limits?.valve_pct?.max ?? safeRange("set_valve_pct")?.max ?? 100),
        state: controlState,
        mode: "synthetic_sandbox",
      },
      projectionAsOf: String(raw.data_watermark?.observed_at ?? raw.current_telemetry?.observed_at ?? raw.projection_as_of ?? new Date().toISOString()),
    };
  }

  async getAssetTelemetry(assetId: string, limit = 30, signal?: AbortSignal): Promise<AssetTelemetry> {
    const raw = await this.request<Wire>(`/v1/assets/${encodeURIComponent(assetId)}/telemetry?limit=${Math.max(1, Math.min(limit, 20))}`, { signal });
    const frames = (raw.samples as Wire[] ?? raw.telemetry_history as Wire[] ?? []);
    const current = raw.current_telemetry as Wire | undefined;
    if (current && !frames.some((frame) => frame.sequence === current.sequence)) frames.push(current);
    const points = frames.map((frame) => this.mapTelemetryFrame(frame));
    if (raw.control_state) this.assetControlStates.set(assetId, this.mapAssetControlState(raw.control_state as Wire));
    return {
      assetId: String(raw.asset_id ?? assetId),
      sampledAt: String(current?.observed_at ?? points.at(-1)?.timestamp ?? new Date().toISOString()),
      receivedAt: new Date().toISOString(),
      intervalSeconds: Number(raw.interval_seconds ?? 5),
      points,
      signals: this.mapTelemetrySignals(current ?? frames.at(-1) ?? {}),
    };
  }

  async previewAssetCommand(assetId: string, command: AssetCommand, signal?: AbortSignal): Promise<AssetCommandPreview> {
    const expectedVersion = this.assetControlStates.get(assetId)?.version;
    if (expectedVersion === undefined) throw new ApiProblem("Load the current asset twin before previewing a command.", 409, "asset_state_required", true);
    const response = await this.envelope<Wire>(`/v1/assets/${encodeURIComponent(assetId)}/control-previews`, {
      method: "POST",
      headers: this.mutation("asset-control-preview"),
      body: JSON.stringify({ command, expected_version: expectedVersion, reason: "Operator-requested control adjustment from the digital twin." }),
      signal,
    });
    const raw = response.data;
    const before = this.mapAssetControlState((raw.before_state ?? {}) as Wire, expectedVersion);
    const after = this.mapAssetControlState((raw.after_state ?? {}) as Wire, expectedVersion + 1);
    const safety = (raw.safety ?? {}) as Wire;
    const preview: AssetCommandPreview = {
      previewId: String(raw.preview_id),
      assetId: String(raw.asset_id ?? assetId),
      command: this.mapAssetCommand((raw.command ?? command) as Wire | AssetCommand),
      expectedAssetVersion: Number(raw.expected_version ?? before.version),
      payloadHash: String(raw.payload_hash).startsWith("sha256:") ? String(raw.payload_hash) : `sha256:${raw.payload_hash}`,
      currentState: before,
      predictedState: after,
      safetyChecks: (safety.checks as Wire[] ?? raw.safety_checks as Wire[] ?? []).map((check) => ({
        check: String(check.check ?? check.name ?? check.code ?? "Safety check"),
        passed: Boolean(check.passed ?? check.status === "passed"),
        detail: String(check.detail ?? check.message ?? check.description ?? ""),
      })),
      risks: (safety.risks ?? raw.risks ?? []).map(String),
      expiresAt: String(raw.expires_at ?? new Date(Date.now() + 15 * 60_000).toISOString()),
      executionMode: "simulation",
      externalWrite: false,
    };
    this.assetCommandPreviews.set(preview.previewId, { preview, etag: response.response.headers.get("etag") ?? String(raw.etag ?? "") });
    return clone(preview);
  }

  async executeAssetCommand(
    assetId: string,
    previewId: string,
    payloadHash: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<AssetCommandReceipt> {
    const stored = this.assetCommandPreviews.get(previewId);
    if (!stored || stored.preview.assetId !== assetId || stored.preview.payloadHash !== payloadHash) {
      throw new ApiProblem("The exact command preview is no longer current.", 409, "asset_command_payload_mismatch", false);
    }
    const response = await this.envelope<Wire>(`/v1/assets/${encodeURIComponent(assetId)}/control-previews/${encodeURIComponent(previewId)}/execute`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey, "If-Match": stored.etag },
      body: "{}",
      signal,
    });
    const raw = response.data;
    const before = this.mapAssetControlState((raw.before_state ?? {}) as Wire, stored.preview.currentState.version);
    const after = this.mapAssetControlState((raw.after_state ?? {}) as Wire, before.version + 1);
    this.assetControlStates.set(assetId, after);
    const receipt: AssetCommandReceipt = {
      receiptId: String(raw.receipt_id),
      assetId: String(raw.asset_id ?? assetId),
      status: raw.status === "rejected" ? "rejected" : "succeeded",
      command: this.mapAssetCommand((raw.command ?? stored.preview.command) as Wire | AssetCommand),
      assetVersionBefore: before.version,
      assetVersionAfter: after.version,
      idempotencyKey: String(raw.idempotency_key ?? idempotencyKey),
      payloadHash: stored.preview.payloadHash,
      executedAt: String(raw.executed_at ?? raw.recorded_at ?? new Date().toISOString()),
      replayed: this.assetCommandReceipts.has(idempotencyKey) || Boolean(raw.replayed ?? response.response.headers.get("idempotent-replay") === "true"),
      auditEventId: String(raw.audit_event_id ?? raw.audit_evidence?.event_id ?? raw.receipt_id),
      simulation: true,
      externalWrite: false,
    };
    this.assetCommandReceipts.set(idempotencyKey, receipt);
    return receipt;
  }

  async interpretEvent(input: string, intent: EventIntent, signal?: AbortSignal): Promise<EventInterpretation> {
    const raw = await this.request<Wire>("/v1/event-intelligence/interpretations", {
      method: "POST",
      headers: this.mutation("event-interpretation"),
      body: JSON.stringify({ text: input, requested_mode: intent }),
      signal,
    });
    const events = raw.events as Wire[] ?? [];
    if (!events.length) throw new ApiProblem("The statement did not contain an event that could be reviewed.", 422, "event_not_extracted", false);
    const interpretationId = String(raw.interpretation_id ?? events[0].interpretation_id);
    const mapped = events.map((event) => {
      const previewId = `${interpretationId}:${String(event.event_id)}`;
      this.eventWires.set(String(event.event_id), event);
      this.eventPreviewWires.set(previewId, event);
      const model = (raw.model ?? {}) as Wire;
      this.eventModelWires.set(previewId, model);
      return this.mapEventInterpretation(previewId, event, model);
    });
    mapped[0].additionalEvents = mapped.slice(1);
    return mapped[0];
  }

  async reviewEvent(
    previewId: string,
    digest: string,
    targetMode: "reality" | "scenario",
    selectedEntityIds: string[],
    signal?: AbortSignal,
  ): Promise<EventReview> {
    const current = this.eventPreviewWires.get(previewId);
    if (!current || this.eventDigest(current) !== digest) {
      throw new ApiProblem("The exact event interpretation changed. Analyze it again before review.", 412, "event_preview_mismatch", false);
    }
    const resolutions = (current.entity_resolutions as Wire[] ?? []).map((resolution) => {
      const candidates = resolution.candidates as Wire[] ?? [];
      const selected = candidates.find((candidate) => selectedEntityIds.includes(String(candidate.entity_id)));
      return { mention: String(resolution.mention), selected_entity_id: selected ? String(selected.entity_id) : null };
    });
    const response = await this.envelope<Wire>(`/v1/event-intelligence/events/${encodeURIComponent(String(current.event_id))}/reviews`, {
      method: "POST",
      headers: { ...this.mutation("event-review"), "If-Match": String(current.etag) },
      body: JSON.stringify({
        expected_version: Number(current.version),
        verification_status: targetMode === "scenario" ? "unverified" : "confirmed",
        target_mode: targetMode,
        entity_resolutions: resolutions,
        notes: "Human review from the Event intelligence workspace; exact payload and entity selections confirmed.",
      }),
      signal,
    });
    const reviewed = response.data;
    this.eventWires.set(String(reviewed.event_id), reviewed);
    this.eventPreviewWires.set(previewId, reviewed);
    const reviewedInterpretation = this.mapEventInterpretation(previewId, reviewed, this.eventModelWires.get(previewId) ?? {});
    return {
      eventId: String(reviewed.event_id),
      previewId,
      eventVersion: Number(reviewed.version),
      status: "reviewed",
      targetMode,
      selectedEntityIds: clone(selectedEntityIds),
      reviewedPayloadHash: this.normalizeSha(String(reviewed.reviewed_payload_hash)),
      etag: response.response.headers.get("etag") ?? String(reviewed.etag),
      reviewedInterpretation,
    };
  }

  async requestEventApproval(review: EventReview, signal?: AbortSignal): Promise<EventApproval> {
    const current = this.eventWires.get(review.eventId);
    if (!current || this.normalizeSha(String(current.reviewed_payload_hash)) !== review.reviewedPayloadHash) {
      throw new ApiProblem("Review the exact event payload before requesting approval.", 412, "event_review_mismatch", false);
    }
    const response = await this.envelope<Wire>(`/v1/event-intelligence/events/${encodeURIComponent(review.eventId)}/approval-requests`, {
      method: "POST",
      headers: { ...this.mutation("event-approval-request"), "If-Match": review.etag },
      body: JSON.stringify({ expected_version: review.eventVersion, reviewed_payload_hash: review.reviewedPayloadHash.replace(/^sha256:/, ""), reason: "Record the exact reviewed event in the synthetic projection or its isolated scenario branch." }),
      signal,
    });
    this.eventApprovalWires.set(String(response.data.approval_id), response.data);
    return this.mapEventApproval(response.data);
  }

  async approveEvent(approvalId: string, role: "operations" | "security", payloadHash: string, signal?: AbortSignal): Promise<EventApproval> {
    const current = this.eventApprovalWires.get(approvalId);
    if (!current || this.normalizeSha(String(current.payload_hash)) !== payloadHash) {
      throw new ApiProblem("The approval is not bound to this reviewed event payload.", 412, "event_approval_payload_mismatch", false);
    }
    const actorAlias = role === "operations" ? "usr_aster_ops_approver" : "usr_aster_security_approver";
    const updated = await this.request<Wire>(`/v1/event-intelligence/approval-requests/${encodeURIComponent(approvalId)}/decisions`, {
      method: "POST",
      headers: this.mutation(`event-${role}-approval`),
      body: JSON.stringify({ decision: "approve", payload_hash: payloadHash.replace(/^sha256:/, "") }),
      signal,
    }, actorAlias);
    this.eventApprovalWires.set(approvalId, updated);
    return this.mapEventApproval(updated);
  }

  async applyReviewedEvent(review: EventReview, approval: EventApproval, signal?: AbortSignal): Promise<EventDecisionReceipt> {
    if (approval.status !== "approved" || approval.payloadHash !== review.reviewedPayloadHash) {
      throw new ApiProblem("The exact reviewed event requires complete approval before it can be recorded.", 409, "event_approval_incomplete", false);
    }
    const currentResponse = await this.envelope<Wire>(`/v1/event-intelligence/events/${encodeURIComponent(review.eventId)}`, { signal });
    const current = currentResponse.data;
    this.eventWires.set(review.eventId, current);
    const idempotencyKey = `event-${review.targetMode}-${review.eventId}-v${review.eventVersion}`;
    const response = await this.envelope<Wire>(`/v1/event-intelligence/events/${encodeURIComponent(review.eventId)}/apply`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey, "If-Match": currentResponse.response.headers.get("etag") ?? String(current.etag) },
      body: JSON.stringify({ expected_version: Number(current.version), reviewed_payload_hash: review.reviewedPayloadHash.replace(/^sha256:/, ""), approval_id: approval.approvalId }),
      signal,
    });
    this.eventReceiptWires.set(review.eventId, response.data);
    return this.mapEventReceipt(response.data, review.previewId, idempotencyKey, review.reviewedPayloadHash);
  }

  async decideEvent(
    previewId: string,
    digest: string,
    decision: "apply" | "branch_scenario",
    selectedEntityIds: string[],
    _idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<EventDecisionReceipt> {
    const review = await this.reviewEvent(previewId, digest, decision === "apply" ? "reality" : "scenario", selectedEntityIds, signal);
    let approval = await this.requestEventApproval(review, signal);
    if (review.targetMode === "reality") {
      approval = await this.approveEvent(approval.approvalId, "operations", approval.payloadHash, signal);
      approval = await this.approveEvent(approval.approvalId, "security", approval.payloadHash, signal);
    }
    return this.applyReviewedEvent(review, approval, signal);
  }

  async getEventTimeline(signal?: AbortSignal): Promise<EventTimelineEntry[]> {
    const [timelinePage, eventPage] = await Promise.all([
      this.request<Wire>("/v1/event-intelligence/timeline", { signal }),
      this.request<Wire>("/v1/event-intelligence/events", { signal }),
    ]);
    const events = new Map((eventPage.items as Wire[] ?? []).map((event) => [String(event.event_id), event]));
    const timelineEntries = (timelinePage.items as Wire[] ?? []).filter((entry) => entry.action !== "baseline");
    const latestRealityEventId = [...timelineEntries].reverse().find((entry) => {
      const event = events.get(String(entry.event_id));
      return entry.action === "event_applied" && event?.mode === "reality" && event?.status === "applied";
    })?.event_id;
    return timelineEntries.map((entry) => {
      const event = events.get(String(entry.event_id)) ?? {};
      const action = String(entry.action);
      return {
        timelineEntryId: String(entry.timeline_entry_id ?? `${String(entry.event_id)}:${action}:${String(entry.sequence ?? entry.recorded_at ?? "unknown")}`),
        eventId: String(entry.event_id),
        title: String(event.event_type?.label ?? entry.summary ?? "Recorded event"),
        eventType: String(event.event_type?.code ?? "event.unknown"),
        occurredAt: String(event.occurred_at?.value ?? entry.occurred_at ?? ""),
        recordedAt: String(entry.recorded_at ?? event.recorded_at ?? entry.occurred_at ?? ""),
        status: action === "event_rolled_back" ? "rolled_back" : event.mode === "scenario" ? "scenario" : "applied",
        confidenceLevel: this.mapEventConfidenceLevel(String(event.confidence?.level ?? "possible")),
        confidence: Number(event.confidence?.score ?? 0.5),
        effectCount: Number((event.impacts as Wire[] ?? []).length),
        graphVersionBefore: this.numberOr(entry.graph_version_before, this.numberOr(event.graph_snapshot_version)),
        graphVersionAfter: this.numberOr(entry.graph_version_after, this.numberOr(event.graph_snapshot_version)),
        rollbackAvailable: Boolean(entry.reversible && action === "event_applied" && (event.mode !== "reality" || String(entry.event_id) === String(latestRealityEventId))),
        receiptId: entry.receipt_id
          ? String(entry.receipt_id)
          : this.eventReceiptWires.get(String(entry.event_id))?.receipt_id
            ? String(this.eventReceiptWires.get(String(entry.event_id))?.receipt_id)
            : undefined,
        summary: String(entry.summary),
      } satisfies EventTimelineEntry;
    });
  }

  async getEventBranches(signal?: AbortSignal): Promise<EventScenarioBranch[]> {
    const page = await this.request<Wire>("/v1/event-intelligence/branches", { signal });
    return (page.items as Wire[] ?? []).map((branch) => this.mapEventBranch(branch));
  }

  async getEventReplay(eventId: string, signal?: AbortSignal): Promise<EventReplay> {
    const raw = await this.request<Wire>(`/v1/event-intelligence/events/${encodeURIComponent(eventId)}/replay`, { signal });
    const graph = raw.graph as Wire | null | undefined;
    return {
      eventId: String(raw.event_id),
      mode: raw.mode === "scenario" ? "scenario" : "reality",
      currentStatus: String(raw.current_status ?? "unknown"),
      reconstructable: Boolean(raw.reconstructable),
      graph: graph ? {
        beforeVersion: this.numberOr(graph.before_version),
        afterVersion: this.numberOr(graph.after_version),
        beforeStateHash: this.optionalSha(graph.before_state_hash) ?? "",
        afterStateHash: this.optionalSha(graph.after_state_hash) ?? "",
      } : undefined,
      entityChanges: (raw.entity_changes as Wire[] ?? []).map((change) => ({
        entityId: String(change.entity_id),
        displayName: String(change.display_name ?? change.entity_id),
        before: change.before && typeof change.before === "object" ? change.before as Record<string, unknown> : null,
        after: change.after && typeof change.after === "object" ? change.after as Record<string, unknown> : null,
      })),
      relationshipChanges: (raw.relationship_changes as Wire[] ?? []).map((change) => ({
        relationshipId: String(change.relationship_id),
        type: String(change.type),
        fromEntityId: String(change.from_entity_id),
        toEntityId: String(change.to_entity_id),
        beforeState: change.before_state === null || change.before_state === undefined ? null : String(change.before_state),
        afterState: change.after_state === null || change.after_state === undefined ? null : String(change.after_state),
      })),
      receipts: (raw.receipts as Wire[] ?? []).map((receipt) => ({
        receiptId: String(receipt.receipt_id),
        action: receipt.action === "rollback" ? "rollback" : receipt.action === "apply_scenario" ? "apply_scenario" : "apply_reality",
        recordedAt: String(receipt.recorded_at ?? ""),
        graphVersionBefore: this.numberOr(receipt.graph_version_before),
        graphVersionAfter: this.numberOr(receipt.graph_version_after),
        outboxPosition: this.numberOr(receipt.outbox_position),
      })),
      timeline: (raw.timeline as Wire[] ?? []).map((entry) => ({
        timelineEntryId: String(entry.timeline_entry_id),
        action: entry.action === "baseline" ? "baseline" : entry.action === "event_rolled_back" ? "event_rolled_back" : "event_applied",
        recordedAt: String(entry.recorded_at ?? entry.occurred_at ?? ""),
        receiptId: entry.receipt_id ? String(entry.receipt_id) : undefined,
      })),
      branch: raw.branch ? this.mapEventBranch(raw.branch as Wire) : undefined,
    };
  }

  async compareEventBranches(leftBranchId: string, rightBranchId: string, signal?: AbortSignal): Promise<EventBranchComparison> {
    const raw = await this.request<Wire>("/v1/event-intelligence/branches/compare", {
      method: "POST",
      body: JSON.stringify({ left_branch_id: leftBranchId, right_branch_id: rightBranchId }),
      signal,
    });
    return {
      left: this.mapEventBranch(raw.left as Wire),
      right: this.mapEventBranch(raw.right as Wire),
      sameBaseSnapshot: Boolean(raw.same_base_snapshot),
      commonEventIds: (raw.common_event_ids as unknown[] ?? []).map(String),
      leftOnlyEventIds: (raw.left_only_event_ids as unknown[] ?? []).map(String),
      rightOnlyEventIds: (raw.right_only_event_ids as unknown[] ?? []).map(String),
      stateHashEqual: Boolean(raw.state_hash_equal),
    };
  }

  async rollbackEvent(eventId: string, receiptId: string, idempotencyKey: string, signal?: AbortSignal): Promise<EventDecisionReceipt> {
    const response = await this.envelope<Wire>(`/v1/event-intelligence/events/${encodeURIComponent(eventId)}`, { signal });
    const current = response.data;
    const appliedHash = String(current.applied_payload_hash ?? this.eventReceiptWires.get(eventId)?.payload_hash ?? "");
    if (!appliedHash) throw new ApiProblem("This event has no applied payload to roll back.", 409, "event_rollback_unavailable", false);
    const rolledBack = await this.envelope<Wire>(`/v1/event-intelligence/events/${encodeURIComponent(eventId)}/rollback`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey, "If-Match": response.response.headers.get("etag") ?? String(current.etag) },
      body: JSON.stringify({ expected_version: Number(current.version), applied_payload_hash: appliedHash, reason: `Operator-requested compensation for receipt ${receiptId}.` }),
      signal,
    }, "usr_aster_ops_approver");
    return this.mapEventReceipt(rolledBack.data, String(current.interpretation_id ?? "historical-event"), idempotencyKey, this.normalizeSha(appliedHash));
  }

  private mapAiProvider(raw: Wire): AiProviderReadiness {
    const provider = raw.provider ?? raw.provider_id ?? raw.name;
    const liveVerified = raw.live_provider_verified === true;
    const status = raw.status ?? raw.readiness ?? (raw.configured === true ? (liveVerified ? "ready" : "degraded") : "unavailable");
    if (typeof provider !== "string" || typeof status !== "string") throw this.invalidAiResponse("A provider readiness record is incomplete.");
    return {
      provider,
      displayName: String(raw.display_name ?? raw.name ?? provider),
      status: this.mapAiProviderStatus(status),
      detail: String(raw.detail ?? raw.message ?? (raw.configured === true
        ? liveVerified
          ? "Provider configuration is present and a live acceptance check is recorded."
          : "Provider configuration is present, but this process has not recorded a live provider acceptance check. Requests still fail closed on provider errors."
        : "Provider is not configured.")),
      approvedModels: Array.isArray(raw.approved_models) ? raw.approved_models.map(String) : Array.isArray(raw.models) ? raw.models.map(String) : raw.model ? [String(raw.model)] : [],
      capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : [],
      liveVerified,
      lastCheckedAt: String(raw.last_checked_at ?? raw.checked_at ?? raw.observed_at ?? new Date().toISOString()),
    };
  }

  private mapAiProviderStatus(value: unknown): AiProviderReadiness["status"] {
    const normalized = String(value).toLowerCase();
    if (["ready", "healthy", "configured", "available", "ok"].includes(normalized)) return "ready";
    if (["degraded", "limited", "partial"].includes(normalized)) return "degraded";
    if (["offline_preview", "offline-preview"].includes(normalized)) return "offline_preview";
    return "unavailable";
  }

  private mapAiActivity(raw: Wire): AiAgentActivity {
    const runId = raw.activity_id ?? raw.run_id ?? raw.id;
    const agentType = raw.agent_type ?? raw.profile_id ?? raw.profile;
    if (typeof runId !== "string" || (agentType !== null && agentType !== undefined && (typeof agentType !== "string" || !this.isAiAgentType(agentType)))) {
      throw this.invalidAiResponse("An agent activity record is missing a supported identifier.");
    }
    const typedAgentType = typeof agentType === "string" && this.isAiAgentType(agentType) ? agentType : undefined;
    const status = this.mapAiRunStatus(raw.status ?? raw.state);
    const label = typedAgentType ? this.aiAgentLabel(typedAgentType) : String(raw.kind ?? "AI activity").replaceAll("_", " ");
    return {
      runId,
      agentType: typedAgentType,
      agentLabel: String(raw.agent_label ?? raw.profile_name ?? label),
      status,
      taskSummary: String(raw.task_summary ?? raw.input_summary ?? raw.input ?? `${String(raw.kind ?? "AI activity").replaceAll("_", " ")} record`),
      initiatedBy: String(raw.initiated_by ?? raw.created_by ?? "Current actor"),
      provider: String(raw.provider ?? "not reported"),
      model: String(raw.model ?? raw.model_id ?? "not reported"),
      startedAt: String(raw.started_at ?? raw.created_at ?? new Date().toISOString()),
      completedAt: raw.completed_at ? String(raw.completed_at) : undefined,
      evidenceCount: this.nonNegativeInteger(raw.evidence_count, Array.isArray(raw.evidence_ids) ? raw.evidence_ids.length : Array.isArray(raw.evidence) ? raw.evidence.length : 0),
      toolInvocationCount: this.nonNegativeInteger(raw.tool_invocation_count, Array.isArray(raw.tool_invocations) ? raw.tool_invocations.length : 0),
    };
  }

  private mapAiRunStatus(value: unknown): AiAgentRunStatus {
    const normalized = String(value).toLowerCase();
    if (normalized === "pending_review") return "PENDING_REVIEW";
    if (["queued", "running", "succeeded", "approved", "rejected", "failed", "cancelled"].includes(normalized)) return normalized as AiAgentRunStatus;
    throw this.invalidAiResponse("An agent run has an unsupported status.");
  }

  private mapAiAgentResult(raw: Wire, input: AiAgentRunInput): AiAgentResult {
    const suggestion = (raw.suggestion ?? raw.result ?? raw.output_record ?? raw) as Wire;
    const outputValue = suggestion.output ?? suggestion.explanatory_output ?? suggestion.summary;
    const outputRecord = outputValue && typeof outputValue === "object" && !Array.isArray(outputValue) ? outputValue as Wire : {};
    const result = suggestion;
    const rawStatus = suggestion.status ?? raw.status;
    if (String(rawStatus).toUpperCase() !== "PENDING_REVIEW") {
      throw this.invalidAiResponse("Agent output was not returned in the required PENDING_REVIEW state.");
    }
    const chainRaw = outputRecord.causal_chain ?? outputRecord.chain ?? result.causal_chain ?? [];
    const nodesRaw = outputRecord.affected_nodes ?? result.affected_nodes ?? [];
    if (!Array.isArray(chainRaw) || !Array.isArray(nodesRaw)) throw this.invalidAiResponse("Agent explanation structure is invalid.");
    const output = typeof outputValue === "string"
      ? outputValue
      : typeof outputRecord.summary === "string"
        ? outputRecord.summary
        : typeof outputRecord.explanation === "string"
          ? outputRecord.explanation
          : `The bounded ${this.aiAgentLabel(input.agentType).toLowerCase()} agent returned ${chainRaw.length ? `${chainRaw.length} structured causal step(s)` : "a structured result"} for review.`;
    const confidence = this.confidenceOrThrow(result.confidence ?? raw.confidence, "Agent output confidence");
    const evidenceRaw = outputRecord.evidence ?? result.evidence ?? raw.evidence ?? [];
    if (!Array.isArray(evidenceRaw)) throw this.invalidAiResponse("Agent evidence must be an array.");
    const runRaw = (raw.run ?? result.run ?? raw) as Wire;
    const run = this.mapAiActivity({
      ...runRaw,
      run_id: runRaw.run_id ?? raw.run_id ?? result.run_id,
      agent_type: runRaw.agent_type ?? input.agentType,
      status: "PENDING_REVIEW",
      task_summary: runRaw.task_summary ?? input.input,
      provider: runRaw.provider ?? result.provider,
      model: runRaw.model ?? runRaw.model_id ?? result.model ?? result.model_id,
      actor_id: runRaw.actor_id ?? result.actor_id,
      started_at: runRaw.started_at ?? result.created_at,
      completed_at: runRaw.completed_at ?? result.created_at,
      evidence_count: evidenceRaw.length,
    });
    return {
      run,
      status: "PENDING_REVIEW",
      output,
      confidence,
      evidence: evidenceRaw.map((item) => this.mapAiEvidence(item as Wire)),
      provider: String(result.provider ?? raw.provider ?? "not reported"),
      model: String(result.model ?? result.model_id ?? raw.model ?? "not reported"),
      usage: this.mapAiUsage({ ...((result.usage ?? raw.usage ?? {}) as Wire), estimated_cost_usd: result.cost_usd ?? raw.cost_usd }),
      warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
      causalChain: chainRaw.map((step, index) => this.mapAiCausalStep(step as Wire, index)),
      affectedNodes: nodesRaw.map((node, index) => this.mapAiAffectedNode(node, index)),
      limitations: [
        ...(Array.isArray(outputRecord.limitations) ? outputRecord.limitations.map(String) : []),
        ...(Array.isArray(result.limitations) ? result.limitations.map(String) : []),
        ...(evidenceRaw.length ? [] : ["The agent returned no authorized evidence; treat its output as unsupported."]),
      ],
      structuredOutput: Object.keys(outputRecord).length ? outputRecord : undefined,
      reviewNotice: "This output is pending human review and has no graph, action, identity, or external-system authority.",
      executionMode: "connected",
    };
  }

  private mapAiSuggestion(raw: Wire): AiSuggestion {
    const suggestionId = raw.suggestion_id ?? raw.id;
    if (typeof suggestionId !== "string" || !this.isAiAgentType(String(raw.agent_type))) throw this.invalidAiResponse("An AI suggestion is missing its identity or supported agent type.");
    if (raw.mutation_performed === true) throw this.invalidAiResponse("A suggestion response reported an unauthorized mutation.");
    const evidenceRaw = raw.evidence ?? raw.citations ?? [];
    if (!Array.isArray(evidenceRaw)) throw this.invalidAiResponse("Suggestion evidence must be an array.");
    const reviewValue = String(raw.review_decision ?? "").toLowerCase();
    const reviewDecision = reviewValue === "approve" || reviewValue === "reject" ? reviewValue : undefined;
    const rawStatus = String(raw.status ?? raw.suggestion_status ?? "PENDING_REVIEW").toLowerCase();
    if (rawStatus !== "pending_review") throw this.invalidAiResponse("A suggestion did not preserve its required PENDING_REVIEW state.");
    const structuredOutput = raw.output && typeof raw.output === "object" && !Array.isArray(raw.output) ? raw.output as Record<string, unknown> : undefined;
    return {
      suggestionId,
      title: String(raw.title ?? `${this.aiAgentLabel(String(raw.agent_type))} suggestion`),
      summary: String(raw.summary ?? raw.explanation ?? (typeof raw.output?.summary === "string" ? raw.output.summary : "A structured agent result is awaiting human review.")),
      proposedAction: String(raw.proposed_action ?? raw.recommendation ?? raw.output?.proposed_action ?? "Review the structured output; no action is authorized by this suggestion."),
      status: "PENDING_REVIEW",
      confidence: this.confidenceOrThrow(raw.confidence, "Suggestion confidence"),
      evidence: evidenceRaw.map((item) => this.mapAiEvidence(item as Wire)),
      provider: String(raw.provider ?? "not reported"),
      model: String(raw.model ?? raw.model_id ?? "not reported"),
      usage: this.mapAiUsage({ ...((raw.usage ?? {}) as Wire), estimated_cost_usd: raw.cost_usd }),
      createdAt: String(raw.created_at ?? new Date().toISOString()),
      reviewDecision,
      reviewedAt: raw.reviewed_at ? String(raw.reviewed_at) : undefined,
      reviewReason: raw.review_reason ? String(raw.review_reason) : undefined,
      noGraphMutation: true,
      executionMode: "connected",
      structuredOutput,
    };
  }

  private mapAiEvidence(raw: Wire): AiEvidence {
    const evidenceId = raw.evidence_id ?? raw.chunk_id ?? raw.source_id;
    if (typeof evidenceId !== "string" || evidenceId.length === 0) throw this.invalidAiResponse("Retrieved evidence is missing a provenance identifier.");
    const confidenceValue = raw.confidence ?? raw.score;
    return {
      evidenceId,
      label: String(raw.label ?? raw.title ?? raw.source_locator ?? raw.source_key ?? evidenceId),
      source: String(raw.source ?? raw.provider ?? raw.source_type ?? "authorized citation"),
      sourceKey: String(raw.source_locator ?? raw.source_key ?? raw.locator ?? raw.filename ?? evidenceId),
      excerpt: String(raw.snippet ?? raw.excerpt ?? raw.content ?? raw.text ?? "Excerpt not returned by the facade."),
      confidence: confidenceValue === undefined || confidenceValue === null ? null : this.confidenceOrThrow(confidenceValue, "Evidence confidence"),
      classification: raw.classification === undefined || raw.classification === null
        ? "not_reported"
        : this.mapAiClassification(raw.classification),
    };
  }

  private mapAiCausalStep(raw: Wire, index: number): AiExplainResult["causalChain"][number] {
    const fromNode = raw.from_node ?? raw.from ?? raw.cause ?? raw.source;
    const toNode = raw.to_node ?? raw.to ?? raw.effect ?? raw.target;
    const relationship = raw.relationship ?? raw.relation ?? raw.type;
    if (typeof fromNode !== "string" || typeof toNode !== "string" || typeof relationship !== "string") {
      throw this.invalidAiResponse("A causal-chain step is incomplete.");
    }
    return {
      step: this.positiveInteger(raw.step, index + 1),
      fromNode,
      relationship,
      toNode,
      explanation: String(raw.explanation ?? "Relationship explanation not reported."),
      evidenceIds: Array.isArray(raw.evidence_ids) ? raw.evidence_ids.map(String) : [],
    };
  }

  private mapAiAffectedNode(value: unknown, index: number): AiExplainResult["affectedNodes"][number] {
    if (typeof value === "string" && value.trim()) {
      return {
        nodeId: null,
        label: value,
        kind: "unspecified",
        effect: "Listed as affected; no node identifier or effect was returned by the bounded agent.",
      };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw this.invalidAiResponse(`Affected node ${index + 1} is invalid.`);
    const raw = value as Wire;
    if (!raw.label) throw this.invalidAiResponse("An affected node is missing its label.");
    return {
      nodeId: raw.node_id === undefined || raw.node_id === null ? null : String(raw.node_id),
      label: String(raw.label),
      kind: String(raw.kind ?? "unspecified"),
      effect: String(raw.effect ?? "Effect not reported by the bounded agent."),
    };
  }

  private mapAiUsage(raw: Wire): AiUsage {
    const numberOrNull = (value: unknown): number | null => {
      const parsed = typeof value === "number" ? value : Number(value);
      return value === undefined || value === null || !Number.isFinite(parsed) || parsed < 0 ? null : parsed;
    };
    const inputTokens = numberOrNull(raw.input_tokens ?? raw.prompt_tokens);
    const outputTokens = numberOrNull(raw.output_tokens ?? raw.completion_tokens);
    return {
      inputTokens,
      outputTokens,
      totalTokens: numberOrNull(raw.total_tokens) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
      estimatedCostUsd: numberOrNull(raw.estimated_cost_usd ?? raw.cost_usd ?? raw.cost?.amount),
      currency: String(raw.currency ?? raw.cost?.currency ?? "").toUpperCase() === "USD" ? "USD" : null,
    };
  }

  private mapAiClassification(value: unknown): AiClassification {
    const normalized = String(value).toLowerCase();
    if (["public", "internal", "confidential", "restricted"].includes(normalized)) return normalized as AiClassification;
    throw this.invalidAiResponse("An AI record has an unsupported classification.");
  }

  private confidenceOrThrow(value: unknown, label: string): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw this.invalidAiResponse(`${label} must be between zero and one.`);
    return parsed;
  }

  private isAiAgentType(value: string): value is AiAgentRunInput["agentType"] {
    return ["knowledge_ingestion", "entity_resolution", "event_understanding", "causal_analysis", "simulation_planning", "prediction_explanation", "technical_knowledge", "marketing_analyst"].includes(value);
  }

  private aiAgentLabel(value: string): string {
    return AI_DEMO_STATUS.agentProfiles.find((profile) => profile.agentType === value)?.label ?? value.replaceAll("_", " ");
  }

  private aiAgentInput(input: AiAgentRunInput): Wire {
    if (input.agentType === "event_understanding") return { event_text: input.input };
    if (input.agentType === "causal_analysis" || input.agentType === "prediction_explanation" || input.agentType === "technical_knowledge" || input.agentType === "marketing_analyst") return { question: input.input };
    if (input.agentType === "entity_resolution") return { description: input.input };
    return { objective: input.input };
  }

  private canRunAiAgent(agentType: AiAgentRunInput["agentType"]): boolean {
    if (["knowledge_ingestion", "entity_resolution", "technical_knowledge"].includes(agentType)) {
      return this.hasServerCapability("connector.admin", "connector:admin");
    }
    if (agentType === "prediction_explanation" || agentType === "marketing_analyst") {
      return this.hasServerCapability("simulation.run", "scenario:write");
    }
    return this.hasServerCapability("scenario.create", "scenario:write");
  }

  private captureServerCapabilities(identity: Wire): void {
    if (!Array.isArray(identity.capabilities) || identity.capabilities.some((item) => typeof item !== "string")) {
      throw new ApiProblem("The server-derived identity did not include a valid capability set.", 502, "invalid_actor_context", false);
    }
    this.serverCapabilities = new Set(identity.capabilities as string[]);
  }

  private hasServerCapability(serverCapability: string, legacyUiCapability?: string): boolean {
    if (this.serverCapabilities.size) return this.serverCapabilities.has(serverCapability);
    const capabilities = this.actor.memberships.find((item) => item.membershipId === this.actor.activeMembershipId)?.capabilities ?? [];
    return capabilities.includes(legacyUiCapability ?? serverCapability);
  }

  private positiveInteger(value: unknown, fallback: number): number {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private nonNegativeInteger(value: unknown, fallback: number): number {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private invalidAiResponse(detail: string): ApiProblem {
    return new ApiProblem(`The AI facade returned an invalid response. ${detail}`, 502, "invalid_ai_response", false);
  }

  private mapEventBranch(branch: Wire): EventScenarioBranch {
    return {
      branchId: String(branch.branch_id),
      name: String(branch.name ?? "Scenario branch"),
      parentBranchId: branch.parent_branch_id ? String(branch.parent_branch_id) : undefined,
      createdByEventId: branch.created_by_event_id ? String(branch.created_by_event_id) : undefined,
      createdAt: String(branch.created_at ?? ""),
      mode: branch.mode === "scenario" ? "scenario" : "baseline",
      status: branch.status === "rolled_back" ? "rolled_back" : "active",
      eventIds: (branch.event_ids as unknown[] ?? []).map(String),
      baseGraphVersion: this.numberOr(branch.base_graph_version),
      baseGraphHash: this.optionalSha(branch.base_graph_hash ?? branch.base_state_hash) ?? "",
      stateHash: this.optionalSha(branch.state_hash) ?? "",
    };
  }

  private mapEventInterpretation(previewId: string, event: Wire, model: Wire = {}): EventInterpretation {
    const impacts = event.impacts as Wire[] ?? [];
    const eventEvidence = event.evidence as Wire[] ?? [];
    const evidenceById = new Map(eventEvidence.map((item) => [String(item.evidence_id), item]));
    const resolveEvidence = (references: unknown[]): string[] => references.map(String).map((reference) => {
      const evidence = evidenceById.get(reference);
      if (!evidence) return reference;
      const kind = String(evidence.kind ?? "evidence").replaceAll("_", " ");
      const confidence = Number(evidence.confidence);
      const confidenceLabel = Number.isFinite(confidence) ? `, ${Math.round(confidence * 100)}% confidence` : "";
      return `${String(evidence.summary)} (Evidence ${reference.slice(0, 8)}, ${kind}${confidenceLabel})`;
    });
    const graph = (event.causal_graph ?? {}) as Wire;
    const graphNodes = graph.nodes as Wire[] ?? [];
    const impactById = new Map(impacts.map((impact) => [String(impact.impact_id), impact]));
    const nodes = graphNodes.length ? graphNodes.map((node) => {
      const impact = impactById.get(String(node.id));
      const depth = Number(node.depth ?? impact?.depth ?? 0);
      return {
        nodeId: String(node.id),
        label: String(node.label),
        kind: this.mapEventNodeKind(String(node.kind), String(impact?.effect_kind ?? "")),
        effectOrder: node.kind === "event" ? "event" as const : this.mapEventEffectOrder(depth, String(impact?.effect_kind ?? ""), String(impact?.time_horizon ?? "")),
        severity: this.mapEventSeverity(String(impact?.severity ?? "info")),
        confidence: impact?.confidence === undefined ? Number(event.confidence?.score ?? 0.5) : Number(impact.confidence),
        timeHorizon: String(impact?.time_horizon ?? (node.kind === "event" ? "Reported event" : "Unknown")),
        change: this.describeEventMutation(impact),
        explanation: String(impact?.explanation ?? event.confidence?.rationale?.[0] ?? "Extracted event"),
        evidence: resolveEvidence(impact?.evidence as unknown[] ?? []),
      };
    }) : [
      { nodeId: String(event.event_id), label: String(event.event_type?.label ?? "Event"), kind: "event" as const, effectOrder: "event" as const, severity: "info" as const, confidence: Number(event.confidence?.score ?? 0.5), timeHorizon: "Reported event", change: "Candidate event", explanation: String(event.statement), evidence: [] },
      ...impacts.map((impact) => ({ nodeId: String(impact.impact_id), label: String(impact.affected_entity?.display_name ?? impact.effect_kind), kind: this.mapEventNodeKind("impact", String(impact.effect_kind)), effectOrder: this.mapEventEffectOrder(Number(impact.depth), String(impact.effect_kind), String(impact.time_horizon ?? "")), severity: this.mapEventSeverity(String(impact.severity)), confidence: Number(impact.confidence), timeHorizon: String(impact.time_horizon), change: this.describeEventMutation(impact), explanation: String(impact.explanation), evidence: resolveEvidence(impact.evidence as unknown[] ?? []) })),
    ];
    const stateDeltas = impacts.filter((impact) => ["node_state", "relationship", "workflow"].includes(String(impact.effect_kind))).map((impact) => this.mapEventStateDelta(impact));
    const riskDeltas = impacts.filter((impact) => ["risk", "prediction", "knowledge"].includes(String(impact.effect_kind))).map((impact) => this.mapEventRiskDelta(impact));
    const recommendations = impacts.filter((impact) => Boolean(impact.recommended_action)).map((impact, index) => ({
      recommendationId: `recommendation-${String(impact.impact_id ?? index)}`,
      title: String(impact.recommended_action),
      rationale: String(impact.explanation),
      urgency: impact.time_horizon === "immediate" ? "now" as const : impact.time_horizon === "days" ? "next_7_days" as const : impact.time_horizon === "weeks" ? "next_30_days" as const : "monitor" as const,
      owner: "Human owner to assign",
    }));
    const gate = (event.gate ?? {}) as Wire;
    const safety = (event.safety ?? {}) as Wire;
    const confidenceScore = Number(event.confidence?.score ?? 0.5);
    const categoryRaw = String(event.event_type?.category ?? "unknown");
    const category = categoryRaw === "operations" ? "operational" as const : (["people", "project", "technology", "business", "operational", "external"].includes(categoryRaw) ? categoryRaw as EventInterpretation["category"] : "unknown" as const);
    return {
      previewId,
      eventId: String(event.event_id),
      input: String(event.statement),
      title: String(event.event_type?.label ?? "Interpreted event"),
      eventType: String(event.event_type?.code ?? "event.unknown"),
      category,
      occurredAt: event.occurred_at?.value ? String(event.occurred_at.value) : null,
      location: event.location ? String(event.location) : null,
      source: "Manual natural-language report",
      confidence: confidenceScore,
      confidenceLevel: this.mapEventConfidenceLevel(String(event.confidence?.level ?? "possible")),
      verificationStatus: event.verification_status === "confirmed" ? "verified" : event.verification_status === "rejected" ? "disputed" : "unverified",
      processingMode: gate.route === "rejected" ? "rejected" : gate.route === "scenario_branch" || event.mode === "scenario" ? "scenario_only" : "reality_review",
      modeReason: String(gate.rationale ?? (event.confidence?.rationale as unknown[] ?? []).join(" ")),
      entityResolutions: (event.entity_resolutions as Wire[] ?? []).map((resolution) => ({
        mention: String(resolution.mention),
        requiredConfirmation: Boolean(resolution.required_confirmation),
        candidates: (resolution.candidates as Wire[] ?? []).map((candidate) => ({ entityId: String(candidate.entity_id), label: String(candidate.display_name), entityType: String(candidate.entity_type), confidence: Number(candidate.confidence), reason: (candidate.reasons as unknown[] ?? []).map(String).join(" "), selected: resolution.selected_entity_id !== null && resolution.selected_entity_id !== undefined && String(candidate.entity_id) === String(resolution.selected_entity_id) })),
      })),
      nodes,
      edges: (graph.edges as Wire[] ?? []).map((edge, index) => ({ edgeId: `edge-${index}-${String(edge.from)}-${String(edge.to)}`, fromNodeId: String(edge.from), toNodeId: String(edge.to), relation: String(edge.relation).replaceAll("_", " "), effectOrder: this.mapEventEffectOrder(Number(impactById.get(String(edge.to))?.depth ?? 1), String(impactById.get(String(edge.to))?.effect_kind ?? ""), String(impactById.get(String(edge.to))?.time_horizon ?? "")), confidence: edge.confidence === undefined ? null : Number(edge.confidence), explanation: String(impactById.get(String(edge.to))?.explanation ?? `${String(edge.from)} ${String(edge.relation)} ${String(edge.to)}`), evidence: resolveEvidence(impactById.get(String(edge.to))?.evidence as unknown[] ?? []) })),
      stateDeltas,
      riskDeltas,
      recommendations,
      assumptions: (event.confidence?.rationale as unknown[] ?? []).map(String),
      unknowns: (event.unknown_effects as unknown[] ?? []).map(String),
      warnings: [
        "Manual event text is untrusted input and was not executed as instructions.",
        ...(safety.prompt_injection_detected ? ["Potential prompt-injection content was detected and quarantined from tool execution."] : []),
        ...((safety.flags as unknown[] ?? []).map(String)),
        ...((gate.blockers as unknown[] ?? []).map(String)),
        "No external source, identity, customer, or operational system will be changed from this screen.",
      ],
      evidence: eventEvidence.map((item) => `${String(item.summary)} (Evidence ${String(item.evidence_id).slice(0, 8)})`),
      model: {
        provider: String(model.provider ?? "Event interpretation service"),
        version: String(model.model_version ?? "unknown"),
        generativeModelUsed: Boolean(model.generative_model_used),
      },
      graphSnapshotVersion: this.numberOr(event.graph_snapshot_version),
      graphSnapshotHash: this.optionalSha(event.graph_snapshot_hash) ?? "",
      digest: this.eventDigest(event),
      etag: String(event.etag),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      canApplyToTwin: gate.route === "reality_update" && this.actor.activeMembershipId === "mem_aster_operator",
      externalWrite: false,
    };
  }

  private mapEventApproval(raw: Wire): EventApproval {
    return {
      approvalId: String(raw.approval_id),
      eventId: String(raw.event_id),
      eventVersion: this.numberOr(raw.event_version),
      graphSnapshotVersion: this.numberOr(raw.graph_snapshot_version),
      graphSnapshotHash: this.optionalSha(raw.graph_snapshot_hash) ?? "",
      payloadHash: this.normalizeSha(String(raw.payload_hash)),
      status: raw.status === "denied" ? "denied" : raw.status === "executed" ? "executed" : raw.status === "approved" ? "approved" : "pending",
      requiredRoles: (raw.required_roles as unknown[] ?? []).map((role) => String(role).replace("_approver", "") as "operations" | "security"),
      decisions: (raw.decisions as Wire[] ?? []).filter((item) => item.decision === "approve").map((item) => ({ role: String(item.role).replace("_approver", "") as "operations" | "security", approverId: String(item.actor_id), decidedAt: String(item.decided_at), payloadHash: this.normalizeSha(String(item.payload_hash)) })),
      expiresAt: String(raw.expires_at),
      approvalKind: raw.approval_kind === "scenario_policy" ? "scenario_policy" : "dual_human",
    };
  }

  private mapEventReceipt(raw: Wire, previewId: string, idempotencyKey: string, digest: string): EventDecisionReceipt {
    const action = String(raw.action);
    return {
      receiptId: String(raw.receipt_id),
      eventId: String(raw.event_id),
      previewId,
      decision: action === "rollback" ? "rolled_back" : action === "apply_scenario" ? "scenario_branched" : "applied",
      status: "succeeded",
      idempotencyKey,
      digest,
      recordedAt: String(raw.recorded_at ?? ""),
      eventVersionBefore: this.numberOr(raw.before_version),
      eventVersionAfter: this.numberOr(raw.after_version),
      graphVersionBefore: this.numberOr(raw.graph_version_before),
      graphVersionAfter: this.numberOr(raw.graph_version_after),
      outboxPosition: this.numberOr(raw.outbox_position),
      beforeStateHash: raw.before_state_hash ? this.normalizeSha(String(raw.before_state_hash)) : undefined,
      afterStateHash: raw.after_state_hash ? this.normalizeSha(String(raw.after_state_hash)) : undefined,
      replayed: Boolean(raw.replayed),
      auditEventId: String(raw.audit_evidence?.audit_id ?? raw.receipt_id),
      rollbackAvailable: action === "apply_reality",
      externalWrite: false,
      message: action === "rollback" ? "The synthetic graph mutation was compensated; external systems were not changed." : action === "apply_scenario" ? "An isolated scenario branch was created; the reality graph and external systems were not changed." : "The reviewed event was applied to the synthetic tenant projection only; external systems were not changed.",
    };
  }

  private eventDigest(event: Wire): string {
    return this.normalizeSha(String(event.reviewed_payload_hash ?? event.audit_evidence?.details_hash ?? event.source?.source_text_hash ?? event.event_id));
  }

  private normalizeSha(value: string): string {
    return value.startsWith("sha256:") ? value : `sha256:${value}`;
  }

  private optionalSha(value: unknown): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    return this.normalizeSha(String(value));
  }

  private numberOr(value: unknown, fallback = 0): number {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private mapEventEffectOrder(depth: number, kind: string, timeHorizon = ""): EventInterpretation["nodes"][number]["effectOrder"] {
    if (kind === "unknown") return "unknown";
    if (depth >= 3 && timeHorizon === "months") return "long_term";
    if (depth <= 0) return "direct";
    if (depth === 1) return "direct";
    if (depth === 2) return "second";
    return "third";
  }

  private mapEventNodeKind(nodeKind: string, impactKind: string): EventInterpretation["nodes"][number]["kind"] {
    if (nodeKind === "event") return "event";
    if (impactKind === "relationship") return "relationship";
    if (impactKind === "risk" || impactKind === "knowledge") return "risk";
    if (impactKind === "prediction") return "prediction";
    if (impactKind === "workflow") return "process";
    if (impactKind === "recommendation") return "recommendation";
    if (impactKind === "unknown") return "unknown";
    return nodeKind === "entity" ? "system" : "project";
  }

  private mapEventSeverity(value: string): EventInterpretation["nodes"][number]["severity"] {
    if (["low", "medium", "high", "critical", "unknown"].includes(value)) return value as EventInterpretation["nodes"][number]["severity"];
    return "info";
  }

  private describeEventMutation(impact?: Wire): string {
    if (!impact) return "Affected by the event";
    const mutation = (impact.proposed_mutation ?? {}) as Wire;
    const before = mutation.before ?? mutation.from ?? mutation.previous ?? mutation.old_value;
    const after = mutation.after ?? mutation.to ?? mutation.next ?? mutation.new_value;
    if (before !== undefined || after !== undefined) return `${this.displayMutationValue(before, "Not set")} → ${this.displayMutationValue(after, "Removed")}`;
    if (mutation.path !== undefined && mutation.value !== undefined) return `${String(mutation.path).replaceAll("_", " ")} → ${this.displayMutationValue(mutation.value, "Updated")}`;
    if (mutation.direction !== undefined) return `${String(mutation.direction)} (${String(mutation.operation ?? impact.effect_kind).replaceAll("_", " ")})`;
    if (mutation.operation !== undefined) return String(mutation.operation).replaceAll("_", " ");
    if (impact.affected_relationship) return `${String(impact.affected_relationship.operation)} ${String(impact.affected_relationship.type)}`;
    return String(impact.effect_kind).replaceAll("_", " ");
  }

  private mapEventStateDelta(impact: Wire): EventInterpretation["stateDeltas"][number] {
    const mutation = (impact.proposed_mutation ?? {}) as Wire;
    return {
      deltaId: String(impact.impact_id),
      subject: String(impact.affected_entity?.display_name ?? impact.affected_relationship?.type ?? "Affected graph state"),
      field: String(mutation.field ?? mutation.path ?? mutation.type ?? impact.affected_relationship?.type ?? impact.effect_kind),
      before: this.displayMutationValue(mutation.before ?? mutation.from ?? mutation.previous ?? mutation.old_value, "Current state"),
      after: this.displayMutationValue(mutation.after ?? mutation.to ?? mutation.next ?? mutation.new_value ?? mutation.value ?? mutation.direction, this.describeEventMutation(impact)),
      operation: impact.affected_relationship?.operation === "remove" ? "remove" : impact.affected_relationship?.operation === "create" ? "create" : impact.live_mutation_eligible ? "update" : "uncertain",
      confidence: Number(impact.confidence),
    };
  }

  private mapEventRiskDelta(impact: Wire): EventInterpretation["riskDeltas"][number] {
    const mutation = (impact.proposed_mutation ?? {}) as Wire;
    const before = this.displayMutationValue(mutation.before ?? mutation.from ?? mutation.previous, "Baseline");
    const after = this.displayMutationValue(mutation.after ?? mutation.to ?? mutation.next, this.describeEventMutation(impact));
    return { deltaId: String(impact.impact_id), label: String(impact.affected_entity?.display_name ?? impact.effect_kind), kind: impact.effect_kind === "prediction" ? "prediction" : "risk", before, after, direction: String(after).toLowerCase().includes("unknown") ? "unknown" : "changed", confidence: Number(impact.confidence), explanation: String(impact.explanation) };
  }

  private displayMutationValue(value: unknown, fallback: string): string {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
  }

  private mapEventConfidenceLevel(value: string): EventInterpretation["confidenceLevel"] {
    return ["confirmed", "likely", "possible", "speculative", "rejected"].includes(value) ? value as EventInterpretation["confidenceLevel"] : "possible";
  }

  private mapAsset(raw: Wire): AssetSummary {
    const location = (raw.location ?? {}) as Wire;
    const site = [location.site ?? raw.site, location.area ?? raw.area].filter(Boolean).join(" · ");
    return {
      assetId: String(raw.asset_id ?? raw.id),
      name: String(raw.display_name ?? raw.name ?? "Industrial asset"),
      assetType: "centrifugal_pump",
      model: String(raw.model ?? "Unknown model"),
      serialNumber: String(raw.serial_number ?? "Unknown serial"),
      site: site || "Unknown site",
      status: this.mapOperatingStatus(String(raw.operational_status ?? raw.status ?? "offline")),
      healthScore: Number(raw.health_score ?? raw.health?.score ?? 0),
      lifecycleStage: this.mapLifecycleStage(String(raw.current_stage ?? raw.lifecycle_stage ?? "service")),
      version: Number(raw.version ?? raw.control_version ?? 0),
      canControl: Boolean(raw.can_control ?? raw.canControl ?? false),
    };
  }

  private mapAssetControlState(raw: Wire, fallbackVersion = 0): AssetControlState {
    const operatingMode = String(raw.operating_mode ?? raw.operational_status ?? raw.status ?? "");
    return {
      version: Number(raw.version ?? fallbackVersion),
      speedPct: Number(raw.speed_pct ?? raw.speed_percent ?? 0),
      valvePct: Number(raw.valve_pct ?? raw.valve_percent ?? 0),
      emergencyStopped: Boolean(raw.emergency_stopped ?? raw.emergency_stop_active ?? false),
      status: this.mapOperatingStatus(operatingMode || (raw.emergency_stopped ? "offline" : Number(raw.speed_pct ?? 0) === 0 ? "idle" : "running")),
    };
  }

  private mapTelemetryFrame(frame: Wire): AssetTelemetry["points"][number] {
    const readings = (frame.readings as Wire[] ?? []);
    const value = (terms: string[], fallback = 0) => {
      const reading = readings.find((item) => terms.some((term) => String(item.metric ?? item.sensor_id ?? item.label ?? "").toLowerCase().includes(term)));
      return Number(reading?.value ?? fallback);
    };
    return {
      timestamp: String(frame.observed_at ?? frame.timestamp ?? new Date().toISOString()),
      temperatureC: value(["temperature", "temp"]),
      pressureBar: value(["discharge_pressure", "pressure"]),
      vibrationMmS: value(["vibration", "vib"]),
      flowM3H: Number((value(["flow_l_min", "flow"]) * 0.06).toFixed(2)),
      motorCurrentA: value(["motor_current", "current"]),
      speedRpm: value(["speed_rpm", "speed"]),
    };
  }

  private mapTelemetrySignals(frame: Wire): AssetTelemetry["signals"] {
    const readings = (frame.readings as Wire[] ?? []);
    const find = (terms: string[]) => readings.find((item) => terms.some((term) => String(item.metric ?? item.sensor_id ?? item.label ?? "").toLowerCase().includes(term))) ?? {};
    const map = (
      terms: string[],
      fallbackLabel: string,
      fallbackUnit: string,
      valueKind: "observed" | "derived" = "observed",
      scale = 1,
    ) => {
      const reading = find(terms);
      const thresholds = (reading.thresholds ?? {}) as Wire;
      const threshold = (key: string) => thresholds[key] === undefined ? undefined : Number((Number(thresholds[key]) * scale).toFixed(2));
      const rawStatus = String(reading.status ?? "normal").toLowerCase();
      return {
        label: String(reading.label ?? fallbackLabel),
        unit: scale === 1 ? String(reading.unit ?? fallbackUnit) : fallbackUnit,
        status: rawStatus === "critical" ? "critical" as const : rawStatus === "warning" ? "warning" as const : "normal" as const,
        valueKind,
        warningLow: threshold("warning_low"),
        criticalLow: threshold("critical_low"),
        warningHigh: threshold("warning_high"),
        criticalHigh: threshold("critical_high"),
      };
    };
    return {
      temperatureC: map(["temperature", "temp"], "Bearing temperature", "°C"),
      pressureBar: map(["discharge_pressure", "pressure"], "Discharge pressure", "bar"),
      vibrationMmS: map(["vibration", "vib"], "Drive-end vibration", "mm/s RMS"),
      flowM3H: map(["flow_l_min", "flow"], "Process flow", "m³/h", "derived", 0.06),
      motorCurrentA: map(["motor_current", "current"], "Motor current", "A"),
      speedRpm: map(["speed_rpm", "speed"], "Motor speed", "rpm"),
    };
  }

  private mapAssetCommand(raw: Wire | AssetCommand): AssetCommand {
    const type = String(raw.type);
    if (type === "set_speed_pct") return { type, value: Number((raw as Wire).value) };
    if (type === "set_valve_pct") return { type, value: Number((raw as Wire).value) };
    if (type === "emergency_stop") return { type };
    return { type: "reset" };
  }

  private mapOperatingStatus(value: string): AssetSummary["status"] {
    const normalized = value.toLowerCase();
    if (["running", "operating", "online", "active", "automatic", "manual"].includes(normalized)) return "running";
    if (["idle", "standby", "stopped"].includes(normalized)) return "idle";
    if (normalized.includes("maintenance")) return "maintenance";
    return "offline";
  }

  private mapComponentKind(value: string): AssetComponent["kind"] {
    const normalized = value.toLowerCase();
    if (normalized.includes("motor")) return "motor";
    if (normalized.includes("coupl") || normalized.includes("shaft")) return "shaft";
    if (normalized.includes("bear")) return "bearing";
    if (normalized.includes("inlet") || normalized.includes("suction")) return "inlet";
    if (normalized.includes("outlet") || normalized.includes("discharge") || normalized.includes("valve")) return "valve";
    if (normalized.includes("impeller")) return "impeller";
    if (normalized.includes("seal")) return "seal";
    return "casing";
  }

  private mapComponentStatus(value: string): AssetComponent["status"] {
    const normalized = value.toLowerCase();
    if (["critical", "alarm", "failed", "danger"].some((item) => normalized.includes(item))) return "critical";
    if (["attention", "warning", "anomaly", "degraded", "watch", "service_due"].some((item) => normalized.includes(item))) return "attention";
    return "normal";
  }

  private mapPredictionSeverity(value: string): FailurePrediction["severity"] {
    const normalized = value.toLowerCase();
    if (["critical", "high", "danger"].includes(normalized)) return "critical";
    if (["warning", "medium", "attention"].includes(normalized)) return "warning";
    return "info";
  }

  private mapLifecycleStage(value: string): AssetSummary["lifecycleStage"] {
    const normalized = value.toLowerCase();
    if (normalized.includes("design")) return "design";
    if (normalized.includes("manufact")) return "manufacture";
    if (normalized.includes("commission")) return "commission";
    if (normalized === "operation" || normalized.includes("operat")) return "operation";
    if (normalized.includes("maint")) return "maintenance";
    if (normalized === "service") return "service";
    if (normalized.includes("decommission") || normalized.includes("retire")) return "decommission";
    return "service";
  }

  private lifecycleTitle(value: string): string {
    const normalized = value.toLowerCase();
    if (normalized.includes("design")) return "Hydraulic design approved";
    if (normalized.includes("manufact")) return "Factory acceptance completed";
    if (normalized.includes("commission")) return "Asset commissioned";
    if (normalized === "operation") return "Operational service";
    if (normalized === "service") return "Planned maintenance window";
    if (normalized.includes("decommission")) return "End-of-life review planned";
    return "Lifecycle event";
  }

  private mapLifecycleStatus(value: string): LifecycleEvent["status"] {
    const normalized = value.toLowerCase();
    if (["current", "active", "in_progress"].includes(normalized)) return "current";
    if (["planned", "future", "scheduled"].includes(normalized)) return "planned";
    return "complete";
  }

  private mapSnapshot(raw: Wire): ActionReceipt["before"] {
    return {
      version: Number(raw.version),
      dueDate: String(raw.fields.duedate),
      priorityId: String(raw.fields.priority.id),
      priorityName: String(raw.fields.priority.name),
      labels: (raw.fields.labels as unknown[]).map(String),
    };
  }

  private mapApproval(raw: Wire): ApprovalRequest {
    return {
      approvalId: String(raw.approval_id),
      status: raw.status === "denied" ? "rejected" : raw.status,
      payloadHash: `sha256:${raw.payload_hash}`,
      requestedBy: "Maya Chen",
      requestedAt: String(raw.created_at),
      expiresAt: String(raw.expires_at),
      requiredRoles: ["operations", "security"],
      decisions: this.mapDecisions(raw),
    } as ApprovalRequest;
  }

  private mapDecisions(raw: Wire): ApprovalDecision[] {
    return (raw.decisions as Wire[] ?? []).map((decision) => {
      const role: ApprovalRole = decision.role === "operations_approver" ? "operations" : "security";
      return {
        role,
        approverId: String(decision.actor_id),
        approverName: role === "operations" ? "Owen Brooks" : "Samira Patel",
        decidedAt: String(decision.decided_at),
        payloadHash: `sha256:${raw.payload_hash}`,
      };
    });
  }

  private mapCompensation(raw: Wire): CompensationPreview {
    if (!this.receipt) throw new ApiProblem("Action receipt not found.", 404, "receipt_not_found", false);
    return {
      compensationId: String(raw.approval_id),
      approvalId: String(raw.approval_id),
      payloadHash: `sha256:${raw.payload_hash}`,
      status: raw.status === "approved" ? "approved" : "pending",
      decisions: this.mapDecisions(raw),
      expectedCurrent: clone(this.receipt.after),
      restoreTo: clone(this.receipt.before),
      guard: "Compare-and-set: restore only while Jira still matches the exact post-action snapshot.",
      expiresAt: String(raw.expires_at),
    };
  }
}

let singleton: DigitalTwinApi | undefined;

export function getDigitalTwinApi(): DigitalTwinApi {
  if (singleton) return singleton;
  if (process.env.NEXT_PUBLIC_ENABLE_DEMO_DATA === "true") {
    singleton = new DemoDigitalTwinApi();
    return singleton;
  }
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (!apiUrl) {
    throw new ApiProblem(
      "No API is configured. Set NEXT_PUBLIC_API_URL or explicitly enable synthetic demo data.",
      503,
      "api_not_configured",
      false,
    );
  }
  singleton = new FetchDigitalTwinApi(apiUrl);
  return singleton;
}

export function resetApiForTests() {
  singleton = undefined;
}
