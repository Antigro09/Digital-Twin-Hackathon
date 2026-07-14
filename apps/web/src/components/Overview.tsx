import type { CitedAnswer, ConnectorHealth, GraphResult } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { Panel, StatusPill } from "./ui";

export function Overview({
  graph,
  answer,
  connectors,
  onNavigate,
}: {
  graph: GraphResult;
  answer: CitedAnswer;
  connectors: ConnectorHealth[];
  onNavigate: (view: "graph" | "copilot" | "scenario" | "action") => void;
}) {
  const hasData = graph.nodes.length > 0;
  return (
    <div className="overview-stack">
      <section className="hero-grid">
        <Panel className="launch-hero">
          <div className="hero-topline"><p className="eyebrow">Orion 2.0 · General availability</p><StatusPill tone={hasData ? "warning" : "neutral"}>{hasData ? "At risk" : "No authorized assessment"}</StatusPill></div>
          <h1>{hasData ? "One dependency chain is shaping the launch." : "Launch posture is unavailable."}</h1>
          <p>{hasData ? "AST-142 is the strongest recorded blocker. Its unfinished identity review flows through the release candidate and certification gate." : "This membership has no current Jira evidence after authorization revocation. No cached launch conclusion is shown."}</p>
          {hasData ? (
            <div className="hero-path" aria-label="Critical path summary">
              <span>PR #184</span><i aria-hidden="true">→</i><span>AST-142</span><i aria-hidden="true">→</i><span>AST-173</span><i aria-hidden="true">→</i><span>AST-201</span><i aria-hidden="true">→</i><strong>Orion GA</strong>
            </div>
          ) : null}
          <div className="hero-actions">
            <button className="text-action" onClick={() => onNavigate("graph")}>Explore the evidence graph <span aria-hidden="true">→</span></button>
            <button className="text-action text-action-muted" onClick={() => onNavigate("copilot")}>Inspect cited analysis</button>
          </div>
        </Panel>

        <Panel className="risk-scorecard">
          <p className="eyebrow">Grounded signal</p>
          <div className="risk-ring" aria-label={hasData ? "High confidence launch risk" : "No score"}><span>{hasData ? "High" : "—"}</span><small>{hasData ? "confidence" : "withheld"}</small></div>
          <div className="scorecard-stats"><div><strong>{hasData ? "4" : "0"}</strong><span>cited sources</span></div><div><strong>{hasData ? "3" : "0"}</strong><span>unknowns shown</span></div><div><strong>{hasData ? "0" : "1"}</strong><span>unsafe claims</span></div></div>
        </Panel>
      </section>

      <section aria-labelledby="journey-heading">
        <div className="section-title-row"><div><p className="eyebrow">Hackathon control path</p><h2 id="journey-heading">From read-only evidence to one governed action</h2></div><span className="subtle">Synthetic fixture · frozen 13 Jul 2026</span></div>
        <div className="journey-grid">
          <JourneyCard step="01" title="Resolve the graph" detail="Permission-aware GitHub + Jira claims" status={hasData ? "Ready" : "Revoked"} onClick={() => onNavigate("graph")} />
          <JourneyCard step="02" title="Explain the risk" detail="Citations, missing data, abstention" status={answer.confidence === "abstained" ? "Abstained" : "Cited"} onClick={() => onNavigate("copilot")} />
          <JourneyCard step="03" title="Simulate a shift" detail="50k seeded PERT samples" status={hasData ? "Ready" : "Unavailable"} onClick={() => onNavigate("scenario")} />
          <JourneyCard step="04" title="Govern the write" detail="Exact diff, dual approval, rollback" status={hasData ? "Protected" : "Denied"} onClick={() => onNavigate("action")} />
        </div>
      </section>

      <div className="overview-lower-grid">
        <Panel className="connector-panel">
          <div className="panel-header"><div><p className="eyebrow">Source posture</p><h2>Connector freshness</h2></div><StatusPill tone={connectors.some((item) => item.state === "revoked") ? "danger" : "positive"}>{connectors.some((item) => item.state === "revoked") ? "Action needed" : "Within 15 min SLO"}</StatusPill></div>
          <div className="connector-list">
            {connectors.map((connector) => (
              <article key={connector.provider}>
                <span className={`source-mark source-${connector.provider.toLowerCase()}`} aria-hidden="true">{connector.provider === "GitHub" ? "GH" : "JI"}</span>
                <div><strong>{connector.provider}</strong><p>{connector.detail}</p><span>Synced {formatDateTime(connector.lastSyncedAt)}</span></div>
                <StatusPill tone={connector.state === "healthy" ? "positive" : connector.state === "stale" ? "warning" : "danger"}>{connector.state}</StatusPill>
              </article>
            ))}
          </div>
        </Panel>

        <Panel className="guardrail-panel">
          <p className="eyebrow">Active guardrails</p><h2>Autonomy stops at the boundary</h2>
          <ul className="guardrail-list">
            <li><span aria-hidden="true">✓</span><div><strong>Reads and simulation</strong><p>Autonomous within delegated source permissions.</p></div></li>
            <li><span aria-hidden="true">✓</span><div><strong>Exact payload binding</strong><p>Any mutation changes the hash and voids approval.</p></div></li>
            <li><span aria-hidden="true">✓</span><div><strong>Two-person control</strong><p>Operations and security use distinct identities.</p></div></li>
            <li><span aria-hidden="true">✓</span><div><strong>No workforce scoring</strong><p>Individual performance inference is excluded.</p></div></li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function JourneyCard({ step, title, detail, status, onClick }: { step: string; title: string; detail: string; status: string; onClick: () => void }) {
  return (
    <button className="journey-card" onClick={onClick}>
      <span className="journey-step">{step}</span><div><strong>{title}</strong><p>{detail}</p></div><span className="journey-status">{status} <i aria-hidden="true">→</i></span>
    </button>
  );
}
