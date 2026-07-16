export type EventProjectionErrorCode = 'projection_version_changed' | 'projection_hash_changed' | 'projection_before_required' | 'projection_before_mismatch' | 'projection_entity_not_found' | 'projection_relationship_not_found' | 'projection_unsupported_operation' | 'projection_invalid_change' | 'projection_invalid_snapshot' | 'projection_hydration_stale';
export declare class EventProjectionError extends Error {
    readonly code: EventProjectionErrorCode;
    readonly details: Record<string, unknown>;
    readonly status = 409;
    constructor(code: EventProjectionErrorCode, message: string, details?: Record<string, unknown>);
}
export interface EventProjectionCatalogEntity {
    tenant_id: string;
    entity_id: string;
    entity_type: string;
    display_name: string;
    aliases: string[];
    current_state: Record<string, unknown>;
}
export interface EventProjectionEntityState {
    tenant_id: string;
    entity_id: string;
    entity_type: string;
    display_name: string;
    aliases: string[];
    state: Record<string, unknown>;
}
export interface EventProjectionRelationship {
    tenant_id: string;
    relationship_id: string;
    type: string;
    from_entity_id: string;
    to_entity_id: string;
    state: 'active' | 'ended' | 'removed';
    metadata: Record<string, unknown>;
}
export interface EventProjectionFact {
    tenant_id: string;
    impact_id: string;
    mutation: Record<string, unknown>;
}
export interface EventProjectionSnapshot {
    tenant_id: string;
    version: number;
    state_hash: string;
    entities: EventProjectionEntityState[];
    relationships: EventProjectionRelationship[];
    facts: EventProjectionFact[];
}
export interface EventProjectionTransition {
    before: EventProjectionSnapshot;
    after: EventProjectionSnapshot;
}
export interface EventProjectionOverlayEntity extends Record<string, unknown> {
    entity_id: string;
    tenant_id: string;
    type: string;
    ontology_version: 'edt.event-projection/1.0.0';
    lifecycle_state: string;
    version: number;
    properties: Record<string, unknown>;
    classification: 'internal';
}
export interface EventProjectionOverlayRelationship extends Record<string, unknown> {
    tenant_id: string;
    source_relationship_id: string;
    type: string;
    from: string;
    to: string;
    state: EventProjectionRelationship['state'];
    projection_version: number;
    metadata: Record<string, unknown>;
}
export interface EventProjectionReadOverlay {
    tenant_id: string;
    version: number;
    state_hash: string;
    entities: EventProjectionOverlayEntity[];
    relationships: EventProjectionOverlayRelationship[];
    facts: EventProjectionFact[];
}
export declare class EventProjectionService {
    private readonly projections;
    catalog(tenantId: string): EventProjectionCatalogEntity[];
    snapshot(tenantId: string): EventProjectionSnapshot;
    readOverlay(tenantId: string): EventProjectionReadOverlay;
    applyExact(tenantId: string, expectedVersion: number, expectedHash: string, changes: Array<Record<string, unknown>>): EventProjectionTransition;
    rollbackExact(tenantId: string, expectedVersion: number, expectedHash: string, restoreSnapshot: EventProjectionSnapshot): EventProjectionTransition;
    restoreUncommitted(tenantId: string, expectedVersion: number, expectedHash: string, restoreSnapshot: EventProjectionSnapshot): EventProjectionSnapshot;
    hydrate(tenantId: string, snapshot: EventProjectionSnapshot): EventProjectionSnapshot;
    private ensure;
    private applyChange;
    private applyStateChange;
    private modifyRelationships;
    private removeRelationships;
    private createRelationship;
    private ensureNeedsOwner;
    private relationshipMatches;
    private resolveOrCreateEntity;
    private findEntityId;
    private snapshotFromRecord;
    private recordFromSnapshot;
    private assertExpected;
    private validateSnapshot;
    private seedEntities;
    private seedRelationships;
    private relationshipId;
    private requiredString;
    private entityNotFound;
    private relationshipNotFound;
    private normalize;
    private ontologyType;
}
