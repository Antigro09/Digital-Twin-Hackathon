import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DatabaseMutationConflict,
  DatabaseService,
  EventMutationAudit,
  EventMutationRecord,
} from './database.service';
import {
  CONNECTOR_KINDS,
  CONNECTOR_STATUSES,
  ConnectorErrorHandling,
  ConnectorKind,
  ConnectorMappingConfiguration,
  ConnectorMappingRule,
  ConnectorPermissions,
  ConnectorSchemaConfiguration,
  ConnectorStatus,
  ConnectorSyncPolicy,
  DATA_FOUNDATION_SCHEMA_VERSION,
  DATA_PLANE_IDS,
  DataPlaneId,
  IntegrationRegistryMetadata,
  McpAuthentication,
  McpConnectedData,
  McpToolDefinition,
  SecretReferenceAuthentication,
  TwinConnectorDefinition,
  TwinMcpServerDefinition,
} from './data-foundation.types';
import { RequestContext, etag, newId, nowIso, sha256, stableUuid, traceId } from './domain';
import {
  UUID_PATTERN,
  assertExactKeys,
  boundedInteger,
  classification,
  conflict,
  invalid,
  normalizedIdentifier,
  notFound,
  optionalString,
  optionalUuid,
  plainRecord,
  requiredString,
  safeLocator,
  score,
  secretReference,
  stringArray,
  uuid,
} from './foundation-validation';
import { ProblemException } from './problem';
import { TwinClassification } from './twin-graph.types';

const REGISTRY_METADATA_KIND = 'twin_integration_metadata';
const CONNECTOR_KIND = 'twin_connector_definition';
const MCP_SERVER_KIND = 'twin_mcp_server_definition';
const MAX_REGISTRY_PAGE_SIZE = 100;
const DAY_SECONDS = 24 * 60 * 60;
const PROHIBITED_MCP_TOOL_SEGMENTS = new Set([
  'sql', 'cypher', 'shell', 'filesystem', 'generic_url_fetch', 'unrestricted_provider_operation',
]);

interface RegistryState {
  metadata: IntegrationRegistryMetadata;
  persisted: boolean;
}

/**
 * Tenant-scoped registry for governed connector and MCP definitions. It is an
 * admission and policy catalog only: execution requires a separate isolated
 * worker and never uses a caller-supplied endpoint or stored credential value.
 */
@Injectable()
export class IntegrationRegistryService {
  constructor(private readonly database: DatabaseService) {}

  async createConnector(ctx: RequestContext, input: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    assertExactKeys(
      input,
      ['name', 'kind', 'purpose', 'authentication', 'schema', 'mapping', 'permissions', 'sync', 'error_handling', 'owner_id', 'reliability_score', 'classification', 'status'],
      'Connector definition',
    );
    const state = await this.state(ctx.tenantId);
    const connectorId = this.resourceId(ctx, 'connector.create', idempotencyKey);
    const connector = this.connectorDefinition(ctx, connectorId, 1, input, nowIso());
    await this.assertAvailableConnectorName(ctx.tenantId, connector.name_key, connectorId);
    const nextMetadata = this.nextMetadata(state);
    const committed = await this.commit(
      ctx,
      state,
      nextMetadata,
      [{ kind: CONNECTOR_KIND, id: connector.connector_id, payload: connector }],
      {
        action: 'twin.connector.create',
        idempotencyKey,
        requestHash: sha256({ action: 'connector.create', input }),
        responseRef: connector.connector_id,
        eventId: this.outboxId(ctx, 'connector.create', idempotencyKey),
        eventType: 'com.enterprisedigitaltwin.integration.connector-registered.v1',
        aggregateType: 'twin_connector_definition',
        aggregateId: connector.connector_id,
        aggregateVersion: connector.version,
        payload: { tenant_id: ctx.tenantId, connector_id: connector.connector_id, history_event_id: connector.connector_id, outbox_position: 0 },
      },
    );
    if (committed.replayed) {
      const existing = await this.database.get<TwinConnectorDefinition>(ctx.tenantId, CONNECTOR_KIND, connector.connector_id);
      if (!existing) throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original connector response is unavailable.', true);
      return this.connectorView(existing, true);
    }
    return this.connectorView(connector);
  }

  async updateConnector(
    ctx: RequestContext,
    connectorId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
    ifMatch: string | undefined,
  ): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    if (!UUID_PATTERN.test(connectorId)) throw notFound();
    assertExactKeys(
      input,
      ['name', 'kind', 'purpose', 'authentication', 'schema', 'mapping', 'permissions', 'sync', 'error_handling', 'owner_id', 'reliability_score', 'classification', 'status'],
      'Connector patch',
    );
    const existing = await this.connector(ctx.tenantId, connectorId);
    this.assertEtag(ifMatch, existing.state_hash, 'connector');
    const state = await this.state(ctx.tenantId);
    const merged = {
      name: input.name ?? existing.name,
      kind: input.kind ?? existing.kind,
      purpose: input.purpose ?? existing.purpose,
      authentication: input.authentication ?? existing.authentication,
      schema: input.schema ?? existing.schema,
      mapping: input.mapping ?? existing.mapping,
      permissions: input.permissions ?? existing.permissions,
      sync: input.sync ?? existing.sync,
      error_handling: input.error_handling ?? existing.error_handling,
      owner_id: Object.prototype.hasOwnProperty.call(input, 'owner_id') ? input.owner_id : existing.owner_id,
      reliability_score: input.reliability_score ?? existing.reliability_score,
      classification: input.classification ?? existing.classification,
      status: input.status ?? existing.status,
    };
    const updated = this.connectorDefinition(ctx, connectorId, existing.version + 1, merged, existing.created_at, existing);
    await this.assertAvailableConnectorName(ctx.tenantId, updated.name_key, connectorId);
    if (updated.state_hash === existing.state_hash) return this.connectorView(existing);
    const nextMetadata = this.nextMetadata(state);
    const committed = await this.commit(
      ctx,
      state,
      nextMetadata,
      [{ kind: CONNECTOR_KIND, id: updated.connector_id, payload: updated }],
      {
        action: 'twin.connector.update',
        idempotencyKey,
        requestHash: sha256({ action: 'connector.update', connector_id: connectorId, input }),
        responseRef: updated.connector_id,
        eventId: this.outboxId(ctx, 'connector.update', idempotencyKey),
        eventType: 'com.enterprisedigitaltwin.integration.connector-updated.v1',
        aggregateType: 'twin_connector_definition',
        aggregateId: updated.connector_id,
        aggregateVersion: updated.version,
        payload: { tenant_id: ctx.tenantId, connector_id: updated.connector_id, history_event_id: updated.connector_id, outbox_position: 0 },
      },
      [{ kind: CONNECTOR_KIND, id: existing.connector_id, expected: { version: existing.version, state_hash: existing.state_hash } }],
    );
    if (committed.replayed) {
      const replay = await this.database.get<TwinConnectorDefinition>(ctx.tenantId, CONNECTOR_KIND, connectorId);
      if (!replay) throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original connector response is unavailable.', true);
      return this.connectorView(replay, true);
    }
    return this.connectorView(updated);
  }

  async listConnectors(ctx: RequestContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    assertExactKeys(input, ['status', 'kind', 'limit', 'cursor'], 'Connector list');
    const filters: Record<string, string> = {};
    if (input.status !== undefined) filters.status = this.status(input.status);
    if (input.kind !== undefined) filters.kind = this.connectorKind(input.kind);
    const limit = boundedInteger(input.limit, 'limit', 1, MAX_REGISTRY_PAGE_SIZE, 50);
    const cursor = input.cursor === undefined ? undefined : requiredString(input.cursor, 'cursor', 2_000);
    const page = await this.page<TwinConnectorDefinition>(ctx.tenantId, CONNECTOR_KIND, { filters, limit, cursor });
    return { items: page.items.map((connector) => this.publicConnector(connector)), has_more: page.nextCursor !== null, next_cursor: page.nextCursor, registry: this.registryWatermark() };
  }

  async getConnector(ctx: RequestContext, connectorId: string): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    if (!UUID_PATTERN.test(connectorId)) throw notFound();
    return this.connectorView(await this.connector(ctx.tenantId, connectorId));
  }

  async createMcpServer(ctx: RequestContext, input: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    assertExactKeys(
      input,
      ['name', 'purpose', 'authentication', 'tools', 'permissions', 'connected_data', 'owner_id', 'classification', 'status'],
      'MCP server definition',
    );
    const state = await this.state(ctx.tenantId);
    const serverId = this.resourceId(ctx, 'mcp_server.create', idempotencyKey);
    const server = await this.mcpServerDefinition(ctx, serverId, 1, input, nowIso());
    await this.assertAvailableMcpServerName(ctx.tenantId, server.name_key, serverId);
    const nextMetadata = this.nextMetadata(state);
    const committed = await this.commit(
      ctx,
      state,
      nextMetadata,
      [{ kind: MCP_SERVER_KIND, id: server.mcp_server_id, payload: server }],
      {
        action: 'twin.mcp_server.create',
        idempotencyKey,
        requestHash: sha256({ action: 'mcp_server.create', input }),
        responseRef: server.mcp_server_id,
        eventId: this.outboxId(ctx, 'mcp_server.create', idempotencyKey),
        eventType: 'com.enterprisedigitaltwin.integration.mcp-server-registered.v1',
        aggregateType: 'twin_mcp_server_definition',
        aggregateId: server.mcp_server_id,
        aggregateVersion: server.version,
        payload: { tenant_id: ctx.tenantId, mcp_server_id: server.mcp_server_id, history_event_id: server.mcp_server_id, outbox_position: 0 },
      },
    );
    if (committed.replayed) {
      const existing = await this.database.get<TwinMcpServerDefinition>(ctx.tenantId, MCP_SERVER_KIND, server.mcp_server_id);
      if (!existing) throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original MCP server response is unavailable.', true);
      return this.mcpServerView(existing, true);
    }
    return this.mcpServerView(server);
  }

  async updateMcpServer(
    ctx: RequestContext,
    serverId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
    ifMatch: string | undefined,
  ): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    if (!UUID_PATTERN.test(serverId)) throw notFound();
    assertExactKeys(
      input,
      ['name', 'purpose', 'authentication', 'tools', 'permissions', 'connected_data', 'owner_id', 'classification', 'status'],
      'MCP server patch',
    );
    const existing = await this.mcpServer(ctx.tenantId, serverId);
    this.assertEtag(ifMatch, existing.state_hash, 'MCP server');
    const state = await this.state(ctx.tenantId);
    const merged = {
      name: input.name ?? existing.name,
      purpose: input.purpose ?? existing.purpose,
      authentication: input.authentication ?? existing.authentication,
      tools: input.tools ?? existing.tools,
      permissions: input.permissions ?? existing.permissions,
      connected_data: input.connected_data ?? existing.connected_data,
      owner_id: Object.prototype.hasOwnProperty.call(input, 'owner_id') ? input.owner_id : existing.owner_id,
      classification: input.classification ?? existing.classification,
      status: input.status ?? existing.status,
    };
    const updated = await this.mcpServerDefinition(ctx, serverId, existing.version + 1, merged, existing.created_at, existing);
    await this.assertAvailableMcpServerName(ctx.tenantId, updated.name_key, serverId);
    if (updated.state_hash === existing.state_hash) return this.mcpServerView(existing);
    const nextMetadata = this.nextMetadata(state);
    const committed = await this.commit(
      ctx,
      state,
      nextMetadata,
      [{ kind: MCP_SERVER_KIND, id: updated.mcp_server_id, payload: updated }],
      {
        action: 'twin.mcp_server.update',
        idempotencyKey,
        requestHash: sha256({ action: 'mcp_server.update', mcp_server_id: serverId, input }),
        responseRef: updated.mcp_server_id,
        eventId: this.outboxId(ctx, 'mcp_server.update', idempotencyKey),
        eventType: 'com.enterprisedigitaltwin.integration.mcp-server-updated.v1',
        aggregateType: 'twin_mcp_server_definition',
        aggregateId: updated.mcp_server_id,
        aggregateVersion: updated.version,
        payload: { tenant_id: ctx.tenantId, mcp_server_id: updated.mcp_server_id, history_event_id: updated.mcp_server_id, outbox_position: 0 },
      },
      [{ kind: MCP_SERVER_KIND, id: existing.mcp_server_id, expected: { version: existing.version, state_hash: existing.state_hash } }],
    );
    if (committed.replayed) {
      const replay = await this.database.get<TwinMcpServerDefinition>(ctx.tenantId, MCP_SERVER_KIND, serverId);
      if (!replay) throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original MCP server response is unavailable.', true);
      return this.mcpServerView(replay, true);
    }
    return this.mcpServerView(updated);
  }

  async listMcpServers(ctx: RequestContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    assertExactKeys(input, ['status', 'limit', 'cursor'], 'MCP server list');
    const filters: Record<string, string> = {};
    if (input.status !== undefined) filters.status = this.status(input.status);
    const limit = boundedInteger(input.limit, 'limit', 1, MAX_REGISTRY_PAGE_SIZE, 50);
    const cursor = input.cursor === undefined ? undefined : requiredString(input.cursor, 'cursor', 2_000);
    const page = await this.page<TwinMcpServerDefinition>(ctx.tenantId, MCP_SERVER_KIND, { filters, limit, cursor });
    return { items: page.items.map((server) => this.publicMcpServer(server)), has_more: page.nextCursor !== null, next_cursor: page.nextCursor, registry: this.registryWatermark() };
  }

  async getMcpServer(ctx: RequestContext, serverId: string): Promise<Record<string, unknown>> {
    this.assertAdmin(ctx);
    if (!UUID_PATTERN.test(serverId)) throw notFound();
    return this.mcpServerView(await this.mcpServer(ctx.tenantId, serverId));
  }

  private connectorDefinition(
    ctx: RequestContext,
    connectorId: string,
    version: number,
    input: Record<string, unknown>,
    createdAt: string,
    existing?: TwinConnectorDefinition,
  ): TwinConnectorDefinition {
    const timestamp = nowIso();
    const name = requiredString(input.name, 'name', 160);
    const connector: TwinConnectorDefinition = {
      connector_id: connectorId,
      tenant_id: ctx.tenantId,
      name,
      name_key: name.toLocaleLowerCase('en-US'),
      kind: this.connectorKind(input.kind),
      purpose: requiredString(input.purpose, 'purpose', 2_000),
      authentication: this.connectorAuthentication(input.authentication),
      schema: this.connectorSchema(input.schema),
      mapping: this.connectorMapping(input.mapping),
      permissions: this.connectorPermissions(input.permissions),
      sync: this.connectorSync(input.sync),
      error_handling: this.errorHandling(input.error_handling),
      owner_id: optionalUuid(input.owner_id, 'owner_id'),
      reliability_score: score(input.reliability_score, 'reliability_score', 0.8),
      classification: classification(input.classification, 'classification', 'internal'),
      status: this.status(input.status ?? 'draft'),
      version,
      created_at: createdAt,
      updated_at: timestamp,
      created_by: existing?.created_by ?? ctx.actor.actor_id,
      updated_by: ctx.actor.actor_id,
      state_hash: '',
    };
    connector.state_hash = this.connectorHash(connector);
    return connector;
  }

  private async mcpServerDefinition(
    ctx: RequestContext,
    serverId: string,
    version: number,
    input: Record<string, unknown>,
    createdAt: string,
    existing?: TwinMcpServerDefinition,
  ): Promise<TwinMcpServerDefinition> {
    const name = requiredString(input.name, 'name', 160);
    const connectedData = await this.connectedData(ctx.tenantId, input.connected_data);
    const minimumClassification = connectedData.reduce((current, item) => (
      this.classificationRank(item.classification) > this.classificationRank(current) ? item.classification : current
    ), 'internal' as TwinClassification);
    const server: TwinMcpServerDefinition = {
      mcp_server_id: serverId,
      tenant_id: ctx.tenantId,
      name,
      name_key: name.toLocaleLowerCase('en-US'),
      purpose: requiredString(input.purpose, 'purpose', 2_000),
      authentication: this.mcpAuthentication(input.authentication),
      tools: this.mcpTools(input.tools),
      permissions: stringArray(input.permissions, 'permissions', 100, 160),
      connected_data: connectedData.map(({ classification: _classification, ...reference }) => reference),
      owner_id: optionalUuid(input.owner_id, 'owner_id'),
      classification: this.classificationAtLeast(input.classification, minimumClassification),
      status: this.status(input.status ?? 'draft'),
      version,
      created_at: createdAt,
      updated_at: nowIso(),
      created_by: existing?.created_by ?? ctx.actor.actor_id,
      updated_by: ctx.actor.actor_id,
      state_hash: '',
    };
    server.state_hash = this.mcpServerHash(server);
    return server;
  }

  private connectorAuthentication(raw: unknown): SecretReferenceAuthentication {
    const authentication = plainRecord(raw, 'authentication');
    assertExactKeys(authentication, ['kind', 'secret_reference', 'scopes'], 'Connector authentication');
    const kind = authentication.kind;
    if (kind !== 'oauth2' && kind !== 'api_key' && kind !== 'service_account' && kind !== 'database_credentials' && kind !== 'mutual_tls' && kind !== 'none') {
      throw invalid('invalid_authentication_kind', 'authentication.kind is not supported.');
    }
    const reference = secretReference(authentication.secret_reference, 'authentication.secret_reference', kind !== 'none');
    if (kind === 'none' && reference !== null) throw invalid('unexpected_secret_reference', 'authentication.kind none must not include a secret reference.');
    return { kind, secret_reference: reference, scopes: this.permissionList(authentication.scopes, 'authentication.scopes') };
  }

  private mcpAuthentication(raw: unknown): McpAuthentication {
    const authentication = plainRecord(raw, 'authentication');
    assertExactKeys(authentication, ['kind', 'secret_reference', 'scopes'], 'MCP authentication');
    const kind = authentication.kind;
    if (kind !== 'oauth2_client_credentials' && kind !== 'oauth2_delegated' && kind !== 'service_token' && kind !== 'none') {
      throw invalid('invalid_authentication_kind', 'authentication.kind is not supported.');
    }
    const reference = secretReference(authentication.secret_reference, 'authentication.secret_reference', kind !== 'none');
    if (kind === 'none' && reference !== null) throw invalid('unexpected_secret_reference', 'authentication.kind none must not include a secret reference.');
    return { kind, secret_reference: reference, scopes: this.permissionList(authentication.scopes, 'authentication.scopes') };
  }

  private connectorSchema(raw: unknown): ConnectorSchemaConfiguration {
    const schema = plainRecord(raw, 'schema');
    assertExactKeys(schema, ['source_schema_ref', 'normalized_schema_ref', 'version'], 'Connector schema');
    return {
      source_schema_ref: this.schemaReference(schema.source_schema_ref, 'schema.source_schema_ref'),
      normalized_schema_ref: this.schemaReference(schema.normalized_schema_ref, 'schema.normalized_schema_ref'),
      version: this.semver(schema.version, 'schema.version'),
    };
  }

  private connectorMapping(raw: unknown): ConnectorMappingConfiguration {
    const mapping = plainRecord(raw, 'mapping');
    assertExactKeys(mapping, ['version', 'rules'], 'Connector mapping');
    if (!Array.isArray(mapping.rules) || mapping.rules.length > 200) throw invalid('invalid_mapping_rules', 'mapping.rules must contain at most 200 rules.');
    return {
      version: this.semver(mapping.version, 'mapping.version'),
      rules: mapping.rules.map((rule, index) => this.mappingRule(rule, index)),
    };
  }

  private mappingRule(raw: unknown, index: number): ConnectorMappingRule {
    const rule = plainRecord(raw, `mapping.rules[${index}]`);
    assertExactKeys(rule, ['source_path', 'target_path', 'transform'], `mapping.rules[${index}]`);
    const transform = optionalString(rule.transform, `mapping.rules[${index}].transform`, 500);
    return {
      source_path: requiredString(rule.source_path, `mapping.rules[${index}].source_path`, 500),
      target_path: requiredString(rule.target_path, `mapping.rules[${index}].target_path`, 500),
      ...(transform ? { transform } : {}),
    };
  }

  private connectorPermissions(raw: unknown): ConnectorPermissions {
    const permissions = plainRecord(raw, 'permissions');
    assertExactKeys(permissions, ['read', 'write', 'allowed_classifications'], 'Connector permissions');
    const read = this.permissionList(permissions.read, 'permissions.read');
    if (!read.length) throw invalid('connector_read_permission_required', 'permissions.read must contain at least one allowed operation.');
    const allowedClassifications = stringArray(permissions.allowed_classifications, 'permissions.allowed_classifications', 4, 32)
      .map((item, index) => classification(item, `permissions.allowed_classifications[${index}]`));
    if (!allowedClassifications.length) throw invalid('connector_classification_required', 'permissions.allowed_classifications must contain at least one classification.');
    return {
      read,
      write: this.permissionList(permissions.write, 'permissions.write'),
      allowed_classifications: [...new Set(allowedClassifications)],
    };
  }

  private connectorSync(raw: unknown): ConnectorSyncPolicy {
    const sync = plainRecord(raw, 'sync');
    assertExactKeys(sync, ['mode', 'frequency_seconds'], 'Connector sync policy');
    const mode = sync.mode;
    if (mode !== 'manual' && mode !== 'interval' && mode !== 'webhook' && mode !== 'hybrid') {
      throw invalid('invalid_sync_mode', 'sync.mode must be manual, interval, webhook, or hybrid.');
    }
    const frequency = sync.frequency_seconds === undefined || sync.frequency_seconds === null
      ? null
      : boundedInteger(sync.frequency_seconds, 'sync.frequency_seconds', 60, 7 * DAY_SECONDS);
    if ((mode === 'interval' || mode === 'hybrid') && frequency === null) {
      throw invalid('sync_frequency_required', `${mode} connectors require sync.frequency_seconds.`);
    }
    if ((mode === 'manual' || mode === 'webhook') && frequency !== null) {
      throw invalid('unexpected_sync_frequency', `${mode} connectors must not declare sync.frequency_seconds.`);
    }
    return { mode, frequency_seconds: frequency };
  }

  private errorHandling(raw: unknown): ConnectorErrorHandling {
    const handling = plainRecord(raw, 'error_handling');
    assertExactKeys(handling, ['mode', 'max_attempts', 'initial_backoff_seconds', 'max_backoff_seconds'], 'Connector error handling');
    const mode = handling.mode;
    if (mode !== 'fail_closed' && mode !== 'retry_with_backoff' && mode !== 'dead_letter') {
      throw invalid('invalid_error_handling_mode', 'error_handling.mode is not supported.');
    }
    const initial = boundedInteger(handling.initial_backoff_seconds, 'error_handling.initial_backoff_seconds', 1, 900);
    const maximum = boundedInteger(handling.max_backoff_seconds, 'error_handling.max_backoff_seconds', initial, 3_600);
    return {
      mode,
      max_attempts: boundedInteger(handling.max_attempts, 'error_handling.max_attempts', 1, 12),
      initial_backoff_seconds: initial,
      max_backoff_seconds: maximum,
    };
  }

  private mcpTools(raw: unknown): McpToolDefinition[] {
    if (!Array.isArray(raw) || !raw.length || raw.length > 100) throw invalid('invalid_mcp_tools', 'tools must contain 1 to 100 declared tools.');
    const tools = raw.map((value, index) => {
      const tool = plainRecord(value, `tools[${index}]`);
      assertExactKeys(tool, ['tool_id', 'purpose', 'permissions', 'side_effects'], `tools[${index}]`);
      const toolId = normalizedIdentifier(tool.tool_id, `tools[${index}].tool_id`, 80).toLocaleLowerCase('en-US');
      if (this.prohibitedTool(toolId)) {
        throw invalid('mcp_tool_prohibited', `${toolId} is not permitted in a registered MCP server.`);
      }
      const permissions = this.permissionList(tool.permissions, `tools[${index}].permissions`);
      const sideEffects = tool.side_effects;
      if (typeof sideEffects !== 'boolean') throw invalid('invalid_boolean', `tools[${index}].side_effects must be a boolean.`);
      if (sideEffects && !permissions.includes('mcp.execute.approved')) {
        throw invalid('mcp_side_effect_policy', `Side-effecting tool ${toolId} must require mcp.execute.approved.`);
      }
      return {
        tool_id: toolId,
        purpose: requiredString(tool.purpose, `tools[${index}].purpose`, 1_000),
        permissions,
        side_effects: sideEffects,
      };
    });
    const duplicate = tools.find((tool, index) => tools.findIndex((candidate) => candidate.tool_id === tool.tool_id) !== index);
    if (duplicate) throw conflict('mcp_tool_exists', `MCP tool ${duplicate.tool_id} is declared more than once.`);
    return tools;
  }

  private async connectedData(tenantId: string, raw: unknown): Promise<Array<McpConnectedData & { classification: TwinClassification }>> {
    if (!Array.isArray(raw) || !raw.length || raw.length > 100) throw invalid('invalid_connected_data', 'connected_data must contain 1 to 100 data references.');
    return Promise.all(raw.map(async (value, index) => {
      const reference = plainRecord(value, `connected_data[${index}]`);
      assertExactKeys(reference, ['data_plane', 'resource_kind', 'connector_id'], `connected_data[${index}]`);
      if (typeof reference.data_plane !== 'string' || !DATA_PLANE_IDS.includes(reference.data_plane as DataPlaneId)) {
        throw invalid('invalid_data_plane', `connected_data[${index}].data_plane is not supported.`);
      }
      const connectorId = reference.connector_id === undefined ? undefined : uuid(reference.connector_id, `connected_data[${index}].connector_id`);
      let minimumClassification: TwinClassification = 'internal';
      if (connectorId) {
        const connector = await this.database.get<TwinConnectorDefinition>(tenantId, CONNECTOR_KIND, connectorId);
        if (!connector || connector.tenant_id !== tenantId || connector.status === 'archived') {
          throw notFound();
        }
        minimumClassification = connector.classification;
      }
      return {
        data_plane: reference.data_plane as DataPlaneId,
        resource_kind: normalizedIdentifier(reference.resource_kind, `connected_data[${index}].resource_kind`, 120),
        ...(connectorId ? { connector_id: connectorId } : {}),
        classification: minimumClassification,
      };
    }));
  }

  private async connector(tenantId: string, connectorId: string): Promise<TwinConnectorDefinition> {
    const connector = await this.database.get<TwinConnectorDefinition>(tenantId, CONNECTOR_KIND, connectorId);
    if (!connector || connector.tenant_id !== tenantId) throw notFound();
    return connector;
  }

  private async mcpServer(tenantId: string, serverId: string): Promise<TwinMcpServerDefinition> {
    const server = await this.database.get<TwinMcpServerDefinition>(tenantId, MCP_SERVER_KIND, serverId);
    if (!server || server.tenant_id !== tenantId) throw notFound();
    return server;
  }

  private async assertAvailableConnectorName(tenantId: string, nameKey: string, resourceId: string): Promise<void> {
    const page = await this.database.listPage<TwinConnectorDefinition>(tenantId, CONNECTOR_KIND, { filters: { name_key: nameKey }, limit: 20 });
    if (page.items.some((connector) => connector.connector_id !== resourceId && connector.status !== 'archived')) {
      throw conflict('connector_name_exists', 'An active connector with this name already exists.');
    }
  }

  private async assertAvailableMcpServerName(tenantId: string, nameKey: string, resourceId: string): Promise<void> {
    const page = await this.database.listPage<TwinMcpServerDefinition>(tenantId, MCP_SERVER_KIND, { filters: { name_key: nameKey }, limit: 20 });
    if (page.items.some((server) => server.mcp_server_id !== resourceId && server.status !== 'archived')) {
      throw conflict('mcp_server_name_exists', 'An active MCP server with this name already exists.');
    }
  }

  private async state(tenantId: string): Promise<RegistryState> {
    const metadataId = this.metadataId(tenantId);
    const metadata = await this.database.get<IntegrationRegistryMetadata>(tenantId, REGISTRY_METADATA_KIND, metadataId);
    if (metadata?.metadata_id === metadataId && metadata.tenant_id === tenantId) return { metadata, persisted: true };
    return {
      persisted: false,
      metadata: {
        metadata_id: metadataId,
        tenant_id: tenantId,
        schema_version: DATA_FOUNDATION_SCHEMA_VERSION,
        version: 0,
        updated_at: nowIso(),
      },
    };
  }

  private nextMetadata(state: RegistryState): IntegrationRegistryMetadata {
    return { ...state.metadata, version: state.metadata.version + 1, updated_at: nowIso() };
  }

  private async commit(
    ctx: RequestContext,
    state: RegistryState,
    nextMetadata: IntegrationRegistryMetadata,
    records: EventMutationRecord[],
    mutation: {
      action: string;
      idempotencyKey: string;
      requestHash: string;
      responseRef: string;
      eventId: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      aggregateVersion: number;
      payload: Record<string, unknown>;
    },
    expectedRecords: Array<{ kind: string; id: string; expected: Record<string, string | number> }> = [],
  ): Promise<{ replayed: boolean }> {
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
      details_hash: sha256({ action: mutation.action, aggregate_id: mutation.aggregateId, aggregate_version: mutation.aggregateVersion, response_ref: mutation.responseRef }),
      previous_hash: '',
      event_hash: '',
    };
    try {
      const result = await this.database.commitEventMutation(
        ctx.tenantId,
        [{ kind: REGISTRY_METADATA_KIND, id: nextMetadata.metadata_id, payload: nextMetadata }, ...records],
        audit,
        {
          eventId: mutation.eventId,
          eventType: mutation.eventType,
          aggregateType: mutation.aggregateType,
          aggregateId: mutation.aggregateId,
          aggregateVersion: mutation.aggregateVersion,
          payload: mutation.payload,
        },
        {
          idempotency: {
            operation: `${ctx.actor.actor_id}:${mutation.action}`,
            key: mutation.idempotencyKey,
            requestHash: mutation.requestHash,
            responseRef: mutation.responseRef,
            expiresAt: new Date(Date.now() + 7 * 365 * DAY_SECONDS * 1_000).toISOString(),
          },
          expectedRecords: [
            ...(state.persisted
              ? [{ kind: REGISTRY_METADATA_KIND, id: state.metadata.metadata_id, expected: { version: state.metadata.version } }]
              : [{ kind: REGISTRY_METADATA_KIND, id: state.metadata.metadata_id, absent: true as const }]),
            ...expectedRecords,
          ],
        },
      );
      return { replayed: result.replayed === true };
    } catch (error) {
      if (error instanceof DatabaseMutationConflict) {
        throw new ProblemException(HttpStatus.CONFLICT, error.code, error.message, error.code === 'idempotency_request_in_progress');
      }
      if (this.isUniqueViolation(error)) {
        throw conflict('integration_name_exists', 'A non-archived integration already uses this name.');
      }
      throw error;
    }
  }

  private async page<T>(
    tenantId: string,
    kind: string,
    input: { filters: Record<string, string>; limit: number; cursor?: string },
  ): Promise<{ items: T[]; nextCursor: string | null }> {
    try {
      return await this.database.listPage<T>(tenantId, kind, input);
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('cursor')) throw invalid('invalid_cursor', 'The page cursor is invalid.');
      throw error;
    }
  }

  private connectorView(connector: TwinConnectorDefinition, replayed = false): Record<string, unknown> {
    return {
      connector: this.publicConnector(connector),
      etag: etag(connector.state_hash),
      registry: this.registryWatermark(),
      ...(replayed ? { replayed: true } : {}),
    };
  }

  private mcpServerView(server: TwinMcpServerDefinition, replayed = false): Record<string, unknown> {
    return {
      mcp_server: this.publicMcpServer(server),
      etag: etag(server.state_hash),
      registry: this.registryWatermark(),
      ...(replayed ? { replayed: true } : {}),
    };
  }

  private publicConnector(connector: TwinConnectorDefinition): Record<string, unknown> {
    return {
      ...structuredClone(connector),
      execution_state: 'registry_only',
      credential_material_stored: false,
    } as unknown as Record<string, unknown>;
  }

  private publicMcpServer(server: TwinMcpServerDefinition): Record<string, unknown> {
    return {
      ...structuredClone(server),
      execution_state: 'registry_only',
      transport_endpoint_stored: false,
      credential_material_stored: false,
    } as unknown as Record<string, unknown>;
  }

  private registryWatermark(): Record<string, unknown> {
    return {
      schema_version: DATA_FOUNDATION_SCHEMA_VERSION,
      authoritative_store: 'postgresql',
      execution_boundary: 'isolated_worker_required',
      credentials: 'secret_references_only',
    };
  }

  private connectorKind(value: unknown): ConnectorKind {
    if (typeof value !== 'string' || !CONNECTOR_KINDS.includes(value as ConnectorKind)) {
      throw invalid('invalid_connector_kind', `kind must be one of ${CONNECTOR_KINDS.join(', ')}.`);
    }
    return value as ConnectorKind;
  }

  private status(value: unknown): ConnectorStatus {
    if (typeof value !== 'string' || !CONNECTOR_STATUSES.includes(value as ConnectorStatus)) {
      throw invalid('invalid_integration_status', `status must be one of ${CONNECTOR_STATUSES.join(', ')}.`);
    }
    return value as ConnectorStatus;
  }

  private permissionList(value: unknown, field: string): string[] {
    return stringArray(value, field, 100, 160).map((permission, index) => normalizedIdentifier(permission, `${field}[${index}]`, 160));
  }

  private schemaReference(value: unknown, field: string): string {
    const reference = safeLocator(requiredString(value, field, 1_000), field);
    if (!reference || !/^[a-z][a-z0-9+.-]{1,31}:/i.test(reference)) throw invalid('invalid_schema_reference', `${field} must be a URI reference.`);
    return reference;
  }

  private semver(value: unknown, field: string): string {
    const version = requiredString(value, field, 64);
    if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
      throw invalid('invalid_semver', `${field} must use semantic version major.minor.patch.`);
    }
    return version;
  }

  private classificationAtLeast(value: unknown, minimum: TwinClassification): TwinClassification {
    const supplied = classification(value, 'classification', minimum);
    if (this.classificationRank(supplied) < this.classificationRank(minimum)) {
      throw invalid('classification_weakened', 'classification cannot be less restrictive than connected data.');
    }
    return supplied;
  }

  private classificationRank(value: TwinClassification): number {
    return ['public', 'internal', 'confidential', 'restricted'].indexOf(value);
  }

  private prohibitedTool(toolId: string): boolean {
    return toolId.split('_').some((segment) => PROHIBITED_MCP_TOOL_SEGMENTS.has(segment)) || PROHIBITED_MCP_TOOL_SEGMENTS.has(toolId);
  }

  private assertEtag(value: string | undefined, currentHash: string, resource: string): void {
    if (!value) throw new ProblemException(HttpStatus.PRECONDITION_REQUIRED, 'if_match_required', `If-Match is required to update a ${resource}.`);
    if (value !== etag(currentHash)) throw new ProblemException(HttpStatus.PRECONDITION_FAILED, 'integration_precondition_failed', `The ${resource} changed; refresh before updating it.`);
  }

  private connectorHash(connector: TwinConnectorDefinition): string {
    const { state_hash: _stateHash, ...domain } = connector;
    return sha256(domain);
  }

  private mcpServerHash(server: TwinMcpServerDefinition): string {
    const { state_hash: _stateHash, ...domain } = server;
    return sha256(domain);
  }

  private metadataId(tenantId: string): string {
    return stableUuid(`twin-integration-registry-metadata:${tenantId}`);
  }

  private resourceId(ctx: RequestContext, action: string, idempotencyKey: string): string {
    return stableUuid(`twin-integration-resource:${ctx.tenantId}:${ctx.actor.actor_id}:${action}:${idempotencyKey}`);
  }

  private outboxId(ctx: RequestContext, action: string, idempotencyKey: string): string {
    return stableUuid(`twin-integration-outbox:${ctx.tenantId}:${ctx.actor.actor_id}:${action}:${idempotencyKey}`);
  }

  private isUniqueViolation(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505');
  }

  private assertAdmin(ctx: RequestContext): void {
    if (!ctx.actor.capabilities.includes('connector.admin')) {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'integration_registry_denied', 'Connector and MCP registry access requires a tenant integration administrator.');
    }
  }
}
