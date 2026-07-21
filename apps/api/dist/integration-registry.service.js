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
exports.IntegrationRegistryService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("./database.service");
const data_foundation_types_1 = require("./data-foundation.types");
const domain_1 = require("./domain");
const foundation_validation_1 = require("./foundation-validation");
const problem_1 = require("./problem");
const REGISTRY_METADATA_KIND = 'twin_integration_metadata';
const CONNECTOR_KIND = 'twin_connector_definition';
const MCP_SERVER_KIND = 'twin_mcp_server_definition';
const MAX_REGISTRY_PAGE_SIZE = 100;
const DAY_SECONDS = 24 * 60 * 60;
const PROHIBITED_MCP_TOOL_SEGMENTS = new Set([
    'sql', 'cypher', 'shell', 'filesystem', 'generic_url_fetch', 'unrestricted_provider_operation',
]);
const ALLOWED_MAPPING_TRANSFORMS = new Set([
    'identity',
    'string.trim',
    'string.lowercase',
    'string.uppercase',
    'number.parse',
    'boolean.parse',
    'timestamp.iso8601',
    'uuid.normalize',
    'json.copy',
]);
let IntegrationRegistryService = class IntegrationRegistryService {
    database;
    constructor(database) {
        this.database = database;
    }
    async createConnector(ctx, input, idempotencyKey) {
        this.assertAdmin(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['name', 'kind', 'purpose', 'authentication', 'schema', 'mapping', 'permissions', 'sync', 'error_handling', 'owner_id', 'reliability_score', 'classification', 'status'], 'Connector definition');
        const state = await this.state(ctx.tenantId);
        const connectorId = this.resourceId(ctx, 'connector.create', idempotencyKey);
        const connector = this.connectorDefinition(ctx, connectorId, 1, input, (0, domain_1.nowIso)());
        await this.assertAvailableConnectorName(ctx.tenantId, connector.name_key, connectorId);
        const nextMetadata = this.nextMetadata(state);
        const committed = await this.commit(ctx, state, nextMetadata, [{ kind: CONNECTOR_KIND, id: connector.connector_id, payload: connector }], {
            action: 'twin.connector.create',
            idempotencyKey,
            requestHash: (0, domain_1.sha256)({ action: 'connector.create', input }),
            responseRef: connector.connector_id,
            eventId: this.outboxId(ctx, 'connector.create', idempotencyKey),
            eventType: 'com.enterprisedigitaltwin.integration.connector-registered.v1',
            aggregateType: 'twin_connector_definition',
            aggregateId: connector.connector_id,
            aggregateVersion: connector.version,
            payload: { tenant_id: ctx.tenantId, connector_id: connector.connector_id, history_event_id: connector.connector_id, outbox_position: 0 },
        });
        if (committed.replayed) {
            const existing = await this.database.get(ctx.tenantId, CONNECTOR_KIND, connector.connector_id);
            if (!existing)
                throw new problem_1.ProblemException(common_1.HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original connector response is unavailable.', true);
            return this.connectorView(existing, true);
        }
        return this.connectorView(connector);
    }
    async updateConnector(ctx, connectorId, input, idempotencyKey, ifMatch) {
        this.assertAdmin(ctx);
        if (!foundation_validation_1.UUID_PATTERN.test(connectorId))
            throw (0, foundation_validation_1.notFound)();
        (0, foundation_validation_1.assertExactKeys)(input, ['name', 'kind', 'purpose', 'authentication', 'schema', 'mapping', 'permissions', 'sync', 'error_handling', 'owner_id', 'reliability_score', 'classification', 'status'], 'Connector patch');
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
        if (updated.state_hash === existing.state_hash)
            return this.connectorView(existing);
        const nextMetadata = this.nextMetadata(state);
        const committed = await this.commit(ctx, state, nextMetadata, [{ kind: CONNECTOR_KIND, id: updated.connector_id, payload: updated }], {
            action: 'twin.connector.update',
            idempotencyKey,
            requestHash: (0, domain_1.sha256)({ action: 'connector.update', connector_id: connectorId, input }),
            responseRef: updated.connector_id,
            eventId: this.outboxId(ctx, 'connector.update', idempotencyKey),
            eventType: 'com.enterprisedigitaltwin.integration.connector-updated.v1',
            aggregateType: 'twin_connector_definition',
            aggregateId: updated.connector_id,
            aggregateVersion: updated.version,
            payload: { tenant_id: ctx.tenantId, connector_id: updated.connector_id, history_event_id: updated.connector_id, outbox_position: 0 },
        }, [{ kind: CONNECTOR_KIND, id: existing.connector_id, expected: { version: existing.version, state_hash: existing.state_hash } }]);
        if (committed.replayed) {
            const replay = await this.database.get(ctx.tenantId, CONNECTOR_KIND, connectorId);
            if (!replay)
                throw new problem_1.ProblemException(common_1.HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original connector response is unavailable.', true);
            return this.connectorView(replay, true);
        }
        return this.connectorView(updated);
    }
    async listConnectors(ctx, input) {
        this.assertAdmin(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['status', 'kind', 'limit', 'cursor'], 'Connector list');
        const filters = {};
        if (input.status !== undefined)
            filters.status = this.status(input.status);
        if (input.kind !== undefined)
            filters.kind = this.connectorKind(input.kind);
        const limit = (0, foundation_validation_1.boundedInteger)(input.limit, 'limit', 1, MAX_REGISTRY_PAGE_SIZE, 50);
        const cursor = input.cursor === undefined ? undefined : (0, foundation_validation_1.requiredString)(input.cursor, 'cursor', 2_000);
        const page = await this.page(ctx.tenantId, CONNECTOR_KIND, { filters, limit, cursor });
        return { items: page.items.map((connector) => this.publicConnector(connector)), has_more: page.nextCursor !== null, next_cursor: page.nextCursor, registry: this.registryWatermark() };
    }
    async getConnector(ctx, connectorId) {
        this.assertAdmin(ctx);
        if (!foundation_validation_1.UUID_PATTERN.test(connectorId))
            throw (0, foundation_validation_1.notFound)();
        return this.connectorView(await this.connector(ctx.tenantId, connectorId));
    }
    async createMcpServer(ctx, input, idempotencyKey) {
        this.assertAdmin(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['name', 'purpose', 'authentication', 'tools', 'permissions', 'connected_data', 'owner_id', 'classification', 'status'], 'MCP server definition');
        const state = await this.state(ctx.tenantId);
        const serverId = this.resourceId(ctx, 'mcp_server.create', idempotencyKey);
        const server = await this.mcpServerDefinition(ctx, serverId, 1, input, (0, domain_1.nowIso)());
        await this.assertAvailableMcpServerName(ctx.tenantId, server.name_key, serverId);
        const nextMetadata = this.nextMetadata(state);
        const committed = await this.commit(ctx, state, nextMetadata, [{ kind: MCP_SERVER_KIND, id: server.mcp_server_id, payload: server }], {
            action: 'twin.mcp_server.create',
            idempotencyKey,
            requestHash: (0, domain_1.sha256)({ action: 'mcp_server.create', input }),
            responseRef: server.mcp_server_id,
            eventId: this.outboxId(ctx, 'mcp_server.create', idempotencyKey),
            eventType: 'com.enterprisedigitaltwin.integration.mcp-server-registered.v1',
            aggregateType: 'twin_mcp_server_definition',
            aggregateId: server.mcp_server_id,
            aggregateVersion: server.version,
            payload: { tenant_id: ctx.tenantId, mcp_server_id: server.mcp_server_id, history_event_id: server.mcp_server_id, outbox_position: 0 },
        });
        if (committed.replayed) {
            const existing = await this.database.get(ctx.tenantId, MCP_SERVER_KIND, server.mcp_server_id);
            if (!existing)
                throw new problem_1.ProblemException(common_1.HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original MCP server response is unavailable.', true);
            return this.mcpServerView(existing, true);
        }
        return this.mcpServerView(server);
    }
    async updateMcpServer(ctx, serverId, input, idempotencyKey, ifMatch) {
        this.assertAdmin(ctx);
        if (!foundation_validation_1.UUID_PATTERN.test(serverId))
            throw (0, foundation_validation_1.notFound)();
        (0, foundation_validation_1.assertExactKeys)(input, ['name', 'purpose', 'authentication', 'tools', 'permissions', 'connected_data', 'owner_id', 'classification', 'status'], 'MCP server patch');
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
        if (updated.state_hash === existing.state_hash)
            return this.mcpServerView(existing);
        const nextMetadata = this.nextMetadata(state);
        const committed = await this.commit(ctx, state, nextMetadata, [{ kind: MCP_SERVER_KIND, id: updated.mcp_server_id, payload: updated }], {
            action: 'twin.mcp_server.update',
            idempotencyKey,
            requestHash: (0, domain_1.sha256)({ action: 'mcp_server.update', mcp_server_id: serverId, input }),
            responseRef: updated.mcp_server_id,
            eventId: this.outboxId(ctx, 'mcp_server.update', idempotencyKey),
            eventType: 'com.enterprisedigitaltwin.integration.mcp-server-updated.v1',
            aggregateType: 'twin_mcp_server_definition',
            aggregateId: updated.mcp_server_id,
            aggregateVersion: updated.version,
            payload: { tenant_id: ctx.tenantId, mcp_server_id: updated.mcp_server_id, history_event_id: updated.mcp_server_id, outbox_position: 0 },
        }, [{ kind: MCP_SERVER_KIND, id: existing.mcp_server_id, expected: { version: existing.version, state_hash: existing.state_hash } }]);
        if (committed.replayed) {
            const replay = await this.database.get(ctx.tenantId, MCP_SERVER_KIND, serverId);
            if (!replay)
                throw new problem_1.ProblemException(common_1.HttpStatus.SERVICE_UNAVAILABLE, 'idempotency_response_missing', 'The original MCP server response is unavailable.', true);
            return this.mcpServerView(replay, true);
        }
        return this.mcpServerView(updated);
    }
    async listMcpServers(ctx, input) {
        this.assertAdmin(ctx);
        (0, foundation_validation_1.assertExactKeys)(input, ['status', 'limit', 'cursor'], 'MCP server list');
        const filters = {};
        if (input.status !== undefined)
            filters.status = this.status(input.status);
        const limit = (0, foundation_validation_1.boundedInteger)(input.limit, 'limit', 1, MAX_REGISTRY_PAGE_SIZE, 50);
        const cursor = input.cursor === undefined ? undefined : (0, foundation_validation_1.requiredString)(input.cursor, 'cursor', 2_000);
        const page = await this.page(ctx.tenantId, MCP_SERVER_KIND, { filters, limit, cursor });
        return { items: page.items.map((server) => this.publicMcpServer(server)), has_more: page.nextCursor !== null, next_cursor: page.nextCursor, registry: this.registryWatermark() };
    }
    async getMcpServer(ctx, serverId) {
        this.assertAdmin(ctx);
        if (!foundation_validation_1.UUID_PATTERN.test(serverId))
            throw (0, foundation_validation_1.notFound)();
        return this.mcpServerView(await this.mcpServer(ctx.tenantId, serverId));
    }
    connectorDefinition(ctx, connectorId, version, input, createdAt, existing) {
        const timestamp = (0, domain_1.nowIso)();
        const name = (0, foundation_validation_1.requiredString)(input.name, 'name', 160);
        const connector = {
            connector_id: connectorId,
            tenant_id: ctx.tenantId,
            name,
            name_key: name.toLocaleLowerCase('en-US'),
            kind: this.connectorKind(input.kind),
            purpose: (0, foundation_validation_1.requiredString)(input.purpose, 'purpose', 2_000),
            authentication: this.connectorAuthentication(input.authentication),
            schema: this.connectorSchema(input.schema),
            mapping: this.connectorMapping(input.mapping),
            permissions: this.connectorPermissions(input.permissions),
            sync: this.connectorSync(input.sync),
            error_handling: this.errorHandling(input.error_handling),
            owner_id: (0, foundation_validation_1.optionalUuid)(input.owner_id, 'owner_id'),
            reliability_score: (0, foundation_validation_1.score)(input.reliability_score, 'reliability_score', 0.8),
            classification: (0, foundation_validation_1.classification)(input.classification, 'classification', 'internal'),
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
    async mcpServerDefinition(ctx, serverId, version, input, createdAt, existing) {
        const name = (0, foundation_validation_1.requiredString)(input.name, 'name', 160);
        const connectedData = await this.connectedData(ctx.tenantId, input.connected_data);
        const minimumClassification = connectedData.reduce((current, item) => (this.classificationRank(item.classification) > this.classificationRank(current) ? item.classification : current), 'internal');
        const server = {
            mcp_server_id: serverId,
            tenant_id: ctx.tenantId,
            name,
            name_key: name.toLocaleLowerCase('en-US'),
            purpose: (0, foundation_validation_1.requiredString)(input.purpose, 'purpose', 2_000),
            authentication: this.mcpAuthentication(input.authentication),
            tools: this.mcpTools(input.tools),
            permissions: this.permissionList(input.permissions, 'permissions'),
            connected_data: connectedData.map(({ classification: _classification, ...reference }) => reference),
            owner_id: (0, foundation_validation_1.optionalUuid)(input.owner_id, 'owner_id'),
            classification: this.classificationAtLeast(input.classification, minimumClassification),
            status: this.status(input.status ?? 'draft'),
            version,
            created_at: createdAt,
            updated_at: (0, domain_1.nowIso)(),
            created_by: existing?.created_by ?? ctx.actor.actor_id,
            updated_by: ctx.actor.actor_id,
            state_hash: '',
        };
        server.state_hash = this.mcpServerHash(server);
        return server;
    }
    connectorAuthentication(raw) {
        const authentication = (0, foundation_validation_1.plainRecord)(raw, 'authentication');
        (0, foundation_validation_1.assertExactKeys)(authentication, ['kind', 'secret_reference', 'scopes'], 'Connector authentication');
        const kind = authentication.kind;
        if (kind !== 'oauth2' && kind !== 'api_key' && kind !== 'service_account' && kind !== 'database_credentials' && kind !== 'mutual_tls' && kind !== 'none') {
            throw (0, foundation_validation_1.invalid)('invalid_authentication_kind', 'authentication.kind is not supported.');
        }
        const reference = (0, foundation_validation_1.secretReference)(authentication.secret_reference, 'authentication.secret_reference', kind !== 'none');
        if (kind === 'none' && reference !== null)
            throw (0, foundation_validation_1.invalid)('unexpected_secret_reference', 'authentication.kind none must not include a secret reference.');
        return { kind, secret_reference: reference, scopes: this.permissionList(authentication.scopes, 'authentication.scopes') };
    }
    mcpAuthentication(raw) {
        const authentication = (0, foundation_validation_1.plainRecord)(raw, 'authentication');
        (0, foundation_validation_1.assertExactKeys)(authentication, ['kind', 'secret_reference', 'scopes'], 'MCP authentication');
        const kind = authentication.kind;
        if (kind !== 'oauth2_client_credentials' && kind !== 'oauth2_delegated' && kind !== 'service_token' && kind !== 'none') {
            throw (0, foundation_validation_1.invalid)('invalid_authentication_kind', 'authentication.kind is not supported.');
        }
        const reference = (0, foundation_validation_1.secretReference)(authentication.secret_reference, 'authentication.secret_reference', kind !== 'none');
        if (kind === 'none' && reference !== null)
            throw (0, foundation_validation_1.invalid)('unexpected_secret_reference', 'authentication.kind none must not include a secret reference.');
        return { kind, secret_reference: reference, scopes: this.permissionList(authentication.scopes, 'authentication.scopes') };
    }
    connectorSchema(raw) {
        const schema = (0, foundation_validation_1.plainRecord)(raw, 'schema');
        (0, foundation_validation_1.assertExactKeys)(schema, ['source_schema_ref', 'normalized_schema_ref', 'version'], 'Connector schema');
        return {
            source_schema_ref: this.schemaReference(schema.source_schema_ref, 'schema.source_schema_ref'),
            normalized_schema_ref: this.schemaReference(schema.normalized_schema_ref, 'schema.normalized_schema_ref'),
            version: this.semver(schema.version, 'schema.version'),
        };
    }
    connectorMapping(raw) {
        const mapping = (0, foundation_validation_1.plainRecord)(raw, 'mapping');
        (0, foundation_validation_1.assertExactKeys)(mapping, ['version', 'rules'], 'Connector mapping');
        if (!Array.isArray(mapping.rules) || mapping.rules.length > 200)
            throw (0, foundation_validation_1.invalid)('invalid_mapping_rules', 'mapping.rules must contain at most 200 rules.');
        return {
            version: this.semver(mapping.version, 'mapping.version'),
            rules: mapping.rules.map((rule, index) => this.mappingRule(rule, index)),
        };
    }
    mappingRule(raw, index) {
        const rule = (0, foundation_validation_1.plainRecord)(raw, `mapping.rules[${index}]`);
        (0, foundation_validation_1.assertExactKeys)(rule, ['source_path', 'target_path', 'transform'], `mapping.rules[${index}]`);
        const transform = (0, foundation_validation_1.optionalString)(rule.transform, `mapping.rules[${index}].transform`, 500);
        if (transform && !ALLOWED_MAPPING_TRANSFORMS.has(transform)) {
            throw (0, foundation_validation_1.invalid)('unsupported_mapping_transform', `mapping.rules[${index}].transform must name a supported deterministic transform.`);
        }
        return {
            source_path: (0, foundation_validation_1.requiredString)(rule.source_path, `mapping.rules[${index}].source_path`, 500),
            target_path: (0, foundation_validation_1.requiredString)(rule.target_path, `mapping.rules[${index}].target_path`, 500),
            ...(transform ? { transform } : {}),
        };
    }
    connectorPermissions(raw) {
        const permissions = (0, foundation_validation_1.plainRecord)(raw, 'permissions');
        (0, foundation_validation_1.assertExactKeys)(permissions, ['read', 'write', 'allowed_classifications'], 'Connector permissions');
        const read = this.permissionList(permissions.read, 'permissions.read');
        if (!read.length)
            throw (0, foundation_validation_1.invalid)('connector_read_permission_required', 'permissions.read must contain at least one allowed operation.');
        const allowedClassifications = (0, foundation_validation_1.stringArray)(permissions.allowed_classifications, 'permissions.allowed_classifications', 4, 32)
            .map((item, index) => (0, foundation_validation_1.classification)(item, `permissions.allowed_classifications[${index}]`));
        if (!allowedClassifications.length)
            throw (0, foundation_validation_1.invalid)('connector_classification_required', 'permissions.allowed_classifications must contain at least one classification.');
        return {
            read,
            write: this.permissionList(permissions.write, 'permissions.write'),
            allowed_classifications: [...new Set(allowedClassifications)],
        };
    }
    connectorSync(raw) {
        const sync = (0, foundation_validation_1.plainRecord)(raw, 'sync');
        (0, foundation_validation_1.assertExactKeys)(sync, ['mode', 'frequency_seconds'], 'Connector sync policy');
        const mode = sync.mode;
        if (mode !== 'manual' && mode !== 'interval' && mode !== 'webhook' && mode !== 'hybrid') {
            throw (0, foundation_validation_1.invalid)('invalid_sync_mode', 'sync.mode must be manual, interval, webhook, or hybrid.');
        }
        const frequency = sync.frequency_seconds === undefined || sync.frequency_seconds === null
            ? null
            : (0, foundation_validation_1.boundedInteger)(sync.frequency_seconds, 'sync.frequency_seconds', 60, 7 * DAY_SECONDS);
        if ((mode === 'interval' || mode === 'hybrid') && frequency === null) {
            throw (0, foundation_validation_1.invalid)('sync_frequency_required', `${mode} connectors require sync.frequency_seconds.`);
        }
        if ((mode === 'manual' || mode === 'webhook') && frequency !== null) {
            throw (0, foundation_validation_1.invalid)('unexpected_sync_frequency', `${mode} connectors must not declare sync.frequency_seconds.`);
        }
        return { mode, frequency_seconds: frequency };
    }
    errorHandling(raw) {
        const handling = (0, foundation_validation_1.plainRecord)(raw, 'error_handling');
        (0, foundation_validation_1.assertExactKeys)(handling, ['mode', 'max_attempts', 'initial_backoff_seconds', 'max_backoff_seconds'], 'Connector error handling');
        const mode = handling.mode;
        if (mode !== 'fail_closed' && mode !== 'retry_with_backoff' && mode !== 'dead_letter') {
            throw (0, foundation_validation_1.invalid)('invalid_error_handling_mode', 'error_handling.mode is not supported.');
        }
        const initial = (0, foundation_validation_1.boundedInteger)(handling.initial_backoff_seconds, 'error_handling.initial_backoff_seconds', 1, 900);
        const maximum = (0, foundation_validation_1.boundedInteger)(handling.max_backoff_seconds, 'error_handling.max_backoff_seconds', initial, 3_600);
        return {
            mode,
            max_attempts: (0, foundation_validation_1.boundedInteger)(handling.max_attempts, 'error_handling.max_attempts', 1, 12),
            initial_backoff_seconds: initial,
            max_backoff_seconds: maximum,
        };
    }
    mcpTools(raw) {
        if (!Array.isArray(raw) || !raw.length || raw.length > 100)
            throw (0, foundation_validation_1.invalid)('invalid_mcp_tools', 'tools must contain 1 to 100 declared tools.');
        const tools = raw.map((value, index) => {
            const tool = (0, foundation_validation_1.plainRecord)(value, `tools[${index}]`);
            (0, foundation_validation_1.assertExactKeys)(tool, ['tool_id', 'purpose', 'permissions', 'side_effects'], `tools[${index}]`);
            const toolId = (0, foundation_validation_1.normalizedIdentifier)(tool.tool_id, `tools[${index}].tool_id`, 80).toLocaleLowerCase('en-US');
            if (this.prohibitedTool(toolId)) {
                throw (0, foundation_validation_1.invalid)('mcp_tool_prohibited', `${toolId} is not permitted in a registered MCP server.`);
            }
            const permissions = this.permissionList(tool.permissions, `tools[${index}].permissions`);
            const sideEffects = tool.side_effects;
            if (typeof sideEffects !== 'boolean')
                throw (0, foundation_validation_1.invalid)('invalid_boolean', `tools[${index}].side_effects must be a boolean.`);
            if (sideEffects && !permissions.includes('mcp.execute.approved')) {
                throw (0, foundation_validation_1.invalid)('mcp_side_effect_policy', `Side-effecting tool ${toolId} must require mcp.execute.approved.`);
            }
            return {
                tool_id: toolId,
                purpose: (0, foundation_validation_1.requiredString)(tool.purpose, `tools[${index}].purpose`, 1_000),
                permissions,
                side_effects: sideEffects,
            };
        });
        const duplicate = tools.find((tool, index) => tools.findIndex((candidate) => candidate.tool_id === tool.tool_id) !== index);
        if (duplicate)
            throw (0, foundation_validation_1.conflict)('mcp_tool_exists', `MCP tool ${duplicate.tool_id} is declared more than once.`);
        return tools;
    }
    async connectedData(tenantId, raw) {
        if (!Array.isArray(raw) || !raw.length || raw.length > 100)
            throw (0, foundation_validation_1.invalid)('invalid_connected_data', 'connected_data must contain 1 to 100 data references.');
        return Promise.all(raw.map(async (value, index) => {
            const reference = (0, foundation_validation_1.plainRecord)(value, `connected_data[${index}]`);
            (0, foundation_validation_1.assertExactKeys)(reference, ['data_plane', 'resource_kind', 'connector_id'], `connected_data[${index}]`);
            if (typeof reference.data_plane !== 'string' || !data_foundation_types_1.DATA_PLANE_IDS.includes(reference.data_plane)) {
                throw (0, foundation_validation_1.invalid)('invalid_data_plane', `connected_data[${index}].data_plane is not supported.`);
            }
            const connectorId = reference.connector_id === undefined ? undefined : (0, foundation_validation_1.uuid)(reference.connector_id, `connected_data[${index}].connector_id`);
            let minimumClassification = 'internal';
            if (connectorId) {
                const connector = await this.database.get(tenantId, CONNECTOR_KIND, connectorId);
                if (!connector || connector.tenant_id !== tenantId || connector.status === 'archived') {
                    throw (0, foundation_validation_1.notFound)();
                }
                minimumClassification = connector.classification;
            }
            return {
                data_plane: reference.data_plane,
                resource_kind: (0, foundation_validation_1.normalizedIdentifier)(reference.resource_kind, `connected_data[${index}].resource_kind`, 120),
                ...(connectorId ? { connector_id: connectorId } : {}),
                classification: minimumClassification,
            };
        }));
    }
    async connector(tenantId, connectorId) {
        const connector = await this.database.get(tenantId, CONNECTOR_KIND, connectorId);
        if (!connector || connector.tenant_id !== tenantId)
            throw (0, foundation_validation_1.notFound)();
        return connector;
    }
    async mcpServer(tenantId, serverId) {
        const server = await this.database.get(tenantId, MCP_SERVER_KIND, serverId);
        if (!server || server.tenant_id !== tenantId)
            throw (0, foundation_validation_1.notFound)();
        return server;
    }
    async assertAvailableConnectorName(tenantId, nameKey, resourceId) {
        const page = await this.database.listPage(tenantId, CONNECTOR_KIND, { filters: { name_key: nameKey }, limit: 20 });
        if (page.items.some((connector) => connector.connector_id !== resourceId && connector.status !== 'archived')) {
            throw (0, foundation_validation_1.conflict)('connector_name_exists', 'An active connector with this name already exists.');
        }
    }
    async assertAvailableMcpServerName(tenantId, nameKey, resourceId) {
        const page = await this.database.listPage(tenantId, MCP_SERVER_KIND, { filters: { name_key: nameKey }, limit: 20 });
        if (page.items.some((server) => server.mcp_server_id !== resourceId && server.status !== 'archived')) {
            throw (0, foundation_validation_1.conflict)('mcp_server_name_exists', 'An active MCP server with this name already exists.');
        }
    }
    async state(tenantId) {
        const metadataId = this.metadataId(tenantId);
        const metadata = await this.database.get(tenantId, REGISTRY_METADATA_KIND, metadataId);
        if (metadata?.metadata_id === metadataId && metadata.tenant_id === tenantId)
            return { metadata, persisted: true };
        return {
            persisted: false,
            metadata: {
                metadata_id: metadataId,
                tenant_id: tenantId,
                schema_version: data_foundation_types_1.DATA_FOUNDATION_SCHEMA_VERSION,
                version: 0,
                updated_at: (0, domain_1.nowIso)(),
            },
        };
    }
    nextMetadata(state) {
        return { ...state.metadata, version: state.metadata.version + 1, updated_at: (0, domain_1.nowIso)() };
    }
    async commit(ctx, state, nextMetadata, records, mutation, expectedRecords = []) {
        const audit = {
            audit_id: (0, domain_1.newId)(),
            tenant_sequence: 0,
            action: mutation.action,
            actor_id: ctx.actor.actor_id,
            resource_type: mutation.aggregateType,
            resource_id: mutation.aggregateId,
            occurred_at: (0, domain_1.nowIso)(),
            request_id: ctx.requestId,
            trace_id: (0, domain_1.traceId)(),
            details_hash: (0, domain_1.sha256)({ action: mutation.action, aggregate_id: mutation.aggregateId, aggregate_version: mutation.aggregateVersion, response_ref: mutation.responseRef }),
            previous_hash: '',
            event_hash: '',
        };
        try {
            const result = await this.database.commitEventMutation(ctx.tenantId, [{ kind: REGISTRY_METADATA_KIND, id: nextMetadata.metadata_id, payload: nextMetadata }, ...records], audit, {
                eventId: mutation.eventId,
                eventType: mutation.eventType,
                aggregateType: mutation.aggregateType,
                aggregateId: mutation.aggregateId,
                aggregateVersion: mutation.aggregateVersion,
                payload: mutation.payload,
            }, {
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
                        : [{ kind: REGISTRY_METADATA_KIND, id: state.metadata.metadata_id, absent: true }]),
                    ...expectedRecords,
                ],
            });
            return { replayed: result.replayed === true };
        }
        catch (error) {
            if (error instanceof database_service_1.DatabaseMutationConflict) {
                throw new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, error.code, error.message, error.code === 'idempotency_request_in_progress');
            }
            if (this.isUniqueViolation(error)) {
                throw (0, foundation_validation_1.conflict)('integration_name_exists', 'A non-archived integration already uses this name.');
            }
            throw error;
        }
    }
    async page(tenantId, kind, input) {
        try {
            return await this.database.listPage(tenantId, kind, input);
        }
        catch (error) {
            if (error instanceof TypeError && error.message.includes('cursor'))
                throw (0, foundation_validation_1.invalid)('invalid_cursor', 'The page cursor is invalid.');
            throw error;
        }
    }
    connectorView(connector, replayed = false) {
        return {
            connector: this.publicConnector(connector),
            etag: (0, domain_1.etag)(connector.state_hash),
            registry: this.registryWatermark(),
            ...(replayed ? { replayed: true } : {}),
        };
    }
    mcpServerView(server, replayed = false) {
        return {
            mcp_server: this.publicMcpServer(server),
            etag: (0, domain_1.etag)(server.state_hash),
            registry: this.registryWatermark(),
            ...(replayed ? { replayed: true } : {}),
        };
    }
    publicConnector(connector) {
        return {
            ...structuredClone(connector),
            execution_state: 'registry_only',
            credential_material_stored: false,
        };
    }
    publicMcpServer(server) {
        return {
            ...structuredClone(server),
            execution_state: 'registry_only',
            transport_endpoint_stored: false,
            credential_material_stored: false,
        };
    }
    registryWatermark() {
        return {
            schema_version: data_foundation_types_1.DATA_FOUNDATION_SCHEMA_VERSION,
            authoritative_store: 'postgresql',
            execution_boundary: 'isolated_worker_required',
            credentials: 'secret_references_only',
        };
    }
    connectorKind(value) {
        if (typeof value !== 'string' || !data_foundation_types_1.CONNECTOR_KINDS.includes(value)) {
            throw (0, foundation_validation_1.invalid)('invalid_connector_kind', `kind must be one of ${data_foundation_types_1.CONNECTOR_KINDS.join(', ')}.`);
        }
        return value;
    }
    status(value) {
        if (typeof value !== 'string' || !data_foundation_types_1.CONNECTOR_STATUSES.includes(value)) {
            throw (0, foundation_validation_1.invalid)('invalid_integration_status', `status must be one of ${data_foundation_types_1.CONNECTOR_STATUSES.join(', ')}.`);
        }
        return value;
    }
    permissionList(value, field) {
        return (0, foundation_validation_1.stringArray)(value, field, 100, 160).map((permission, index) => (0, foundation_validation_1.normalizedIdentifier)(permission, `${field}[${index}]`, 160));
    }
    schemaReference(value, field) {
        const reference = (0, foundation_validation_1.safeLocator)((0, foundation_validation_1.requiredString)(value, field, 1_000), field);
        if (!reference || !/^[a-z][a-z0-9+.-]{1,31}:/i.test(reference))
            throw (0, foundation_validation_1.invalid)('invalid_schema_reference', `${field} must be a URI reference.`);
        return reference;
    }
    semver(value, field) {
        const version = (0, foundation_validation_1.requiredString)(value, field, 64);
        if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
            throw (0, foundation_validation_1.invalid)('invalid_semver', `${field} must use semantic version major.minor.patch.`);
        }
        return version;
    }
    classificationAtLeast(value, minimum) {
        const supplied = (0, foundation_validation_1.classification)(value, 'classification', minimum);
        if (this.classificationRank(supplied) < this.classificationRank(minimum)) {
            throw (0, foundation_validation_1.invalid)('classification_weakened', 'classification cannot be less restrictive than connected data.');
        }
        return supplied;
    }
    classificationRank(value) {
        return ['public', 'internal', 'confidential', 'restricted'].indexOf(value);
    }
    prohibitedTool(toolId) {
        const segments = toolId.split(/[._:/-]+/).filter(Boolean);
        return segments.some((segment) => PROHIBITED_MCP_TOOL_SEGMENTS.has(segment)) || PROHIBITED_MCP_TOOL_SEGMENTS.has(toolId);
    }
    assertEtag(value, currentHash, resource) {
        if (!value)
            throw new problem_1.ProblemException(common_1.HttpStatus.PRECONDITION_REQUIRED, 'if_match_required', `If-Match is required to update a ${resource}.`);
        if (value !== (0, domain_1.etag)(currentHash))
            throw new problem_1.ProblemException(common_1.HttpStatus.PRECONDITION_FAILED, 'integration_precondition_failed', `The ${resource} changed; refresh before updating it.`);
    }
    connectorHash(connector) {
        const { state_hash: _stateHash, ...domain } = connector;
        return (0, domain_1.sha256)(domain);
    }
    mcpServerHash(server) {
        const { state_hash: _stateHash, ...domain } = server;
        return (0, domain_1.sha256)(domain);
    }
    metadataId(tenantId) {
        return (0, domain_1.stableUuid)(`twin-integration-registry-metadata:${tenantId}`);
    }
    resourceId(ctx, action, idempotencyKey) {
        return (0, domain_1.stableUuid)(`twin-integration-resource:${ctx.tenantId}:${ctx.actor.actor_id}:${action}:${idempotencyKey}`);
    }
    outboxId(ctx, action, idempotencyKey) {
        return (0, domain_1.stableUuid)(`twin-integration-outbox:${ctx.tenantId}:${ctx.actor.actor_id}:${action}:${idempotencyKey}`);
    }
    isUniqueViolation(error) {
        return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
    }
    assertAdmin(ctx) {
        if (!ctx.actor.capabilities.includes('connector.admin')) {
            throw new problem_1.ProblemException(common_1.HttpStatus.FORBIDDEN, 'integration_registry_denied', 'Connector and MCP registry access requires a tenant integration administrator.');
        }
    }
};
exports.IntegrationRegistryService = IntegrationRegistryService;
exports.IntegrationRegistryService = IntegrationRegistryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], IntegrationRegistryService);
//# sourceMappingURL=integration-registry.service.js.map