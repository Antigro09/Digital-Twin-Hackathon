import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemoDigitalTwinApi } from "@/lib/api/client";
import type {
  AiActivityFeed,
  AiAgentResult,
  AiExplainResult,
  AiKnowledgeImportResult,
  AiStatus,
  AiSuggestion,
} from "@/lib/api/types";
import { ApiProblem } from "@/lib/api/types";
import { AIControlCenter, AI_IMPORT_ACCEPT, AI_IMPORT_CLIENT_MAX_BYTES, AI_IMPORT_MEDIA_TYPES, validateAiKnowledgeFile } from "./AIControlCenter";

const evidence = {
  evidenceId: "evidence-ast-142",
  label: "AST-142 blocker evidence",
  source: "Jira",
  sourceKey: "AST-142",
  excerpt: "The identity cutover blocks launch certification.",
  confidence: 0.96,
  classification: "internal" as const,
};

const status: AiStatus = {
  executionMode: "connected",
  profile: "test",
  providerReadiness: [{ provider: "openai", displayName: "Approved provider", status: "ready", detail: "Connected through the capability facade.", approvedModels: ["pinned-test-model"], capabilities: ["structured output"], liveVerified: true, lastCheckedAt: "2026-07-13T16:00:00Z" }],
  agentProfiles: [
    { agentType: "causal_analysis", label: "Causal analysis", purpose: "Verify bounded paths.", authorityBoundary: "Read only.", canRun: true },
    { agentType: "simulation_planning", label: "Simulation planning", purpose: "Draft isolated scenario assumptions.", authorityBoundary: "No execution.", canRun: true },
  ],
  knowledgeImport: { enabled: true, storeReady: true, authorized: true, maxBytes: AI_IMPORT_CLIENT_MAX_BYTES, allowedMediaTypes: [...AI_IMPORT_MEDIA_TYPES], classifications: ["internal", "confidential"], sourceAcl: { visibility: "private" } },
  canReviewSuggestions: true,
  checkedAt: "2026-07-13T16:00:00Z",
};

const activity: AiActivityFeed = {
  active: [{ runId: "run-active", agentType: "causal_analysis", agentLabel: "Causal analysis", status: "running", taskSummary: "Verify AST-142", initiatedBy: "Maya", provider: "openai", model: "pinned-test-model", startedAt: "2026-07-13T15:59:00Z", evidenceCount: 0, toolInvocationCount: 1 }],
  recent: [],
  pageSize: 10,
};

const suggestion: AiSuggestion = {
  suggestionId: "suggestion-1",
  title: "Verify the cutover dependency",
  summary: "Review the cited blocker before planning mitigation.",
  proposedAction: "Create a human-reviewed scenario; do not mutate Jira.",
  status: "PENDING_REVIEW",
  confidence: 0.82,
  evidence: [evidence],
  provider: "openai",
  model: "pinned-test-model",
  usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30, estimatedCostUsd: 0.001, currency: "USD" },
  createdAt: "2026-07-13T16:00:00Z",
  noGraphMutation: true,
  executionMode: "connected",
  structuredOutput: { status: "PENDING_REVIEW", evidence: [{ evidence_id: evidence.evidenceId }] },
};

const agentResult: AiAgentResult = {
  run: { runId: "run-explain", agentType: "causal_analysis", agentLabel: "Causal analysis", status: "PENDING_REVIEW", taskSummary: "Explain AST-142", initiatedBy: "Maya", provider: "openai", model: "pinned-test-model", startedAt: "2026-07-13T16:00:00Z", completedAt: "2026-07-13T16:00:02Z", evidenceCount: 1, toolInvocationCount: 1 },
  status: "PENDING_REVIEW",
  output: "AST-142 blocks certification, which gates the launch milestone.",
  confidence: 0.91,
  evidence: [evidence],
  provider: "openai",
  model: "pinned-test-model",
  usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45, estimatedCostUsd: 0.002, currency: "USD" },
  warnings: [],
  causalChain: [{ step: 1, fromNode: "AST-142", relationship: "BLOCKS", toNode: "Launch certification", explanation: "The recorded dependency is explicit.", evidenceIds: [evidence.evidenceId] }],
  affectedNodes: [{ nodeId: "ast-142", label: "AST-142", kind: "work", effect: "Recorded blocker" }],
  limitations: ["Current private corpus only; simulation state was not auto-ingested."],
  reviewNotice: "Review required.",
  executionMode: "connected",
};

const retrieval: AiExplainResult = {
  query: "Explain AST-142",
  summary: "One authorized evidence item retrieved.",
  confidence: null,
  causalChain: [],
  evidence: [evidence],
  affectedNodes: [],
  provider: "not reported",
  model: "not reported",
  generatedAt: "2026-07-13T16:00:00Z",
  status: "retrieval_only",
  limitations: ["Retrieval itself did not return a causal chain."],
  executionMode: "connected",
};

describe("AIControlCenter", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("shows an honest provider-unconfigured offline shell without simulated AI output", async () => {
    render(<AIControlCenter api={new DemoDigitalTwinApi()} sourceMode="demo" />);
    expect(screen.getByLabelText("Loading AI Control Center")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "AI Control Center" })).toBeInTheDocument();
    expect(screen.getByText(/does not connect to an AI provider/i)).toBeInTheDocument();
    expect(screen.getByText(/no agent will run and no explanation is simulated/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run bounded explanation" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "No authorized suggestions" })).toBeInTheDocument();
    expect(screen.queryByText(/offline preview: protect/i)).not.toBeInTheDocument();
  });

  it("runs a real bounded explanation flow and displays returned chain, evidence, nodes, and limitations", async () => {
    const api = readyApi();
    const run = vi.spyOn(api, "runAiAgent").mockResolvedValue(agentResult);
    const query = vi.spyOn(api, "queryAiRetrieval").mockResolvedValue(retrieval);
    const user = userEvent.setup();
    render(<AIControlCenter api={api} sourceMode="connected" />);

    await screen.findByRole("heading", { name: "AI Control Center" });
    await user.click(screen.getByRole("button", { name: "Run bounded explanation" }));

    expect(await screen.findByRole("heading", { name: agentResult.output })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Causal chain" })).toHaveTextContent("BLOCKS");
    expect(screen.getAllByText("AST-142 blocker evidence").length).toBeGreaterThan(0);
    expect(screen.getByText("Recorded blocker")).toBeInTheDocument();
    expect(screen.getByText(/simulation state was not auto-ingested/i)).toBeInTheDocument();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ agentType: "causal_analysis", retrievalQuery: expect.stringContaining("AST-142"), maxEvidenceItems: 8 }));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("AST-142"), 8);
  });

  it("keeps durable knowledge import available when the model provider is unconfigured", async () => {
    const api = readyApi();
    vi.mocked(api.getAiStatus).mockResolvedValue({
      ...status,
      providerReadiness: [{ ...status.providerReadiness[0], status: "unavailable", detail: "Provider is not configured.", liveVerified: false }],
      agentProfiles: status.agentProfiles.map((profile) => ({ ...profile, canRun: false })),
      knowledgeImport: { ...status.knowledgeImport, enabled: true, storeReady: true, authorized: true },
    });
    render(<AIControlCenter api={api} sourceMode="connected" />);

    expect(await screen.findByText("Provider is not configured.")).toBeInTheDocument();
    expect(screen.getByLabelText("Document, specification, or report")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run bounded explanation" })).toBeDisabled();
    expect(screen.getByText(/no agent will run and no explanation is simulated/i)).toBeInTheDocument();
  });

  it("preserves an honest empty-corpus result without inventing causal links or affected nodes", async () => {
    const api = readyApi();
    vi.spyOn(api, "runAiAgent").mockResolvedValue({
      ...agentResult,
      output: "No supported causal claim was returned.",
      confidence: 0.2,
      evidence: [],
      causalChain: [],
      affectedNodes: [],
      limitations: ["The authorized corpus did not contain supporting evidence."],
    });
    vi.spyOn(api, "queryAiRetrieval").mockResolvedValue({
      ...retrieval,
      summary: "No authorized evidence items retrieved.",
      evidence: [],
      limitations: ["No evidence exists in the authorized private corpus for this query."],
    });
    const user = userEvent.setup();
    render(<AIControlCenter api={api} sourceMode="connected" />);

    await screen.findByRole("heading", { name: "AI Control Center" });
    await user.click(screen.getByRole("button", { name: "Run bounded explanation" }));

    expect(await screen.findByRole("heading", { name: "No causal chain returned" })).toBeInTheDocument();
    expect(screen.getByText("No evidence returned; treat this output as unsupported.")).toBeInTheDocument();
    expect(screen.getByText("No affected nodes were returned.")).toBeInTheDocument();
    expect(screen.getByText("The authorized corpus did not contain supporting evidence.")).toBeInTheDocument();
  });

  it("advertises only worker-supported upload extensions and maps newer parser formats", () => {
    expect([...AI_IMPORT_MEDIA_TYPES]).toEqual([
      "text/plain", "text/markdown", "text/csv", "application/csv", "application/json", "application/yaml", "text/yaml",
      "application/xml", "text/xml", "image/svg+xml", "text/vnd.mermaid", "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]);
    expect(AI_IMPORT_ACCEPT).toContain(".xlsx");
    expect(AI_IMPORT_ACCEPT).toContain(".svg");
    expect(AI_IMPORT_ACCEPT).toContain(".mmd");
    expect(AI_IMPORT_ACCEPT).not.toContain(".pptx");
    expect(AI_IMPORT_ACCEPT).not.toContain(".png");
    expect(validateAiKnowledgeFile(new File(["sheet"], "facts.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })).mediaType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(validateAiKnowledgeFile(new File(["<svg/>"] , "diagram.svg", { type: "image/svg+xml" })).mediaType).toBe("image/svg+xml");
    expect(validateAiKnowledgeFile(new File(["graph TD"], "flow.mmd", { type: "text/plain" })).mediaType).toBe("text/vnd.mermaid");
    expect(() => validateAiKnowledgeFile(new File(["slides"], "deck.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }))).toThrow(/supported PDF/i);
    expect(() => validateAiKnowledgeFile(new File(["data"], "folder/report.txt", { type: "text/plain" }))).toThrow(/path separators/i);
  });

  it("enforces client file limits and privately encodes an allowed classified document", async () => {
    const api = readyApi();
    const imported: AiKnowledgeImportResult = { importId: "import-1", filename: "architecture.md", status: "indexed", classification: "confidential", sourceAcl: { visibility: "private" }, byteCount: 12, contentHash: "sha256:abc", message: "Indexed one private chunk.", acceptedAt: "2026-07-13T16:00:00Z", executionMode: "connected" };
    const importKnowledge = vi.spyOn(api, "importAiKnowledge").mockResolvedValue(imported);
    const user = userEvent.setup();
    render(<AIControlCenter api={api} sourceMode="connected" />);
    const picker = await screen.findByLabelText("Document, specification, or report");

    await user.upload(picker, new File([new Uint8Array(AI_IMPORT_CLIENT_MAX_BYTES + 1)], "oversized.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("exceeds the 5 MB client-side limit");
    expect(importKnowledge).not.toHaveBeenCalled();

    await user.upload(picker, new File(["# Architecture"], "architecture.md", { type: "text/markdown" }));
    await user.selectOptions(screen.getByLabelText("Classification"), "confidential");
    await user.click(screen.getByRole("button", { name: "Encode and import privately" }));
    expect(await screen.findByRole("heading", { name: "Private import accepted" })).toBeInTheDocument();
    expect(importKnowledge).toHaveBeenCalledWith(expect.objectContaining({ filename: "architecture.md", mediaType: "text/markdown", classification: "confidential", sourceAcl: { visibility: "private" }, contentBase64: expect.any(String) }));
    expect(importKnowledge.mock.calls[0][0].contentBase64).not.toBe("");
  });

  it("records approve and reject controls as review-only decisions", async () => {
    const api = readyApi();
    const review = vi.spyOn(api, "reviewAiSuggestion").mockImplementation(async (input) => ({ ...suggestion, status: "PENDING_REVIEW", reviewDecision: input.decision, reviewReason: input.reason, reviewedAt: "2026-07-13T16:01:00Z" }));
    const user = userEvent.setup();
    render(<AIControlCenter api={api} sourceMode="connected" />);
    const panel = await screen.findByRole("heading", { name: "AI suggestions" });
    const suggestionPanel = panel.closest("section")!;
    await user.type(within(suggestionPanel).getByLabelText("Review reason"), "Evidence is sufficient for human consideration.");
    await user.click(within(suggestionPanel).getByRole("button", { name: "Approve suggestion" }));
    expect(await within(suggestionPanel).findByText(/Approved into validated enterprise memory/)).toBeInTheDocument();
    expect(within(suggestionPanel).getByText(/suggestion itself remains PENDING_REVIEW/i)).toBeInTheDocument();
    expect(within(suggestionPanel).getByText(/No graph, simulation, or external-system mutation occurred/)).toBeInTheDocument();
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ decision: "approve", reason: "Evidence is sufficient for human consideration." }));
  });

  it("keeps analyst suggestion access read-only when review authority is not delegated", async () => {
    const api = readyApi();
    vi.mocked(api.getAiStatus).mockResolvedValue({ ...status, canReviewSuggestions: false });
    const review = vi.spyOn(api, "reviewAiSuggestion");
    render(<AIControlCenter api={api} sourceMode="connected" />);

    expect(await screen.findByText(/review controls require connector administration permission/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Review reason")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve suggestion" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject suggestion" })).toBeDisabled();
    expect(review).not.toHaveBeenCalled();
  });

  it("renders denied and retryable error states without partial control data", async () => {
    const denied = readyApi();
    vi.spyOn(denied, "getAiStatus").mockRejectedValue(new ApiProblem("Not delegated.", 403, "ai_denied", false));
    const deniedView = render(<AIControlCenter api={denied} sourceMode="connected" />);
    expect(await screen.findByRole("heading", { name: "AI control-plane access is not delegated" })).toBeInTheDocument();
    deniedView.unmount();

    const failed = readyApi();
    vi.spyOn(failed, "getAiStatus").mockRejectedValue(new ApiProblem("Provider check failed.", 503, "ai_unavailable", true));
    render(<AIControlCenter api={failed} sourceMode="connected" />);
    expect(await screen.findByRole("heading", { name: "AI Control Center is unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry AI facade" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run bounded specialist" })).not.toBeInTheDocument();
  });
});

function readyApi(): DemoDigitalTwinApi {
  const api = new DemoDigitalTwinApi();
  vi.spyOn(api, "getAiStatus").mockResolvedValue(status);
  vi.spyOn(api, "getAiActivity").mockResolvedValue(activity);
  vi.spyOn(api, "getAiSuggestions").mockResolvedValue([suggestion]);
  return api;
}
