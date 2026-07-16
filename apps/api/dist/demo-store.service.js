"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var DemoStoreService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DemoStoreService = void 0;
const common_1 = require("@nestjs/common");
const domain_1 = require("./domain");
const database_service_1 = require("./database.service");
const event_projection_service_1 = require("./event-projection.service");
const fixture_service_1 = require("./fixture.service");
const problem_1 = require("./problem");
let DemoStoreService = DemoStoreService_1 = class DemoStoreService {
    fixtures;
    database;
    eventProjection;
    logger = new common_1.Logger(DemoStoreService_1.name);
    agentRuns = new Map();
    snapshots = new Map();
    scenarios = new Map();
    simulations = new Map();
    previews = new Map();
    approvals = new Map();
    receipts = new Map();
    executionReplay = new Map();
    audits = new Map();
    jiraIssue = {
        issueKey: 'AST-142',
        version: 7,
        fields: { duedate: '2026-08-07', labels: ['identity', 'orion'], priority: { id: '3', name: 'Medium' } },
    };
    constructor(fixtures, database, eventProjection) {
        this.fixtures = fixtures;
        this.database = database;
        this.eventProjection = eventProjection;
    }
    onModuleInit() {
        this.fixtures.assertFrozenTenants();
    }
    watermark() {
        return {
            projection_checkpoint_id: '90000000-0000-4000-8000-000000000001',
            outbox_position: 42,
            observed_at: '2026-07-13T15:47:00Z',
        };
    }
    listEntities(ctx, pageSize) {
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
    getEntity(ctx, entityId) {
        const source = this.fixtures.visibleSources(ctx.actor).find((item) => (0, domain_1.stableUuid)(`${item.tenant_id}:${item.source_key}`) === entityId);
        const overlay = this.eventProjectionOverlay(ctx);
        const projected = overlay?.entities.find((entity) => entity.entity_id === entityId);
        if (!source && !projected)
            throw this.notFound();
        if (projected && overlay) {
            const facts = overlay.facts.filter((fact) => this.factTouchesEntity(fact.mutation, entityId));
            return {
                entity: projected,
                claims: facts.map((fact) => ({
                    claim_id: (0, domain_1.stableUuid)(`event-projection-claim:${ctx.tenantId}:${fact.impact_id}`),
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
                etag: (0, domain_1.etag)((0, domain_1.sha256)({ projected, projection_version: overlay.version, state_hash: overlay.state_hash })),
            };
        }
        if (!source)
            throw this.notFound();
        return {
            entity: this.entityFromSource(source),
            claims: [this.claimFromSource(source)],
            provenance: [this.citationFromSource(source)],
            relationships: [
                ...this.fixtures.tenantRelationships(ctx.tenantId).filter((edge) => edge.from === source.source_key || edge.to === source.source_key),
                ...(overlay?.relationships.filter((edge) => edge.from === entityId || edge.to === entityId) ?? []),
            ],
            data_watermark: this.watermark(),
            etag: (0, domain_1.etag)((0, domain_1.sha256)(source)),
        };
    }
    traverse(ctx, input) {
        const allowedTemplates = ['delivery_dependencies', 'ownership_path', 'evidence_path', 'incident_blast_radius'];
        if (!allowedTemplates.includes(String(input.template))) {
            throw new problem_1.ProblemException(common_1.HttpStatus.BAD_REQUEST, 'invalid_traversal_template', 'Traversal template is not allowlisted.');
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
    async createQuestion(ctx, question) {
        if (!question.trim())
            throw new problem_1.ProblemException(common_1.HttpStatus.BAD_REQUEST, 'question_required', 'Question must not be empty.');
        const runId = (0, domain_1.newId)();
        const sources = this.fixtures.visibleSources(ctx.actor);
        const required = ['AST-142', 'AST-173', 'AST-201', 'aster-labs/identity-service#184'];
        const evidence = sources.filter((source) => required.includes(source.source_key));
        const supported = ctx.tenantId === domain_1.ASTER_TENANT_ID && evidence.length === required.length;
        const workforceSensitive = /\b(burnout|attrition|productivity|performance|rank|compensation|emotion|health|misconduct|hiring)\b/i.test(question);
        const result = workforceSensitive
            ? this.workforceAbstainedAnswer(ctx)
            : supported
                ? this.citedLaunchRiskAnswer(evidence)
                : this.abstainedAnswer(ctx);
        const run = {
            run_id: runId,
            tenant_id: ctx.tenantId,
            profile_id: 'AGENT-QUERY/1.0.0',
            status: 'succeeded',
            created_at: (0, domain_1.nowIso)(),
            completed_at: (0, domain_1.nowIso)(),
            result,
        };
        this.agentRuns.set(runId, run);
        await this.database.put(ctx.tenantId, 'agent_run', runId, run);
        await this.audit(ctx, 'question.create', 'agent_run', runId, 'succeeded');
        return { run: this.publicRun(run), status_url: `/v1/agent-runs/${runId}`, events_url: `/v1/agent-runs/${runId}/events` };
    }
    getAgentRun(ctx, runId) {
        const run = this.agentRuns.get(runId);
        if (!run || run.tenant_id !== ctx.tenantId)
            throw this.notFound();
        return { run: this.publicRun(run), result: run.result };
    }
    async cancelAgentRun(ctx, runId) {
        const run = this.agentRuns.get(runId);
        if (!run || run.tenant_id !== ctx.tenantId)
            throw this.notFound();
        const terminal = ['succeeded', 'failed', 'cancelled'].includes(run.status);
        if (!terminal) {
            run.status = 'cancelled';
            run.completed_at = (0, domain_1.nowIso)();
            await this.database.put(ctx.tenantId, 'agent_run', runId, run);
            await this.audit(ctx, 'agent_run.cancel', 'agent_run', runId, 'succeeded');
        }
        return { terminal, view: { run: this.publicRun(run), result: run.result } };
    }
    createSnapshot(ctx, projectId, asOf) {
        if (ctx.tenantId !== domain_1.ASTER_TENANT_ID)
            throw this.notFound();
        const id = (0, domain_1.newId)();
        const ast173 = (0, domain_1.stableUuid)(`${ctx.tenantId}:AST-173`);
        const ast201 = (0, domain_1.stableUuid)(`${ctx.tenantId}:AST-201`);
        const calendar = {
            version: 'aster-working-calendar/1.0.0',
            working_weekdays: [1, 2, 3, 4, 5],
            workday_start: '09:00',
            hours_per_workday: 8,
            holidays: [],
        };
        const eventProjection = this.eventProjection.snapshot(ctx.tenantId);
        const eventAssumptions = this.eventProjectionAssumptions(eventProjection);
        const snapshot = {
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
            calendar: { ...calendar, canonical_sha256: (0, domain_1.sha256)(calendar) },
            tasks: [
                this.task(domain_1.AST_142_WORK_ITEM_ID, 'AST-142', 'Complete SSO cutover', 'aster-identity', 8, 12, 18),
                this.task(ast173, 'AST-173', 'Build Orion release candidate', 'aster-release', 5, 8, 13),
                this.task(ast201, 'AST-201', 'Complete launch certification', 'aster-security', 4, 7, 12),
            ],
            dependencies: [
                this.dependency(domain_1.AST_142_WORK_ITEM_ID, ast173, '75000000-0000-4000-8000-000000000002'),
                this.dependency(ast173, ast201, '75000000-0000-4000-8000-000000000003'),
            ],
            team_capacities: ['aster-identity', 'aster-release', 'aster-security'].map((team) => ({ team_id: (0, domain_1.stableUuid)(`${ctx.tenantId}:${team}`), parallel_capacity: 1, availability: 1, evidence_ids: [(0, domain_1.stableUuid)(`evidence:${team}`)] })),
            assumptions: eventAssumptions,
            warnings: [
                'Synthetic duration distributions have no external predictive validity.',
                `event_projection_version:${eventProjection.version}`,
                `event_projection_state_hash:${eventProjection.state_hash}`,
            ],
            evidence_ids: this.fixtures.visibleSources(ctx.actor).map((source) => (0, domain_1.stableUuid)(`evidence:${source.source_object_id}`)),
            sealed_at: (0, domain_1.nowIso)(),
        };
        snapshot.canonical_sha256 = (0, domain_1.sha256)(snapshot);
        this.snapshots.set(id, snapshot);
        void this.database.put(ctx.tenantId, 'simulation_snapshot', id, snapshot);
        void this.audit(ctx, 'simulation_snapshot.create', 'simulation_snapshot', id, 'succeeded');
        return snapshot;
    }
    createScenario(ctx, input) {
        const snapshotId = String(input.snapshot_id ?? '');
        const snapshot = this.snapshots.get(snapshotId);
        if (!snapshot || snapshot.tenant_id !== ctx.tenantId)
            throw this.notFound();
        const interventions = Array.isArray(input.interventions) ? input.interventions : [];
        if (!interventions.length)
            throw new problem_1.ProblemException(common_1.HttpStatus.BAD_REQUEST, 'intervention_required', 'At least one typed intervention is required.');
        const scenarioId = (0, domain_1.newId)();
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
        const scenario = {
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
            confirmed_at: (0, domain_1.nowIso)(),
        };
        scenario.scenario_digest = (0, domain_1.sha256)({
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
        return { scenario_id: scenarioId, name: scenario.name, snapshot_id: snapshotId, scenario_digest: digest, status: 'draft', compiled_scenario: { ...compiled, scenario_digest: digest }, etag: (0, domain_1.etag)(digest) };
    }
    confirmScenario(ctx, scenarioId, digest, ifMatch) {
        const scenario = this.scenarios.get(scenarioId);
        if (!scenario || scenario.tenant_id !== ctx.tenantId)
            throw this.notFound();
        if (!ifMatch)
            throw new problem_1.ProblemException(common_1.HttpStatus.PRECONDITION_REQUIRED, 'if_match_required', 'If-Match is required.');
        if (ifMatch !== (0, domain_1.etag)(scenario.scenario_digest) || digest !== scenario.scenario_digest) {
            throw new problem_1.ProblemException(common_1.HttpStatus.PRECONDITION_FAILED, 'scenario_digest_mismatch', 'The scenario draft changed or the digest does not match.');
        }
        if (scenario.status !== 'confirmed') {
            scenario.status = 'confirmed';
            void this.database.put(ctx.tenantId, 'scenario', scenarioId, scenario);
            void this.audit(ctx, 'scenario.confirm', 'scenario', scenarioId, 'succeeded');
        }
        return this.publicScenario(scenario);
    }
    async runSimulation(ctx, scenarioId) {
        const scenario = this.scenarios.get(scenarioId);
        if (!scenario || scenario.tenant_id !== ctx.tenantId || scenario.status !== 'confirmed')
            throw this.notFound();
        const snapshot = this.snapshots.get(scenario.snapshot_id);
        if (!snapshot)
            throw this.notFound();
        const simulationId = (0, domain_1.newId)();
        let result;
        try {
            result = await this.callSimulationWorker(snapshot, scenario);
        }
        catch (error) {
            this.logger.error('Simulation worker call failed.', error instanceof Error ? error.stack : String(error));
            if (process.env.EDT_ALLOW_ORACLE_FALLBACK === 'false') {
                throw new problem_1.ProblemException(common_1.HttpStatus.SERVICE_UNAVAILABLE, 'simulation_worker_unavailable', 'Simulation worker is unavailable.', true);
            }
            result = this.oracleSimulationResult(scenario);
        }
        const workerResultId = typeof result.simulation_id === 'string' ? result.simulation_id : undefined;
        const run = {
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
            created_at: (0, domain_1.nowIso)(),
            completed_at: (0, domain_1.nowIso)(),
        };
        run.result_sha256 = typeof result.result_sha256 === 'string'
            ? result.result_sha256
            : (0, domain_1.sha256)(this.simulationHashDomain(run));
        this.simulations.set(simulationId, run);
        await this.database.put(ctx.tenantId, 'simulation_run', simulationId, run);
        await this.audit(ctx, 'simulation.run', 'simulation_run', simulationId, 'succeeded');
        return { run, status_url: `/v1/simulations/${simulationId}`, events_url: `/v1/simulations/${simulationId}/events` };
    }
    getSimulation(ctx, simulationId) {
        const run = this.simulations.get(simulationId);
        if (!run || run.tenant_id !== ctx.tenantId)
            throw this.notFound();
        return { run, events_url: `/v1/simulations/${simulationId}/events` };
    }
    async createPreview(ctx, body) {
        if (ctx.tenantId !== domain_1.ASTER_TENANT_ID || !ctx.actor.capabilities.includes('jira_remediation.preview')) {
            throw new problem_1.ProblemException(common_1.HttpStatus.FORBIDDEN, 'action_preview_denied', 'The action preview is not authorized.');
        }
        const command = (body.command ?? {});
        this.assertExactCommand(command);
        if (this.jiraIssue.version !== 7)
            throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'source_version_changed', 'AST-142 is no longer at source version 7.');
        const createdAt = (0, domain_1.nowIso)();
        const previewId = (0, domain_1.newId)();
        const approvedPayload = { ...command, tenantId: ctx.tenantId };
        const payloadHash = (0, domain_1.sha256)(approvedPayload);
        const preliminary = {
            before: this.jiraIssue,
            approved_payload: approvedPayload,
            payload_hash: payloadHash,
            reason: String(body.reason ?? ''),
            evidence_ids: Array.isArray(body.evidence_ids) ? body.evidence_ids.map(String).sort() : [],
            simulation_id: String(body.simulation_id ?? ''),
            created_at: createdAt,
            expires_at: (0, domain_1.addSeconds)(createdAt, 300),
        };
        if (!preliminary.reason || !preliminary.evidence_ids.length || !preliminary.simulation_id) {
            throw new problem_1.ProblemException(common_1.HttpStatus.BAD_REQUEST, 'governance_evidence_required', 'Reason, evidence IDs, and simulation ID are required.');
        }
        const previewHash = (0, domain_1.sha256)(preliminary);
        const preview = {
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
    async requestApproval(ctx, previewId, ifMatch, idempotencyKey) {
        const preview = this.previews.get(previewId);
        if (!preview || preview.tenant_id !== ctx.tenantId || preview.requester_id !== ctx.actor.actor_id)
            throw this.notFound();
        if (!ifMatch)
            throw new problem_1.ProblemException(common_1.HttpStatus.PRECONDITION_REQUIRED, 'if_match_required', 'If-Match is required.');
        if (ifMatch !== (0, domain_1.etag)(preview.preview_hash))
            throw new problem_1.ProblemException(common_1.HttpStatus.PRECONDITION_FAILED, 'preview_changed', 'Preview hash mismatch.');
        if (this.isExpired(preview.expires_at))
            throw new problem_1.ProblemException(common_1.HttpStatus.GONE, 'preview_expired', 'Preview expired.');
        const replay = [...this.approvals.values()].find((approval) => approval.preview_id === previewId && approval.idempotency_key === idempotencyKey);
        if (replay)
            return this.publicApproval(replay);
        const createdAt = (0, domain_1.nowIso)();
        const approvalId = (0, domain_1.newId)();
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
            before_snapshot_hash: (0, domain_1.sha256)(preview.before),
            required_roles: ['operations_approver', 'security_approver'],
            created_at: createdAt,
            expires_at: (0, domain_1.addSeconds)(createdAt, 900),
        };
        const approval = {
            approval_id: approvalId,
            tenant_id: ctx.tenantId,
            requester_id: ctx.actor.actor_id,
            preview_id: previewId,
            payload_hash: preview.payload_hash,
            approval_binding_hash: (0, domain_1.sha256)(envelope),
            idempotency_key: idempotencyKey,
            policy_version: ctx.policyVersion,
            credential_version: 'jira-oauth/1',
            reason: preview.reason,
            evidence_ids: preview.evidence_ids,
            simulation_id: preview.simulation_id,
            before_snapshot_hash: (0, domain_1.sha256)(preview.before),
            created_at: createdAt,
            expires_at: (0, domain_1.addSeconds)(createdAt, 900),
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
    getApproval(ctx, approvalId) {
        const approval = this.approvals.get(approvalId);
        if (!approval || approval.tenant_id !== ctx.tenantId)
            throw this.notFound();
        this.refreshApprovalExpiry(approval);
        return this.publicApproval(approval);
    }
    async decideApproval(ctx, approvalId, body) {
        const approval = this.approvals.get(approvalId);
        if (!approval || approval.tenant_id !== ctx.tenantId)
            throw this.notFound();
        this.refreshApprovalExpiry(approval);
        if (approval.status !== 'pending')
            throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'approval_not_pending', 'Approval is not pending.');
        if (ctx.actor.actor_id === approval.requester_id)
            throw new problem_1.ProblemException(common_1.HttpStatus.FORBIDDEN, 'requester_cannot_approve', 'The requester cannot approve their own action.');
        const role = ctx.actor.roles.includes('operations_approver')
            ? 'operations_approver'
            : ctx.actor.roles.includes('security_approver')
                ? 'security_approver'
                : undefined;
        if (!role)
            throw new problem_1.ProblemException(common_1.HttpStatus.FORBIDDEN, 'approver_role_required', 'An active approval role is required.');
        if (approval.decisions.some((decision) => decision.actor_id === ctx.actor.actor_id || decision.role === role)) {
            throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'duplicate_approval_slot', 'The actor or approval role has already supplied a decision.');
        }
        if (body.payload_hash !== approval.payload_hash)
            throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'payload_hash_mismatch', 'Approval payload hash mismatch.');
        const decisionValue = body.decision === 'deny' ? 'deny' : body.decision === 'approve' ? 'approve' : undefined;
        if (!decisionValue)
            throw new problem_1.ProblemException(common_1.HttpStatus.BAD_REQUEST, 'invalid_decision', 'Decision must be approve or deny.');
        const decision = { decision_id: (0, domain_1.newId)(), actor_id: ctx.actor.actor_id, role, decision: decisionValue, decided_at: (0, domain_1.nowIso)() };
        approval.decisions.push(decision);
        if (decisionValue === 'deny')
            approval.status = 'denied';
        if (approval.decisions.length === 2 && approval.decisions.every((item) => item.decision === 'approve')) {
            approval.status = 'approved';
            approval.action_grant_id = (0, domain_1.newId)();
        }
        await this.database.put(ctx.tenantId, 'approval', approvalId, approval);
        await this.database.put(ctx.tenantId, 'approval_decision', decision.decision_id, decision);
        await this.audit(ctx, `approval.${decisionValue}`, 'approval', approvalId, 'succeeded');
        return this.publicApproval(approval);
    }
    async executeApproval(ctx, approvalId, idempotencyKey) {
        const approval = this.approvals.get(approvalId);
        if (!approval || approval.tenant_id !== ctx.tenantId)
            throw this.notFound();
        const replayKey = `${ctx.tenantId}:${approvalId}:${idempotencyKey}`;
        const replayId = this.executionReplay.get(replayKey);
        if (replayId)
            return this.receipts.get(replayId);
        this.refreshApprovalExpiry(approval);
        if (approval.status !== 'approved' || !approval.action_grant_id || approval.decisions.length !== 2) {
            throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'execution_grant_unavailable', 'A valid unused two-person execution grant is required.');
        }
        const preview = this.previews.get(approval.preview_id);
        if (!preview)
            throw this.notFound();
        const before = structuredClone(this.jiraIssue);
        let after;
        let status;
        if (approval.kind === 'remediation') {
            if (this.jiraIssue.version !== 7 || (0, domain_1.sha256)(this.jiraIssue) !== (0, domain_1.sha256)(preview.before)) {
                throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'source_version_changed', 'AST-142 no longer matches the approved before state.');
            }
            after = {
                issueKey: 'AST-142',
                version: 8,
                fields: { duedate: '2026-07-31', labels: ['digital-twin-remediation', 'identity', 'orion'], priority: { id: '2', name: 'High' } },
            };
            status = 'succeeded';
        }
        else {
            const original = approval.original_receipt_id ? this.receipts.get(approval.original_receipt_id) : undefined;
            if (!original || (0, domain_1.sha256)(this.jiraIssue) !== original.after_hash) {
                throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'compensation_conflict', 'Current Jira state changed after execution; rollback will not overwrite it.');
            }
            after = structuredClone(original.before_snapshot);
            after.version = this.jiraIssue.version + 1;
            status = 'compensated';
        }
        this.jiraIssue = structuredClone(after);
        const receiptId = (0, domain_1.newId)();
        const receipt = {
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
            provider_request_id: `jira-sim-${(0, domain_1.newId)()}`,
            before_snapshot: before,
            after_snapshot: after,
            before_hash: (0, domain_1.sha256)(before),
            after_hash: (0, domain_1.sha256)(after),
            execution_started_at: (0, domain_1.nowIso)(),
            recorded_at: (0, domain_1.nowIso)(),
            trace_id: (0, domain_1.traceId)(),
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
    async createCompensationApproval(ctx, receiptId, idempotencyKey) {
        const receipt = this.receipts.get(receiptId);
        if (!receipt || receipt.tenant_id !== ctx.tenantId)
            throw this.notFound();
        if ((0, domain_1.sha256)(this.jiraIssue) !== receipt.after_hash) {
            throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'compensation_conflict', 'Current Jira state differs from the recorded after state.');
        }
        const previewId = (0, domain_1.newId)();
        const createdAt = (0, domain_1.nowIso)();
        const preview = {
            preview_id: previewId,
            tenant_id: ctx.tenantId,
            requester_id: ctx.actor.actor_id,
            status: 'approval_opened',
            before: structuredClone(this.jiraIssue),
            approved_payload: { action: 'jira.issue.update', restoreReceiptId: receiptId, issueKey: 'AST-142', tenantId: ctx.tenantId },
            payload_hash: (0, domain_1.sha256)({ restore: receipt.before_snapshot, expected: receipt.after_hash }),
            preview_hash: '',
            reason: 'Restore the exact recorded pre-remediation AST-142 state.',
            evidence_ids: [(0, domain_1.stableUuid)(`receipt:${receiptId}`)],
            simulation_id: this.approvals.get(receipt.approval_id)?.simulation_id ?? (0, domain_1.stableUuid)('simulation:unknown'),
            created_at: createdAt,
            expires_at: (0, domain_1.addSeconds)(createdAt, 900),
        };
        preview.preview_hash = (0, domain_1.sha256)(preview);
        this.previews.set(previewId, preview);
        const approvalId = (0, domain_1.newId)();
        const approval = {
            approval_id: approvalId,
            tenant_id: ctx.tenantId,
            requester_id: ctx.actor.actor_id,
            preview_id: previewId,
            payload_hash: preview.payload_hash,
            approval_binding_hash: (0, domain_1.sha256)({ preview_hash: preview.preview_hash, idempotency_key: idempotencyKey, policy_version: ctx.policyVersion }),
            idempotency_key: idempotencyKey,
            policy_version: ctx.policyVersion,
            credential_version: 'jira-oauth/1',
            reason: preview.reason,
            evidence_ids: preview.evidence_ids,
            simulation_id: preview.simulation_id,
            before_snapshot_hash: (0, domain_1.sha256)(preview.before),
            created_at: createdAt,
            expires_at: (0, domain_1.addSeconds)(createdAt, 900),
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
    listAudit(ctx, pageSize) {
        const items = (this.audits.get(ctx.tenantId) ?? []).slice(-pageSize).reverse();
        return { items, next_cursor: null, has_more: false, data_watermark: this.watermark() };
    }
    connectors(ctx) {
        const tenant = this.fixtures.seed.tenants.find((item) => item.tenant_id === ctx.tenantId);
        if (!tenant)
            throw this.notFound();
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
    getScenarioEtag(scenarioId) {
        const scenario = this.scenarios.get(scenarioId);
        return scenario ? (0, domain_1.etag)(scenario.scenario_digest) : undefined;
    }
    getPreviewEtag(previewId) {
        const preview = this.previews.get(previewId);
        return preview ? (0, domain_1.etag)(preview.preview_hash) : undefined;
    }
    eventProjectionOverlay(ctx) {
        const permitted = ctx.actor.capabilities.some((capability) => capability.startsWith('evidence.read.'))
            || ctx.actor.capabilities.includes('scenario.create');
        if (!permitted || ctx.actor.actor_alias === 'usr_platform_operator' || ctx.actor.actor_alias === 'usr_aster_limited')
            return undefined;
        return this.eventProjection.readOverlay(ctx.tenantId);
    }
    eventProjectionAssumptions(snapshot) {
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
    factTouchesEntity(mutation, entityId) {
        return [mutation.entity_id, mutation.from_entity_id, mutation.to_entity_id].some((value) => value === entityId);
    }
    entityFromSource(source) {
        return {
            entity_id: (0, domain_1.stableUuid)(`${source.tenant_id}:${source.source_key}`),
            tenant_id: source.tenant_id,
            type: source.provider === 'jira' ? 'edt.work.JiraIssue' : 'edt.engineering.PullRequest',
            ontology_version: 'edt.core/1.0.0',
            lifecycle_state: 'active',
            version: Number.parseInt(source.source_revision, 10) || 1,
            properties: { key: source.source_key, provider: source.provider, ...source.fields },
            classification: source.acl_class.includes('restricted') || source.acl_class.includes('private') ? 'restricted' : 'internal',
        };
    }
    claimFromSource(source) {
        const evidenceId = (0, domain_1.stableUuid)(`evidence:${source.source_object_id}`);
        return {
            claim_id: (0, domain_1.stableUuid)(`claim:${source.source_object_id}`),
            tenant_id: source.tenant_id,
            subject_id: (0, domain_1.stableUuid)(`${source.tenant_id}:${source.source_key}`),
            predicate: 'edt.core/source_summary',
            object: { value: String(source.fields.summary ?? source.fields.title ?? source.source_key) },
            source_revision: source.source_revision,
            confidence: 1,
            evidence_ids: [evidenceId],
            status: 'accepted',
        };
    }
    citationFromSource(source) {
        return {
            citation_id: (0, domain_1.stableUuid)(`citation:${source.source_object_id}`),
            claim_id: (0, domain_1.stableUuid)(`claim:${source.source_object_id}`),
            evidence_id: (0, domain_1.stableUuid)(`evidence:${source.source_object_id}`),
            source_provider: source.provider,
            source_object_id: source.source_object_id,
            source_revision: source.source_revision,
            authorized_locator: `/v1/evidence/${(0, domain_1.stableUuid)(`evidence:${source.source_object_id}`)}`,
            source_updated_at: source.observed_at,
            twin_ingested_at: source.observed_at,
            observed_at: source.observed_at,
            content_hash: (0, domain_1.sha256)(source),
        };
    }
    citedLaunchRiskAnswer(sources) {
        const citations = sources.map((source) => this.citationFromSource(source));
        const citationBySource = new Map(sources.map((source, index) => [source.source_key, citations[index].citation_id]));
        return {
            answer: 'AST-142 is the strongest evidenced launch blocker: it blocks AST-173, which blocks AST-201 and the Orion 2.0 milestone. The linked identity-service pull request is still missing one required security review. OPS-61 and PROD-88 are secondary risks but are not on the current p80 critical path.',
            claims: [
                { claim_id: (0, domain_1.stableUuid)('answer:critical-path'), statement: 'AST-142 blocks AST-173, which blocks AST-201 and Orion 2.0 General Availability.', epistemic_status: 'source_fact', confidence: 1, citation_ids: ['AST-142', 'AST-173', 'AST-201'].map((key) => citationBySource.get(key)) },
                { claim_id: (0, domain_1.stableUuid)('answer:security-review'), statement: 'aster-labs/identity-service#184 implements AST-142 and is missing one required security review.', epistemic_status: 'source_fact', confidence: 1, citation_ids: [citationBySource.get('aster-labs/identity-service#184')] },
            ],
            citations,
            missing_information: ['future security review completion time', 'unrecorded work', 'external validity of synthetic duration distributions'],
            abstained: false,
            abstention_reason: null,
            source_freshness: { github: '2026-07-13T15:47:00Z', jira: '2026-07-13T15:46:30Z' },
            projection_checkpoint: { tenant_id: domain_1.ASTER_TENANT_ID, projection: 'neo4j', outbox_position: 42, ontology_version: 'edt.core/1.0.0', completed_at: '2026-07-13T15:48:00Z' },
            generated_at: (0, domain_1.nowIso)(),
        };
    }
    abstainedAnswer(ctx) {
        return {
            answer: 'I cannot support that conclusion from evidence currently authorized in this tenant context.',
            claims: [],
            citations: [],
            missing_information: ['authorized evidence sufficient to establish the launch dependency chain'],
            abstained: true,
            abstention_reason: 'Evidence is inaccessible or insufficient; no restricted locator or cross-tenant detail is disclosed.',
            source_freshness: {},
            projection_checkpoint: { tenant_id: ctx.tenantId, projection: 'neo4j', outbox_position: 42, ontology_version: 'edt.core/1.0.0', completed_at: '2026-07-13T15:48:00Z' },
            generated_at: (0, domain_1.nowIso)(),
        };
    }
    workforceAbstainedAnswer(ctx) {
        return {
            answer: 'I cannot rank people or infer productivity, burnout, attrition, performance, health, or other employment outcomes from work metadata.',
            claims: [],
            citations: [],
            missing_information: [],
            abstained: true,
            abstention_reason: 'The request asks for a workforce-sensitive inference excluded from the committed system boundary.',
            source_freshness: {},
            projection_checkpoint: { tenant_id: ctx.tenantId, projection: 'neo4j', outbox_position: 42, ontology_version: 'edt.core/1.0.0', completed_at: '2026-07-13T15:48:00Z' },
            generated_at: (0, domain_1.nowIso)(),
        };
    }
    publicRun(run) {
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
    task(id, key, label, team, optimistic, mostLikely, pessimistic) {
        return {
            work_item_id: id,
            source_key: key,
            label,
            state: 'in_progress',
            team_id: (0, domain_1.stableUuid)(`${domain_1.ASTER_TENANT_ID}:${team}`),
            remaining_duration: { optimistic, most_likely: mostLikely, pessimistic, unit: 'workday', source: 'explicit' },
            earliest_start: null,
            actual_finish: null,
            external_blocker: false,
            external_blocker_until: null,
            evidence_ids: [(0, domain_1.stableUuid)(`evidence:aster-jira-${key}`)],
        };
    }
    dependency(predecessor, successor, relationshipId) {
        return { predecessor_work_item_id: predecessor, successor_work_item_id: successor, type: 'finish_to_start', lag_workdays: 0, source_relationship_id: relationshipId, evidence_ids: [(0, domain_1.stableUuid)(`evidence:${relationshipId}`)] };
    }
    publicScenario(scenario) {
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
    async callSimulationWorker(snapshot, scenario) {
        const endpoint = process.env.AI_WORKER_URL ?? 'http://127.0.0.1:8010';
        const internalHeaders = {
            'content-type': 'application/json',
            'x-internal-tenant-id': scenario.tenant_id,
        };
        const sharedSecret = process.env.AI_WORKER_SHARED_SECRET;
        if (sharedSecret)
            internalHeaders['x-internal-service-token'] = sharedSecret;
        const response = await fetch(`${endpoint}/v1/simulations`, {
            method: 'POST',
            headers: internalHeaders,
            body: JSON.stringify({ snapshot, scenario: this.publicScenario(scenario) }),
            signal: AbortSignal.timeout(12_000),
        });
        const responseBody = await response.text();
        if (!response.ok)
            throw new Error(`simulation worker returned ${response.status}: ${responseBody}`);
        return JSON.parse(responseBody);
    }
    oracleSimulationResult(scenario) {
        const baseline = { p50: '2026-08-20', p80: '2026-08-24', p95: '2026-08-27' };
        const forecast = { p50: '2026-08-13', p80: '2026-08-17', p95: '2026-08-20' };
        return {
            engine_version: 'pert-monte-carlo/1.0.0+oracle-fallback',
            uncertainty: { method: 'seeded_pert_monte_carlo', sample_count: 50000, seed: scenario.seed, quantiles: forecast, batch_standard_errors_days: { p50: 0.1, p80: 0.2, p95: 0.4 }, warnings: ['Oracle fallback is permitted only in the explicit synthetic demo profile.'] },
            probability_on_or_before_target: 0.72,
            probability_after_target: 0.28,
            critical_path: [domain_1.AST_142_WORK_ITEM_ID, (0, domain_1.stableUuid)(`${domain_1.ASTER_TENANT_ID}:AST-173`), (0, domain_1.stableUuid)(`${domain_1.ASTER_TENANT_ID}:AST-201`)],
            criticality: [{ work_item_id: domain_1.AST_142_WORK_ITEM_ID, index: 0.93 }],
            blockers: [{ work_item_id: domain_1.AST_142_WORK_ITEM_ID, label: 'Complete SSO cutover', criticality: 0.93, evidence_ids: [(0, domain_1.stableUuid)('evidence:aster-jira-AST-142-v7')] }],
            sensitivity: [{ factor: 'AST-142 duration', method: 'spearman_rank', score: 0.82, absolute_rank: 1, criticality_index: 0.93, unstable: false, evidence_ids: [(0, domain_1.stableUuid)('evidence:aster-jira-AST-142-v7')] }],
            assumptions: [],
            missing_data: ['future security review completion time', 'unrecorded work', 'external validity of synthetic duration distributions'],
            warnings: ['This is a conditional synthetic simulation, not an individual-productivity or causal forecast.'],
            baseline_comparison: { baseline_simulation_id: (0, domain_1.stableUuid)('baseline:aster:orion'), baseline_forecast: baseline, scenario_forecast: forecast, paired_deltas: { uri: '/v1/simulation-artifacts/orion-paired-deltas', sha256: (0, domain_1.sha256)('orion-paired-deltas'), count: 50000, encoding: 'application/json+gzip' }, p50_delta_workdays: -5, p80_delta_workdays: -5, p95_delta_workdays: -6, probability_of_improvement: 0.89, changed_criticality: [{ work_item_id: domain_1.AST_142_WORK_ITEM_ID, baseline_index: 0.97, scenario_index: 0.93, delta: -0.04 }], critical_path_changed: false, negative_delta_means: 'earlier_completion' },
            evidence_ids: this.fixtures.sources.source_objects.filter((source) => source.tenant_id === domain_1.ASTER_TENANT_ID).map((source) => (0, domain_1.stableUuid)(`evidence:${source.source_object_id}`)),
        };
    }
    simulationHashDomain(run) {
        const excluded = new Set(['simulation_id', 'tenant_id', 'status', 'created_at', 'completed_at', 'result_sha256']);
        return Object.fromEntries(Object.entries(run).filter(([key]) => !excluded.has(key)));
    }
    assertExactCommand(command) {
        const expected = {
            action: 'jira.issue.update',
            connectorInstallationId: domain_1.ASTER_JIRA_INSTALLATION_ID,
            expectedIssueVersion: 7,
            issueKey: 'AST-142',
            projectKey: 'AST',
            set: { duedate: '2026-07-31', labels: ['digital-twin-remediation', 'identity', 'orion'], priorityId: '2' },
        };
        if ((0, domain_1.canonicalize)(command) !== (0, domain_1.canonicalize)(expected)) {
            throw new problem_1.ProblemException(common_1.HttpStatus.BAD_REQUEST, 'action_payload_not_allowlisted', 'Only the frozen AST-142 remediation command is allowed in H1.');
        }
    }
    publicPreview(preview) {
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
            etag: (0, domain_1.etag)(preview.preview_hash),
        };
    }
    publicApproval(approval) {
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
    refreshApprovalExpiry(approval) {
        if (approval.status === 'pending' && this.isExpired(approval.expires_at))
            approval.status = 'expired';
    }
    isExpired(expiresAt) {
        const reference = process.env.EDT_FROZEN_CLOCK === 'true' ? new Date((0, domain_1.nowIso)()).getTime() : Date.now();
        return new Date(expiresAt).getTime() <= reference;
    }
    async audit(ctx, action, resourceType, resourceId, outcome) {
        const current = this.audits.get(ctx.tenantId) ?? [];
        const previousHash = current.at(-1)?.event_hash ?? '0'.repeat(64);
        const base = {
            event_id: (0, domain_1.newId)(),
            tenant_id: ctx.tenantId,
            tenant_sequence: current.length + 1,
            occurred_at: (0, domain_1.nowIso)(),
            actor_id: ctx.actor.actor_id,
            action,
            resource_type: resourceType,
            resource_id: resourceId,
            outcome,
            request_id: ctx.requestId,
            trace_id: (0, domain_1.traceId)(),
            reason_codes: [],
            previous_hash: previousHash,
        };
        const record = { ...base, event_hash: (0, domain_1.sha256)(base) };
        current.push(record);
        this.audits.set(ctx.tenantId, current);
        await this.database.put(ctx.tenantId, 'audit_event', record.event_id, record);
    }
    notFound() {
        return new problem_1.ProblemException(common_1.HttpStatus.NOT_FOUND, 'not_found', 'The resource was not found.');
    }
};
exports.DemoStoreService = DemoStoreService;
exports.DemoStoreService = DemoStoreService = DemoStoreService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [fixture_service_1.FixtureService,
        database_service_1.DatabaseService,
        event_projection_service_1.EventProjectionService])
], DemoStoreService);
//# sourceMappingURL=demo-store.service.js.map