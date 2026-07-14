"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalize = canonicalize;
exports.sha256 = sha256;
exports.stableUuid = stableUuid;
const node_crypto_1 = require("node:crypto");
function canonicalize(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalize).join(',')}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}
function sha256(value) {
    return (0, node_crypto_1.createHash)('sha256').update(typeof value === 'string' ? value : canonicalize(value), 'utf8').digest('hex');
}
function stableUuid(value) {
    const chars = sha256(value).slice(0, 32).split('');
    chars[12] = '5';
    chars[16] = ((Number.parseInt(chars[16], 16) & 3) | 8).toString(16);
    const hex = chars.join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
//# sourceMappingURL=canonical.js.map