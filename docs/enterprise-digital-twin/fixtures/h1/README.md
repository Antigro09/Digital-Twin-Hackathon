---
id: EDT-FIXTURE-H1
title: H1 Synthetic Fixture and Ground-Truth Oracle
status: committed
version: 1.0.0
owners:
  - quality-engineering
  - data-platform
last_reviewed: 2026-07-13
---

# H1 Synthetic Fixture and Ground-Truth Oracle

This directory freezes the deterministic two-tenant reference workload from CH-02. It is specification evidence, a test-data generator contract, and the source of expected outcomes. It contains no customer data.

## Artifacts

| File | Purpose |
|---|---|
| `seed-manifest.yaml` | Root seed, clock, canonical tenant and connector identifiers, exact source counts, allowlists, deterministic expansion rules, and canonical SHA-256 digests for every companion fixture. |
| `source-fixtures.yaml` | Decision-chain source objects, secondary risks, ACL classes, duplicate-name traps, and Beacon isolation canary. |
| `identity-mappings.yaml` | Fixed actor mappings, generated-person ranges, cross-source merge oracle, and required non-merges. |
| `permission-matrix.yaml` | Actor grants, denials, evidence visibility, approval separation, and expected indistinguishable-not-found cases. |
| `ground-truth-oracle.yaml` | Expected graph, answer, simulation, action, replay, rollback, and tenant-isolation outcomes. |

## Deterministic generation contract

The generator consumes UTF-8 YAML after normalizing line endings to LF. It uses the root seed and the manifest's `uuidv5` rule for stable internal identifiers. Synthetic filler records are generated in lexical source-key order from the declared counts; their content MUST NOT add a path to the Orion launch milestone or include the Beacon canary outside Beacon. Reordering YAML fields cannot change generated identifiers or oracle outcomes.

The fixture loader refuses a real provider credential, non-synthetic environment, undeclared tenant, undeclared project or repository, wall-clock time, or output path outside its isolated fixture namespace. Rerunning the seed is idempotent. A destructive reset requires the synthetic marker, resolved namespace preview, and explicit confirmation.

## Oracle use

Tests execute ingestion and projection rather than copying final answers. The oracle is compared only after normalization, authorization, graph projection, cited retrieval, simulation, action execution, and compensation complete. Numeric simulation tolerances are those in CH-02; all authorization, action-count, identifier, digest, and citation membership checks are exact.
