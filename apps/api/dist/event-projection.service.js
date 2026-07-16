"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventProjectionService = exports.EventProjectionError = void 0;
const common_1 = require("@nestjs/common");
const domain_1 = require("./domain");
class EventProjectionError extends Error {
    code;
    details;
    status = 409;
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'EventProjectionError';
    }
}
exports.EventProjectionError = EventProjectionError;
let EventProjectionService = class EventProjectionService {
    projections = new Map();
    catalog(tenantId) {
        const snapshot = this.snapshot(tenantId);
        return snapshot.entities.map((entity) => ({
            tenant_id: entity.tenant_id,
            entity_id: entity.entity_id,
            entity_type: entity.entity_type,
            display_name: entity.display_name,
            aliases: structuredClone(entity.aliases),
            current_state: structuredClone(entity.state),
        }));
    }
    snapshot(tenantId) {
        return this.snapshotFromRecord(this.ensure(tenantId));
    }
    readOverlay(tenantId) {
        const snapshot = this.snapshot(tenantId);
        return {
            tenant_id: tenantId,
            version: snapshot.version,
            state_hash: snapshot.state_hash,
            entities: snapshot.entities.map((entity) => ({
                entity_id: entity.entity_id,
                tenant_id: tenantId,
                type: this.ontologyType(entity.entity_type),
                ontology_version: 'edt.event-projection/1.0.0',
                lifecycle_state: typeof entity.state.state === 'string' ? entity.state.state : 'active',
                version: snapshot.version,
                properties: {
                    display_name: entity.display_name,
                    aliases: structuredClone(entity.aliases),
                    ...structuredClone(entity.state),
                    event_projection_version: snapshot.version,
                    event_projection_state_hash: snapshot.state_hash,
                },
                classification: 'internal',
            })),
            relationships: snapshot.relationships.map((relationship) => ({
                tenant_id: tenantId,
                source_relationship_id: relationship.relationship_id,
                type: relationship.type,
                from: relationship.from_entity_id,
                to: relationship.to_entity_id,
                state: relationship.state,
                projection_version: snapshot.version,
                metadata: structuredClone(relationship.metadata),
            })),
            facts: structuredClone(snapshot.facts),
        };
    }
    applyExact(tenantId, expectedVersion, expectedHash, changes) {
        const current = this.ensure(tenantId);
        const before = this.snapshotFromRecord(current);
        this.assertExpected(before, expectedVersion, expectedHash);
        if (!Array.isArray(changes)) {
            throw new EventProjectionError('projection_invalid_change', 'Event projection changes must be an array.');
        }
        const working = this.recordFromSnapshot(before, before.version);
        const seenImpactIds = new Set();
        for (const rawChange of changes) {
            if (!rawChange || typeof rawChange !== 'object' || Array.isArray(rawChange)) {
                throw new EventProjectionError('projection_invalid_change', 'Each event projection change must be an object.');
            }
            const change = structuredClone(rawChange);
            const impactId = typeof change.impact_id === 'string' && change.impact_id.length > 0
                ? change.impact_id
                : (0, domain_1.stableUuid)(`event-projection-impact:${tenantId}:${(0, domain_1.sha256)(change)}`);
            if (seenImpactIds.has(impactId)) {
                throw new EventProjectionError('projection_invalid_change', 'An event projection payload contains a duplicate impact ID.', { impact_id: impactId });
            }
            seenImpactIds.add(impactId);
            this.applyChange(working, impactId, change);
            working.facts.set(impactId, { tenant_id: tenantId, impact_id: impactId, mutation: change });
        }
        working.version = before.version + 1;
        const after = this.snapshotFromRecord(working);
        this.projections.set(tenantId, working);
        return { before, after };
    }
    rollbackExact(tenantId, expectedVersion, expectedHash, restoreSnapshot) {
        const current = this.ensure(tenantId);
        const before = this.snapshotFromRecord(current);
        this.assertExpected(before, expectedVersion, expectedHash);
        this.validateSnapshot(tenantId, restoreSnapshot);
        const restored = this.recordFromSnapshot(restoreSnapshot, before.version + 1);
        const after = this.snapshotFromRecord(restored);
        this.projections.set(tenantId, restored);
        return { before, after };
    }
    restoreUncommitted(tenantId, expectedVersion, expectedHash, restoreSnapshot) {
        const current = this.snapshot(tenantId);
        this.assertExpected(current, expectedVersion, expectedHash);
        this.validateSnapshot(tenantId, restoreSnapshot);
        const restored = this.recordFromSnapshot(restoreSnapshot, restoreSnapshot.version);
        this.projections.set(tenantId, restored);
        return this.snapshotFromRecord(restored);
    }
    hydrate(tenantId, snapshot) {
        this.validateSnapshot(tenantId, snapshot);
        const existing = this.projections.get(tenantId);
        if (existing) {
            const current = this.snapshotFromRecord(existing);
            if (snapshot.version < current.version) {
                throw new EventProjectionError('projection_hydration_stale', 'A projection snapshot cannot reduce the tenant projection version.', {
                    expected_minimum_version: current.version,
                    supplied_version: snapshot.version,
                });
            }
            if (snapshot.version === current.version && snapshot.state_hash !== current.state_hash) {
                throw new EventProjectionError('projection_hash_changed', 'A projection snapshot at the current version has different state.', {
                    version: current.version,
                    expected_state_hash: current.state_hash,
                    supplied_state_hash: snapshot.state_hash,
                });
            }
            if (snapshot.version === current.version)
                return current;
        }
        const hydrated = this.recordFromSnapshot(snapshot, snapshot.version);
        this.projections.set(tenantId, hydrated);
        return this.snapshotFromRecord(hydrated);
    }
    ensure(tenantId) {
        const existing = this.projections.get(tenantId);
        if (existing)
            return existing;
        const entities = new Map();
        for (const entity of this.seedEntities(tenantId)) {
            const entityId = entity.entity_id ?? (0, domain_1.stableUuid)(`event-entity:${tenantId}:${entity.display_name}`);
            entities.set(entityId, {
                entity_type: entity.entity_type,
                display_name: entity.display_name,
                aliases: structuredClone(entity.aliases),
                state: structuredClone(entity.state),
            });
        }
        const record = { tenant_id: tenantId, version: 1, entities, relationships: new Map(), facts: new Map() };
        for (const [type, fromName, toName] of this.seedRelationships(tenantId)) {
            const from = this.findEntityId(record, fromName);
            const to = this.findEntityId(record, toName);
            if (!from || !to)
                continue;
            const relationshipId = this.relationshipId(tenantId, type, from, to);
            record.relationships.set(relationshipId, {
                tenant_id: tenantId,
                relationship_id: relationshipId,
                type,
                from_entity_id: from,
                to_entity_id: to,
                state: 'active',
                metadata: { source: 'synthetic_event_projection_seed' },
            });
        }
        this.projections.set(tenantId, record);
        return record;
    }
    applyChange(record, impactId, change) {
        const operation = typeof change.operation === 'string' ? change.operation : '';
        if (operation === 'set_state') {
            this.applyStateChange(record, change);
            return;
        }
        if (operation === 'modify_relationship') {
            this.modifyRelationships(record, change);
            return;
        }
        if (operation === 'remove_relationship') {
            this.removeRelationships(record, impactId, change);
            return;
        }
        if (operation === 'create_relationship') {
            this.createRelationship(record, impactId, change);
            return;
        }
        if (operation === 'append_outage') {
            const entityId = this.requiredString(change.entity_id, 'entity_id');
            const entity = record.entities.get(entityId);
            if (!entity)
                this.entityNotFound(entityId);
            entity.state.availability = 'outage_recorded';
            entity.state.last_outage_duration_minutes = change.duration_minutes ?? null;
            return;
        }
        throw new EventProjectionError('projection_unsupported_operation', 'The requested operation is not supported by the authoritative event projection.', { operation: operation || null });
    }
    applyStateChange(record, change) {
        const entityId = this.requiredString(change.entity_id, 'entity_id');
        const path = this.requiredString(change.path, 'path');
        if (!/^[a-z][a-z0-9_]{0,127}$/.test(path)) {
            throw new EventProjectionError('projection_invalid_change', 'set_state supports only one safe top-level state property.', { path });
        }
        const entity = record.entities.get(entityId);
        if (!entity)
            this.entityNotFound(entityId);
        if (!Object.prototype.hasOwnProperty.call(change, 'before')) {
            throw new EventProjectionError('projection_before_required', 'set_state must declare the exact current value.', { entity_id: entityId, path });
        }
        const currentValue = entity.state[path];
        if ((0, domain_1.sha256)({ value: currentValue }) !== (0, domain_1.sha256)({ value: change.before })) {
            throw new EventProjectionError('projection_before_mismatch', 'The declared before value does not match the current synthetic projection.', {
                entity_id: entityId,
                path,
                expected_before: change.before,
                actual_before: currentValue,
            });
        }
        const nextValue = Object.prototype.hasOwnProperty.call(change, 'value') ? change.value : change.after;
        if (nextValue === undefined) {
            throw new EventProjectionError('projection_invalid_change', 'set_state must declare value or after.', { entity_id: entityId, path });
        }
        entity.state[path] = structuredClone(nextValue);
    }
    modifyRelationships(record, change) {
        const matches = this.relationshipMatches(record, change, true);
        if (!matches.length)
            this.relationshipNotFound(change);
        const requestedState = change.state;
        if (!['active', 'ended', 'removed'].includes(String(requestedState))) {
            throw new EventProjectionError('projection_invalid_change', 'modify_relationship requires state active, ended, or removed.');
        }
        for (const relationship of matches)
            relationship.state = requestedState;
    }
    removeRelationships(record, impactId, change) {
        const matches = this.relationshipMatches(record, change, true);
        if (!matches.length)
            this.relationshipNotFound(change);
        for (const relationship of matches) {
            relationship.state = 'removed';
            if (relationship.type === 'OWNS')
                this.ensureNeedsOwner(record, impactId, relationship);
        }
    }
    createRelationship(record, impactId, change) {
        const type = this.requiredString(change.type, 'type').toUpperCase();
        const from = this.resolveOrCreateEntity(record, change.from_entity_id ?? change.from, 'from');
        const to = this.resolveOrCreateEntity(record, change.to_entity_id ?? change.to, 'to');
        const relationshipId = this.relationshipId(record.tenant_id, type, from, to);
        record.relationships.set(relationshipId, {
            tenant_id: record.tenant_id,
            relationship_id: relationshipId,
            type,
            from_entity_id: from,
            to_entity_id: to,
            state: 'active',
            metadata: { source: 'event_intelligence', source_impact_id: impactId },
        });
    }
    ensureNeedsOwner(record, impactId, removed) {
        const roleId = this.resolveOrCreateEntity(record, 'Role: Qualified Service Owner', 'to');
        const relationshipId = this.relationshipId(record.tenant_id, 'NEEDS_OWNER', removed.to_entity_id, roleId);
        record.relationships.set(relationshipId, {
            tenant_id: record.tenant_id,
            relationship_id: relationshipId,
            type: 'NEEDS_OWNER',
            from_entity_id: removed.to_entity_id,
            to_entity_id: roleId,
            state: 'active',
            metadata: {
                source: 'event_intelligence',
                source_impact_id: impactId,
                created_from_relationship_id: removed.relationship_id,
            },
        });
        const ownedEntity = record.entities.get(removed.to_entity_id);
        if (ownedEntity)
            ownedEntity.state.ownership_status = 'needs_owner';
    }
    relationshipMatches(record, change, activeOnly) {
        const type = this.requiredString(change.type, 'type').toUpperCase();
        const from = typeof change.from_entity_id === 'string' ? change.from_entity_id : null;
        if (!from)
            throw new EventProjectionError('projection_invalid_change', 'Relationship changes require from_entity_id.');
        const rawTo = change.to_entity_id ?? change.to;
        const to = rawTo === undefined || rawTo === null ? null : this.findEntityId(record, String(rawTo));
        return [...record.relationships.values()].filter((relationship) => (relationship.type === type
            && relationship.from_entity_id === from
            && (!to || relationship.to_entity_id === to)
            && (!activeOnly || relationship.state === 'active')));
    }
    resolveOrCreateEntity(record, value, endpoint) {
        const supplied = this.requiredString(value, endpoint);
        const existing = this.findEntityId(record, supplied);
        if (existing)
            return existing;
        const normalized = this.normalize(supplied);
        const entityId = (0, domain_1.stableUuid)(`event-projection-entity:${record.tenant_id}:${normalized}`);
        const displayName = supplied.includes('_')
            ? supplied.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
            : supplied;
        record.entities.set(entityId, {
            entity_type: supplied.toLocaleLowerCase('en-US').startsWith('role:') ? 'role' : 'external_entity',
            display_name: displayName,
            aliases: [supplied],
            state: { state: supplied.toLocaleLowerCase('en-US').startsWith('role:') ? 'open' : 'referenced' },
        });
        return entityId;
    }
    findEntityId(record, value) {
        if (record.entities.has(value))
            return value;
        const normalized = this.normalize(value);
        for (const [entityId, entity] of record.entities) {
            if (this.normalize(entity.display_name) === normalized || entity.aliases.some((alias) => this.normalize(alias) === normalized))
                return entityId;
        }
        return null;
    }
    snapshotFromRecord(record) {
        const entities = [...record.entities.entries()]
            .map(([entity_id, entity]) => ({
            tenant_id: record.tenant_id,
            entity_id,
            entity_type: entity.entity_type,
            display_name: entity.display_name,
            aliases: structuredClone(entity.aliases).sort(),
            state: structuredClone(entity.state),
        }))
            .sort((left, right) => left.entity_id.localeCompare(right.entity_id));
        const relationships = [...record.relationships.values()]
            .map((relationship) => structuredClone(relationship))
            .sort((left, right) => left.relationship_id.localeCompare(right.relationship_id));
        const facts = [...record.facts.values()]
            .map((fact) => structuredClone(fact))
            .sort((left, right) => left.impact_id.localeCompare(right.impact_id));
        const stateHash = (0, domain_1.sha256)({ tenant_id: record.tenant_id, entities, relationships, facts });
        return { tenant_id: record.tenant_id, version: record.version, state_hash: stateHash, entities, relationships, facts };
    }
    recordFromSnapshot(snapshot, version) {
        return {
            tenant_id: snapshot.tenant_id,
            version,
            entities: new Map(snapshot.entities.map((entity) => [entity.entity_id, {
                    entity_type: entity.entity_type,
                    display_name: entity.display_name,
                    aliases: structuredClone(entity.aliases),
                    state: structuredClone(entity.state),
                }])),
            relationships: new Map(snapshot.relationships.map((relationship) => [relationship.relationship_id, structuredClone(relationship)])),
            facts: new Map(snapshot.facts.map((fact) => [fact.impact_id, structuredClone(fact)])),
        };
    }
    assertExpected(snapshot, expectedVersion, expectedHash) {
        if (!Number.isInteger(expectedVersion) || expectedVersion !== snapshot.version) {
            throw new EventProjectionError('projection_version_changed', 'The synthetic event projection version changed; refresh and review again.', {
                expected_version: expectedVersion,
                actual_version: snapshot.version,
            });
        }
        if (expectedHash !== snapshot.state_hash) {
            throw new EventProjectionError('projection_hash_changed', 'The synthetic event projection state changed; refresh and review again.', {
                expected_state_hash: expectedHash,
                actual_state_hash: snapshot.state_hash,
            });
        }
    }
    validateSnapshot(tenantId, snapshot) {
        if (!snapshot || snapshot.tenant_id !== tenantId || !Number.isInteger(snapshot.version) || snapshot.version < 1) {
            throw new EventProjectionError('projection_invalid_snapshot', 'The supplied event projection snapshot has an invalid tenant or version.');
        }
        if (snapshot.entities.some((entity) => entity.tenant_id !== tenantId)
            || snapshot.relationships.some((relationship) => relationship.tenant_id !== tenantId)
            || snapshot.facts.some((fact) => fact.tenant_id !== tenantId)) {
            throw new EventProjectionError('projection_invalid_snapshot', 'The supplied event projection snapshot contains data from another tenant.');
        }
        if (new Set(snapshot.entities.map((entity) => entity.entity_id)).size !== snapshot.entities.length
            || new Set(snapshot.relationships.map((relationship) => relationship.relationship_id)).size !== snapshot.relationships.length
            || new Set(snapshot.facts.map((fact) => fact.impact_id)).size !== snapshot.facts.length) {
            throw new EventProjectionError('projection_invalid_snapshot', 'The supplied event projection snapshot contains duplicate identifiers.');
        }
        const entityIds = new Set(snapshot.entities.map((entity) => entity.entity_id));
        if (snapshot.relationships.some((relationship) => !entityIds.has(relationship.from_entity_id) || !entityIds.has(relationship.to_entity_id))) {
            throw new EventProjectionError('projection_invalid_snapshot', 'The supplied event projection snapshot contains a relationship with a missing endpoint.');
        }
        const expectedHash = (0, domain_1.sha256)({
            tenant_id: tenantId,
            entities: structuredClone(snapshot.entities).sort((left, right) => left.entity_id.localeCompare(right.entity_id)),
            relationships: structuredClone(snapshot.relationships).sort((left, right) => left.relationship_id.localeCompare(right.relationship_id)),
            facts: structuredClone(snapshot.facts).sort((left, right) => left.impact_id.localeCompare(right.impact_id)),
        });
        if (snapshot.state_hash !== expectedHash) {
            throw new EventProjectionError('projection_invalid_snapshot', 'The supplied event projection snapshot does not match its state hash.');
        }
    }
    seedEntities(tenantId) {
        const entity = (entityType, displayName, aliases, state) => ({
            tenant_id: tenantId,
            entity_type: entityType,
            display_name: displayName,
            aliases,
            state,
        });
        if (tenantId === domain_1.ASTER_TENANT_ID) {
            return [
                entity('person', 'Sarah Chen', ['Sarah', 'S. Chen', 'lead backend engineer'], { state: 'active', role: 'Lead Backend Engineer', reports_to: 'Bob Martinez' }),
                entity('person', 'Sara Cheng', ['Sara', 'S. Cheng', 'backend engineer'], { state: 'active', role: 'Backend Engineer', reports_to: 'Bob Martinez' }),
                entity('person', 'Bob Martinez', ['Bob', 'engineering director'], { state: 'active', role: 'Engineering Director' }),
                entity('service', 'Authentication Service', ['Auth Service', 'authentication', 'auth'], { state: 'operational', owner: 'Sarah Chen', ownership_status: 'assigned' }),
                entity('project', 'Payment Platform', ['Payment', 'payments project'], { state: 'active', risk_percent: 30, target_date: '2026-08-07' }),
                entity('service', 'Payment API', ['Payment', 'payments API'], { state: 'operational', owner: 'Platform Team' }),
                entity('database', 'AWS Orders Database', ['AWS database', 'orders database', 'RDS'], { state: 'operational', availability: 'healthy' }),
                entity('customer', 'Northstar Bank', ['biggest customer', 'largest customer', 'Northstar'], { state: 'active', health: 'watch' }),
                entity('asset', 'Cooling Water Pump P-101', ['P-101', 'cooling pump'], { state: 'running' }),
                entity('role', 'Role: Qualified Service Owner', ['service owner', 'qualified owner'], { state: 'open' }),
            ];
        }
        if (tenantId === domain_1.BEACON_TENANT_ID) {
            return [
                entity('person', 'Priya Raman', ['Priya', 'lead data engineer'], { state: 'active', role: 'Lead Data Engineer' }),
                entity('project', 'Beacon Data Platform', ['Data Platform', 'Beacon project'], { state: 'active', risk_percent: 18 }),
                entity('database', 'Beacon Analytics Database', ['analytics database', 'warehouse'], { state: 'operational' }),
                entity('customer', 'Acme Retail', ['largest customer', 'Acme'], { state: 'active', health: 'healthy' }),
                entity('role', 'Role: Qualified Service Owner', ['service owner', 'qualified owner'], { state: 'open' }),
            ];
        }
        return [];
    }
    seedRelationships(tenantId) {
        if (tenantId === domain_1.ASTER_TENANT_ID) {
            return [
                ['REPORTS_TO', 'Sarah Chen', 'Bob Martinez'],
                ['REPORTS_TO', 'Sara Cheng', 'Bob Martinez'],
                ['OWNS', 'Sarah Chen', 'Authentication Service'],
                ['WORKS_ON', 'Sarah Chen', 'Payment Platform'],
                ['DEPENDS_ON', 'Payment Platform', 'Payment API'],
                ['DEPENDS_ON', 'Payment API', 'AWS Orders Database'],
            ];
        }
        if (tenantId === domain_1.BEACON_TENANT_ID) {
            return [
                ['OWNS', 'Priya Raman', 'Beacon Analytics Database'],
                ['WORKS_ON', 'Priya Raman', 'Beacon Data Platform'],
                ['DEPENDS_ON', 'Beacon Data Platform', 'Beacon Analytics Database'],
            ];
        }
        return [];
    }
    relationshipId(tenantId, type, from, to) {
        return (0, domain_1.stableUuid)(`event-relationship:${tenantId}:${type}:${from}:${to}`);
    }
    requiredString(value, field) {
        if (typeof value !== 'string' || !value.trim()) {
            throw new EventProjectionError('projection_invalid_change', `Event projection change requires ${field}.`, { field });
        }
        return value.trim();
    }
    entityNotFound(entityId) {
        throw new EventProjectionError('projection_entity_not_found', 'The event projection entity does not exist in this tenant.', { entity_id: entityId });
    }
    relationshipNotFound(change) {
        throw new EventProjectionError('projection_relationship_not_found', 'The exact active relationship was not found in the current event projection.', {
            type: change.type,
            from_entity_id: change.from_entity_id,
            to: change.to_entity_id ?? change.to,
        });
    }
    normalize(value) {
        return value.toLocaleLowerCase('en-US').normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
    }
    ontologyType(entityType) {
        const names = {
            person: 'edt.organization.Person',
            team: 'edt.organization.Team',
            role: 'edt.organization.Role',
            project: 'edt.work.Project',
            service: 'edt.engineering.Service',
            database: 'edt.engineering.Database',
            customer: 'edt.business.Customer',
            vendor: 'edt.business.Vendor',
            asset: 'edt.physical.Asset',
            external_entity: 'edt.external.Entity',
        };
        return names[entityType] ?? 'edt.event.Subject';
    }
};
exports.EventProjectionService = EventProjectionService;
exports.EventProjectionService = EventProjectionService = __decorate([
    (0, common_1.Injectable)()
], EventProjectionService);
//# sourceMappingURL=event-projection.service.js.map