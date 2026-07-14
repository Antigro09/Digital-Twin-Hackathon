---
id: ADR-012
title: OpenAI-First Capability Gateway
status: accepted
version: 1.0.0
owners: [ai-platform]
last_reviewed: 2026-07-13
---

# ADR-012: OpenAI-First Capability Gateway

## Decision

Use the OpenAI Responses API and Python Agents SDK behind an internal gateway that owns capability routing, tenant policy, budgets, redaction, model and prompt versions, retention configuration, and evaluation status. Use the GPT-5.6 family by evaluated workload: sol for highest-complexity orchestration and grading, terra for balanced grounded synthesis, and luna for high-volume extraction.

Production pins evaluated snapshots. A fallback is eligible only after the same use-case safety and quality gates; otherwise the run fails closed or queues for review. OpenAI-native structured outputs and tools remain available rather than being flattened behind a lowest-common-denominator interface.

## Consequences

OpenAI is an explicit H1 external dependency. Air-gapped operation requires a separately evaluated local-model adapter in H4.

