---
id: CH-13
title: Deployment and Operations
status: Committed
version: 1.0.0
owners:
  - Platform Engineering
  - Site Reliability Engineering
  - Release Engineering
last_reviewed: 2026-07-13
---

# Deployment and Operations

## 1. Deployment principles

Cloud neutrality means the application is packaged as OCI images, production workloads run on Kubernetes through Helm, infrastructure is described with OpenTofu-compatible HCL, authoritative state uses PostgreSQL-compatible SQL and S3-compatible objects, identity uses OIDC/SAML/SCIM, and telemetry uses OpenTelemetry. It does not mean simultaneous active-active deployment to multiple clouds, maintaining duplicate infrastructure stacks, or guaranteeing identical behavior from every provider service.

All environments are created or reconciled from reviewed source. Production changes use signed immutable artifacts and GitOps. Manual mutation is an incident or break-glass event, must be audited, and must be reconciled back to code.

## 2. Supported deployment profiles

| Profile | Status | Intended use | Topology and data |
|---|---|---|---|
| local-compose | Committed | Developer workstation, CI integration, deterministic demonstration | Docker Compose; one instance of each workload and dependency; synthetic data only; no HA claim |
| h1-demo | Committed | Hackathon presentation and reproducible evaluator environment | Compose on one secured host, exactly two synthetic tenants, and the versioned deterministic GitHub/Jira provider simulators in `fixtures/h1/`; a live provider sandbox is an optional non-normative extension and cannot replace acceptance evidence |
| h2-shared-regional | Committed | Up to ten design-partner tenants | One Kubernetes regional application plane; multi-zone managed PostgreSQL, object, Temporal, graph and cache; pooled relational tenancy with isolated tenant data namespaces |
| h4-dedicated-tenant | Provisional | Customer requiring a dedicated data plane | Separate account/project, cluster and data services; same images/contracts; introduced only after cost and operations review |
| h4-customer-vpc | Provisional | Vendor-managed application in a customer-controlled network/account | Dedicated data plane, customer network and key integrations, supported egress contract |
| h4-on-premises | Provisional | Customer-operated Kubernetes and approved local dependencies | Validated distribution, support bundle, upgrade preflight, no unmanaged configuration drift |
| h4-air-gapped | Provisional | Disconnected customer environment | Offline signed bundle and mirror; connectors/model capabilities disabled unless approved local endpoints exist |
| h4-regional-multi-cluster | Provisional | Residency or recovery placement | Single authoritative writer with controlled failover; no active-active claim |
| edge | Research | Bounded read-only/disconnected use | No authoritative writes, external actions, identity merge, or autonomous synchronization until consistency and revocation are designed |

Only local-compose, h1-demo, and h2-shared-regional are release-blocking for the current specification. Kubernetes and Helm are adopted at the H2 boundary because they are part of the committed regional pilot topology; their supported versions, charts, resource envelopes, and conformance evidence must be frozen before the first design-partner production deployment. Other profiles cannot be sold as supported until their acceptance suite, operations ownership, upgrade path, recovery target, security review, and cost model pass.

## 3. Local and H1 Compose profile

The Compose project contains:

- web;
- API;
- synchronization worker;
- intelligence worker;
- PostgreSQL with pgvector;
- Temporal server and its persistence;
- one pooled Neo4j logical projection with mandatory tenant-qualified nodes, relationships, query templates, credentials, and result reauthorization; per-tenant databases or instances are not an H1/H2 deployment choice;
- MinIO;
- Valkey;
- disposable OIDC provider;
- OpenTelemetry collector plus reference Prometheus, Grafana, Loki, and Tempo services;
- optional GitHub/Jira provider simulators for deterministic tests.

Rules:

1. Only web and API bind host interfaces by default. Database, graph, cache, object, Temporal, and telemetry administration bind loopback or an internal Compose network.
2. Development certificates and secrets are generated per checkout and stored outside version control. They are marked development-only and cannot satisfy production configuration validation.
3. Health checks and dependency ordering control readiness, but applications still tolerate dependency restarts.
4. Images run the same entrypoints, schema versions, non-root user, and read-only filesystem used in Kubernetes.
5. Named volumes make restarts realistic. The reset command refuses non-synthetic environments and prints the resolved absolute volume/project scope before deletion.
6. A seed value creates the same two tenants, identities, source payloads, oracle, graph, scenarios, and expected action target.
7. Local deterministic tests can run without public provider/model credentials by using signed provider fixtures and recorded model-safe stubs. Stubs cannot satisfy the model-integration, AI-evaluation, or cited-answer release gate; the H1 presentation/release evidence includes an approved live OpenAI endpoint run. Live mode is explicit and is not used to establish deterministic fixture assertions.
8. Compose is not a production HA profile and does not support real customer data.

The required developer experience is a cross-platform Node launcher that implements bootstrap, start, stop, seed, test, verify, export-logs, and reset. It wraps Compose and workspace commands so developers do not memorize container sequencing.

## 4. H2 regional Kubernetes topology

### 4.1 Accounts, networks, and namespaces

The reference deployment uses a dedicated cloud account/project and virtual network per environment and region. Production, staging, CI, and development do not share clusters, databases, KMS keys, object buckets, IdP clients, or credentials.

Kubernetes namespaces:

| Namespace | Contents | Access |
|---|---|---|
| edt-ingress | ingress controller and certificate integration | Public load balancer to web/API routes only |
| edt-app | web and API deployments | Can reach required data endpoints; no provider/model secret except API-required capability |
| edt-workers | synchronization and intelligence workers | No public ingress; queue-specific identities and egress |
| edt-observability | OpenTelemetry collectors and reference agents | Receives telemetry; cannot query business databases |
| edt-operators | external-secrets and GitOps agents | Narrow cloud/Kubernetes permissions; no source-content read |

Temporal and stateful databases are managed services or run in a separately controlled data namespace/account. Running production PostgreSQL, object storage, or Neo4j inside the application cluster requires a deployment-profile ADR proving backup, restore, upgrades, anti-affinity, storage failure, security, and operator ownership.

Network zones are:

- public edge: CDN/WAF where available, load balancer, TLS, DDoS controls;
- application: web/API private pods;
- worker: no inbound public path;
- data: private endpoints for PostgreSQL, Neo4j, object, Valkey, Temporal, KMS and secrets;
- egress: explicit proxies/private endpoints for GitHub, Jira, approved model endpoints, identity, package/security update services, and telemetry destination.

Default-deny NetworkPolicy applies to ingress and egress. DNS is allowed only through the cluster resolver. Cloud metadata endpoints are blocked from pods. Provider egress validates host after DNS resolution and redirect.

### 4.2 Workload security and scheduling

Every pod:

- runs as a fixed non-zero UID/GID with runAsNonRoot;
- uses readOnlyRootFilesystem and explicit ephemeral volumes;
- sets allowPrivilegeEscalation false;
- drops all Linux capabilities;
- uses RuntimeDefault seccomp;
- has automountServiceAccountToken false unless Kubernetes API access is required;
- has CPU/memory requests and limits based on load tests;
- has liveness, readiness, and startup probes with the semantics in CH-10;
- emits graceful shutdown and stops accepting work before termination;
- uses a dedicated service account and workload identity;
- is admitted only if image digest, signature, provenance, vulnerability policy, and required labels pass.

The cluster enforces the Restricted Pod Security Standard. Web/API and workers use separate node pools only when workload isolation, GPU, or resource economics require it; H1/H2 do not require GPU. TopologySpreadConstraints distribute replicas across zones and nodes. PodDisruptionBudgets preserve at least one ready replica while respecting safe maintenance.

Horizontal scaling signals:

- web/API: request concurrency, p95 latency, and CPU, with maximum database connections as a hard ceiling;
- sync worker: Temporal task queue age and provider quota;
- intelligence query worker: task age relative to run deadline and model concurrency;
- simulation worker: queued CPU work and reserved memory;
- no autoscaler may exceed tenant quota, provider limit, model cost budget, or database connection budget.

Minimum H2 replicas are two for each first-party workload and OpenTelemetry collector across failure zones. A queue can be served by a shared worker deployment only if one workload image still preserves the logical task-queue and resource isolation.

### 4.3 Data services

- PostgreSQL uses multi-zone primary/standby, encrypted storage, automated failover, continuous point-in-time recovery, private endpoints, non-superuser workload roles, connection pooling, and query/audit extensions approved by security.
- Neo4j uses the pooled logical-namespace controls in CH-05 and CH-09 with private endpoints. Typed gateways are the only clients, every element is tenant-qualified, and results are reauthorized. Its topology must pass isolation, tenant restore and shadow-rebuild tests at 10 million edges per tenant. Dedicated graph placement is an H3 benchmark/security transition, not the H1/H2 default.
- Object storage enables versioning, encryption, access logging, lifecycle, deletion protection for backups, and approved-region replication for RPO.
- Valkey/Redis uses private endpoints, TLS, ACLs, failover, max-memory policy suitable for disposable cache data, and no public access.
- Temporal uses a production-supported multi-zone topology or managed service, separate namespace, TLS, payload codec configuration, retention sized for recovery, and queue-level permissions.
- KMS and secret manager have separate production keys/policies, rotation, deletion protection, audit logging, and break-glass recovery.

Application configuration resolves tenant storage placement from authoritative control data. A caller cannot choose a database, graph, bucket, region, or key.

## 5. Infrastructure as code

OpenTofu is the reference engine and sole source of shared-infrastructure truth. Terraform execution is allowed only when the same module tree and state format are compatible; maintaining forked OpenTofu and Terraform definitions is prohibited.

Module layers are:

1. bootstrap: remote state storage, locking, KMS, CI deploy identity, audit destination;
2. foundation: account/project policy, network, subnets, DNS, private endpoints, firewall and egress;
3. data: PostgreSQL, object, Neo4j, Valkey, Temporal persistence/service integration, backups;
4. platform: Kubernetes, node pools, ingress, certificates, workload identity, external secrets, observability, GitOps;
5. application bindings: databases/roles, buckets/policies, task queues, model/provider endpoints, tenant placement;
6. recovery: backup vault, recovery-region foundation, restore permissions and DNS controls.

State is separated by environment, region, and deployment profile. It is encrypted, versioned, locked, access logged, and unavailable to application workloads. State can contain sensitive metadata and is Restricted. CI uses OIDC federation and short-lived roles; it has no static cloud keys.

Every change runs format/check, provider lock verification, policy scan, speculative plan, cost estimate, and human review. Production apply requires a protected branch, approved plan artifact, environment approval, and exact commit/digest match. A plan older than 24 hours or created from a different state serial is invalid.

Importing an existing resource requires owner review and a no-change plan. Console changes trigger drift detection at least hourly in production. Emergency manual changes create an incident, receive the shortest safe lifetime, and are codified or reverted before closure.

Destructive plans for databases, buckets, KMS keys, backup vaults, tenant namespaces, network boundaries, and audit stores are denied by policy unless a separately authorized decommission workflow supplies a tenant deletion record and recovery evidence.

## 6. Helm, configuration, and secrets

Helm has one library chart for common security/telemetry/probe behavior and deployable charts for web, API, sync worker, intelligence worker, and reference observability. Environment values configure scale and endpoints, not application secrets or policy logic.

Rendered manifests are the review artifact. CI validates schema, Kubernetes version compatibility, deprecated APIs, Pod Security, NetworkPolicy, resource requests/limits, probes, disruption budgets, topology, and image digests.

Configuration precedence is:

1. versioned secure defaults;
2. environment ConfigMap generated from a typed schema;
3. deployment-profile values;
4. tenant configuration read from authorized PostgreSQL records;
5. secret references resolved from the external secret manager.

Unknown configuration keys, missing required values, unsafe production defaults, unsupported schema versions, development credentials, public data endpoints, or floating image/model aliases fail startup. Configuration values include owner, type, classification, default, environment scope, reload behavior, and deprecation.

Secrets are mounted through External Secrets Operator or a provider CSI integration using workload identity. Values are not committed, included in Helm release history, passed as image build arguments, or printed. Applications prefer file descriptors/mounted files and support overlap rotation. OAuth and database credential rotation is tested without tenant downtime.

Feature flags:

- are typed, owner-bound, tenant-scoped, time-limited, and audited;
- default off for new risky behavior;
- cannot disable authentication, authorization, RLS, ACL filtering, audit, approval, redaction, or kill switches;
- include removal date and do not become permanent configuration;
- are evaluated server side for security-relevant behavior.

## 7. Build and release pipeline

### 7.1 Artifact creation

GitHub Actions uses pinned actions by commit and OIDC federation. Untrusted pull-request code cannot access production secrets, signing identities, package publication, or deployment roles.

One commit produces:

- immutable OCI images for all four workloads;
- Helm package and rendered reference manifests;
- OpenTofu module bundle and provider lock;
- consolidated HTML/PDF specification and coverage reports;
- OpenAPI, AsyncAPI, JSON Schema, GraphQL and Protobuf artifacts;
- SPDX or CycloneDX SBOM for each image;
- test, evaluation, security scan, license and benchmark evidence;
- SLSA-style provenance and Cosign signatures.

Build stages are source/secret/license scan, dependency install from locks, lint/type/unit, contract generation and drift check, integration, security/property/fuzz, deterministic AI/simulation evaluation, image build, image scan, SBOM, signature/provenance, ephemeral deployment, end-to-end/accessibility, and release-gate attestation.

Critical or exploitable High findings block artifact promotion. Exceptions require the security owner, service owner, compensating control, expiry no longer than 14 days, and customer-impact review.

### 7.2 Promotion and GitOps

The same image digest moves through ephemeral, staging, canary, and production. Rebuilding for an environment is prohibited. An environment repository records desired release digest, chart version, configuration schema, database schema range, model registry version, and contract version.

Argo CD reconciles Kubernetes desired state. Production sync is manual after release approval and then automated for drift correction. Its identity can deploy namespaced application resources but cannot read tenant content, decrypt arbitrary secrets, alter backup vaults, or create cluster-admin bindings.

Promotion requires:

- all CH-14 release gates;
- compatible database, Temporal workflow, API/event, connector, graph projection and model versions;
- successful backup and recent restore evidence;
- error budget available;
- no open Critical/High architecture or security finding;
- on-call and rollback owner present;
- tenant communication for a breaking operational change.

## 8. Safe upgrades and rollback

### 8.1 Compatibility order

Every change uses expand, migrate, contract:

1. Take/verify recovery point and deploy additive database schema. Migrations acquire an advisory lock, have time/lock limits, and avoid table rewrites in peak traffic.
2. Deploy code that reads old and new shapes and writes the new authoritative shape.
3. Run resumable, tenant-bounded, observable backfill with checkpoints and rate limits.
4. Verify counts, hashes, RLS, projections, API/event compatibility, and old-version readers.
5. Shift traffic and workers gradually.
6. Remove old writes only after rollback window.
7. Remove old columns/contracts in a later release with explicit deprecation evidence.

Production rollback never blindly runs a destructive down migration. Application images roll back within their declared database-schema range. An incompatible data change uses a forward fix or restored shadow environment and controlled cutover.

Temporal workflow changes use version markers/build IDs and replay tests. Existing workflows remain on compatible worker code until complete or explicitly migrated. An activity name or payload cannot be reused with changed semantics.

Events are additive within a major version. Consumers ignore unknown optional fields. Removing/renaming fields or changing meaning requires a new type/version and parallel publication during migration.

Graph projection changes build a shadow tenant projection, validate it, and switch an alias/config pointer. The old projection remains through rollback window. Embedding/model changes use versioned rows and dual-read evaluation before cutover.

### 8.2 Rollout policy

- Web/API stateless releases use 5 percent, 25 percent, 50 percent, then 100 percent traffic, with at least 10 minutes and sufficient sample volume at each gate.
- Workers use Temporal build-compatible canary queues or a controlled percentage of new workflow starts. A worker canary cannot compete for incompatible existing tasks.
- Connector changes canary on synthetic tenants, then an internal tenant, then one consenting pilot tenant before broader rollout.
- Projection and model changes are tenant-scoped and reversible.
- Automatic rollback triggers on fast SLO burn, readiness regression, security control failure, unexpected authorization denial/allow, audit gap, duplicate side effect, schema error, or material evaluation regression.

Rollback stops new work, preserves evidence, reverts routing/image/config, reconciles in-flight workflows/actions, and verifies data versions. Security correctness takes precedence over availability; a potentially unsafe version is disabled even if rollback is not immediately possible.

## 9. Backup and disaster-recovery operations

The backup and recovery objectives are normative in CH-10. Deployment must provision:

- PostgreSQL continuous archive and daily full backups in an encrypted deletion-protected vault;
- Temporal persistence backup appropriate to the service;
- object versioning and approved-region protected copy;
- independent signed audit-root retention;
- Git and artifact registry replication for configuration and images;
- recovery-region network, KMS and restore roles either preprovisioned or tested to provision inside the four-hour RTO.

Neo4j, vector/search indexes, and caches are reconstructed. They do not define RPO.

Restore jobs never connect restored data to production traffic. They use an isolated recovery network, apply deletion/revocation tombstones, scan integrity, rebuild projections, and run tenant isolation tests. Restore access is temporary, purpose-bound, and audited. Test data is destroyed after evidence capture.

Disaster-recovery runbooks are executable checklists with command ownership, required approvals, timestamps, abort conditions, DNS/credential steps, workflow/action reconciliation, privacy/residency checks, customer communication, and return-to-primary. A regional exercise cannot use shortcuts unavailable during a real outage.

## 10. Later deployment profiles

### 10.1 Dedicated/customer VPC

A dedicated profile reuses the same contracts and release artifacts but provisions a separate account/project, virtual network, Kubernetes cluster, data services, KMS keys, backup vault, telemetry boundary, and provider/model egress policy. The control plane can hold non-content fleet metadata, but tenant source content and credentials remain in the dedicated data plane.

Remote management uses outbound authenticated control channels or customer-approved private connectivity. There is no permanent inbound SSH or shared administrator credential.

### 10.2 On-premises

The supported bill of materials must freeze Kubernetes versions, storage classes, PostgreSQL/pgvector, Neo4j, S3-compatible storage, Valkey, Temporal, ingress, identity, secret manager, telemetry and registry requirements. A preflight tool verifies CPU/memory/storage IOPS, clocks, DNS, certificates, egress, backup target, identity claims, storage snapshots and required APIs.

Support bundles are customer-triggered, previewable, redacted, encrypted to support, expiring, and audited. They contain configuration/health summaries and pseudonymous diagnostics, never source content, secrets, raw prompts, model responses, or unrestricted database dumps.

### 10.3 Air-gapped

An offline release bundle contains signed images, charts, OpenTofu/manifest options, SBOMs, provenance, licenses, vulnerability database snapshot/date, documentation, migration tool, preflight, and verification public keys. Import verifies every digest/signature without network access.

GitHub, Jira and OpenAI capabilities are unavailable unless the customer provides approved reachable equivalents with the same connector/model contract and evaluation. The UI must state capability unavailable; it cannot silently simulate live synchronization or model reasoning. Security updates use a documented out-of-band bundle and emergency cadence.

### 10.4 Regional and multi-cloud

H4 can place tenants in regional cells with a home-region catalog. Each tenant has one authoritative writer. Recovery uses controlled failover to an approved region; active-active writes are not supported. Multi-cloud portability is tested through a second provider deployment rehearsal, not simultaneous production.

Before support, the profile must freeze conflict semantics, global identity dependency, key ownership, audit ordering, connector ownership, Temporal failover, data transfer, model residency, network partitions, failback, cost and customer-visible RPO/RTO.

## 11. Operational ownership

| Area | Accountable owner | Required runbooks |
|---|---|---|
| Web/API | Product Platform | SLO burn, bad rollout, auth failure, rate-limit failure |
| Synchronization/connectors | Integration Platform | provider outage, cursor repair, compromised installation, DLQ, reconciliation |
| Intelligence/model | AI Platform | model outage, safety/eval regression, cost exhaustion, cancellation |
| Simulation | AI/Data Platform | deterministic mismatch, resource saturation, invalid graph |
| PostgreSQL/object | Data Platform | failover, corruption, restore, storage/key exhaustion, migration |
| Neo4j/projections | Graph Platform | lag, divergence, tenant rebuild, query saturation |
| Temporal | Platform Engineering | task backlog, namespace outage, worker compatibility, history growth |
| Identity/authorization/security | Security Engineering | IdP failure, revocation, cross-tenant incident, break glass, mutation kill switch |
| Release/IaC/Kubernetes | Platform Engineering | failed deploy, drift, cluster failure, certificate/DNS, rollback |
| Privacy | Privacy owner | access/export, deletion, legal hold, region/subprocessor incident |

H2 has a named primary and secondary on-call, Severity 1 response process, customer communication owner, maintenance schedule, and blameless postmortem policy. Postmortems record detection, impact, timeline, contributing conditions, safety controls, recovery, evidence, action owners and verification dates.

Capacity, cost, restore, access, vulnerability, dependency end-of-life, certificate, key, and error-budget reviews occur monthly. Production access and break-glass grants are reviewed quarterly.

## 12. Acceptance criteria

| Evidence ID | Canonical acceptance | Criterion |
|---|---|---|
| TC-OPS-001 | AC-PROD-001 and AC-REV-001 | A clean workstation can bootstrap, seed, run, verify, export diagnostics, and reset the H1 Compose profile without undocumented manual steps. |
| TC-OPS-002 | AC-REV-001 | H1 Compose uses the same workload entrypoints, non-root identity, schemas, migrations, contracts, and health semantics as Kubernetes. |
| TC-OPS-003 | AC-SUP-001 and AC-SEC-001 | H2 manifests pass Restricted Pod Security, default-deny network, workload identity, immutable digest, resources, probes, disruption, spread, and signature admission tests. |
| TC-OPS-004 | AC-SUP-001 | OpenTofu can create a clean H2 environment, produce a no-drift second plan, and reject destructive protected-resource changes. |
| TC-OPS-005 | AC-SUP-001 | CI produces one signed, provenance-attested, SBOM-linked release whose exact digests are promoted unchanged through staging and production. |
| TC-OPS-006 | AC-REL-003 | Expand/migrate/contract, Temporal replay, event compatibility, shadow projection, model/embedding dual-read, canary, and rollback rehearsals preserve business and security invariants. |
| TC-OPS-007 | AC-REL-003 and AC-ACT-002 | A failed rollout automatically stops promotion and leaves every external action and workflow in a reconciled terminal or intervention state. |
| TC-OPS-008 | AC-REL-002 | Backup and full recovery exercises meet one-hour RPO and four-hour RTO, replay deletion/revocation, rebuild projections, and verify audit and tenant isolation before traffic. |
| TC-OPS-009 | AC-SEC-001 | Secrets never occur in source, state-plan output, Helm history, images, logs, support bundles, or CI artifacts; rotation succeeds without tenant data exposure. |
| TC-OPS-010 | AC-REV-001 | Each committed deployment profile has a supported bill of materials, owners, SLO/RPO/RTO, upgrade path, backup/restore, security review, cost envelope, and conformance report. |
| TC-OPS-011 | AC-DOC-002 and AC-REV-001 | Provisional and Research profiles are visibly labeled and cannot be selected in production configuration without an approved profile release. |
