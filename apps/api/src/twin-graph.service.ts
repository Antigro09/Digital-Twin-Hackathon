import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DatabaseMutationConflict,
  DatabaseService,
  EventMutationAudit,
  EventMutationGuard,
  EventMutationRecord,
} from './database.service';
import { RequestContext, etag, newId, nowIso, sha256, stableUuid, traceId } from './domain';
import { ProblemException } from './problem';
import {
  CLASSIFICATIONS,
  ImpactDirection,
  RELATIONSHIP_STATES,
  TwinClassification,
  TwinGraphHistoryEvent,
  TwinGraphMetadata,
  TwinGraphTraversalInput,
  TwinImpactAnalysisInput,
  TwinNode,
  TwinNodeState,
  TwinRelationship,
  TwinRelationshipState,
  TwinRelationshipTypeDefinition,
  TwinSourceData,
  TwinTypeDefinition,
  TWIN_GRAPH_SCHEMA_VERSION,
} from './twin-graph.types';

const GRAPH_METADATA_KIND = 'twin_graph_metadata';
const NODE_TYPE_KIND = 'twin_node_type';
const RELATIONSHIP_TYPE_KIND = 'twin_relationship_type';
const NODE_KIND = 'twin_node';
const RELATIONSHIP_KIND = 'twin_relationship';
const HISTORY_KIND = 'twin_graph_history';
const SYSTEM_TYPE_TIMESTAMP = '2026-01-01T00:00:00.000Z';
const MAX_PROPERTY_BYTES = 64 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_DESCRIPTOR_BYTES = 32 * 1024;
const MAX_SOURCE_ITEMS = 100;
const MAX_DESCRIPTOR_ITEMS = 50;
const MAX_HISTORY_PER_RESPONSE = 100;
const SECRET_KEY_PATTERN = /(?:^|[_\-])(password|passwd|secret|token|credential|api[_\-]?key|private[_\-]?key)(?:$|[_\-])/i;
const CUSTOM_TYPE_ID = /^[a-z][a-z0-9.-]{1,63}\/[A-Z][A-Za-z0-9]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface TenantGraphState {
  metadata: TwinGraphMetadata;
  persisted: boolean;
  nodeTypes: Map<string, TwinTypeDefinition>;
  relationshipTypes: Map<string, TwinRelationshipTypeDefinition>;
  nodes: Map<string, TwinNode>;
  relationships: Map<string, TwinRelationship>;
  history: Map<string, TwinGraphHistoryEvent>;
}

interface GraphMutation {
  action: string;
  idempotencyKey: string;
  requestHash: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  records: EventMutationRecord[];
  history: TwinGraphHistoryEvent;
}

interface NodeListInput {
  type_id?: string;
  owner_id?: string;
  state?: TwinNodeState;
  query?: string;
  limit?: number;
}

interface RelationshipListInput {
  node_id?: string;
  type_id?: string;
  state?: TwinRelationshipState;
  limit?: number;
}

interface DependencyResult {
  node_id: string;
  depth: number;
  path: string[];
}

/**
 * The canonical, tenant-scoped graph service. It uses the existing PostgreSQL
 * record store, RLS transaction boundary, tamper-evident audit chain, and
 * transactional outbox instead of introducing a second source of truth.
 */
@Injectable()
export class TwinGraphService {
  private readonly states = new Map<string, TenantGraphState>();

  constructor(private readonly database: DatabaseService) {}

  async listNodeTypes(ctx: RequestContext): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    const state = await this.state(ctx.tenantId);
    return {
      items: [...state.nodeTypes.values()]
        .filter((definition) => definition.active)
        .sort((left, right) => left.type_id.localeCompare(right.type_id))
        .map((definition) => this.publicType(definition)),
      graph_version: state.metadata.version,
      data_watermark: this.watermark(state),
    };
  }

  async listRelationshipTypes(ctx: RequestContext): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    const state = await this.state(ctx.tenantId);
    return {
      items: [...state.relationshipTypes.values()]
        .filter((definition) => definition.active)
        .sort((left, right) => left.type_id.localeCompare(right.type_id))
        .map((definition) => this.publicRelationshipType(definition)),
      graph_version: state.metadata.version,
      data_watermark: this.watermark(state),
    };
  }

  async createNodeType(
    ctx: RequestContext,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    this.assertExactKeys(input, ['type_id', 'display_name', 'domain', 'description', 'property_schema'], 'Node type');
    const state = await this.state(ctx.tenantId);
    const typeId = this.requiredString(input.type_id, 'type_id', 128);
    if (!CUSTOM_TYPE_ID.test(typeId) || typeId.startsWith('edt.core/')) {
      throw this.invalid('invalid_node_type_id', 'Custom node type IDs must be namespaced as publisher.package/Type and cannot shadow edt.core/.');
    }
    const replayHistoryId = this.historyId(ctx, 'node_type.create', idempotencyKey);
    if (state.nodeTypes.has(typeId) && !state.history.has(replayHistoryId)) {
      throw this.conflict('node_type_exists', 'A node type with that ID already exists.');
    }
    const timestamp = nowIso();
    const definition: TwinTypeDefinition = {
      type_id: typeId,
      display_name: this.requiredString(input.display_name, 'display_name', 120),
      domain: this.requiredString(input.domain, 'domain', 80),
      description: this.optionalString(input.description, 'description', 2_000) ?? '',
      schema_version: '1.0.0',
      property_schema: this.propertySchema(input.property_schema ?? {}),
      is_system: false,
      active: true,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const recordId = this.nodeTypeRecordId(ctx.tenantId, typeId);
    const history = this.historyEvent(ctx, 'node_type.created', 'node_type', recordId, 1, null, sha256(definition), ['definition'], { type_id: typeId }, replayHistoryId);
    const committed = await this.commit(ctx, state, {
      action: 'twin.node_type.create',
      idempotencyKey,
      requestHash: sha256({ action: 'node_type.create', input }),
      eventType: 'com.enterprisedigitaltwin.twin.node-type-created.v1',
      aggregateType: 'twin_node_type',
      aggregateId: recordId,
      aggregateVersion: 1,
      records: [{ kind: NODE_TYPE_KIND, id: recordId, payload: definition }],
      history,
    });
    if (committed.replayed) {
      const refreshed = await this.stateAfterReplay(ctx, state);
      const existing = refreshed.nodeTypes.get(typeId);
      if (!existing) throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original node-type response is no longer available.', true);
      return { node_type: this.publicType(existing), graph_version: refreshed.metadata.version, etag: etag(sha256(existing)), replayed: true };
    }
    state.nodeTypes.set(typeId, definition);
    return { node_type: this.publicType(definition), graph_version: state.metadata.version, etag: etag(sha256(definition)) };
  }

  async createRelationshipType(
    ctx: RequestContext,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    this.assertExactKeys(
      input,
      ['type_id', 'display_name', 'domain', 'description', 'property_schema', 'impact_direction', 'acyclic', 'allowed_source_types', 'allowed_target_types'],
      'Relationship type',
    );
    const state = await this.state(ctx.tenantId);
    const typeId = this.requiredString(input.type_id, 'type_id', 128);
    if (!CUSTOM_TYPE_ID.test(typeId) || typeId.startsWith('edt.core/')) {
      throw this.invalid('invalid_relationship_type_id', 'Custom relationship type IDs must be namespaced as publisher.package/Type and cannot shadow edt.core/.');
    }
    const replayHistoryId = this.historyId(ctx, 'relationship_type.create', idempotencyKey);
    if (state.relationshipTypes.has(typeId) && !state.history.has(replayHistoryId)) {
      throw this.conflict('relationship_type_exists', 'A relationship type with that ID already exists.');
    }
    const impactDirection = this.impactDirection(input.impact_direction ?? 'forward');
    const timestamp = nowIso();
    const definition: TwinRelationshipTypeDefinition = {
      type_id: typeId,
      display_name: this.requiredString(input.display_name, 'display_name', 120),
      domain: this.requiredString(input.domain, 'domain', 80),
      description: this.optionalString(input.description, 'description', 2_000) ?? '',
      schema_version: '1.0.0',
      property_schema: this.propertySchema(input.property_schema ?? {}),
      is_system: false,
      active: true,
      created_at: timestamp,
      updated_at: timestamp,
      directional: true,
      impact_direction: impactDirection,
      acyclic: this.optionalBoolean(input.acyclic, 'acyclic') ?? false,
      allowed_source_types: this.typeList(input.allowed_source_types, 'allowed_source_types', state),
      allowed_target_types: this.typeList(input.allowed_target_types, 'allowed_target_types', state),
    };
    const recordId = this.relationshipTypeRecordId(ctx.tenantId, typeId);
    const history = this.historyEvent(ctx, 'relationship_type.created', 'relationship_type', recordId, 1, null, sha256(definition), ['definition'], { type_id: typeId }, replayHistoryId);
    const committed = await this.commit(ctx, state, {
      action: 'twin.relationship_type.create',
      idempotencyKey,
      requestHash: sha256({ action: 'relationship_type.create', input }),
      eventType: 'com.enterprisedigitaltwin.twin.relationship-type-created.v1',
      aggregateType: 'twin_relationship_type',
      aggregateId: recordId,
      aggregateVersion: 1,
      records: [{ kind: RELATIONSHIP_TYPE_KIND, id: recordId, payload: definition }],
      history,
    });
    if (committed.replayed) {
      const refreshed = await this.stateAfterReplay(ctx, state);
      const existing = refreshed.relationshipTypes.get(typeId);
      if (!existing) throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original relationship-type response is no longer available.', true);
      return { relationship_type: this.publicRelationshipType(existing), graph_version: refreshed.metadata.version, etag: etag(sha256(existing)), replayed: true };
    }
    state.relationshipTypes.set(typeId, definition);
    return { relationship_type: this.publicRelationshipType(definition), graph_version: state.metadata.version, etag: etag(sha256(definition)) };
  }

  async listNodes(ctx: RequestContext, input: NodeListInput = {}): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    const state = await this.state(ctx.tenantId);
    const requestedType = input.type_id ? this.resolveNodeTypeId(state, input.type_id) : undefined;
    const requestedState = input.state === undefined ? undefined : this.nodeState(input.state);
    const query = input.query === undefined ? undefined : this.searchTerm(input.query);
    const limit = this.boundedInteger(input.limit ?? 50, 'limit', 1, 100);
    const items = [...state.nodes.values()]
      .filter((node) => this.canReadNode(ctx, node))
      .filter((node) => !requestedType || node.type_id === requestedType)
      .filter((node) => !requestedState || node.state === requestedState)
      .filter((node) => !input.owner_id || node.owner_id === input.owner_id)
      .filter((node) => !query || this.nodeMatches(node, query))
      .sort((left, right) => left.label.localeCompare(right.label) || left.node_id.localeCompare(right.node_id));
    return {
      items: items.slice(0, limit).map((node) => this.publicNodeSummary(node)),
      has_more: items.length > limit,
      graph_version: state.metadata.version,
      data_watermark: this.watermark(state),
    };
  }

  async search(ctx: RequestContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    this.assertExactKeys(input, ['query', 'type_id', 'limit'], 'Search');
    return this.listNodes(ctx, {
      query: this.requiredString(input.query, 'query', 128),
      type_id: typeof input.type_id === 'string' ? input.type_id : undefined,
      limit: input.limit === undefined ? undefined : Number(input.limit),
    });
  }

  async getNode(ctx: RequestContext, nodeId: string): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    const state = await this.state(ctx.tenantId);
    const node = this.readableNode(ctx, state, nodeId);
    const relationships = [...state.relationships.values()]
      .filter((relationship) => relationship.source_node_id === node.node_id || relationship.target_node_id === node.node_id)
      .filter((relationship) => this.canReadRelationship(ctx, state, relationship))
      .sort((left, right) => left.relationship_id.localeCompare(right.relationship_id));
    const history = this.historyFor(state, 'node', node.node_id);
    return {
      node: this.nodeWithHistory(state, node),
      relationships: relationships.map((relationship) => this.publicRelationship(relationship)),
      history,
      graph_version: state.metadata.version,
      data_watermark: this.watermark(state),
      etag: etag(node.state_hash),
    };
  }

  async createNode(
    ctx: RequestContext,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    this.assertExactKeys(
      input,
      ['type_id', 'label', 'properties', 'metadata', 'owner_id', 'source_data', 'confidence_score', 'simulation_hooks', 'ai_capabilities'],
      'Node',
    );
    const state = await this.state(ctx.tenantId);
    const nodeId = this.resourceId(ctx, 'node.create', idempotencyKey);
    const typeId = this.resolveNodeTypeId(state, this.requiredString(input.type_id, 'type_id', 128));
    const label = this.requiredString(input.label, 'label', 500);
    const properties = this.safeRecord(input.properties ?? {}, 'properties', MAX_PROPERTY_BYTES);
    this.validateNodeProperties(state.nodeTypes.get(typeId) as TwinTypeDefinition, properties);
    const suppliedMetadata = this.safeRecord(input.metadata ?? {}, 'metadata', MAX_METADATA_BYTES);
    const preliminaryClassification = this.classification(suppliedMetadata.classification ?? 'internal');
    const sourceData = this.sourceData(input.source_data, nodeId, preliminaryClassification);
    const ownerId = this.ownerId(state, input.owner_id);
    const ownerClassification = ownerId ? [this.nodeClassification(state.nodes.get(ownerId) as TwinNode)] : [];
    const metadata = this.metadata(suppliedMetadata, sourceData, ownerClassification);
    const timestamp = nowIso();
    const node: TwinNode = {
      node_id: nodeId,
      tenant_id: ctx.tenantId,
      type_id: typeId,
      label,
      properties,
      metadata,
      owner_id: ownerId,
      source_data: sourceData,
      confidence_score: this.score(input.confidence_score ?? 1, 'confidence_score'),
      simulation_hooks: this.descriptorArray(input.simulation_hooks ?? [], 'simulation_hooks'),
      ai_capabilities: this.descriptorArray(input.ai_capabilities ?? [], 'ai_capabilities'),
      state: 'active',
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      created_by: ctx.actor.actor_id,
      updated_by: ctx.actor.actor_id,
      state_hash: '',
    };
    node.state_hash = this.nodeHash(node);
    const history = this.historyEvent(ctx, 'node.created', 'node', node.node_id, node.version, null, node.state_hash, Object.keys(node).filter((key) => !['state_hash'].includes(key)), { type_id: node.type_id, state: node.state }, this.historyId(ctx, 'node.create', idempotencyKey));
    const committed = await this.commit(ctx, state, {
      action: 'twin.node.create',
      idempotencyKey,
      requestHash: sha256({ action: 'node.create', input }),
      eventType: 'com.enterprisedigitaltwin.twin.node-created.v1',
      aggregateType: 'twin_node',
      aggregateId: node.node_id,
      aggregateVersion: node.version,
      records: [{ kind: NODE_KIND, id: node.node_id, payload: node }],
      history,
    });
    if (committed.replayed) {
      const refreshed = await this.stateAfterReplay(ctx, state);
      const existing = refreshed.nodes.get(node.node_id);
      if (!existing) throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original node response is no longer available.', true);
      return { ...this.nodeMutationView(refreshed, existing), replayed: true };
    }
    state.nodes.set(node.node_id, node);
    return this.nodeMutationView(state, node);
  }

  async updateNode(
    ctx: RequestContext,
    nodeId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
    ifMatch: string | undefined,
  ): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    this.assertExactKeys(
      input,
      ['label', 'properties', 'metadata', 'owner_id', 'source_data', 'confidence_score', 'simulation_hooks', 'ai_capabilities', 'state'],
      'Node patch',
    );
    const state = await this.state(ctx.tenantId);
    const before = this.nodeForMutation(state, nodeId);
    const replayHistoryId = this.historyId(ctx, 'node.update', idempotencyKey);
    if (!state.history.has(replayHistoryId)) this.assertEtag(ifMatch, before.state_hash, 'node');
    const sourceData = Object.prototype.hasOwnProperty.call(input, 'source_data')
      ? this.sourceData(input.source_data, before.node_id, this.classification(before.metadata.classification))
      : structuredClone(before.source_data);
    const suppliedMetadata = Object.prototype.hasOwnProperty.call(input, 'metadata')
      ? { ...before.metadata, ...this.safeRecord(input.metadata, 'metadata', MAX_METADATA_BYTES) }
      : structuredClone(before.metadata);
    const ownerId = Object.prototype.hasOwnProperty.call(input, 'owner_id') ? this.ownerId(state, input.owner_id) : before.owner_id;
    const ownerClassification = ownerId && state.nodes.has(ownerId) ? [this.nodeClassification(state.nodes.get(ownerId) as TwinNode)] : [];
    const updated: TwinNode = {
      ...structuredClone(before),
      label: Object.prototype.hasOwnProperty.call(input, 'label') ? this.requiredString(input.label, 'label', 500) : before.label,
      properties: Object.prototype.hasOwnProperty.call(input, 'properties') ? this.safeRecord(input.properties, 'properties', MAX_PROPERTY_BYTES) : structuredClone(before.properties),
      metadata: this.metadata(suppliedMetadata, sourceData, ownerClassification),
      owner_id: ownerId,
      source_data: sourceData,
      confidence_score: Object.prototype.hasOwnProperty.call(input, 'confidence_score') ? this.score(input.confidence_score, 'confidence_score') : before.confidence_score,
      simulation_hooks: Object.prototype.hasOwnProperty.call(input, 'simulation_hooks') ? this.descriptorArray(input.simulation_hooks, 'simulation_hooks') : structuredClone(before.simulation_hooks),
      ai_capabilities: Object.prototype.hasOwnProperty.call(input, 'ai_capabilities') ? this.descriptorArray(input.ai_capabilities, 'ai_capabilities') : structuredClone(before.ai_capabilities),
      state: Object.prototype.hasOwnProperty.call(input, 'state') ? this.nodeState(input.state) : before.state,
      version: before.version + 1,
      updated_at: nowIso(),
      updated_by: ctx.actor.actor_id,
      state_hash: '',
    };
    this.validateNodeProperties(state.nodeTypes.get(updated.type_id) as TwinTypeDefinition, updated.properties);
    updated.state_hash = this.nodeHash(updated);
    if (updated.state_hash === before.state_hash) return this.nodeMutationView(state, before);

    const records: EventMutationRecord[] = [{ kind: NODE_KIND, id: updated.node_id, payload: updated }];
    const archivalRecords: TwinRelationship[] = [];
    if (updated.state === 'archived' && before.state !== 'archived') {
      for (const relationship of state.relationships.values()) {
        if (relationship.state !== 'active') continue;
        if (relationship.source_node_id !== updated.node_id && relationship.target_node_id !== updated.node_id) continue;
        const archived = this.archiveRelationship(relationship, ctx.actor.actor_id);
        archivalRecords.push(archived);
        records.push({ kind: RELATIONSHIP_KIND, id: archived.relationship_id, payload: archived });
        const archivalHistory = this.historyEvent(
          ctx,
          'relationship.archived_by_node',
          'relationship',
          archived.relationship_id,
          archived.version,
          relationship.state_hash,
          archived.state_hash,
          ['state'],
          { node_id: updated.node_id },
          this.historyId(ctx, `node.update.archive.${archived.relationship_id}`, idempotencyKey),
        );
        records.push({
          kind: HISTORY_KIND,
          id: archivalHistory.event_id,
          payload: archivalHistory,
        });
      }
    }
    const history = this.historyEvent(ctx, 'node.updated', 'node', updated.node_id, updated.version, before.state_hash, updated.state_hash, this.changedFields(before, updated), { state: updated.state }, replayHistoryId);
    const committed = await this.commit(ctx, state, {
      action: 'twin.node.update',
      idempotencyKey,
      requestHash: sha256({ action: 'node.update', node_id: nodeId, input, if_match: ifMatch }),
      eventType: 'com.enterprisedigitaltwin.twin.node-updated.v1',
      aggregateType: 'twin_node',
      aggregateId: updated.node_id,
      aggregateVersion: updated.version,
      records,
      history,
    });
    if (committed.replayed) {
      const refreshed = await this.stateAfterReplay(ctx, state);
      const existing = refreshed.nodes.get(nodeId);
      if (!existing) throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original node response is no longer available.', true);
      return { ...this.nodeMutationView(refreshed, existing), archived_relationship_count: 0, replayed: true };
    }
    state.nodes.set(updated.node_id, updated);
    for (const relationship of archivalRecords) state.relationships.set(relationship.relationship_id, relationship);
    return { ...this.nodeMutationView(state, updated), archived_relationship_count: archivalRecords.length };
  }

  async listRelationships(ctx: RequestContext, input: RelationshipListInput = {}): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    const state = await this.state(ctx.tenantId);
    const requestedType = input.type_id ? this.resolveRelationshipTypeId(state, input.type_id) : undefined;
    const requestedState = input.state === undefined ? undefined : this.relationshipState(input.state);
    const limit = this.boundedInteger(input.limit ?? 100, 'limit', 1, 250);
    const relationships = [...state.relationships.values()]
      .filter((relationship) => this.canReadRelationship(ctx, state, relationship))
      .filter((relationship) => !requestedType || relationship.type_id === requestedType)
      .filter((relationship) => !requestedState || relationship.state === requestedState)
      .filter((relationship) => !input.node_id || relationship.source_node_id === input.node_id || relationship.target_node_id === input.node_id)
      .sort((left, right) => left.relationship_id.localeCompare(right.relationship_id));
    return {
      items: relationships.slice(0, limit).map((relationship) => this.publicRelationship(relationship)),
      has_more: relationships.length > limit,
      graph_version: state.metadata.version,
      data_watermark: this.watermark(state),
    };
  }

  async getRelationship(ctx: RequestContext, relationshipId: string): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    const state = await this.state(ctx.tenantId);
    const relationship = this.readableRelationship(ctx, state, relationshipId);
    const history = this.historyFor(state, 'relationship', relationship.relationship_id);
    return {
      relationship: this.relationshipWithHistory(state, relationship),
      history,
      graph_version: state.metadata.version,
      data_watermark: this.watermark(state),
      etag: etag(relationship.state_hash),
    };
  }

  async createRelationship(
    ctx: RequestContext,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    this.assertExactKeys(
      input,
      ['type_id', 'source_node_id', 'target_node_id', 'strength', 'confidence', 'importance', 'risk', 'cost', 'metadata', 'source_data'],
      'Relationship',
    );
    const state = await this.state(ctx.tenantId);
    const type = this.relationshipType(state, this.requiredString(input.type_id, 'type_id', 128));
    const source = this.activeNodeForMutation(state, this.requiredString(input.source_node_id, 'source_node_id', 64));
    const target = this.activeNodeForMutation(state, this.requiredString(input.target_node_id, 'target_node_id', 64));
    const relationshipId = this.resourceId(ctx, 'relationship.create', idempotencyKey);
    const replayHistoryId = this.historyId(ctx, 'relationship.create', idempotencyKey);
    this.assertAllowedEndpoints(type, source, target);
    if (source.node_id === target.node_id && type.acyclic) {
      throw this.invalid('relationship_cycle', 'This relationship type cannot point from a node to itself.');
    }
    if ([...state.relationships.values()].some((relationship) => relationship.relationship_id !== relationshipId
      && relationship.state === 'active'
      && relationship.type_id === type.type_id
      && relationship.source_node_id === source.node_id
      && relationship.target_node_id === target.node_id)) {
      throw this.conflict('relationship_exists', 'An active relationship with the same type and endpoints already exists.');
    }
    if (type.acyclic && this.createsCycle(state, type.type_id, source.node_id, target.node_id)) {
      throw this.invalid('relationship_cycle', 'The requested relationship would create a forbidden dependency cycle.');
    }
    const preliminaryClassification = this.classification((this.safeRecord(input.metadata ?? {}, 'metadata', MAX_METADATA_BYTES)).classification
      ?? this.maximumClassification([this.nodeClassification(source), this.nodeClassification(target)]));
    const sourceData = this.sourceData(input.source_data, relationshipId, preliminaryClassification);
    const metadata = this.metadata(
      this.safeRecord(input.metadata ?? {}, 'metadata', MAX_METADATA_BYTES),
      sourceData,
      [this.nodeClassification(source), this.nodeClassification(target)],
    );
    const timestamp = nowIso();
    const relationship: TwinRelationship = {
      relationship_id: relationshipId,
      tenant_id: ctx.tenantId,
      type_id: type.type_id,
      source_node_id: source.node_id,
      target_node_id: target.node_id,
      strength: this.score(input.strength ?? 1, 'strength'),
      confidence: this.score(input.confidence ?? 1, 'confidence'),
      importance: this.score(input.importance ?? 0.5, 'importance'),
      risk: this.score(input.risk ?? 0, 'risk'),
      cost: this.cost(input.cost ?? 0),
      metadata,
      source_data: sourceData,
      state: 'active',
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      created_by: ctx.actor.actor_id,
      updated_by: ctx.actor.actor_id,
      state_hash: '',
    };
    relationship.state_hash = this.relationshipHash(relationship);
    const history = this.historyEvent(ctx, 'relationship.created', 'relationship', relationship.relationship_id, relationship.version, null, relationship.state_hash, Object.keys(relationship).filter((key) => key !== 'state_hash'), { type_id: relationship.type_id }, replayHistoryId);
    const committed = await this.commit(ctx, state, {
      action: 'twin.relationship.create',
      idempotencyKey,
      requestHash: sha256({ action: 'relationship.create', input }),
      eventType: 'com.enterprisedigitaltwin.twin.relationship-created.v1',
      aggregateType: 'twin_relationship',
      aggregateId: relationship.relationship_id,
      aggregateVersion: relationship.version,
      records: [{ kind: RELATIONSHIP_KIND, id: relationship.relationship_id, payload: relationship }],
      history,
    });
    if (committed.replayed) {
      const refreshed = await this.stateAfterReplay(ctx, state);
      const existing = refreshed.relationships.get(relationship.relationship_id);
      if (!existing) throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original relationship response is no longer available.', true);
      return { ...this.relationshipMutationView(refreshed, existing), replayed: true };
    }
    state.relationships.set(relationship.relationship_id, relationship);
    return this.relationshipMutationView(state, relationship);
  }

  async updateRelationship(
    ctx: RequestContext,
    relationshipId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
    ifMatch: string | undefined,
  ): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    this.assertExactKeys(
      input,
      ['strength', 'confidence', 'importance', 'risk', 'cost', 'metadata', 'source_data', 'state'],
      'Relationship patch',
    );
    const state = await this.state(ctx.tenantId);
    const before = this.relationshipForMutation(state, relationshipId);
    const replayHistoryId = this.historyId(ctx, 'relationship.update', idempotencyKey);
    if (!state.history.has(replayHistoryId)) this.assertEtag(ifMatch, before.state_hash, 'relationship');
    const source = this.nodeForMutation(state, before.source_node_id);
    const target = this.nodeForMutation(state, before.target_node_id);
    const type = this.relationshipType(state, before.type_id);
    const sourceData = Object.prototype.hasOwnProperty.call(input, 'source_data')
      ? this.sourceData(input.source_data, before.relationship_id, this.classification(before.metadata.classification))
      : structuredClone(before.source_data);
    const suppliedMetadata = Object.prototype.hasOwnProperty.call(input, 'metadata')
      ? { ...before.metadata, ...this.safeRecord(input.metadata, 'metadata', MAX_METADATA_BYTES) }
      : structuredClone(before.metadata);
    const updated: TwinRelationship = {
      ...structuredClone(before),
      strength: Object.prototype.hasOwnProperty.call(input, 'strength') ? this.score(input.strength, 'strength') : before.strength,
      confidence: Object.prototype.hasOwnProperty.call(input, 'confidence') ? this.score(input.confidence, 'confidence') : before.confidence,
      importance: Object.prototype.hasOwnProperty.call(input, 'importance') ? this.score(input.importance, 'importance') : before.importance,
      risk: Object.prototype.hasOwnProperty.call(input, 'risk') ? this.score(input.risk, 'risk') : before.risk,
      cost: Object.prototype.hasOwnProperty.call(input, 'cost') ? this.cost(input.cost) : before.cost,
      metadata: this.metadata(suppliedMetadata, sourceData, [this.nodeClassification(source), this.nodeClassification(target)]),
      source_data: sourceData,
      state: Object.prototype.hasOwnProperty.call(input, 'state') ? this.relationshipState(input.state) : before.state,
      version: before.version + 1,
      updated_at: nowIso(),
      updated_by: ctx.actor.actor_id,
      state_hash: '',
    };
    if (updated.state === 'active') {
      if (source.state !== 'active' || target.state !== 'active') {
        throw this.invalid('relationship_endpoint_archived', 'An active relationship requires two active endpoint nodes.');
      }
      this.assertAllowedEndpoints(type, source, target);
      if (type.acyclic && this.createsCycle(state, type.type_id, source.node_id, target.node_id, before.relationship_id)) {
        throw this.invalid('relationship_cycle', 'Reactivating this relationship would create a forbidden dependency cycle.');
      }
    }
    updated.state_hash = this.relationshipHash(updated);
    if (updated.state_hash === before.state_hash) return this.relationshipMutationView(state, before);
    const history = this.historyEvent(ctx, 'relationship.updated', 'relationship', updated.relationship_id, updated.version, before.state_hash, updated.state_hash, this.changedFields(before, updated), { state: updated.state }, replayHistoryId);
    const committed = await this.commit(ctx, state, {
      action: 'twin.relationship.update',
      idempotencyKey,
      requestHash: sha256({ action: 'relationship.update', relationship_id: relationshipId, input, if_match: ifMatch }),
      eventType: 'com.enterprisedigitaltwin.twin.relationship-updated.v1',
      aggregateType: 'twin_relationship',
      aggregateId: updated.relationship_id,
      aggregateVersion: updated.version,
      records: [{ kind: RELATIONSHIP_KIND, id: updated.relationship_id, payload: updated }],
      history,
    });
    if (committed.replayed) {
      const refreshed = await this.stateAfterReplay(ctx, state);
      const existing = refreshed.relationships.get(relationshipId);
      if (!existing) throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original relationship response is no longer available.', true);
      return { ...this.relationshipMutationView(refreshed, existing), replayed: true };
    }
    state.relationships.set(updated.relationship_id, updated);
    return this.relationshipMutationView(state, updated);
  }

  async traverse(ctx: RequestContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    this.assertExactKeys(input, ['start_node_id', 'direction', 'relationship_types', 'max_depth', 'max_nodes'], 'Traversal');
    const traversal: TwinGraphTraversalInput = {
      start_node_id: this.requiredString(input.start_node_id, 'start_node_id', 64),
      direction: input.direction === undefined ? 'outbound' : this.traversalDirection(input.direction),
      relationship_types: input.relationship_types === undefined ? undefined : this.stringArray(input.relationship_types, 'relationship_types', 50, 128),
      max_depth: input.max_depth === undefined ? 3 : this.boundedInteger(input.max_depth, 'max_depth', 1, 6),
      max_nodes: input.max_nodes === undefined ? 100 : this.boundedInteger(input.max_nodes, 'max_nodes', 1, 250),
    };
    const state = await this.state(ctx.tenantId);
    const start = this.readableNode(ctx, state, traversal.start_node_id);
    const typeFilter = new Set((traversal.relationship_types ?? []).map((typeId) => this.resolveRelationshipTypeId(state, typeId)));
    const returnedNodes = new Map<string, TwinNode>([[start.node_id, start]]);
    const returnedRelationships = new Map<string, TwinRelationship>();
    const paths = new Map<string, string[]>([[start.node_id, [start.node_id]]]);
    const queue: Array<{ node_id: string; depth: number }> = [{ node_id: start.node_id, depth: 0 }];
    let truncated = false;
    while (queue.length) {
      const current = queue.shift() as { node_id: string; depth: number };
      if (current.depth >= (traversal.max_depth ?? 3)) continue;
      for (const relationship of this.visibleRelationshipsForNode(ctx, state, current.node_id, typeFilter)) {
        const next = this.nextTraversalNode(relationship, current.node_id, traversal.direction ?? 'outbound');
        if (!next) continue;
        returnedRelationships.set(relationship.relationship_id, relationship);
        if (returnedNodes.has(next)) continue;
        if (returnedNodes.size >= (traversal.max_nodes ?? 100)) {
          truncated = true;
          continue;
        }
        const node = state.nodes.get(next);
        if (!node || !this.canReadNode(ctx, node)) continue;
        returnedNodes.set(next, node);
        paths.set(next, [...(paths.get(current.node_id) ?? [current.node_id]), next]);
        queue.push({ node_id: next, depth: current.depth + 1 });
      }
    }
    return {
      root_node_id: start.node_id,
      nodes: [...returnedNodes.values()].map((node) => this.publicNodeSummary(node)),
      relationships: [...returnedRelationships.values()].map((relationship) => this.publicRelationship(relationship)),
      paths: [...paths.entries()]
        .filter(([nodeId]) => nodeId !== start.node_id)
        .map(([node_id, path]) => ({ node_id, path }))
        .sort((left, right) => left.node_id.localeCompare(right.node_id)),
      truncated,
      graph_version: state.metadata.version,
      data_watermark: this.watermark(state),
    };
  }

  async analyzeDependencies(ctx: RequestContext, nodeId: string, rawMaxDepth?: unknown): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    const state = await this.state(ctx.tenantId);
    const node = this.readableNode(ctx, state, nodeId);
    const maxDepth = this.boundedInteger(rawMaxDepth ?? 4, 'max_depth', 1, 8);
    const typeId = 'edt.core/DEPENDS_ON';
    const prerequisites = this.dependencyReachability(ctx, state, node.node_id, typeId, 'outbound', maxDepth);
    const dependents = this.dependencyReachability(ctx, state, node.node_id, typeId, 'inbound', maxDepth);
    return {
      node_id: node.node_id,
      dependency_type: typeId,
      prerequisites,
      dependents,
      graph_version: state.metadata.version,
      data_watermark: this.watermark(state),
    };
  }

  async analyzeImpact(ctx: RequestContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    this.assertExactKeys(input, ['node_id', 'change', 'max_depth', 'max_impacts', 'relationship_types'], 'Impact analysis');
    const analysis: TwinImpactAnalysisInput = {
      node_id: this.requiredString(input.node_id, 'node_id', 64),
      change: input.change === undefined ? undefined : this.safeRecord(input.change, 'change', MAX_METADATA_BYTES),
      max_depth: input.max_depth === undefined ? 4 : this.boundedInteger(input.max_depth, 'max_depth', 1, 6),
      max_impacts: input.max_impacts === undefined ? 100 : this.boundedInteger(input.max_impacts, 'max_impacts', 1, 250),
      relationship_types: input.relationship_types === undefined ? undefined : this.stringArray(input.relationship_types, 'relationship_types', 50, 128),
    };
    const state = await this.state(ctx.tenantId);
    const root = this.readableNode(ctx, state, analysis.node_id);
    const typeFilter = new Set((analysis.relationship_types ?? []).map((typeId) => this.resolveRelationshipTypeId(state, typeId)));
    const impacts = new Map<string, { score: number; depth: number; path: string[]; relationship_path: string[]; cumulative_cost: number }>();
    const queue: Array<{ node_id: string; depth: number; score: number; path: string[]; relationship_path: string[]; cumulative_cost: number }> = [
      { node_id: root.node_id, depth: 0, score: 1, path: [root.node_id], relationship_path: [], cumulative_cost: 0 },
    ];
    let truncated = false;
    while (queue.length) {
      const current = queue.shift() as { node_id: string; depth: number; score: number; path: string[]; relationship_path: string[]; cumulative_cost: number };
      if (current.depth >= (analysis.max_depth ?? 4)) continue;
      for (const relationship of this.impactRelationshipsForNode(ctx, state, current.node_id, typeFilter)) {
        const next = this.nextImpactNode(state, relationship, current.node_id);
        if (!next || next === root.node_id) continue;
        const node = state.nodes.get(next);
        if (!node || !this.canReadNode(ctx, node)) continue;
        const candidate = {
          score: this.round(current.score * this.edgeImpactWeight(relationship)),
          depth: current.depth + 1,
          path: [...current.path, next],
          relationship_path: [...current.relationship_path, relationship.relationship_id],
          cumulative_cost: this.round(current.cumulative_cost + relationship.cost),
        };
        const existing = impacts.get(next);
        if (existing && existing.score >= candidate.score) continue;
        if (!existing && impacts.size >= (analysis.max_impacts ?? 100)) {
          truncated = true;
          continue;
        }
        impacts.set(next, candidate);
        queue.push({ node_id: next, ...candidate });
      }
    }
    const ordered = [...impacts.entries()]
      .map(([node_id, value]) => ({ node_id, node: this.publicNodeSummary(state.nodes.get(node_id) as TwinNode), ...value }))
      .sort((left, right) => right.score - left.score || left.depth - right.depth || left.node_id.localeCompare(right.node_id));
    return {
      changed_node: this.publicNodeSummary(root),
      change: analysis.change ?? { kind: 'unspecified' },
      direct_impacts: ordered.filter((impact) => impact.depth === 1),
      downstream_impacts: ordered.filter((impact) => impact.depth > 1),
      impact_count: ordered.length,
      truncated,
      method: {
        name: 'bounded_weighted_dependency_propagation',
        version: '1.0.0',
        note: 'Scores express graph-structural exposure from declared relationship attributes; they are not causal proof or a financial forecast.',
      },
      graph_version: state.metadata.version,
      data_watermark: this.watermark(state),
    };
  }

  async criticalNodes(ctx: RequestContext, rawLimit?: unknown): Promise<Record<string, unknown>> {
    this.assertRead(ctx);
    const state = await this.state(ctx.tenantId);
    const limit = this.boundedInteger(rawLimit ?? 25, 'limit', 1, 100);
    const scores = new Map<string, { raw_score: number; direct_relationships: number; cumulative_cost: number; max_risk: number }>();
    for (const node of state.nodes.values()) {
      if (node.state === 'active' && this.canReadNode(ctx, node)) {
        scores.set(node.node_id, { raw_score: 0, direct_relationships: 0, cumulative_cost: 0, max_risk: 0 });
      }
    }
    for (const relationship of state.relationships.values()) {
      if (!this.canReadRelationship(ctx, state, relationship) || relationship.state !== 'active') continue;
      const type = state.relationshipTypes.get(relationship.type_id);
      if (!type || type.impact_direction === 'none') continue;
      const origins = this.impactOrigins(type.impact_direction, relationship);
      const weight = this.edgeImpactWeight(relationship);
      for (const nodeId of origins) {
        const score = scores.get(nodeId);
        if (!score) continue;
        score.raw_score += weight * (1 + relationship.risk);
        score.direct_relationships += 1;
        score.cumulative_cost += relationship.cost;
        score.max_risk = Math.max(score.max_risk, relationship.risk);
      }
    }
    const maximum = Math.max(1, ...[...scores.values()].map((score) => score.raw_score));
    const items = [...scores.entries()]
      .map(([node_id, score]) => ({
        node: this.publicNodeSummary(state.nodes.get(node_id) as TwinNode),
        node_id,
        criticality_score: this.round(score.raw_score / maximum),
        method: 'weighted_direct_impact_exposure/1.0.0',
        direct_relationships: score.direct_relationships,
        cumulative_cost: this.round(score.cumulative_cost),
        max_risk: score.max_risk,
      }))
      .filter((item) => item.direct_relationships > 0)
      .sort((left, right) => right.criticality_score - left.criticality_score || right.max_risk - left.max_risk || left.node_id.localeCompare(right.node_id));
    return {
      items: items.slice(0, limit),
      has_more: items.length > limit,
      method: {
        name: 'weighted_direct_impact_exposure',
        version: '1.0.0',
        note: 'Criticality is based on declared graph weights, not inferred employee performance or future business outcomes.',
      },
      graph_version: state.metadata.version,
      data_watermark: this.watermark(state),
    };
  }

  private async state(tenantId: string, forceRefresh = false): Promise<TenantGraphState> {
    const cached = this.states.get(tenantId);
    if (!this.database.enabled) {
      if (cached) return cached;
      const state = this.emptyState(tenantId);
      this.states.set(tenantId, state);
      return state;
    }
    const metadata = await this.database.get<TwinGraphMetadata>(tenantId, GRAPH_METADATA_KIND, this.metadataId(tenantId));
    if (cached && metadata && !forceRefresh && cached.metadata.version === metadata.version) return cached;
    if (!metadata) {
      if (cached && !forceRefresh) return cached;
      const state = this.emptyState(tenantId);
      this.states.set(tenantId, state);
      return state;
    }
    const [nodeTypes, relationshipTypes, nodes, relationships, history] = await Promise.all([
      this.database.list<TwinTypeDefinition>(tenantId, NODE_TYPE_KIND),
      this.database.list<TwinRelationshipTypeDefinition>(tenantId, RELATIONSHIP_TYPE_KIND),
      this.database.list<TwinNode>(tenantId, NODE_KIND),
      this.database.list<TwinRelationship>(tenantId, RELATIONSHIP_KIND),
      this.database.list<TwinGraphHistoryEvent>(tenantId, HISTORY_KIND),
    ]);
    const state = this.emptyState(tenantId);
    state.metadata = metadata;
    state.persisted = true;
    for (const definition of nodeTypes) if (definition?.type_id && !definition.is_system) state.nodeTypes.set(definition.type_id, definition);
    for (const definition of relationshipTypes) if (definition?.type_id && !definition.is_system) state.relationshipTypes.set(definition.type_id, definition);
    for (const node of nodes) if (node?.node_id && node.tenant_id === tenantId) state.nodes.set(node.node_id, node);
    for (const relationship of relationships) if (relationship?.relationship_id && relationship.tenant_id === tenantId) state.relationships.set(relationship.relationship_id, relationship);
    for (const event of history) if (event?.event_id && event.tenant_id === tenantId) state.history.set(event.event_id, event);
    this.states.set(tenantId, state);
    return state;
  }

  private emptyState(tenantId: string): TenantGraphState {
    return {
      metadata: {
        metadata_id: this.metadataId(tenantId),
        tenant_id: tenantId,
        schema_version: TWIN_GRAPH_SCHEMA_VERSION,
        version: 0,
        updated_at: SYSTEM_TYPE_TIMESTAMP,
      },
      persisted: false,
      nodeTypes: new Map<string, TwinTypeDefinition>(this.coreNodeTypes().map((definition): [string, TwinTypeDefinition] => [definition.type_id, definition])),
      relationshipTypes: new Map<string, TwinRelationshipTypeDefinition>(this.coreRelationshipTypes().map((definition): [string, TwinRelationshipTypeDefinition] => [definition.type_id, definition])),
      nodes: new Map(),
      relationships: new Map(),
      history: new Map(),
    };
  }

  private async commit(ctx: RequestContext, state: TenantGraphState, mutation: GraphMutation): Promise<{ replayed: boolean }> {
    const nextMetadata: TwinGraphMetadata = {
      ...state.metadata,
      version: state.metadata.version + 1,
      updated_at: nowIso(),
    };
    const audit: EventMutationAudit = {
      audit_id: newId(),
      tenant_sequence: 0,
      action: mutation.action,
      actor_id: ctx.actor.actor_id,
      resource_type: mutation.aggregateType,
      resource_id: mutation.aggregateId,
      occurred_at: nowIso(),
      request_id: ctx.requestId,
      trace_id: traceId(),
      details_hash: sha256({ action: mutation.action, aggregate_id: mutation.aggregateId, aggregate_version: mutation.aggregateVersion, history_event_id: mutation.history.event_id }),
      previous_hash: '',
      event_hash: '',
    };
    const history = structuredClone(mutation.history);
    const records: EventMutationRecord[] = [
      { kind: GRAPH_METADATA_KIND, id: nextMetadata.metadata_id, payload: nextMetadata },
      ...mutation.records,
      { kind: HISTORY_KIND, id: history.event_id, payload: history },
    ];
    const guard: EventMutationGuard = {
      idempotency: {
        operation: `${ctx.actor.actor_id}:${mutation.action}`,
        key: mutation.idempotencyKey,
        requestHash: mutation.requestHash,
        responseRef: history.event_id,
        // Node and relationship IDs are deterministically derived from this
        // key so an expired key must not be recycled into an existing graph
        // record. Retain the reservation for the graph audit-retention window.
        expiresAt: new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1_000).toISOString(),
      },
      expectedRecords: state.persisted
        ? [{ kind: GRAPH_METADATA_KIND, id: state.metadata.metadata_id, expected: { version: state.metadata.version } }]
        // The first write must atomically claim the tenant metadata record.
        // Without this guard two cold API replicas could both commit version 1.
        : [{ kind: GRAPH_METADATA_KIND, id: state.metadata.metadata_id, absent: true }],
    };
    try {
      const result = await this.database.commitEventMutation(
        ctx.tenantId,
        records,
        audit,
        {
          eventId: newId(),
          eventType: mutation.eventType,
          aggregateType: mutation.aggregateType,
          aggregateId: mutation.aggregateId,
          aggregateVersion: mutation.aggregateVersion,
          payload: {
            tenant_id: ctx.tenantId,
            aggregate_id: mutation.aggregateId,
            aggregate_version: mutation.aggregateVersion,
            graph_version: nextMetadata.version,
            history_event_id: history.event_id,
            outbox_position: 0,
          },
        },
        guard,
      );
      if (result.replayed) {
        if (this.database.enabled) this.states.delete(ctx.tenantId);
        return { replayed: true };
      }
    } catch (error) {
      if (error instanceof DatabaseMutationConflict) {
        this.states.delete(ctx.tenantId);
        const status = error.code === 'idempotency_key_reused' ? HttpStatus.CONFLICT : HttpStatus.CONFLICT;
        throw new ProblemException(status, error.code, error.message, error.code === 'idempotency_request_in_progress');
      }
      throw error;
    }
    state.metadata = nextMetadata;
    state.persisted = true;
    state.history.set(history.event_id, history);
    for (const record of records) {
      if (record.kind !== HISTORY_KIND || record.id === history.event_id) continue;
      const extra = record.payload as TwinGraphHistoryEvent;
      if (extra?.event_id) state.history.set(extra.event_id, extra);
    }
    return { replayed: false };
  }

  private historyEvent(
    ctx: RequestContext,
    eventType: string,
    resourceKind: TwinGraphHistoryEvent['resource_kind'],
    resourceId: string,
    resourceVersion: number,
    beforeHash: string | null,
    afterHash: string | null,
    changedFields: string[],
    details: Record<string, unknown>,
    eventId = newId(),
  ): TwinGraphHistoryEvent {
    return {
      event_id: eventId,
      tenant_id: ctx.tenantId,
      event_type: eventType,
      resource_kind: resourceKind,
      resource_id: resourceId,
      resource_version: resourceVersion,
      actor_id: ctx.actor.actor_id,
      occurred_at: nowIso(),
      before_hash: beforeHash,
      after_hash: afterHash,
      changed_fields: [...new Set(changedFields)].sort(),
      details: this.safeRecord(details, 'history details', MAX_METADATA_BYTES),
    };
  }

  private nodeMutationView(state: TenantGraphState, node: TwinNode): Record<string, unknown> {
    return {
      node: this.nodeWithHistory(state, node),
      graph_version: state.metadata.version,
      data_watermark: this.watermark(state),
      etag: etag(node.state_hash),
    };
  }

  private relationshipMutationView(state: TenantGraphState, relationship: TwinRelationship): Record<string, unknown> {
    return {
      relationship: this.relationshipWithHistory(state, relationship),
      graph_version: state.metadata.version,
      data_watermark: this.watermark(state),
      etag: etag(relationship.state_hash),
    };
  }

  private dependencyReachability(
    ctx: RequestContext,
    state: TenantGraphState,
    rootId: string,
    typeId: string,
    direction: 'outbound' | 'inbound',
    maxDepth: number,
  ): Array<Record<string, unknown>> {
    const results = new Map<string, DependencyResult>();
    const queue: DependencyResult[] = [{ node_id: rootId, depth: 0, path: [rootId] }];
    while (queue.length) {
      const current = queue.shift() as DependencyResult;
      if (current.depth >= maxDepth) continue;
      for (const relationship of this.visibleRelationshipsForNode(ctx, state, current.node_id, new Set([typeId]))) {
        const next = this.nextTraversalNode(relationship, current.node_id, direction);
        if (!next || next === rootId || results.has(next)) continue;
        const node = state.nodes.get(next);
        if (!node || !this.canReadNode(ctx, node)) continue;
        const result = { node_id: next, depth: current.depth + 1, path: [...current.path, next] };
        results.set(next, result);
        queue.push(result);
      }
    }
    return [...results.values()]
      .sort((left, right) => left.depth - right.depth || left.node_id.localeCompare(right.node_id))
      .map((result) => ({ ...result, node: this.publicNodeSummary(state.nodes.get(result.node_id) as TwinNode) }));
  }

  private visibleRelationshipsForNode(
    ctx: RequestContext,
    state: TenantGraphState,
    nodeId: string,
    typeFilter: Set<string>,
  ): TwinRelationship[] {
    return [...state.relationships.values()].filter((relationship) => (
      relationship.state === 'active'
      && (relationship.source_node_id === nodeId || relationship.target_node_id === nodeId)
      && (!typeFilter.size || typeFilter.has(relationship.type_id))
      && this.canReadRelationship(ctx, state, relationship)
    ));
  }

  private impactRelationshipsForNode(
    ctx: RequestContext,
    state: TenantGraphState,
    nodeId: string,
    typeFilter: Set<string>,
  ): TwinRelationship[] {
    return this.visibleRelationshipsForNode(ctx, state, nodeId, typeFilter).filter((relationship) => this.nextImpactNode(state, relationship, nodeId) !== null);
  }

  private nextTraversalNode(
    relationship: TwinRelationship,
    currentNodeId: string,
    direction: 'outbound' | 'inbound' | 'both',
  ): string | null {
    if (direction === 'outbound' && relationship.source_node_id === currentNodeId) return relationship.target_node_id;
    if (direction === 'inbound' && relationship.target_node_id === currentNodeId) return relationship.source_node_id;
    if (direction === 'both') {
      if (relationship.source_node_id === currentNodeId) return relationship.target_node_id;
      if (relationship.target_node_id === currentNodeId) return relationship.source_node_id;
    }
    return null;
  }

  private nextImpactNode(state: TenantGraphState, relationship: TwinRelationship, currentNodeId: string): string | null {
    const type = state.relationshipTypes.get(relationship.type_id);
    if (!type) return null;
    if (type.impact_direction === 'forward' && relationship.source_node_id === currentNodeId) return relationship.target_node_id;
    if (type.impact_direction === 'reverse' && relationship.target_node_id === currentNodeId) return relationship.source_node_id;
    if (type.impact_direction === 'bidirectional') {
      if (relationship.source_node_id === currentNodeId) return relationship.target_node_id;
      if (relationship.target_node_id === currentNodeId) return relationship.source_node_id;
    }
    return null;
  }

  private impactOrigins(direction: ImpactDirection, relationship: TwinRelationship): string[] {
    if (direction === 'forward') return [relationship.source_node_id];
    if (direction === 'reverse') return [relationship.target_node_id];
    if (direction === 'bidirectional') return [relationship.source_node_id, relationship.target_node_id];
    return [];
  }

  private edgeImpactWeight(relationship: TwinRelationship): number {
    // Importance and risk deliberately stay user-declared. We do not infer people
    // scores, causal claims, or future revenue from the graph shape.
    return Math.max(0.0001, this.round(relationship.strength * relationship.confidence * relationship.importance * (1 + relationship.risk) / 2));
  }

  private createsCycle(state: TenantGraphState, typeId: string, sourceId: string, targetId: string, excludedRelationshipId?: string): boolean {
    const visited = new Set<string>();
    const queue = [targetId];
    while (queue.length) {
      const current = queue.shift() as string;
      if (current === sourceId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const relationship of state.relationships.values()) {
        if (relationship.relationship_id === excludedRelationshipId || relationship.state !== 'active' || relationship.type_id !== typeId) continue;
        if (relationship.source_node_id === current && !visited.has(relationship.target_node_id)) queue.push(relationship.target_node_id);
      }
    }
    return false;
  }

  private archiveRelationship(relationship: TwinRelationship, actorId: string): TwinRelationship {
    const archived: TwinRelationship = {
      ...structuredClone(relationship),
      state: 'archived',
      version: relationship.version + 1,
      updated_at: nowIso(),
      updated_by: actorId,
      state_hash: '',
    };
    archived.state_hash = this.relationshipHash(archived);
    return archived;
  }

  private readableNode(ctx: RequestContext, state: TenantGraphState, nodeId: string): TwinNode {
    const node = state.nodes.get(nodeId);
    if (!node || !this.canReadNode(ctx, node)) throw this.notFound();
    return node;
  }

  private nodeForMutation(state: TenantGraphState, nodeId: string): TwinNode {
    if (!UUID.test(nodeId)) throw this.notFound();
    const node = state.nodes.get(nodeId);
    if (!node) throw this.notFound();
    return node;
  }

  private activeNodeForMutation(state: TenantGraphState, nodeId: string): TwinNode {
    const node = this.nodeForMutation(state, nodeId);
    if (node.state !== 'active') throw this.invalid('node_archived', 'Archived nodes cannot be used as active relationship endpoints.');
    return node;
  }

  private readableRelationship(ctx: RequestContext, state: TenantGraphState, relationshipId: string): TwinRelationship {
    const relationship = state.relationships.get(relationshipId);
    if (!relationship || !this.canReadRelationship(ctx, state, relationship)) throw this.notFound();
    return relationship;
  }

  private relationshipForMutation(state: TenantGraphState, relationshipId: string): TwinRelationship {
    if (!UUID.test(relationshipId)) throw this.notFound();
    const relationship = state.relationships.get(relationshipId);
    if (!relationship) throw this.notFound();
    return relationship;
  }

  private canReadRelationship(ctx: RequestContext, state: TenantGraphState, relationship: TwinRelationship): boolean {
    const source = state.nodes.get(relationship.source_node_id);
    const target = state.nodes.get(relationship.target_node_id);
    return Boolean(source && target && this.canReadNode(ctx, source) && this.canReadNode(ctx, target) && this.canReadClassification(ctx, relationship.metadata.classification));
  }

  private canReadNode(ctx: RequestContext, node: TwinNode): boolean {
    return this.canReadClassification(ctx, node.metadata.classification);
  }

  private canReadClassification(ctx: RequestContext, classification: TwinClassification): boolean {
    if (ctx.actor.capabilities.includes('connector.admin')) return true;
    if (classification === 'public') return true;
    if (classification === 'restricted') return false;
    const evidenceCapabilities = ctx.actor.capabilities.filter((capability) => capability.startsWith('evidence.read.'));
    if (evidenceCapabilities.some((capability) => !capability.endsWith('_public'))) return true;
    return ctx.actor.capabilities.includes('scenario.create') && classification === 'internal';
  }

  private assertRead(ctx: RequestContext): void {
    const permitted = ctx.actor.capabilities.includes('connector.admin')
      || ctx.actor.capabilities.includes('scenario.create')
      || ctx.actor.capabilities.some((capability) => capability.startsWith('evidence.read.'));
    if (!permitted || ctx.actor.actor_alias === 'usr_platform_operator') {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'twin_graph_read_denied', 'Digital twin graph access is not authorized.');
    }
  }

  private assertAdmin(ctx: RequestContext): void {
    if (!ctx.actor.capabilities.includes('connector.admin')) {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'twin_graph_write_denied', 'Digital twin graph changes require a tenant graph administrator.');
    }
  }

  private resolveNodeTypeId(state: TenantGraphState, raw: string): string {
    if (state.nodeTypes.has(raw)) return raw;
    const matches = [...state.nodeTypes.values()].filter((definition) => (
      definition.type_id.slice(definition.type_id.lastIndexOf('/') + 1).toLocaleLowerCase('en-US') === raw.toLocaleLowerCase('en-US')
      || definition.display_name.toLocaleLowerCase('en-US') === raw.toLocaleLowerCase('en-US')
    ));
    if (matches.length === 1) return matches[0].type_id;
    throw this.invalid('unknown_node_type', 'The supplied node type is not registered for this tenant.');
  }

  private resolveRelationshipTypeId(state: TenantGraphState, raw: string): string {
    if (state.relationshipTypes.has(raw)) return raw;
    const matches = [...state.relationshipTypes.values()].filter((definition) => (
      definition.type_id.slice(definition.type_id.lastIndexOf('/') + 1).toLocaleLowerCase('en-US') === raw.toLocaleLowerCase('en-US')
      || definition.display_name.toLocaleLowerCase('en-US') === raw.toLocaleLowerCase('en-US')
    ));
    if (matches.length === 1) return matches[0].type_id;
    throw this.invalid('unknown_relationship_type', 'The supplied relationship type is not registered for this tenant.');
  }

  private relationshipType(state: TenantGraphState, raw: string): TwinRelationshipTypeDefinition {
    return state.relationshipTypes.get(this.resolveRelationshipTypeId(state, raw)) as TwinRelationshipTypeDefinition;
  }

  private assertAllowedEndpoints(type: TwinRelationshipTypeDefinition, source: TwinNode, target: TwinNode): void {
    if (type.allowed_source_types.length && !type.allowed_source_types.includes(source.type_id)) {
      throw this.invalid('relationship_source_type_invalid', `Relationship type ${type.type_id} does not allow source node type ${source.type_id}.`);
    }
    if (type.allowed_target_types.length && !type.allowed_target_types.includes(target.type_id)) {
      throw this.invalid('relationship_target_type_invalid', `Relationship type ${type.type_id} does not allow target node type ${target.type_id}.`);
    }
  }

  private ownerId(state: TenantGraphState, raw: unknown): string | null {
    if (raw === undefined || raw === null || raw === '') return null;
    const value = this.requiredString(raw, 'owner_id', 64);
    const owner = this.activeNodeForMutation(state, value);
    return owner.node_id;
  }

  private typeList(raw: unknown, field: string, state: TenantGraphState): string[] {
    if (raw === undefined) return [];
    return [...new Set(this.stringArray(raw, field, 100, 128).map((item) => this.resolveNodeTypeId(state, item)))].sort();
  }

  private propertySchema(raw: unknown): Record<string, unknown> {
    const schema = this.safeRecord(raw, 'property_schema', MAX_METADATA_BYTES);
    this.assertExactKeys(schema, ['type', 'required', 'properties', 'additionalProperties'], 'property_schema');
    if (schema.type !== undefined && schema.type !== 'object') {
      throw this.invalid('invalid_property_schema', 'property_schema.type, when supplied, must be object.');
    }
    const required = schema.required === undefined ? [] : this.stringArray(schema.required, 'property_schema.required', 100, 120);
    if (schema.additionalProperties !== undefined) this.optionalBoolean(schema.additionalProperties, 'property_schema.additionalProperties');
    if (schema.properties !== undefined) {
      const properties = this.safeRecord(schema.properties, 'property_schema.properties', MAX_METADATA_BYTES);
      if (required.some((name) => !Object.prototype.hasOwnProperty.call(properties, name))) {
        throw this.invalid('invalid_property_schema', 'Every required property must have a property definition.');
      }
      for (const [name, rawDefinition] of Object.entries(properties)) {
        const definition = this.safeRecord(rawDefinition, `property_schema.properties.${name}`, MAX_METADATA_BYTES);
        this.assertExactKeys(definition, ['type', 'enum', 'maxLength'], `property_schema.properties.${name}`);
        if (definition.type !== undefined && !['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(String(definition.type))) {
          throw this.invalid('invalid_property_schema', `property_schema.properties.${name}.type is unsupported.`);
        }
        if (definition.enum !== undefined) {
          if (!Array.isArray(definition.enum) || definition.enum.length > 100 || definition.enum.some((value) => value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')) {
            throw this.invalid('invalid_property_schema', `property_schema.properties.${name}.enum must contain at most 100 JSON scalar values.`);
          }
        }
        if (definition.maxLength !== undefined) this.boundedInteger(definition.maxLength, `property_schema.properties.${name}.maxLength`, 0, 16_384);
      }
    } else if (required.length) {
      throw this.invalid('invalid_property_schema', 'property_schema.required requires property_schema.properties definitions.');
    }
    return schema;
  }

  private validateNodeProperties(definition: TwinTypeDefinition, properties: Record<string, unknown>): void {
    const schema = definition.property_schema;
    if (!Object.keys(schema).length) return;
    const required = schema.required === undefined ? [] : this.stringArray(schema.required, 'property_schema.required', 100, 120);
    const definitions = schema.properties === undefined ? {} : this.safeRecord(schema.properties, 'property_schema.properties', MAX_METADATA_BYTES);
    for (const name of required) {
      if (!Object.prototype.hasOwnProperty.call(properties, name)) {
        throw this.invalid('required_property_missing', `Node type ${definition.type_id} requires property ${name}.`);
      }
    }
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(properties).filter((name) => !Object.prototype.hasOwnProperty.call(definitions, name));
      if (unknown.length) throw this.invalid('unknown_typed_property', `Node type ${definition.type_id} does not allow property ${unknown.sort().join(', ')}.`);
    }
    for (const [name, value] of Object.entries(properties)) {
      const rawRule = definitions[name];
      if (rawRule === undefined) continue;
      const rule = this.safeRecord(rawRule, `property_schema.properties.${name}`, MAX_METADATA_BYTES);
      const type = rule.type;
      if (type !== undefined && !this.matchesPropertyType(value, String(type))) {
        throw this.invalid('typed_property_invalid', `Node property ${name} does not match the ${String(type)} type required by ${definition.type_id}.`);
      }
      if (Array.isArray(rule.enum) && !rule.enum.some((candidate) => sha256({ value: candidate }) === sha256({ value }))) {
        throw this.invalid('typed_property_invalid', `Node property ${name} is not an allowed value for ${definition.type_id}.`);
      }
      if (rule.maxLength !== undefined && typeof value === 'string' && value.length > this.boundedInteger(rule.maxLength, `property_schema.properties.${name}.maxLength`, 0, 16_384)) {
        throw this.invalid('typed_property_invalid', `Node property ${name} exceeds its configured maximum length.`);
      }
    }
  }

  private matchesPropertyType(value: unknown, type: string): boolean {
    if (type === 'string') return typeof value === 'string';
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return Boolean(value && typeof value === 'object' && !Array.isArray(value));
    return false;
  }

  private sourceData(raw: unknown, resourceId: string, defaultClassification: TwinClassification): TwinSourceData[] {
    if (raw === undefined || raw === null) {
      return [{
        source_system: 'manual',
        source_record_id: `manual:${resourceId}`,
        observed_at: nowIso(),
        classification: defaultClassification,
      }];
    }
    const values = Array.isArray(raw) ? raw : [raw];
    if (!values.length || values.length > MAX_SOURCE_ITEMS) throw this.invalid('invalid_source_data', `source_data must contain 1 to ${MAX_SOURCE_ITEMS} entries.`);
    return values.map((value, index) => {
      const record = this.safeRecord(value, `source_data[${index}]`, MAX_METADATA_BYTES);
      this.assertExactKeys(record, ['source_system', 'source_record_id', 'source_revision', 'observed_at', 'content_hash', 'classification', 'locator', 'attributes'], `source_data[${index}]`);
      const observedAt = this.optionalString(record.observed_at, `source_data[${index}].observed_at`, 64) ?? nowIso();
      if (Number.isNaN(Date.parse(observedAt))) throw this.invalid('invalid_source_data', `source_data[${index}].observed_at must be an ISO timestamp.`);
      const contentHash = this.optionalString(record.content_hash, `source_data[${index}].content_hash`, 64);
      if (contentHash && !/^[a-f0-9]{64}$/i.test(contentHash)) throw this.invalid('invalid_source_data', `source_data[${index}].content_hash must be a SHA-256 hash.`);
      const locator = this.optionalString(record.locator, `source_data[${index}].locator`, 1_000);
      if (locator && /\s/.test(locator)) throw this.invalid('invalid_source_data', `source_data[${index}].locator must be an opaque URI or identifier without whitespace.`);
      return {
        source_system: this.requiredString(record.source_system, `source_data[${index}].source_system`, 120),
        source_record_id: this.requiredString(record.source_record_id, `source_data[${index}].source_record_id`, 500),
        ...(this.optionalString(record.source_revision, `source_data[${index}].source_revision`, 200) ? { source_revision: this.optionalString(record.source_revision, `source_data[${index}].source_revision`, 200) } : {}),
        observed_at: observedAt,
        ...(contentHash ? { content_hash: contentHash.toLowerCase() } : {}),
        classification: this.classification(record.classification ?? defaultClassification),
        ...(locator ? { locator } : {}),
        ...(record.attributes === undefined ? {} : { attributes: this.safeRecord(record.attributes, `source_data[${index}].attributes`, MAX_METADATA_BYTES) }),
      };
    });
  }

  private metadata(raw: Record<string, unknown>, sources: TwinSourceData[], endpointClassifications: TwinClassification[] = []): Record<string, unknown> & { classification: TwinClassification } {
    const classification = this.classification(raw.classification ?? 'internal');
    const required = this.maximumClassification([classification, ...sources.map((source) => source.classification), ...endpointClassifications]);
    if (classification !== required) {
      throw this.invalid('classification_weakened', 'Metadata classification cannot be less restrictive than source data or an endpoint classification.');
    }
    return { ...raw, classification } as Record<string, unknown> & { classification: TwinClassification };
  }

  private descriptorArray(raw: unknown, field: string): Array<Record<string, unknown>> {
    if (!Array.isArray(raw) || raw.length > MAX_DESCRIPTOR_ITEMS) {
      throw this.invalid('invalid_descriptor_array', `${field} must be an array containing at most ${MAX_DESCRIPTOR_ITEMS} objects.`);
    }
    return raw.map((item, index) => this.safeRecord(item, `${field}[${index}]`, MAX_DESCRIPTOR_BYTES));
  }

  private nodeHash(node: TwinNode): string {
    const { state_hash: _hash, ...domain } = node;
    return sha256(domain);
  }

  private relationshipHash(relationship: TwinRelationship): string {
    const { state_hash: _hash, ...domain } = relationship;
    return sha256(domain);
  }

  private changedFields(before: object, after: object): string[] {
    const previous = before as Record<string, unknown>;
    const current = after as Record<string, unknown>;
    return [...new Set([...Object.keys(previous), ...Object.keys(current)])]
      .filter((key) => key !== 'state_hash' && sha256({ value: previous[key] }) !== sha256({ value: current[key] }))
      .sort();
  }

  private historyFor(state: TenantGraphState, resourceKind: TwinGraphHistoryEvent['resource_kind'], resourceId: string): TwinGraphHistoryEvent[] {
    return [...state.history.values()]
      .filter((event) => event.resource_kind === resourceKind && event.resource_id === resourceId)
      .sort((left, right) => right.resource_version - left.resource_version || right.occurred_at.localeCompare(left.occurred_at) || right.event_id.localeCompare(left.event_id))
      .slice(0, MAX_HISTORY_PER_RESPONSE)
      .map((event) => structuredClone(event));
  }

  private publicNodeSummary(node: TwinNode): Record<string, unknown> {
    return {
      node_id: node.node_id,
      type_id: node.type_id,
      label: node.label,
      owner_id: node.owner_id,
      confidence_score: node.confidence_score,
      classification: node.metadata.classification,
      state: node.state,
      version: node.version,
      updated_at: node.updated_at,
    };
  }

  private publicNode(node: TwinNode): Record<string, unknown> {
    return structuredClone(node) as unknown as Record<string, unknown>;
  }

  private nodeWithHistory(state: TenantGraphState, node: TwinNode): Record<string, unknown> {
    const history = this.historyFor(state, 'node', node.node_id);
    return { ...this.publicNode(node), history, events: history };
  }

  private publicRelationship(relationship: TwinRelationship): Record<string, unknown> {
    return structuredClone(relationship) as unknown as Record<string, unknown>;
  }

  private relationshipWithHistory(state: TenantGraphState, relationship: TwinRelationship): Record<string, unknown> {
    const history = this.historyFor(state, 'relationship', relationship.relationship_id);
    return { ...this.publicRelationship(relationship), history };
  }

  private publicType(definition: TwinTypeDefinition): Record<string, unknown> {
    return structuredClone(definition) as unknown as Record<string, unknown>;
  }

  private publicRelationshipType(definition: TwinRelationshipTypeDefinition): Record<string, unknown> {
    return structuredClone(definition) as unknown as Record<string, unknown>;
  }

  private nodeMatches(node: TwinNode, term: string): boolean {
    const haystack = [node.label, node.type_id, JSON.stringify(node.properties), JSON.stringify(node.metadata)].join(' ').toLocaleLowerCase('en-US');
    return term.split(/\s+/).every((token) => haystack.includes(token));
  }

  private nodeClassification(node: TwinNode): TwinClassification {
    return this.classification(node.metadata.classification);
  }

  private maximumClassification(values: TwinClassification[]): TwinClassification {
    const order = new Map<TwinClassification, number>(CLASSIFICATIONS.map((item, index): [TwinClassification, number] => [item, index]));
    return values.reduce((maximum, value) => (order.get(value) as number) > (order.get(maximum) as number) ? value : maximum, 'public' as TwinClassification);
  }

  private classification(value: unknown): TwinClassification {
    if (typeof value !== 'string' || !CLASSIFICATIONS.includes(value as TwinClassification)) {
      throw this.invalid('invalid_classification', `classification must be one of ${CLASSIFICATIONS.join(', ')}.`);
    }
    return value as TwinClassification;
  }

  private nodeState(value: unknown): TwinNodeState {
    if (typeof value !== 'string' || !(['active', 'archived'] as string[]).includes(value)) {
      throw this.invalid('invalid_node_state', 'Node state must be active or archived.');
    }
    return value as TwinNodeState;
  }

  private relationshipState(value: unknown): TwinRelationshipState {
    if (typeof value !== 'string' || !RELATIONSHIP_STATES.includes(value as TwinRelationshipState)) {
      throw this.invalid('invalid_relationship_state', 'Relationship state must be active or archived.');
    }
    return value as TwinRelationshipState;
  }

  private impactDirection(value: unknown): ImpactDirection {
    if (value === 'forward' || value === 'reverse' || value === 'bidirectional' || value === 'none') return value;
    throw this.invalid('invalid_impact_direction', 'impact_direction must be forward, reverse, bidirectional, or none.');
  }

  private traversalDirection(value: unknown): 'outbound' | 'inbound' | 'both' {
    if (value === 'outbound' || value === 'inbound' || value === 'both') return value;
    throw this.invalid('invalid_traversal_direction', 'direction must be outbound, inbound, or both.');
  }

  private score(value: unknown, field: string): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw this.invalid('invalid_score', `${field} must be a finite number from 0 to 1.`);
    return parsed;
  }

  private cost(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000_000_000) throw this.invalid('invalid_cost', 'cost must be a finite non-negative number within the supported range.');
    return parsed;
  }

  private searchTerm(value: unknown): string {
    const term = this.requiredString(value, 'query', 128).toLocaleLowerCase('en-US').trim();
    if (!term) throw this.invalid('invalid_search_query', 'query must contain a non-whitespace search term.');
    return term;
  }

  private stringArray(value: unknown, field: string, maximumItems: number, maximumLength: number): string[] {
    if (!Array.isArray(value) || value.length > maximumItems) throw this.invalid('invalid_array', `${field} must be an array containing at most ${maximumItems} strings.`);
    return value.map((item, index) => this.requiredString(item, `${field}[${index}]`, maximumLength));
  }

  private boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
      throw this.invalid('invalid_bound', `${field} must be an integer between ${minimum} and ${maximum}.`);
    }
    return parsed;
  }

  private optionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') throw this.invalid('invalid_boolean', `${field} must be a boolean.`);
    return value;
  }

  private requiredString(value: unknown, field: string, maximumLength: number): string {
    if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
      throw this.invalid('invalid_string', `${field} must be a non-empty string up to ${maximumLength} characters.`);
    }
    return value.trim();
  }

  private optionalString(value: unknown, field: string, maximumLength: number): string | undefined {
    if (value === undefined || value === null) return undefined;
    return this.requiredString(value, field, maximumLength);
  }

  private safeRecord(value: unknown, field: string, maximumBytes: number): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw this.invalid('invalid_object', `${field} must be an object.`);
    this.assertSafeJson(value, field, new Set<object>());
    const serialized = JSON.stringify(value);
    if (serialized.length > maximumBytes) throw this.invalid('payload_too_large', `${field} exceeds its ${maximumBytes}-byte limit.`);
    // Normalize parser-specific null-prototype objects at the trust boundary.
    // The recursive validation above has already rejected non-JSON values,
    // cycles, unsafe keys, and secret-shaped fields.
    return JSON.parse(serialized) as Record<string, unknown>;
  }

  private assertSafeJson(value: unknown, path: string, ancestors: Set<object>): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw this.invalid('invalid_json', `${path} contains a non-finite number.`);
      return;
    }
    if (typeof value !== 'object') throw this.invalid('invalid_json', `${path} contains a non-JSON value.`);
    const object = value as object;
    if (ancestors.has(object)) throw this.invalid('invalid_json', `${path} contains a circular reference.`);
    const prototype = Object.getPrototypeOf(object);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw this.invalid('invalid_json', `${path} must contain only plain JSON objects.`);
    ancestors.add(object);
    if (Array.isArray(value)) {
      value.forEach((item, index) => this.assertSafeJson(item, `${path}[${index}]`, ancestors));
    } else {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw this.invalid('unsafe_property_key', `${path} contains a forbidden property key.`);
        if (SECRET_KEY_PATTERN.test(key)) throw this.invalid('secret_property_rejected', `${path}.${key} appears to contain a secret. Store only a governed SecretReference, never secret material.`);
        this.assertSafeJson(item, `${path}.${key}`, ancestors);
      }
    }
    ancestors.delete(object);
  }

  private assertExactKeys(record: Record<string, unknown>, allowlist: string[], label: string): void {
    const unexpected = Object.keys(record).filter((key) => !allowlist.includes(key));
    if (unexpected.length) throw this.invalid('unknown_request_field', `${label} contains unsupported field(s): ${unexpected.sort().join(', ')}.`);
  }

  private assertEtag(value: string | undefined, currentHash: string, resource: string): void {
    if (!value) throw new ProblemException(HttpStatus.PRECONDITION_REQUIRED, 'if_match_required', `If-Match is required to update a ${resource}.`);
    if (value !== etag(currentHash)) throw new ProblemException(HttpStatus.PRECONDITION_FAILED, 'graph_precondition_failed', `The ${resource} changed; refresh before updating it.`);
  }

  private metadataId(tenantId: string): string {
    return stableUuid(`twin-graph-metadata:${tenantId}`);
  }

  private resourceId(ctx: RequestContext, action: string, idempotencyKey: string): string {
    return stableUuid(`twin-graph-resource:${ctx.tenantId}:${ctx.actor.actor_id}:${action}:${idempotencyKey}`);
  }

  private historyId(ctx: RequestContext, action: string, idempotencyKey: string): string {
    return stableUuid(`twin-graph-history:${ctx.tenantId}:${ctx.actor.actor_id}:${action}:${idempotencyKey}`);
  }

  private async stateAfterReplay(ctx: RequestContext, fallback: TenantGraphState): Promise<TenantGraphState> {
    return this.database.enabled ? this.state(ctx.tenantId, true) : fallback;
  }

  private nodeTypeRecordId(tenantId: string, typeId: string): string {
    return stableUuid(`twin-node-type:${tenantId}:${typeId}`);
  }

  private relationshipTypeRecordId(tenantId: string, typeId: string): string {
    return stableUuid(`twin-relationship-type:${tenantId}:${typeId}`);
  }

  private watermark(state: TenantGraphState): Record<string, unknown> {
    return {
      authoritative_store: 'postgresql',
      graph_schema_version: TWIN_GRAPH_SCHEMA_VERSION,
      graph_version: state.metadata.version,
      updated_at: state.metadata.updated_at,
      projection_status: 'authoritative_records_available_for_projection',
    };
  }

  private round(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
  }

  private invalid(code: string, detail: string): ProblemException {
    return new ProblemException(HttpStatus.BAD_REQUEST, code, detail);
  }

  private conflict(code: string, detail: string): ProblemException {
    return new ProblemException(HttpStatus.CONFLICT, code, detail);
  }

  private notFound(): ProblemException {
    return new ProblemException(HttpStatus.NOT_FOUND, 'not_found', 'The resource was not found.');
  }

  private coreNodeTypes(): TwinTypeDefinition[] {
    const groups: Array<[string, string, string]> = [
      ['Organization', 'Organization', 'Legal or operating organization.'],
      ['Company', 'Organization', 'Company or legal entity.'],
      ['Department', 'Organization', 'Department within an organization.'],
      ['Team', 'Organization', 'Team of people or services.'],
      ['Employee', 'Organization', 'Time-bounded employee engagement; do not use for prohibited workforce scoring.'],
      ['Role', 'Organization', 'Role, responsibility, or position.'],
      ['Location', 'Organization', 'Physical or logical location.'],
      ['Customer', 'Business', 'Customer, account, or buyer organization.'],
      ['Product', 'Business', 'Product or offering.'],
      ['Service', 'Business', 'Business or technology service.'],
      ['Project', 'Business', 'Project, programme, or initiative.'],
      ['Contract', 'Business', 'Contract or commercial agreement metadata.'],
      ['Vendor', 'Business', 'Vendor or supplier.'],
      ['Partner', 'Business', 'Strategic or delivery partner.'],
      ['Application', 'Technology', 'Application or workload.'],
      ['Database', 'Technology', 'Database service or datastore.'],
      ['Server', 'Technology', 'Server, VM, or compute host.'],
      ['CloudResource', 'Technology', 'Cloud resource.'],
      ['API', 'Technology', 'Application programming interface.'],
      ['Repository', 'Technology', 'Source-code repository.'],
      ['Process', 'Operations', 'Operational process.'],
      ['Workflow', 'Operations', 'Workflow definition or execution.'],
      ['Task', 'Operations', 'Task or work item.'],
      ['Asset', 'Operations', 'Business or physical asset.'],
      ['Equipment', 'Operations', 'Equipment or machine.'],
      ['RevenueStream', 'Financial', 'Revenue stream.'],
      ['Expense', 'Financial', 'Expense category or item.'],
      ['CostCenter', 'Financial', 'Cost center.'],
      ['Investment', 'Financial', 'Investment or capital allocation.'],
      ['Liability', 'Financial', 'Liability or obligation.'],
      ['MarketingDepartment', 'Marketing', 'Marketing department connected to the owning company.'],
      ['MarketingEmployee', 'Marketing', 'Marketing employee assignment; individual propensity scoring is prohibited.'],
      ['MarketingRole', 'Marketing', 'Marketing responsibility or position.'],
      ['Campaign', 'Marketing', 'Marketing campaign with governed budget, period, and aggregate outcomes.'],
      ['CustomerSegment', 'Marketing', 'Aggregate customer segment without protected or inferred sensitive traits.'],
      ['Lead', 'Marketing', 'Lead aggregate or consented CRM record subject to source ACLs and retention.'],
      ['Brand', 'Marketing', 'Brand or product-brand identity.'],
      ['MarketingChannel', 'Marketing', 'Marketing delivery channel.'],
      ['MarketingAgency', 'Marketing', 'External marketing agency or service provider.'],
      ['MarketTrend', 'Marketing', 'Observed external trend with source provenance.'],
      ['MarketingFunnel', 'Marketing', 'Aggregate awareness-to-retention funnel snapshot.'],
    ];
    return groups.map(([suffix, domain, description]) => ({
      type_id: `edt.core/${suffix}`,
      display_name: suffix.replace(/([a-z])([A-Z])/g, '$1 $2'),
      domain,
      description,
      schema_version: '1.0.0',
      property_schema: {},
      is_system: true,
      active: true,
      created_at: SYSTEM_TYPE_TIMESTAMP,
      updated_at: SYSTEM_TYPE_TIMESTAMP,
    }));
  }

  private coreRelationshipTypes(): TwinRelationshipTypeDefinition[] {
    const definitions: Array<[string, string, ImpactDirection, boolean]> = [
      ['PART_OF', 'Structural containment relationship.', 'forward', true],
      ['OWNS', 'Owner to owned resource relationship.', 'forward', false],
      ['RESPONSIBLE_FOR', 'Responsible party to resource relationship.', 'forward', false],
      ['ASSIGNED_TO', 'Work item to assignee relationship.', 'forward', false],
      ['WORKS_ON', 'Actor or team to work relationship.', 'forward', false],
      ['DEPENDS_ON', 'Consumer to prerequisite dependency. Impact propagates from prerequisite to consumer.', 'reverse', true],
      ['BLOCKS', 'Blocker to blocked work relationship.', 'forward', true],
      ['USES', 'Consumer to resource relationship. Impact propagates from resource to consumer.', 'reverse', false],
      ['CALLS', 'Caller to API or service relationship. Impact propagates from API or service to caller.', 'reverse', false],
      ['HOSTED_ON', 'Workload to infrastructure relationship. Impact propagates from infrastructure to workload.', 'reverse', false],
      ['SERVES', 'Service or product to customer relationship.', 'forward', false],
      ['SUPPLIED_BY', 'Item to vendor relationship. Impact propagates from vendor to item.', 'reverse', false],
      ['LOCATED_IN', 'Entity to location relationship.', 'bidirectional', false],
      ['RELATES_TO', 'Descriptive relationship with no impact propagation.', 'none', false],
      ['TARGETS', 'Campaign targets an aggregate customer segment.', 'forward', false],
      ['GENERATES', 'Campaign or channel generates aggregate leads.', 'forward', false],
      ['IMPACTS_REVENUE', 'Campaign, channel, or trend contributes to a revenue impact.', 'forward', false],
      ['INTERESTED_IN', 'Customer segment has evidenced aggregate interest in a product.', 'forward', false],
      ['USES_CHANNEL', 'Campaign allocates activity or budget to a marketing channel.', 'forward', false],
      ['PROMOTES', 'Campaign promotes a product or brand.', 'forward', false],
      ['MANAGED_BY', 'Campaign or brand is managed by a department, employee, or agency.', 'reverse', false],
      ['IN_FUNNEL_STAGE', 'Aggregate segment or lead cohort occupies a funnel stage.', 'forward', false],
      ['INFLUENCED_BY', 'Marketing outcome is influenced by a sourced market trend.', 'reverse', false],
    ];
    const marketingEndpoints: Record<string, { source: string[]; target: string[] }> = {
      TARGETS: { source: ['Campaign'], target: ['CustomerSegment'] },
      GENERATES: { source: ['Campaign', 'MarketingChannel'], target: ['Lead'] },
      IMPACTS_REVENUE: { source: ['Campaign', 'MarketingChannel', 'MarketTrend'], target: ['RevenueStream'] },
      INTERESTED_IN: { source: ['CustomerSegment'], target: ['Product'] },
      USES_CHANNEL: { source: ['Campaign'], target: ['MarketingChannel'] },
      PROMOTES: { source: ['Campaign'], target: ['Product', 'Brand'] },
      MANAGED_BY: { source: ['Campaign', 'Brand'], target: ['MarketingDepartment', 'MarketingEmployee', 'MarketingAgency'] },
      IN_FUNNEL_STAGE: { source: ['CustomerSegment', 'Lead'], target: ['MarketingFunnel'] },
      INFLUENCED_BY: { source: ['Campaign', 'CustomerSegment', 'Brand'], target: ['MarketTrend'] },
    };
    return definitions.map(([suffix, description, impactDirection, acyclic]) => ({
      type_id: `edt.core/${suffix}`,
      display_name: suffix,
      domain: 'Core',
      description,
      schema_version: '1.0.0',
      property_schema: {},
      is_system: true,
      active: true,
      created_at: SYSTEM_TYPE_TIMESTAMP,
      updated_at: SYSTEM_TYPE_TIMESTAMP,
      directional: true,
      impact_direction: impactDirection,
      acyclic,
      allowed_source_types: (marketingEndpoints[suffix]?.source ?? []).map((type) => `edt.core/${type}`),
      allowed_target_types: (marketingEndpoints[suffix]?.target ?? []).map((type) => `edt.core/${type}`),
    }));
  }
}
