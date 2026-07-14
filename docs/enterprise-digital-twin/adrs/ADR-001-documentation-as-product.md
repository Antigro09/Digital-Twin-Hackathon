---
id: ADR-001
title: Documentation as a Versioned Product
status: accepted
version: 1.0.0
owners: [enterprise-architecture]
last_reviewed: 2026-07-13
---

# ADR-001: Documentation as a Versioned Product

## Context

One monolithic narrative cannot safely govern contracts, catalogs, diagrams, decisions, reviews, and multi-year evolution.

## Decision

Maintain normative Markdown chapters, YAML catalogs, machine-readable contracts, diagram sources, ADRs, and review evidence under one semantic version. Generate consolidated reader editions from these sources. Stable identifiers and automated traceability are release requirements.

## Consequences

Authors must change the smallest authoritative artifact and regenerate editions. Generated output is never edited directly. Conflicts follow `decision-precedence.md`. Version 1.0.0 freezes H1/H2 decisions; later changes require change classification and an ADR where behavior changes.

