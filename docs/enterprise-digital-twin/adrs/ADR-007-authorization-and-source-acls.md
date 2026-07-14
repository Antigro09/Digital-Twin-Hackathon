---
id: ADR-007
title: Layered Authorization and Source ACL Propagation
status: accepted
version: 1.0.0
owners: [authorization]
last_reviewed: 2026-07-13
---

# ADR-007: Layered Authorization and Source ACL Propagation

## Decision

OIDC or SAML establishes identity; SCIM manages H2 lifecycle. A relationship-based policy service evaluates resource and action authorization, while PostgreSQL RLS enforces tenant isolation. Source ACLs attach to evidence and constrain every derived claim, edge, embedding, summary, cache, count, notification, export, and agent context.

Visibility is monotonic: derivation cannot broaden access. A relationship is visible only when its policy, endpoints, and qualifying evidence are visible. Revocation invalidates caches and queues projection rebuilds. High-risk reads fail closed when policy or source ACL state is unavailable.

