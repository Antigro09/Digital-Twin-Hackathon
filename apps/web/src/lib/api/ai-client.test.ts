import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoTokenProvider, FetchDigitalTwinApi } from "./client";

const tokenProvider: DemoTokenProvider = async () => ({ accessToken: "signed-ai-test-token", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });

describe("FetchDigitalTwinApi AI facade", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses signed auth and exact /v1/ai request contracts for status, runs, retrieval, import, suggestions, and review", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const path = new URL(url).pathname;
      if (path === "/v1/ai/status") return Response.json({
        status: "ready",
        providers: [{ provider: "openai", configured: true, model: "pinned-model", live_provider_verified: false }],
        agents: allAgentTypes,
        storage_backend: "sqlite",
        durable_store_ready: true,
        vector_ready: true,
        retrieval_modes: ["lexical", "vector"],
        model_outputs_mutate_state: false,
      });
      if (path === "/v1/ai/activity") return Response.json({ items: [{
        activity_id: ACTIVITY_ID,
        tenant_id: TENANT_ID,
        actor_id: ACTOR_ID,
        agent_type: "causal_analysis",
        kind: "agent_run",
        state: "succeeded",
        provider: "openai",
        model: "pinned-model",
        cost_status: "priced",
        evidence_ids: [EVIDENCE_ID],
        created_at: "2026-07-13T15:59:00Z",
      }] });
      if (path === "/v1/ai/agent-runs") return Response.json({
        run_id: RUN_ID,
        suggestion: suggestionWire,
        provider_audit: { provider_request_id: "provider-request-1", request_sha256: "a".repeat(64), response_sha256: "b".repeat(64), latency_ms: 25 },
      });
      if (path === "/v1/ai/retrieval/query") return Response.json({ items: [evidenceWire], query_sha256: "query-hash", permission_trimmed: true });
      if (path === "/v1/ai/knowledge/import") return Response.json({ import_id: "import-1", document_id: "doc-1", status: "INDEXED", chunks_indexed: 1, chunks_quarantined: 0, evidence_ids: ["ev-import"], media_type: "text/markdown", content_sha256: "content-hash", parser: "markdown", imported_at: "2026-07-13T16:01:00Z", model_invoked: false, classification: "confidential", source_acl: { visibility: "private" } });
      if (path === "/v1/ai/suggestions" && (!init?.method || init.method === "GET")) return Response.json({ items: [suggestionWire] });
      if (path === `/v1/ai/suggestions/${SUGGESTION_ID}/reviews`) return Response.json({ review_id: REVIEW_ID, reviewer_id: ACTOR_ID, suggestion_id: SUGGESTION_ID, decision: "approve", reason: "Evidence checked.", suggestion_status: "PENDING_REVIEW", mutation_performed: false, reviewed_at: "2026-07-13T16:02:00Z" });
      throw new Error(`Unexpected request ${url}`);
    }));
    const api = new FetchDigitalTwinApi("http://api.local", tokenProvider);

    const status = await api.getAiStatus();
    const activity = await api.getAiActivity(10);
    const run = await api.runAiAgent({ agentType: "causal_analysis", input: "Explain AST-142", retrievalQuery: "Orion", maxEvidenceItems: 8 });
    const retrieval = await api.queryAiRetrieval("Explain AST-142", 8, ["internal", "confidential"]);
    const imported = await api.importAiKnowledge({ filename: "architecture.md", mediaType: "text/markdown", contentBase64: "IyBBcmNoaXRlY3R1cmU=", classification: "confidential", sourceAcl: { visibility: "private" } });
    const suggestions = await api.getAiSuggestions();
    const reviewed = await api.reviewAiSuggestion({ suggestionId: SUGGESTION_ID, decision: "approve", reason: "Evidence checked." });

    expect(status.providerReadiness[0]).toMatchObject({ provider: "openai", status: "degraded", liveVerified: false });
    expect(activity.recent[0].status).toBe("succeeded");
    expect(run).toMatchObject({ status: "PENDING_REVIEW", confidence: 0.9, provider: "openai", model: "pinned-model" });
    expect(run.causalChain[0]).toMatchObject({ relationship: "BLOCKS", toNode: "Certification" });
    expect(run.affectedNodes[0]).toEqual({ nodeId: null, label: "AST-142", kind: "unspecified", effect: "Listed as affected; no node identifier or effect was returned by the bounded agent." });
    expect(run.evidence[0]).toMatchObject({ classification: "not_reported", excerpt: "Excerpt not returned by the facade." });
    expect(run.run).toMatchObject({ provider: "openai", model: "pinned-model", startedAt: "2026-07-13T16:00:00Z", completedAt: "2026-07-13T16:00:00Z" });
    expect(retrieval.evidence[0]).toMatchObject({ evidenceId: EVIDENCE_ID, sourceKey: "jira/AST-142", excerpt: "AST-142 blocks certification." });
    expect(imported).toMatchObject({ status: "indexed", classification: "confidential", sourceAcl: { visibility: "private" }, contentHash: "sha256:content-hash" });
    expect(suggestions[0]).toMatchObject({ status: "PENDING_REVIEW", noGraphMutation: true });
    expect(reviewed).toMatchObject({ status: "PENDING_REVIEW", reviewDecision: "approve", reviewReason: "Evidence checked.", noGraphMutation: true });
    expect(calls.every((call) => new Headers(call.init?.headers).get("authorization") === "Bearer signed-ai-test-token")).toBe(true);

    const runCall = calls.find((call) => call.url.endsWith("/v1/ai/agent-runs"))!;
    expect(JSON.parse(String(runCall.init?.body))).toEqual({ agent_type: "causal_analysis", input: { question: "Explain AST-142" }, retrieval_query: "Orion", max_evidence_items: 8 });
    expect(new Headers(runCall.init?.headers).get("idempotency-key")).toBeTruthy();
    const retrievalCall = calls.find((call) => call.url.endsWith("/v1/ai/retrieval/query"))!;
    expect(JSON.parse(String(retrievalCall.init?.body))).toEqual({ query: "Explain AST-142", limit: 8 });
    const importCall = calls.find((call) => call.url.endsWith("/v1/ai/knowledge/import"))!;
    expect(JSON.parse(String(importCall.init?.body))).toMatchObject({ classification: "confidential", source_acl: { visibility: "private" }, content_base64: "IyBBcmNoaXRlY3R1cmU=" });
    expect(new Headers(importCall.init?.headers).get("idempotency-key")).toBeTruthy();
    const reviewCall = calls.find((call) => call.url.endsWith(`/v1/ai/suggestions/${SUGGESTION_ID}/reviews`))!;
    expect(JSON.parse(String(reviewCall.init?.body))).toEqual({ decision: "approve", reason: "Evidence checked." });
    expect(new Headers(reviewCall.init?.headers).get("idempotency-key")).toBeTruthy();
  });

  it("fails closed when retrieval is not permission-trimmed or review reports a mutation", async () => {
    let mode: "retrieval" | "suggestions" | "review" = "retrieval";
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (mode === "retrieval") return Response.json({ items: [evidenceWire], permission_trimmed: false });
      if (mode === "suggestions") return Response.json({ items: [suggestionWire] });
      return Response.json({ suggestion_id: SUGGESTION_ID, decision: "approve", suggestion_status: "PENDING_REVIEW", mutation_performed: true });
    }));
    const api = new FetchDigitalTwinApi("http://api.local", tokenProvider);

    await expect(api.queryAiRetrieval("Explain AST-142")).rejects.toMatchObject({ code: "invalid_ai_response", status: 502 });
    mode = "suggestions";
    await api.getAiSuggestions();
    mode = "review";
    await expect(api.reviewAiSuggestion({ suggestionId: SUGGESTION_ID, decision: "approve", reason: "Checked." })).rejects.toMatchObject({ code: "invalid_ai_response", status: 502 });
  });

  it("derives import and review authorization from server capabilities while keeping import independent of provider readiness", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v1/me") return Response.json({ capabilities: ["connector.admin"] });
      if (path === "/v1/ai/status") return Response.json({
        status: "degraded",
        providers: [{ provider: "llama", configured: false, model: null, live_provider_verified: false }],
        agents: allAgentTypes,
        storage_backend: "postgresql",
        durable_store_ready: true,
        vector_configured: false,
        vector_ready: false,
        retrieval_modes: ["lexical"],
        model_outputs_mutate_state: false,
      });
      throw new Error(`Unexpected request ${String(input)}`);
    }));
    const api = new FetchDigitalTwinApi("http://api.local", tokenProvider);

    await api.getActorContext();
    const status = await api.getAiStatus();

    expect(status.providerReadiness[0]).toMatchObject({ status: "unavailable", liveVerified: false });
    expect(status.agentProfiles.every((profile) => !profile.canRun)).toBe(true);
    expect(status.knowledgeImport).toMatchObject({ enabled: true, storeReady: true, authorized: true });
    expect(status.canReviewSuggestions).toBe(true);
  });
});

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "20000000-0000-4000-8000-000000000001";
const ACTIVITY_ID = "30000000-0000-4000-8000-000000000001";
const EVIDENCE_ID = "40000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "50000000-0000-4000-8000-000000000001";
const RUN_ID = "60000000-0000-4000-8000-000000000001";
const SUGGESTION_ID = "70000000-0000-4000-8000-000000000001";
const REVIEW_ID = "80000000-0000-4000-8000-000000000001";

const allAgentTypes = ["knowledge_ingestion", "entity_resolution", "event_understanding", "causal_analysis", "simulation_planning", "prediction_explanation", "technical_knowledge", "marketing_analyst"];
const evidenceWire = { evidence_id: EVIDENCE_ID, document_id: DOCUMENT_ID, source_locator: "jira/AST-142", media_type: "application/json", classification: "internal", snippet: "AST-142 blocks certification.", relevance: 0.98, confidence: 0.96, indexed_at: "2026-07-13T15:00:00Z", security_flags: [] };
const suggestionWire = {
  suggestion_id: SUGGESTION_ID,
  run_id: RUN_ID,
  tenant_id: TENANT_ID,
  actor_id: ACTOR_ID,
  agent_type: "causal_analysis",
  status: "PENDING_REVIEW",
  confidence: 0.9,
  evidence: [{ evidence_id: EVIDENCE_ID, source_locator: "jira/AST-142" }],
  output: {
    status: "PENDING_REVIEW",
    confidence: 0.9,
    evidence: [{ evidence_id: EVIDENCE_ID, source_locator: "jira/AST-142" }],
    limitations: ["Only the supplied evidence was considered."],
    chain: [{ source: "AST-142", relationship: "BLOCKS", target: "Certification", evidence_ids: [EVIDENCE_ID] }],
    affected_nodes: ["AST-142"],
    probabilities_calculated: false,
  },
  provider: "openai",
  model: "pinned-model",
  usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
  cost_usd: "0.001",
  cost_status: "priced",
  cached: false,
  mutation_performed: false,
  created_at: "2026-07-13T16:00:00Z",
};
