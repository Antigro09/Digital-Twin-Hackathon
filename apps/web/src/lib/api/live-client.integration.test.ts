import { describe, expect, it } from "vitest";
import { FetchDigitalTwinApi } from "./client";

const liveUrl = process.env.EDT_LIVE_API_URL;

describe.runIf(Boolean(liveUrl))("FetchDigitalTwinApi live H1 journey", () => {
  it("drives the canonical API and Python worker through dual-approved action and rollback", async () => {
    const api = new FetchDigitalTwinApi(String(liveUrl));
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
});
