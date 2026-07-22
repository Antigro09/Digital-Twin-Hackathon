"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDigitalTwinApi } from "@/lib/api/client";
import type {
  ActionReceipt,
  ActorContext,
  AnswerMode,
  ApprovalRequest,
  ApprovalRole,
  CitedAnswer,
  CompensationPreview,
  ConnectorHealth,
  DemoState,
  DigitalTwinApi,
  GraphResult,
  RemediationPreview,
  ScenarioDraft,
  SimulationComparison,
} from "@/lib/api/types";
import { ApiProblem } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { ActionWorkspace } from "./ActionWorkspace";
import { AIControlCenter } from "./AIControlCenter";
import { CopilotPanel } from "./CopilotPanel";
import { EventIntelligence } from "./EventIntelligence";
import { GraphExplorer } from "./GraphExplorer";
import { LocalDemoUnlock } from "./LocalDemoUnlock";
import { Overview } from "./Overview";
import { ScenarioWorkspace } from "./ScenarioWorkspace";
import { Button, Skeleton, StatePanel, StatusPill } from "./ui";

type View = "overview" | "event" | "ai" | "graph" | "copilot" | "scenario" | "action";

const navigation: Array<{ id: View; label: string; eyebrow: string; glyph: string }> = [
  { id: "overview", label: "Company overview", eyebrow: "Operational posture", glyph: "01" },
  { id: "graph", label: "Knowledge graph", eyebrow: "Entities + relationships", glyph: "02" },
  { id: "scenario", label: "Simulation engine", eyebrow: "Reproducible scenarios", glyph: "03" },
  { id: "event", label: "Events", eyebrow: "Causal impact", glyph: "04" },
  { id: "ai", label: "AI agents", eyebrow: "Models + intelligence", glyph: "05" },
  { id: "copilot", label: "Analysis reports", eyebrow: "Evidence-led findings", glyph: "06" },
  { id: "action", label: "Governance", eyebrow: "Approvals + audit", glyph: "07" },
];

const viewTitles: Record<View, string> = {
  ai: "AI provider and agent control center",
  event: "Event intelligence and causal impact",
  overview: "Orion launch control room",
  graph: "Company relationship map",
  copilot: "Cited organizational analysis",
  scenario: "Scenario and simulation lab",
  action: "Governed Jira remediation",
};

export function DigitalTwinApp() {
  const apiRef = useRef<DigitalTwinApi | undefined>(undefined);
  const mainRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<View>("overview");
  const [actor, setActor] = useState<ActorContext>();
  const [connectors, setConnectors] = useState<ConnectorHealth[]>([]);
  const [graph, setGraph] = useState<GraphResult>();
  const [answer, setAnswer] = useState<CitedAnswer>();
  const [scenario, setScenario] = useState<ScenarioDraft>();
  const [simulation, setSimulation] = useState<SimulationComparison>();
  const [preview, setPreview] = useState<RemediationPreview>();
  const [approval, setApproval] = useState<ApprovalRequest>();
  const [receipt, setReceipt] = useState<ActionReceipt>();
  const [compensation, setCompensation] = useState<CompensationPreview>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string>();
  const [demoState, setDemoState] = useState<DemoState>("live");
  const [announcement, setAnnouncement] = useState("");
  const [demoAuthLocked, setDemoAuthLocked] = useState(false);
  const demoEnabled = process.env.NEXT_PUBLIC_ENABLE_DEMO_DATA === "true";

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setProblem(undefined);
    setDemoAuthLocked(false);
    try {
      const api = getDigitalTwinApi();
      apiRef.current = api;
      const [actorResult, connectorResult, graphResult, answerResult] = await Promise.all([
        api.getActorContext(),
        api.getConnectorHealth(),
        api.traverseLaunchGraph(),
        api.askLaunchRisk("What is most likely to delay Orion 2.0?", "grounded"),
      ]);
      setActor(actorResult);
      setConnectors(connectorResult);
      setGraph(graphResult);
      setAnswer(answerResult);
    } catch (error) {
      if (isDemoAuthLocked(error)) setDemoAuthLocked(true);
      else setProblem(toMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    if (!loading) mainRef.current?.focus();
  }, [view, loading]);

  const activeMembership = useMemo(
    () => actor?.memberships.find((membership) => membership.membershipId === actor.activeMembershipId),
    [actor],
  );
  const canSimulate = activeMembership?.capabilities.includes("scenario:write") ?? false;
  const canPropose = activeMembership?.capabilities.includes("action:propose") ?? false;
  const canReviewEvents = activeMembership?.capabilities.includes("event:review") ?? false;
  const canApplyEvents = activeMembership?.capabilities.includes("event:apply") ?? false;
  const canManageGraph = activeMembership?.capabilities.includes("connector.admin") ?? false;
  const isAsterContext = activeMembership?.tenantAlias === "tnt_aster";
  const workspaceLabel = isAsterContext ? "Orion launch" : "Beacon workspace";
  const currentViewTitle = view === "overview" && !isAsterContext ? "Beacon operations control room" : viewTitles[view];

  async function withBusy<T>(key: string, work: (api: DigitalTwinApi) => Promise<T>, apply: (result: T) => void) {
    const api = apiRef.current;
    if (!api) return;
    setBusy(key);
    setProblem(undefined);
    try {
      const result = await work(api);
      apply(result);
    } catch (error) {
      if (isDemoAuthLocked(error)) setDemoAuthLocked(true);
      else setProblem(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function selectMembership(membershipId: string) {
    const api = apiRef.current;
    if (!api || membershipId === actor?.activeMembershipId) return;
    setBusy("context");
    setProblem(undefined);
    try {
      const nextActor = await api.selectMembership(membershipId);
      const [nextConnectors, nextGraph, nextAnswer] = await Promise.all([
        api.getConnectorHealth(),
        api.traverseLaunchGraph(),
        api.askLaunchRisk("What is most likely to delay this tenant’s launch?", "grounded"),
      ]);
      setActor(nextActor);
      setConnectors(nextConnectors);
      setGraph(nextGraph);
      setAnswer(nextAnswer);
      setScenario(undefined);
      setSimulation(undefined);
      setPreview(undefined);
      setApproval(undefined);
      setReceipt(undefined);
      setCompensation(undefined);
      const membership = nextActor.memberships.find((item) => item.membershipId === membershipId);
      setAnnouncement(`Active context changed to ${membership?.tenantName}. Tenant-scoped state was cleared.`);
      setView("overview");
    } catch (error) {
      if (isDemoAuthLocked(error)) setDemoAuthLocked(true);
      else setProblem(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function navigate(nextView: View) {
    setView(nextView);
  }

  const effectiveConnectors = demoState === "stale"
    ? connectors.map((item) => ({ ...item, state: "stale" as const, freshnessMinutes: 37, detail: `${item.detail} · reconciliation overdue` }))
    : connectors;

  if (loading) return <InitialLoading />;

  if (demoAuthLocked && apiRef.current?.sourceMode === "connected") {
    return <LocalDemoUnlock onUnlocked={bootstrap} />;
  }

  if ((!actor || !graph || !answer) && problem) {
    return (
      <main className="configuration-screen">
        <div className="brand-mark large" aria-hidden="true">DT</div>
        <StatePanel type="error" title="The application could not start" description={problem} action={<Button onClick={() => void bootstrap()}>Try again</Button>} />
        <p>Connected mode requires <code>NEXT_PUBLIC_API_URL</code>. Synthetic data is available only when <code>NEXT_PUBLIC_ENABLE_DEMO_DATA=true</code> is explicitly set.</p>
      </main>
    );
  }

  if (!actor || !graph || !answer) return null;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="live-announcement" aria-live="polite">{announcement}</div>
      <aside className="sidebar">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">DT</span><div><strong>Digital Twin</strong><span>Enterprise control plane</span></div></div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">{workspaceLabel}</p>
          {navigation.map((item) => (
            <button key={item.id} className={view === item.id ? "nav-item nav-item-active" : "nav-item"} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined}>
              <span className="nav-glyph" aria-hidden="true">{item.glyph}</span><span><strong>{item.label}</strong><small>{item.eyebrow}</small></span>
            </button>
          ))}
        </nav>
        <div className="sidebar-boundary"><span aria-hidden="true">◇</span><div><strong>Governed local demo</strong><p>{isAsterContext ? "Company graph changes are audited and permission-checked. External actions remain allowlisted." : "Read-only tenant context; no cross-company data or actions are exposed."}</p></div></div>
        <div className="sidebar-footer"><span className="actor-avatar">{actor.actor.initials}</span><div><strong>{actor.actor.displayName}</strong><span>{activeMembership?.role}</span></div><span className="online-dot" title="Authenticated" /></div>
      </aside>

      <div className="app-body">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark" aria-hidden="true">DT</span><strong>Digital Twin</strong></div>
          <div className="breadcrumb"><span>{activeMembership?.tenantName ?? "Tenant"}</span><i aria-hidden="true">/</i><strong>{currentViewTitle}</strong></div>
          <div className="topbar-actions">
            <div className="system-readouts" aria-label="System status">
              <span><i className="readout-online" />System health</span><span>Models: active</span><span>AI: monitored</span>
            </div>
            <StatusPill tone={apiRef.current?.sourceMode === "connected" ? "positive" : "violet"}>
              {apiRef.current?.sourceMode === "connected" ? "Connected API · trusted local demo auth" : "Local demo data"}
            </StatusPill>
            {demoEnabled ? (
              <label className="state-lab"><span>Preview state</span><select aria-label="Preview interface state" value={demoState} onChange={(event) => setDemoState(event.target.value as DemoState)}><option value="live">Normal</option><option value="loading">Loading</option><option value="empty">Empty</option><option value="error">Error</option><option value="stale">Stale</option><option value="revoked">Revoked</option></select></label>
            ) : null}
            <div className="context-picker">
              <label htmlFor="membership-context">Active membership</label>
              <div className="select-wrap"><span className="tenant-avatar" aria-hidden="true">{activeMembership?.tenantName.slice(0, 1)}</span><select id="membership-context" value={actor.activeMembershipId} disabled={busy === "context"} onChange={(event) => void selectMembership(event.target.value)}>{actor.memberships.map((membership) => <option key={membership.membershipId} value={membership.membershipId}>{membership.tenantName} · {membership.role}</option>)}</select><span aria-hidden="true">⌄</span></div>
              <small>Server-derived context · expires {formatDateTime(actor.expiresAt)}</small>
            </div>
          </div>
        </header>

        <nav className="mobile-nav" aria-label="Mobile navigation">{navigation.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><span aria-hidden="true">{item.glyph}</span>{item.label}</button>)}</nav>

        {problem ? <div className="global-alert" role="alert"><span aria-hidden="true">!</span><p><strong>That operation did not complete.</strong>{problem}</p><button onClick={() => setProblem(undefined)} aria-label="Dismiss error">×</button></div> : null}
        {demoState === "stale" ? <div className="global-alert stale-alert" role="status"><span aria-hidden="true">◷</span><p><strong>Source projection is stale.</strong>Results remain visible with their watermark; external actions are paused until reconciliation completes.</p><button onClick={() => setDemoState("live")} aria-label="Dismiss stale preview">×</button></div> : null}
        {demoState === "revoked" ? <div className="global-alert revoked-alert" role="status"><span aria-hidden="true">↯</span><p><strong>Source permission was revoked.</strong>Restricted evidence is removed from answers, graph results, caches, and action eligibility.</p><button onClick={() => setDemoState("live")} aria-label="Dismiss revoked preview">×</button></div> : null}

        <main id="main-content" className="main-content" ref={mainRef} tabIndex={-1}>
          {demoState === "loading" ? <DemoLoading /> : demoState === "error" ? (
            <StatePanel type="error" title="This surface is temporarily unavailable" description="A retryable projection service error was simulated. No partial result is represented as complete." action={<Button onClick={() => setDemoState("live")}>Retry</Button>} />
          ) : demoState === "empty" ? (
            <StatePanel type="empty" title="No results in this authorized scope" description="The query succeeded, but no entities matched. Broaden the filter or return to the frozen H1 fixture." action={<Button variant="secondary" onClick={() => setDemoState("live")}>Restore fixture</Button>} />
          ) : demoState === "revoked" ? (
            <StatePanel type="revoked" title="Authorization intersection is empty" description="The active source grant was revoked. No cached content, citation locator, embedding, or graph edge is disclosed." action={<Button variant="secondary" onClick={() => setDemoState("live")}>Exit state preview</Button>} />
          ) : renderView({
            api: apiRef.current!,
            view,
            graph,
            answer,
            connectors: effectiveConnectors,
            scenario,
            simulation,
            preview,
            approval,
            receipt,
            compensation,
            busy,
            canSimulate,
            canPropose,
            canReviewEvents,
            canApplyEvents,
            canManageGraph,
            sourceMode: apiRef.current!.sourceMode,
            navigate,
            onAsk: async (question, mode) => withBusy("question", (api) => api.askLaunchRisk(question, mode), setAnswer),
            onCompile: async (delta) => withBusy("compile", (api) => api.createScenario(delta), (result) => { setScenario(result); setSimulation(undefined); }),
            onConfirm: async () => { if (scenario) await withBusy("confirm", (api) => api.confirmScenario(scenario.id, scenario.digest, scenario.etag), setScenario); },
            onSimulate: async () => { if (scenario) await withBusy("simulate", (api) => api.runSimulation(scenario.id), setSimulation); },
            onPreview: async () => withBusy("preview", (api) => api.previewRemediation(), setPreview),
            onRequestApproval: async () => { if (preview) await withBusy("request-approval", (api) => api.requestApproval(preview.previewId, preview.payloadHash), setApproval); },
            onApprove: async (role) => { if (approval && preview) await withBusy(`approve-${role}`, (api) => api.approve(approval.approvalId, role, preview.payloadHash, `edt-h1-${role}-approval-ast142-v7`), setApproval); },
            onExecute: async () => { if (approval) await withBusy("execute", (api) => api.execute(approval.approvalId, "edt-h1-action-aster-ast142-v7"), setReceipt); },
            onReplay: async () => { if (approval) await withBusy("replay", (api) => api.execute(approval.approvalId, "edt-h1-action-aster-ast142-v7"), setReceipt); },
            onPreviewCompensation: async () => { if (receipt) await withBusy("rollback-preview", (api) => api.previewCompensation(receipt.receiptId), setCompensation); },
            onApproveCompensation: async (role) => { if (compensation) await withBusy(`compensate-approve-${role}`, (api) => api.approveCompensation(compensation.compensationId, role, compensation.payloadHash, `edt-h1-${role}-compensation-ast142-v8`), setCompensation); },
            onCompensate: async () => { if (compensation) await withBusy("compensate", (api) => api.compensate(compensation.compensationId, "edt-h1-compensation-ast142-v8"), setCompensation); },
          })}
        </main>
        <footer className="system-status-bar"><span><i className="readout-online" /> Data plane: online</span><span>Models: governed</span><span>Last synchronization: {formatDateTime(actor.expiresAt)}</span><span>Processing: {busy ?? "idle"}</span></footer>
      </div>
    </div>
  );
}

type RenderViewProps = {
  api: DigitalTwinApi;
  view: View;
  graph: GraphResult;
  answer: CitedAnswer;
  connectors: ConnectorHealth[];
  scenario?: ScenarioDraft;
  simulation?: SimulationComparison;
  preview?: RemediationPreview;
  approval?: ApprovalRequest;
  receipt?: ActionReceipt;
  compensation?: CompensationPreview;
  busy: string | null;
  canSimulate: boolean;
  canPropose: boolean;
  canReviewEvents: boolean;
  canApplyEvents: boolean;
  canManageGraph: boolean;
  sourceMode: DigitalTwinApi["sourceMode"];
  navigate: (view: View) => void;
  onAsk: (question: string, mode: AnswerMode) => Promise<void>;
  onCompile: (delta: number) => Promise<void>;
  onConfirm: () => Promise<void>;
  onSimulate: () => Promise<void>;
  onPreview: () => Promise<void>;
  onRequestApproval: () => Promise<void>;
  onApprove: (role: ApprovalRole) => Promise<void>;
  onExecute: () => Promise<void>;
  onReplay: () => Promise<void>;
  onPreviewCompensation: () => Promise<void>;
  onApproveCompensation: (role: ApprovalRole) => Promise<void>;
  onCompensate: () => Promise<void>;
};

function renderView(props: RenderViewProps) {
  switch (props.view) {
    case "ai": return <AIControlCenter api={props.api} sourceMode={props.sourceMode} />;
    case "event": return <EventIntelligence api={props.api} canReview={props.canReviewEvents} canApply={props.canApplyEvents} sourceMode={props.sourceMode} />;
    case "overview": return <Overview graph={props.graph} answer={props.answer} connectors={props.connectors} onNavigate={props.navigate} />;
    case "graph": return <GraphExplorer api={props.api} canManage={props.canManageGraph} />;
    case "copilot": return <CopilotPanel answer={props.answer} busy={props.busy === "question"} onAsk={props.onAsk} />;
    case "scenario": return props.canSimulate ? <ScenarioWorkspace scenario={props.scenario} simulation={props.simulation} busy={props.busy} onCompile={props.onCompile} onConfirm={props.onConfirm} onSimulate={props.onSimulate} /> : <StatePanel type="denied" title="Scenario capability is not delegated" description="The active Beacon Works membership is read-only. Tenant switching never expands authority." />;
    case "action": return props.canPropose ? <ActionWorkspace preview={props.preview} approval={props.approval} receipt={props.receipt} compensation={props.compensation} busy={props.busy} onPreview={props.onPreview} onRequestApproval={props.onRequestApproval} onApprove={props.onApprove} onExecute={props.onExecute} onReplay={props.onReplay} onPreviewCompensation={props.onPreviewCompensation} onApproveCompensation={props.onApproveCompensation} onCompensate={props.onCompensate} /> : <StatePanel type="denied" title="External action is not authorized" description="The active membership cannot propose or execute Jira changes. No mutation controls or hidden payload values are exposed." />;
  }
}

function InitialLoading() {
  return (
    <div className="initial-loading" aria-busy="true" aria-label="Loading Digital Twin">
      <aside><div className="brand-lockup"><span className="brand-mark">DT</span><div><strong>Digital Twin</strong><span>Enterprise control plane</span></div></div>{Array.from({ length: navigation.length }, (_, index) => <span className="loading-nav" key={index} />)}</aside>
      <main><Skeleton lines={2} /><div className="loading-grid"><Skeleton lines={4} /><Skeleton lines={4} /></div><Skeleton lines={5} /></main>
    </div>
  );
}

function DemoLoading() {
  return <div className="demo-loading"><div className="loading-grid"><Skeleton lines={4} /><Skeleton lines={3} /></div><Skeleton lines={5} /></div>;
}

function toMessage(error: unknown) {
  if (error instanceof ApiProblem) return `${error.message}${error.retryable ? " You can retry safely." : ""}`;
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}

function isDemoAuthLocked(error: unknown): error is ApiProblem {
  return error instanceof ApiProblem && error.status === 401 && error.code === "demo_auth_locked";
}
