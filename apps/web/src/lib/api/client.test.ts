import { beforeEach, describe, expect, it } from "vitest";
import { DemoDigitalTwinApi } from "./client";

describe("DemoDigitalTwinApi safety invariants", () => {
  let api: DemoDigitalTwinApi;

  beforeEach(() => { api = new DemoDigitalTwinApi(); });

  it("selects only a server-known membership and clears unauthorized evidence", async () => {
    const context = await api.selectMembership("mem_beacon_observer");
    expect(context.activeMembershipId).toBe("mem_beacon_observer");
    await expect(api.selectMembership("10000000-0000-4000-8000-000000000001")).rejects.toMatchObject({ status: 403 });

    const graph = await api.traverseLaunchGraph();
    const answer = await api.askLaunchRisk("What delays launch?", "grounded");
    expect(graph.nodes).toHaveLength(0);
    expect(graph.evidence).toHaveLength(0);
    expect(answer.confidence).toBe("abstained");
    expect(JSON.stringify(answer)).not.toContain("BEACON-CANARY-7Q9K");
  });

  it("requires the exact scenario digest and ETag before simulation", async () => {
    const scenario = await api.createScenario(-5);
    await expect(api.confirmScenario(scenario.id, "sha256:mutated", scenario.etag)).rejects.toMatchObject({ status: 412 });
    await expect(api.runSimulation(scenario.id)).rejects.toMatchObject({ status: 409 });

    const confirmed = await api.confirmScenario(scenario.id, scenario.digest, scenario.etag);
    const result = await api.runSimulation(confirmed.id);
    expect(confirmed.status).toBe("confirmed");
    expect(result.seed).toBe("20260713");
    expect(result.sampleCount).toBe(50000);
    expect(result.baseline.p80).toBe("2026-08-24");
    expect(result.scenario.p80).toBe("2026-08-17");
  });

  it("binds two distinct approvals and executes the Jira update once", async () => {
    const preview = await api.previewRemediation();
    let approval = await api.requestApproval(preview.previewId, preview.payloadHash);
    approval = await api.approve(approval.approvalId, "operations", preview.payloadHash, "edt-h1-ops-approval-ast142-v7");
    expect(approval.status).toBe("pending");
    approval = await api.approve(approval.approvalId, "security", preview.payloadHash, "edt-h1-security-approval-ast142-v7");
    expect(approval.status).toBe("approved");
    expect(new Set(approval.decisions.map((decision) => decision.approverId)).size).toBe(2);

    const first = await api.execute(approval.approvalId, "edt-h1-action-aster-ast142-v7");
    const replay = await api.execute(approval.approvalId, "edt-h1-action-aster-ast142-v7");
    expect(first.jiraPutCount).toBe(1);
    expect(replay.receiptId).toBe(first.receiptId);
    expect(replay.jiraPutCount).toBe(1);
    expect(replay.replayed).toBe(true);
  });

  it("uses compare-and-set compensation and preserves receipt evidence", async () => {
    const preview = await api.previewRemediation();
    let approval = await api.requestApproval(preview.previewId, preview.payloadHash);
    approval = await api.approve(approval.approvalId, "operations", preview.payloadHash, "ops-key-0000000001");
    approval = await api.approve(approval.approvalId, "security", preview.payloadHash, "sec-key-0000000001");
    const receipt = await api.execute(approval.approvalId, "execute-key-000001");
    let compensation = await api.previewCompensation(receipt.receiptId);
    expect(compensation.status).toBe("pending");
    expect(compensation.expectedCurrent.dueDate).toBe("2026-07-31");
    expect(compensation.restoreTo.dueDate).toBe("2026-08-07");
    await expect(api.compensate(compensation.compensationId, "compensation-key-01")).rejects.toMatchObject({ status: 409 });
    compensation = await api.approveCompensation(compensation.compensationId, "operations", compensation.payloadHash, "comp-ops-key-0001");
    compensation = await api.approveCompensation(compensation.compensationId, "security", compensation.payloadHash, "comp-sec-key-0001");
    expect(compensation.status).toBe("approved");
    expect(new Set(compensation.decisions.map((decision) => decision.approverId)).size).toBe(2);
    const result = await api.compensate(compensation.compensationId, "compensation-key-01");
    expect(result.status).toBe("compensated");
  });
});
