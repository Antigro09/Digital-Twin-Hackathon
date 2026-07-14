---
id: ADR-013
title: Bounded Agent Authority and Exact-Payload Approval
status: accepted
version: 1.0.0
owners: [ai-security, workflow-security]
last_reviewed: 2026-07-13
---

# ADR-013: Bounded Agent Authority and Exact-Payload Approval

## Decision

Agents are capability profiles inside a deterministic sequence: authorize, retrieve, plan, schema-validate, execute reads, verify evidence, cite, request approval, execute, and audit. Delegation cannot expand authority. Tool middleware enforces tenant, identity, allowlist, egress, time, spend, token, recursion, concurrency, and cancellation limits outside the model runtime.

The H1 Jira mutation requires two distinct authenticated approvers. Approval binds the canonical payload hash, tenant, requester, approvers, credential, project, policy version, idempotency key, and a 15-minute expiry. Any change invalidates approval. Execution records before and after state and a compensation workflow.

Employment, legal, financial, production, identity, destructive, and security-control decisions remain non-executable through H3.

