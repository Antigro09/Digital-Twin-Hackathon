---
id: EDT-GOV-002
title: Glossary
status: committed
version: 1.0.0
owners:
  - enterprise-architecture
last_reviewed: 2026-07-13
---

# Glossary

| Term | Definition |
|---|---|
| Agent | A versioned capability profile executed inside a deterministic policy and workflow envelope. It is not an organizational officer or independent principal. |
| Authoritative store | The system whose record controls recovery and conflict resolution for a data class. |
| Claim | A bitemporal, tenant-scoped assertion about a subject with provenance, confidence, classification, and evidence. |
| Connector | A least-privilege adapter that reads or writes an allowlisted external system using tenant-scoped credentials. |
| Control plane | Shared services for tenant provisioning, policy, deployment metadata, and fleet operations; it never grants cross-tenant data access. |
| Data plane | Tenant-scoped ingestion, storage, search, graph, agent, and simulation processing. |
| Evidence | An immutable reference to the source object and location supporting a claim. |
| H1-H5 | Delivery horizons from demonstrator through separately governed research. |
| Idempotency key | A stable identifier that ensures replay of the same logical operation has one externally visible effect. |
| Observation | A normalized, immutable representation of a versioned source-system object or event. |
| Ontology package | A namespaced, versioned bundle of entity types, relationship types, properties, constraints, and migrations. |
| Projection | A rebuildable read model derived from authoritative observations and claims. |
| Scenario | A typed set of user-confirmed assumptions and interventions evaluated against a versioned simulation snapshot. |
| Source ACL | The source-system permission expression that constrains every derived claim, index, graph path, cache entry, and answer. |
| System time | When the platform learned or stored a fact. |
| Valid time | When a fact is asserted to be true in the modeled organization. |

