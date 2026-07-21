---
id: ADR-019
title: Separated Simulation and Predictive Intelligence
status: accepted
version: 1.0.0
owners: [simulation-science, applied-ai, data-platform]
last_reviewed: 2026-07-21
---

# ADR-019: Separated Simulation and Predictive Intelligence

## Decision

The general decision-intelligence foundation has two non-interchangeable execution paths. Simulation answers a conditional question by applying confirmed typed changes to an immutable graph-backed snapshot, propagating declared relationship weights within a bound, running versioned deterministic derived-metric rules, and comparing the branch with its baseline. Prediction answers a likelihood question by processing historical observations through a registered non-LLM statistical model, emitting a forecast, confidence evidence, limitations, and a pending-validation state.

The NestJS API owns server-derived tenancy, authorization, model/scenario lifecycle, confirmation, idempotency, PostgreSQL records, audit, and outbox publication. The Python intelligence worker owns bounded pure mathematics. The new simulation service cannot import or call the predictive service, and the predictive service cannot use simulation output as historical truth. Neither path invokes an LLM or substitutes an oracle when the worker fails.

The model registry accepts forecasting, optimization, anomaly-detection, computer-vision, and classification definitions with explicit inputs, outputs, version, accuracy, owner, trigger, lifecycle, and state hash. Only allowlisted deterministic forecasting baselines are executable in this phase; other model kinds are registered for governed future adapters.

Validated real outcomes update rolling accuracy and a bounded calibration bias through an append-only learning event. Submitted rules, specifications, corrections, historical outcomes, and expert knowledge remain pending review and cannot silently retrain or activate a model.

Hiring scenarios and workforce forecasts are aggregate-only. Person identifiers, individual attrition, performance, productivity, suitability, and hiring scores are rejected. This decision does not authorize employment decisions or remove the prohibitions in CH-09.

## Consequences

- The frozen H1 PERT/Monte Carlo scheduler and its compatibility routes remain unchanged.
- New work uses `/v1/twin/simulation/*` or `/v1/twin/prediction/*` and the `edt.decision-intelligence/1.0.0` contract.
- Production promotion still requires representative backtesting, drift and fairness review, calibration evidence, domain-owner approval, capacity testing, and durable workflow orchestration.
