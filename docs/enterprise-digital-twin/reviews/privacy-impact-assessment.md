---
id: EDT-REVIEW-PRIVACY-001
title: Privacy and AI Impact Assessment
status: committed
version: 1.0.0
owners: [privacy, ai-governance]
last_reviewed: 2026-07-13
---

# Privacy and AI Impact Assessment

## Intended purpose

H1 helps an authorized software organization understand project dependencies and compare a launch-delay scenario. It uses deterministic synthetic data. H2 may process customer-approved engineering and project metadata for the same purpose under a documented controller/processor allocation and data processing agreement.

## People and data

Potential data subjects include employees, contractors, customers, vendors, and connector administrators. Data classes include identifiers, roles, project assignments, work artifacts, comments, access-control lists, service metadata, model inputs and outputs, approvals, and audit metadata. Secrets, private messages, source-file bodies, Actions logs, health data, emotion inference, and individual productivity scores are excluded from H1.

## Necessity and proportionality

- Collect only allowlisted repositories, projects, object types, and fields required for delivery dependency analysis.
- Prefer aggregate team capacity over individual behavior measures.
- Preserve source ACLs and display why a result is visible.
- Use synthetic data for public demonstrations and golden evaluations.
- Do not use customer data for cross-tenant training, retrieval, memory, or analytics without a separate explicit opt-in assessment.

## Lifecycle and rights

The data inventory records purpose, category, source, owner, retention, region, subprocessors, derived stores, and deletion method. Access, export, correction, objection, restriction, and eligible deletion requests propagate through observations, claims, objects, graph, vector, search, cache, traces, evaluation sets, and backup expiry. Legal hold is purpose-limited, access-controlled, and visible to authorized administrators.

## High-risk exclusions

Through H3 the product does not rank or score individual burnout, attrition, productivity, performance, promotion, compensation, hiring, firing, layoff, health, emotion, misconduct, or union activity. It does not make legal, credit, insurance, financial, or safety decisions. A future proposal requires a separate intended-purpose and jurisdiction assessment, counsel and DPO review, scientific construct validity, fairness evidence, meaningful human review, notice, correction and appeal, monitoring, and kill switch.

## Assessment outcome

H1 is acceptable because it uses synthetic data and enforces the same tenant, ACL, minimization, action, and audit paths planned for production. H2 remains conditional on customer-specific purpose, region, contract, retention, subprocessor, worker-notice, and source-scope approval.

