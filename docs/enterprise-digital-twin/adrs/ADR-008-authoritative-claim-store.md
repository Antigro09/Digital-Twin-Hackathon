---
id: ADR-008
title: PostgreSQL Authoritative Claim and Evidence Store
status: accepted
version: 1.0.0
owners: [data-platform]
last_reviewed: 2026-07-13
---

# ADR-008: PostgreSQL Authoritative Claim and Evidence Store

## Decision

PostgreSQL is authoritative for tenants, identities, source accounts, observations, claims, evidence, aliases, resolution decisions, ontology versions, workflow metadata, scenarios, approvals, action receipts, and audit indexes. Claims use valid-time and system-time intervals and carry confidence, classification, source revision, evidence, and ACL.

Raw payload bytes and large artifacts live in content-addressed S3-compatible object storage. Ordinary aggregates keep current state plus immutable version history; full event sourcing is limited to observations, claims, audit, and the outbox.

## Consequences

Recovery begins with PostgreSQL and object storage. Derived graph, search, vector, and analytics stores never become an untracked source of truth.

