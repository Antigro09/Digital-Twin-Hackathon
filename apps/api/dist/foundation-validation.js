"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UUID_PATTERN = void 0;
exports.invalid = invalid;
exports.conflict = conflict;
exports.notFound = notFound;
exports.assertExactKeys = assertExactKeys;
exports.requiredString = requiredString;
exports.optionalString = optionalString;
exports.safeRecord = safeRecord;
exports.safeJsonValue = safeJsonValue;
exports.plainRecord = plainRecord;
exports.score = score;
exports.boundedInteger = boundedInteger;
exports.stringArray = stringArray;
exports.uuid = uuid;
exports.optionalUuid = optionalUuid;
exports.isoTimestamp = isoTimestamp;
exports.classification = classification;
exports.safeLocator = safeLocator;
exports.secretReference = secretReference;
exports.normalizedIdentifier = normalizedIdentifier;
const common_1 = require("@nestjs/common");
const twin_graph_types_1 = require("./twin-graph.types");
const problem_1 = require("./problem");
exports.UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_KEY_PATTERN = /(?:^|[_\-])(password|passwd|secret|token|credential|api[_\-]?key|private[_\-]?key|authorization|cookie|session)(?:$|[_\-])/i;
const SENSITIVE_LOCATOR_PATTERN = /(?:\/\/[^/\s@]+@|[?&#](?:access[_-]?token|auth(?:orization)?|token|api[_-]?key|key|signature|sig|credential|password)=|\bbearer\s)/i;
function invalid(code, detail) {
    return new problem_1.ProblemException(common_1.HttpStatus.BAD_REQUEST, code, detail);
}
function conflict(code, detail) {
    return new problem_1.ProblemException(common_1.HttpStatus.CONFLICT, code, detail);
}
function notFound() {
    return new problem_1.ProblemException(common_1.HttpStatus.NOT_FOUND, 'not_found', 'The resource was not found.');
}
function assertExactKeys(record, allowlist, label) {
    const unexpected = Object.keys(record).filter((key) => !allowlist.includes(key));
    if (unexpected.length)
        throw invalid('unknown_request_field', `${label} contains unsupported field(s): ${unexpected.sort().join(', ')}.`);
}
function requiredString(value, field, maximumLength) {
    if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
        throw invalid('invalid_string', `${field} must be a non-empty string up to ${maximumLength} characters.`);
    }
    return value.trim();
}
function optionalString(value, field, maximumLength) {
    if (value === undefined || value === null)
        return undefined;
    return requiredString(value, field, maximumLength);
}
function safeRecord(value, field, maximumBytes) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw invalid('invalid_object', `${field} must be an object.`);
    assertSafeJson(value, field, new Set());
    const serialized = JSON.stringify(value);
    if (!serialized || serialized.length > maximumBytes)
        throw invalid('payload_too_large', `${field} exceeds its ${maximumBytes}-byte limit.`);
    return JSON.parse(serialized);
}
function safeJsonValue(value, field, maximumBytes) {
    assertSafeJson(value, field, new Set());
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > maximumBytes)
        throw invalid('payload_too_large', `${field} exceeds its ${maximumBytes}-byte limit.`);
    return JSON.parse(serialized);
}
function plainRecord(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw invalid('invalid_object', `${field} must be an object.`);
    if (Object.getOwnPropertySymbols(value).length)
        throw invalid('invalid_object', `${field} must be a JSON object.`);
    const record = value;
    if (Object.keys(record).some((key) => key === '__proto__' || key === 'constructor' || key === 'prototype')) {
        throw invalid('unsafe_property_key', `${field} contains a forbidden property key.`);
    }
    return record;
}
function score(value, field, fallback) {
    const candidate = value === undefined ? fallback : value;
    const parsed = typeof candidate === 'number' ? candidate : Number(candidate);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1)
        throw invalid('invalid_score', `${field} must be a finite number from 0 to 1.`);
    return parsed;
}
function boundedInteger(value, field, minimum, maximum, fallback) {
    const candidate = value === undefined ? fallback : value;
    const parsed = typeof candidate === 'number' ? candidate : Number(candidate);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw invalid('invalid_bound', `${field} must be an integer between ${minimum} and ${maximum}.`);
    }
    return parsed;
}
function stringArray(value, field, maximumItems, maximumLength, fallback = []) {
    const candidate = value === undefined ? fallback : value;
    if (!Array.isArray(candidate) || candidate.length > maximumItems)
        throw invalid('invalid_array', `${field} must contain at most ${maximumItems} strings.`);
    return [...new Set(candidate.map((item, index) => requiredString(item, `${field}[${index}]`, maximumLength)))];
}
function uuid(value, field) {
    const candidate = requiredString(value, field, 64);
    if (!exports.UUID_PATTERN.test(candidate))
        throw invalid('invalid_identifier', `${field} must be a UUID.`);
    return candidate;
}
function optionalUuid(value, field) {
    if (value === undefined || value === null)
        return null;
    return uuid(value, field);
}
function isoTimestamp(value, field, fallback) {
    const candidate = value === undefined ? fallback : requiredString(value, field, 64);
    if (!candidate || Number.isNaN(Date.parse(candidate)))
        throw invalid('invalid_timestamp', `${field} must be an ISO timestamp.`);
    return new Date(candidate).toISOString();
}
function classification(value, field = 'classification', fallback = 'internal') {
    const candidate = value === undefined ? fallback : value;
    if (typeof candidate !== 'string' || !twin_graph_types_1.CLASSIFICATIONS.includes(candidate)) {
        throw invalid('invalid_classification', `${field} must be one of ${twin_graph_types_1.CLASSIFICATIONS.join(', ')}.`);
    }
    return candidate;
}
function safeLocator(value, field) {
    const locator = optionalString(value, field, 1_000);
    if (!locator)
        return undefined;
    if (/\s/.test(locator) || SENSITIVE_LOCATOR_PATTERN.test(locator)) {
        throw invalid('unsafe_locator', `${field} must be an opaque identifier or URI without credentials, query secrets, or whitespace.`);
    }
    return locator;
}
function secretReference(value, field, required) {
    if (value === undefined || value === null) {
        if (required)
            throw invalid('secret_reference_required', `${field} is required for this authentication mode.`);
        return null;
    }
    const reference = requiredString(value, field, 1_024);
    if (!/^[a-z][a-z0-9+.-]{1,31}:\/\/[a-zA-Z0-9._~!$&'()*+,;=:@/-]{1,1000}$/.test(reference) || /[?#\s]/.test(reference)) {
        throw invalid('invalid_secret_reference', `${field} must be a governed secret URI reference, never secret material.`);
    }
    return reference;
}
function normalizedIdentifier(value, field, maximumLength = 120) {
    const identifier = requiredString(value, field, maximumLength);
    if (!/^[a-z][a-z0-9._:/-]{0,119}$/i.test(identifier))
        throw invalid('invalid_identifier', `${field} contains unsupported characters.`);
    return identifier;
}
function assertSafeJson(value, path, ancestors) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw invalid('invalid_json', `${path} contains a non-finite number.`);
        return;
    }
    if (typeof value !== 'object')
        throw invalid('invalid_json', `${path} contains a non-JSON value.`);
    const object = value;
    if (ancestors.has(object))
        throw invalid('invalid_json', `${path} contains a circular reference.`);
    const prototype = Object.getPrototypeOf(object);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
        throw invalid('invalid_json', `${path} must contain only plain JSON objects.`);
    if (Object.getOwnPropertySymbols(object).length)
        throw invalid('invalid_json', `${path} contains symbol keys.`);
    ancestors.add(object);
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertSafeJson(item, `${path}[${index}]`, ancestors));
    }
    else {
        for (const [key, item] of Object.entries(value)) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype')
                throw invalid('unsafe_property_key', `${path} contains a forbidden property key.`);
            if (SECRET_KEY_PATTERN.test(key))
                throw invalid('secret_property_rejected', `${path}.${key} appears to contain a secret. Store only a governed SecretReference, never secret material.`);
            assertSafeJson(item, `${path}.${key}`, ancestors);
        }
    }
    ancestors.delete(object);
}
//# sourceMappingURL=foundation-validation.js.map