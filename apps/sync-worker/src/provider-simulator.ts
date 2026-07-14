import { randomUUID } from 'node:crypto';
import { Fixtures, SourceObject } from './fixtures';
import { canonicalize, sha256 } from './canonical';

export class ProviderSimulator {
  private jiraIssue: SourceObject;
  private readonly replay = new Map<string, Record<string, unknown>>();
  putCount = 0;

  constructor(private readonly fixtures: Fixtures) {
    const issue = fixtures.source_objects.find((source) => source.provider === 'jira' && source.source_key === 'AST-142');
    if (!issue) throw new Error('AST-142 fixture missing');
    this.jiraIssue = structuredClone(issue);
  }

  getGitHub(owner: string, repo: string, number: string): SourceObject | undefined {
    return this.fixtures.source_objects.find((source) => source.provider === 'github' && source.source_key === `${owner}/${repo}#${number}`);
  }

  getJira(issueKey: string): SourceObject | undefined {
    if (issueKey === 'AST-142') return structuredClone(this.jiraIssue);
    return this.fixtures.source_objects.find((source) => source.provider === 'jira' && source.source_key === issueKey);
  }

  updateJira(issueKey: string, body: Record<string, unknown>, idempotencyKey: string): Record<string, unknown> {
    const replayKey = `${issueKey}:${idempotencyKey}`;
    const replay = this.replay.get(replayKey);
    if (replay) return replay;
    if (issueKey !== 'AST-142') throw new Error('issue_not_allowlisted');
    const expected = { version: 7, fields: { duedate: '2026-07-31', labels: ['digital-twin-remediation', 'identity', 'orion'], priority: { id: '2' } } };
    if (canonicalize(body) !== canonicalize(expected)) throw new Error('payload_not_allowlisted');
    if (this.jiraIssue.source_revision !== '7') throw new Error('source_version_conflict');
    this.putCount += 1;
    this.jiraIssue = {
      ...this.jiraIssue,
      source_revision: '8',
      observed_at: new Date().toISOString(),
      fields: { ...this.jiraIssue.fields, duedate: '2026-07-31', labels: ['digital-twin-remediation', 'identity', 'orion'], priority: { id: '2', name: 'High' } },
    };
    const response = { request_id: `jira-sim-${randomUUID()}`, issue: structuredClone(this.jiraIssue), response_hash: sha256(this.jiraIssue), put_count: this.putCount };
    this.replay.set(replayKey, response);
    return response;
  }
}
