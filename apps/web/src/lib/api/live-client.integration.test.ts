import { describe, expect, it } from "vitest";
import { DemoTokenProvider, FetchDigitalTwinApi } from "./client";

const liveUrl = process.env.EDT_LIVE_API_URL;
const liveWebUrl = process.env.EDT_LIVE_WEB_URL?.replace(/\/$/, "");
const liveTokenProvider: DemoTokenProvider = async (actorAlias, signal) => {
  const bootstrapKey = process.env.EDT_DEMO_AUTH_BOOTSTRAP_KEY;
  const response = await fetch(liveWebUrl ? `${liveWebUrl}/api/demo-auth/session` : `${liveUrl}/v1/demo-auth/sessions`, {
    method: "POST",
    headers: liveWebUrl
      ? { "Content-Type": "application/json" }
      : { "Content-Type": "application/json", "X-Demo-Auth-Key": bootstrapKey ?? "" },
    body: JSON.stringify({ actor_alias: actorAlias }),
    signal,
  });
  const session = await response.json() as { access_token?: string; expires_at?: string; detail?: string };
  if (!response.ok || !session.access_token || !session.expires_at) throw new Error(session.detail ?? "Live demo-auth exchange failed.");
  return { accessToken: session.access_token, expiresAt: session.expires_at };
};

describe.runIf(Boolean(liveUrl))("FetchDigitalTwinApi live H1 journey", () => {
  it("drives the canonical API and Python worker through dual-approved action and rollback", async () => {
    const api = new FetchDigitalTwinApi(String(liveUrl), liveTokenProvider);
    const actor = await api.getActorContext();
    expect(actor.activeMembershipId).toBe("mem_aster_operator");
    expect(await api.getConnectorHealth()).toHaveLength(2);
    expect((await api.traverseLaunchGraph()).nodes).toHaveLength(5);

    const workforce = await api.askLaunchRisk("Rank people by productivity and burnout risk.", "unsafe");
    expect(workforce.confidence).toBe("abstained");
    expect(workforce.citations).toHaveLength(0);
    const answer = await api.askLaunchRisk("What is most likely to delay Orion 2.0?", "grounded");
    expect(answer.confidence).toBe("high");
    expect(answer.citations).toHaveLength(4);

    let scenario = await api.createScenario(-5);
    expect(scenario.status).toBe("draft");
    scenario = await api.confirmScenario(scenario.id, scenario.digest, scenario.etag);
    const simulationStarted = performance.now();
    const simulation = await api.runSimulation(scenario.id);
    const simulationMilliseconds = performance.now() - simulationStarted;
    expect(simulation.status).toBe("succeeded");
    expect(simulation.sampleCount).toBe(50_000);
    expect(simulationMilliseconds).toBeLessThan(10_000);
    expect(simulation.resultHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const preview = await api.previewRemediation();
    let approval = await api.requestApproval(preview.previewId, preview.payloadHash);
    approval = await api.approve(approval.approvalId, "operations", preview.payloadHash, "live-web-ops-approval-0001");
    expect(approval.status).toBe("pending");
    approval = await api.approve(approval.approvalId, "security", preview.payloadHash, "live-web-security-approval-0001");
    expect(approval.status).toBe("approved");
    expect(new Set(approval.decisions.map((decision) => decision.approverId)).size).toBe(2);

    const receipt = await api.execute(approval.approvalId, "live-web-execution-key-0001");
    const replay = await api.execute(approval.approvalId, "live-web-execution-key-0001");
    expect(replay.receiptId).toBe(receipt.receiptId);
    expect(replay.replayed).toBe(true);
    expect(receipt.after.dueDate).toBe("2026-07-31");

    let compensation = await api.previewCompensation(receipt.receiptId);
    expect(compensation.status).toBe("pending");
    compensation = await api.approveCompensation(compensation.compensationId, "operations", compensation.payloadHash, "live-web-comp-ops-0001");
    compensation = await api.approveCompensation(compensation.compensationId, "security", compensation.payloadHash, "live-web-comp-security-0001");
    expect(compensation.status).toBe("approved");
    compensation = await api.compensate(compensation.compensationId, "live-web-comp-execute-0001");
    expect(compensation.status).toBe("compensated");

    const beacon = await api.selectMembership("mem_beacon_observer");
    expect(beacon.activeMembershipId).toBe("mem_beacon_observer");
    expect((await api.traverseLaunchGraph()).nodes).toHaveLength(0);
    const beaconAnswer = await api.askLaunchRisk("Tell me about AST-142 and Orion.", "grounded");
    expect(beaconAnswer.confidence).toBe("abstained");
    expect(JSON.stringify(beaconAnswer)).not.toContain("BEACON-CANARY-7Q9K");
  }, 30_000);

  it("maps the synthetic asset contract and preserves exact control replay across the live client", async () => {
    const api = new FetchDigitalTwinApi(String(liveUrl), liveTokenProvider);
    await api.getActorContext();

    const [asset] = await api.getAssets();
    expect(asset).toBeDefined();
    expect(asset.assetType).toBe("centrifugal_pump");
    expect(asset.canControl).toBe(true);

    const twin = await api.getAssetTwin(asset.assetId);
    expect(twin.asset.assetId).toBe(asset.assetId);
    expect(twin.asset.lifecycleStage).toBe("operation");
    expect(new Set(twin.components.map((component) => component.kind))).toEqual(new Set([
      "motor", "shaft", "bearing", "impeller", "casing", "seal", "valve",
    ]));
    expect(twin.components.every((component) => component.componentId && component.sensorTags.length > 0)).toBe(true);
    expect(twin.predictions.length).toBeGreaterThanOrEqual(2);
    expect(twin.predictions.every((prediction) => prediction.confidence >= 0 && prediction.confidence <= 1)).toBe(true);
    expect(twin.predictions.every((prediction) => twin.components.some((component) => component.componentId === prediction.componentId))).toBe(true);
    expect(twin.lifecycle.map((event) => event.status)).toEqual([
      "complete", "complete", "complete", "current", "planned", "planned",
    ]);

    const telemetry = await api.getAssetTelemetry(asset.assetId, 2);
    expect(telemetry.assetId).toBe(asset.assetId);
    expect(telemetry.intervalSeconds).toBe(5);
    expect(telemetry.points).toHaveLength(2);
    expect(telemetry.points[1].timestamp > telemetry.points[0].timestamp).toBe(true);
    expect(telemetry.points[1].flowM3H).toBeGreaterThan(0);
    expect(telemetry.points[1].motorCurrentA).toBeGreaterThan(0);
    expect(telemetry.signals.pressureBar.warningHigh).toBe(8);
    expect(telemetry.signals.flowM3H.valueKind).toBe("derived");

    const preview = await api.previewAssetCommand(asset.assetId, {
      type: "set_valve_pct",
      value: twin.control.state.valvePct,
    });
    expect(preview.expectedAssetVersion).toBe(twin.control.state.version);
    expect(preview.executionMode).toBe("simulation");
    expect(preview.externalWrite).toBe(false);
    expect(preview.safetyChecks.every((check) => check.passed)).toBe(true);

    const executionKey = `live-web-asset-${globalThis.crypto.randomUUID()}`;
    const receipt = await api.executeAssetCommand(asset.assetId, preview.previewId, preview.payloadHash, executionKey);
    const replay = await api.executeAssetCommand(asset.assetId, preview.previewId, preview.payloadHash, executionKey);
    expect(receipt.simulation).toBe(true);
    expect(receipt.externalWrite).toBe(false);
    expect(receipt.assetVersionAfter).toBe(receipt.assetVersionBefore + 1);
    expect(replay.receiptId).toBe(receipt.receiptId);
    expect(replay.replayed).toBe(true);

    await api.selectMembership("mem_beacon_observer");
    const [beaconAsset] = await api.getAssets();
    expect(beaconAsset.assetId).not.toBe(asset.assetId);
    expect(beaconAsset.canControl).toBe(false);
    const beaconTwin = await api.getAssetTwin(beaconAsset.assetId);
    expect(JSON.stringify(beaconTwin)).not.toContain(asset.serialNumber);
    expect(beaconTwin.components.every((component) => component.status === "normal")).toBe(true);
    await expect(api.previewAssetCommand(beaconAsset.assetId, { type: "set_valve_pct", value: 72 }))
      .rejects.toMatchObject({ status: 403, code: "asset_control_denied" });
  }, 15_000);

  it("maps event intelligence, enforces exact dual approval, applies to the synthetic projection, and rolls back", async () => {
    const api = new FetchDigitalTwinApi(String(liveUrl), liveTokenProvider);
    await api.getActorContext();
    const event = await api.interpretEvent("Sarah Kim, the lead backend engineer, definitely left the company today.", "auto");
    expect(event.processingMode).toBe("reality_review");
    expect(event.model.generativeModelUsed).toBe(false);
    expect(event.graphSnapshotVersion).toBeGreaterThan(0);
    expect(event.graphSnapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(event.externalWrite).toBe(false);
    expect(event.nodes.some((node) => node.effectOrder === "direct")).toBe(true);
    expect(event.nodes.some((node) => node.effectOrder === "long_term")).toBe(true);
    expect(event.nodes.flatMap((node) => node.evidence).some((evidence) => evidence.includes("Evidence "))).toBe(true);
    expect(event.unknowns.length).toBeGreaterThan(0);
    const selectedIds = event.entityResolutions.flatMap((resolution) => resolution.requiredConfirmation
      ? [resolution.candidates[0].entityId]
      : resolution.candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.entityId));
    const review = await api.reviewEvent(event.previewId, event.digest, "reality", selectedIds);
    expect(review.reviewedInterpretation.digest).toBe(review.reviewedPayloadHash);
    expect(review.reviewedInterpretation.entityResolutions.every((resolution) => !resolution.requiredConfirmation || resolution.candidates.some((candidate) => candidate.selected))).toBe(true);
    let approval = await api.requestEventApproval(review);
    expect(approval.graphSnapshotVersion).toBe(event.graphSnapshotVersion);
    expect(approval.graphSnapshotHash).toBe(event.graphSnapshotHash);
    expect(approval.status).toBe("pending");
    approval = await api.approveEvent(approval.approvalId, "operations", approval.payloadHash);
    approval = await api.approveEvent(approval.approvalId, "security", approval.payloadHash);
    expect(approval.status).toBe("approved");
    expect(new Set(approval.decisions.map((decision) => decision.approverId)).size).toBe(2);

    const receipt = await api.applyReviewedEvent(review, approval);
    expect(receipt.decision).toBe("applied");
    expect(receipt.externalWrite).toBe(false);
    expect(receipt.eventVersionAfter).toBe(receipt.eventVersionBefore + 1);
    expect(receipt.graphVersionAfter).toBe(receipt.graphVersionBefore + 1);
    expect(receipt.eventVersionBefore).not.toBe(receipt.graphVersionBefore);
    expect(receipt.outboxPosition).toBeGreaterThan(0);
    const refreshedApi = new FetchDigitalTwinApi(String(liveUrl), liveTokenProvider);
    await refreshedApi.getActorContext();
    const timeline = await refreshedApi.getEventTimeline();
    const appliedTimelineEntry = timeline.find((entry) => entry.eventId === event.eventId && entry.status === "applied");
    expect(appliedTimelineEntry?.receiptId).toBe(receipt.receiptId);
    expect(appliedTimelineEntry?.graphVersionAfter).toBe(receipt.graphVersionAfter);
    const replay = await refreshedApi.getEventReplay(event.eventId);
    expect(replay.reconstructable).toBe(true);
    expect(replay.entityChanges.length).toBeGreaterThan(0);

    const rollback = await refreshedApi.rollbackEvent(event.eventId, appliedTimelineEntry?.receiptId ?? "", `live-web-event-rollback-${globalThis.crypto.randomUUID()}`);
    expect(rollback.decision).toBe("rolled_back");
    expect(rollback.externalWrite).toBe(false);

    const scenarioEvent = await refreshedApi.interpretEvent("We might lose our biggest customer because they are unhappy.", "auto");
    const scenarioSelections = scenarioEvent.entityResolutions.flatMap((resolution) => resolution.requiredConfirmation
      ? [resolution.candidates[0].entityId]
      : resolution.candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.entityId));
    const scenarioReview = await refreshedApi.reviewEvent(scenarioEvent.previewId, scenarioEvent.digest, "scenario", scenarioSelections);
    const scenarioApproval = await refreshedApi.requestEventApproval(scenarioReview);
    const scenarioReceipt = await refreshedApi.applyReviewedEvent(scenarioReview, scenarioApproval);
    const branches = await refreshedApi.getEventBranches();
    const branch = branches.find((candidate) => candidate.createdByEventId === scenarioEvent.eventId);
    expect(branch?.baseGraphVersion).toBe(scenarioReceipt.graphVersionBefore);
    expect(branch?.baseGraphHash).toBe(scenarioReceipt.beforeStateHash);
    const baseline = branches.find((candidate) => candidate.mode === "baseline");
    const comparison = await refreshedApi.compareEventBranches(baseline?.branchId ?? "", branch?.branchId ?? "");
    expect(comparison.left.branchId).toBe(baseline?.branchId);
    expect(comparison.right.branchId).toBe(branch?.branchId);
  }, 15_000);
});
