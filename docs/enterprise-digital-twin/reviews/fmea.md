---
id: EDT-REVIEW-FMEA-001
title: Failure Mode and Effects Analysis
status: committed
version: 1.0.0
owners: [reliability-engineering]
last_reviewed: 2026-07-13
---

# Failure Mode and Effects Analysis

Scores use 1-5 severity, occurrence, and detectability. RPN is their product. Any severity 5 security or tenant-isolation failure blocks release regardless of RPN.

| Failure mode | Effect | S | O | D | RPN | Detection and response |
|---|---|---:|---:|---:|---:|---|
| PostgreSQL unavailable | Authoritative reads and writes stop | 5 | 2 | 1 | 10 | Fail closed, readiness false, queue safe connector checkpoints, alert, restore or failover |
| Object store unavailable | New raw payload persistence stops | 4 | 2 | 2 | 16 | Do not acknowledge source event until durable; backpressure and retry |
| Neo4j unavailable | Graph exploration and graph-dependent answers unavailable | 3 | 3 | 1 | 9 | Preserve authoritative writes, mark graph stale, offer evidence search where safe, rebuild projection |
| Partial projection | Paths or counts omit new claims | 4 | 3 | 2 | 24 | Checkpoint lag, answer freshness labels, bounded fail-closed policy for high-risk questions |
| Duplicate or reordered source event | Duplicate facts or state regression | 4 | 3 | 2 | 24 | Provider revision ordering, observation uniqueness, idempotent reducers, reconciliation |
| Missed webhook | Stale organizational state | 3 | 3 | 2 | 18 | Freshness SLO, periodic reconciliation, cursor comparison |
| ACL revocation lag | Unauthorized derived access | 5 | 2 | 2 | 20 | High-priority invalidation, policy version checks, cache purge, projection rebuild, incident if breached |
| Model provider unavailable | Answers and extraction delayed | 3 | 3 | 1 | 9 | Queue within expiry, fail closed, no unevaluated fallback, visible status |
| Model hallucination | Unsupported organizational claim | 4 | 3 | 3 | 36 | Evidence resolution, citation verifier, abstention threshold, continuous eval |
| Prompt injection | Exfiltration or unintended action | 5 | 3 | 3 | 45 | Content separation, schema boundaries, tool gateway, approvals, red-team suite |
| Workflow worker crash | Run pauses or repeats activity | 3 | 3 | 1 | 9 | Temporal replay, heartbeats, idempotent activities, bounded retry |
| Action approval expires | User expects action but none occurs | 2 | 3 | 1 | 6 | Explicit status, no execution, create a new preview |
| Jira times out after accepting write | Duplicate issue risk | 4 | 2 | 3 | 24 | Provider correlation and idempotency lookup before retry |
| Compensation fails | External state differs from intended rollback | 4 | 2 | 1 | 8 | Manual-intervention terminal state, alert, evidence and runbook |
| Cache stale or poisoned | Wrong result or authorization leak | 5 | 2 | 3 | 30 | Tenant-qualified keys, policy version, short TTL, never authoritative, canary tests |
| Clock skew | Approval or temporal query inconsistency | 3 | 2 | 2 | 12 | Trusted time service, server timestamps, skew monitoring, leeway bounds |
| Regional loss | H2 service outage and possible data loss | 5 | 1 | 2 | 10 | Encrypted backup, restore drill, RPO/RTO alert and projection rebuild |
| Deployment rollback with schema mismatch | Runtime failure or data incompatibility | 4 | 2 | 2 | 16 | Expand-contract migrations, compatibility gate, feature flags, forward-fix plan |

