"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderSimulator = void 0;
const node_crypto_1 = require("node:crypto");
const canonical_1 = require("./canonical");
class ProviderSimulator {
    fixtures;
    jiraIssue;
    replay = new Map();
    putCount = 0;
    constructor(fixtures) {
        this.fixtures = fixtures;
        const issue = fixtures.source_objects.find((source) => source.provider === 'jira' && source.source_key === 'AST-142');
        if (!issue)
            throw new Error('AST-142 fixture missing');
        this.jiraIssue = structuredClone(issue);
    }
    getGitHub(owner, repo, number) {
        return this.fixtures.source_objects.find((source) => source.provider === 'github' && source.source_key === `${owner}/${repo}#${number}`);
    }
    getJira(issueKey) {
        if (issueKey === 'AST-142')
            return structuredClone(this.jiraIssue);
        return this.fixtures.source_objects.find((source) => source.provider === 'jira' && source.source_key === issueKey);
    }
    updateJira(issueKey, body, idempotencyKey) {
        const replayKey = `${issueKey}:${idempotencyKey}`;
        const replay = this.replay.get(replayKey);
        if (replay)
            return replay;
        if (issueKey !== 'AST-142')
            throw new Error('issue_not_allowlisted');
        const expected = { version: 7, fields: { duedate: '2026-07-31', labels: ['digital-twin-remediation', 'identity', 'orion'], priority: { id: '2' } } };
        if ((0, canonical_1.canonicalize)(body) !== (0, canonical_1.canonicalize)(expected))
            throw new Error('payload_not_allowlisted');
        if (this.jiraIssue.source_revision !== '7')
            throw new Error('source_version_conflict');
        this.putCount += 1;
        this.jiraIssue = {
            ...this.jiraIssue,
            source_revision: '8',
            observed_at: new Date().toISOString(),
            fields: { ...this.jiraIssue.fields, duedate: '2026-07-31', labels: ['digital-twin-remediation', 'identity', 'orion'], priority: { id: '2', name: 'High' } },
        };
        const response = { request_id: `jira-sim-${(0, node_crypto_1.randomUUID)()}`, issue: structuredClone(this.jiraIssue), response_hash: (0, canonical_1.sha256)(this.jiraIssue), put_count: this.putCount };
        this.replay.set(replayKey, response);
        return response;
    }
}
exports.ProviderSimulator = ProviderSimulator;
//# sourceMappingURL=provider-simulator.js.map