"use client";

import { useState } from "react";
import type { ScenarioDraft, SimulationComparison } from "@/lib/api/types";
import { formatDate, formatDateTime, formatPercent } from "@/lib/format";
import { Button, DefinitionList, Hash, Panel, StatePanel, StatusPill } from "./ui";

export function ScenarioWorkspace({
  scenario,
  simulation,
  busy,
  onCompile,
  onConfirm,
  onSimulate,
}: {
  scenario?: ScenarioDraft;
  simulation?: SimulationComparison;
  busy: string | null;
  onCompile: (delta: number) => Promise<void>;
  onConfirm: () => Promise<void>;
  onSimulate: () => Promise<void>;
}) {
  const [delta, setDelta] = useState(-5);
  const [digestConfirmed, setDigestConfirmed] = useState(false);

  return (
    <div className="scenario-stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Reproducible what-if planning</p>
          <h1>Shift the work, not the facts</h1>
          <p>Compile one typed intervention against a sealed evidence snapshot, confirm its digest, then compare the seeded distributions.</p>
        </div>
        <StatusPill tone="violet">PERT / Monte Carlo</StatusPill>
      </div>

      <div className="scenario-grid">
        <Panel className="scenario-builder">
          <header className="panel-header">
            <div><p className="eyebrow">Step 1</p><h2>Scenario draft</h2></div>
            {scenario ? <StatusPill tone={scenario.status === "confirmed" ? "positive" : "neutral"}>{scenario.status === "confirmed" ? "Locked" : "Mutable draft"}</StatusPill> : null}
          </header>

          <fieldset disabled={scenario?.status === "confirmed"}>
            <legend className="visually-hidden">Scenario intervention</legend>
            <label className="field-label" htmlFor="work-item">Work item</label>
            <div className="select-display" id="work-item"><span className="jira-mini">JI</span><strong>AST-142</strong><span>Complete SSO cutover</span></div>
            <label className="field-label" htmlFor="delta">Shift completion distribution</label>
            <div className="number-field">
              <input id="delta" type="number" min="-10" max="-1" value={delta} onChange={(event) => setDelta(Number(event.target.value))} />
              <span>workdays</span>
            </div>
            <p className="field-help">Negative values shift all three PERT duration points earlier. No person-level productivity assumption is created.</p>
            <Button type="button" variant="secondary" busy={busy === "compile"} onClick={() => void onCompile(delta)} disabled={delta > -1 || delta < -10}>
              Compile exact draft
            </Button>
          </fieldset>

          {scenario ? (
            <div className="compiled-draft">
              <div className="compiled-title"><span aria-hidden="true">{scenario.status === "confirmed" ? "▣" : "◫"}</span><div><strong>{scenario.name}</strong><p>Compiled against snapshot {formatDateTime(scenario.snapshotAsOf)}</p></div></div>
              <DefinitionList rows={[
                { label: "Intervention", value: `${scenario.intervention.deltaWorkdays} workdays on ${scenario.intervention.workItemKey}` },
                { label: "Model", value: scenario.modelVersion },
                { label: "Samples", value: scenario.sampleCount.toLocaleString() },
                { label: "Seed", value: <code>{scenario.seed}</code> },
                { label: "Snapshot", value: <Hash value={scenario.basedOnSnapshot} /> },
                { label: "Scenario digest", value: <Hash value={scenario.digest} /> },
              ]} />
              <details className="assumption-details"><summary>Review {scenario.assumptions.length} assumptions</summary><ul>{scenario.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></details>
            </div>
          ) : null}
        </Panel>

        <Panel className="confirmation-panel">
          <header><p className="eyebrow">Step 2</p><h2>Confirm immutable input</h2></header>
          {!scenario ? (
            <StatePanel type="empty" title="Compile a draft first" description="Confirmation binds the exact snapshot, intervention, seed, model, and digest." />
          ) : scenario.status === "confirmed" ? (
            <div className="confirmation-complete">
              <span className="complete-mark" aria-hidden="true">✓</span>
              <h3>Scenario sealed</h3>
              <p>Confirmed {scenario.confirmedAt ? formatDateTime(scenario.confirmedAt) : "now"}. Further edits require a new scenario ID and digest.</p>
              <Hash value={scenario.digest} />
              <Button busy={busy === "simulate"} onClick={() => void onSimulate()}>Run 50,000 samples <span aria-hidden="true">→</span></Button>
            </div>
          ) : (
            <div className="confirmation-form">
              <div className="digest-box"><span>Exact scenario digest</span><code>{scenario.digest}</code></div>
              <label className="check-row">
                <input type="checkbox" checked={digestConfirmed} onChange={(event) => setDigestConfirmed(event.target.checked)} />
                <span>I confirm this exact digest and understand the scenario becomes immutable.</span>
              </label>
              <Button busy={busy === "confirm"} disabled={!digestConfirmed} onClick={() => void onConfirm()}>Confirm and lock scenario</Button>
              <p className="field-help">The API uses <code>If-Match: {scenario.etag}</code> to reject concurrent edits.</p>
            </div>
          )}
        </Panel>
      </div>

      {simulation ? <SimulationResults result={simulation} /> : (
        <Panel className="simulation-placeholder"><div className="placeholder-chart" aria-hidden="true"><span/><span/><span/><span/></div><div><p className="eyebrow">Step 3</p><h2>Baseline versus scenario</h2><p>Simulation results appear only after the exact draft is confirmed and executed with its frozen seed.</p></div></Panel>
      )}
    </div>
  );
}

function SimulationResults({ result }: { result: SimulationComparison }) {
  const quantiles = ["p50", "p80", "p95"] as const;
  return (
    <Panel className="simulation-results" aria-labelledby="simulation-heading">
      <header className="simulation-results-header">
        <div><p className="eyebrow">Step 3 · Run complete</p><h2 id="simulation-heading">A five-day p80 improvement</h2><p>Scenario beats baseline in {formatPercent(result.probabilityOfImprovement)} of paired seeded samples.</p></div>
        <div className="run-stamp"><StatusPill tone="positive">Reproducible</StatusPill><span>Seed {result.seed}</span><span>{result.sampleCount.toLocaleString()} samples</span></div>
      </header>

      <div className="forecast-grid">
        {quantiles.map((quantile) => (
          <article className={`forecast-card forecast-${quantile}`} key={quantile}>
            <div className="forecast-label"><strong>{quantile.toUpperCase()}</strong><StatusPill tone="positive">{result.deltaDays[quantile]} days</StatusPill></div>
            <div className="date-compare"><div><span>Baseline</span><strong>{formatDate(result.baseline[quantile])}</strong></div><span className="date-arrow" aria-hidden="true">→</span><div><span>Scenario</span><strong>{formatDate(result.scenario[quantile])}</strong></div></div>
            <div className="distribution-track" aria-hidden="true"><span className="baseline-point"/><span className="scenario-point"/></div>
          </article>
        ))}
      </div>

      <div className="simulation-detail-grid">
        <div>
          <h3>Critical-path probability</h3>
          <div className="criticality-list">
            {result.scenarioCriticalPath.map((item) => (
              <div className="criticality-row" key={item.key}>
                <div><strong>{item.key}</strong><span>{item.title}</span></div>
                <div className="meter"><span style={{ width: `${item.criticality * 100}%` }} /></div>
                <strong>{formatPercent(item.criticality)}</strong>
                <StatusPill tone="positive">{Math.round((item.change ?? 0) * 100)} pts</StatusPill>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3>Sensitivity drivers</h3>
          <ol className="sensitivity-list">
            {result.sensitivity.map((item, index) => <li key={item.key}><span>{index + 1}</span><div><strong>{item.label}</strong><div className="meter"><span style={{ width: `${item.score * 100}%` }} /></div></div><strong>{item.score.toFixed(2)}</strong></li>)}
          </ol>
        </div>
      </div>
      <div className="warning-row"><div><strong>Uncertainty remains visible</strong><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div><div className="result-hash"><span>Canonical result</span><Hash value={result.resultHash} /></div></div>
    </Panel>
  );
}
