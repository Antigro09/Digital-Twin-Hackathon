"use client";

import { useState } from "react";
import type { ActionReceipt, ApprovalRequest, ApprovalRole, CompensationPreview, JiraSnapshot, RemediationPreview } from "@/lib/api/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { Button, DefinitionList, Hash, Panel, StatePanel, StatusPill } from "./ui";

export function ActionWorkspace({
  preview,
  approval,
  receipt,
  compensation,
  busy,
  onPreview,
  onRequestApproval,
  onApprove,
  onExecute,
  onReplay,
  onPreviewCompensation,
  onApproveCompensation,
  onCompensate,
}: {
  preview?: RemediationPreview;
  approval?: ApprovalRequest;
  receipt?: ActionReceipt;
  compensation?: CompensationPreview;
  busy: string | null;
  onPreview: () => Promise<void>;
  onRequestApproval: () => Promise<void>;
  onApprove: (role: ApprovalRole) => Promise<void>;
  onExecute: () => Promise<void>;
  onReplay: () => Promise<void>;
  onPreviewCompensation: () => Promise<void>;
  onApproveCompensation: (role: ApprovalRole) => Promise<void>;
  onCompensate: () => Promise<void>;
}) {
  const [showPayload, setShowPayload] = useState(false);
  const approvedRoles = new Set(approval?.decisions.map((decision) => decision.role));
  const canExecute = approval?.status === "approved" && !receipt;

  return (
    <div className="action-stack">
      <div className="section-heading">
        <div><p className="eyebrow">Governed external action</p><h1>Change one Jira issue, exactly once</h1><p>The only H1 mutation is constrained to AST-142 in the synthetic allowlisted project. The payload is immutable after approval begins.</p></div>
        <div className="guardrail-badges"><StatusPill tone="positive">Sandbox allowlist</StatusPill><StatusPill tone="violet">Two-person control</StatusPill><StatusPill tone="info">15-minute TTL</StatusPill></div>
      </div>

      {!preview ? (
        <Panel className="action-empty">
          <div className="action-empty-mark" aria-hidden="true">↗</div>
          <div><p className="eyebrow">Step 1 · Read-only</p><h2>Generate the exact Jira preview</h2><p>Fetch the current version-7 issue, validate the project allowlist, and calculate the canonical payload hash. Nothing is written.</p></div>
          <Button busy={busy === "preview"} onClick={() => void onPreview()}>Preview AST-142 remediation</Button>
        </Panel>
      ) : (
        <>
          <Panel className="diff-panel">
            <header className="panel-header">
              <div><p className="eyebrow">Step 1 · Exact preview</p><h2><span className="jira-mini">JI</span> AST-142 · {preview.summary}</h2><p className="subtle">Expected Jira version {preview.payload.expectedIssueVersion} · expires {formatDateTime(preview.expiresAt)}</p></div>
              <StatusPill tone="positive">No write performed</StatusPill>
            </header>
            <div className="snapshot-compare">
              <SnapshotCard title="Before" snapshot={preview.before} tone="before" />
              <div className="diff-arrow" aria-hidden="true">→</div>
              <SnapshotCard title="After approval" snapshot={preview.after} tone="after" />
            </div>
            <div className="payload-summary">
              <div><strong>Scope boundary</strong><p>{preview.scope}</p></div>
              <div><strong>Compensating rollback</strong><p>{preview.rollback}</p></div>
            </div>
            <div className="risk-list"><strong>Material changes</strong><ul>{preview.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div>
            <div className="payload-footer">
              <div><span>Canonical payload</span><Hash value={preview.payloadHash} /></div>
              <Button variant="ghost" aria-expanded={showPayload} aria-controls="exact-payload" onClick={() => setShowPayload((value) => !value)}>{showPayload ? "Hide" : "Inspect"} exact payload</Button>
            </div>
            <pre id="exact-payload" hidden={!showPayload} className="payload-code"><code>{JSON.stringify(preview.payload, null, 2)}</code></pre>
          </Panel>

          <Panel className="approval-panel">
            <header className="panel-header">
              <div><p className="eyebrow">Step 2 · Exact-payload approval</p><h2>Two distinct authenticated decisions</h2><p className="subtle">Approvers see the same hash and cannot alter the payload. One person cannot satisfy both roles.</p></div>
              {approval ? <StatusPill tone={approval.status === "approved" ? "positive" : "warning"}>{approval.status}</StatusPill> : null}
            </header>
            {!approval ? (
              <div className="request-approval-row"><div><Hash value={preview.payloadHash} /><p>Approval window: 15 minutes from request</p></div><Button busy={busy === "request-approval"} onClick={() => void onRequestApproval()}>Request operations + security approval</Button></div>
            ) : (
              <>
                <div className="approval-window"><span aria-hidden="true">◷</span><div><strong>Approval window is open</strong><p>Requested by {approval.requestedBy} · expires {formatDateTime(approval.expiresAt)}</p></div><Hash value={approval.payloadHash} /></div>
                <div className="approver-grid">
                  <ApproverCard role="operations" name="Owen Brooks" title="Operations approver" approved={approvedRoles.has("operations")} decision={approval.decisions.find((item) => item.role === "operations")} busy={busy === "approve-operations"} onApprove={() => void onApprove("operations")} />
                  <ApproverCard role="security" name="Samira Patel" title="Security approver" approved={approvedRoles.has("security")} decision={approval.decisions.find((item) => item.role === "security")} busy={busy === "approve-security"} onApprove={() => void onApprove("security")} />
                </div>
              </>
            )}
          </Panel>

          {approval ? (
            <Panel className={`execution-panel ${approval.status === "approved" ? "execution-ready" : ""}`}>
              <div><p className="eyebrow">Step 3 · Idempotent execution</p><h2>{receipt ? "External effect recorded" : approval.status === "approved" ? "Payload is authorized" : "Waiting for both roles"}</h2><p>{receipt ? "The provider effect and its audit evidence are bound to one idempotency key." : approval.status === "approved" ? "The action grant binds this exact payload, tenant, connector, expiry, and approval pair." : "Execution remains disabled until operations and security approve independently."}</p></div>
              {!receipt ? <Button busy={busy === "execute"} disabled={!canExecute} onClick={() => void onExecute()}>Execute one Jira update</Button> : null}
            </Panel>
          ) : null}

          {receipt ? <Receipt receipt={receipt} busy={busy} onReplay={onReplay} /> : null}
          {receipt ? <Rollback compensation={compensation} receipt={receipt} busy={busy} onPreview={onPreviewCompensation} onApprove={onApproveCompensation} onCompensate={onCompensate} /> : null}
        </>
      )}
    </div>
  );
}

function SnapshotCard({ title, snapshot, tone }: { title: string; snapshot: JiraSnapshot; tone: "before" | "after" }) {
  return (
    <article className={`snapshot-card snapshot-${tone}`}>
      <div className="snapshot-heading"><h3>{title}</h3><span>v{snapshot.version}</span></div>
      <DefinitionList rows={[
        { label: "Due date", value: formatDate(snapshot.dueDate) },
        { label: "Priority", value: <span className={`priority priority-${snapshot.priorityName.toLowerCase()}`}>{snapshot.priorityName} · {snapshot.priorityId}</span> },
        { label: "Labels", value: <div className="label-list">{snapshot.labels.map((label) => <span key={label}>{label}</span>)}</div> },
      ]} />
    </article>
  );
}

function ApproverCard({ role, name, title, approved, decision, busy, onApprove }: {
  role: ApprovalRole;
  name: string;
  title: string;
  approved: boolean;
  decision?: ApprovalRequest["decisions"][number];
  busy: boolean;
  onApprove: () => void;
}) {
  return (
    <article className={`approver-card ${approved ? "approver-approved" : ""}`}>
      <div className="approver-identity"><span className={`avatar avatar-${role}`}>{name.split(" ").map((part) => part[0]).join("")}</span><div><strong>{name}</strong><p>{title} · separate demo identity</p></div>{approved ? <span className="approval-check" aria-label="Approved">✓</span> : null}</div>
      {decision ? <div className="decision-proof"><span>Approved {formatDateTime(decision.decidedAt)}</span><Hash value={decision.payloadHash} /></div> : <Button variant="secondary" busy={busy} onClick={onApprove}>Review and approve as {role}</Button>}
    </article>
  );
}

function Receipt({ receipt, busy, onReplay }: { receipt: ActionReceipt; busy: string | null; onReplay: () => Promise<void> }) {
  return (
    <Panel className="receipt-panel" aria-live="polite">
      <div className="receipt-hero"><span className="receipt-check" aria-hidden="true">✓</span><div><p className="eyebrow">Action receipt</p><h2>AST-142 updated once</h2><p>Jira acknowledged the exact approved payload at {formatDateTime(receipt.executedAt)}.</p></div><StatusPill tone="positive">{receipt.status}</StatusPill></div>
      {receipt.replayed ? <div className="replay-banner" role="status"><strong>Replay returned the original receipt.</strong> No second Jira PUT was issued.</div> : null}
      <div className="receipt-grid">
        <DefinitionList rows={[
          { label: "Receipt", value: receipt.receiptId },
          { label: "Provider request", value: receipt.providerRequestId },
          { label: "Jira PUT count", value: <strong>{receipt.jiraPutCount}</strong> },
        ]} />
        <DefinitionList rows={[
          { label: "Idempotency key", value: <code>{receipt.idempotencyKey}</code> },
          { label: "Payload", value: <Hash value={receipt.payloadHash} /> },
          { label: "Audit events", value: `${receipt.auditEventIds.length} linked records` },
        ]} />
      </div>
      <div className="receipt-actions"><Button variant="secondary" busy={busy === "replay"} onClick={() => void onReplay()}>Replay same idempotency key</Button><span>Safe to retry: the original receipt is returned.</span></div>
    </Panel>
  );
}

function Rollback({ compensation, receipt, busy, onPreview, onApprove, onCompensate }: {
  compensation?: CompensationPreview;
  receipt: ActionReceipt;
  busy: string | null;
  onPreview: () => Promise<void>;
  onApprove: (role: ApprovalRole) => Promise<void>;
  onCompensate: () => Promise<void>;
}) {
  const approvedRoles = new Set(compensation?.decisions.map((decision) => decision.role));
  return (
    <Panel className="rollback-panel">
      <header className="panel-header"><div><p className="eyebrow">Step 4 · Compensating rollback</p><h2>Restore safely, never overwrite blindly</h2><p className="subtle">Rollback expires {formatDateTime(receipt.rollbackExpiresAt)} and succeeds only while Jira matches the recorded after-snapshot.</p></div>{compensation ? <StatusPill tone={compensation.status === "compensated" ? "positive" : compensation.status === "conflict" ? "danger" : "warning"}>{compensation.status}</StatusPill> : null}</header>
      {!compensation ? (
        <div className="rollback-start"><p>Generate a guarded before/after preview. This remains read-only and does not reuse the original action approval.</p><Button variant="secondary" busy={busy === "rollback-preview"} onClick={() => void onPreview()}>Preview compensation</Button></div>
      ) : compensation.status === "conflict" ? (
        <StatePanel type="error" title="Human change detected" description="Current Jira state no longer matches the recorded after-snapshot. Compensation stopped with zero overwrites." />
      ) : compensation.status === "compensated" ? (
        <div className="rollback-complete"><span aria-hidden="true">↶</span><div><h3>Original values restored once</h3><p>AST-142 now matches the recorded version-7 snapshot. The original and compensating receipts remain in the audit trail.</p></div></div>
      ) : (
        <div>
          <div className="snapshot-compare compact-compare"><SnapshotCard title="Expected current" snapshot={compensation.expectedCurrent} tone="after" /><div className="diff-arrow" aria-hidden="true">↶</div><SnapshotCard title="Restore to" snapshot={compensation.restoreTo} tone="before" /></div>
          <div className="compensation-guard"><span aria-hidden="true">◇</span><p><strong>Compare-and-set guard</strong>{compensation.guard}</p></div>
          <div className="approver-grid rollback-approvers">
            <ApproverCard role="operations" name="Owen Brooks" title="Rollback operations approver" approved={approvedRoles.has("operations")} decision={compensation.decisions.find((item) => item.role === "operations")} busy={busy === "compensate-approve-operations"} onApprove={() => void onApprove("operations")} />
            <ApproverCard role="security" name="Samira Patel" title="Rollback security approver" approved={approvedRoles.has("security")} decision={compensation.decisions.find((item) => item.role === "security")} busy={busy === "compensate-approve-security"} onApprove={() => void onApprove("security")} />
          </div>
          <div className="receipt-actions"><Button variant="danger" disabled={compensation.status !== "approved"} busy={busy === "compensate"} onClick={() => void onCompensate()}>Execute guarded rollback</Button><span>A fresh two-person grant is required for compensation.</span></div>
        </div>
      )}
    </Panel>
  );
}
