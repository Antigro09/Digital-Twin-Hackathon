---
id: EDT-REVIEW-COMPLIANCE-001
title: Control Readiness Mapping
status: committed
version: 1.0.0
owners: [governance-risk-compliance]
last_reviewed: 2026-07-13
---

# Control Readiness Mapping

This is a readiness and evidence map, not a certification or legal conclusion.

| Capability | Blueprint controls | Evidence owner | H2 evidence |
|---|---|---|---|
| Access governance | CTRL-IAM-001 through CTRL-IAM-004, CTRL-TEN-001 through CTRL-TEN-003 | Identity and Security | Identity configuration, access reviews, RLS tests, break-glass records |
| Data protection | CTRL-DAT-001 through CTRL-DAT-003, CTRL-CRY-001, CTRL-CRY-002 | Data Governance | Inventory, classification, key rotation, deletion and restore evidence |
| Change and supply chain | CTRL-SUP-001 | Developer Platform | Reviewed changes, SBOM, signatures, scans, provenance and deployment records |
| Availability and recovery | CTRL-OPS-001, CTRL-OPS-002 | SRE | SLO reports, restore drills, incidents, capacity and failover tests |
| Monitoring and response | CTRL-AUD-001, CTRL-INC-001 | Security Operations | Alert tests, audit verification, incident exercises and postmortems |
| Vendor and subprocessor governance | CTRL-PRV-001, CTRL-CON-001 | Privacy and Procurement | DPA, subprocessor register, risk reviews, exit and deletion evidence |
| Privacy rights and minimization | CTRL-PRV-001, CTRL-PRV-002, CTRL-DAT-003 | Privacy | Purpose records, DPIA screens, DSAR/export/delete tests, retention reports |
| AI governance | CTRL-AI-001 through CTRL-AI-005, CTRL-ACT-001 through CTRL-ACT-003 | AI Governance | Model inventory, evaluations, prompt/tool versions, approvals, incidents and rollback tests |

SOC 2 and ISO 27001 also require organizational policies, personnel controls, vendor governance, evidence operation, internal audit, and management oversight outside the software artifact. GDPR role, lawful basis, notice, transfer, retention, and rights decisions are tenant and jurisdiction specific.

