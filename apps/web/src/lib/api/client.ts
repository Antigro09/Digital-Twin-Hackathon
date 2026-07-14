import {
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
  AnswerMode,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRole,
  CitedAnswer,
  CompensationPreview,
  ConnectorHealth,
  DigitalTwinApi,
  GraphResult,
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
