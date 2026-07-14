---
id: EDT-REVIEW-THREAT-001
title: Threat Model
status: committed
version: 1.0.0
owners: [security-architecture]
last_reviewed: 2026-07-13
---

# Threat Model

## Scope and assets

The assessment covers identity, tenant context, API, connector installations, normalized observations, authoritative claims, object storage, graph/vector/search projections, agent context, model and MCP/tool calls, scenarios, approvals, Jira actions, audit, deployment, and the documentation supply chain.

Highest-value assets are tenant data, source ACLs, connector credentials, encryption keys, policy bundles, action approvals, audit evidence, model/tool configuration, and integrity of simulation results.

## Trust boundaries

All browser input, connector payloads, uploaded content, webhooks, model output, MCP output, provider errors, and cross-workload messages are untrusted. Identity assertions become trusted only after issuer, audience, signature, lifetime, nonce, and membership validation. Tenant context is server derived. Model output never becomes authority.

## STRIDE analysis

| Threat | Example | Required controls | Verification |
|---|---|---|---|
| Spoofing | Forged webhook, token, approver, or service identity | OIDC validation, signed webhook verification, workload identity, MFA, nonce and replay cache | Invalid signature, stale token, wrong audience, and impersonation tests |
| Tampering | Change action payload after approval or corrupt claims | Canonical hashes, optimistic versioning, exact-payload approval, signed artifacts, hash-linked audit | Payload mutation, concurrent update, audit-chain verification |
| Repudiation | Approver denies authorizing Jira write | Distinct authenticated approvals, policy version, immutable timestamps and receipts | End-to-end evidence reconstruction |
| Information disclosure | Cross-tenant ID, graph path, embedding, cache, error, or trace leak | RLS, independent namespaces, ACL monotonicity, redaction, non-enumerable errors | Two-tenant negative suite and canary-secret scans |
| Denial of service | Graph explosion, model loop, webhook flood, decompression bomb | Traversal limits, quotas, budgets, rate limits, bounded parsers, backpressure, circuit breakers | Load, fuzz, budget, and resource-exhaustion tests |
| Elevation of privilege | Agent delegation widens tools or tenant | Delegation intersection, external policy gateway, immutable tool manifests, no client tenant selection | Handoff, confused-deputy, and policy-bypass tests |

## AI and connector abuse cases

- Indirect prompt injection in Jira text requests a secret, another tenant, or a write tool. The content remains a user-data field, structured extraction runs without privileged tools, and the policy gateway denies authority changes.
- A compromised connector sends huge nested payloads or URLs to internal services. Size, depth, format, network, DNS, and egress constraints reject or quarantine it.
- A model invents evidence or tool arguments. Evidence identifiers must resolve under current ACLs, schemas reject unknown fields, and action approval displays the exact canonical payload.
- A remote MCP server changes its tools or output. Tool allowlists, server identity, schema version, approvals, egress checks, and trace records prevent silent authority expansion.
- An evaluator or trace store captures secrets or restricted content. Evaluation datasets are minimized and tenant-scoped; trace exports default to metadata and redacted references.

## Residual risk

Pooled graph isolation remains weaker than PostgreSQL RLS. H1 accepts this only with bounded server-owned query templates, tenant-qualified projection assertions, two-tenant tests, and no arbitrary Cypher. Failure of any control blocks release and triggers isolated graph deployment analysis.

