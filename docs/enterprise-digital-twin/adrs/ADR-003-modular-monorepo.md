---
id: ADR-003
title: Modular Monorepo with Four Workloads
status: accepted
version: 1.0.0
owners: [platform-architecture]
last_reviewed: 2026-07-13
---

# ADR-003: Modular Monorepo with Four Workloads

## Context

Premature microservices multiply deployment, security, consistency, and debugging costs before ownership or scale boundaries are known.

## Decision

Use one repository with four OCI workloads: React/Next.js web, NestJS/Fastify API, TypeScript connector workers, and Python AI/simulation workers. Modules own schemas and communicate through published interfaces; no module writes another module's tables.

## Consequences

Deployment remains simple while isolation and scaling boundaries are visible. Extract a service only after an accepted ADR demonstrates independent ownership, scaling, security, availability, or release needs. A service mesh is rejected until service count and zero-trust networking needs justify its control plane.

