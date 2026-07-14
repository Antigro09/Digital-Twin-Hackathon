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

async function apiProblem(path, expectedStatus, { actor = "usr_aster_analyst", headers = {}, method = "GET" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(actor ? { "x-demo-actor": actor } : {}),
      ...headers,
    },
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : undefined;
  invariant(response.status === expectedStatus, `${method} ${path} returned ${response.status}; expected ${expectedStatus}`);
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

  const assetList = await api("/v1/assets");
  invariant(Array.isArray(assetList.value.items) && assetList.value.items.length > 0, "Aster asset list is empty");
  const listedAsset = assetList.value.items.find((asset) => asset.can_control === true) ?? assetList.value.items[0];
  const assetId = listedAsset.asset_id;
  invariant(typeof assetId === "string" && assetId.length > 0, "Aster asset list returned no usable asset identifier");
  invariant(listedAsset.synthetic === true, "Aster asset list did not mark the asset as synthetic");

  const twin = await api(`/v1/assets/${encodeURIComponent(assetId)}/twin`);
  invariant(twin.value.asset.asset_id === assetId, "Asset twin identity does not match the list resource");
  invariant(twin.value.asset.synthetic === true, "Asset twin is not explicitly synthetic");
  invariant(twin.value.visualization.kind === "procedural_3d", "Asset twin has no procedural 3D visualization contract");
  invariant(Array.isArray(twin.value.components) && twin.value.components.length > 0, "Asset twin has no spatial components");
  invariant(Array.isArray(twin.value.current_telemetry.readings) && twin.value.current_telemetry.readings.length >= 5, "Asset twin has incomplete current telemetry");
  invariant(twin.value.analytics.anomalies.length > 0, "Asset twin has no anomaly analysis");
  invariant(twin.value.analytics.predictions.length > 0, "Asset twin has no failure prediction");
  invariant(twin.value.analytics.model_card.evaluated_on === "deterministic_synthetic_fixture_only", "Asset analytics lacks its synthetic evaluation boundary");
  invariant(twin.value.lifecycle.current_stage === "operation", "Asset lifecycle is not in the expected operating stage");
  invariant(twin.value.lifecycle.stages.length >= 6 && twin.value.lifecycle.events.length > 0, "Asset lifecycle history is incomplete");
  invariant(twin.value.control.simulation_only === true, "Asset control is not constrained to simulation");

  const telemetry = await api(`/v1/assets/${encodeURIComponent(assetId)}/telemetry?limit=5`);
  invariant(telemetry.value.stream_status === "live_simulation" && telemetry.value.synthetic === true, "Asset telemetry is not a live synthetic stream");
  invariant(telemetry.value.samples.length === 5, "Asset telemetry did not return the requested rolling window");
  invariant(
    telemetry.value.current_telemetry.sequence > twin.value.current_telemetry.sequence,
    "Asset telemetry sequence did not advance",
  );

  const beaconAssets = await api("/v1/assets", { actor: "usr_beacon_analyst" });
  const beaconAssetsJson = JSON.stringify(beaconAssets.value);
  invariant(!beaconAssets.value.items.some((asset) => asset.asset_id === assetId), "Aster asset appeared in the Beacon asset list");
  invariant(!beaconAssetsJson.includes(twin.value.asset.serial_number), "Aster asset details leaked into the Beacon asset list");
  const deniedTwin = await apiProblem(`/v1/assets/${encodeURIComponent(assetId)}/twin`, 404, { actor: "usr_beacon_analyst" });
  invariant(!JSON.stringify(deniedTwin.value).includes(twin.value.asset.serial_number), "Cross-tenant asset denial disclosed Aster details");

  const currentControl = telemetry.value.control_state;
  const valveLimits = twin.value.control.limits.valve_pct;
  const nonDisruptiveValveTarget = Number(currentControl.valve_pct);
  invariant(Number.isFinite(nonDisruptiveValveTarget), "Current valve setpoint is not numeric");
  invariant(
    nonDisruptiveValveTarget >= valveLimits.min && nonDisruptiveValveTarget <= valveLimits.max,
    "Current valve setpoint is outside the declared safe control range",
  );
  invariant(currentControl.emergency_stopped === false, "A safe setpoint cannot be verified while the synthetic emergency stop is latched");
  const assetPreview = await api(`/v1/assets/${encodeURIComponent(assetId)}/control-previews`, {
    body: {
      command: { type: "set_valve_pct", value: nonDisruptiveValveTarget },
      expected_version: currentControl.version,
      reason: "Verify a non-disruptive simulator-only setpoint using the current valve position.",
    },
    headers: idem("asset-control-preview"),
  });
  invariant(assetPreview.value.external_write === false, "Asset preview did not prohibit external writes");
  invariant(assetPreview.value.execution_mode === "simulation", "Asset preview is not simulation-only");
  invariant(assetPreview.value.before_state.version === currentControl.version, "Asset preview did not use the current control-state version");
  invariant(assetPreview.value.after_state.valve_pct === nonDisruptiveValveTarget, "Asset preview changed the non-disruptive target");

  const assetExecutionKey = idempotencyKey("asset-control-execute");
  const assetPreviewEtag = assetPreview.response.headers.get("etag") ?? assetPreview.value.etag;
  invariant(typeof assetPreviewEtag === "string" && assetPreviewEtag.length > 0, "Asset preview has no execution ETag");
  const assetReceipt = await api(`/v1/assets/${encodeURIComponent(assetId)}/control-previews/${encodeURIComponent(assetPreview.value.preview_id)}/execute`, {
    body: {},
    headers: { "idempotency-key": assetExecutionKey, "if-match": assetPreviewEtag },
  });
  const assetReplay = await api(`/v1/assets/${encodeURIComponent(assetId)}/control-previews/${encodeURIComponent(assetPreview.value.preview_id)}/execute`, {
    body: {},
    headers: { "idempotency-key": assetExecutionKey, "if-match": assetPreviewEtag },
  });
  invariant(assetReceipt.value.receipt_id === assetReplay.value.receipt_id, "Idempotent asset-control replay created another receipt");
  invariant(assetReceipt.value.external_write === false && assetReceipt.value.simulation === true, "Asset control escaped the synthetic simulation boundary");
  invariant(assetReceipt.value.provider === "synthetic_asset_simulator", "Asset control used an unexpected provider");
  invariant(assetReceipt.value.asset_id === assetId, "Asset control receipt belongs to another asset");
  invariant(assetReceipt.value.after_state.version === currentControl.version + 1, "Asset control version did not advance exactly once");
  invariant(assetReceipt.value.after_state.valve_pct === nonDisruptiveValveTarget, "Asset control did not preserve the selected valve setpoint");

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
    physical_asset: {
      asset_id: assetId,
      telemetry_sequence: telemetry.value.current_telemetry.sequence,
      analytics_model: twin.value.analytics.model_card.model_version,
      lifecycle_stages: twin.value.lifecycle.stages.length,
      control_receipt_id: assetReceipt.value.receipt_id,
      control_replay_safe: true,
      external_write: false,
    },
    audit_events: audit.value.items.length,
    cross_tenant_disclosure: 0,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Live verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
