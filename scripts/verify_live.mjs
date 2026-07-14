#!/usr/bin/env node

import { randomUUID } from "node:crypto";

const baseUrl = (process.env.EDT_API_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const requireWorker = process.env.EDT_VERIFY_REQUIRE_WORKER !== "false";
const runNonce = randomUUID().replaceAll("-", "");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function idempotencyKey(label) {
  return `verify-${label}-${runNonce}`.slice(0, 96);
}

async function api(path, { actor = "usr_aster_analyst", body, headers = {}, method = body === undefined ? "GET" : "POST" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(actor ? { "x-demo-actor": actor } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(`${method} ${path} returned ${response.status}: ${value?.code ?? text}`);
  }
  return { value, response };
}

const idem = (label) => ({ "idempotency-key": idempotencyKey(label) });

async function main() {
  const health = await api("/healthz", { actor: undefined });
  invariant(health.value.status === "ok", "API health check failed");

  const question = await api("/v1/questions", {
    body: { question: "What is most likely to delay Orion 2.0?" },
    headers: idem("question"),
  });
  const answer = await api(question.value.status_url);
  invariant(answer.value.result.abstained === false, "Grounded answer unexpectedly abstained");
  invariant(answer.value.result.citations.length === 4, "Grounded answer did not return four citations");
  invariant(!JSON.stringify(answer.value).includes("BEACON-CANARY-7Q9K"), "Cross-tenant canary leaked into Aster answer");

  const beaconQuestion = await api("/v1/questions", {
    actor: "usr_beacon_analyst",
    body: { question: "Tell me about AST-142 and Orion." },
    headers: idem("beacon-question"),
  });
  const beaconAnswer = await api(beaconQuestion.value.status_url, { actor: "usr_beacon_analyst" });
  const beaconJson = JSON.stringify(beaconAnswer.value);
  invariant(beaconAnswer.value.result.abstained === true, "Beacon answer did not fail closed");
  invariant(!beaconJson.includes("AST-142") && !beaconJson.includes("BEACON-CANARY-7Q9K"), "Unauthorized identifier leaked into Beacon answer");

  const snapshot = await api("/v1/simulation-snapshots", {
    body: { project_id: "11111111-1111-4111-8111-111111111111", as_of: "2026-07-13T16:00:00Z" },
    headers: idem("snapshot"),
  });
  const scenario = await api("/v1/scenarios", {
    body: {
      name: "AST-142 completes five working days earlier",
      target_date: "2026-09-15",
      snapshot_id: snapshot.value.snapshot_id,
      expected_snapshot_hash: snapshot.value.canonical_sha256,
      seed: "20260713",
      sample_count: 50000,
      interventions: [{
        type: "shift_completion_distribution",
        work_item_id: "116ab4b3-b108-5f91-ab7e-111f7fba1d45",
        delta_workdays: -5,
      }],
    },
    headers: idem("scenario"),
  });
  await api(`/v1/scenarios/${scenario.value.scenario_id}/confirm`, {
    body: { scenario_digest: scenario.value.scenario_digest },
    headers: { ...idem("confirm"), "if-match": scenario.response.headers.get("etag") },
  });
  const simulation = await api("/v1/simulations", {
    body: { scenario_id: scenario.value.scenario_id },
    headers: idem("simulation"),
  });
  const run = simulation.value.run;
  invariant(run.status === "succeeded" && run.sample_count === 50000, "Simulation did not finish with the frozen sample count");
  invariant(run.result_sha256?.length === 64, "Simulation result has no canonical SHA-256 digest");
  if (requireWorker) invariant(!String(run.engine_version).includes("fallback"), "Simulation used the oracle fallback instead of the Python worker");

  const preview = await api("/v1/actions/jira/remediation-previews", {
    body: {
      command: {
        action: "jira.issue.update",
        connectorInstallationId: "30000000-0000-4000-8000-000000000001",
        expectedIssueVersion: 7,
        issueKey: "AST-142",
        projectKey: "AST",
        set: {
          duedate: "2026-07-31",
          labels: ["digital-twin-remediation", "identity", "orion"],
          priorityId: "2",
        },
      },
      reason: "Apply the simulation-backed mitigation.",
      evidence_ids: answer.value.result.citations.map((citation) => citation.evidence_id),
      simulation_id: run.simulation_id,
    },
    headers: idem("preview"),
  });
  const approval = await api(`/v1/actions/jira/remediation-previews/${preview.value.preview_id}/approval-requests`, {
    body: {},
    headers: { ...idem("approval"), "if-match": preview.response.headers.get("etag") },
  });
  await api(`/v1/approvals/${approval.value.approval_id}/decisions`, {
    actor: "usr_aster_ops_approver",
    body: { decision: "approve", payload_hash: approval.value.payload_hash },
    headers: idem("ops-approval"),
  });
  const approved = await api(`/v1/approvals/${approval.value.approval_id}/decisions`, {
    actor: "usr_aster_security_approver",
    body: { decision: "approve", payload_hash: approval.value.payload_hash },
    headers: idem("security-approval"),
  });
  invariant(approved.value.status === "approved" && approved.value.decisions.length === 2, "Dual approval was not established");

  const executionKey = idempotencyKey("execute");
  const receipt = await api(`/v1/approvals/${approval.value.approval_id}/execute`, {
    body: {},
    headers: { "idempotency-key": executionKey },
  });
  const replay = await api(`/v1/approvals/${approval.value.approval_id}/execute`, {
    body: {},
    headers: { "idempotency-key": executionKey },
  });
  invariant(receipt.value.receipt_id === replay.value.receipt_id, "Idempotent action replay created another receipt");
  invariant(receipt.value.after_snapshot.fields.duedate === "2026-07-31", "Jira remediation did not apply the exact payload");

  const compensation = await api(`/v1/action-receipts/${receipt.value.receipt_id}/compensation-previews`, {
    body: {},
    headers: idem("compensation-preview"),
  });
  await api(`/v1/approvals/${compensation.value.approval_id}/decisions`, {
    actor: "usr_aster_ops_approver",
    body: { decision: "approve", payload_hash: compensation.value.payload_hash },
    headers: idem("compensation-ops"),
  });
  await api(`/v1/approvals/${compensation.value.approval_id}/decisions`, {
    actor: "usr_aster_security_approver",
    body: { decision: "approve", payload_hash: compensation.value.payload_hash },
    headers: idem("compensation-security"),
  });
  const restored = await api(`/v1/approvals/${compensation.value.approval_id}/execute`, {
    body: {},
    headers: idem("compensation-execute"),
  });
  invariant(restored.value.status === "compensated", "Compensation did not complete");
  invariant(restored.value.after_snapshot.fields.duedate === "2026-08-07", "Compensation did not restore the original due date");

  const audit = await api("/v1/audit-events");
  invariant(audit.value.items.length >= 12, "Audit record is incomplete");

  process.stdout.write(`${JSON.stringify({
    status: "verified",
    api: baseUrl,
    citations: answer.value.result.citations.length,
    simulation: { id: run.simulation_id, engine: run.engine_version, result_sha256: run.result_sha256 },
    action: { receipt_id: receipt.value.receipt_id, replay_safe: true },
    rollback: { receipt_id: restored.value.receipt_id, restored_due_date: restored.value.after_snapshot.fields.duedate },
    audit_events: audit.value.items.length,
    cross_tenant_disclosure: 0,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Live verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
