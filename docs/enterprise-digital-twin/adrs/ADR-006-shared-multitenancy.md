---
id: ADR-006
title: Pooled Shared Multitenancy
status: accepted
version: 1.0.0
owners: [security-architecture, data-platform]
last_reviewed: 2026-07-13
---

# ADR-006: Pooled Shared Multitenancy

## Decision

Standard SaaS uses shared stateless compute and pooled regional data services. Tenant context is derived from authenticated membership. Every row, identifier, object, event, edge, vector, cache key, trace, and audit envelope is tenant-qualified. PostgreSQL RLS and tenant-qualified constraints are the hard relational fence; other stores use independent namespaces and adversarial isolation tests.

Per-tenant envelope keys protect sensitive data and credentials. Cross-tenant retrieval, resolution, memory, analytics, and training are prohibited by default. Break-glass support is time-bound, dual-authorized, purpose-bound, and audited.

## Consequences

This is logical rather than physical isolation. Dedicated data planes are an H4 profile. Neo4j pooled isolation is a named residual risk and cannot rely on application-supplied tenant filters alone.

