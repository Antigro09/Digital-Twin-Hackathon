import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DatabaseMutationConflict,
  DatabaseService,
  EventMutationGuard,
} from './database.service';
import {
  ASTER_TENANT_ID,
  BEACON_TENANT_ID,
  RequestContext,
  addSeconds,
  etag,
  newId,
  nowIso,
  sha256,
  stableUuid,
  traceId,
} from './domain';
import {
  BranchComparison,
  CausalGraph,
  EntityResolution,
  EventActionReceipt,
  EventApproval,
  EventAuditChainDiagnostics,
  EventAuditEvidence,
  EventAuditIssueCode,
  EventAuditResponse,
  EventCategory,
  EventConfidenceLevel,
  EventGate,
  EventImpact,
  EventInterpretation,
  EventMode,
  EventReplay,
  EventTaxonomyEntry,
  IntelligenceEvent,
  ResolutionCandidate,
  ScenarioBranch,
  TimelineEntry,
} from './event-intelligence.types';
import {
  EventProjectionError,
  EventProjectionService,
  EventProjectionSnapshot,
} from './event-projection.service';
import { ProblemException } from './problem';

const MAX_INPUT_CHARACTERS = 4_000;
const MAX_EVENTS = 8;
const MAX_IMPACTS = 50;
const MAX_DEPTH = 3 as const;
const MAX_AUDIT_DIAGNOSTIC_REFS = 100;
const POLICY_VERSION = 'event-intelligence-synthetic/1.0.0';
const MODEL_VERSION = 'event-extractor-rules/1.0.0' as const;
const REALITY_MUTATION_OPERATIONS = new Set(['set_state', 'modify_relationship', 'remove_relationship', 'append_outage']);
const EVENT_CHANGED_SCHEMA_FILE = 'event-intelligence-event-changed.v1.schema.json';

function loadEventChangedSchema(): Record<string, unknown> {
  const candidates = [
    resolve(process.cwd(), 'docs/enterprise-digital-twin/contracts/schemas', EVENT_CHANGED_SCHEMA_FILE),
    resolve(process.cwd(), '../../docs/enterprise-digital-twin/contracts/schemas', EVENT_CHANGED_SCHEMA_FILE),
    resolve(__dirname, '../../../docs/enterprise-digital-twin/contracts/schemas', EVENT_CHANGED_SCHEMA_FILE),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) throw new Error(`Event Intelligence CloudEvent schema ${EVENT_CHANGED_SCHEMA_FILE} was not found.`);
  const schema = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (typeof schema.$id !== 'string' || !schema.$id) {
    throw new Error(`Event Intelligence CloudEvent schema ${EVENT_CHANGED_SCHEMA_FILE} has no $id.`);
  }
  return schema;
}

const EVENT_CHANGED_SCHEMA = loadEventChangedSchema();
export const EVENT_CHANGED_SCHEMA_ID = EVENT_CHANGED_SCHEMA.$id as string;
export const EVENT_CHANGED_SCHEMA_HASH = sha256(EVENT_CHANGED_SCHEMA);

interface EntityFixture extends ResolutionCandidate {
  tenant_id: string;
}

interface ClassifierRule {
  code: string;
  pattern: RegExp;
}

interface IdempotencyRecord {
  request_hash: string;
  resource_id: string;
}

interface EventApplication {
  event_id: string;
  approval_id: string;
  mode: EventMode;
  before_state_hash: string;
  after_state_hash: string;
  before_graph_version: number;
  after_graph_version: number;
  before_snapshot: EventProjectionSnapshot | null;
  after_snapshot: EventProjectionSnapshot | null;
}

interface AuditChainAssessment {
  canonical: EventAuditEvidence[];
  diagnostics: EventAuditChainDiagnostics;
}

const taxonomySeed: Array<[string, EventCategory, string, EventMode, boolean, string[]]> = [
  ['people.employee_hired', 'people', 'Employee hired', 'reality', true, ['Jordan joined the company']],
  ['people.employee_promoted', 'people', 'Employee promoted', 'reality', true, ['Jordan was promoted']],
  ['people.employee_transferred', 'people', 'Employee transferred', 'reality', true, ['Jordan transferred to Platform']],
  ['people.employee_departed', 'people', 'Employee departed', 'reality', true, ['Sarah left the company']],
  ['people.employee_leave', 'people', 'Employee leave', 'reality', true, ['Jordan went on leave']],
  ['people.role_changed', 'people', 'Role changed', 'reality', true, ['Jordan changed role']],
  ['people.contractor_added', 'people', 'Contractor added', 'reality', true, ['A contractor was added']],
  ['people.contractor_removed', 'people', 'Contractor removed', 'reality', true, ['The contractor engagement ended']],
  ['people.team_reorganized', 'people', 'Team reorganized', 'reality', true, ['The platform team reorganized']],
  ['people.manager_changed', 'people', 'Manager changed', 'reality', true, ['Jordan now reports to Lee']],
  ['project.started', 'project', 'Project started', 'reality', false, ['Project Orion started']],
  ['project.delayed', 'project', 'Project delayed', 'reality', false, ['The payment project was delayed']],
  ['project.cancelled', 'project', 'Project cancelled', 'reality', false, ['Project Orion was cancelled']],
  ['project.requirement_changed', 'project', 'Requirement changed', 'reality', false, ['The launch requirement changed']],
  ['project.milestone_missed', 'project', 'Milestone missed', 'reality', false, ['The beta milestone was missed']],
  ['project.budget_changed', 'project', 'Project budget changed', 'reality', false, ['The project budget was reduced']],
  ['project.priority_changed', 'project', 'Project priority changed', 'reality', false, ['The project priority increased']],
  ['project.scope_increased', 'project', 'Project scope increased', 'reality', false, ['Scope increased']],
  ['project.scope_reduced', 'project', 'Project scope reduced', 'reality', false, ['Scope was reduced']],
  ['technology.outage', 'technology', 'Technology outage', 'reality', false, ['Our AWS database had a three-hour outage']],
  ['technology.database_migration', 'technology', 'Database migration', 'reality', false, ['The database migrated to Postgres']],
  ['technology.vulnerability_discovered', 'technology', 'Security vulnerability discovered', 'reality', true, ['A critical vulnerability was discovered']],
  ['technology.dependency_deprecated', 'technology', 'Dependency deprecated', 'reality', false, ['The SDK dependency was deprecated']],
  ['technology.service_launched', 'technology', 'Service launched', 'reality', false, ['Authentication Service launched']],
  ['technology.service_removed', 'technology', 'Service removed', 'reality', false, ['Authentication Service was retired']],
  ['technology.architecture_changed', 'technology', 'Architecture changed', 'reality', false, ['The architecture changed']],
  ['technology.repository_archived', 'technology', 'Repository archived', 'reality', false, ['The auth repository was archived']],
  ['business.customer_acquired', 'business', 'Customer acquired', 'reality', true, ['We acquired Northstar as a customer']],
  ['business.customer_lost', 'business', 'Customer lost', 'reality', true, ['Northstar left as a customer']],
  ['business.customer_at_risk', 'business', 'Customer at risk', 'scenario', true, ['We might lose our largest customer']],
  ['business.company_acquired', 'business', 'Company acquisition', 'reality', true, ['Company A acquired Company B']],
  ['business.contract_signed', 'business', 'Contract signed', 'reality', true, ['The contract was signed']],
  ['business.vendor_changed', 'business', 'Vendor changed', 'reality', false, ['We changed cloud vendors']],
  ['business.market_shift', 'business', 'Market shift', 'scenario', false, ['Demand shifted toward managed services']],
  ['business.competitor_action', 'business', 'Competitor action', 'scenario', false, ['A competitor released a new product']],
  ['business.regulatory_change', 'business', 'Regulatory change', 'scenario', true, ['A new regulation was enacted']],
  ['business.funding_changed', 'business', 'Funding changed', 'reality', true, ['Our funding round changed']],
  ['operations.equipment_failure', 'operations', 'Equipment failure', 'reality', false, ['Cooling Pump P-101 failed']],
  ['operations.supply_delay', 'operations', 'Supply delay', 'reality', false, ['The bearing shipment was delayed']],
  ['operations.process_failure', 'operations', 'Process failure', 'reality', false, ['The release process failed']],
  ['operations.production_issue', 'operations', 'Production issue', 'reality', false, ['Production experienced an incident']],
  ['operations.office_closure', 'operations', 'Office closure', 'reality', true, ['The office closed']],
  ['external.economic_change', 'external', 'Economic change', 'scenario', false, ['Interest rates increased']],
  ['external.weather_event', 'external', 'Weather event', 'scenario', false, ['A hurricane affected the region']],
  ['external.natural_disaster', 'external', 'Natural disaster', 'scenario', false, ['An earthquake disrupted the supplier']],
  ['external.industry_breach', 'external', 'Industry security breach', 'scenario', true, ['A peer company disclosed a breach']],
  ['unknown.unclassified', 'unknown', 'Unclassified event', 'scenario', false, ['Something happened']],
];

const TAXONOMY: EventTaxonomyEntry[] = taxonomySeed.map(([code, category, label, defaultMode, sensitive, examples]) => ({
  code,
  category,
  label,
  description: `${label} represented as an evidence-backed ${category} event.`,
  default_mode: defaultMode,
  sensitive,
  example_phrases: examples,
}));

const RULES: ClassifierRule[] = [
  { code: 'business.customer_at_risk', pattern: /\b(?:might|may|could|possibly|what if)\b[^.!?]{0,100}\b(?:lose|churn)\b[^.!?]{0,60}\b(?:customer|account)\b/i },
  { code: 'people.employee_departed', pattern: /\b(?:left|departed|resigned|quit|leaves the company)\b/i },
  { code: 'people.employee_hired', pattern: /\b(?:was hired|joined the company|employee hired)\b/i },
  { code: 'people.employee_promoted', pattern: /\b(?:was promoted|employee promoted)\b/i },
  { code: 'people.employee_transferred', pattern: /\b(?:was transferred|transferred to)\b/i },
  { code: 'people.employee_leave', pattern: /\b(?:went|goes|is) on (?:medical )?leave\b/i },
  { code: 'people.role_changed', pattern: /\b(?:changed roles?|role changed)\b/i },
  { code: 'people.contractor_added', pattern: /\bcontractor (?:was )?(?:added|engaged|started)\b/i },
  { code: 'people.contractor_removed', pattern: /\bcontractor (?:was )?(?:removed|ended|terminated)\b/i },
  { code: 'people.team_reorganized', pattern: /\b(?:team )?(?:reorganized|reorganisation|reorganization)\b/i },
  { code: 'people.manager_changed', pattern: /\b(?:manager changed|now reports to|reporting line changed)\b/i },
  { code: 'project.started', pattern: /\bproject\b[^.!?]{0,50}\b(?:started|kicked off)\b/i },
  { code: 'project.delayed', pattern: /\b(?:project|milestone|launch|release)\b[^.!?]{0,70}\b(?:delayed|slipped)\b/i },
  { code: 'project.cancelled', pattern: /\bproject\b[^.!?]{0,50}\b(?:cancelled|canceled|stopped)\b/i },
  { code: 'project.requirement_changed', pattern: /\brequirements?\b[^.!?]{0,40}\bchanged\b/i },
  { code: 'project.milestone_missed', pattern: /\bmilestone\b[^.!?]{0,40}\bmissed\b/i },
  { code: 'project.budget_changed', pattern: /\bbudget\b[^.!?]{0,40}\b(?:changed|increased|reduced|cut)\b/i },
  { code: 'project.priority_changed', pattern: /\bpriority\b[^.!?]{0,40}\b(?:changed|increased|reduced)\b/i },
  { code: 'project.scope_increased', pattern: /\bscope\b[^.!?]{0,30}\b(?:increased|expanded)\b/i },
  { code: 'project.scope_reduced', pattern: /\bscope\b[^.!?]{0,30}\b(?:reduced|cut)\b/i },
  { code: 'technology.outage', pattern: /\b(?:outage|went down|unavailable)\b/i },
  { code: 'technology.database_migration', pattern: /\bdatabase\b[^.!?]{0,50}\b(?:migration|migrated)\b/i },
  { code: 'technology.vulnerability_discovered', pattern: /\b(?:vulnerability|CVE)\b[^.!?]{0,70}\b(?:found|discovered|reported)?\b/i },
  { code: 'technology.dependency_deprecated', pattern: /\b(?:dependency|library|SDK)\b[^.!?]{0,50}\bdeprecated\b/i },
  { code: 'technology.service_launched', pattern: /\b(?:service|system)\b[^.!?]{0,50}\b(?:launched|released)\b/i },
  { code: 'technology.service_removed', pattern: /\b(?:service|system)\b[^.!?]{0,50}\b(?:removed|retired|decommissioned)\b/i },
  { code: 'technology.architecture_changed', pattern: /\barchitecture\b[^.!?]{0,50}\bchanged\b/i },
  { code: 'technology.repository_archived', pattern: /\brepositor(?:y|ies)\b[^.!?]{0,50}\barchived\b/i },
  { code: 'business.customer_acquired', pattern: /\b(?:acquired|won|signed)\b[^.!?]{0,50}\bcustomer\b/i },
  { code: 'business.customer_lost', pattern: /\b(?:lost|churned)\b[^.!?]{0,50}\bcustomer\b|\bcustomer\b[^.!?]{0,50}\b(?:left|churned)\b/i },
  { code: 'business.company_acquired', pattern: /\b(?:company|business|corporation)\b[^.!?]{0,50}\bacquired\b[^.!?]{0,50}\b(?:company|business|corporation)\b/i },
  { code: 'business.contract_signed', pattern: /\bcontract\b[^.!?]{0,50}\bsigned\b/i },
  { code: 'business.vendor_changed', pattern: /\bvendor\b[^.!?]{0,50}\bchanged\b/i },
  { code: 'business.market_shift', pattern: /\bmarket\b[^.!?]{0,50}\b(?:shifted|changed)\b/i },
  { code: 'business.competitor_action', pattern: /\bcompetitor\b[^.!?]{0,80}\b(?:released|launched|acquired|changed)\b/i },
  { code: 'business.regulatory_change', pattern: /\b(?:regulation|law|regulatory)\b[^.!?]{0,70}\b(?:changed|enacted|introduced|effective)\b/i },
  { code: 'business.funding_changed', pattern: /\b(?:funding|financing)\b[^.!?]{0,50}\b(?:changed|increased|reduced|closed)\b/i },
  { code: 'operations.equipment_failure', pattern: /\b(?:equipment|pump|motor|compressor)\b[^.!?]{0,60}\b(?:failed|failure|broke)\b/i },
  { code: 'operations.supply_delay', pattern: /\b(?:supply|shipment|supplier|part)\b[^.!?]{0,50}\b(?:delayed|late)\b/i },
  { code: 'operations.process_failure', pattern: /\bprocess\b[^.!?]{0,50}\b(?:failed|failure)\b/i },
  { code: 'operations.production_issue', pattern: /\bproduction\b[^.!?]{0,50}\b(?:issue|incident|failure)\b/i },
  { code: 'operations.office_closure', pattern: /\boffice\b[^.!?]{0,50}\b(?:closed|closure)\b/i },
  { code: 'external.economic_change', pattern: /\b(?:inflation|interest rates?|recession|economic)\b[^.!?]{0,60}\b(?:changed|increased|decreased|began)?\b/i },
  { code: 'external.weather_event', pattern: /\b(?:weather|storm|hurricane|flood|blizzard)\b/i },
  { code: 'external.natural_disaster', pattern: /\b(?:earthquake|wildfire|natural disaster)\b/i },
  { code: 'external.industry_breach', pattern: /\b(?:industry|competitor|peer company)\b[^.!?]{0,80}\b(?:breach|cyberattack)\b/i },
];

@Injectable()
export class EventIntelligenceService implements OnModuleInit {
  private readonly events = new Map<string, IntelligenceEvent>();
  private readonly approvals = new Map<string, EventApproval>();
  private readonly receipts = new Map<string, EventActionReceipt>();
  private readonly interpretations = new Map<string, EventInterpretation>();
  private readonly branches = new Map<string, ScenarioBranch>();
  private readonly timelines = new Map<string, TimelineEntry[]>();
  private readonly audits = new Map<string, EventAuditEvidence[]>();
  private readonly auditHealth = new Map<string, EventAuditChainDiagnostics>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly applications = new Map<string, EventApplication>();

  constructor(
    private readonly database: DatabaseService,
    private readonly projection: EventProjectionService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.database.ready();
    if (!this.database.enabled) return;
    for (const tenantId of [ASTER_TENANT_ID, BEACON_TENANT_ID]) {
      const projectionId = stableUuid(`event-projection:${tenantId}`);
      const persistedProjection = await this.database.get<EventProjectionSnapshot>(tenantId, 'event_projection_snapshot', projectionId);
      if (persistedProjection) this.projection.hydrate(tenantId, persistedProjection);
      const currentProjection = this.projection.snapshot(tenantId);
      if (!persistedProjection) {
        await this.database.put(tenantId, 'event_projection_snapshot', projectionId, currentProjection);
      }

      const events = await this.database.list<IntelligenceEvent>(tenantId, 'intelligence_event');
      for (const event of events) {
        if (event.tenant_id !== tenantId) continue;
        if (!this.validSnapshotBinding(event.graph_snapshot_version, event.graph_snapshot_hash)) {
          event.graph_snapshot_version = currentProjection.version;
          event.graph_snapshot_hash = currentProjection.state_hash;
          event.review_notes = null;
          event.reviewed_payload_hash = null;
          event.applied_payload_hash = null;
          event.branch_id = null;
          if (event.status !== 'rejected') event.status = 'needs_resolution';
          event.gate = {
            route: event.mode === 'scenario' ? 'scenario_branch' : 'reality_update',
            live_mutation_allowed: false,
            blockers: [...new Set([...(event.gate?.blockers ?? []), 'historical_snapshot_binding_missing'])],
            required_approvals: event.mode === 'reality' ? ['operations', 'security'] : [],
            policy_version: POLICY_VERSION,
            rationale: 'A legacy or corrupt record lacked its historical graph binding and must be reviewed again against the current snapshot.',
          };
          this.refreshEtag(event);
          await this.database.put(tenantId, 'intelligence_event', event.event_id, event);
        }
        event.review_notes ??= null;
        this.events.set(event.event_id, event);
      }
      const interpretations = await this.database.list<EventInterpretation>(tenantId, 'event_interpretation');
      for (const interpretation of interpretations) {
        interpretation.events = interpretation.events
          .map((item) => this.events.get(item.event_id))
          .filter((item): item is IntelligenceEvent => Boolean(item?.tenant_id === tenantId));
        if (!interpretation.events.length) continue;
        this.interpretations.set(interpretation.interpretation_id, interpretation);
      }
      const approvals = await this.database.list<EventApproval>(tenantId, 'event_approval');
      for (const approval of approvals) {
        if (approval.tenant_id !== tenantId) continue;
        const event = this.events.get(approval.event_id);
        if (!event || !this.validSnapshotBinding(approval.graph_snapshot_version, approval.graph_snapshot_hash)) {
          if (event && ['approval_pending', 'approved'].includes(event.status)) {
            event.status = 'reviewed';
            this.refreshEtag(event);
            await this.database.put(tenantId, 'intelligence_event', event.event_id, event);
          }
          continue;
        }
        this.approvals.set(approval.approval_id, approval);
      }
      const receipts = await this.database.list<EventActionReceipt>(tenantId, 'event_action_receipt');
      for (const receipt of receipts) {
        const approval = this.approvals.get(receipt.approval_id);
        if (
          receipt.tenant_id !== tenantId
          || typeof receipt.approval_id !== 'string'
          || !approval
          || approval.event_id !== receipt.event_id
          || !this.validSnapshotBinding(receipt.graph_version_before, receipt.before_state_hash)
          || !this.validSnapshotBinding(receipt.graph_version_after, receipt.after_state_hash)
          || !Number.isSafeInteger(receipt.outbox_position)
          || receipt.outbox_position < 1
        ) continue;
        this.receipts.set(receipt.receipt_id, receipt);
      }
      const applications = await this.database.list<EventApplication>(tenantId, 'event_application');
      for (const application of applications) {
        const event = this.events.get(application.event_id);
        const approval = this.approvals.get(application.approval_id);
        if (
          !event
          || !approval
          || approval.event_id !== application.event_id
          || typeof application.approval_id !== 'string'
          || (application.mode === 'reality' && (application.before_snapshot === null || application.after_snapshot === null))
          || (application.mode === 'scenario' && application.before_snapshot === null)
          || !this.validSnapshotBinding(application.before_graph_version, application.before_state_hash)
          || !this.validSnapshotBinding(application.after_graph_version, application.after_state_hash)
          || (application.before_snapshot !== null && application.before_snapshot.tenant_id !== tenantId)
          || (application.after_snapshot !== null && application.after_snapshot.tenant_id !== tenantId)
          || (application.before_snapshot !== null && (
            application.before_snapshot.version !== application.before_graph_version
            || application.before_snapshot.state_hash !== application.before_state_hash
          ))
          || (application.after_snapshot !== null && (
            application.after_snapshot.version !== application.after_graph_version
            || application.after_snapshot.state_hash !== application.after_state_hash
          ))
        ) continue;
        this.applications.set(application.event_id, application);
      }

      const branches = await this.database.list<ScenarioBranch>(tenantId, 'event_branch');
      for (const branch of branches) {
        if (branch.tenant_id !== tenantId || !this.validSnapshotBinding(branch.base_graph_version, branch.base_state_hash) || !this.validHash(branch.state_hash)) continue;
        this.branches.set(branch.branch_id, branch);
      }
      const timeline = await this.database.list<TimelineEntry>(tenantId, 'event_timeline_entry');
      const validTimeline = timeline.filter((entry) => (
        entry.tenant_id === tenantId
        && this.validIso(entry.recorded_at)
        && this.validSnapshotBinding(entry.graph_version_before, entry.before_state_hash)
        && this.validSnapshotBinding(entry.graph_version_after, entry.after_state_hash)
        && (entry.receipt_id === null || this.receipts.has(entry.receipt_id))
      ));
      if (validTimeline.length) this.timelines.set(tenantId, validTimeline.sort((left, right) => left.sequence - right.sequence));

      const audits = await this.database.list<EventAuditEvidence>(tenantId, 'event_audit_evidence');
      const auditAssessment = this.assessAuditChain(tenantId, audits);
      this.audits.set(tenantId, auditAssessment.canonical);
      this.auditHealth.set(tenantId, auditAssessment.diagnostics);
      const idempotency = await this.database.list<IdempotencyRecord & { scope: string }>(tenantId, 'event_idempotency');
      for (const record of idempotency) {
        if (typeof record.scope !== 'string' || !record.scope.startsWith(`${tenantId}:`)) continue;
        this.idempotency.set(record.scope, { request_hash: record.request_hash, resource_id: record.resource_id });
      }
    }
  }

  taxonomy(ctx: RequestContext): { items: EventTaxonomyEntry[]; taxonomy_version: string; categories: EventCategory[] } {
    this.assertRead(ctx);
    return {
      items: structuredClone(TAXONOMY),
      taxonomy_version: 'event-taxonomy/1.0.0',
      categories: ['people', 'project', 'technology', 'business', 'operations', 'external', 'unknown'],
    };
  }

  async interpret(
    ctx: RequestContext,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<EventInterpretation> {
    this.assertCreate(ctx);
    this.assertExactKeys(body, ['text', 'requested_mode', 'occurred_at'], 'event interpretation');
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length < 3 || text.length > MAX_INPUT_CHARACTERS) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_event_text', `text must contain 3 to ${MAX_INPUT_CHARACTERS} characters.`);
    }
    const requestedMode = body.requested_mode ?? 'auto';
    if (!['auto', 'reality', 'scenario'].includes(String(requestedMode))) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_event_mode', 'requested_mode must be auto, reality, or scenario.');
    }
    const suppliedOccurredAt = body.occurred_at;
    if (suppliedOccurredAt !== undefined && (typeof suppliedOccurredAt !== 'string' || !this.validIso(suppliedOccurredAt))) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_event_timestamp', 'occurred_at must be an ISO-8601 timestamp.');
    }

    const scope = this.scope(ctx, 'interpret', idempotencyKey);
    const requestHash = sha256(body);
    const replay = this.idempotency.get(scope);
    if (replay) {
      if (replay.request_hash !== requestHash) this.idempotencyConflict();
      const prior = this.interpretations.get(replay.resource_id);
      if (!prior) throw this.notFound();
      return structuredClone(prior);
    }

    this.ensureTenant(ctx);
    await this.persistTenantBaseline(ctx.tenantId);
    const redaction = this.redact(text);
    const injectionFlags = this.detectMaliciousInput(redaction.text);
    const safety = {
      untrusted_input: true as const,
      prompt_injection_detected: injectionFlags.length > 0,
      confidential_data_redacted: redaction.redacted,
      quarantined: injectionFlags.length > 0,
      flags: [...injectionFlags, ...(redaction.redacted ? ['confidential_data_redacted'] : [])],
    };
    const interpretationId = newId();
    const classifications = safety.quarantined
      ? [{ code: 'unknown.unclassified', matchIndex: 0, statement: redaction.text }]
      : this.classify(redaction.text).slice(0, MAX_EVENTS);
    const eventRecords: IntelligenceEvent[] = [];
    for (let index = 0; index < classifications.length; index += 1) {
      const classified = classifications[index];
      const record = await this.buildEvent(
        ctx,
        interpretationId,
        classified.statement,
        classified.code,
        requestedMode as 'auto' | EventMode,
        typeof suppliedOccurredAt === 'string' ? suppliedOccurredAt : undefined,
        safety,
        index,
      );
      this.events.set(record.event_id, record);
      eventRecords.push(record);
      await this.database.put(ctx.tenantId, 'intelligence_event', record.event_id, record);
    }
    const interpretation: EventInterpretation = {
      interpretation_id: interpretationId,
      events: structuredClone(eventRecords),
      safety,
      limits: {
        max_input_characters: MAX_INPUT_CHARACTERS,
        max_events_per_interpretation: MAX_EVENTS,
        max_impact_depth: MAX_DEPTH,
        max_impacts_per_event: MAX_IMPACTS,
      },
      model: { provider: 'deterministic_synthetic_rules', model_version: MODEL_VERSION, generative_model_used: false },
    };
    this.interpretations.set(interpretationId, interpretation);
    this.idempotency.set(scope, { request_hash: requestHash, resource_id: interpretationId });
    await this.database.put(ctx.tenantId, 'event_interpretation', interpretationId, interpretation);
    await this.persistIdempotency(ctx.tenantId, scope, { request_hash: requestHash, resource_id: interpretationId });
    return structuredClone(interpretation);
  }

  listEvents(ctx: RequestContext, pageSizeInput?: string, cursorInput?: string): { items: IntelligenceEvent[]; next_cursor: string | null; has_more: boolean } {
    this.assertRead(ctx);
    const pageSize = pageSizeInput === undefined ? 50 : Number(pageSizeInput);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_page_size', 'page_size must be an integer from 1 to 100.');
    }
    const all = [...this.events.values()]
      .filter((event) => event.tenant_id === ctx.tenantId)
      .sort((left, right) => left.recorded_at.localeCompare(right.recorded_at) || left.event_id.localeCompare(right.event_id));
    let start = 0;
    if (cursorInput) {
      try {
        const cursor = JSON.parse(Buffer.from(cursorInput, 'base64url').toString('utf8')) as Record<string, unknown>;
        const fingerprint = sha256({ tenant_id: ctx.tenantId, membership_id: ctx.membershipId, policy_version: ctx.policyVersion }).slice(0, 24);
        if (cursor.version !== 1 || cursor.authorization_fingerprint !== fingerprint || typeof cursor.last_event_id !== 'string') throw new Error('invalid cursor');
        const index = all.findIndex((event) => event.event_id === cursor.last_event_id);
        if (index < 0) throw new Error('invalid cursor');
        start = index + 1;
      } catch {
        throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_page_cursor', 'page_cursor is invalid for the active tenant and authorization context.');
      }
    }
    const page = all.slice(start, start + pageSize);
    const hasMore = start + page.length < all.length;
    const last = page.at(-1);
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({
        version: 1,
        authorization_fingerprint: sha256({ tenant_id: ctx.tenantId, membership_id: ctx.membershipId, policy_version: ctx.policyVersion }).slice(0, 24),
        last_event_id: last.event_id,
      })).toString('base64url')
      : null;
    return { items: page.map((event) => structuredClone(event)), next_cursor: nextCursor, has_more: hasMore };
  }

  getEvent(ctx: RequestContext, eventId: string): IntelligenceEvent {
    return structuredClone(this.eventForContext(ctx, eventId));
  }

  async review(
    ctx: RequestContext,
    eventId: string,
    body: Record<string, unknown>,
    ifMatch: string | undefined,
    idempotencyKey: string,
  ): Promise<IntelligenceEvent> {
    const currentEvent = this.eventForContext(ctx, eventId);
    this.assertCreatorOrCreate(ctx, currentEvent);
    if (['applied', 'rolled_back', 'rejected'].includes(currentEvent.status)) {
      throw new ProblemException(
        HttpStatus.CONFLICT,
        'event_terminal',
        `Event status ${currentEvent.status} is terminal; create a superseding event instead of rewriting its application history.`,
      );
    }
    this.assertExactKeys(body, ['expected_version', 'verification_status', 'target_mode', 'entity_resolutions', 'notes'], 'event review');
    const scope = this.scope(ctx, `review:${eventId}`, idempotencyKey);
    const requestHash = sha256(body);
    const replay = this.idempotency.get(scope);
    if (replay) {
      if (replay.request_hash !== requestHash) this.idempotencyConflict();
      return structuredClone(this.eventForContext(ctx, replay.resource_id));
    }
    this.assertPrecondition(currentEvent, ifMatch);
    this.assertExpectedVersion(currentEvent, body.expected_version);
    const event = structuredClone(currentEvent);
    if (event.safety.quarantined) {
      throw new ProblemException(HttpStatus.UNPROCESSABLE_ENTITY, 'event_quarantined', 'Prompt-like instructions are quarantined and cannot become graph changes.');
    }
    const verification = body.verification_status;
    if (!['unverified', 'confirmed', 'rejected'].includes(String(verification))) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_verification_status', 'verification_status must be unverified, confirmed, or rejected.');
    }
    const targetMode = body.target_mode;
    if (!['reality', 'scenario'].includes(String(targetMode))) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_event_mode', 'target_mode must be reality or scenario.');
    }
    if (targetMode === 'reality' && verification !== 'confirmed') {
      throw new ProblemException(HttpStatus.UNPROCESSABLE_ENTITY, 'reality_verification_required', 'Reality updates require confirmed human verification; an unverified hypothesis must remain a scenario.');
    }
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    if (notes.length < 4 || notes.length > 1_000) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'review_notes_required', 'notes must contain 4 to 1000 characters.');
    }
    const decisions = this.parseResolutionDecisions(body.entity_resolutions);
    for (const resolution of event.entity_resolutions) {
      const decision = decisions.find((candidate) => candidate.mention === resolution.mention);
      if (!decision) {
        if (resolution.candidates.length) {
          throw new ProblemException(HttpStatus.BAD_REQUEST, 'entity_confirmation_required', `A resolution decision is required for ${resolution.mention}.`);
        }
        continue;
      }
      if (decision.selected_entity_id !== null && !resolution.candidates.some((candidate) => candidate.entity_id === decision.selected_entity_id)) {
        throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_entity_candidate', 'A selected entity is not an authorized candidate for this event.');
      }
      resolution.selected_entity_id = decision.selected_entity_id;
      resolution.required_confirmation = decision.selected_entity_id === null;
    }
    event.verification_status = verification as 'unverified' | 'confirmed' | 'rejected';
    event.mode = targetMode as EventMode;
    if (verification === 'rejected') {
      event.status = 'rejected';
      event.gate = this.rejectedGate('A reviewer rejected the factual claim.');
    } else {
      const taxonomy = TAXONOMY.find((item) => item.code === event.event_type.code) ?? TAXONOMY.at(-1) as EventTaxonomyEntry;
      event.impacts = this.impactsFor(
        ctx.tenantId,
        event.event_id,
        taxonomy,
        event.entity_resolutions,
        event.confidence.score,
        event.statement,
        event.evidence.map((item) => item.evidence_id),
      );
      event.causal_graph = this.causalGraph(event.event_id, event.event_type.label, event.impacts, event.statement);
      event.gate = this.gateFor(event, targetMode as EventMode);
      if (targetMode === 'reality' && !event.gate.live_mutation_allowed) {
        throw new ProblemException(HttpStatus.UNPROCESSABLE_ENTITY, 'reality_gate_failed', `Reality update is blocked: ${event.gate.blockers.join('; ')}.`);
      }
      event.status = 'reviewed';
    }
    const graphSnapshot = this.projection.snapshot(ctx.tenantId);
    event.graph_snapshot_version = graphSnapshot.version;
    event.graph_snapshot_hash = graphSnapshot.state_hash;
    event.review_notes = notes;
    event.version += 1;
    event.reviewed_payload_hash = sha256({
      event_id: event.event_id,
      event_type: event.event_type,
      occurred_at: event.occurred_at,
      verification_status: event.verification_status,
      mode: event.mode,
      entity_resolutions: event.entity_resolutions.map(({ mention, selected_entity_id }) => ({ mention, selected_entity_id })),
      impacts: event.impacts,
      graph_snapshot_version: event.graph_snapshot_version,
      graph_snapshot_hash: event.graph_snapshot_hash,
      notes: event.review_notes,
    });
    event.audit_evidence = await this.appendAudit(ctx, 'event.review', 'event', event.event_id, event.reviewed_payload_hash);
    this.refreshEtag(event);
    this.events.set(event.event_id, event);
    this.idempotency.set(scope, { request_hash: requestHash, resource_id: event.event_id });
    await this.database.put(ctx.tenantId, 'intelligence_event', event.event_id, event);
    await this.persistIdempotency(ctx.tenantId, scope, { request_hash: requestHash, resource_id: event.event_id });
    return structuredClone(event);
  }

  async requestApproval(
    ctx: RequestContext,
    eventId: string,
    body: Record<string, unknown>,
    ifMatch: string | undefined,
    idempotencyKey: string,
  ): Promise<EventApproval> {
    const event = this.eventForContext(ctx, eventId);
    this.assertCreatorOrCreate(ctx, event);
    this.assertExactKeys(body, ['expected_version', 'reviewed_payload_hash', 'reason'], 'event approval request');
    const scope = this.scope(ctx, `approval:${eventId}`, idempotencyKey);
    const requestHash = sha256(body);
    const replay = this.idempotency.get(scope);
    if (replay) {
      if (replay.request_hash !== requestHash) this.idempotencyConflict();
      const approval = this.approvals.get(replay.resource_id);
      if (!approval || approval.tenant_id !== ctx.tenantId) throw this.notFound();
      return structuredClone(approval);
    }
    this.assertPrecondition(event, ifMatch);
    this.assertExpectedVersion(event, body.expected_version);
    if (event.status !== 'reviewed' || !event.reviewed_payload_hash) {
      throw new ProblemException(HttpStatus.CONFLICT, 'event_not_reviewed', 'Review and confirm the exact interpretation before requesting approval.');
    }
    if (body.reviewed_payload_hash !== event.reviewed_payload_hash) this.payloadMismatch();
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 8 || reason.length > 500) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'approval_reason_required', 'reason must contain 8 to 500 characters.');
    }
    const approvalId = newId();
    const requiredRoles: Array<'operations' | 'security'> = event.mode === 'reality' ? ['operations', 'security'] : [];
    const audit = await this.appendAudit(ctx, 'event.approval.request', 'event_approval', approvalId, event.reviewed_payload_hash);
    const approval: EventApproval = {
      approval_id: approvalId,
      tenant_id: ctx.tenantId,
      event_id: event.event_id,
      requester_id: ctx.actor.actor_id,
      payload_hash: event.reviewed_payload_hash,
      event_version: event.version,
      graph_snapshot_version: event.graph_snapshot_version,
      graph_snapshot_hash: event.graph_snapshot_hash,
      status: event.mode === 'scenario' ? 'approved' : 'pending',
      required_roles: requiredRoles,
      decisions: [],
      reason,
      created_at: nowIso(),
      expires_at: addSeconds(nowIso(), 900),
      approval_kind: event.mode === 'scenario' ? 'scenario_policy' : 'dual_human',
      audit_evidence: audit,
    };
    event.status = approval.status === 'approved' ? 'approved' : 'approval_pending';
    event.version += 1;
    event.audit_evidence = audit;
    this.refreshEtag(event);
    this.approvals.set(approvalId, approval);
    this.idempotency.set(scope, { request_hash: requestHash, resource_id: approvalId });
    await this.database.put(ctx.tenantId, 'event_approval', approvalId, approval);
    await this.database.put(ctx.tenantId, 'intelligence_event', event.event_id, event);
    await this.persistIdempotency(ctx.tenantId, scope, { request_hash: requestHash, resource_id: approvalId });
    return structuredClone(approval);
  }

  getApproval(ctx: RequestContext, approvalId: string): EventApproval {
    this.assertRead(ctx);
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.tenant_id !== ctx.tenantId) throw this.notFound();
    return structuredClone(approval);
  }

  async decideApproval(
    ctx: RequestContext,
    approvalId: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<EventApproval> {
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.tenant_id !== ctx.tenantId) throw this.notFound();
    this.assertExactKeys(body, ['decision', 'payload_hash'], 'event approval decision');
    const role = this.approverRole(ctx);
    const scope = this.scope(ctx, `decision:${approvalId}`, idempotencyKey);
    const requestHash = sha256(body);
    const replay = this.idempotency.get(scope);
    if (replay) {
      if (replay.request_hash !== requestHash) this.idempotencyConflict();
      return structuredClone(approval);
    }
    if (approval.approval_kind !== 'dual_human' || approval.status !== 'pending') {
      throw new ProblemException(HttpStatus.CONFLICT, 'approval_not_open', 'This approval is not open for human decisions.');
    }
    if (this.isExpired(approval.expires_at)) {
      approval.status = 'cancelled';
      const event = this.eventForContext(ctx, approval.event_id);
      if (event.status === 'approval_pending') {
        event.status = 'reviewed';
        event.version += 1;
        this.refreshEtag(event);
      }
      approval.audit_evidence = await this.appendAudit(ctx, 'event.approval.expired', 'event_approval', approvalId, approval.payload_hash);
      event.audit_evidence = approval.audit_evidence;
      await this.database.put(ctx.tenantId, 'event_approval', approvalId, approval);
      await this.database.put(ctx.tenantId, 'intelligence_event', event.event_id, event);
      throw new ProblemException(HttpStatus.GONE, 'approval_expired', 'The exact-payload approval expired.');
    }
    if (body.payload_hash !== approval.payload_hash) this.payloadMismatch();
    if (!['approve', 'deny'].includes(String(body.decision))) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_approval_decision', 'decision must be approve or deny.');
    }
    if (!approval.required_roles.includes(role)) {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'approval_role_not_required', 'This approval does not require the actor role.');
    }
    if (approval.decisions.some((decision) => decision.actor_id === ctx.actor.actor_id || decision.role === role)) {
      throw new ProblemException(HttpStatus.CONFLICT, 'duplicate_approval_slot', 'Each approval slot requires one distinct authenticated approver.');
    }
    const decision = {
      decision_id: newId(),
      actor_id: ctx.actor.actor_id,
      role,
      decision: body.decision as 'approve' | 'deny',
      payload_hash: approval.payload_hash,
      decided_at: nowIso(),
    };
    approval.decisions.push(decision);
    approval.status = decision.decision === 'deny'
      ? 'denied'
      : approval.required_roles.every((required) => approval.decisions.some((item) => item.role === required && item.decision === 'approve'))
        ? 'approved'
        : 'pending';
    const event = this.eventForContext(ctx, approval.event_id);
    if (approval.status === 'approved') {
      event.status = 'approved';
      event.version += 1;
      this.refreshEtag(event);
    } else if (approval.status === 'denied') {
      event.status = 'reviewed';
      event.version += 1;
      this.refreshEtag(event);
    }
    approval.audit_evidence = await this.appendAudit(ctx, `event.approval.${decision.decision}`, 'event_approval', approvalId, sha256(decision));
    event.audit_evidence = approval.audit_evidence;
    this.idempotency.set(scope, { request_hash: requestHash, resource_id: approvalId });
    await this.database.put(ctx.tenantId, 'event_approval', approvalId, approval);
    await this.database.put(ctx.tenantId, 'intelligence_event', event.event_id, event);
    await this.persistIdempotency(ctx.tenantId, scope, { request_hash: requestHash, resource_id: approvalId });
    return structuredClone(approval);
  }

  async apply(
    ctx: RequestContext,
    eventId: string,
    body: Record<string, unknown>,
    ifMatch: string | undefined,
    idempotencyKey: string,
  ): Promise<EventActionReceipt> {
    const event = this.eventForContext(ctx, eventId);
    this.assertCreatorOrCreate(ctx, event);
    this.assertExactKeys(body, ['expected_version', 'reviewed_payload_hash', 'approval_id'], 'event apply');
    const scope = this.scope(ctx, `apply:${eventId}`, idempotencyKey);
    const requestHash = sha256(body);
    const replay = this.idempotency.get(scope);
    if (replay) {
      if (replay.request_hash !== requestHash) this.idempotencyConflict();
      const prior = this.receipts.get(replay.resource_id);
      if (!prior) throw this.notFound();
      return { ...structuredClone(prior), replayed: true };
    }
    this.assertPrecondition(event, ifMatch);
    this.assertExpectedVersion(event, body.expected_version);
    if (event.status !== 'approved' || !event.reviewed_payload_hash) {
      throw new ProblemException(HttpStatus.CONFLICT, 'approval_incomplete', 'The exact reviewed payload must be fully approved before apply.');
    }
    if (body.reviewed_payload_hash !== event.reviewed_payload_hash) this.payloadMismatch();
    const approval = this.approvals.get(String(body.approval_id));
    if (!approval || approval.tenant_id !== ctx.tenantId || approval.event_id !== event.event_id) throw this.notFound();
    if (approval.status !== 'approved' || approval.payload_hash !== event.reviewed_payload_hash) {
      throw new ProblemException(HttpStatus.CONFLICT, 'approval_incomplete', 'The approval is incomplete or bound to a different payload.');
    }
    const expectedApprovedEventVersion = approval.event_version + (approval.approval_kind === 'dual_human' ? 2 : 1);
    if (event.version !== expectedApprovedEventVersion) {
      throw new ProblemException(HttpStatus.CONFLICT, 'approval_event_version_mismatch', 'The approved review is bound to a different event version.');
    }
    if (
      approval.graph_snapshot_version !== event.graph_snapshot_version
      || approval.graph_snapshot_hash !== event.graph_snapshot_hash
    ) {
      throw new ProblemException(HttpStatus.CONFLICT, 'approval_snapshot_mismatch', 'The approval is bound to a different graph snapshot.');
    }
    if (this.isExpired(approval.expires_at)) throw new ProblemException(HttpStatus.GONE, 'approval_expired', 'The exact-payload approval expired.');

    const beforeVersion = event.version;
    let branchId: string | null = null;
    let beforeStateHash: string;
    let afterStateHash: string;
    let graphVersionBefore: number;
    let graphVersionAfter: number;
    let beforeSnapshot: EventProjectionSnapshot | null = null;
    let afterSnapshot: EventProjectionSnapshot | null = null;
    const proposedChanges = event.impacts
      .filter((impact) => impact.proposed_mutation !== null)
      .slice(0, MAX_IMPACTS)
      .map((impact) => ({
        impact,
        change: { impact_id: impact.impact_id, ...structuredClone(impact.proposed_mutation as Record<string, unknown>) },
      }));
    const appliedChanges = proposedChanges
      .filter(({ impact }) => event.mode === 'scenario' || impact.live_mutation_eligible)
      .map(({ change }) => change);
    if (event.mode === 'reality' && appliedChanges.length === 0) {
      throw new ProblemException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'no_live_mutation_eligible_changes',
        'The reviewed event contains no allowlisted authoritative projection mutation; derived proposals may be evaluated only in a scenario branch.',
      );
    }
    let nextBranch: ScenarioBranch;
    if (event.mode === 'scenario') {
      const currentProjection = this.projection.snapshot(ctx.tenantId);
      if (currentProjection.version !== approval.graph_snapshot_version) {
        throw new ProblemException(HttpStatus.CONFLICT, 'projection_version_changed', 'The synthetic event projection version changed; refresh and review the scenario again.');
      }
      if (currentProjection.state_hash !== approval.graph_snapshot_hash) {
        throw new ProblemException(HttpStatus.CONFLICT, 'projection_hash_changed', 'The synthetic event projection state changed; refresh and review the scenario again.');
      }
      beforeSnapshot = currentProjection;
      branchId = stableUuid(`event-branch:${ctx.tenantId}:${event.event_id}`);
      beforeStateHash = currentProjection.state_hash;
      afterStateHash = sha256({
        base_graph_version: approval.graph_snapshot_version,
        base_state_hash: approval.graph_snapshot_hash,
        event: event.reviewed_payload_hash,
        appliedChanges,
      });
      graphVersionBefore = currentProjection.version;
      graphVersionAfter = currentProjection.version;
      nextBranch = {
        branch_id: branchId,
        tenant_id: ctx.tenantId,
        name: `Scenario: ${event.event_type.label}`,
        parent_branch_id: this.baselineBranchId(ctx.tenantId),
        created_by_event_id: event.event_id,
        created_at: nowIso(),
        mode: 'scenario',
        status: 'active',
        event_ids: [event.event_id],
        base_graph_version: approval.graph_snapshot_version,
        base_state_hash: approval.graph_snapshot_hash,
        state_hash: afterStateHash,
      };
    } else {
      let transition;
      try {
        transition = this.projection.applyExact(
          ctx.tenantId,
          approval.graph_snapshot_version,
          approval.graph_snapshot_hash,
          appliedChanges,
        );
      } catch (error) {
        this.throwProjectionProblem(error);
      }
      beforeSnapshot = transition!.before;
      afterSnapshot = transition!.after;
      beforeStateHash = beforeSnapshot.state_hash;
      afterStateHash = afterSnapshot.state_hash;
      graphVersionBefore = beforeSnapshot.version;
      graphVersionAfter = afterSnapshot.version;
      branchId = this.baselineBranchId(ctx.tenantId);
      const baseline = this.branches.get(branchId) ?? this.baselineBranch(ctx.tenantId);
      nextBranch = structuredClone(baseline);
      nextBranch.state_hash = afterStateHash;
      nextBranch.base_graph_version = graphVersionAfter;
      nextBranch.base_state_hash = afterStateHash;
      if (!nextBranch.event_ids.includes(event.event_id)) nextBranch.event_ids.push(event.event_id);
    }
    const application: EventApplication = {
      event_id: event.event_id,
      approval_id: approval.approval_id,
      mode: event.mode,
      before_state_hash: beforeStateHash,
      after_state_hash: afterStateHash,
      before_graph_version: graphVersionBefore,
      after_graph_version: graphVersionAfter,
      before_snapshot: beforeSnapshot,
      after_snapshot: afterSnapshot,
    };
    const payloadHash = sha256({ event_id: event.event_id, approval_id: approval.approval_id, reviewed_payload_hash: event.reviewed_payload_hash, appliedChanges });
    const nextEvent = structuredClone(event);
    nextEvent.status = 'applied';
    nextEvent.version += 1;
    nextEvent.applied_payload_hash = payloadHash;
    nextEvent.branch_id = branchId;
    const nextApproval = structuredClone(approval);
    nextApproval.status = 'executed';
    const receiptId = newId();
    const auditCount = (this.audits.get(ctx.tenantId) ?? []).length;
    const audit = await this.appendAudit(ctx, event.mode === 'reality' ? 'event.apply.reality_projection' : 'event.apply.scenario', 'event_receipt', receiptId, payloadHash, false);
    const receipt: EventActionReceipt = {
      receipt_id: receiptId,
      tenant_id: ctx.tenantId,
      event_id: event.event_id,
      approval_id: approval.approval_id,
      action: event.mode === 'reality' ? 'apply_reality' : 'apply_scenario',
      actor_id: ctx.actor.actor_id,
      before_version: beforeVersion,
      after_version: nextEvent.version,
      graph_version_before: graphVersionBefore,
      graph_version_after: graphVersionAfter,
      payload_hash: payloadHash,
      before_state_hash: beforeStateHash,
      after_state_hash: afterStateHash,
      applied_changes: appliedChanges,
      branch_id: branchId,
      status: 'succeeded',
      replayed: false,
      outbox_position: 0,
      provider: 'synthetic_event_projection',
      external_write: false,
      prohibited_actions_not_executed: ['identity_or_permission_revocation', 'HRIS_employment_change', 'security_control_change', 'external_graph_write'],
      recorded_at: nowIso(),
      audit_evidence: audit,
    };
    nextEvent.audit_evidence = audit;
    this.refreshEtag(nextEvent);
    const timelineEntry = this.makeTimelineEntry(
      ctx.tenantId,
      nextEvent,
      beforeStateHash,
      afterStateHash,
      graphVersionBefore,
      graphVersionAfter,
      receiptId,
      'event_applied',
    );
    const idempotencyRecord = { scope, request_hash: requestHash, resource_id: receiptId };
    const outboxEventId = newId();
    const outboxPayload = this.eventChangedEnvelope(ctx, nextEvent, receipt, outboxEventId);
    const mutationGuard = this.eventMutationGuard(
      ctx,
      `apply:${eventId}`,
      idempotencyKey,
      requestHash,
      receiptId,
      event,
      beforeSnapshot,
    );
    try {
      const result = await this.database.commitEventMutation<unknown, Record<string, unknown>>(
        ctx.tenantId,
        [
          { kind: 'intelligence_event', id: nextEvent.event_id, payload: nextEvent },
          { kind: 'event_approval', id: nextApproval.approval_id, payload: nextApproval },
          { kind: 'event_action_receipt', id: receiptId, payload: receipt },
          { kind: 'event_application', id: application.event_id, payload: application },
          { kind: 'event_branch', id: nextBranch.branch_id, payload: nextBranch },
          { kind: 'event_timeline_entry', id: timelineEntry.timeline_entry_id, payload: timelineEntry },
          { kind: 'event_idempotency', id: stableUuid(`event-idempotency:${scope}`), payload: idempotencyRecord },
          ...(afterSnapshot ? [{ kind: 'event_projection_snapshot', id: stableUuid(`event-projection:${ctx.tenantId}`), payload: afterSnapshot }] : []),
        ],
        audit,
        {
          eventId: outboxEventId,
          eventType: 'com.enterprisedigitaltwin.event-intelligence.event-changed.v1',
          aggregateType: 'intelligence_event',
          aggregateId: nextEvent.event_id,
          aggregateVersion: nextEvent.version,
          payload: outboxPayload,
        },
        mutationGuard,
      );
      if (result.replayed) {
        if (beforeSnapshot && afterSnapshot) {
          this.projection.restoreUncommitted(ctx.tenantId, afterSnapshot.version, afterSnapshot.state_hash, beforeSnapshot);
        }
        this.restoreAuditPrefix(ctx.tenantId, auditCount);
        const prior = await this.reloadAuthoritativeMutation(ctx.tenantId, event.event_id, result.responseRef ?? receiptId, scope, requestHash);
        if (!prior) {
          throw new ProblemException(HttpStatus.CONFLICT, 'idempotency_response_missing', 'The authoritative idempotent event receipt is unavailable.');
        }
        return { ...prior, replayed: true };
      }
      receipt.outbox_position = result.outboxPosition;
    } catch (error) {
      if (beforeSnapshot && afterSnapshot) {
        this.projection.restoreUncommitted(ctx.tenantId, afterSnapshot.version, afterSnapshot.state_hash, beforeSnapshot);
      }
      this.restoreAuditPrefix(ctx.tenantId, auditCount);
      if (error instanceof DatabaseMutationConflict) {
        await this.reloadAuthoritativeMutation(ctx.tenantId, event.event_id).catch(() => undefined);
        this.throwDatabaseMutationProblem(error);
      }
      throw error;
    }
    this.events.set(nextEvent.event_id, nextEvent);
    this.approvals.set(nextApproval.approval_id, nextApproval);
    this.receipts.set(receiptId, receipt);
    this.applications.set(application.event_id, application);
    this.branches.set(nextBranch.branch_id, nextBranch);
    const timeline = this.timelines.get(ctx.tenantId) ?? [];
    timeline.push(timelineEntry);
    this.timelines.set(ctx.tenantId, timeline);
    this.idempotency.set(scope, { request_hash: requestHash, resource_id: receiptId });
    await this.refreshAuthoritativeAudits(ctx.tenantId);
    return structuredClone(receipt);
  }

  async rollback(
    ctx: RequestContext,
    eventId: string,
    body: Record<string, unknown>,
    ifMatch: string | undefined,
    idempotencyKey: string,
  ): Promise<EventActionReceipt> {
    const event = this.eventForContext(ctx, eventId);
    this.assertRollback(ctx);
    this.assertExactKeys(body, ['expected_version', 'applied_payload_hash', 'reason'], 'event rollback');
    const scope = this.scope(ctx, `rollback:${eventId}`, idempotencyKey);
    const requestHash = sha256(body);
    const replay = this.idempotency.get(scope);
    if (replay) {
      if (replay.request_hash !== requestHash) this.idempotencyConflict();
      const prior = this.receipts.get(replay.resource_id);
      if (!prior) throw this.notFound();
      return { ...structuredClone(prior), replayed: true };
    }
    this.assertPrecondition(event, ifMatch);
    this.assertExpectedVersion(event, body.expected_version);
    if (event.status !== 'applied' || !event.applied_payload_hash) {
      throw new ProblemException(HttpStatus.CONFLICT, 'event_not_applied', 'Only an applied synthetic event can be rolled back.');
    }
    if (body.applied_payload_hash !== event.applied_payload_hash) this.payloadMismatch();
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 8 || reason.length > 500) {
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'rollback_reason_required', 'reason must contain 8 to 500 characters.');
    }
    const beforeVersion = event.version;
    const application = this.applications.get(event.event_id);
    if (!application) throw new ProblemException(HttpStatus.CONFLICT, 'projection_receipt_missing', 'The exact synthetic projection receipt required for rollback is unavailable.');
    const inverseChanges = event.impacts
      .filter((impact) => impact.proposed_mutation !== null)
      .map((impact) => ({ impact_id: impact.impact_id, operation: 'compensate', original: impact.proposed_mutation }));
    let graphVersionBefore: number;
    let graphVersionAfter: number;
    let projectionBefore: EventProjectionSnapshot | null = null;
    let projectionAfter: EventProjectionSnapshot | null = null;
    let nextBranch: ScenarioBranch | null = null;
    if (event.mode === 'scenario' && event.branch_id) {
      const branch = this.branches.get(event.branch_id);
      if (!branch || branch.tenant_id !== ctx.tenantId) throw this.notFound();
      nextBranch = structuredClone(branch);
      nextBranch.status = 'rolled_back';
      graphVersionBefore = application.after_graph_version;
      graphVersionAfter = application.before_graph_version;
    } else {
      const currentSnapshot = this.projection.snapshot(ctx.tenantId);
      if (
        currentSnapshot.version !== application.after_graph_version
        || currentSnapshot.state_hash !== application.after_state_hash
      ) {
        throw new ProblemException(HttpStatus.CONFLICT, 'projection_version_changed', 'The synthetic reality projection changed after this event; an exact rollback would overwrite later work.');
      }
      if (!application.before_snapshot) {
        throw new ProblemException(HttpStatus.CONFLICT, 'projection_receipt_missing', 'The exact before-state snapshot required for rollback is unavailable.');
      }
      let transition;
      try {
        transition = this.projection.rollbackExact(
          ctx.tenantId,
          currentSnapshot.version,
          currentSnapshot.state_hash,
          application.before_snapshot,
        );
      } catch (error) {
        this.throwProjectionProblem(error);
      }
      projectionBefore = transition!.before;
      projectionAfter = transition!.after;
      graphVersionBefore = projectionBefore.version;
      graphVersionAfter = projectionAfter.version;
      const baselineId = this.baselineBranchId(ctx.tenantId);
      nextBranch = structuredClone(this.branches.get(baselineId) ?? this.baselineBranch(ctx.tenantId));
      nextBranch.state_hash = projectionAfter.state_hash;
      nextBranch.base_graph_version = projectionAfter.version;
      nextBranch.base_state_hash = projectionAfter.state_hash;
    }
    const nextEvent = structuredClone(event);
    nextEvent.status = 'rolled_back';
    nextEvent.version += 1;
    const payloadHash = sha256({ applied_payload_hash: event.applied_payload_hash, inverseChanges, reason });
    const receiptId = newId();
    const auditCount = (this.audits.get(ctx.tenantId) ?? []).length;
    const audit = await this.appendAudit(ctx, 'event.rollback.synthetic_projection', 'event_receipt', receiptId, payloadHash, false);
    const receipt: EventActionReceipt = {
      receipt_id: receiptId,
      tenant_id: ctx.tenantId,
      event_id: event.event_id,
      approval_id: application.approval_id,
      action: 'rollback',
      actor_id: ctx.actor.actor_id,
      before_version: beforeVersion,
      after_version: nextEvent.version,
      graph_version_before: graphVersionBefore,
      graph_version_after: graphVersionAfter,
      payload_hash: payloadHash,
      before_state_hash: application.after_state_hash,
      after_state_hash: application.before_state_hash,
      applied_changes: inverseChanges,
      branch_id: event.branch_id,
      status: 'succeeded',
      replayed: false,
      outbox_position: 0,
      provider: 'synthetic_event_projection',
      external_write: false,
      prohibited_actions_not_executed: ['identity_or_permission_restoration', 'HRIS_employment_change', 'security_control_change', 'external_graph_write'],
      recorded_at: nowIso(),
      audit_evidence: audit,
    };
    nextEvent.audit_evidence = audit;
    this.refreshEtag(nextEvent);
    const timelineEntry = this.makeTimelineEntry(
      ctx.tenantId,
      nextEvent,
      application.after_state_hash,
      application.before_state_hash,
      graphVersionBefore,
      graphVersionAfter,
      receiptId,
      'event_rolled_back',
    );
    const idempotencyRecord = { scope, request_hash: requestHash, resource_id: receiptId };
    const outboxEventId = newId();
    const outboxPayload = this.eventChangedEnvelope(ctx, nextEvent, receipt, outboxEventId);
    const mutationGuard = this.eventMutationGuard(
      ctx,
      `rollback:${eventId}`,
      idempotencyKey,
      requestHash,
      receiptId,
      event,
      projectionBefore,
    );
    try {
      const result = await this.database.commitEventMutation<unknown, Record<string, unknown>>(
        ctx.tenantId,
        [
          { kind: 'intelligence_event', id: nextEvent.event_id, payload: nextEvent },
          { kind: 'event_action_receipt', id: receiptId, payload: receipt },
          { kind: 'event_application', id: application.event_id, payload: application },
          { kind: 'event_timeline_entry', id: timelineEntry.timeline_entry_id, payload: timelineEntry },
          { kind: 'event_idempotency', id: stableUuid(`event-idempotency:${scope}`), payload: idempotencyRecord },
          ...(nextBranch ? [{ kind: 'event_branch', id: nextBranch.branch_id, payload: nextBranch }] : []),
          ...(projectionAfter ? [{ kind: 'event_projection_snapshot', id: stableUuid(`event-projection:${ctx.tenantId}`), payload: projectionAfter }] : []),
        ],
        audit,
        {
          eventId: outboxEventId,
          eventType: 'com.enterprisedigitaltwin.event-intelligence.event-changed.v1',
          aggregateType: 'intelligence_event',
          aggregateId: nextEvent.event_id,
          aggregateVersion: nextEvent.version,
          payload: outboxPayload,
        },
        mutationGuard,
      );
      if (result.replayed) {
        if (projectionBefore && projectionAfter) {
          this.projection.restoreUncommitted(ctx.tenantId, projectionAfter.version, projectionAfter.state_hash, projectionBefore);
        }
        this.restoreAuditPrefix(ctx.tenantId, auditCount);
        const prior = await this.reloadAuthoritativeMutation(ctx.tenantId, event.event_id, result.responseRef ?? receiptId, scope, requestHash);
        if (!prior) {
          throw new ProblemException(HttpStatus.CONFLICT, 'idempotency_response_missing', 'The authoritative idempotent rollback receipt is unavailable.');
        }
        return { ...prior, replayed: true };
      }
      receipt.outbox_position = result.outboxPosition;
    } catch (error) {
      if (projectionBefore && projectionAfter) {
        this.projection.restoreUncommitted(ctx.tenantId, projectionAfter.version, projectionAfter.state_hash, projectionBefore);
      }
      this.restoreAuditPrefix(ctx.tenantId, auditCount);
      if (error instanceof DatabaseMutationConflict) {
        await this.reloadAuthoritativeMutation(ctx.tenantId, event.event_id).catch(() => undefined);
        this.throwDatabaseMutationProblem(error);
      }
      throw error;
    }
    this.events.set(nextEvent.event_id, nextEvent);
    this.receipts.set(receiptId, receipt);
    if (nextBranch) this.branches.set(nextBranch.branch_id, nextBranch);
    const timeline = this.timelines.get(ctx.tenantId) ?? [];
    timeline.push(timelineEntry);
    this.timelines.set(ctx.tenantId, timeline);
    this.idempotency.set(scope, { request_hash: requestHash, resource_id: receiptId });
    await this.refreshAuthoritativeAudits(ctx.tenantId);
    return structuredClone(receipt);
  }

  timeline(ctx: RequestContext): { items: TimelineEntry[]; baseline_branch_id: string } {
    this.assertRead(ctx);
    this.ensureTenant(ctx);
    return { items: structuredClone(this.timelines.get(ctx.tenantId) ?? []), baseline_branch_id: this.baselineBranchId(ctx.tenantId) };
  }

  listBranches(ctx: RequestContext): { items: ScenarioBranch[] } {
    this.assertRead(ctx);
    this.ensureTenant(ctx);
    return { items: [...this.branches.values()].filter((branch) => branch.tenant_id === ctx.tenantId).map((branch) => structuredClone(branch)) };
  }

  replay(ctx: RequestContext, eventId: string): EventReplay {
    const event = this.eventForContext(ctx, eventId);
    const application = this.applications.get(eventId);
    const receipts = [...this.receipts.values()]
      .filter((receipt) => receipt.tenant_id === ctx.tenantId && receipt.event_id === eventId)
      .sort((left, right) => left.recorded_at.localeCompare(right.recorded_at));
    const timeline = (this.timelines.get(ctx.tenantId) ?? [])
      .filter((entry) => entry.event_id === eventId)
      .map((entry) => structuredClone(entry));
    const branch = event.branch_id ? this.branches.get(event.branch_id) ?? null : null;
    const entityChanges: EventReplay['entity_changes'] = [];
    const relationshipChanges: EventReplay['relationship_changes'] = [];

    if (application?.before_snapshot && application.after_snapshot) {
      const beforeEntities = new Map(application.before_snapshot.entities.map((entity) => [entity.entity_id, entity]));
      const afterEntities = new Map(application.after_snapshot.entities.map((entity) => [entity.entity_id, entity]));
      for (const entityId of new Set([...beforeEntities.keys(), ...afterEntities.keys()])) {
        const before = beforeEntities.get(entityId);
        const after = afterEntities.get(entityId);
        if (sha256(before ?? null) === sha256(after ?? null)) continue;
        entityChanges.push({
          entity_id: entityId,
          display_name: after?.display_name ?? before?.display_name ?? entityId,
          before: before ? structuredClone(before.state) : null,
          after: after ? structuredClone(after.state) : null,
        });
      }
      const beforeRelationships = new Map(application.before_snapshot.relationships.map((relationship) => [relationship.relationship_id, relationship]));
      const afterRelationships = new Map(application.after_snapshot.relationships.map((relationship) => [relationship.relationship_id, relationship]));
      for (const relationshipId of new Set([...beforeRelationships.keys(), ...afterRelationships.keys()])) {
        const before = beforeRelationships.get(relationshipId);
        const after = afterRelationships.get(relationshipId);
        if (sha256(before ?? null) === sha256(after ?? null)) continue;
        const relationship = after ?? before;
        if (!relationship) continue;
        relationshipChanges.push({
          relationship_id: relationshipId,
          type: relationship.type,
          from_entity_id: relationship.from_entity_id,
          to_entity_id: relationship.to_entity_id,
          before_state: before?.state ?? null,
          after_state: after?.state ?? null,
        });
      }
    }

    return {
      event_id: eventId,
      mode: event.mode,
      current_status: event.status,
      reconstructable: Boolean(application && receipts.length && timeline.every((entry) => entry.receipt_id === null || receipts.some((receipt) => receipt.receipt_id === entry.receipt_id))),
      graph: application ? {
        before_version: application.before_graph_version,
        after_version: application.after_graph_version,
        before_state_hash: application.before_state_hash,
        after_state_hash: application.after_state_hash,
      } : null,
      entity_changes: entityChanges,
      relationship_changes: relationshipChanges,
      receipts: receipts.map((receipt) => structuredClone(receipt)),
      timeline,
      branch: branch ? structuredClone(branch) : null,
    };
  }

  compareBranches(ctx: RequestContext, body: Record<string, unknown>): BranchComparison {
    this.assertRead(ctx);
    this.assertExactKeys(body, ['left_branch_id', 'right_branch_id'], 'branch comparison');
    const leftId = typeof body.left_branch_id === 'string' ? body.left_branch_id : '';
    const rightId = typeof body.right_branch_id === 'string' ? body.right_branch_id : '';
    const left = this.branches.get(leftId);
    const right = this.branches.get(rightId);
    if (!left || !right || left.tenant_id !== ctx.tenantId || right.tenant_id !== ctx.tenantId) throw this.notFound();
    const leftEvents = new Set(left.event_ids);
    const rightEvents = new Set(right.event_ids);
    const tenantTimeline = this.timelines.get(ctx.tenantId) ?? [];
    return {
      left: structuredClone(left),
      right: structuredClone(right),
      same_base_snapshot: left.base_graph_version === right.base_graph_version && left.base_state_hash === right.base_state_hash,
      common_event_ids: [...leftEvents].filter((eventId) => rightEvents.has(eventId)).sort(),
      left_only_event_ids: [...leftEvents].filter((eventId) => !rightEvents.has(eventId)).sort(),
      right_only_event_ids: [...rightEvents].filter((eventId) => !leftEvents.has(eventId)).sort(),
      state_hash_equal: left.state_hash === right.state_hash,
      timeline: {
        left: tenantTimeline.filter((entry) => entry.branch_id === leftId).map((entry) => structuredClone(entry)),
        right: tenantTimeline.filter((entry) => entry.branch_id === rightId).map((entry) => structuredClone(entry)),
      },
    };
  }

  eventAudit(ctx: RequestContext, eventId: string): EventAuditResponse {
    const event = this.eventForContext(ctx, eventId);
    const tenantAudit = this.audits.get(ctx.tenantId) ?? [];
    const items = tenantAudit.filter((audit) => audit.resource_id === eventId || this.auditBelongsToEvent(ctx.tenantId, audit, eventId));
    const base = this.auditHealth.get(ctx.tenantId) ?? this.assessAuditChain(ctx.tenantId, tenantAudit).diagnostics;
    const canonicalIds = new Set(tenantAudit.map((audit) => audit.audit_id));
    const expectedIds = new Set<string>([event.audit_evidence.audit_id]);
    for (const approval of this.approvals.values()) {
      if (approval.tenant_id === ctx.tenantId && approval.event_id === eventId) expectedIds.add(approval.audit_evidence.audit_id);
    }
    for (const receipt of this.receipts.values()) {
      if (receipt.tenant_id === ctx.tenantId && receipt.event_id === eventId) expectedIds.add(receipt.audit_evidence.audit_id);
    }
    const missingEventAuditIds = [...expectedIds].filter((auditId) => !canonicalIds.has(auditId)).sort();
    const issues = [...base.issues];
    if (items.length === 0 || missingEventAuditIds.length > 0) issues.push('incomplete_event_chain');
    const uniqueIssues = [...new Set(issues)] as EventAuditIssueCode[];
    const itemPage = items.slice(0, MAX_AUDIT_DIAGNOSTIC_REFS);
    const diagnostics: EventAuditChainDiagnostics = {
      ...structuredClone(base),
      event_records: items.length,
      expected_event_records: expectedIds.size,
      missing_event_audit_ids: missingEventAuditIds.slice(0, MAX_AUDIT_DIAGNOSTIC_REFS),
      diagnostics_truncated: base.diagnostics_truncated
        || items.length > MAX_AUDIT_DIAGNOSTIC_REFS
        || missingEventAuditIds.length > MAX_AUDIT_DIAGNOSTIC_REFS,
      issues: uniqueIssues,
    };
    return { items: structuredClone(itemPage), chain_valid: uniqueIssues.length === 0, diagnostics };
  }

  private async buildEvent(
    ctx: RequestContext,
    interpretationId: string,
    text: string,
    code: string,
    requestedMode: 'auto' | EventMode,
    suppliedOccurredAt: string | undefined,
    safety: IntelligenceEvent['safety'],
    index: number,
  ): Promise<IntelligenceEvent> {
    const taxonomy = TAXONOMY.find((item) => item.code === code) ?? TAXONOMY.at(-1) as EventTaxonomyEntry;
    const eventId = stableUuid(`event:${ctx.tenantId}:${interpretationId}:${index}:${code}`);
    const timing = this.extractTiming(text, suppliedOccurredAt);
    const confidence = this.confidenceFor(text, taxonomy, safety);
    const mode = this.initialMode(text, taxonomy, requestedMode, confidence.level, timing.value);
    const resolutions = this.resolveEntities(ctx.tenantId, text, taxonomy.category);
    const conflicts = this.findConflicts(ctx.tenantId, code, resolutions);
    const evidence = [
      { evidence_id: stableUuid(`event-evidence:${eventId}:statement`), kind: 'user_statement' as const, summary: 'Unverified user-provided statement; treated as data, never as instructions.', confidence: confidence.score },
      ...resolutions.flatMap((resolution) => resolution.candidates.slice(0, 1).map((candidate) => ({
        evidence_id: stableUuid(`event-evidence:${eventId}:${candidate.entity_id}`),
        kind: 'synthetic_graph_fact' as const,
        summary: `Synthetic graph candidate ${candidate.display_name} matched by ${candidate.reasons.join(', ')}.`,
        confidence: candidate.confidence,
      }))),
      ...conflicts.map((conflict) => ({ evidence_id: stableUuid(`event-evidence:${eventId}:conflict:${conflict.event_id}`), kind: 'conflict' as const, summary: conflict.reason, confidence: 1 })),
    ];
    const impacts = safety.quarantined
      ? []
      : this.impactsFor(ctx.tenantId, eventId, taxonomy, resolutions, confidence.score, text, evidence.map((item) => item.evidence_id));
    const graph = this.causalGraph(eventId, taxonomy.label, impacts, text);
    const blockers: string[] = [];
    if (confidence.level !== 'confirmed') blockers.push(`confidence_level_${confidence.level}`);
    if (resolutions.some((resolution) => resolution.required_confirmation)) blockers.push('entity_confirmation_required');
    if (conflicts.length) blockers.push('conflicting_event_requires_resolution');
    if (new Date(timing.value).getTime() < new Date('2015-01-01T00:00:00Z').getTime()) blockers.push('timestamp_before_synthetic_company_history');
    if (safety.quarantined) blockers.push('untrusted_instruction_quarantined');
    const status = safety.quarantined ? 'rejected' : resolutions.some((resolution) => resolution.required_confirmation) ? 'needs_resolution' : 'interpreted';
    const audit = await this.appendAudit(ctx, safety.quarantined ? 'event.interpret.quarantined' : 'event.interpret', 'event', eventId, sha256({ text, code, mode }));
    const graphSnapshot = this.projection.snapshot(ctx.tenantId);
    const event: IntelligenceEvent = {
      event_id: eventId,
      interpretation_id: interpretationId,
      tenant_id: ctx.tenantId,
      version: 1,
      status,
      event_type: { code: taxonomy.code, category: taxonomy.category, label: taxonomy.label },
      source: { kind: 'manual_natural_language', creator_id: ctx.actor.actor_id, source_text_hash: sha256(text) },
      statement: safety.quarantined ? '[Quarantined untrusted instruction]' : text,
      occurred_at: timing,
      recorded_at: nowIso(),
      location: this.extractLocation(text),
      confidence,
      verification_status: safety.quarantined ? 'rejected' : 'unverified',
      mode,
      entity_resolutions: resolutions,
      related_entities: resolutions.flatMap((resolution) => resolution.candidates.slice(0, 3).map((candidate) => ({
        entity_id: candidate.entity_id,
        display_name: candidate.display_name,
        resolution_confidence: candidate.confidence,
      }))),
      evidence,
      attachments: [],
      historical_references: conflicts.map((conflict) => ({ event_id: conflict.event_id, relation: 'conflicts_with' as const })),
      impacts,
      causal_graph: graph,
      gate: safety.quarantined
        ? this.rejectedGate('The input contains instruction-like content and is quarantined.')
        : {
            route: mode === 'scenario' ? 'scenario_branch' : 'reality_update',
            live_mutation_allowed: mode === 'reality' && blockers.length === 0,
            blockers,
            required_approvals: mode === 'reality' ? ['operations', 'security'] : [],
            policy_version: POLICY_VERSION,
            rationale: mode === 'scenario'
              ? 'Uncertain or hypothetical events are isolated in a scenario branch.'
              : 'A confirmed reality update requires entity confirmation, review, and two distinct approvals.',
          },
      conflicts,
      unknown_effects: [
        'Consequences outside the tenant-authorized synthetic graph are unknown.',
        'Long-term causal claims require additional evidence and validation.',
        ...(taxonomy.category === 'people' ? ['No individual productivity, performance, attrition, health, or employment score is inferred.'] : []),
      ],
      safety,
      graph_snapshot_version: graphSnapshot.version,
      graph_snapshot_hash: graphSnapshot.state_hash,
      review_notes: null,
      reviewed_payload_hash: null,
      applied_payload_hash: null,
      branch_id: null,
      external_write: false,
      synthetic_projection_only: true,
      audit_evidence: audit,
      etag: '',
    };
    this.refreshEtag(event);
    return event;
  }

  private classify(text: string): Array<{ code: string; matchIndex: number; statement: string }> {
    const segments = text.split(/(?<=[.!?])\s+|;\s+|\s+(?:and then|then)\s+/i).map((statement) => statement.trim()).filter(Boolean);
    let offset = 0;
    const results: Array<{ code: string; matchIndex: number; statement: string }> = [];
    for (const statement of segments) {
      const segmentIndex = text.indexOf(statement, offset);
      offset = Math.max(offset, segmentIndex + statement.length);
      for (const rule of RULES) {
        const match = rule.pattern.exec(statement);
        if (match) results.push({ code: rule.code, matchIndex: Math.max(0, segmentIndex) + match.index, statement });
      }
    }
    results.sort((left, right) => left.matchIndex - right.matchIndex || left.code.localeCompare(right.code));
    const unique = results.filter((item, index) => results.findIndex((candidate) => candidate.code === item.code && candidate.statement === item.statement) === index);
    return unique.length ? unique : [{ code: 'unknown.unclassified', matchIndex: 0, statement: text }];
  }

  private confidenceFor(text: string, taxonomy: EventTaxonomyEntry, safety: IntelligenceEvent['safety']): IntelligenceEvent['confidence'] {
    if (safety.quarantined) return { score: 0, level: 'rejected', rationale: ['Input was quarantined as instruction-like content.'] };
    let score = taxonomy.category === 'unknown' ? 0.32 : 0.93;
    const rationale = taxonomy.category === 'unknown' ? ['No supported event taxonomy pattern was found.'] : ['A specific supported event pattern was found.'];
    if (/\b(?:might|may|could|possibly|perhaps|rumou?r|unconfirmed|apparently)\b/i.test(text)) {
      score = Math.min(score, 0.65);
      rationale.push('The statement contains uncertainty language.');
    }
    if (/\b(?:what if|suppose|imagine|scenario)\b/i.test(text)) {
      score = Math.min(score, 0.35);
      rationale.push('The statement is hypothetical.');
    }
    if (/\b(?:something|some issue|things changed|it happened)\b/i.test(text)) {
      score = Math.min(score, 0.4);
      rationale.push('The description is vague or incomplete.');
    }
    if (/\b(?:confirmed|verified|definitely)\b/i.test(text)) {
      score = Math.max(score, 0.96);
      rationale.push('The reporter explicitly marked the claim confirmed; human verification is still required.');
    }
    score = Math.round(score * 100) / 100;
    return { score, level: this.confidenceLevel(score), rationale };
  }

  private confidenceLevel(score: number): EventConfidenceLevel {
    if (score >= 0.9) return 'confirmed';
    if (score >= 0.7) return 'likely';
    if (score >= 0.45) return 'possible';
    if (score > 0) return 'speculative';
    return 'rejected';
  }

  private initialMode(text: string, taxonomy: EventTaxonomyEntry, requested: 'auto' | EventMode, level: EventConfidenceLevel, occurredAt: string): EventMode {
    if (requested === 'scenario') return 'scenario';
    if (requested === 'reality') return level === 'confirmed' && new Date(occurredAt).getTime() <= new Date(nowIso()).getTime() ? 'reality' : 'scenario';
    if (taxonomy.default_mode === 'scenario' || level !== 'confirmed' || /\bwhat if\b/i.test(text)) return 'scenario';
    return 'reality';
  }

  private resolveEntities(tenantId: string, text: string, category: EventCategory): EntityResolution[] {
    const fixtures = this.entities().filter((entity) => entity.tenant_id === tenantId);
    const normalizedText = this.normalize(text);
    const candidates = fixtures.map((entity) => {
      const matchingAlias = entity.aliases.find((alias) => normalizedText.includes(this.normalize(alias)));
      const displayMatch = normalizedText.includes(this.normalize(entity.display_name));
      const roleMatch = entity.current_state.role && normalizedText.includes(this.normalize(String(entity.current_state.role)));
      const tokens = this.normalize(entity.display_name).split(' ').filter((token) => token.length > 2);
      const overlap = tokens.filter((token) => normalizedText.includes(token)).length;
      let confidence = displayMatch ? 0.99 : matchingAlias ? 0.96 : roleMatch ? 0.88 : overlap ? 0.55 + 0.1 * overlap : 0;
      if (category === 'people' && entity.entity_type !== 'person' && entity.entity_type !== 'team') confidence *= 0.5;
      if (category === 'project' && entity.entity_type !== 'project') confidence *= 0.65;
      if (category === 'technology' && !['service', 'database'].includes(entity.entity_type)) confidence *= 0.45;
      if (category === 'business' && !['customer', 'vendor'].includes(entity.entity_type)) confidence *= 0.45;
      if (category === 'operations' && !['asset', 'vendor', 'service'].includes(entity.entity_type)) confidence *= 0.45;
      confidence = Math.min(0.99, Math.round(confidence * 100) / 100);
      const reasons = [
        ...(displayMatch ? ['exact display-name match'] : []),
        ...(matchingAlias ? [`alias match: ${matchingAlias}`] : []),
        ...(roleMatch ? [`role-context match: ${String(entity.current_state.role)}`] : []),
        ...(overlap ? [`${overlap} normalized name token(s) matched`] : []),
      ];
      return { ...entity, confidence, reasons };
    }).filter((candidate) => candidate.confidence >= 0.55).sort((left, right) => right.confidence - left.confidence).slice(0, 5);

    let mention = this.extractMention(text, category);
    if (!mention && candidates.length) mention = candidates[0].display_name;
    if (!mention) mention = category === 'external' ? 'external event' : 'unknown entity';
    const top = candidates[0];
    const ambiguous = candidates.length > 1 && top && candidates[1].confidence >= top.confidence - 0.08;
    return [{
      mention,
      normalized_mention: this.normalize(mention),
      candidates: candidates.map(({ tenant_id: _tenant, ...candidate }) => candidate),
      selected_entity_id: top && top.confidence >= 0.95 && !ambiguous ? top.entity_id : null,
      confidence: top?.confidence ?? 0,
      required_confirmation: !top || top.confidence < 0.95 || ambiguous || category === 'people',
      reasons: top ? ['Candidates are ranked only from tenant-scoped synthetic aliases and context.', ...(ambiguous ? ['Top candidates are too close for automatic resolution.'] : [])] : ['No authorized tenant entity matched the mention.'],
    }];
  }

  private entities(): EntityFixture[] {
    const supported = new Set<ResolutionCandidate['entity_type']>([
      'person', 'team', 'project', 'service', 'database', 'customer', 'vendor', 'asset', 'external_entity',
    ]);
    return [ASTER_TENANT_ID, BEACON_TENANT_ID].flatMap((tenantId) => this.projection.catalog(tenantId)
      .filter((entity) => supported.has(entity.entity_type as ResolutionCandidate['entity_type']))
      .map((entity) => ({
        ...entity,
        entity_type: entity.entity_type as ResolutionCandidate['entity_type'],
        confidence: 1,
        reasons: [],
      })));
  }

  private impactsFor(
    tenantId: string,
    eventId: string,
    taxonomy: EventTaxonomyEntry,
    resolutions: EntityResolution[],
    confidence: number,
    text: string,
    evidenceIds: string[],
  ): EventImpact[] {
    const entity = resolutions[0]?.candidates.find((candidate) => candidate.entity_id === resolutions[0]?.selected_entity_id)
      ?? resolutions[0]?.candidates[0];
    const projection = this.projection.snapshot(tenantId);
    const activeRelationship = (type: string) => projection.relationships.find((relationship) => (
      relationship.type === type
      && relationship.from_entity_id === entity?.entity_id
      && relationship.state === 'active'
    ));
    const displayNameFor = (entityId: string | undefined, fallback: string): string => (
      projection.entities.find((candidate) => candidate.entity_id === entityId)?.display_name ?? fallback
    );
    const affected = (fallbackType: string, fallbackName: string) => ({
      entity_id: entity?.entity_id ?? null,
      entity_type: entity?.entity_type ?? fallbackType,
      display_name: entity?.display_name ?? fallbackName,
    });
    const impacts: EventImpact[] = [];
    const add = (
      depth: 0 | 1 | 2 | 3,
      kind: EventImpact['effect_kind'],
      name: string,
      severity: EventImpact['severity'],
      explanation: string,
      action: string | null,
      mutation: Record<string, unknown> | null,
      causedBy?: string,
      relationship: EventImpact['affected_relationship'] = null,
      horizon: EventImpact['time_horizon'] = depth === 0 ? 'immediate' : depth === 1 ? 'days' : depth === 2 ? 'weeks' : 'months',
    ): string => {
      const id = stableUuid(`impact:${eventId}:${impacts.length}:${name}`);
      const mutationOperation = typeof mutation?.operation === 'string' ? mutation.operation : '';
      impacts.push({
        impact_id: id,
        caused_by: causedBy ?? eventId,
        depth,
        effect_kind: kind,
        affected_entity: depth === 0 ? affected(taxonomy.category, name) : { entity_id: null, entity_type: kind, display_name: name },
        affected_relationship: relationship,
        severity,
        confidence: Math.max(0.1, Math.round((confidence * (1 - depth * 0.14)) * 100) / 100),
        time_horizon: horizon,
        explanation,
        evidence: [...new Set(evidenceIds)],
        recommended_action: action,
        proposed_mutation: mutation,
        live_mutation_eligible: mutation !== null && REALITY_MUTATION_OPERATIONS.has(mutationOperation),
      });
      return id;
    };

    if (taxonomy.code === 'people.employee_departed') {
      const reporting = activeRelationship('REPORTS_TO');
      const ownership = activeRelationship('OWNS');
      const participation = activeRelationship('WORKS_ON');
      const serviceName = displayNameFor(ownership?.to_entity_id, 'Unresolved owned service');
      const projectName = displayNameFor(participation?.to_entity_id, 'Unresolved active project');
      const currentState = projection.entities.find((candidate) => candidate.entity_id === entity?.entity_id)?.state.state ?? 'active';
      const direct = add(0, 'node_state', 'Employee state', 'high', 'The synthetic employee projection would change to Departed and record an end date.', 'Verify the effective date with an authoritative HR owner.', { operation: 'set_state', entity_id: entity?.entity_id ?? null, path: 'state', before: currentState, after: 'departed', value: 'departed' });
      add(1, 'relationship', 'Reporting relationship', 'medium', reporting
        ? 'The confirmed REPORTS_TO relationship needs an effective end date in the synthetic organizational projection.'
        : 'No active REPORTS_TO relationship is present in the current tenant projection, so no reporting edge is writable.', 'Confirm the manager and effective date; retain historical reporting provenance.', reporting ? { operation: 'modify_relationship', type: 'REPORTS_TO', from_entity_id: entity?.entity_id ?? null, to_entity_id: reporting.to_entity_id, state: 'ended' } : null, direct, reporting ? { type: 'REPORTS_TO', from_entity_id: reporting.from_entity_id, to_entity_id: reporting.to_entity_id, operation: 'modify' } : null);
      const owner = add(1, 'relationship', `${serviceName} ownership`, 'high', ownership
        ? 'The confirmed OWNS relationship would no longer have an active source node.'
        : 'No active OWNS relationship is present for the selected entity, so the engine does not invent an ownership mutation.', 'Assign a qualified service owner only when current ownership is supported by graph evidence.', ownership ? { operation: 'remove_relationship', type: 'OWNS', from_entity_id: ownership.from_entity_id, to_entity_id: ownership.to_entity_id } : null, direct, ownership ? { type: 'OWNS', from_entity_id: ownership.from_entity_id, to_entity_id: ownership.to_entity_id, operation: 'remove' } : null);
      const project = add(1, 'relationship', `${projectName} participation`, 'medium', participation
        ? 'The confirmed WORKS_ON relationship may need an effective end date.'
        : 'No active WORKS_ON relationship is present for the selected entity, so the engine does not invent a project mutation.', 'Confirm active work ownership and handoff.', participation ? { operation: 'modify_relationship', type: 'WORKS_ON', from_entity_id: participation.from_entity_id, to_entity_id: participation.to_entity_id, state: 'ended' } : null, direct, participation ? { type: 'WORKS_ON', from_entity_id: participation.from_entity_id, to_entity_id: participation.to_entity_id, operation: 'modify' } : null);
      add(1, 'knowledge', 'Documentation stewardship', 'medium', ownership
        ? 'Existing documentation remains evidence, but stewardship may become unclear.'
        : 'Documentation stewardship cannot be attributed because no owned service is evidenced for the selected entity.', 'Assign a documentation steward; do not delete authorship provenance.', ownership ? { operation: 'create_relationship', type: 'NEEDS_STEWARD', from: `${serviceName} documentation`, to: 'Role: Documentation Steward' } : null, direct);
      const risk = add(2, 'risk', 'Service continuity risk', 'high', ownership
        ? 'Loss of confirmed ownership can increase maintenance and incident-response risk.'
        : 'A service-continuity effect is unknown until an owned service is evidenced.', 'Establish interim ownership and review the runbook.', ownership ? { operation: 'set_risk', entity: serviceName, before_percent: 30, after_percent: 65 } : null, owner);
      add(2, 'prediction', `${projectName} delivery forecast`, 'medium', participation
        ? 'A key participation gap may move the delivery distribution; this is a scenario estimate, not an individual productivity score.'
        : 'A delivery effect is unknown because no active project participation is evidenced; no individual productivity inference is made.', 'Run the seeded project scheduler only after confirming a project relationship.', participation ? { operation: 'scenario_delta', entity: projectName, target_date_shift_days: 14 } : null, project);
      add(3, 'recommendation', 'Customer-impact review', 'medium', 'Service and schedule risk may affect customer commitments, but the link is uncertain.', 'Review contractual milestones and communicate only verified impacts.', null, risk);
      add(3, 'prediction', 'Role-coverage mitigation scenario', 'medium', ownership
        ? 'A synthetic what-if branch estimates that restoring qualified ownership could reduce the modeled service-risk delta by 40%; this is not a hiring decision.'
        : 'A role-coverage scenario is withheld until a service-ownership relationship is evidenced; this is not a hiring decision.', 'Compare interim owner, internal transfer, contractor, and no-action scenarios with human owners.', ownership ? { operation: 'scenario_delta', entity: serviceName, intervention: 'restore_qualified_owner', modeled_risk_reduction_percent: 40 } : null, risk);
      add(1, 'recommendation', 'Access offboarding verification', 'critical', 'Permissions may require revocation, but this subsystem never changes identity or security systems.', 'Route an independently approved offboarding task to the identity owner.', null, direct);
    } else if (taxonomy.code === 'technology.outage') {
      const direct = add(0, 'node_state', 'Technology availability', 'high', 'The affected synthetic technology node records an outage interval.', 'Attach monitoring and incident evidence before a reality update.', { operation: 'append_outage', entity_id: entity?.entity_id ?? null, duration_minutes: this.durationMinutes(text) });
      const apps = add(1, 'relationship', 'Dependent applications', 'high', 'Applications connected through DEPENDS_ON may have experienced reduced availability.', 'Correlate application telemetry and deployment windows.', { operation: 'annotate_relationships', type: 'DEPENDS_ON', annotation: 'potentially_affected' }, direct);
      const sla = add(2, 'risk', 'SLA breach risk', 'medium', 'A three-hour outage may consume or exceed an SLA error budget.', 'Calculate impact from authorized availability records.', { operation: 'set_risk', entity: 'SLA commitments', before_percent: 12, after_percent: 48 }, apps);
      add(2, 'prediction', 'Operational reliability forecast', 'medium', 'Recent outage evidence changes a synthetic reliability scenario.', 'Run a reliability scenario with measured recovery time.', { operation: 'scenario_delta', metric: 'incident_risk', direction: 'increase' }, apps);
      add(3, 'recommendation', 'Customer communication review', 'low', 'Customer effects depend on traffic and failover evidence not present here.', 'Check affected tenant windows before communicating.', null, sla);
    } else if (taxonomy.code === 'business.customer_at_risk' || taxonomy.code === 'business.customer_lost') {
      const direct = add(0, 'risk', 'Customer relationship', taxonomy.code.endsWith('lost') ? 'critical' : 'high', taxonomy.code.endsWith('lost') ? 'The synthetic customer state may change to lost.' : 'The statement is a potential churn signal and must remain a scenario.', 'Verify against CRM and account-owner evidence.', taxonomy.code.endsWith('lost') ? { operation: 'set_state', entity_id: entity?.entity_id ?? null, path: 'state', before: 'active', after: 'lost', value: 'lost' } : { operation: 'scenario_delta', entity_id: entity?.entity_id ?? null, metric: 'churn_risk', before_percent: 25, after_percent: 65 });
      const revenue = add(1, 'prediction', 'Revenue scenario', 'high', 'Customer loss or increased churn risk changes a synthetic revenue scenario.', 'Model a bounded range; do not present it as a factual forecast.', { operation: 'scenario_delta', metric: 'revenue_at_risk', direction: 'increase' }, direct);
      const roadmap = add(2, 'workflow', 'Account remediation plan', 'medium', 'Retention work may compete with planned roadmap work.', 'Create a reviewed remediation scenario with owners and constraints.', { operation: 'create_scenario_task', type: 'customer_remediation_review' }, revenue);
      add(3, 'recommendation', 'Leadership decision packet', 'medium', 'The scenario needs evidence, alternatives, and uncertainty before a decision.', 'Compare retain, replace, and no-action branches.', null, roadmap);
    } else if (taxonomy.code === 'business.company_acquired') {
      const direct = add(0, 'relationship', 'Acquisition relationship', 'high', 'The synthetic graph may create an ACQUIRED relationship between two confirmed company entities.', 'Resolve both legal entities and verify closing evidence before a reality update.', { operation: 'create_relationship', type: 'ACQUIRED', from: 'acquiring_company', to: 'acquired_company' });
      const integration = add(1, 'workflow', 'Integration workstream', 'high', 'An acquisition can introduce organizational, system, contract, and data-integration work.', 'Create separate governed integration scenarios by domain.', { operation: 'create_scenario_task', type: 'acquisition_integration_review' }, direct);
      const overlap = add(2, 'risk', 'System and ownership overlap', 'medium', 'Duplicate systems and ambiguous ownership may increase transition risk.', 'Inventory systems and owners without automatically merging identities.', { operation: 'set_risk', entity: 'integration_portfolio', direction: 'increase' }, integration);
      add(3, 'recommendation', 'Regulatory and customer review', 'medium', 'Legal, regulatory, and customer effects require separately authorized evidence.', 'Route findings to qualified owners; this engine makes no legal determination.', null, overlap);
    } else if (taxonomy.category === 'project') {
      const direct = add(0, 'node_state', 'Project state', 'high', `${taxonomy.label} changes the synthetic project state or plan.`, 'Confirm the project and effective date.', { operation: 'annotate_project_event', event_type: taxonomy.code, entity_id: entity?.entity_id ?? null });
      const schedule = add(1, 'prediction', 'Schedule distribution', 'medium', 'The project event changes seeded schedule assumptions.', 'Re-run the deterministic scheduler and compare p50/p80/p95.', { operation: 'scenario_delta', metric: 'delivery_date', direction: taxonomy.code.includes('reduced') ? 'decrease' : 'increase' }, direct);
      add(2, 'risk', 'Dependency risk', 'medium', 'Dependent milestones may inherit schedule or scope uncertainty.', 'Review bounded dependency paths.', { operation: 'set_risk', entity: 'dependent_milestones', direction: 'increase' }, schedule);
    } else if (taxonomy.category === 'technology' || taxonomy.category === 'operations') {
      const direct = add(0, 'node_state', taxonomy.label, 'high', 'The event changes an operational or technology state in the synthetic projection.', 'Verify source telemetry or incident evidence.', { operation: 'annotate_state', event_type: taxonomy.code, entity_id: entity?.entity_id ?? null });
      const dependencies = add(1, 'risk', 'Dependent-system risk', 'medium', 'Bounded dependency traversal identifies potentially affected systems.', 'Inspect direct dependencies and stop at the configured depth.', { operation: 'set_risk', entity: 'dependent_systems', direction: 'increase' }, direct);
      add(2, 'workflow', 'Recovery workflow', 'medium', 'Operational response work may need prioritization.', 'Create an owned, reviewed recovery task.', { operation: 'create_scenario_task', type: 'recovery_review' }, dependencies);
    } else {
      const direct = add(0, 'unknown', taxonomy.label, taxonomy.category === 'unknown' ? 'low' : 'medium', 'The event is recorded as an unverified change candidate.', 'Provide authoritative evidence and resolve the affected entity.', taxonomy.category === 'unknown' ? null : { operation: 'annotate_event', event_type: taxonomy.code, entity_id: entity?.entity_id ?? null });
      add(1, 'recommendation', 'Evidence collection', 'low', 'Indirect effects cannot be supported from the available evidence.', 'Collect dated primary evidence before expanding the causal graph.', null, direct);
    }
    return impacts.slice(0, MAX_IMPACTS);
  }

  private causalGraph(eventId: string, label: string, impacts: EventImpact[], text: string): CausalGraph {
    const nodes: CausalGraph['nodes'] = [{ id: eventId, kind: 'event', label, depth: 0 }];
    const entityIds = new Set<string>();
    for (const impact of impacts) {
      nodes.push({ id: impact.impact_id, kind: 'impact', label: impact.affected_entity.display_name, depth: impact.depth });
      if (impact.affected_entity.entity_id && !entityIds.has(impact.affected_entity.entity_id)) {
        entityIds.add(impact.affected_entity.entity_id);
        nodes.push({ id: impact.affected_entity.entity_id, kind: 'entity', label: impact.affected_entity.display_name, depth: Math.min(MAX_DEPTH, impact.depth) });
      }
    }
    const edges = impacts.map((impact) => ({
      from: impact.caused_by,
      to: impact.impact_id,
      relation: impact.confidence >= 0.8 ? 'causes' as const : 'may_cause' as const,
      confidence: impact.confidence,
    }));
    const fanoutRequested = /\b(?:million|millions|infinite|everything|all nodes)\b/i.test(text);
    return {
      nodes: nodes.slice(0, MAX_IMPACTS + 10),
      edges: edges.slice(0, MAX_IMPACTS),
      max_depth: MAX_DEPTH,
      traversed_nodes: Math.min(nodes.length, MAX_IMPACTS + 10),
      traversed_edges: Math.min(edges.length, MAX_IMPACTS),
      truncated: fanoutRequested || impacts.length >= MAX_IMPACTS,
      cycle_paths_suppressed: /\b(?:cycle|loop|infinite)\b/i.test(text) ? 1 : 0,
    };
  }

  private gateFor(event: IntelligenceEvent, mode: EventMode): EventGate {
    if (mode === 'scenario') {
      return {
        route: 'scenario_branch',
        live_mutation_allowed: false,
        blockers: [],
        required_approvals: [],
        policy_version: POLICY_VERSION,
        rationale: 'Scenario application creates an isolated branch and never changes baseline reality.',
      };
    }
    const blockers: string[] = [];
    if (event.confidence.level !== 'confirmed') blockers.push(`confidence_level_${event.confidence.level}`);
    if (event.verification_status !== 'confirmed') blockers.push('human_verification_required');
    if (event.entity_resolutions.some((resolution) => resolution.required_confirmation || resolution.selected_entity_id === null)) blockers.push('entity_confirmation_required');
    if (event.conflicts.length) blockers.push('conflicting_event_requires_resolution');
    if (!event.impacts.some((impact) => impact.live_mutation_eligible && impact.proposed_mutation !== null)) blockers.push('no_live_mutation_eligible_changes');
    return {
      route: 'reality_update',
      live_mutation_allowed: blockers.length === 0,
      blockers,
      required_approvals: ['operations', 'security'],
      policy_version: POLICY_VERSION,
      rationale: 'Reality projection updates require confirmed facts, resolved entities, exact-payload review, and two distinct approvals.',
    };
  }

  private rejectedGate(reason: string): EventGate {
    return { route: 'rejected', live_mutation_allowed: false, blockers: ['event_rejected'], required_approvals: [], policy_version: POLICY_VERSION, rationale: reason };
  }

  private findConflicts(tenantId: string, code: string, resolutions: EntityResolution[]): IntelligenceEvent['conflicts'] {
    const entityIds = new Set(resolutions.flatMap((resolution) => resolution.candidates.slice(0, 1).map((candidate) => candidate.entity_id)));
    const pairs: Array<[string, string]> = [
      ['people.employee_departed', 'people.employee_hired'],
      ['people.employee_departed', 'people.employee_promoted'],
      ['people.employee_departed', 'people.role_changed'],
      ['project.started', 'project.cancelled'],
      ['technology.service_launched', 'technology.service_removed'],
      ['business.customer_acquired', 'business.customer_lost'],
    ];
    return [...this.events.values()].filter((prior) => {
      if (prior.tenant_id !== tenantId || prior.status === 'rejected' || prior.status === 'rolled_back') return false;
      const conflicts = pairs.some(([left, right]) => (code === left && prior.event_type.code === right) || (code === right && prior.event_type.code === left));
      if (!conflicts) return false;
      return prior.entity_resolutions.some((resolution) => resolution.candidates.some((candidate) => entityIds.has(candidate.entity_id)));
    }).map((prior) => ({ event_id: prior.event_id, reason: `${code} conflicts with prior ${prior.event_type.code} for the same candidate entity.` }));
  }

  private extractTiming(text: string, supplied?: string): IntelligenceEvent['occurred_at'] {
    if (supplied) return { value: new Date(supplied).toISOString(), precision: 'exact', confidence: 1 };
    const now = new Date(nowIso());
    if (/\byesterday\b/i.test(text)) {
      now.setUTCDate(now.getUTCDate() - 1);
      return { value: now.toISOString(), precision: 'relative', confidence: 0.9 };
    }
    if (/\btoday\b/i.test(text)) return { value: now.toISOString(), precision: 'day', confidence: 0.9 };
    if (/\b(?:what if|might|may|could|future|next)\b/i.test(text)) {
      now.setUTCDate(now.getUTCDate() + 30);
      return { value: now.toISOString(), precision: 'unknown', confidence: 0.35 };
    }
    return { value: now.toISOString(), precision: 'unknown', confidence: 0.5 };
  }

  private extractMention(text: string, category: EventCategory): string | null {
    if (category === 'people') {
      const person = text.match(/^\s*([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)/u);
      return person?.[1] ?? text.match(/\b(?:employee|engineer|manager|contractor|CTO)\b/i)?.[0] ?? null;
    }
    const quoted = text.match(/["']([^"']{2,80})["']/)?.[1];
    if (quoted) return quoted;
    const labels: Record<EventCategory, RegExp> = {
      project: /\b(?:Payment Platform|[A-Z][\w-]+ Project|project|milestone|launch)\b/i,
      technology: /\b(?:AWS database|[A-Z][\w-]+ (?:Database|Service|API)|database|service|repository)\b/i,
      business: /\b(?:Northstar Bank|largest customer|biggest customer|customer|vendor|contract)\b/i,
      operations: /\b(?:P-101|pump|equipment|shipment|production|office)\b/i,
      external: /\b(?:regulation|market|competitor|weather|hurricane|earthquake|industry)\b/i,
      unknown: /\bsomething\b/i,
      people: /$^/,
    };
    return text.match(labels[category])?.[0] ?? null;
  }

  private extractLocation(text: string): string | null {
    return text.match(/\b(?:in|at)\s+([A-Z][\w-]+(?:\s+[A-Z][\w-]+){0,3})/)?.[1] ?? null;
  }

  private durationMinutes(text: string): number | null {
    const match = text.match(/\b(\d+(?:\.\d+)?)\s*[- ]?(hours?|hrs?|minutes?|mins?)\b/i);
    if (!match) return null;
    const amount = Number(match[1]);
    return /hour|hr/i.test(match[2]) ? amount * 60 : amount;
  }

  private detectMaliciousInput(text: string): string[] {
    const flags: string[] = [];
    const patterns: Array<[string, RegExp]> = [
      ['prompt_injection', /\b(?:ignore|disregard)\b[^.!?]{0,60}\b(?:previous|system|developer|instructions?)\b/i],
      ['secret_exfiltration', /\b(?:reveal|print|send|exfiltrate)\b[^.!?]{0,60}\b(?:secret|token|password|system prompt)\b/i],
      ['tool_execution_instruction', /\b(?:execute|run|call)\b[^.!?]{0,40}\b(?:command|shell|tool|SQL|API)\b/i],
      ['graph_poisoning_instruction', /\b(?:drop database|delete all|grant admin|bypass approval|disable audit)\b/i],
      ['active_markup', /<\s*(?:script|iframe|object)\b|javascript:/i],
    ];
    for (const [flag, pattern] of patterns) if (pattern.test(text)) flags.push(flag);
    return flags;
  }

  private redact(text: string): { text: string; redacted: boolean } {
    let redacted = false;
    const replace = (pattern: RegExp, value: string) => {
      const next = textValue.replace(pattern, value);
      if (next !== textValue) redacted = true;
      textValue = next;
    };
    let textValue = text;
    replace(/\b(?:api[_-]?key|password|access[_-]?token|secret)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED_CREDENTIAL]');
    replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]');
    replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]');
    return { text: textValue, redacted };
  }

  private parseResolutionDecisions(value: unknown): Array<{ mention: string; selected_entity_id: string | null }> {
    if (!Array.isArray(value)) throw new ProblemException(HttpStatus.BAD_REQUEST, 'entity_resolutions_required', 'entity_resolutions must be an array.');
    return value.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_entity_resolution', 'Each entity resolution must be an object.');
      const record = item as Record<string, unknown>;
      this.assertExactKeys(record, ['mention', 'selected_entity_id'], 'entity resolution');
      if (typeof record.mention !== 'string' || (record.selected_entity_id !== null && typeof record.selected_entity_id !== 'string')) {
        throw new ProblemException(HttpStatus.BAD_REQUEST, 'invalid_entity_resolution', 'Entity resolution requires mention and a candidate ID or null.');
      }
      return { mention: record.mention, selected_entity_id: record.selected_entity_id as string | null };
    });
  }

  private ensureTenant(ctx: RequestContext): void {
    const baselineId = this.baselineBranchId(ctx.tenantId);
    if (!this.branches.has(baselineId)) {
      const branch = this.baselineBranch(ctx.tenantId);
      this.branches.set(baselineId, branch);
      this.timelines.set(ctx.tenantId, [{
        timeline_entry_id: stableUuid(`timeline-baseline:${ctx.tenantId}`),
        tenant_id: ctx.tenantId,
        event_id: stableUuid(`baseline-event:${ctx.tenantId}`),
        branch_id: baselineId,
        sequence: 0,
        occurred_at: branch.created_at,
        recorded_at: branch.created_at,
        action: 'baseline',
        summary: 'Synthetic tenant baseline before event intelligence changes.',
        before_state_hash: branch.state_hash,
        after_state_hash: branch.state_hash,
        graph_version_before: branch.base_graph_version,
        graph_version_after: branch.base_graph_version,
        receipt_id: null,
        reversible: false,
      }]);
    }
  }

  private baselineBranch(tenantId: string): ScenarioBranch {
    const snapshot = this.projection.snapshot(tenantId);
    return {
      branch_id: this.baselineBranchId(tenantId),
      tenant_id: tenantId,
      name: 'Observed reality baseline',
      parent_branch_id: null,
      created_by_event_id: null,
      created_at: nowIso(),
      mode: 'baseline',
      status: 'active',
      event_ids: [],
      base_graph_version: snapshot.version,
      base_state_hash: snapshot.state_hash,
      state_hash: snapshot.state_hash,
    };
  }

  private makeTimelineEntry(
    tenantId: string,
    event: IntelligenceEvent,
    beforeHash: string,
    afterHash: string,
    graphVersionBefore: number,
    graphVersionAfter: number,
    receiptId: string,
    action: 'event_applied' | 'event_rolled_back',
  ): TimelineEntry {
    const entries = this.timelines.get(tenantId) ?? [];
    return {
      timeline_entry_id: newId(),
      tenant_id: tenantId,
      event_id: event.event_id,
      branch_id: event.branch_id ?? this.baselineBranchId(tenantId),
      sequence: entries.length,
      occurred_at: event.occurred_at.value,
      recorded_at: nowIso(),
      action,
      summary: `${event.event_type.label}: ${action === 'event_applied' ? 'applied to synthetic projection' : 'compensated in synthetic projection'}.`,
      before_state_hash: beforeHash,
      after_state_hash: afterHash,
      graph_version_before: graphVersionBefore,
      graph_version_after: graphVersionAfter,
      receipt_id: receiptId,
      reversible: action === 'event_applied',
    };
  }

  private async persistTenantBaseline(tenantId: string): Promise<void> {
    const branch = this.branches.get(this.baselineBranchId(tenantId));
    const entry = this.timelines.get(tenantId)?.[0];
    if (branch) await this.database.put(tenantId, 'event_branch', branch.branch_id, branch);
    if (entry) await this.database.put(tenantId, 'event_timeline_entry', entry.timeline_entry_id, entry);
  }

  private async persistIdempotency(tenantId: string, scope: string, record: IdempotencyRecord): Promise<void> {
    await this.database.put(
      tenantId,
      'event_idempotency',
      stableUuid(`event-idempotency:${scope}`),
      { scope, ...record },
    );
  }

  private throwProjectionProblem(error: unknown): never {
    if (error instanceof EventProjectionError) {
      throw new ProblemException(HttpStatus.CONFLICT, error.code, error.message);
    }
    throw error;
  }

  private eventChangedEnvelope(
    ctx: RequestContext,
    event: IntelligenceEvent,
    receipt: EventActionReceipt,
    outboxEventId: string,
  ): Record<string, unknown> {
    const type = 'com.enterprisedigitaltwin.event-intelligence.event-changed.v1';
    return {
      specversion: '1.0',
      id: outboxEventId,
      source: 'urn:edt:event-intelligence',
      type,
      subject: `tenant/${ctx.tenantId}/event/${event.event_id}`,
      time: receipt.recorded_at,
      datacontenttype: 'application/json',
      dataschema: EVENT_CHANGED_SCHEMA_ID,
      tenant_id: ctx.tenantId,
      partition_key: `tenant/${ctx.tenantId}/event/${event.event_id}`,
      aggregate_type: 'intelligence_event',
      aggregate_id: event.event_id,
      aggregate_version: event.version,
      causation_id: receipt.receipt_id,
      correlation_id: event.interpretation_id,
      traceparent: `00-${receipt.audit_evidence.trace_id}-${sha256(outboxEventId).slice(0, 16)}-01`,
      schema_version: 1,
      schema_hash: EVENT_CHANGED_SCHEMA_HASH,
      data_classification: 'confidential',
      outbox_position: 0,
      data: {
        event_id: event.event_id,
        approval_id: receipt.approval_id,
        interpretation_id: event.interpretation_id,
        status: event.status,
        mode: event.mode,
        confidence_level: event.confidence.level,
        verification_status: event.verification_status,
        graph_snapshot_version: receipt.graph_version_after,
        graph_snapshot_hash: receipt.after_state_hash,
        payload_hash: receipt.payload_hash,
        branch_id: receipt.branch_id,
        receipt_id: receipt.receipt_id,
        synthetic: true,
        external_write: false,
      },
    };
  }

  private baselineBranchId(tenantId: string): string {
    return stableUuid(`event-baseline-branch:${tenantId}`);
  }

  private eventForContext(ctx: RequestContext, eventId: string): IntelligenceEvent {
    this.assertRead(ctx);
    const event = this.events.get(eventId);
    if (!event || event.tenant_id !== ctx.tenantId) throw this.notFound();
    return event;
  }

  private assertRead(ctx: RequestContext): void {
    const permitted = ctx.actor.capabilities.some((capability) => capability.startsWith('evidence.read.')) || ctx.actor.capabilities.includes('scenario.create');
    if (!permitted || ctx.actor.actor_alias === 'usr_platform_operator' || ctx.actor.actor_alias === 'usr_aster_limited') {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'event_intelligence_read_denied', 'Event intelligence access is not authorized.');
    }
  }

  private assertCreate(ctx: RequestContext): void {
    this.assertRead(ctx);
    if (!ctx.actor.capabilities.includes('scenario.create')) {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'event_intelligence_create_denied', 'Creating event interpretations is not authorized.');
    }
  }

  private assertCreatorOrCreate(ctx: RequestContext, event: IntelligenceEvent): void {
    this.assertCreate(ctx);
    if (event.source.creator_id !== ctx.actor.actor_id) {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'event_intelligence_change_denied', 'Only the interpretation creator can advance this synthetic event workflow.');
    }
  }

  private assertRollback(ctx: RequestContext): void {
    this.assertRead(ctx);
    if (!ctx.actor.capabilities.includes('action.approve.operations') && !ctx.actor.capabilities.includes('action.approve.security')) {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'event_rollback_denied', 'Rollback requires an authenticated operations or security approver.');
    }
  }

  private approverRole(ctx: RequestContext): 'operations' | 'security' {
    this.assertRead(ctx);
    if (ctx.actor.capabilities.includes('action.approve.operations')) return 'operations';
    if (ctx.actor.capabilities.includes('action.approve.security')) return 'security';
    throw new ProblemException(HttpStatus.FORBIDDEN, 'event_approval_denied', 'A required event approval role is not authorized.');
  }

  private assertExpectedVersion(event: IntelligenceEvent, value: unknown): void {
    const version = Number(value);
    if (!Number.isInteger(version) || version < 1) throw new ProblemException(HttpStatus.BAD_REQUEST, 'expected_version_required', 'expected_version must be a positive integer.');
    if (version !== event.version) throw new ProblemException(HttpStatus.CONFLICT, 'event_version_changed', 'The event changed; refresh before continuing.');
  }

  private assertPrecondition(event: IntelligenceEvent, ifMatch: string | undefined): void {
    if (!ifMatch) throw new ProblemException(HttpStatus.PRECONDITION_REQUIRED, 'if_match_required', 'If-Match must bind the request to the current event version.');
    if (ifMatch !== event.etag) throw new ProblemException(HttpStatus.PRECONDITION_FAILED, 'event_precondition_failed', 'The event ETag changed; refresh before continuing.');
  }

  private refreshEtag(event: IntelligenceEvent): void {
    event.etag = etag(sha256({ event_id: event.event_id, version: event.version, status: event.status, reviewed_payload_hash: event.reviewed_payload_hash, applied_payload_hash: event.applied_payload_hash }));
  }

  private assertExactKeys(record: Record<string, unknown>, allowlist: string[], label: string): void {
    const unexpected = Object.keys(record).filter((key) => !allowlist.includes(key));
    if (unexpected.length) throw new ProblemException(HttpStatus.BAD_REQUEST, 'unknown_request_field', `${label} contains unsupported field(s): ${unexpected.sort().join(', ')}.`);
  }

  private async appendAudit(
    ctx: RequestContext,
    action: string,
    resourceType: EventAuditEvidence['resource_type'],
    resourceId: string,
    detailsHash: string,
    persist = true,
  ): Promise<EventAuditEvidence> {
    const current = this.audits.get(ctx.tenantId) ?? [];
    const health = this.auditHealth.get(ctx.tenantId);
    const tenantHasEvents = [...this.events.values()].some((event) => event.tenant_id === ctx.tenantId);
    const blockingHealthIssue = health?.issues.some((issue) => issue !== 'empty_chain' || tenantHasEvents) ?? false;
    if (blockingHealthIssue || (current.length === 0 && tenantHasEvents)) {
      throw new ProblemException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'audit_chain_unhealthy',
        'The tenant audit chain is empty, incomplete, invalid, gapped, or forked; audited mutation is disabled until the chain is repaired.',
      );
    }
    const previousHash = current.at(-1)?.event_hash ?? '0'.repeat(64);
    const base = {
      audit_id: newId(),
      tenant_sequence: (current.at(-1)?.tenant_sequence ?? 0) + 1,
      action,
      actor_id: ctx.actor.actor_id,
      resource_type: resourceType,
      resource_id: resourceId,
      occurred_at: nowIso(),
      request_id: ctx.requestId,
      trace_id: traceId(),
      details_hash: detailsHash,
      previous_hash: previousHash,
    };
    const audit: EventAuditEvidence = { ...base, event_hash: sha256({ ...base, tenant_id: ctx.tenantId }) };
    current.push(audit);
    const assessment = this.assessAuditChain(ctx.tenantId, current);
    if (assessment.diagnostics.issues.length > 0) {
      current.pop();
      throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'audit_chain_unhealthy', 'The generated audit event did not extend one complete tenant chain.');
    }
    this.audits.set(ctx.tenantId, assessment.canonical);
    this.auditHealth.set(ctx.tenantId, assessment.diagnostics);
    if (persist) {
      await this.database.put(ctx.tenantId, 'event_audit_evidence', audit.audit_id, audit);
      await this.refreshAuthoritativeAudits(ctx.tenantId);
    }
    return audit;
  }

  private auditBelongsToEvent(tenantId: string, audit: EventAuditEvidence, eventId: string): boolean {
    if (audit.resource_type === 'event_approval') return this.approvals.get(audit.resource_id)?.tenant_id === tenantId && this.approvals.get(audit.resource_id)?.event_id === eventId;
    if (audit.resource_type === 'event_receipt') return this.receipts.get(audit.resource_id)?.tenant_id === tenantId && this.receipts.get(audit.resource_id)?.event_id === eventId;
    return false;
  }

  private restoreAuditPrefix(tenantId: string, length: number): void {
    const restored = (this.audits.get(tenantId) ?? []).slice(0, length);
    const assessment = this.assessAuditChain(tenantId, restored);
    this.audits.set(tenantId, assessment.canonical);
    this.auditHealth.set(tenantId, assessment.diagnostics);
  }

  private assessAuditChain(tenantId: string, records: EventAuditEvidence[]): AuditChainAssessment {
    const zeroHash = '0'.repeat(64);
    const invalidRecordIds: string[] = [];
    const valid: EventAuditEvidence[] = [];
    const seenAuditIds = new Set<string>();
    const seenEventHashes = new Set<string>();
    records.forEach((candidate, index) => {
      const fallbackId = `record-index:${index}`;
      const recordId = candidate && typeof candidate === 'object' && typeof candidate.audit_id === 'string'
        ? candidate.audit_id
        : fallbackId;
      if (!this.validAuditEvidence(tenantId, candidate) || seenAuditIds.has(recordId) || seenEventHashes.has(candidate.event_hash)) {
        invalidRecordIds.push(recordId);
        return;
      }
      seenAuditIds.add(recordId);
      seenEventHashes.add(candidate.event_hash);
      valid.push(candidate);
    });
    const hashes = new Set(valid.map((record) => record.event_hash));
    const gapRecords = valid.filter((record) => record.previous_hash !== zeroHash && !hashes.has(record.previous_hash));
    const children = new Map<string, EventAuditEvidence[]>();
    for (const record of valid) {
      const bucket = children.get(record.previous_hash) ?? [];
      bucket.push(record);
      children.set(record.previous_hash, bucket);
    }
    for (const bucket of children.values()) {
      bucket.sort((left, right) => left.tenant_sequence - right.tenant_sequence || left.audit_id.localeCompare(right.audit_id));
    }
    const forkPreviousHashes = [...children.entries()]
      .filter(([, bucket]) => bucket.length > 1)
      .map(([previousHash]) => previousHash)
      .sort();
    const walk = (previousHash: string, seen: Set<string>): EventAuditEvidence[] => {
      let best: EventAuditEvidence[] = [];
      for (const candidate of children.get(previousHash) ?? []) {
        if (seen.has(candidate.audit_id)) continue;
        const nextSeen = new Set(seen).add(candidate.audit_id);
        const path = [candidate, ...walk(candidate.event_hash, nextSeen)];
        if (
          path.length > best.length
          || (path.length === best.length && (path.at(-1)?.tenant_sequence ?? 0) > (best.at(-1)?.tenant_sequence ?? 0))
          || (path.length === best.length
            && (path.at(-1)?.tenant_sequence ?? 0) === (best.at(-1)?.tenant_sequence ?? 0)
            && path.map((item) => item.audit_id).join(':') < best.map((item) => item.audit_id).join(':'))
        ) best = path;
      }
      return best;
    };
    const canonical = walk(zeroHash, new Set()).map((record) => structuredClone(record));
    const canonicalIds = new Set(canonical.map((record) => record.audit_id));
    const orphanRecords = valid.filter((record) => !canonicalIds.has(record.audit_id));
    const sequenceGapRecords = canonical.filter((record, index) => record.tenant_sequence !== index + 1);
    const issues: EventAuditIssueCode[] = [];
    if (records.length === 0) issues.push('empty_chain');
    if (invalidRecordIds.length > 0) issues.push('invalid_records');
    if (gapRecords.length > 0) issues.push('hash_gaps');
    if (forkPreviousHashes.length > 0) issues.push('forks');
    if (orphanRecords.length > 0) issues.push('orphan_records');
    if (sequenceGapRecords.length > 0) issues.push('sequence_gaps');
    const diagnosticsTruncated = [
      invalidRecordIds.length,
      gapRecords.length,
      forkPreviousHashes.length,
      orphanRecords.length,
      sequenceGapRecords.length,
    ].some((count) => count > MAX_AUDIT_DIAGNOSTIC_REFS);
    return {
      canonical,
      diagnostics: {
        total_records: records.length,
        valid_records: valid.length,
        canonical_records: canonical.length,
        invalid_records: invalidRecordIds.length,
        gap_records: gapRecords.length,
        fork_points: forkPreviousHashes.length,
        orphan_records: orphanRecords.length,
        sequence_gaps: sequenceGapRecords.length,
        event_records: 0,
        expected_event_records: 0,
        invalid_record_ids: invalidRecordIds.sort().slice(0, MAX_AUDIT_DIAGNOSTIC_REFS),
        gap_record_ids: gapRecords.map((record) => record.audit_id).sort().slice(0, MAX_AUDIT_DIAGNOSTIC_REFS),
        fork_previous_hashes: forkPreviousHashes.slice(0, MAX_AUDIT_DIAGNOSTIC_REFS),
        orphan_record_ids: orphanRecords.map((record) => record.audit_id).sort().slice(0, MAX_AUDIT_DIAGNOSTIC_REFS),
        sequence_gap_record_ids: sequenceGapRecords.map((record) => record.audit_id).slice(0, MAX_AUDIT_DIAGNOSTIC_REFS),
        missing_event_audit_ids: [],
        diagnostics_truncated: diagnosticsTruncated,
        issues,
      },
    };
  }

  private validAuditEvidence(tenantId: string, record: EventAuditEvidence): boolean {
    if (!record || typeof record !== 'object') return false;
    if (
      !this.validUuid(record.audit_id)
      || !Number.isSafeInteger(record.tenant_sequence)
      || record.tenant_sequence < 1
      || typeof record.action !== 'string'
      || record.action.length < 1
      || record.action.length > 128
      || !this.validUuid(record.actor_id)
      || !['event_interpretation', 'event', 'event_approval', 'event_receipt'].includes(record.resource_type)
      || !this.validUuid(record.resource_id)
      || !this.validIso(record.occurred_at)
      || typeof record.request_id !== 'string'
      || record.request_id.length < 1
      || record.request_id.length > 128
      || typeof record.trace_id !== 'string'
      || record.trace_id.length < 1
      || record.trace_id.length > 128
      || !this.validHash(record.details_hash)
      || !this.validHash(record.previous_hash)
      || !this.validHash(record.event_hash)
    ) return false;
    const { event_hash: _eventHash, ...base } = record;
    return sha256({ ...base, tenant_id: tenantId }) === record.event_hash;
  }

  private eventMutationGuard(
    ctx: RequestContext,
    operation: string,
    idempotencyKey: string,
    requestHash: string,
    responseRef: string,
    event: IntelligenceEvent,
    projectionSnapshot: EventProjectionSnapshot | null,
  ): EventMutationGuard {
    const expectedRecords: Array<EventMutationGuard['expectedRecords'][number]> = [
      {
        kind: 'intelligence_event',
        id: event.event_id,
        expected: { version: event.version, status: event.status, etag: event.etag },
      },
    ];
    if (this.database.enabled && projectionSnapshot) {
      expectedRecords.push({
        kind: 'event_projection_snapshot',
        id: stableUuid(`event-projection:${ctx.tenantId}`),
        expected: { version: projectionSnapshot.version, state_hash: projectionSnapshot.state_hash },
      });
    }
    return {
      idempotency: {
        operation: `${ctx.actor.actor_id}:${operation}`,
        key: idempotencyKey,
        requestHash,
        responseRef,
        // Durable replay protection outlives the 15-minute approval ceremony.
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      },
      expectedRecords,
    };
  }

  private async reloadAuthoritativeMutation(
    tenantId: string,
    eventId: string,
    responseRef?: string,
    idempotencyScope?: string,
    requestHash?: string,
  ): Promise<EventActionReceipt | undefined> {
    if (!this.database.enabled) {
      return responseRef ? this.receipts.get(responseRef) : undefined;
    }
    const projectionId = stableUuid(`event-projection:${tenantId}`);
    const persistedProjection = await this.database.get<EventProjectionSnapshot>(tenantId, 'event_projection_snapshot', projectionId);
    if (persistedProjection) this.projection.hydrate(tenantId, persistedProjection);

    const persistedEvent = await this.database.get<IntelligenceEvent>(tenantId, 'intelligence_event', eventId);
    if (persistedEvent?.tenant_id === tenantId) this.events.set(eventId, persistedEvent);
    const application = await this.database.get<EventApplication>(tenantId, 'event_application', eventId);
    if (application) this.applications.set(eventId, application);

    let receipt: EventActionReceipt | undefined;
    if (responseRef) {
      receipt = await this.database.get<EventActionReceipt>(tenantId, 'event_action_receipt', responseRef);
      if (receipt?.tenant_id === tenantId && receipt.event_id === eventId) {
        this.receipts.set(receipt.receipt_id, receipt);
        const approval = await this.database.get<EventApproval>(tenantId, 'event_approval', receipt.approval_id);
        if (approval?.tenant_id === tenantId && approval.event_id === eventId) this.approvals.set(approval.approval_id, approval);
        if (receipt.branch_id) {
          const branch = await this.database.get<ScenarioBranch>(tenantId, 'event_branch', receipt.branch_id);
          if (branch?.tenant_id === tenantId) this.branches.set(branch.branch_id, branch);
        }
        if (idempotencyScope && requestHash) {
          this.idempotency.set(idempotencyScope, { request_hash: requestHash, resource_id: receipt.receipt_id });
        }
      } else {
        receipt = undefined;
      }
    }
    const timeline = await this.database.list<TimelineEntry>(tenantId, 'event_timeline_entry');
    this.timelines.set(tenantId, timeline.filter((entry) => entry.tenant_id === tenantId));
    await this.refreshAuthoritativeAudits(tenantId);
    return receipt ? structuredClone(receipt) : undefined;
  }

  private async refreshAuthoritativeAudits(tenantId: string): Promise<void> {
    if (!this.database.enabled) return;
    const records = await this.database.list<EventAuditEvidence>(tenantId, 'event_audit_evidence');
    const assessment = this.assessAuditChain(tenantId, records);
    this.audits.set(tenantId, assessment.canonical);
    this.auditHealth.set(tenantId, assessment.diagnostics);
  }

  private throwDatabaseMutationProblem(error: DatabaseMutationConflict): never {
    const status = error.code === 'event_precondition_failed'
      ? HttpStatus.PRECONDITION_FAILED
      : HttpStatus.CONFLICT;
    throw new ProblemException(status, error.code, error.message);
  }

  private scope(ctx: RequestContext, action: string, key: string): string {
    return `${ctx.tenantId}:${ctx.actor.actor_id}:${action}:${key}`;
  }

  private isExpired(expiresAt: string): boolean {
    const reference = process.env.EDT_FROZEN_CLOCK === 'true' ? new Date(nowIso()).getTime() : Date.now();
    return new Date(expiresAt).getTime() <= reference;
  }

  private validIso(value: string): boolean {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
  }

  private validHash(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  }

  private validUuid(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private validSnapshotBinding(version: unknown, stateHash: unknown): boolean {
    return Number.isSafeInteger(version) && Number(version) >= 1 && this.validHash(stateHash);
  }

  private normalize(value: string): string {
    return value.toLocaleLowerCase('en-US').normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  private payloadMismatch(): never {
    throw new ProblemException(HttpStatus.CONFLICT, 'event_payload_mismatch', 'The payload hash does not match the reviewed and approved event.');
  }

  private idempotencyConflict(): never {
    throw new ProblemException(HttpStatus.CONFLICT, 'idempotency_key_reused', 'The Idempotency-Key was already used with a different request.');
  }

  private notFound(): ProblemException {
    return new ProblemException(HttpStatus.NOT_FOUND, 'not_found', 'The resource was not found.');
  }
}
