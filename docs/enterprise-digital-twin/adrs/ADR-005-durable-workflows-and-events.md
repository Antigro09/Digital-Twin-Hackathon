---
id: ADR-005
title: Temporal Workflows and Transactional Outbox
status: accepted
version: 1.0.0
owners: [workflow-platform]
last_reviewed: 2026-07-13
---

# ADR-005: Temporal Workflows and Transactional Outbox

## Decision

Temporal owns durable synchronization, model runs, approvals, external actions, compensation, and long-running simulations. Transactional changes append an outbox record in the same PostgreSQL transaction. A relay publishes CloudEvents-compatible events and records delivery checkpoints.

Workflow code MUST be deterministic; external I/O occurs in idempotent activities. Retries are error-classified. Cancellation, timeouts, heartbeats, backpressure, dead-letter review, and replay behavior are specified per workflow.

Kafka is introduced only if outbox throughput, retention, replay consumers, or data-plane decoupling miss a committed objective. NATS is rejected unless a distinct edge command requirement appears.

