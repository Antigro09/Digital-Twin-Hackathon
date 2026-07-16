"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type {
  AiActivityFeed,
  AiAgentResult,
  AiAgentType,
  AiClassification,
  AiEvidence,
  AiExplainResult,
  AiKnowledgeImportResult,
  AiStatus,
  AiSuggestion,
  DigitalTwinApi,
} from "@/lib/api/types";
import { ApiProblem } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { Button, DefinitionList, Panel, Skeleton, StatePanel, StatusPill } from "./ui";

export const AI_IMPORT_CLIENT_MAX_BYTES = 5 * 1024 * 1024;
export const AI_IMPORT_ACCEPT = ".pdf,.md,.markdown,.txt,.csv,.json,.yaml,.yml,.xml,.svg,.mmd,.mermaid,.docx,.xlsx";
export const AI_IMPORT_MEDIA_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/csv",
  "application/json",
  "application/yaml",
  "text/yaml",
  "application/xml",
  "text/xml",
  "image/svg+xml",
  "text/vnd.mermaid",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const mediaByExtension: Record<string, { canonical: string; accepted: string[] }> = {
  pdf: { canonical: "application/pdf", accepted: ["application/pdf"] },
  md: { canonical: "text/markdown", accepted: ["text/markdown", "text/plain"] },
  markdown: { canonical: "text/markdown", accepted: ["text/markdown", "text/plain"] },
  txt: { canonical: "text/plain", accepted: ["text/plain"] },
  csv: { canonical: "text/csv", accepted: ["text/csv", "application/csv", "text/plain"] },
  json: { canonical: "application/json", accepted: ["application/json", "text/json", "text/plain"] },
  yaml: { canonical: "application/yaml", accepted: ["application/yaml", "text/yaml", "text/plain", "application/x-yaml"] },
  yml: { canonical: "application/yaml", accepted: ["application/yaml", "text/yaml", "text/plain", "application/x-yaml"] },
  xml: { canonical: "application/xml", accepted: ["application/xml", "text/xml", "text/plain"] },
  svg: { canonical: "image/svg+xml", accepted: ["image/svg+xml"] },
  mmd: { canonical: "text/vnd.mermaid", accepted: ["text/vnd.mermaid", "text/plain"] },
  mermaid: { canonical: "text/vnd.mermaid", accepted: ["text/vnd.mermaid", "text/plain"] },
  docx: { canonical: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", accepted: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  xlsx: { canonical: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", accepted: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
};

export function validateAiKnowledgeFile(
  file: File,
  configuredMaxBytes = AI_IMPORT_CLIENT_MAX_BYTES,
  configuredMediaTypes: readonly string[] = AI_IMPORT_MEDIA_TYPES,
): { mediaType: string; maxBytes: number } {
  const maxBytes = Math.min(Math.max(1, configuredMaxBytes), AI_IMPORT_CLIENT_MAX_BYTES);
  if (file.name.length > 180 || /[\\/\u0000-\u001f]/.test(file.name)) throw new Error("The file name must be 180 characters or fewer and contain no path separators or control characters.");
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const media = mediaByExtension[extension];
  if (!media) throw new Error("Choose a supported PDF, Markdown, text, CSV, JSON, YAML, XML, SVG, Mermaid, DOCX, or XLSX document.");
  if (file.size === 0) throw new Error("The selected document is empty.");
  if (file.size > maxBytes) throw new Error(`The selected document exceeds the ${formatBytes(maxBytes)} client-side limit.`);
  if (file.type && !media.accepted.includes(file.type.toLowerCase())) throw new Error("The browser-reported media type does not match the file extension.");
  const allowed = new Set(configuredMediaTypes.map((item) => item.toLowerCase()));
  const mediaType = allowed.has(media.canonical) ? media.canonical : media.accepted.find((item) => allowed.has(item));
  if (!mediaType) throw new Error("The connected AI facade does not allow this document type.");
  return { mediaType, maxBytes };
}

export function AIControlCenter({ api, sourceMode }: { api: DigitalTwinApi; sourceMode: DigitalTwinApi["sourceMode"] }) {
  const [status, setStatus] = useState<AiStatus>();
  const [activity, setActivity] = useState<AiActivityFeed>();
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error" | "denied">("loading");
  const [loadProblem, setLoadProblem] = useState<string>();
  const [announcement, setAnnouncement] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadState("loading");
    setLoadProblem(undefined);
    try {
      const [nextStatus, nextActivity, nextSuggestions] = await Promise.all([
        api.getAiStatus(signal),
        api.getAiActivity(10, signal),
        api.getAiSuggestions(signal),
      ]);
      setStatus(nextStatus);
      setActivity(nextActivity);
      setSuggestions(nextSuggestions);
      setLoadState("ready");
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof ApiProblem && error.status === 403) {
        setLoadState("denied");
        setLoadProblem(error.message);
      } else {
        setLoadState("error");
        setLoadProblem(toMessage(error));
      }
    }
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loadState === "loading") return <AIControlCenterLoading />;
  if (loadState === "denied") return <StatePanel type="denied" title="AI control-plane access is not delegated" description={loadProblem ?? "The active membership cannot view provider state, runs, knowledge, suggestions, or explanation evidence."} />;
  if (loadState === "error" || !status || !activity || !suggestions) {
    return <StatePanel type="error" title="AI Control Center is unavailable" description={loadProblem ?? "The AI facade did not return a complete authorized view."} action={<Button onClick={() => void load()}>Retry AI facade</Button>} />;
  }

  const offlinePreview = status.executionMode === "offline_ui_preview" || sourceMode === "demo";
  const graphAgentReady = status.agentProfiles.some((profile) => profile.agentType === "causal_analysis" && profile.canRun);
  return (
    <div className="ai-control-stack">
      <div className="live-announcement" aria-live="polite">{announcement}</div>
      <header className="section-heading ai-heading">
        <div><p className="eyebrow">Capability-oriented AI operations</p><h1>AI Control Center</h1><p>Inspect provider readiness, run bounded specialists, import permission-scoped knowledge, review suggestions, and reconstruct explanations from evidence.</p></div>
        <StatusPill tone={offlinePreview ? "violet" : "positive"}>{offlinePreview ? "Offline UI preview" : "Connected AI facade"}</StatusPill>
      </header>

      <div className={offlinePreview ? "ai-boundary-banner offline" : "ai-boundary-banner"} role="note">
        <span aria-hidden="true">◇</span>
        <div><strong>{offlinePreview ? "Offline control-plane status" : "Human-reviewed AI boundary"}</strong><p>{offlinePreview ? "No provider, model, or durable private corpus is connected. Agent, retrieval, import, and review operations fail closed; this page contains capability metadata only." : "Agent outputs and suggestions remain PENDING_REVIEW. Approval records a judgment and validated enterprise memory; it never mutates the graph, simulation, or an external system."}</p></div>
        <StatusPill tone={offlinePreview ? "violet" : "info"}>No implicit authority</StatusPill>
      </div>

      <ProviderReadiness status={status} />
      <AgentActivity activity={activity} />
      <AgentRunner status={status} api={api} onResult={(result) => {
        setActivity((current) => current ? { ...current, recent: [result.run, ...current.recent.filter((item) => item.runId !== result.run.runId)] } : current);
        setAnnouncement(`${result.run.agentLabel} returned a PENDING_REVIEW result with ${result.evidence.length} evidence item(s).`);
      }} />
      <KnowledgeImport status={status} api={api} onImported={(result) => setAnnouncement(`${result.filename} returned import status ${result.status}.`)} />
      <SuggestionReview suggestions={suggestions} api={api} canReview={status.canReviewSuggestions} onReviewed={(reviewed) => {
        setSuggestions((current) => current?.map((item) => item.suggestionId === reviewed.suggestionId ? reviewed : item));
        setAnnouncement(`Suggestion review ${reviewed.reviewDecision}; the suggestion remains PENDING_REVIEW and no graph mutation occurred.`);
      }} />
      <ExplainThis api={api} enabled={graphAgentReady} />
    </div>
  );
}

function ProviderReadiness({ status }: { status: AiStatus }) {
  return (
    <Panel className="ai-provider-panel" aria-labelledby="ai-provider-title">
      <div className="section-title-row"><div><p className="eyebrow">Provider gateway</p><h2 id="ai-provider-title">Provider readiness</h2></div><small>Checked {formatDateTime(status.checkedAt)}</small></div>
      <div className="ai-provider-grid">{status.providerReadiness.map((provider) => (
        <article key={provider.provider}>
          <div><span className={`ai-readiness-dot ${provider.status}`} aria-hidden="true" /><strong>{provider.displayName}</strong><StatusPill tone={provider.status === "ready" ? "positive" : provider.status === "degraded" ? "warning" : provider.status === "offline_preview" ? "violet" : "danger"}>{provider.status.replaceAll("_", " ")}</StatusPill></div>
          <p>{provider.detail}</p>
          <DefinitionList rows={[{ label: "Approved models", value: provider.approvedModels.length ? provider.approvedModels.join(", ") : "None reported" }, { label: "Capabilities", value: provider.capabilities.length ? provider.capabilities.join(", ") : "None reported" }, { label: "Live acceptance", value: provider.liveVerified ? "Verified" : "Not recorded" }]} />
        </article>
      ))}</div>
    </Panel>
  );
}

function AgentActivity({ activity }: { activity: AiActivityFeed }) {
  const all = [...activity.active, ...activity.recent];
  return (
    <Panel className="ai-activity-panel" aria-labelledby="ai-activity-title">
      <div className="section-title-row"><div><p className="eyebrow">Auditable runs</p><h2 id="ai-activity-title">Active and recent agent activity</h2></div><StatusPill tone="neutral">{activity.active.length} active · {activity.recent.length} recent</StatusPill></div>
      {!all.length ? <StatePanel type="empty" title="No authorized agent activity" description="No active or recent runs are visible to this membership." /> : <div className="ai-activity-table-wrap"><table className="ai-activity-table"><caption className="visually-hidden">Authorized active and recent AI agent runs</caption><thead><tr><th>Agent</th><th>Task</th><th>Status</th><th>Provider / model</th><th>Evidence</th><th>Started</th></tr></thead><tbody>{all.map((run) => <tr key={run.runId}><td><strong>{run.agentLabel}</strong><small><code>{run.runId}</code></small></td><td>{run.taskSummary}</td><td><StatusPill tone={run.status === "running" ? "info" : run.status === "PENDING_REVIEW" ? "warning" : run.status === "approved" ? "positive" : run.status === "failed" || run.status === "rejected" ? "danger" : "neutral"}>{run.status.replaceAll("_", " ")}</StatusPill></td><td>{run.provider}<small>{run.model}</small></td><td>{run.evidenceCount} cited<br /><small>{run.toolInvocationCount} tool call(s)</small></td><td>{formatDateTime(run.startedAt)}</td></tr>)}</tbody></table></div>}
    </Panel>
  );
}

function AgentRunner({ status, api, onResult }: { status: AiStatus; api: DigitalTwinApi; onResult: (result: AiAgentResult) => void }) {
  const firstProfile = status.agentProfiles.find((profile) => profile.canRun)?.agentType ?? status.agentProfiles[0]?.agentType ?? "causal_analysis";
  const [agentType, setAgentType] = useState<AiAgentType>(firstProfile);
  const [input, setInput] = useState("Verify the recorded dependency path from AST-142 to the Orion 2.0 launch milestone.");
  const [contextQuery, setContextQuery] = useState("Aster Orion launch dependencies");
  const [result, setResult] = useState<AiAgentResult>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const selected = status.agentProfiles.find((profile) => profile.agentType === agentType);

  async function run(event: FormEvent) {
    event.preventDefault();
    if (input.trim().length < 8) { setProblem("Describe a bounded task using at least eight characters."); return; }
    setBusy(true); setProblem(undefined); setResult(undefined);
    try {
      const next = await api.runAiAgent({ agentType, input: input.trim(), retrievalQuery: contextQuery.trim() || undefined, maxEvidenceItems: 10 });
      setResult(next); onResult(next);
    } catch (error) { setProblem(toMessage(error)); } finally { setBusy(false); }
  }

  return (
    <Panel className="ai-runner-panel" aria-labelledby="ai-runner-title">
      <div className="section-title-row"><div><p className="eyebrow">Bounded specialist</p><h2 id="ai-runner-title">Specialized agent runner</h2></div><StatusPill tone="warning">Outputs require review</StatusPill></div>
      <div className="ai-runner-grid">
        <form onSubmit={(event) => void run(event)}>
          <label htmlFor="ai-agent-type">Agent profile</label><select id="ai-agent-type" value={agentType} onChange={(event) => { setAgentType(event.target.value as AiAgentType); setResult(undefined); }}>{status.agentProfiles.map((profile) => <option key={profile.agentType} value={profile.agentType} disabled={!profile.canRun}>{profile.label}{profile.canRun ? "" : " · unavailable"}</option>)}</select>
          <div className="ai-profile-boundary"><strong>{selected?.purpose}</strong><p>{selected?.authorityBoundary}</p></div>
          <label htmlFor="ai-agent-input">Bounded task</label><textarea id="ai-agent-input" value={input} maxLength={2000} onChange={(event) => setInput(event.target.value)} />
          <label htmlFor="ai-context-query">Authorized context query <span>optional</span></label><input id="ai-context-query" value={contextQuery} maxLength={300} onChange={(event) => setContextQuery(event.target.value)} />
          <small>No session ID is sent, so this run receives no caller-selected durable memory. Tenant and graph context are derived by the server.</small>
          {!status.agentProfiles.some((profile) => profile.canRun) ? <p className="ai-unavailable-note">No provider-backed agent profile is configured. Offline mode cannot generate a result.</p> : null}
          {problem ? <p className="ai-inline-error" role="alert">{problem}</p> : null}
          <Button type="submit" busy={busy} disabled={!selected?.canRun}>Run bounded specialist</Button>
        </form>
        <div className="ai-result-column">{!result ? <StatePanel type="empty" title="No specialist result yet" description="Choose a profile and run a bounded task. Any result remains PENDING_REVIEW." /> : <AgentResult result={result} />}</div>
      </div>
    </Panel>
  );
}

function AgentResult({ result }: { result: AiAgentResult }) {
  return <article className="ai-agent-result" aria-label="Specialized agent result"><div className="section-title-row"><div><p className="eyebrow">Reviewable output</p><h3>{result.run.agentLabel}</h3></div><StatusPill tone="warning">{result.status.replaceAll("_", " ")}</StatusPill></div><p>{result.output}</p><div className="ai-result-metrics"><span><strong>{formatConfidence(result.confidence)}</strong> confidence</span><span><strong>{result.evidence.length}</strong> evidence items</span><span><strong>{formatUsage(result.usage.totalTokens)}</strong> tokens</span><span><strong>{formatCost(result.usage.estimatedCostUsd)}</strong> cost</span></div>{result.structuredOutput ? <details className="ai-structured-output"><summary>Structured output</summary><pre>{JSON.stringify(result.structuredOutput, null, 2)}</pre></details> : null}<EvidenceList evidence={result.evidence} /><p className="ai-review-notice">{result.reviewNotice}</p><small>{result.provider} · {result.model}</small></article>;
}

function KnowledgeImport({ status, api, onImported }: { status: AiStatus; api: DigitalTwinApi; onImported: (result: AiKnowledgeImportResult) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [mediaType, setMediaType] = useState<string>();
  const [classification, setClassification] = useState<AiClassification>("internal");
  const [receipt, setReceipt] = useState<AiKnowledgeImportResult>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const maxBytes = Math.min(status.knowledgeImport.maxBytes, AI_IMPORT_CLIENT_MAX_BYTES);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    setFile(undefined); setMediaType(undefined); setReceipt(undefined); setProblem(undefined);
    if (!next) return;
    try { const validation = validateAiKnowledgeFile(next, maxBytes, status.knowledgeImport.allowedMediaTypes); setFile(next); setMediaType(validation.mediaType); }
    catch (error) { setProblem(toMessage(error)); event.target.value = ""; }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || !mediaType) { setProblem("Choose an allowed document before importing."); return; }
    setBusy(true); setProblem(undefined); setReceipt(undefined);
    try {
      const contentBase64 = await encodeFileBase64(file);
      const next = await api.importAiKnowledge({ filename: file.name, mediaType, contentBase64, classification, sourceAcl: { visibility: "private" } });
      setReceipt(next); onImported(next); setFile(undefined); setMediaType(undefined); if (inputRef.current) inputRef.current.value = "";
    } catch (error) { setProblem(toMessage(error)); } finally { setBusy(false); }
  }

  return (
    <Panel className="ai-import-panel" aria-labelledby="ai-import-title">
      <div className="section-title-row"><div><p className="eyebrow">Permission-scoped ingestion</p><h2 id="ai-import-title">Secure knowledge import</h2></div><StatusPill tone="info">Private ACL</StatusPill></div>
      <div className="ai-import-grid"><form onSubmit={(event) => void upload(event)}>
        <label htmlFor="ai-knowledge-file">Document, specification, or report</label><input ref={inputRef} id="ai-knowledge-file" type="file" accept={AI_IMPORT_ACCEPT} onChange={chooseFile} disabled={!status.knowledgeImport.enabled || busy} />
        <div className="ai-import-notice" role="note"><strong>Client limit {formatBytes(maxBytes)}</strong><p>Allowed: PDF, Markdown, TXT, CSV, JSON, YAML, XML, SVG, Mermaid, DOCX, and XLSX. Content is base64-encoded in this browser, then revalidated and permission-filtered by the server. Do not import data you are not authorized to classify.</p></div>
        <label htmlFor="ai-classification">Classification</label><select id="ai-classification" value={classification} onChange={(event) => setClassification(event.target.value as AiClassification)}>{status.knowledgeImport.classifications.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <small>Source ACL is fixed to <strong>private visibility</strong> and the active server-derived membership. Arbitrary principals cannot be supplied.</small>
        {!status.knowledgeImport.enabled ? <p className="ai-unavailable-note">{!status.knowledgeImport.storeReady ? "Import is disabled because the durable private corpus is unavailable. The UI does not retain this file." : !status.knowledgeImport.authorized ? "Import requires connector administration permission in the active server-derived context." : "Import is unavailable in this context."}</p> : null}
        {file ? <p className="ai-selected-file"><strong>{file.name}</strong><span>{formatBytes(file.size)} · {mediaType} · {classification}</span></p> : null}
        {problem ? <p className="ai-inline-error" role="alert">{problem}</p> : null}
        <Button type="submit" busy={busy} disabled={!file || !status.knowledgeImport.enabled}>Encode and import privately</Button>
      </form><div>{receipt ? <div className="ai-import-receipt" role="status"><p className="eyebrow">Import receipt</p><h3>{receipt.status === "rejected" ? "Document quarantined" : "Private import accepted"}</h3><p>{receipt.message}</p><DefinitionList rows={[{ label: "Document", value: receipt.filename }, { label: "Classification", value: receipt.classification }, { label: "Visibility", value: receipt.sourceAcl.visibility }, { label: "Bytes", value: receipt.byteCount.toLocaleString() }, { label: "Content hash", value: <code>{receipt.contentHash}</code> }, { label: "Mode", value: receipt.executionMode.replaceAll("_", " ") }]} /></div> : <StatePanel type="empty" title="No document submitted" description="The selected file remains local until you explicitly encode and import it." />}</div></div>
    </Panel>
  );
}

function SuggestionReview({ suggestions, api, canReview, onReviewed }: { suggestions: AiSuggestion[]; api: DigitalTwinApi; canReview: boolean; onReviewed: (suggestion: AiSuggestion) => void }) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [problem, setProblem] = useState<string>();

  async function review(suggestion: AiSuggestion, decision: "approve" | "reject") {
    const reason = reasons[suggestion.suggestionId]?.trim() ?? "";
    if (reason.length < 5) { setProblem("Enter a review reason of at least five characters before approving or rejecting."); return; }
    setBusy(`${suggestion.suggestionId}:${decision}`); setProblem(undefined);
    try { onReviewed(await api.reviewAiSuggestion({ suggestionId: suggestion.suggestionId, decision, reason })); }
    catch (error) { setProblem(toMessage(error)); } finally { setBusy(undefined); }
  }

  return (
    <Panel className="ai-suggestions-panel" aria-labelledby="ai-suggestions-title">
      <div className="section-title-row"><div><p className="eyebrow">Human judgment queue</p><h2 id="ai-suggestions-title">AI suggestions</h2></div><StatusPill tone="warning">{suggestions.filter((item) => !item.reviewDecision).length} awaiting a review decision</StatusPill></div>
      {problem ? <p className="ai-inline-error" role="alert">{problem}</p> : null}
      {!canReview && suggestions.some((item) => !item.reviewDecision) ? <p className="ai-unavailable-note">Review controls require connector administration permission. Suggestions remain visible within the authorized evidence scope.</p> : null}
      {!suggestions.length ? <StatePanel type="empty" title="No authorized suggestions" description="The facade returned no suggestions in this membership scope." /> : <div className="ai-suggestion-list">{suggestions.map((suggestion) => <article key={suggestion.suggestionId}>
        <div className="section-title-row"><div><h3>{suggestion.title}</h3><small>{suggestion.provider} · {suggestion.model} · {formatDateTime(suggestion.createdAt)}</small></div><StatusPill tone={suggestion.reviewDecision === "approve" ? "positive" : suggestion.reviewDecision === "reject" ? "danger" : "warning"}>{suggestion.reviewDecision === "approve" ? "review approved" : suggestion.reviewDecision === "reject" ? "review rejected" : suggestion.status.replaceAll("_", " ")}</StatusPill></div>
        <p>{suggestion.summary}</p><div className="ai-proposed-action"><strong>Proposed review outcome</strong><p>{suggestion.proposedAction}</p></div>
        <div className="ai-suggestion-metadata"><span>{formatConfidence(suggestion.confidence)} confidence</span><span>{suggestion.evidence.length} evidence item(s)</span><span>{formatUsage(suggestion.usage.totalTokens)} tokens</span><span>{formatCost(suggestion.usage.estimatedCostUsd)}</span></div>
        {suggestion.structuredOutput ? <details className="ai-structured-output"><summary>Structured suggestion</summary><pre>{JSON.stringify(suggestion.structuredOutput, null, 2)}</pre></details> : null}
        <EvidenceList evidence={suggestion.evidence} />
        {!suggestion.reviewDecision ? <div className="ai-review-controls"><label htmlFor={`suggestion-reason-${suggestion.suggestionId}`}>Review reason</label><textarea id={`suggestion-reason-${suggestion.suggestionId}`} value={reasons[suggestion.suggestionId] ?? ""} maxLength={500} disabled={!canReview} onChange={(event) => setReasons((current) => ({ ...current, [suggestion.suggestionId]: event.target.value }))} /><div><Button variant="secondary" busy={busy === `${suggestion.suggestionId}:approve`} disabled={!canReview} onClick={() => void review(suggestion, "approve")}>Approve suggestion</Button><Button variant="danger" busy={busy === `${suggestion.suggestionId}:reject`} disabled={!canReview} onClick={() => void review(suggestion, "reject")}>Reject suggestion</Button></div></div> : <p className="ai-review-receipt" role="status"><strong>{suggestion.reviewDecision === "approve" ? "Approved into validated enterprise memory" : "Rejected"}.</strong>{suggestion.reviewReason ? ` ${suggestion.reviewReason}` : " The audited service retains the review-note digest, not the raw note."} The suggestion itself remains PENDING_REVIEW. No graph, simulation, or external-system mutation occurred.</p>}
        <p className="ai-no-mutation"><span aria-hidden="true">✓</span> Review decision only · no graph mutation</p>
      </article>)}</div>}
    </Panel>
  );
}

function ExplainThis({ api, enabled }: { api: DigitalTwinApi; enabled: boolean }) {
  const [query, setQuery] = useState("Why is AST-142 connected to Orion 2.0 launch risk?");
  const [result, setResult] = useState<AiExplainResult>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  async function explain(event: FormEvent) {
    event.preventDefault();
    if (!enabled) { setProblem("Explain This requires a configured live provider and private evidence corpus."); return; }
    if (query.trim().length < 5) { setProblem("Ask a specific question using at least five characters."); return; }
    setBusy(true); setProblem(undefined); setResult(undefined);
    try {
      const prompt = query.trim();
      const [agent, retrieval] = await Promise.all([
        api.runAiAgent({ agentType: "causal_analysis", input: prompt, retrievalQuery: prompt, maxEvidenceItems: 8 }),
        api.queryAiRetrieval(prompt, 8),
      ]);
      const evidence = mergeEvidence(agent.evidence, retrieval.evidence);
      const causalChain = agent.causalChain.length ? agent.causalChain : retrieval.causalChain;
      const affectedNodes = agent.affectedNodes.length ? agent.affectedNodes : retrieval.affectedNodes;
      setResult({
        query: prompt,
        summary: agent.output,
        confidence: agent.confidence,
        causalChain,
        evidence,
        affectedNodes,
        provider: agent.provider,
        model: agent.model,
        generatedAt: agent.run.completedAt ?? new Date().toISOString(),
        runId: agent.run.runId,
        status: "PENDING_REVIEW",
        limitations: [...new Set([
          ...agent.limitations,
          ...agent.warnings,
          ...retrieval.limitations,
          ...(evidence.length ? [] : ["No private evidence was returned; this result is unsupported."]),
          ...(causalChain.length ? [] : ["The bounded agent did not return a causal chain."]),
          ...(affectedNodes.length ? [] : ["The bounded agent did not identify affected nodes."]),
        ])],
        executionMode: "connected",
      });
    } catch (error) { setProblem(toMessage(error)); } finally { setBusy(false); }
  }
  return (
    <Panel className="ai-explain-panel" aria-labelledby="ai-explain-title"><div className="section-title-row"><div><p className="eyebrow">Grounded reconstruction</p><h2 id="ai-explain-title">Explain This</h2></div><StatusPill tone="info">Bounded causal-analysis agent</StatusPill></div><form onSubmit={(event) => void explain(event)}><label htmlFor="ai-explain-query">What should the twin explain?</label><div><input id="ai-explain-query" value={query} maxLength={500} onChange={(event) => setQuery(event.target.value)} disabled={!enabled} /><Button type="submit" busy={busy} disabled={!enabled}>Run bounded explanation</Button></div><small>Explain This queries the permission-trimmed private corpus and runs the read-only causal-analysis agent. The server injects bounded authorized graph/event context; simulation context is included only when explicitly bound by the API.</small>{!enabled ? <p className="ai-unavailable-note">Provider unconfigured: no agent will run and no explanation is simulated.</p> : null}{problem ? <p className="ai-inline-error" role="alert">{problem}</p> : null}</form>{result ? <ExplainResult result={result} /> : <StatePanel type="empty" title={enabled ? "No explanation requested" : "Live explanation unavailable"} description={enabled ? "Ask why a recorded item is connected. The facade must return provenance; the UI will not invent missing causal links." : "Connect an approved provider and private evidence corpus to enable this bounded interaction."} />}</Panel>
  );
}

function ExplainResult({ result }: { result: AiExplainResult }) {
  const evidenceById = new Map(result.evidence.map((item) => [item.evidenceId, item]));
  return <div className="ai-explain-result" role="status"><div className="section-title-row"><div><p className="eyebrow">Bounded agent result</p><h3>{result.summary}</h3><small>{result.confidence === null ? "Confidence not reported" : `${formatConfidence(result.confidence)} confidence`} · {result.provider} · {result.model}{result.runId ? ` · run ${result.runId}` : ""}</small></div><StatusPill tone="warning">{result.status.replaceAll("_", " ")}</StatusPill></div>{result.causalChain.length ? <ol className="ai-causal-chain" aria-label="Causal chain">{result.causalChain.map((step) => <li key={`${step.step}-${step.fromNode}-${step.toNode}`}><span>{step.step}</span><div><strong>{step.fromNode}</strong><b>{step.relationship}</b><strong>{step.toNode}</strong><p>{step.explanation}</p><small>{step.evidenceIds.map((id) => evidenceById.get(id)?.label ?? id).join(" · ") || "No step-level evidence reference"}</small></div></li>)}</ol> : <StatePanel type="empty" title="No causal chain returned" description="Authorized evidence is shown below, but the bounded agent did not return a causal relationship and the UI did not infer one." />}<div className="ai-affected-nodes"><strong>Affected nodes</strong>{result.affectedNodes.length ? result.affectedNodes.map((node, index) => <article key={node.nodeId ?? `${node.label}-${index}`}><span>{node.kind}</span><b>{node.label}</b><p>{node.effect}</p></article>) : <p>No affected nodes were returned.</p>}</div><EvidenceList evidence={result.evidence} /><div className="ai-limitations"><strong>Limitations</strong>{result.limitations.length ? <ul>{result.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No additional limitations were reported; review the evidence and scope before relying on this result.</p>}</div></div>;
}

function EvidenceList({ evidence }: { evidence: AiEvidence[] }) {
  return <div className="ai-evidence-list"><strong>Evidence</strong>{!evidence.length ? <p>No evidence returned; treat this output as unsupported.</p> : <ul>{evidence.map((item) => <li key={item.evidenceId}><div><b>{item.label}</b><StatusPill tone="neutral">{item.classification}</StatusPill></div><p>{item.excerpt}</p><small>{item.source} · {item.sourceKey} · <code>{item.evidenceId}</code>{item.confidence === null ? " · confidence not reported" : ` · ${formatConfidence(item.confidence)} confidence`}</small></li>)}</ul>}</div>;
}

function AIControlCenterLoading() { return <div className="ai-control-loading" aria-label="Loading AI Control Center"><Skeleton lines={3} /><div><Skeleton lines={5} /><Skeleton lines={5} /></div><Skeleton lines={6} /></div>; }

function encodeFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected document could not be read in this browser."));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const delimiter = value.indexOf(",");
      if (delimiter < 0) reject(new Error("The selected document could not be encoded."));
      else resolve(value.slice(delimiter + 1));
    };
    reader.readAsDataURL(file);
  });
}

function mergeEvidence(...groups: AiEvidence[][]): AiEvidence[] {
  const unique = new Map<string, AiEvidence>();
  groups.flat().forEach((item) => unique.set(item.evidenceId, item));
  return [...unique.values()];
}

function formatConfidence(value: number) { return `${Math.round(value * 100)}%`; }
function formatUsage(value: number | null) { return value === null ? "Not reported" : value.toLocaleString(); }
function formatCost(value: number | null) { return value === null ? "Cost not reported" : `$${value.toFixed(4)}`; }
function formatBytes(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB` : `${Math.ceil(bytes / 1024)} KB`; }
function toMessage(error: unknown) { if (error instanceof ApiProblem) return `${error.message}${error.retryable ? " You can retry safely." : ""}`; if (error instanceof Error) return error.message; return "An unexpected AI Control Center error occurred."; }
