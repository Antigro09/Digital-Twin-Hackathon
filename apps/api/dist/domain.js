"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FROZEN_NOW = exports.AST_142_WORK_ITEM_ID = exports.ASTER_JIRA_INSTALLATION_ID = exports.BEACON_TENANT_ID = exports.ASTER_TENANT_ID = void 0;
exports.canonicalize = canonicalize;
exports.sha256 = sha256;
exports.etag = etag;
exports.nowIso = nowIso;
exports.addSeconds = addSeconds;
exports.newId = newId;
exports.stableUuid = stableUuid;
exports.traceId = traceId;
const node_crypto_1 = require("node:crypto");
exports.ASTER_TENANT_ID = '10000000-0000-4000-8000-000000000001';
exports.BEACON_TENANT_ID = '10000000-0000-4000-8000-000000000002';
exports.ASTER_JIRA_INSTALLATION_ID = '30000000-0000-4000-8000-000000000001';
exports.AST_142_WORK_ITEM_ID = '116ab4b3-b108-5f91-ab7e-111f7fba1d45';
exports.FROZEN_NOW = '2026-07-13T16:00:00Z';
function canonicalize(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalize).join(',')}]`;
    const record = value;
    return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
        .join(',')}}`;
}
function sha256(value) {
    const bytes = typeof value === 'string' ? value : canonicalize(value);
    return (0, node_crypto_1.createHash)('sha256').update(bytes, 'utf8').digest('hex');
}
function etag(hash) {
    return `"sha256:${hash}"`;
}
function nowIso() {
    return process.env.EDT_FROZEN_CLOCK === 'true' ? exports.FROZEN_NOW : new Date().toISOString();
}
function addSeconds(value, seconds) {
    return new Date(new Date(value).getTime() + seconds * 1000).toISOString();
}
function newId() {
    return (0, node_crypto_1.randomUUID)();
}
function stableUuid(value) {
    const hex = sha256(value).slice(0, 32).split('');
    hex[12] = '5';
    hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    const joined = hex.join('');
    return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
function traceId() {
    return (0, node_crypto_1.createHash)('sha256').update((0, node_crypto_1.randomUUID)()).digest('hex').slice(0, 32);
}
//# sourceMappingURL=domain.js.map