---
id: ADR-009
title: Neo4j as a Rebuildable Graph Projection
status: accepted
version: 1.0.0
owners: [knowledge-graph]
last_reviewed: 2026-07-13
---

# ADR-009: Neo4j as a Rebuildable Graph Projection

## Decision

Neo4j provides labeled-property traversal and visualization over accepted claims. Projection checkpoints bind an ontology version and authoritative outbox position. All queries use allowlisted bounded templates that inject server-derived tenant context; arbitrary Cypher is prohibited.

Projection nodes and edges preserve canonical identifiers, tenant, valid time, confidence, classification, and evidence references. ACL, correction, deletion, ontology, or merge changes can rebuild affected tenant projections from PostgreSQL.

## Consequences

Graph availability may degrade without blocking authoritative writes. Pooled isolation remains a residual risk; tests and query gateways are mandatory. H3 may move tenants to isolated graph databases or regional cells after benchmark and licensing review.

