---
id: ADR-004
title: Language and Interface Ownership
status: accepted
version: 1.0.0
owners: [developer-platform]
last_reviewed: 2026-07-13
---

# ADR-004: Language and Interface Ownership

## Decision

TypeScript owns web, public API, connectors, and shared browser-facing types. Python owns model integration, extraction, graph algorithms, simulation, and AI evaluations. SQL owns database invariants and migrations. REST/OpenAPI is the H1 public command interface, SSE reports progress, and signed webhooks receive source events. AsyncAPI and JSON Schema govern events.

GraphQL is a read-only H2 candidate. gRPC is reserved for extracted polyglot services. Go, Rust, WebAssembly, Java, C#, Kotlin, and Swift require the introduction triggers in `catalogs/technologies.yaml`; C++ is rejected for the core.

## Consequences

Polyglot cost is capped at two application languages in H1. Contract generation and compatibility tests prevent type drift. No language is adopted merely because it was listed as an option.

