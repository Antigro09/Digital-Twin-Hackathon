---
id: ADR-011
title: Hostile-Input Connector and Synchronization Framework
status: accepted
version: 1.0.0
owners: [integrations]
last_reviewed: 2026-07-13
---

# ADR-011: Hostile-Input Connector and Synchronization Framework

## Decision

Each installation uses tenant-scoped credentials, least scopes, an egress allowlist, resource quotas, signed webhook verification, durable cursor checkpoints, periodic reconciliation, normalized immutable observations, tombstones, and error-classified retries. Parsers treat every byte as hostile and isolate expensive or risky formats.

GitHub H1 is read-only metadata for allowlisted sandbox repositories. Jira H1 reads allowlisted sandbox projects and exposes one exact dual-approved remediation mutation. Source revisions win within their object lineage; canonical claims preserve conflicting evidence rather than silently overwrite it.

