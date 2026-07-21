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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimulationEngineService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("./database.service");
const decision_intelligence_types_1 = require("./decision-intelligence.types");
const decision_worker_service_1 = require("./decision-worker.service");
const domain_1 = require("./domain");
const foundation_validation_1 = require("./foundation-validation");
const problem_1 = require("./problem");
const twin_graph_service_1 = require("./twin-graph.service");
const SNAPSHOT_KIND = 'decision_simulation_snapshot';
const BRANCH_KIND = 'decision_scenario_branch';
const RUN_KIND = 'decision_simulation_run';
const DAY_SECONDS = 86_400;
const VARIABLE = /^[a-z][a-z0-9_]{0,63}$/;
const FORBIDDEN_WORKFORCE_VARIABLES = /(?:^|_)(employee|person|performance|productivity|attrition|hiring_score)(?:_|$)/;
let SimulationEngineService = class SimulationEngineService {
    database;
    graph;
    worker;
    constructor(database, graph, worker) {
        this.database = database;
        this.graph = graph;
        this.worker = worker;
    }
    async createSnapshot(ctx, input, idempotencyKey) {
        this.assertScenarioWrite(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['as_of', 'nodes', 'assumptions'], 'Decision snapshot');
        const nodeInputs = this.nodeInputs(input.nodes);
        const assumptions = (0, foundation_validation_1.stringArray)(input.assumptions, 'assumptions', 100, 500);
        const asOf = (0, foundation_validation_1.isoTimestamp)(input.as_of, 'as_of', (0, domain_1.nowIso)());
        if (Date.parse(asOf) > Date.now() + 1_000)
            throw (0, foundation_validation_1.invalid)('snapshot_in_future', 'as_of cannot be in the future.');
        const typeView = await this.graph.listRelationshipTypes(ctx);
        const impactDirections = new Map((typeView.items ?? []).map((item) => [String(item.type_id), String(item.impact_direction)]));
        const selectedIds = new Set(nodeInputs.map((item) => item.node_id));
        const nodes = [];
        const relationships = new Map();
        let graphVersion;
        for (const nodeInput of nodeInputs) {
            const view = await this.graph.getNode(ctx, nodeInput.node_id);
            if (!view.node)
                throw (0, foundation_validation_1.notFound)();
            if (graphVersion !== undefined && view.graph_version !== graphVersion) {
                throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'snapshot_graph_changed', 'The graph changed while the snapshot was being sealed. Retry against one graph version.');
            }
            graphVersion = Number(view.graph_version ?? 0);
            nodes.push({
                node_id: String(view.node.node_id),
                type_id: String(view.node.type_id),
                label: String(view.node.label),
                variables: nodeInput.variables,
            });
            for (const raw of view.relationships ?? []) {
                const source = String(raw.source_node_id);
                const target = String(raw.target_node_id);
                if (!selectedIds.has(source) || !selectedIds.has(target) || raw.state !== 'active')
                    continue;
                const relationshipId = String(raw.relationship_id);
                const direction = impactDirections.get(String(raw.type_id));
                if (!['forward', 'reverse', 'bidirectional', 'none'].includes(String(direction)))
                    continue;
                relationships.set(relationshipId, {
                    relationship_id: relationshipId,
                    source_node_id: source,
                    target_node_id: target,
                    impact_direction: direction,
                    strength: Number(raw.strength),
                    confidence: Number(raw.confidence),
                    importance: Number(raw.importance),
                });
            }
        }
        const snapshotId = this.resourceId(ctx, 'simulation.snapshot.create', idempotencyKey);
        const hashDomain = {
            schema_version: decision_intelligence_types_1.DECISION_INTELLIGENCE_SCHEMA_VERSION,
            snapshot_id: snapshotId,
            tenant_id: ctx.tenantId,
            as_of: asOf,
            graph_version: graphVersion ?? 0,
            nodes: nodes.sort((left, right) => left.node_id.localeCompare(right.node_id)),
            relationships: [...relationships.values()].sort((left, right) => left.relationship_id.localeCompare(right.relationship_id)),
            assumptions,
        };
        const createdAt = (0, domain_1.nowIso)();
        const snapshot = {
            ...hashDomain,
            canonical_sha256: (0, domain_1.sha256)(hashDomain),
            created_at: createdAt,
            created_by: ctx.actor.actor_id,
            state_hash: '',
        };
        snapshot.state_hash = this.stateHash(snapshot);
        const committed = await this.commitCreate(ctx, SNAPSHOT_KIND, snapshotId, snapshot, {
            action: 'decision.simulation_snapshot.create',
            idempotencyKey,
            requestHash: (0, domain_1.sha256)({ action: 'simulation_snapshot.create', input }),
            eventType: 'com.enterprisedigitaltwin.decision.simulation-snapshot-created.v1',
            aggregateType: SNAPSHOT_KIND,
        });
        if (committed.replayed) {
            const existing = await this.snapshot(ctx.tenantId, snapshotId);
            return this.snapshotView(existing, true);
        }
        return this.snapshotView(snapshot);
    }
    async createScenario(ctx, input, idempotencyKey) {
        this.assertScenarioWrite(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['snapshot_id', 'kind', 'name', 'changes', 'assumptions', 'max_depth'], 'Scenario');
        const snapshot = await this.snapshot(ctx.tenantId, (0, foundation_validation_1.uuid)(input.snapshot_id, 'snapshot_id'));
        const scenarioId = this.resourceId(ctx, 'simulation.scenario.create', idempotencyKey);
        const branchId = this.resourceId(ctx, 'simulation.branch.root', idempotencyKey);
        const branch = this.branchDraft(ctx, snapshot, scenarioId, branchId, null, input);
        const committed = await this.commitCreate(ctx, BRANCH_KIND, branchId, branch, {
            action: 'decision.scenario.create', idempotencyKey,
            requestHash: (0, domain_1.sha256)({ action: 'scenario.create', input }),
            eventType: 'com.enterprisedigitaltwin.decision.scenario-created.v1', aggregateType: BRANCH_KIND,
        });
        if (committed.replayed)
            return this.branchView(await this.branch(ctx.tenantId, branchId), true);
        return this.branchView(branch);
    }
    async getSnapshot(ctx, snapshotId) {
        this.assertRead(ctx);
        return this.snapshotView(await this.snapshot(ctx.tenantId, snapshotId));
    }
    async listBranches(ctx, scenarioId) {
        this.assertRead(ctx);
        if (!foundation_validation_1.UUID_PATTERN.test(scenarioId))
            throw (0, foundation_validation_1.notFound)();
        const page = await this.database.listPage(ctx.tenantId, BRANCH_KIND, {
            filters: { scenario_id: scenarioId }, limit: 100,
        });
        if (!page.items.length)
            throw (0, foundation_validation_1.notFound)();
        return { scenario_id: scenarioId, items: page.items, has_more: page.nextCursor !== null, next_cursor: page.nextCursor };
    }
    async createBranch(ctx, scenarioId, input, idempotencyKey) {
        this.assertScenarioWrite(ctx);
        if (!foundation_validation_1.UUID_PATTERN.test(scenarioId))
            throw (0, foundation_validation_1.notFound)();
        (0, foundation_validation_1.assertExactKeys)(input, ['parent_branch_id', 'name', 'kind', 'changes', 'assumptions', 'max_depth'], 'Scenario branch');
        const parent = await this.branch(ctx.tenantId, (0, foundation_validation_1.uuid)(input.parent_branch_id, 'parent_branch_id'));
        if (parent.scenario_id !== scenarioId || parent.status !== 'confirmed')
            throw (0, foundation_validation_1.notFound)();
        const snapshot = await this.snapshot(ctx.tenantId, parent.snapshot_id);
        const branchId = this.resourceId(ctx, 'simulation.branch.create', idempotencyKey);
        const branch = this.branchDraft(ctx, snapshot, scenarioId, branchId, parent.branch_id, {
            name: input.name ?? `${parent.name} branch`,
            kind: input.kind ?? parent.kind,
            changes: input.changes,
            assumptions: input.assumptions ?? parent.assumptions,
            max_depth: input.max_depth ?? parent.max_depth,
        });
        const committed = await this.commitCreate(ctx, BRANCH_KIND, branchId, branch, {
            action: 'decision.scenario_branch.create', idempotencyKey,
            requestHash: (0, domain_1.sha256)({ action: 'scenario_branch.create', scenario_id: scenarioId, input }),
            eventType: 'com.enterprisedigitaltwin.decision.scenario-branch-created.v1', aggregateType: BRANCH_KIND,
        });
        if (committed.replayed)
            return this.branchView(await this.branch(ctx.tenantId, branchId), true);
        return this.branchView(branch);
    }
    async confirmBranch(ctx, scenarioId, branchId, input, idempotencyKey, ifMatch) {
        this.assertScenarioWrite(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['scenario_digest'], 'Scenario confirmation');
        const existing = await this.branch(ctx.tenantId, branchId);
        if (existing.scenario_id !== scenarioId)
            throw (0, foundation_validation_1.notFound)();
        if (existing.status === 'confirmed')
            return this.branchView(existing);
        if (!ifMatch)
            throw new problem_1.ProblemException(common_1.HttpStatus.PRECONDITION_REQUIRED, 'if_match_required', 'If-Match is required.');
        if (ifMatch !== (0, domain_1.etag)(existing.state_hash) || input.scenario_digest !== existing.scenario_digest) {
            throw new problem_1.ProblemException(common_1.HttpStatus.PRECONDITION_FAILED, 'scenario_digest_mismatch', 'The branch changed or the confirmed digest does not match.');
        }
        const updated = {
            ...existing,
            status: 'confirmed',
            version: existing.version + 1,
            confirmed_at: (0, domain_1.nowIso)(),
            confirmed_by: ctx.actor.actor_id,
            state_hash: '',
        };
        updated.state_hash = this.stateHash(updated);
        const committed = await this.commit(ctx, [{ kind: BRANCH_KIND, id: branchId, payload: updated }], {
            action: 'decision.scenario_branch.confirm', idempotencyKey,
            requestHash: (0, domain_1.sha256)({ action: 'scenario_branch.confirm', scenario_id: scenarioId, branch_id: branchId, input }),
            responseRef: branchId, eventType: 'com.enterprisedigitaltwin.decision.scenario-confirmed.v1',
            aggregateType: BRANCH_KIND, aggregateId: branchId, aggregateVersion: updated.version,
            expectedRecords: [{ kind: BRANCH_KIND, id: branchId, expected: { version: existing.version, state_hash: existing.state_hash } }],
        });
        if (committed.replayed)
            return this.branchView(await this.branch(ctx.tenantId, branchId), true);
        return this.branchView(updated);
    }
    async run(ctx, input, idempotencyKey) {
        this.assertSimulationRun(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['branch_id'], 'Simulation run');
        const branch = await this.branch(ctx.tenantId, (0, foundation_validation_1.uuid)(input.branch_id, 'branch_id'));
        if (branch.status !== 'confirmed')
            throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, 'scenario_not_confirmed', 'The scenario branch must be confirmed before execution.');
        const snapshot = await this.snapshot(ctx.tenantId, branch.snapshot_id);
        const simulationId = this.resourceId(ctx, 'simulation.run', idempotencyKey);
        const workerResult = await this.worker.runSimulation(ctx, {
            snapshot: this.workerSnapshot(snapshot),
            scenario: this.workerScenario(branch),
        });
        const resultHash = (0, foundation_validation_1.requiredString)(workerResult.result_sha256, 'result_sha256', 64);
        const run = {
            simulation_id: simulationId,
            tenant_id: ctx.tenantId,
            snapshot_id: snapshot.snapshot_id,
            scenario_id: branch.scenario_id,
            branch_id: branch.branch_id,
            status: 'succeeded',
            engine_version: (0, foundation_validation_1.requiredString)(workerResult.engine_version, 'engine_version', 128),
            result: (0, foundation_validation_1.safeRecord)(workerResult, 'simulation result', 2_000_000),
            result_sha256: resultHash,
            created_at: (0, domain_1.nowIso)(), created_by: ctx.actor.actor_id, state_hash: '',
        };
        run.state_hash = this.stateHash(run);
        const committed = await this.commitCreate(ctx, RUN_KIND, simulationId, run, {
            action: 'decision.simulation.run', idempotencyKey,
            requestHash: (0, domain_1.sha256)({ action: 'simulation.run', branch_id: branch.branch_id, scenario_digest: branch.scenario_digest }),
            eventType: 'com.enterprisedigitaltwin.decision.simulation-completed.v1', aggregateType: RUN_KIND,
        });
        if (committed.replayed)
            return this.runView(await this.simulationRun(ctx.tenantId, simulationId), true);
        return this.runView(run);
    }
    async getRun(ctx, simulationId) {
        this.assertRead(ctx);
        return this.runView(await this.simulationRun(ctx.tenantId, simulationId));
    }
    async compareRuns(ctx, input) {
        this.assertRead(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['simulation_ids'], 'Simulation comparison');
        const ids = (0, foundation_validation_1.stringArray)(input.simulation_ids, 'simulation_ids', 10, 64);
        if (ids.length < 2 || ids.some((id) => !foundation_validation_1.UUID_PATTERN.test(id)))
            throw (0, foundation_validation_1.invalid)('invalid_simulation_comparison', 'simulation_ids must contain two to ten UUIDs.');
        const runs = await Promise.all(ids.map((id) => this.simulationRun(ctx.tenantId, id)));
        return {
            schema_version: decision_intelligence_types_1.DECISION_INTELLIGENCE_SCHEMA_VERSION,
            items: runs.map((run) => ({
                simulation_id: run.simulation_id,
                scenario_id: run.scenario_id,
                branch_id: run.branch_id,
                result_sha256: run.result_sha256,
                comparison: run.result.comparison ?? [],
            })),
            note: 'Each item compares its branch against the same immutable snapshot baseline. Cross-branch deltas can be computed only for matching node and variable keys.',
        };
    }
    branchDraft(ctx, snapshot, scenarioId, branchId, parentBranchId, input) {
        const kind = this.scenarioKind(input.kind);
        const changes = this.changes(input.changes, new Set(snapshot.nodes.map((node) => node.node_id)));
        this.assertScenarioDriver(kind, changes);
        const candidate = {
            scenario_id: scenarioId, branch_id: branchId, parent_branch_id: parentBranchId,
            tenant_id: ctx.tenantId, snapshot_id: snapshot.snapshot_id, snapshot_hash: snapshot.canonical_sha256,
            kind, name: (0, foundation_validation_1.requiredString)(input.name, 'name', 200), changes,
            assumptions: (0, foundation_validation_1.stringArray)(input.assumptions, 'assumptions', 100, 500),
            max_depth: (0, foundation_validation_1.boundedInteger)(input.max_depth, 'max_depth', 1, 6, 4),
            rule_version: 'business-derived-metrics/1.0.0',
            status: 'confirmed',
        };
        const createdAt = (0, domain_1.nowIso)();
        const branch = {
            ...candidate,
            status: 'draft',
            scenario_digest: (0, domain_1.sha256)(candidate),
            version: 1, created_at: createdAt, created_by: ctx.actor.actor_id,
            confirmed_at: null, confirmed_by: null, state_hash: '',
        };
        branch.state_hash = this.stateHash(branch);
        return branch;
    }
    workerSnapshot(snapshot) {
        const { created_at: _createdAt, created_by: _createdBy, state_hash: _stateHash, ...worker } = snapshot;
        return worker;
    }
    workerScenario(branch) {
        return {
            scenario_id: branch.scenario_id, branch_id: branch.branch_id, parent_branch_id: branch.parent_branch_id,
            tenant_id: branch.tenant_id, snapshot_id: branch.snapshot_id, snapshot_hash: branch.snapshot_hash,
            kind: branch.kind, name: branch.name, changes: branch.changes, assumptions: branch.assumptions,
            max_depth: branch.max_depth, rule_version: branch.rule_version, status: 'confirmed', scenario_digest: branch.scenario_digest,
        };
    }
    nodeInputs(value) {
        if (!Array.isArray(value) || value.length < 1 || value.length > 100)
            throw (0, foundation_validation_1.invalid)('invalid_snapshot_nodes', 'nodes must contain one to 100 node variable sets.');
        const seen = new Set();
        return value.map((raw, index) => {
            const item = (0, foundation_validation_1.plainRecord)(raw, `nodes[${index}]`);
            (0, foundation_validation_1.assertExactKeys)(item, ['node_id', 'variables'], `nodes[${index}]`);
            const nodeId = (0, foundation_validation_1.uuid)(item.node_id, `nodes[${index}].node_id`);
            if (seen.has(nodeId))
                throw (0, foundation_validation_1.invalid)('duplicate_snapshot_node', 'Snapshot nodes must be unique.');
            seen.add(nodeId);
            return { node_id: nodeId, variables: this.variables(item.variables, `nodes[${index}].variables`) };
        });
    }
    variables(value, field) {
        const record = (0, foundation_validation_1.safeRecord)(value, field, 32_000);
        if (Object.keys(record).length > 50)
            throw (0, foundation_validation_1.invalid)('too_many_variables', `${field} may contain at most 50 variables.`);
        const result = {};
        for (const [name, raw] of Object.entries(record)) {
            const number = typeof raw === 'number' ? raw : Number.NaN;
            if (!VARIABLE.test(name) || FORBIDDEN_WORKFORCE_VARIABLES.test(name) || !Number.isFinite(number) || Math.abs(number) > 1e12) {
                throw (0, foundation_validation_1.invalid)('invalid_simulation_variable', `${field}.${name} is not an allowed bounded aggregate numeric variable.`);
            }
            result[name] = number;
        }
        return result;
    }
    changes(value, nodeIds) {
        if (!Array.isArray(value) || value.length < 1 || value.length > 100)
            throw (0, foundation_validation_1.invalid)('invalid_scenario_changes', 'changes must contain one to 100 typed changes.');
        return value.map((raw, index) => {
            const item = (0, foundation_validation_1.plainRecord)(raw, `changes[${index}]`);
            (0, foundation_validation_1.assertExactKeys)(item, ['node_id', 'variable', 'operation', 'value'], `changes[${index}]`);
            const nodeId = (0, foundation_validation_1.uuid)(item.node_id, `changes[${index}].node_id`);
            const variable = (0, foundation_validation_1.requiredString)(item.variable, `changes[${index}].variable`, 64);
            const operation = item.operation;
            const number = typeof item.value === 'number' ? item.value : Number.NaN;
            if (!nodeIds.has(nodeId))
                throw (0, foundation_validation_1.invalid)('scenario_node_outside_snapshot', 'Every scenario change must target a node in the snapshot.');
            if (!VARIABLE.test(variable) || FORBIDDEN_WORKFORCE_VARIABLES.test(variable))
                throw (0, foundation_validation_1.invalid)('invalid_simulation_variable', 'Scenario variables must be aggregate bounded identifiers.');
            if (!['set', 'add', 'multiply'].includes(String(operation)))
                throw (0, foundation_validation_1.invalid)('invalid_change_operation', 'operation must be set, add, or multiply.');
            if (!Number.isFinite(number) || Math.abs(number) > 1e12)
                throw (0, foundation_validation_1.invalid)('invalid_change_value', 'Scenario change values must be finite and bounded.');
            return { node_id: nodeId, variable, operation: operation, value: number };
        });
    }
    assertScenarioDriver(kind, changes) {
        const required = {
            hiring: ['headcount'], pricing_change: ['price'], supplier_failure: ['supplier_availability'],
            expansion: ['capacity', 'locations'], budget_change: ['budget'],
        };
        if (!changes.some((change) => required[kind].includes(change.variable))) {
            throw (0, foundation_validation_1.invalid)('scenario_driver_required', `${kind} requires a change to ${required[kind].join(' or ')}.`);
        }
    }
    scenarioKind(value) {
        if (typeof value !== 'string' || !decision_intelligence_types_1.SCENARIO_KINDS.includes(value))
            throw (0, foundation_validation_1.invalid)('invalid_scenario_kind', `kind must be one of ${decision_intelligence_types_1.SCENARIO_KINDS.join(', ')}.`);
        return value;
    }
    async snapshot(tenantId, id) {
        if (!foundation_validation_1.UUID_PATTERN.test(id))
            throw (0, foundation_validation_1.notFound)();
        const value = await this.database.get(tenantId, SNAPSHOT_KIND, id);
        if (!value || value.tenant_id !== tenantId)
            throw (0, foundation_validation_1.notFound)();
        return value;
    }
    async branch(tenantId, id) {
        if (!foundation_validation_1.UUID_PATTERN.test(id))
            throw (0, foundation_validation_1.notFound)();
        const value = await this.database.get(tenantId, BRANCH_KIND, id);
        if (!value || value.tenant_id !== tenantId)
            throw (0, foundation_validation_1.notFound)();
        return value;
    }
    async simulationRun(tenantId, id) {
        if (!foundation_validation_1.UUID_PATTERN.test(id))
            throw (0, foundation_validation_1.notFound)();
        const value = await this.database.get(tenantId, RUN_KIND, id);
        if (!value || value.tenant_id !== tenantId)
            throw (0, foundation_validation_1.notFound)();
        return value;
    }
    snapshotView(snapshot, replayed = false) {
        return { snapshot, etag: (0, domain_1.etag)(snapshot.state_hash), ...(replayed ? { replayed: true } : {}) };
    }
    branchView(branch, replayed = false) {
        return { branch, etag: (0, domain_1.etag)(branch.state_hash), ...(replayed ? { replayed: true } : {}) };
    }
    runView(run, replayed = false) {
        return { run, ...(replayed ? { replayed: true } : {}) };
    }
    assertRead(ctx) {
        if (ctx.actor.capabilities.includes('connector.admin') || ctx.actor.capabilities.includes('simulation.run') || ctx.actor.capabilities.includes('scenario.create'))
            return;
        throw new problem_1.ProblemException(common_1.HttpStatus.FORBIDDEN, 'decision_intelligence_read_denied', 'Decision intelligence access is not permitted.');
    }
    assertScenarioWrite(ctx) {
        if (!ctx.actor.capabilities.includes('scenario.create') && !ctx.actor.capabilities.includes('connector.admin')) {
            throw new problem_1.ProblemException(common_1.HttpStatus.FORBIDDEN, 'scenario_create_denied', 'Scenario creation is not permitted.');
        }
    }
    assertSimulationRun(ctx) {
        if (!ctx.actor.capabilities.includes('simulation.run') && !ctx.actor.capabilities.includes('connector.admin')) {
            throw new problem_1.ProblemException(common_1.HttpStatus.FORBIDDEN, 'simulation_run_denied', 'Simulation execution is not permitted.');
        }
    }
    resourceId(ctx, operation, key) {
        return (0, domain_1.stableUuid)(`${decision_intelligence_types_1.DECISION_INTELLIGENCE_SCHEMA_VERSION}:${ctx.tenantId}:${ctx.actor.actor_id}:${operation}:${key}`);
    }
    stateHash(value) {
        const { state_hash: _stateHash, ...domain } = value;
        return (0, domain_1.sha256)(domain);
    }
    commitCreate(ctx, kind, id, payload, mutation) {
        return this.commit(ctx, [{ kind, id, payload }], {
            ...mutation, responseRef: id, aggregateId: id, aggregateVersion: 1,
            expectedRecords: [{ kind, id, absent: true }],
        });
    }
    async commit(ctx, records, mutation) {
        const audit = {
            audit_id: (0, domain_1.newId)(), tenant_sequence: 0, action: mutation.action, actor_id: ctx.actor.actor_id,
            resource_type: mutation.aggregateType, resource_id: mutation.aggregateId, occurred_at: (0, domain_1.nowIso)(),
            request_id: ctx.requestId, trace_id: (0, domain_1.traceId)(), details_hash: (0, domain_1.sha256)({ action: mutation.action, aggregate_id: mutation.aggregateId }),
            previous_hash: '', event_hash: '',
        };
        try {
            const result = await this.database.commitEventMutation(ctx.tenantId, records, audit, {
                eventId: (0, domain_1.stableUuid)(`${ctx.tenantId}:${mutation.action}:${mutation.idempotencyKey}:outbox`),
                eventType: mutation.eventType, aggregateType: mutation.aggregateType, aggregateId: mutation.aggregateId,
                aggregateVersion: mutation.aggregateVersion,
                payload: { tenant_id: ctx.tenantId, history_event_id: mutation.responseRef, resource_id: mutation.aggregateId, outbox_position: 0 },
            }, {
                idempotency: {
                    operation: `${ctx.actor.actor_id}:${mutation.action}`, key: mutation.idempotencyKey,
                    requestHash: mutation.requestHash, responseRef: mutation.responseRef,
                    expiresAt: new Date(Date.now() + 7 * 365 * DAY_SECONDS * 1_000).toISOString(),
                },
                expectedRecords: mutation.expectedRecords,
            });
            return { replayed: result.replayed === true };
        }
        catch (error) {
            if (error instanceof database_service_1.DatabaseMutationConflict)
                throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, error.code, error.message, error.code === 'idempotency_request_in_progress');
            throw error;
        }
    }
};
exports.SimulationEngineService = SimulationEngineService;
exports.SimulationEngineService = SimulationEngineService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        twin_graph_service_1.TwinGraphService,
        decision_worker_service_1.DecisionWorkerService])
], SimulationEngineService);
//# sourceMappingURL=simulation-engine.service.js.map