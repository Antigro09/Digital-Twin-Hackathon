---
id: EDT-GOV-001
title: Decision Precedence and Change Control
status: committed
version: 1.0.0
owners:
  - architecture-review-board
last_reviewed: 2026-07-13
---

# Decision Precedence and Change Control

## Precedence

When artifacts disagree, apply this order:

1. Accepted ADRs that explicitly supersede an earlier decision.
2. Machine-readable API, event, ontology, and schema contracts.
3. Security, privacy, and AI control requirements.
4. Normative chapter text.
5. Diagrams.
6. Non-normative examples.

Security controls may narrow a capability but cannot silently broaden it. A contract cannot weaken a mandatory control. Such a conflict blocks release and requires an ADR.

## Change classes

| Class | Example | Required action |
|---|---|---|
| Patch | Typo or clarification with no behavioral effect | Review plus patch version. |
| Compatible feature | Optional response field or new event type | ADR, compatibility proof, minor version. |
| Breaking change | Removed field, changed authorization, altered ontology semantics | Migration plan, deprecation window, major version. |
| Control change | New approval or retention rule | Threat/privacy review and ADR. |
| Horizon promotion | Provisional capability becomes committed | Entry evidence, capacity/evaluation results, ADR. |

## Decision states

Every major decision is `proposed`, `accepted`, `superseded`, or `rejected`. Only accepted ADRs are normative. Provisional and research capabilities MUST state an entry gate and accountable owner.

## Risk acceptance

Critical and High risks cannot be accepted for H1 or H2. Medium risks require a named accountable owner, expiry date, compensating controls, and revisit trigger. Risk acceptance cannot override law, contractual commitments, tenant isolation, or the prohibited-use policy.

