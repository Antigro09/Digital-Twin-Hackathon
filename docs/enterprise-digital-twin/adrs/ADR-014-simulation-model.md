---
id: ADR-014
title: Seeded PERT Monte Carlo Launch Simulation
status: accepted
version: 1.0.0
owners: [simulation-science]
last_reviewed: 2026-07-13
---

# ADR-014: Seeded PERT Monte Carlo Launch Simulation

## Decision

H1 compiles Jira work links and GitHub delivery relations into a validated dependency DAG. Each unfinished work item uses user-confirmed optimistic, most-likely, and pessimistic duration inputs. A seeded Monte Carlo scheduler samples PERT distributions under team-level capacity and scenario interventions.

Outputs include p50, p80, and p95 launch dates, miss probability, critical path, blockers, sensitivity drivers, assumptions, and missing-data warnings. The LLM may compile a typed scenario and explain results but never performs the authoritative mathematics.

Cycles, impossible capacity, missing estimates, and contradictory changes produce explicit validation outcomes. Synthetic results are demonstrative, not causal or production-calibrated predictions.

