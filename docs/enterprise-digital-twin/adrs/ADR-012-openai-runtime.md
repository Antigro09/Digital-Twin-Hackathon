---
id: ADR-012
title: Historical OpenAI-First Capability Gateway
status: accepted
version: 1.0.0
owners: [ai-platform]
last_reviewed: 2026-07-15
superseded_by: ADR-018
---

# ADR-012: Historical OpenAI-First Capability Gateway

This accepted decision is superseded in full by `ADR-018`. It remains in the ledger to preserve the decision history; wherever the two conflict, `ADR-018` has precedence.

## Decision

The original decision selected the OpenAI Responses API and Python Agents SDK behind an internal gateway that owned capability routing, tenant policy, budgets, redaction, model and prompt versions, retention configuration, and evaluation status.

The enduring controls—evaluated pinned configurations, strict structured output, no unapproved fallback, and fail-closed behavior—are retained by `ADR-018`. The provider-first constraint is not.

## Consequences

OpenAI is no longer the mandatory H1 provider. It is an optional adapter that must pass the same workload-specific gates as the Llama route.
