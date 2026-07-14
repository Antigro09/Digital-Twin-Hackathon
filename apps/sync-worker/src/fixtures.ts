import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

export interface SourceObject {
  source_object_id: string;
  tenant_id: string;
  installation_id: string;
  provider: 'github' | 'jira';
  source_key: string;
  source_revision: string;
  acl_class: string;
  observed_at: string;
  fields: Record<string, unknown>;
}

export interface Relationship {
  tenant_id: string;
  source_relationship_id: string;
  type: string;
  from: string;
  to: string;
}

export interface Fixtures {
  source_objects: SourceObject[];
  relationships: Relationship[];
}

export function loadFixtures(): Fixtures {
  const candidates = [
    process.env.EDT_FIXTURE_ROOT,
    resolve(process.cwd(), 'docs/enterprise-digital-twin/fixtures/h1'),
    resolve(process.cwd(), '../../docs/enterprise-digital-twin/fixtures/h1'),
    resolve(__dirname, '../../../docs/enterprise-digital-twin/fixtures/h1'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const root = candidates.find((candidate) => existsSync(resolve(candidate, 'source-fixtures.yaml')));
  if (!root) throw new Error(`H1 fixtures not found: ${candidates.join(', ')}`);
  return parse(readFileSync(resolve(root, 'source-fixtures.yaml'), 'utf8')) as Fixtures;
}
