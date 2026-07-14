---
id: ADR-010
title: Minimal Specialized Data Stores
status: accepted
version: 1.0.0
owners: [search-platform]
last_reviewed: 2026-07-13
---

# ADR-010: Minimal Specialized Data Stores

## Decision

H1 uses PostgreSQL full-text search and pgvector with tenant-scoped indexes. Valkey provides non-authoritative cache, rate limiting, and ephemeral coordination. OpenSearch is introduced when corpus size, hybrid relevance, faceting, or latency objectives fail. ClickHouse is introduced when analytical retention or concurrency harms PostgreSQL. S3/Parquet/Iceberg is a later cold-history and backtesting plane.

Qdrant requires a vector benchmark; Milvus and Elastic are rejected by default to avoid duplicate responsibilities. Time-series measurements use PostgreSQL initially and ClickHouse after the same evidence gate.

