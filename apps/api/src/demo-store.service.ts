import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  AgentRunRecord,
  ApprovalDecisionRecord,
  ApprovalRecord,
  ASTER_JIRA_INSTALLATION_ID,
  ASTER_TENANT_ID,
  AST_142_WORK_ITEM_ID,
  AuditRecord,
  JiraIssueSnapshot,
  PreviewRecord,
  ReceiptRecord,
  RequestContext,
  ScenarioRecord,
  SourceObjectRecord,
  addSeconds,
  canonicalize,
  etag,
  newId,
  nowIso,
  sha256,
  stableUuid,
  traceId,
} from './domain';
import { DatabaseService } from './database.service';
import {
  EventProjectionReadOverlay,
  EventProjectionService,
  EventProjectionSnapshot,
} from './event-projection.service';
import { FixtureService } from './fixture.service';
import { ProblemException } from './problem';

interface SimulationRecord extends Record<string, unknown> {
  simulation_id: string;
  tenant_id: string;
  scenario_id: string | null;
  status: string;
}

interface Page<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
  data_watermark: Record<string, unknown>;
}

@Injectable()
export class DemoStoreService implements OnModuleInit {
  private readonly logger = new Logger(DemoStoreService.name);
  private readonly agentRuns = new Map<string, AgentRunRecord>();
  private readonly snapshots = new Map<string, Record<string, unknown>>();
  private readonly scenarios = new Map<string, ScenarioRecord>();
  private readonly simulations = new Map<string, SimulationRecord>();
  private readonly previews = new Map<string, PreviewRecord>();
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly receipts = new Map<string, ReceiptRecord>();
  private readonly executionReplay = new Map<string, string>();
  private readonly audits = new Map<string, AuditRecord[]>();
  private jiraIssue: JiraIssueSnapshot = {
    issueKey: 'AST-142',
    version: 7,
    fields: { duedate: '2026-08-07', labels: ['identity', 'orion'], priority: { id: '3', name: 'Medium' } },
  };

  constructor(
    private readonly fixtures: FixtureService,
    private readonly database: DatabaseService,
    private readonly eventProjection: EventProjectionService,
  ) {}

  onModuleInit(): void {
    this.fixtures.assertFrozenTenants();
  }

  watermark(): Record<string, unknown> {
    return {
      projection_checkpoint_id: '90000000-0000-4000-8000-000000000001',
      outbox_position: 42,
      observed_at: '2026-07-13T15:47:00Z',
    };
  }

  listEntities(ctx: RequestContext, pageSize: number): Page<Record<string, unknown>> {
    const sourceEntities = this.fixtures.visibleSources(ctx.actor).map((source) => this.entityFromSource(source));
    const overlay = this.eventProjectionOverlay(ctx);
    const combined = [...sourceEntities, ...(overlay?.entities ?? [])]
      .filter((entity, index, all) => all.findIndex((candidate) => candidate.entity_id === entity.entity_id) === index);
    return {
      items: combined.slice(0, pageSize),
      next_cursor: null,
      has_more: combined.length > pageSize,
      data_watermark: this.watermark(),
    };
  }

  getEntity(ctx: RequestContext, entityId: string): Record<string, unknown> {
    const source = this.fixtures.visibleSources(ctx.actor).find((item) => stableUuid(`${item.tenant_id}:${item.source_key}`) === entityId);
    const overlay = this.eventProjectionOverlay(ctx);
    const projected = overlay?.entities.find((entity) => entity.entity_id === entityId);
    if (!source && !projected) throw this.notFound();
    if (projected && overlay) {
      const facts = overlay.facts.filter((fact) => this.factTouchesEntity(fact.mutation, entityId));
      return {
        entity: projected,
        claims: facts.map((fact) => ({
          claim_id: stableUuid(`event-projection-claim:${ctx.tenantId}:${fact.impact_id}`),
          tenant_id: ctx.tenantId,
          subject_id: entityId,
          predicate: 'edt.event/projected_change',
          object: { value: structuredClone(fact.mutation) },
          source_revision: String(overlay.version),
          confidence: 1,
          evidence_ids: [],
          status: 'accepted',
        })),
        provenance: [],
        relationships: overlay.relationships.filter((edge) => edge.from === entityId || edge.to === entityId),
        event_projection: { version: overlay.version, state_hash: overlay.state_hash },
        data_watermark: this.watermark(),
        etag: etag(sha256({ projected, projection_version: overlay.version, state_hash: overlay.state_hash })),
      };
    }
    if (!source) throw this.notFound();
    return {
      entity: this.entityFromSource(source),
      claims: [this.claimFromSource(source)],
      provenance: [this.citationFromSource(source)],
      relationships: [
        ...this.fixtures.tenantRelationships(ctx.tenantId).filter((edge) => edge.from === source.source_key || edge.to === source.source_key),
        ...(overlay?.relationships.filter((edge) => edge.from === entityId || edge.to === entityId) ?? []),
      ],
      data_watermark: this.watermark(),
      etag: etag(sha256(source)),
    };
  }

  traverse(ctx: RequestContext, input: Record<string, unknown>): Record<string, unknown> {
    const allowedTemplates = ['delivery_dependencies', 'ownership_path', 'evidence_path', 'incident_blast_radius'];
    if (!allowedTemplates.includes(String(input.template))) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_traversal_template', 'Traversal template is not allowlisted.');
    }
    const maxNodes = Math.min(Number(input.max_nodes ?? 100), 500);
    const visible = this.fixtures.visibleSources(ctx.actor);
    const visibleKeys = new Set(visible.map((item) => item.source_key));
    const sourceRelationships = this.fixtures
      .tenantRelationships(ctx.tenantId)
      .filter((edge) => visibleKeys.has(edge.from) || visibleKeys.has(edge.to))
      .slice(0, maxNodes * 4);
    const overlay = this.eventProjectionOverlay(ctx);
    const combinedNodes = [
      ...visible.map((source) => this.entityFromSource(source)),
      ...(overlay?.entities ?? []),
    ].filter((entity, index, all) => all.findIndex((candidate) => candidate.entity_id === entity.entity_id) === index);
    const nodes = combinedNodes.slice(0, maxNodes);
    const returnedNodeIds = new Set(nodes.map((node) => String(node.entity_id)));
    const eventRelationships = (overlay?.relationships ?? [])
      .filter((edge) => edge.state === 'active' && returnedNodeIds.has(edge.from) && returnedNodeIds.has(edge.to));
    const relationships = [...sourceRelationships, ...eventRelationships].slice(0, maxNodes * 4);
    return {
      nodes,
      relationships,
      truncated: combinedNodes.length > maxNodes || sourceRelationships.length + eventRelationships.length > maxNodes * 4,
      projection_generation: overlay?.version ?? 1,
      data_watermark: this.watermark(),
    };
  }

  async createQuestion(ctx: RequestContext, question: string): Promise<Record<string, unknown>> {
    if (!question.trim()) throw new ProblemException(HttpStatus.BAD_REQUEST, 'question_required', 'Question must not be empty.');
    const runId = newId();
    const sources = this.fixtures.visibleSources(ctx.actor);
    const required = ['AST-142', 'AST-173', 'AST-201', 'aster-labs/identity-service#184'];
    const evidence = sources.filter((source) => required.includes(source.source_key));
    const supported = ctx.tenantId === ASTER_TENANT_ID && evidence.length === required.length;
    const workforceSensitive = /\b(burnout|attrition|productivity|performance|rank|compensation|emotion|health|misconduct|hiring)\b/i.test(question);
    const result = workforceSensitive
      ? this.workforceAbstainedAnswer(ctx)
      : supported
        ? this.citedLaunchRiskAnswer(evidence)
        : this.abstainedAnswer(ctx);
    const run: AgentRunRecord = {
      run_id: runId,
      tenant_id: ctx.tenantId,
      profile_id: 'AGENT-QUERY/1.0.0',
      status: 'succeeded',
      created_at: nowIso(),
      completed_at: nowIso(),
      result,
    };
    this.agentRuns.set(runId, run);
    await this.database.put(ctx.tenantId, 'agent_run', runId, run);
    await this.audit(ctx, 'question.create', 'agent_run', runId, 'succeeded');
    return { run: this.publicRun(run), status_url: `/v1/agent-runs/${runId}`, events_url: `/v1/agent-runs/${runId}/events` };
  }

  getAgentRun(ctx: RequestContext, runId: string): Record<string, unknown> {
    const run = this.agentRuns.get(runId);
    if (!run || run.tenant_id !== ctx.tenantId) throw this.notFound();
    return { run: this.publicRun(run), result: run.result };
  }

  async cancelAgentRun(ctx: RequestContext, runId: string): Promise<{ terminal: boolean; view: Record<string, unknown> }> {
    const run = this.agentRuns.get(runId);
    if (!run || run.tenant_id !== ctx.tenantId) throw this.notFound();
    const terminal = ['succeeded', 'failed', 'cancelled'].includes(run.status);
    if (!terminal) {
      run.status = 'cancelled';
      run.completed_at = nowIso();
      await this.database.put(ctx.tenantId, 'agent_run', runId, run);
      await this.audit(ctx, 'agent_run.cancel', 'agent_run', runId, 'succeeded');
    }
    return { terminal, view: { run: this.publicRun(run), result: run.result } };
  }

  createSnapshot(ctx: RequestContext, projectId: string, asOf: string): Record<string, unknown> {
    if (ctx.tenantId !== ASTER_TENANT_ID) throw this.notFound();
    const id = newId();
    const ast173 = stableUuid(`${ctx.tenantId}:AST-173`);
    const ast201 = stableUuid(`${ctx.tenantId}:AST-201`);
    const calendar = {
      version: 'aster-working-calendar/1.0.0',
      working_weekdays: [1, 2, 3, 4, 5],
      workday_start: '09:00',
      hours_per_workday: 8,
      holidays: [],
    };
    const eventProjection = this.eventProjection.snapshot(ctx.tenantId);
    const eventAssumptions = this.eventProjectionAssumptions(eventProjection);
    const snapshot: Record<string, unknown> = {
      schema_version: '1.0',
      snapshot_id: id,
      tenant_id: ctx.tenantId,
      project_id: projectId,
      as_of: asOf,
      project_start: '2026-07-13T00:00:00Z',
      target_date: '2026-09-15',
      projection_checkpoint_id: String(this.watermark().projection_checkpoint_id),
      outbox_position: 42,
      ontology_version: 'edt.core/1.0.0',
      simulation_model_version: 'pert-monte-carlo/1.0.0',
      parameter_set_version: 'beta-pert-lambda-4/1.0.0',
      default_seed: '20260713',
      timezone: 'America/New_York',
      timezone_database_version: '2026a',
      calendar: { ...calendar, canonical_sha256: sha256(calendar) },
      tasks: [
        this.task(AST_142_WORK_ITEM_ID, 'AST-142', 'Complete SSO cutover', 'aster-identity', 8, 12, 18),
        this.task(ast173, 'AST-173', 'Build Orion release candidate', 'aster-release', 5, 8, 13),
        this.task(ast201, 'AST-201', 'Complete launch certification', 'aster-security', 4, 7, 12),
      ],
      dependencies: [
        this.dependency(AST_142_WORK_ITEM_ID, ast173, '75000000-0000-4000-8000-000000000002'),
        this.dependency(ast173, ast201, '75000000-0000-4000-8000-000000000003'),
      ],
      team_capacities: ['aster-identity', 'aster-release', 'aster-security'].map((team) => ({ team_id: stableUuid(`${ctx.tenantId}:${team}`), parallel_capacity: 1, availability: 1, evidence_ids: [stableUuid(`evidence:${team}`)] })),
      assumptions: eventAssumptions,
      warnings: [
        'Synthetic duration distributions have no external predictive validity.',
        `event_projection_version:${eventProjection.version}`,
        `event_projection_state_hash:${eventProjection.state_hash}`,
      ],
      evidence_ids: this.fixtures.visibleSources(ctx.actor).map((source) => stableUuid(`evidence:${source.source_object_id}`)),
      sealed_at: nowIso(),
    };
    snapshot.canonical_sha256 = sha256(snapshot);
    this.snapshots.set(id, snapshot);
    void this.database.put(ctx.tenantId, 'simulation_snapshot', id, snapshot);
    void this.audit(ctx, 'simulation_snapshot.create', 'simulation_snapshot', id, 'succeeded');
    return snapshot;
  }

  createScenario(ctx: RequestContext, input: Record<string, unknown>): Record<string, unknown> {
    const snapshotId = String(input.snapshot_id ?? '');
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot || snapshot.tenant_id !== ctx.tenantId) throw this.notFound();
    const interventions = Array.isArray(input.interventions) ? input.interventions as Array<Record<string, unknown>> : [];
    if (!interventions.length) throw new ProblemException(HttpStatus.BAD_REQUEST, 'intervention_required', 'At least one typed intervention is required.');
    const scenarioId = newId();
    const compiled = {
      snapshot_id: snapshotId,
      snapshot_hash: String(snapshot.canonical_sha256),
      name: String(input.name ?? 'Scenario'),
      target_date: input.target_date ?? null,
      model_version: 'pert-monte-carlo/1.0.0',
      calendar_version: 'aster-working-calendar/1.0.0',
      compiler_version: 'scenario-compiler/1.0.0',
      seed: String(input.seed ?? '20260713'),
      sample_count: 50000,
      interventions,
      assumptions: [],
    };
    const scenario: ScenarioRecord = {
      scenario_id: scenarioId,
      tenant_id: ctx.tenantId,
      snapshot_id: snapshotId,
      snapshot_hash: String(snapshot.canonical_sha256),
      name: compiled.name,
      target_date: typeof compiled.target_date === 'string' ? compiled.target_date : null,
      seed: compiled.seed,
      sample_count: 50000,
      interventions,
      scenario_digest: '',
      status: 'draft',
      created_by: ctx.actor.actor_id,
      confirmed_by: ctx.actor.actor_id,
      confirmed_at: nowIso(),
    };
    scenario.scenario_digest = sha256({
      scenario_id: scenario.scenario_id,
      tenant_id: scenario.tenant_id,
      snapshot_id: scenario.snapshot_id,
      snapshot_hash: scenario.snapshot_hash,
      name: scenario.name,
      target_date: scenario.target_date,
      model_version: 'pert-monte-carlo/1.0.0',
      calendar_version: 'aster-working-calendar/1.0.0',
      compiler_version: 'scenario-compiler/1.0.0',
      seed: scenario.seed,
      sample_count: scenario.sample_count,
      interventions: scenario.interventions,
      assumptions: [],
      confirmed_by: scenario.confirmed_by,
      confirmed_at: scenario.confirmed_at,
    });
    const digest = scenario.scenario_digest;
    this.scenarios.set(scenarioId, scenario);
    void this.database.put(ctx.tenantId, 'scenario', scenarioId, scenario);
    void this.audit(ctx, 'scenario.create', 'scenario', scenarioId, 'succeeded');
    return { scenario_id: scenarioId, name: scenario.name, snapshot_id: snapshotId, scenario_digest: digest, status: 'draft', compiled_scenario: { ...compiled, scenario_digest: digest }, etag: etag(digest) };
  }

  confirmScenario(ctx: RequestContext, scenarioId: string, digest: string, ifMatch: string | undefined): Record<string, unknown> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario || scenario.tenant_id !== ctx.tenantId) throw this.notFound();
    if (!ifMatch) throw new ProblemException(HttpStatus.PRECONDITION_REQUIRED, 'if_match_required', 'If-Match is required.');
    if (ifMatch !== etag(scenario.scenario_digest) || digest !== scenario.scenario_digest) {
      throw new ProblemException(HttpStatus.PRECONDITION_FAILED, 'scenario_digest_mismatch', 'The scenario draft changed or the digest does not match.');
    }
    if (scenario.status !== 'confirmed') {
      scenario.status = 'confirmed';
      void this.database.put(ctx.tenantId, 'scenario', scenarioId, scenario);
      void this.audit(ctx, 'scenario.confirm', 'scenario', scenarioId, 'succeeded');
    }
    return this.publicScenario(scenario);
  }

  async runSimulation(ctx: RequestContext, scenarioId: string): Promise<Record<string, unknown>> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario || scenario.tenant_id !== ctx.tenantId || scenario.status !== 'confirmed') throw this.notFound();
    const snapshot = this.snapshots.get(scenario.snapshot_id);
    if (!snapshot) throw this.notFound();
    const simulationId = newId();
    let result: Record<string, unknown>;
    try {
      result = await this.callSimulationWorker(snapshot, scenario);
    } catch (error) {
      this.logger.error('Simulation worker call failed.', error instanceof Error ? error.stack : String(error));
      if (process.env.EDT_ALLOW_ORACLE_FALLBACK === 'false') {
        throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'simulation_worker_unavailable', 'Simulation worker is unavailable.', true);
      }
      result = this.oracleSimulationResult(scenario);
    }
    const workerResultId = typeof result.simulation_id === 'string' ? result.simulation_id : undefined;
    const run: SimulationRecord = {
      ...result,
      simulation_id: simulationId,
      tenant_id: ctx.tenantId,
      snapshot_id: scenario.snapshot_id,
      snapshot_hash: scenario.snapshot_hash,
      scenario_id: scenario.scenario_id,
      scenario_hash: scenario.scenario_digest,
      engine_version: String(result.engine_version ?? 'pert-monte-carlo/1.0.0+oracle-fallback'),
      calendar_version: 'aster-working-calendar/1.0.0',
      seed: scenario.seed,
      sample_count: scenario.sample_count,
      target_date: scenario.target_date,
      status: 'succeeded',
      worker_result_id: workerResultId,
      created_at: nowIso(),
      completed_at: nowIso(),
    };
    run.result_sha256 = typeof result.result_sha256 === 'string'
      ? result.result_sha256
      : sha256(this.simulationHashDomain(run));
    this.simulations.set(simulationId, run);
    await this.database.put(ctx.tenantId, 'simulation_run', simulationId, run);
    await this.audit(ctx, 'simulation.run', 'simulation_run', simulationId, 'succeeded');
    return { run, status_url: `/v1/simulations/${simulationId}`, events_url: `/v1/simulations/${simulationId}/events` };
  }

  getSimulation(ctx: RequestContext, simulationId: string): Record<string, unknown> {
    const run = this.simulations.get(simulationId);
    if (!run || run.tenant_id !== ctx.tenantId) throw this.notFound();
    return { run, events_url: `/v1/simulations/${simulationId}/events` };
  }

  async createPreview(ctx: RequestContext, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (ctx.tenantId !== ASTER_TENANT_ID || !ctx.actor.capabilities.includes('jira_remediation.preview')) {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'action_preview_denied', 'The action preview is not authorized.');
    }
    const command = (body.command ?? {}) as Record<string, unknown>;
    this.assertExactCommand(command);
    if (this.jiraIssue.version !== 7) throw new ProblemException(HttpStatus.CONFLICT, 'source_version_changed', 'AST-142 is no longer at source version 7.');
    const createdAt = nowIso();
    const previewId = newId();
    const approvedPayload = { ...command, tenantId: ctx.tenantId };
    const payloadHash = sha256(approvedPayload);
    const preliminary = {
      before: this.jiraIssue,
      approved_payload: approvedPayload,
      payload_hash: payloadHash,
      reason: String(body.reason ?? ''),
      evidence_ids: Array.isArray(body.evidence_ids) ? body.evidence_ids.map(String).sort() : [],
      simulation_id: String(body.simulation_id ?? ''),
      created_at: createdAt,
      expires_at: addSeconds(createdAt, 300),
    };
    if (!preliminary.reason || !preliminary.evidence_ids.length || !preliminary.simulation_id) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'governance_evidence_required', 'Reason, evidence IDs, and simulation ID are required.');
    }
    const previewHash = sha256(preliminary);
    const preview: PreviewRecord = {
      preview_id: previewId,
      tenant_id: ctx.tenantId,
      requester_id: ctx.actor.actor_id,
      status: 'ready_for_approval',
      ...preliminary,
      preview_hash: previewHash,
    };
    this.previews.set(previewId, preview);
    await this.database.put(ctx.tenantId, 'action_preview', previewId, preview);
    await this.audit(ctx, 'jira_remediation.preview', 'action_preview', previewId, 'succeeded');
    return this.publicPreview(preview);
  }

  async requestApproval(ctx: RequestContext, previewId: string, ifMatch: string | undefined, idempotencyKey: string): Promise<Record<string, unknown>> {
    const preview = this.previews.get(previewId);
    if (!preview || preview.tenant_id !== ctx.tenantId || preview.requester_id !== ctx.actor.actor_id) throw this.notFound();
    if (!ifMatch) throw new ProblemException(HttpStatus.PRECONDITION_REQUIRED, 'if_match_required', 'If-Match is required.');
    if (ifMatch !== etag(preview.preview_hash)) throw new ProblemException(HttpStatus.PRECONDITION_FAILED, 'preview_changed', 'Preview hash mismatch.');
    if (this.isExpired(preview.expires_at)) throw new ProblemException(HttpStatus.GONE, 'preview_expired', 'Preview expired.');
    const replay = [...this.approvals.values()].find((approval) => approval.preview_id === previewId && approval.idempotency_key === idempotencyKey);
    if (replay) return this.publicApproval(replay);
    const createdAt = nowIso();
    const approvalId = newId();
    const envelope = {
      tenant_id: ctx.tenantId,
      requester_id: ctx.actor.actor_id,
      preview_id: previewId,
      payload_hash: preview.payload_hash,
      idempotency_key: idempotencyKey,
      policy_version: ctx.policyVersion,
      credential_version: 'jira-oauth/1',
      reason: preview.reason,
      evidence_ids: preview.evidence_ids,
      simulation_id: preview.simulation_id,
      before_snapshot_hash: sha256(preview.before),
      required_roles: ['operations_approver', 'security_approver'],
      created_at: createdAt,
      expires_at: addSeconds(createdAt, 900),
    };
    const approval: ApprovalRecord = {
      approval_id: approvalId,
      tenant_id: ctx.tenantId,
      requester_id: ctx.actor.actor_id,
      preview_id: previewId,
      payload_hash: preview.payload_hash,
      approval_binding_hash: sha256(envelope),
      idempotency_key: idempotencyKey,
      policy_version: ctx.policyVersion,
      credential_version: 'jira-oauth/1',
      reason: preview.reason,
      evidence_ids: preview.evidence_ids,
      simulation_id: preview.simulation_id,
      before_snapshot_hash: sha256(preview.before),
      created_at: createdAt,
      expires_at: addSeconds(createdAt, 900),
      status: 'pending',
      decisions: [],
      kind: 'remediation',
    };
    preview.status = 'approval_opened';
    this.approvals.set(approvalId, approval);
    await this.database.put(ctx.tenantId, 'approval', approvalId, approval);
    await this.audit(ctx, 'approval.request', 'approval', approvalId, 'succeeded');
    return this.publicApproval(approval);
  }

  getApproval(ctx: RequestContext, approvalId: string): Record<string, unknown> {
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.tenant_id !== ctx.tenantId) throw this.notFound();
    this.refreshApprovalExpiry(approval);
    return this.publicApproval(approval);
  }

  async decideApproval(ctx: RequestContext, approvalId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.tenant_id !== ctx.tenantId) throw this.notFound();
    this.refreshApprovalExpiry(approval);
    if (approval.status !== 'pending') throw new ProblemException(HttpStatus.CONFLICT, 'approval_not_pending', 'Approval is not pending.');
    if (ctx.actor.actor_id === approval.requester_id) throw new ProblemException(HttpStatus.FORBIDDEN, 'requester_cannot_approve', 'The requester cannot approve their own action.');
    const role = ctx.actor.roles.includes('operations_approver')
      ? 'operations_approver'
      : ctx.actor.roles.includes('security_approver')
        ? 'security_approver'
        : undefined;
    if (!role) throw new ProblemException(HttpStatus.FORBIDDEN, 'approver_role_required', 'An active approval role is required.');
    if (approval.decisions.some((decision) => decision.actor_id === ctx.actor.actor_id || decision.role === role)) {
      throw new ProblemException(HttpStatus.CONFLICT, 'duplicate_approval_slot', 'The actor or approval role has already supplied a decision.');
    }
    if (body.payload_hash !== approval.payload_hash) throw new ProblemException(HttpStatus.CONFLICT, 'payload_hash_mismatch', 'Approval payload hash mismatch.');
    const decisionValue = body.decision === 'deny' ? 'deny' : body.decision === 'approve' ? 'approve' : undefined;
    if (!decisionValue) throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_decision', 'Decision must be approve or deny.');
    const decision: ApprovalDecisionRecord = { decision_id: newId(), actor_id: ctx.actor.actor_id, role, decision: decisionValue, decided_at: nowIso() };
    approval.decisions.push(decision);
    if (decisionValue === 'deny') approval.status = 'denied';
    if (approval.decisions.length === 2 && approval.decisions.every((item) => item.decision === 'approve')) {
      approval.status = 'approved';
      approval.action_grant_id = newId();
    }
    await this.database.put(ctx.tenantId, 'approval', approvalId, approval);
    await this.database.put(ctx.tenantId, 'approval_decision', decision.decision_id, decision);
    await this.audit(ctx, `approval.${decisionValue}`, 'approval', approvalId, 'succeeded');
    return this.publicApproval(approval);
  }

  async executeApproval(ctx: RequestContext, approvalId: string, idempotencyKey: string): Promise<ReceiptRecord> {
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.tenant_id !== ctx.tenantId) throw this.notFound();
    const replayKey = `${ctx.tenantId}:${approvalId}:${idempotencyKey}`;
    const replayId = this.executionReplay.get(replayKey);
    if (replayId) return this.receipts.get(replayId) as ReceiptRecord;
    this.refreshApprovalExpiry(approval);
    if (approval.status !== 'approved' || !approval.action_grant_id || approval.decisions.length !== 2) {
      throw new ProblemException(HttpStatus.CONFLICT, 'execution_grant_unavailable', 'A valid unused two-person execution grant is required.');
    }
    const preview = this.previews.get(approval.preview_id);
    if (!preview) throw this.notFound();
    const before = structuredClone(this.jiraIssue);
    let after: JiraIssueSnapshot;
    let status: ReceiptRecord['status'];
    if (approval.kind === 'remediation') {
      if (this.jiraIssue.version !== 7 || sha256(this.jiraIssue) !== sha256(preview.before)) {
        throw new ProblemException(HttpStatus.CONFLICT, 'source_version_changed', 'AST-142 no longer matches the approved before state.');
      }
      after = {
        issueKey: 'AST-142',
        version: 8,
        fields: { duedate: '2026-07-31', labels: ['digital-twin-remediation', 'identity', 'orion'], priority: { id: '2', name: 'High' } },
      };
      status = 'succeeded';
    } else {
      const original = approval.original_receipt_id ? this.receipts.get(approval.original_receipt_id) : undefined;
      if (!original || sha256(this.jiraIssue) !== original.after_hash) {
        throw new ProblemException(HttpStatus.CONFLICT, 'compensation_conflict', 'Current Jira state changed after execution; rollback will not overwrite it.');
      }
      after = structuredClone(original.before_snapshot);
      after.version = this.jiraIssue.version + 1;
      status = 'compensated';
    }
    this.jiraIssue = structuredClone(after);
    const receiptId = newId();
    const receipt: ReceiptRecord = {
      receipt_id: receiptId,
      tenant_id: ctx.tenantId,
      approval_id: approvalId,
      approved_payload_id: preview.preview_id,
      grant_id: approval.action_grant_id,
      payload_hash: approval.payload_hash,
      approval_binding_hash: approval.approval_binding_hash,
      decision_ids: approval.decisions.map((decision) => decision.decision_id),
      idempotency_key: idempotencyKey,
      provider: 'jira',
      provider_resource_id: 'AST-142',
      provider_request_id: `jira-sim-${newId()}`,
      before_snapshot: before,
      after_snapshot: after,
      before_hash: sha256(before),
      after_hash: sha256(after),
      execution_started_at: nowIso(),
      recorded_at: nowIso(),
      trace_id: traceId(),
      status,
    };
    approval.status = approval.kind === 'remediation' ? 'executed' : 'compensated';
    this.receipts.set(receiptId, receipt);
    this.executionReplay.set(replayKey, receiptId);
    await this.database.put(ctx.tenantId, 'action_receipt', receiptId, receipt);
    await this.database.put(ctx.tenantId, 'approval', approvalId, approval);
    await this.audit(ctx, approval.kind === 'remediation' ? 'jira_remediation.execute' : 'jira_remediation.compensate', 'action_receipt', receiptId, 'succeeded');
    return receipt;
  }

  async createCompensationApproval(ctx: RequestContext, receiptId: string, idempotencyKey: string): Promise<Record<string, unknown>> {
    const receipt = this.receipts.get(receiptId);
    if (!receipt || receipt.tenant_id !== ctx.tenantId) throw this.notFound();
    if (sha256(this.jiraIssue) !== receipt.after_hash) {
      throw new ProblemException(HttpStatus.CONFLICT, 'compensation_conflict', 'Current Jira state differs from the recorded after state.');
    }
    const previewId = newId();
    const createdAt = nowIso();
    const preview: PreviewRecord = {
      preview_id: previewId,
      tenant_id: ctx.tenantId,
      requester_id: ctx.actor.actor_id,
      status: 'approval_opened',
      before: structuredClone(this.jiraIssue),
      approved_payload: { action: 'jira.issue.update', restoreReceiptId: receiptId, issueKey: 'AST-142', tenantId: ctx.tenantId },
      payload_hash: sha256({ restore: receipt.before_snapshot, expected: receipt.after_hash }),
      preview_hash: '',
      reason: 'Restore the exact recorded pre-remediation AST-142 state.',
      evidence_ids: [stableUuid(`receipt:${receiptId}`)],
      simulation_id: this.approvals.get(receipt.approval_id)?.simulation_id ?? stableUuid('simulation:unknown'),
      created_at: createdAt,
      expires_at: addSeconds(createdAt, 900),
    };
    preview.preview_hash = sha256(preview);
    this.previews.set(previewId, preview);
    const approvalId = newId();
    const approval: ApprovalRecord = {
      approval_id: approvalId,
      tenant_id: ctx.tenantId,
      requester_id: ctx.actor.actor_id,
      preview_id: previewId,
      payload_hash: preview.payload_hash,
      approval_binding_hash: sha256({ preview_hash: preview.preview_hash, idempotency_key: idempotencyKey, policy_version: ctx.policyVersion }),
      idempotency_key: idempotencyKey,
      policy_version: ctx.policyVersion,
      credential_version: 'jira-oauth/1',
      reason: preview.reason,
      evidence_ids: preview.evidence_ids,
      simulation_id: preview.simulation_id,
      before_snapshot_hash: sha256(preview.before),
      created_at: createdAt,
      expires_at: addSeconds(createdAt, 900),
      status: 'pending',
      decisions: [],
      kind: 'compensation',
      original_receipt_id: receiptId,
    };
    this.approvals.set(approvalId, approval);
    await this.database.put(ctx.tenantId, 'approval', approvalId, approval);
    await this.audit(ctx, 'compensation.preview', 'approval', approvalId, 'succeeded');
    return this.publicApproval(approval);
  }

  listAudit(ctx: RequestContext, pageSize: number): Page<AuditRecord> {
    const items = (this.audits.get(ctx.tenantId) ?? []).slice(-pageSize).reverse();
    return { items, next_cursor: null, has_more: false, data_watermark: this.watermark() };
  }

  connectors(ctx: RequestContext): Page<Record<string, unknown>> {
    const tenant = this.fixtures.seed.tenants.find((item) => item.tenant_id === ctx.tenantId);
    if (!tenant) throw this.notFound();
    return {
      items: [
        { installation_id: tenant.github_installation_id, provider: 'github', status: 'healthy', scopes: ['metadata:read'], last_reconciled_at: '2026-07-13T15:47:00Z', freshness_seconds: 780 },
        { installation_id: tenant.jira_installation_id, provider: 'jira', status: 'healthy', scopes: ['read:jira-work', 'write:jira-work:allowlisted'], last_reconciled_at: '2026-07-13T15:46:30Z', freshness_seconds: 810 },
      ],
      next_cursor: null,
      has_more: false,
      data_watermark: this.watermark(),
    };
  }

  getScenarioEtag(scenarioId: string): string | undefined {
    const scenario = this.scenarios.get(scenarioId);
    return scenario ? etag(scenario.scenario_digest) : undefined;
  }

  getPreviewEtag(previewId: string): string | undefined {
    const preview = this.previews.get(previewId);
    return preview ? etag(preview.preview_hash) : undefined;
  }

  private eventProjectionOverlay(ctx: RequestContext): EventProjectionReadOverlay | undefined {
    const permitted = ctx.actor.capabilities.some((capability) => capability.startsWith('evidence.read.'))
      || ctx.actor.capabilities.includes('scenario.create');
    if (!permitted || ctx.actor.actor_alias === 'usr_platform_operator' || ctx.actor.actor_alias === 'usr_aster_limited') return undefined;
    return this.eventProjection.readOverlay(ctx.tenantId);
  }

  private eventProjectionAssumptions(snapshot: EventProjectionSnapshot): string[] {
    const relevantOperations = new Set(['scenario_delta', 'set_risk', 'create_scenario_task']);
    const impactAssumptions = snapshot.facts
      .filter((fact) => relevantOperations.has(String(fact.mutation.operation)))
      .slice(0, 16)
      .map((fact) => {
        const operation = String(fact.mutation.operation).replaceAll('_', ' ');
        const subject = fact.mutation.entity ?? fact.mutation.entity_id ?? fact.mutation.metric ?? 'the affected project plan';
        return `Synthetic event impact ${fact.impact_id} contributes a ${operation} assumption for ${String(subject)}; it is not independent evidence or a calibrated forecast.`;
      });
    return [
      `The simulation snapshot is bound to synthetic event projection version ${snapshot.version} and state hash ${snapshot.state_hash}.`,
      ...impactAssumptions,
    ];
  }

  private factTouchesEntity(mutation: Record<string, unknown>, entityId: string): boolean {
    return [mutation.entity_id, mutation.from_entity_id, mutation.to_entity_id].some((value) => value === entityId);
  }

  private entityFromSource(source: SourceObjectRecord): Record<string, unknown> {
    return {
      entity_id: stableUuid(`${source.tenant_id}:${source.source_key}`),
      tenant_id: source.tenant_id,
      type: source.provider === 'jira' ? 'edt.work.JiraIssue' : 'edt.engineering.PullRequest',
      ontology_version: 'edt.core/1.0.0',
      lifecycle_state: 'active',
      version: Number.parseInt(source.source_revision, 10) || 1,
      properties: { key: source.source_key, provider: source.provider, ...source.fields },
      classification: source.acl_class.includes('restricted') || source.acl_class.includes('private') ? 'restricted' : 'internal',
    };
  }

  private claimFromSource(source: SourceObjectRecord): Record<string, unknown> {
    const evidenceId = stableUuid(`evidence:${source.source_object_id}`);
    return {
      claim_id: stableUuid(`claim:${source.source_object_id}`),
      tenant_id: source.tenant_id,
      subject_id: stableUuid(`${source.tenant_id}:${source.source_key}`),
      predicate: 'edt.core/source_summary',
      object: { value: String(source.fields.summary ?? source.fields.title ?? source.source_key) },
      source_revision: source.source_revision,
      confidence: 1,
      evidence_ids: [evidenceId],
      status: 'accepted',
    };
  }

  private citationFromSource(source: SourceObjectRecord): Record<string, unknown> {
    return {
      citation_id: stableUuid(`citation:${source.source_object_id}`),
      claim_id: stableUuid(`claim:${source.source_object_id}`),
      evidence_id: stableUuid(`evidence:${source.source_object_id}`),
      source_provider: source.provider,
      source_object_id: source.source_object_id,
      source_revision: source.source_revision,
      authorized_locator: `/v1/evidence/${stableUuid(`evidence:${source.source_object_id}`)}`,
      source_updated_at: source.observed_at,
      twin_ingested_at: source.observed_at,
      observed_at: source.observed_at,
      content_hash: sha256(source),
    };
  }

  private citedLaunchRiskAnswer(sources: SourceObjectRecord[]): Record<string, unknown> {
    const citations = sources.map((source) => this.citationFromSource(source));
    const citationBySource = new Map(sources.map((source, index) => [source.source_key, citations[index].citation_id]));
    return {
      answer: 'AST-142 is the strongest evidenced launch blocker: it blocks AST-173, which blocks AST-201 and the Orion 2.0 milestone. The linked identity-service pull request is still missing one required security review. OPS-61 and PROD-88 are secondary risks but are not on the current p80 critical path.',
      claims: [
        { claim_id: stableUuid('answer:critical-path'), statement: 'AST-142 blocks AST-173, which blocks AST-201 and Orion 2.0 General Availability.', epistemic_status: 'source_fact', confidence: 1, citation_ids: ['AST-142', 'AST-173', 'AST-201'].map((key) => citationBySource.get(key)) },
        { claim_id: stableUuid('answer:security-review'), statement: 'aster-labs/identity-service#184 implements AST-142 and is missing one required security review.', epistemic_status: 'source_fact', confidence: 1, citation_ids: [citationBySource.get('aster-labs/identity-service#184')] },
      ],
      citations,
      missing_information: ['future security review completion time', 'unrecorded work', 'external validity of synthetic duration distributions'],
      abstained: false,
      abstention_reason: null,
      source_freshness: { github: '2026-07-13T15:47:00Z', jira: '2026-07-13T15:46:30Z' },
      projection_checkpoint: { tenant_id: ASTER_TENANT_ID, projection: 'neo4j', outbox_position: 42, ontology_version: 'edt.core/1.0.0', completed_at: '2026-07-13T15:48:00Z' },
      generated_at: nowIso(),
    };
  }

  private abstainedAnswer(ctx: RequestContext): Record<string, unknown> {
    return {
      answer: 'I cannot support that conclusion from evidence currently authorized in this tenant context.',
      claims: [],
      citations: [],
      missing_information: ['authorized evidence sufficient to establish the launch dependency chain'],
      abstained: true,
      abstention_reason: 'Evidence is inaccessible or insufficient; no restricted locator or cross-tenant detail is disclosed.',
      source_freshness: {},
      projection_checkpoint: { tenant_id: ctx.tenantId, projection: 'neo4j', outbox_position: 42, ontology_version: 'edt.core/1.0.0', completed_at: '2026-07-13T15:48:00Z' },
      generated_at: nowIso(),
    };
  }

  private workforceAbstainedAnswer(ctx: RequestContext): Record<string, unknown> {
    return {
      answer: 'I cannot rank people or infer productivity, burnout, attrition, performance, health, or other employment outcomes from work metadata.',
      claims: [],
      citations: [],
      missing_information: [],
      abstained: true,
      abstention_reason: 'The request asks for a workforce-sensitive inference excluded from the committed system boundary.',
      source_freshness: {},
      projection_checkpoint: { tenant_id: ctx.tenantId, projection: 'neo4j', outbox_position: 42, ontology_version: 'edt.core/1.0.0', completed_at: '2026-07-13T15:48:00Z' },
      generated_at: nowIso(),
    };
  }

  private publicRun(run: AgentRunRecord): Record<string, unknown> {
    return {
      run_id: run.run_id,
      tenant_id: run.tenant_id,
      profile_id: run.profile_id,
      status: run.status,
      model_config_version: 'grounded-answer/1.0.0',
      policy_version: 'h1-policy/1.0.0',
      budget: { max_seconds: 20, max_tokens: 12000, max_cost_units: 10, max_tools: 8 },
      created_at: run.created_at,
      completed_at: run.completed_at,
    };
  }

  private task(id: string, key: string, label: string, team: string, optimistic: number, mostLikely: number, pessimistic: number): Record<string, unknown> {
    return {
      work_item_id: id,
      source_key: key,
      label,
      state: 'in_progress',
      team_id: stableUuid(`${ASTER_TENANT_ID}:${team}`),
      remaining_duration: { optimistic, most_likely: mostLikely, pessimistic, unit: 'workday', source: 'explicit' },
      earliest_start: null,
      actual_finish: null,
      external_blocker: false,
      external_blocker_until: null,
      evidence_ids: [stableUuid(`evidence:aster-jira-${key}`)],
    };
  }

  private dependency(predecessor: string, successor: string, relationshipId: string): Record<string, unknown> {
    return { predecessor_work_item_id: predecessor, successor_work_item_id: successor, type: 'finish_to_start', lag_workdays: 0, source_relationship_id: relationshipId, evidence_ids: [stableUuid(`evidence:${relationshipId}`)] };
  }

  private publicScenario(scenario: ScenarioRecord): Record<string, unknown> {
    return {
      scenario_id: scenario.scenario_id,
      tenant_id: scenario.tenant_id,
      snapshot_id: scenario.snapshot_id,
      snapshot_hash: scenario.snapshot_hash,
      name: scenario.name,
      target_date: scenario.target_date,
      model_version: 'pert-monte-carlo/1.0.0',
      calendar_version: 'aster-working-calendar/1.0.0',
      compiler_version: 'scenario-compiler/1.0.0',
      seed: scenario.seed,
      sample_count: scenario.sample_count,
      interventions: scenario.interventions,
      assumptions: [],
      confirmed_by: scenario.confirmed_by,
      confirmed_at: scenario.confirmed_at,
      scenario_digest: scenario.scenario_digest,
    };
  }

  private async callSimulationWorker(snapshot: Record<string, unknown>, scenario: ScenarioRecord): Promise<Record<string, unknown>> {
    const endpoint = process.env.AI_WORKER_URL ?? 'http://127.0.0.1:8010';
    const internalHeaders: Record<string, string> = {
      'content-type': 'application/json',
      'x-internal-tenant-id': scenario.tenant_id,
    };
    const sharedSecret = process.env.AI_WORKER_SHARED_SECRET;
    if (sharedSecret) internalHeaders['x-internal-service-token'] = sharedSecret;
    const response = await fetch(`${endpoint}/v1/simulations`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ snapshot, scenario: this.publicScenario(scenario) }),
      signal: AbortSignal.timeout(this.simulationWorkerTimeout()),
    });
    const responseBody = await response.text();
    if (!response.ok) throw new Error(`simulation worker returned ${response.status}: ${responseBody}`);
    return JSON.parse(responseBody) as Record<string, unknown>;
  }

  private simulationWorkerTimeout(): number {
    const configured = Number(process.env.SIMULATION_WORKER_TIMEOUT_MS ?? 60_000);
    return Number.isInteger(configured) && configured >= 1_000 && configured <= 120_000 ? configured : 60_000;
  }

  private oracleSimulationResult(scenario: ScenarioRecord): Record<string, unknown> {
    const baseline = { p50: '2026-08-20', p80: '2026-08-24', p95: '2026-08-27' };
    const forecast = { p50: '2026-08-13', p80: '2026-08-17', p95: '2026-08-20' };
    return {
      engine_version: 'pert-monte-carlo/1.0.0+oracle-fallback',
      uncertainty: { method: 'seeded_pert_monte_carlo', sample_count: 50000, seed: scenario.seed, quantiles: forecast, batch_standard_errors_days: { p50: 0.1, p80: 0.2, p95: 0.4 }, warnings: ['Oracle fallback is permitted only in the explicit synthetic demo profile.'] },
      probability_on_or_before_target: 0.72,
      probability_after_target: 0.28,
      critical_path: [AST_142_WORK_ITEM_ID, stableUuid(`${ASTER_TENANT_ID}:AST-173`), stableUuid(`${ASTER_TENANT_ID}:AST-201`)],
      criticality: [{ work_item_id: AST_142_WORK_ITEM_ID, index: 0.93 }],
      blockers: [{ work_item_id: AST_142_WORK_ITEM_ID, label: 'Complete SSO cutover', criticality: 0.93, evidence_ids: [stableUuid('evidence:aster-jira-AST-142-v7')] }],
      sensitivity: [{ factor: 'AST-142 duration', method: 'spearman_rank', score: 0.82, absolute_rank: 1, criticality_index: 0.93, unstable: false, evidence_ids: [stableUuid('evidence:aster-jira-AST-142-v7')] }],
      assumptions: [],
      missing_data: ['future security review completion time', 'unrecorded work', 'external validity of synthetic duration distributions'],
      warnings: ['This is a conditional synthetic simulation, not an individual-productivity or causal forecast.'],
      baseline_comparison: { baseline_simulation_id: stableUuid('baseline:aster:orion'), baseline_forecast: baseline, scenario_forecast: forecast, paired_deltas: { uri: '/v1/simulation-artifacts/orion-paired-deltas', sha256: sha256('orion-paired-deltas'), count: 50000, encoding: 'application/json+gzip' }, p50_delta_workdays: -5, p80_delta_workdays: -5, p95_delta_workdays: -6, probability_of_improvement: 0.89, changed_criticality: [{ work_item_id: AST_142_WORK_ITEM_ID, baseline_index: 0.97, scenario_index: 0.93, delta: -0.04 }], critical_path_changed: false, negative_delta_means: 'earlier_completion' },
      evidence_ids: this.fixtures.sources.source_objects.filter((source) => source.tenant_id === ASTER_TENANT_ID).map((source) => stableUuid(`evidence:${source.source_object_id}`)),
    };
  }

  private simulationHashDomain(run: Record<string, unknown>): Record<string, unknown> {
    const excluded = new Set(['simulation_id', 'tenant_id', 'status', 'created_at', 'completed_at', 'result_sha256']);
    return Object.fromEntries(Object.entries(run).filter(([key]) => !excluded.has(key)));
  }

  private assertExactCommand(command: Record<string, unknown>): void {
    const expected = {
      action: 'jira.issue.update',
      connectorInstallationId: ASTER_JIRA_INSTALLATION_ID,
      expectedIssueVersion: 7,
      issueKey: 'AST-142',
      projectKey: 'AST',
      set: { duedate: '2026-07-31', labels: ['digital-twin-remediation', 'identity', 'orion'], priorityId: '2' },
    };
    if (canonicalize(command) !== canonicalize(expected)) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'action_payload_not_allowlisted', 'Only the frozen AST-142 remediation command is allowed in H1.');
    }
  }

  private publicPreview(preview: PreviewRecord): Record<string, unknown> {
    return {
      preview_id: preview.preview_id,
      status: preview.status === 'ready_for_approval' ? 'ready_for_approval' : preview.status,
      before: preview.before,
      approved_payload: preview.approved_payload,
      payload_hash: preview.payload_hash,
      preview_hash: preview.preview_hash,
      reason: preview.reason,
      evidence_ids: preview.evidence_ids,
      simulation_id: preview.simulation_id,
      created_at: preview.created_at,
      expires_at: preview.expires_at,
      etag: etag(preview.preview_hash),
    };
  }

  private publicApproval(approval: ApprovalRecord): Record<string, unknown> {
    return {
      approval_id: approval.approval_id,
      tenant_id: approval.tenant_id,
      requester_id: approval.requester_id,
      approved_payload_id: approval.preview_id,
      action_type: 'jira.issue.update',
      payload_hash: approval.payload_hash,
      approval_binding_hash: approval.approval_binding_hash,
      idempotency_key: approval.idempotency_key,
      policy_version: approval.policy_version,
      credential_version: approval.credential_version,
      reason: approval.reason,
      evidence_ids: approval.evidence_ids,
      simulation_id: approval.simulation_id,
      before_snapshot_hash: approval.before_snapshot_hash,
      created_at: approval.created_at,
      expires_at: approval.expires_at,
      required_approvals: 2,
      required_roles: ['operations_approver', 'security_approver'],
      decision_ids: approval.decisions.map((decision) => decision.decision_id),
      decisions: approval.decisions,
      action_grant_id: approval.action_grant_id,
      status: approval.status,
      kind: approval.kind,
      original_receipt_id: approval.original_receipt_id,
    };
  }

  private refreshApprovalExpiry(approval: ApprovalRecord): void {
    if (approval.status === 'pending' && this.isExpired(approval.expires_at)) approval.status = 'expired';
  }

  private isExpired(expiresAt: string): boolean {
    const reference = process.env.EDT_FROZEN_CLOCK === 'true' ? new Date(nowIso()).getTime() : Date.now();
    return new Date(expiresAt).getTime() <= reference;
  }

  private async audit(ctx: RequestContext, action: string, resourceType: string, resourceId: string, outcome: AuditRecord['outcome']): Promise<void> {
    const current = this.audits.get(ctx.tenantId) ?? [];
    const previousHash = current.at(-1)?.event_hash ?? '0'.repeat(64);
    const base = {
      event_id: newId(),
      tenant_id: ctx.tenantId,
      tenant_sequence: current.length + 1,
      occurred_at: nowIso(),
      actor_id: ctx.actor.actor_id,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      outcome,
      request_id: ctx.requestId,
      trace_id: traceId(),
      reason_codes: [],
      previous_hash: previousHash,
    };
    const record: AuditRecord = { ...base, event_hash: sha256(base) };
    current.push(record);
    this.audits.set(ctx.tenantId, current);
    await this.database.put(ctx.tenantId, 'audit_event', record.event_id, record);
  }

  private notFound(): ProblemException {
    return new ProblemException(HttpStatus.NOT_FOUND, 'not_found', 'The resource was not found.');
  }
}
