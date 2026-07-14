---
id: EDT-REVIEW-RISK-001
title: Residual Risk Acceptance
status: committed
version: 1.0.0
owners: [architecture-review-board]
last_reviewed: 2026-07-13
---

# Residual Risk Acceptance

No Critical or High residual risk is accepted for H1 or H2.

| Risk | Rationale | Compensating controls | Owner | Expiry or revisit |
|---|---|---|---|---|
| RSK-008 cloud-neutral abstraction cost | Portability is an explicit product decision | Thin adapters, portable contracts, conformance tests | Platform | H2 provider selection |
| RSK-009 limited polyglot cost | H1 has only TypeScript and Python application runtimes | Contract generation, ownership boundaries, language introduction ADR | Architecture | H3 service extraction |
| RSK-016 synthetic data external-validity limit | Public demo safety and deterministic verification outweigh realism | No predictive-accuracy claim, golden oracle, H2 design-partner validation | Product | Before H2 prediction claims |
| RSK-019 framework CSS-tool pin | Next.js 16.2.10 pins PostCSS 8.4.31, which has a Medium stringification advisory; H1 has no untrusted CSS, templates, runtime themes, or style-stringification input | Source-controlled CSS only, zero production High/Critical dependency findings, dependency audit in CI, monthly framework update review | Developer Platform and Security Architecture | 2026-08-15, any compatible Next.js release, or any proposal for untrusted style/template input |

Acceptance expires automatically if scope, data classes, jurisdictions, deployment mode, or authority expands. A changed risk requires a new review rather than silent continuation.
