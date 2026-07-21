import { HttpStatus } from '@nestjs/common';
import { CLASSIFICATIONS, TwinClassification } from './twin-graph.types';
import { ProblemException } from './problem';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_KEY_PATTERN = /(?:^|[_\-])(password|passwd|secret|token|credential|api[_\-]?key|private[_\-]?key|authorization|cookie|session)(?:$|[_\-])/i;
const SENSITIVE_LOCATOR_PATTERN = /(?:[?&#](?:access[_-]?token|auth(?:orization)?|token|api[_-]?key|key|signature|sig|credential|password)=|\bbearer\s)/i;

export function invalid(code: string, detail: string): ProblemException {
  return new ProblemException(HttpStatus.BAD_REQUEST, code, detail);
}

export function conflict(code: string, detail: string): ProblemException {
  return new ProblemException(HttpStatus.CONFLICT, code, detail);
}

export function notFound(): ProblemException {
  return new ProblemException(HttpStatus.NOT_FOUND, 'not_found', 'The resource was not found.');
}

export function assertExactKeys(record: Record<string, unknown>, allowlist: readonly string[], label: string): void {
  const unexpected = Object.keys(record).filter((key) => !allowlist.includes(key));
  if (unexpected.length) throw invalid('unknown_request_field', `${label} contains unsupported field(s): ${unexpected.sort().join(', ')}.`);
}

export function requiredString(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
    throw invalid('invalid_string', `${field} must be a non-empty string up to ${maximumLength} characters.`);
  }
  return value.trim();
}

export function optionalString(value: unknown, field: string, maximumLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, field, maximumLength);
}

export function safeRecord(value: unknown, field: string, maximumBytes: number): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('invalid_object', `${field} must be an object.`);
  assertSafeJson(value, field, new Set<object>());
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > maximumBytes) throw invalid('payload_too_large', `${field} exceeds its ${maximumBytes}-byte limit.`);
  return structuredClone(value) as Record<string, unknown>;
}

export function safeJsonValue(value: unknown, field: string, maximumBytes: number): unknown {
  assertSafeJson(value, field, new Set<object>());
  const serialized = JSON.stringify(value);
  if (serialized === undefined || serialized.length > maximumBytes) throw invalid('payload_too_large', `${field} exceeds its ${maximumBytes}-byte limit.`);
  return JSON.parse(serialized) as unknown;
}

export function plainRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('invalid_object', `${field} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid('invalid_object', `${field} must be a plain JSON object.`);
  return value as Record<string, unknown>;
}

export function score(value: unknown, field: string, fallback?: number): number {
  const candidate = value === undefined ? fallback : value;
  const parsed = typeof candidate === 'number' ? candidate : Number(candidate);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw invalid('invalid_score', `${field} must be a finite number from 0 to 1.`);
  return parsed;
}

export function boundedInteger(value: unknown, field: string, minimum: number, maximum: number, fallback?: number): number {
  const candidate = value === undefined ? fallback : value;
  const parsed = typeof candidate === 'number' ? candidate : Number(candidate);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw invalid('invalid_bound', `${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function stringArray(value: unknown, field: string, maximumItems: number, maximumLength: number, fallback: string[] = []): string[] {
  const candidate = value === undefined ? fallback : value;
  if (!Array.isArray(candidate) || candidate.length > maximumItems) throw invalid('invalid_array', `${field} must contain at most ${maximumItems} strings.`);
  return [...new Set(candidate.map((item, index) => requiredString(item, `${field}[${index}]`, maximumLength)))];
}

export function uuid(value: unknown, field: string): string {
  const candidate = requiredString(value, field, 64);
  if (!UUID_PATTERN.test(candidate)) throw invalid('invalid_identifier', `${field} must be a UUID.`);
  return candidate;
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return uuid(value, field);
}

export function isoTimestamp(value: unknown, field: string, fallback?: string): string {
  const candidate = value === undefined ? fallback : requiredString(value, field, 64);
  if (!candidate || Number.isNaN(Date.parse(candidate))) throw invalid('invalid_timestamp', `${field} must be an ISO timestamp.`);
  return new Date(candidate).toISOString();
}

export function classification(value: unknown, field = 'classification', fallback: TwinClassification = 'internal'): TwinClassification {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'string' || !CLASSIFICATIONS.includes(candidate as TwinClassification)) {
    throw invalid('invalid_classification', `${field} must be one of ${CLASSIFICATIONS.join(', ')}.`);
  }
  return candidate as TwinClassification;
}

export function safeLocator(value: unknown, field: string): string | undefined {
  const locator = optionalString(value, field, 1_000);
  if (!locator) return undefined;
  if (/\s/.test(locator) || SENSITIVE_LOCATOR_PATTERN.test(locator)) {
    throw invalid('unsafe_locator', `${field} must be an opaque identifier or URI without credentials, query secrets, or whitespace.`);
  }
  return locator;
}

export function secretReference(value: unknown, field: string, required: boolean): string | null {
  if (value === undefined || value === null) {
    if (required) throw invalid('secret_reference_required', `${field} is required for this authentication mode.`);
    return null;
  }
  const reference = requiredString(value, field, 1_024);
  if (!/^[a-z][a-z0-9+.-]{1,31}:\/\/[a-zA-Z0-9._~!$&'()*+,;=:@/-]{1,1000}$/.test(reference) || /[?#\s]/.test(reference)) {
    throw invalid('invalid_secret_reference', `${field} must be a governed secret URI reference, never secret material.`);
  }
  return reference;
}

export function normalizedIdentifier(value: unknown, field: string, maximumLength = 120): string {
  const identifier = requiredString(value, field, maximumLength);
  if (!/^[a-z][a-z0-9._:/-]{0,119}$/i.test(identifier)) throw invalid('invalid_identifier', `${field} contains unsupported characters.`);
  return identifier;
}

function assertSafeJson(value: unknown, path: string, ancestors: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid('invalid_json', `${path} contains a non-finite number.`);
    return;
  }
  if (typeof value !== 'object') throw invalid('invalid_json', `${path} contains a non-JSON value.`);
  const object = value as object;
  if (ancestors.has(object)) throw invalid('invalid_json', `${path} contains a circular reference.`);
  const prototype = Object.getPrototypeOf(object);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw invalid('invalid_json', `${path} must contain only plain JSON objects.`);
  if (Object.getOwnPropertySymbols(object).length) throw invalid('invalid_json', `${path} contains symbol keys.`);
  ancestors.add(object);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeJson(item, `${path}[${index}]`, ancestors));
  } else {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw invalid('unsafe_property_key', `${path} contains a forbidden property key.`);
      if (SECRET_KEY_PATTERN.test(key)) throw invalid('secret_property_rejected', `${path}.${key} appears to contain a secret. Store only a governed SecretReference, never secret material.`);
      assertSafeJson(item, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(object);
}
