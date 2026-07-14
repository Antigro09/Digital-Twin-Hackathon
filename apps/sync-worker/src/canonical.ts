import { createHash } from 'node:crypto';

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalize(value), 'utf8').digest('hex');
}

export function stableUuid(value: string): string {
  const chars = sha256(value).slice(0, 32).split('');
  chars[12] = '5';
  chars[16] = ((Number.parseInt(chars[16], 16) & 3) | 8).toString(16);
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
