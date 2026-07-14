---
id: ADR-015
title: Infrastructure-Portability Cloud Neutrality
status: accepted
version: 1.0.0
owners: [platform-engineering]
last_reviewed: 2026-07-13
---

# ADR-015: Infrastructure-Portability Cloud Neutrality

## Decision

Cloud neutrality means portable contracts and migration paths, not active-active multi-cloud. H1 runs through Docker Compose. H2 promotes OCI workloads to a conformant Kubernetes distribution with Helm and OpenTofu modules. Domain code uses PostgreSQL, S3-compatible object, OIDC/SAML/SCIM, Temporal, and OpenTelemetry interfaces. Provider-specific code is confined to infrastructure adapters.

Managed implementations are permitted when export, restore, identity, encryption, observability, and failure contracts remain testable. Dedicated, on-premises, air-gapped, edge, and multi-region profiles are H4 gates. Air-gapped mode excludes the OpenAI path until a local adapter passes evaluations.

