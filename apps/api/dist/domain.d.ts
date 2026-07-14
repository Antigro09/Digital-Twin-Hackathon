export declare const ASTER_TENANT_ID = "10000000-0000-4000-8000-000000000001";
export declare const BEACON_TENANT_ID = "10000000-0000-4000-8000-000000000002";
export declare const ASTER_JIRA_INSTALLATION_ID = "30000000-0000-4000-8000-000000000001";
export declare const AST_142_WORK_ITEM_ID = "116ab4b3-b108-5f91-ab7e-111f7fba1d45";
export declare const FROZEN_NOW = "2026-07-13T16:00:00Z";
export type TenantAlias = 'tnt_aster' | 'tnt_beacon';
export type ActorAlias = 'usr_aster_analyst' | 'usr_aster_limited' | 'usr_aster_ops_approver' | 'usr_aster_security_approver' | 'usr_aster_admin' | 'usr_beacon_analyst' | 'usr_platform_operator';
export interface ActorRecord {
    actor_alias: ActorAlias;
    actor_id: string;
    tenant_id: string;
    principal_ref: string;
    roles: string[];
    capabilities: string[];
}
export interface RequestContext {
    tenantId: string;
    tenantAlias: TenantAlias;
    tenantName: string;
    actor: ActorRecord;
    membershipId: string;
    contextHandle?: string;
    policyVersion: string;
    requestId: string;
}
export interface SourceObjectRecord {
    source_object_id: string;
    tenant_id: string;
    installation_id: string;
    provider: 'github' | 'jira';
    source_key: string;
    source_revision: string;
    acl_class: string;
    observed_at: string;
    fields: Record<string, unknown>;
}
export interface RelationshipRecord {
    tenant_id: string;
    source_relationship_id: string;
    type: string;
    from: string;
    to: string;
}
export interface AgentRunRecord {
    run_id: string;
    tenant_id: string;
    profile_id: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    created_at: string;
    completed_at?: string;
    result?: Record<string, unknown>;
}
export interface ScenarioRecord {
    scenario_id: string;
    tenant_id: string;
    snapshot_id: string;
    snapshot_hash: string;
    name: string;
    target_date: string | null;
    seed: string;
    sample_count: number;
    interventions: Array<Record<string, unknown>>;
    scenario_digest: string;
    status: 'draft' | 'confirmed';
    created_by: string;
    confirmed_by?: string;
    confirmed_at?: string;
}
export interface PreviewRecord {
    preview_id: string;
    tenant_id: string;
    requester_id: string;
    status: 'ready_for_approval' | 'approval_opened' | 'expired';
    before: JiraIssueSnapshot;
    approved_payload: Record<string, unknown>;
    payload_hash: string;
    preview_hash: string;
    reason: string;
    evidence_ids: string[];
    simulation_id: string;
    created_at: string;
    expires_at: string;
}
export interface ApprovalDecisionRecord {
    decision_id: string;
    actor_id: string;
    role: 'operations_approver' | 'security_approver';
    decision: 'approve' | 'deny';
    decided_at: string;
}
export interface ApprovalRecord {
    approval_id: string;
    tenant_id: string;
    requester_id: string;
    preview_id: string;
    payload_hash: string;
    approval_binding_hash: string;
    idempotency_key: string;
    policy_version: string;
    credential_version: string;
    reason: string;
    evidence_ids: string[];
    simulation_id: string;
    before_snapshot_hash: string;
    created_at: string;
    expires_at: string;
    status: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled' | 'executed' | 'compensated';
    decisions: ApprovalDecisionRecord[];
    action_grant_id?: string;
    kind: 'remediation' | 'compensation';
    original_receipt_id?: string;
}
export interface JiraIssueSnapshot {
    issueKey: 'AST-142';
    version: number;
    fields: {
        duedate: string;
        labels: string[];
        priority: {
            id: string;
            name: string;
        };
    };
}
export interface ReceiptRecord {
    receipt_id: string;
    tenant_id: string;
    approval_id: string;
    approved_payload_id: string;
    grant_id: string;
    payload_hash: string;
    approval_binding_hash: string;
    decision_ids: string[];
    idempotency_key: string;
    provider: 'jira';
    provider_resource_id: 'AST-142';
    provider_request_id: string;
    before_snapshot: JiraIssueSnapshot;
    after_snapshot: JiraIssueSnapshot;
    before_hash: string;
    after_hash: string;
    execution_started_at: string;
    recorded_at: string;
    trace_id: string;
    status: 'succeeded' | 'compensated' | 'compensation_conflict';
}
export interface AuditRecord {
    event_id: string;
    tenant_id: string;
    tenant_sequence: number;
    occurred_at: string;
    actor_id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    outcome: 'allowed' | 'denied' | 'succeeded' | 'failed';
    request_id: string;
    trace_id: string;
    reason_codes: string[];
    previous_hash: string;
    event_hash: string;
}
export declare function canonicalize(value: unknown): string;
export declare function sha256(value: unknown): string;
export declare function etag(hash: string): string;
export declare function nowIso(): string;
export declare function addSeconds(value: string, seconds: number): string;
export declare function newId(): string;
export declare function stableUuid(value: string): string;
export declare function traceId(): string;
