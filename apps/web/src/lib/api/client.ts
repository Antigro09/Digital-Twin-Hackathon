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
import type {
  ActionReceipt,
  ActorContext,
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
  LifecycleEvent,
  RemediationPreview,
  ScenarioDraft,
  SimulationComparison,
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

export class FetchDigitalTwinApi implements DigitalTwinApi {
  private actor = clone(MEMBERSHIPS);
  private actorAlias = "usr_aster_analyst";
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

  constructor(private readonly baseUrl: string) {}

  private async envelope<T>(path: string, options: FetchOptions = {}, actorAlias = this.actorAlias): Promise<{ data: T; response: Response }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      credentials: "include",
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        "X-Demo-Actor": actorAlias,
        ...options.headers,
      },
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as { detail?: string; code?: string; retryable?: boolean };
      throw new ApiProblem(problem.detail ?? `Request failed (${response.status}).`, response.status, problem.code ?? "api_error", problem.retryable ?? response.status >= 500);
    }
    return { data: (await response.json()) as T, response };
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
    await this.request<Wire>("/v1/me", { signal });
    this.actor.expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    return clone(this.actor);
  }

  async selectMembership(membershipId: string, signal?: AbortSignal): Promise<ActorContext> {
    const membership = this.actor.memberships.find((candidate) => candidate.membershipId === membershipId);
    if (!membership) throw new ApiProblem("That membership is not available to this actor.", 403, "membership_denied", false);
    const previous = this.actorAlias;
    this.actorAlias = membership.tenantAlias === "tnt_aster" ? "usr_aster_analyst" : "usr_beacon_analyst";
    try {
      await this.request<Wire>("/v1/me", { signal });
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
