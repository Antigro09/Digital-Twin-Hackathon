"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AssetCommand,
  AssetCommandPreview,
  AssetCommandReceipt,
  AssetComponent,
  AssetSummary,
  AssetTelemetry,
  AssetTelemetryMetric,
  AssetTelemetrySignal,
  AssetTwinSnapshot,
  DigitalTwinApi,
  LifecycleEvent,
  TelemetryPoint,
} from "@/lib/api/types";
import { formatDate, formatDateTime, formatPercent } from "@/lib/format";
import { Button, DefinitionList, Hash, Panel, Skeleton, StatePanel, StatusPill } from "./ui";

type CommandType = AssetCommand["type"];
const metricDefinitions: Array<{
  key: AssetTelemetryMetric;
  decimals: number;
}> = [
  { key: "temperatureC", decimals: 1 },
  { key: "pressureBar", decimals: 2 },
  { key: "vibrationMmS", decimals: 2 },
  { key: "flowM3H", decimals: 1 },
  { key: "motorCurrentA", decimals: 1 },
  { key: "speedRpm", decimals: 0 },
];

const commandLabels: Record<CommandType, string> = {
  set_speed_pct: "Set drive speed",
  set_valve_pct: "Set discharge valve",
  emergency_stop: "Emergency stop",
  reset: "Reset safety trip",
};

export function AssetTwin({ api }: { api: DigitalTwinApi }) {
  const [assets, setAssets] = useState<AssetSummary[]>();
  const [assetId, setAssetId] = useState<string>();
  const [twin, setTwin] = useState<AssetTwinSnapshot>();
  const [telemetry, setTelemetry] = useState<AssetTelemetry>();
  const [selectedComponentId, setSelectedComponentId] = useState("bearing");
  const [selectedLifecycleId, setSelectedLifecycleId] = useState<string>();
  const [rotation, setRotation] = useState(-7);
  const [livePaused, setLivePaused] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [pollFailures, setPollFailures] = useState(0);
  const [streamStopped, setStreamStopped] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [commandType, setCommandType] = useState<CommandType>("set_speed_pct");
  const [speedPct, setSpeedPct] = useState(90);
  const [valvePct, setValvePct] = useState(78);
  const [preview, setPreview] = useState<AssetCommandPreview>();
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState<AssetCommandReceipt>();
  const [announcement, setAnnouncement] = useState("");
  const pollAbortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(!document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (!pageVisible) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pageVisible]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await api.getAssets(controller.signal);
        setAssets(result);
        setAssetId(result[0]?.assetId);
      } catch (error) {
        if (!controller.signal.aborted) setProblem(toMessage(error));
      }
    })();
    return () => controller.abort();
  }, [api]);

  const loadAsset = useCallback(async (nextAssetId: string, signal?: AbortSignal) => {
    setBusy("asset");
    setProblem(undefined);
    try {
      const [nextTwin, nextTelemetry] = await Promise.all([
        api.getAssetTwin(nextAssetId, signal),
        api.getAssetTelemetry(nextAssetId, 20, signal),
      ]);
      setTwin(nextTwin);
      setTelemetry(nextTelemetry);
      setSelectedComponentId(nextTwin.components.find((component) => component.status !== "normal")?.componentId ?? nextTwin.components[0]?.componentId ?? "");
      setSelectedLifecycleId(nextTwin.lifecycle.find((event) => event.status === "current")?.eventId ?? nextTwin.lifecycle[0]?.eventId);
      setSpeedPct(nextTwin.control.state.speedPct || 90);
      setValvePct(nextTwin.control.state.valvePct || 78);
      setPreview(undefined);
      setReceipt(undefined);
      setConfirmed(false);
      setPollFailures(0);
      setStreamStopped(false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setProblem(toMessage(error));
    } finally {
      setBusy(undefined);
    }
  }, [api]);

  useEffect(() => {
    if (!assetId) return;
    const controller = new AbortController();
    void loadAsset(assetId, controller.signal);
    return () => controller.abort();
  }, [assetId, loadAsset]);

  useEffect(() => {
    if (!assetId || livePaused || !twin || !pageVisible || streamStopped) return;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      const controller = new AbortController();
      pollAbortRef.current = controller;
      void api.getAssetTelemetry(assetId, 1, controller.signal)
        .then(async (result) => {
          const refreshedTwin = await api.getAssetTwin(assetId, controller.signal);
          setTelemetry((current) => mergeTelemetry(current, result));
          setTwin(refreshedTwin);
          setPollFailures(0);
          setClockNow(Date.now());
          setAnnouncement(`Telemetry updated at ${formatDateTime(result.sampledAt)}.`);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setPollFailures((current) => {
            const next = current + 1;
            if (next >= 3) {
              setStreamStopped(true);
              setProblem("Telemetry paused after three consecutive refresh failures. Review connectivity, then retry explicitly.");
            } else {
              setAnnouncement(`Telemetry refresh failed (${next} of 3); the last complete sample remains visible.`);
            }
            return next;
          });
        })
        .finally(() => {
          if (pollAbortRef.current === controller) pollAbortRef.current = undefined;
          polling = false;
        });
    }, Math.max(1, telemetry?.intervalSeconds ?? 5) * 1_000);
    return () => {
      window.clearInterval(timer);
      pollAbortRef.current?.abort();
      pollAbortRef.current = undefined;
    };
  }, [api, assetId, livePaused, pageVisible, streamStopped, telemetry?.intervalSeconds, twin]);

  const selectedComponent = twin?.components.find((component) => component.componentId === selectedComponentId);
  const selectedLifecycle = twin?.lifecycle.find((event) => event.eventId === selectedLifecycleId);
  const canControl = assets?.find((asset) => asset.assetId === assetId)?.canControl ?? false;
  const receivedAgeSeconds = telemetry ? Math.max(0, Math.floor((clockNow - Date.parse(telemetry.receivedAt)) / 1_000)) : 0;

  const command = useMemo<AssetCommand>(() => {
    if (commandType === "set_speed_pct") return { type: commandType, value: speedPct };
    if (commandType === "set_valve_pct") return { type: commandType, value: valvePct };
    return { type: commandType };
  }, [commandType, speedPct, valvePct]);

  function invalidatePreview() {
    setPreview(undefined);
    setReceipt(undefined);
    setConfirmed(false);
  }

  async function previewCommand() {
    if (!assetId) return;
    setBusy("preview");
    setProblem(undefined);
    try {
      const result = await api.previewAssetCommand(assetId, command);
      setPreview(result);
      setReceipt(undefined);
      setConfirmed(false);
      setAnnouncement("Exact synthetic control command preview is ready for confirmation.");
    } catch (error) {
      setProblem(toMessage(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function executeCommand() {
    if (!assetId || !preview) return;
    setBusy("execute");
    setProblem(undefined);
    try {
      const result = await api.executeAssetCommand(assetId, preview.previewId, preview.payloadHash, `edt-asset-${preview.previewId}`);
      setReceipt(result);
      setTwin((current) => current ? {
        ...current,
        asset: { ...current.asset, version: result.assetVersionAfter, status: preview.predictedState.status },
        control: { ...current.control, state: preview.predictedState },
      } : current);
      setAnnouncement(result.replayed ? "Replay returned the original command receipt." : "Synthetic control command executed once.");
    } catch (error) {
      setProblem(toMessage(error));
    } finally {
      setBusy(undefined);
    }
  }

  if (!assets) return <div className="asset-twin-loading"><Skeleton lines={7} /><Skeleton lines={9} /></div>;
  if (assets.length === 0) {
    return <StatePanel type="empty" title="No physical assets in this tenant scope" description="This membership has no authorized industrial assets. Asset identifiers and telemetry from other tenants are not disclosed." />;
  }

  return (
    <div className="asset-twin-stack">
      <div className="live-announcement" aria-live="polite">{announcement}</div>
      <header className="section-heading asset-heading">
        <div>
          <p className="eyebrow">Physical operations · synthetic sandbox</p>
          <h1>Interactive asset twin</h1>
          <p>Explore the pump, watch deterministic sensor telemetry, inspect failure evidence, follow its lifecycle, and safely rehearse control commands.</p>
        </div>
        <label className="asset-selector" htmlFor="asset-selector">
          <span>Synthetic asset</span>
          <select id="asset-selector" value={assetId} onChange={(event) => setAssetId(event.target.value)}>
            {assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name} · {asset.site}</option>)}
          </select>
        </label>
      </header>

      <div className="asset-sandbox-banner" role="note">
        <span aria-hidden="true">◇</span>
        <div><strong>Simulation boundary</strong><p>This twin uses synthetic telemetry. Commands update the simulation only—no PLC, pump, or external actuator is connected.</p></div>
        <StatusPill tone="violet">No external write</StatusPill>
      </div>

      {problem ? <div className="asset-inline-error" role="alert"><strong>Operation did not complete.</strong><span>{problem}</span><button type="button" onClick={() => setProblem(undefined)} aria-label="Dismiss asset error">×</button></div> : null}

      {busy === "asset" || !twin || !telemetry ? (
        <div className="asset-twin-loading"><Skeleton lines={7} /><Skeleton lines={9} /></div>
      ) : (
        <>
          <div className="asset-hero-grid">
            <Panel className="asset-visual-panel">
              <div className="asset-panel-heading">
                <div>
                  <div className="asset-title-line"><h2>{twin.asset.name}</h2><StatusPill tone={twin.asset.status === "running" ? "positive" : "warning"}>{twin.asset.status}</StatusPill></div>
                  <p>{twin.asset.model} · {twin.asset.serialNumber} · version {twin.control.state.version}</p>
                </div>
                <div className="rotation-controls" aria-label="Asset view controls">
                  <Button variant="secondary" onClick={() => setRotation((value) => clampRotation(value - 12))} aria-label="Rotate asset left">↶</Button>
                  <Button variant="secondary" onClick={() => setRotation(-7)}>Reset view</Button>
                  <Button variant="secondary" onClick={() => setRotation((value) => clampRotation(value + 12))} aria-label="Rotate asset right">↷</Button>
                </div>
              </div>
              <PumpVisualization
                components={twin.components}
                selectedId={selectedComponentId}
                rotation={rotation}
                onRotation={setRotation}
                onSelect={(componentId) => {
                  setSelectedComponentId(componentId);
                  const component = twin.components.find((item) => item.componentId === componentId);
                  setAnnouncement(`${component?.name ?? "Asset component"} selected.`);
                }}
              />
              <div className="asset-component-list" aria-label="Pump components">
                {twin.components.map((component) => (
                  <button
                    type="button"
                    key={component.componentId}
                    className={component.componentId === selectedComponentId ? "asset-component-chip selected" : "asset-component-chip"}
                    aria-pressed={component.componentId === selectedComponentId}
                    onClick={() => setSelectedComponentId(component.componentId)}
                  >
                    <span className={`component-dot component-dot-${component.status}`} aria-hidden="true" />
                    {component.name}
                  </button>
                ))}
              </div>
              <p className="asset-visual-help">Drag horizontally or use Left/Right arrow keys to rotate. Select a highlighted component to inspect it.</p>
            </Panel>

            <Panel className="component-inspector" aria-live="polite">
              <p className="eyebrow">Selected component</p>
              {selectedComponent ? (
                <>
                  <div className="component-heading">
                    <span className={`component-symbol component-${selectedComponent.status}`} aria-hidden="true">{componentGlyph(selectedComponent.kind)}</span>
                    <div><h2>{selectedComponent.name}</h2><StatusPill tone={componentTone(selectedComponent)}>{selectedComponent.status}</StatusPill></div>
                  </div>
                  <p className="component-description">{selectedComponent.description}</p>
                  <DefinitionList rows={[
                    { label: "Component ID", value: selectedComponent.componentId },
                    { label: "Sensor tags", value: selectedComponent.sensorTags.join(", ") || "No direct sensor" },
                    { label: "Latest sample", value: formatDateTime(telemetry.sampledAt) },
                    { label: "Twin projection", value: formatDateTime(twin.projectionAsOf) },
                  ]} />
                  {twin.predictions.some((prediction) => prediction.componentId === selectedComponent.componentId) ? (
                    <div className="component-anomaly-link"><span aria-hidden="true">!</span><p><strong>Analytics signal attached</strong>Select the matching prediction below for its evidence and limitations.</p></div>
                  ) : <div className="component-normal-note"><span aria-hidden="true">✓</span> No active synthetic anomaly attached to this component.</div>}
                </>
              ) : <p>Select a component in the asset view.</p>}
            </Panel>
          </div>

          <section aria-labelledby="telemetry-heading">
            <div className="section-title-row asset-section-title">
                <div><p className="eyebrow">Synthetic telemetry</p><h2 id="telemetry-heading">Live simulator telemetry</h2></div>
              <div className="telemetry-toolbar">
                <span className={livePaused || !pageVisible || streamStopped ? "telemetry-state paused" : "telemetry-state"}><i aria-hidden="true" />{
                  streamStopped ? `Stopped after ${pollFailures} failures`
                    : !pageVisible ? "Hidden tab paused"
                      : livePaused ? "Paused by operator"
                        : `Updating every ${telemetry.intervalSeconds} seconds`
                }</span>
                <span>Received {formatAge(receivedAgeSeconds)} ago · simulated {formatDateTime(telemetry.sampledAt)}</span>
                {streamStopped ? (
                  <Button variant="secondary" onClick={() => { setProblem(undefined); setPollFailures(0); setStreamStopped(false); setLivePaused(false); }}>Retry stream</Button>
                ) : (
                  <Button variant="secondary" onClick={() => setLivePaused((value) => !value)}>{livePaused ? "Resume stream" : "Pause stream"}</Button>
                )}
              </div>
            </div>
            <div className="telemetry-grid">
              {metricDefinitions.map((metric) => <MetricChart key={metric.key} metric={metric} signal={telemetry.signals[metric.key]} points={telemetry.points} />)}
            </div>
          </section>

          <section className="analytics-grid" aria-labelledby="prediction-heading">
            <div>
              <div className="section-title-row asset-section-title">
                <div><p className="eyebrow">Predictive analytics</p><h2 id="prediction-heading">Anomalies and failure outlook</h2></div>
                <StatusPill tone="info">Synthetic model</StatusPill>
              </div>
              <div className="prediction-list">
                {twin.predictions.map((prediction) => (
                  <Panel className={`prediction-card prediction-${prediction.severity}`} key={prediction.predictionId}>
                    <button type="button" className="prediction-select" onClick={() => setSelectedComponentId(prediction.componentId)}>
                      <span className="prediction-score"><strong>{formatPercent(prediction.confidence)}</strong><small>confidence</small></span>
                      <span><span className="prediction-title-line"><strong>{prediction.title}</strong><StatusPill tone={prediction.severity === "critical" ? "danger" : prediction.severity === "warning" ? "warning" : "info"}>{prediction.severity}</StatusPill></span><small>{prediction.horizonLabel} · select component</small></span>
                    </button>
                    <p>{prediction.explanation}</p>
                    <ul>{prediction.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
                    <div className="prediction-recommendation"><strong>Recommended response</strong><p>{prediction.recommendation}</p></div>
                    <details><summary>Model and confidence context</summary><p>{prediction.modelVersion} · generated {formatDateTime(prediction.generatedAt)}. Confidence is a synthetic model-fit indicator, not a calibrated failure probability.</p></details>
                  </Panel>
                ))}
              </div>
            </div>

            <Panel className="asset-facts-panel">
              <p className="eyebrow">Asset passport</p>
              <h2>Design and service context</h2>
              <DefinitionList rows={[
                { label: "Manufacturer", value: twin.asset.manufacturer },
                { label: "Installed", value: twin.asset.installedAt ? formatDate(twin.asset.installedAt) : "Not recorded" },
                { label: "Design flow", value: twin.asset.designFlowM3H ? `${twin.asset.designFlowM3H} m³/h` : "Not recorded" },
                { label: "Design head", value: twin.asset.designHeadM ? `${twin.asset.designHeadM} m` : "Not recorded" },
                { label: "Rated speed", value: `${twin.asset.ratedSpeedRpm} rpm` },
                { label: "Health score", value: `${twin.asset.healthScore}/100` },
              ]} />
              <div className="health-meter" aria-label={`Asset health score ${twin.asset.healthScore} out of 100`}><span style={{ width: `${twin.asset.healthScore}%` }} /></div>
              <p className="field-help">Health combines current synthetic alarms and model signals; it is not a manufacturer certification.</p>
            </Panel>
          </section>

          <section aria-labelledby="lifecycle-heading">
            <div className="section-title-row asset-section-title">
              <div><p className="eyebrow">Lifecycle management</p><h2 id="lifecycle-heading">From design to decommissioning</h2></div>
              <span className="subtle">Current stage: {twin.asset.lifecycleStage}</span>
            </div>
            <Panel className="lifecycle-panel">
              <div className="lifecycle-track" role="list" aria-label="Asset lifecycle stages">
                {twin.lifecycle.map((event, index) => (
                  <div role="listitem" key={event.eventId}>
                    <button
                      type="button"
                      className={`lifecycle-step lifecycle-${event.status} ${selectedLifecycleId === event.eventId ? "lifecycle-selected" : ""}`}
                      onClick={() => setSelectedLifecycleId(event.eventId)}
                      aria-pressed={selectedLifecycleId === event.eventId}
                    >
                      <span className="lifecycle-index">{event.status === "complete" ? "✓" : index + 1}</span>
                      <strong>{stageLabel(event.stage)}</strong>
                      <small>{event.date ? formatDate(event.date) : "Date pending"}</small>
                    </button>
                  </div>
                ))}
              </div>
              {selectedLifecycle ? <LifecycleDetail event={selectedLifecycle} /> : null}
            </Panel>
          </section>

          <section aria-labelledby="control-heading">
            <div className="section-title-row asset-section-title">
              <div><p className="eyebrow">Bidirectional control</p><h2 id="control-heading">Governed command rehearsal</h2></div>
              <div className="guardrail-badges"><StatusPill tone="positive">Exact preview</StatusPill><StatusPill tone="info">Version check</StatusPill><StatusPill tone="violet">Idempotent execution</StatusPill></div>
            </div>
            {!canControl ? (
              <StatePanel type="denied" title="Asset control is not delegated" description="This membership may inspect authorized asset data but cannot preview or execute control commands." />
            ) : (
              <div className="asset-control-grid">
                <Panel className="command-builder">
                  <div className="panel-header"><div><p className="eyebrow">1 · Compose</p><h2>Choose one bounded command</h2></div><StatusPill tone={twin.control.state.emergencyStopped ? "danger" : "positive"}>state v{twin.control.state.version}</StatusPill></div>
                  <label className="field-label" htmlFor="command-type">Command</label>
                  <select id="command-type" value={commandType} onChange={(event) => { setCommandType(event.target.value as CommandType); invalidatePreview(); }}>
                    {twin.control.supportedCommands.map((type) => <option key={type} value={type}>{commandLabels[type]}</option>)}
                  </select>
                  {commandType === "set_speed_pct" ? (
                    <label className="command-range"><span>Target drive speed <strong>{speedPct}%</strong></span><input type="range" min={twin.control.minSpeedPct} max={twin.control.maxSpeedPct} value={speedPct} onChange={(event) => { setSpeedPct(Number(event.target.value)); invalidatePreview(); }} /><small>{twin.control.minSpeedPct}% minimum · {twin.control.maxSpeedPct}% maximum · ≈ {Math.round(twin.asset.ratedSpeedRpm * speedPct / 100)} rpm</small></label>
                  ) : null}
                  {commandType === "set_valve_pct" ? (
                    <label className="command-range"><span>Target valve opening <strong>{valvePct}%</strong></span><input type="range" min={twin.control.minValvePct} max={twin.control.maxValvePct} value={valvePct} onChange={(event) => { setValvePct(Number(event.target.value)); invalidatePreview(); }} /><small>{twin.control.minValvePct}% minimum · {twin.control.maxValvePct}% maximum</small></label>
                  ) : null}
                  {commandType === "emergency_stop" ? <div className="command-danger-note"><strong>Emergency-stop rehearsal</strong><p>The simulation will set speed to zero and require a separately previewed reset. It does not actuate real equipment.</p></div> : null}
                  {commandType === "reset" ? <div className="command-info-note"><strong>Reset rehearsal</strong><p>Reset is accepted only while the synthetic emergency-stop state is active. It leaves the pump idle.</p></div> : null}
                  <DefinitionList rows={[
                    { label: "Current speed", value: `${twin.control.state.speedPct}%` },
                    { label: "Current valve", value: `${twin.control.state.valvePct}%` },
                    { label: "Emergency stop", value: twin.control.state.emergencyStopped ? "Active" : "Clear" },
                    { label: "Execution target", value: "Synthetic simulation only" },
                  ]} />
                  <Button onClick={() => void previewCommand()} busy={busy === "preview"}>Preview exact command</Button>
                </Panel>

                <Panel className="command-preview-panel">
                  {!preview ? (
                    <div className="command-empty"><span aria-hidden="true">↗</span><div><p className="eyebrow">2 · Verify</p><h2>No command preview yet</h2><p>Preview first to run envelope, state-version, scope, and simulation-boundary checks. Nothing executes from this form.</p></div></div>
                  ) : (
                    <>
                      <div className="panel-header"><div><p className="eyebrow">2 · Verify exact payload</p><h2>{commandLabels[preview.command.type]}</h2></div><StatusPill tone={preview.safetyChecks.every((check) => check.passed) ? "positive" : "danger"}>{preview.safetyChecks.filter((check) => check.passed).length}/{preview.safetyChecks.length} checks passed</StatusPill></div>
                      <div className="control-state-compare">
                        <ControlState title="Before" state={preview.currentState} />
                        <span aria-hidden="true">→</span>
                        <ControlState title="After simulation" state={preview.predictedState} />
                      </div>
                      <div className="safety-checks"><h3>Safety checks</h3>{preview.safetyChecks.map((check) => <div key={check.check} className={check.passed ? "check-passed" : "check-failed"}><span aria-hidden="true">{check.passed ? "✓" : "!"}</span><p><strong>{check.check}</strong>{check.detail}</p></div>)}</div>
                      <details className="command-payload"><summary>Inspect exact command payload</summary><pre><code>{JSON.stringify({ assetId: preview.assetId, command: preview.command, expectedVersion: preview.expectedAssetVersion, executionMode: preview.executionMode }, null, 2)}</code></pre></details>
                      <div className="command-proof"><span>Payload</span><Hash value={preview.payloadHash} /><span>Expires {formatDateTime(preview.expiresAt)}</span></div>
                      <label className="check-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I confirm this exact synthetic command, payload hash, and state version. I understand that it changes only the simulation.</span></label>
                      <Button variant={preview.command.type === "emergency_stop" ? "danger" : "primary"} disabled={!confirmed || !preview.safetyChecks.every((check) => check.passed)} busy={busy === "execute"} onClick={() => void executeCommand()}>Execute once in simulation</Button>
                      {preview.risks.length ? <ul className="command-risks">{preview.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul> : null}
                    </>
                  )}
                </Panel>
              </div>
            )}
            {receipt ? (
              <Panel className="asset-command-receipt">
                <span className="receipt-check" aria-hidden="true">✓</span>
                <div><p className="eyebrow">3 · Audited result</p><h2>{receipt.replayed ? "Replay returned the original receipt" : "Synthetic command executed once"}</h2><p>State advanced from version {receipt.assetVersionBefore} to {receipt.assetVersionAfter}. External write: <strong>no</strong>.</p></div>
                <DefinitionList rows={[
                  { label: "Receipt", value: receipt.receiptId },
                  { label: "Idempotency key", value: receipt.idempotencyKey },
                  { label: "Audit event", value: receipt.auditEventId },
                  { label: "Recorded", value: formatDateTime(receipt.executedAt) },
                ]} />
                <Button variant="secondary" busy={busy === "execute"} onClick={() => void executeCommand()}>Replay same idempotency key</Button>
              </Panel>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

function PumpVisualization({
  components,
  selectedId,
  rotation,
  onRotation,
  onSelect,
}: {
  components: AssetComponent[];
  selectedId: string;
  rotation: number;
  onRotation: (rotation: number) => void;
  onSelect: (componentId: string) => void;
}) {
  const drag = useRef<{ pointerId: number; x: number; rotation: number } | undefined>(undefined);
  const component = (kind: AssetComponent["kind"]) => components.find((item) => item.kind === kind);
  const partClass = (kind: AssetComponent["kind"]) => {
    const item = component(kind);
    return `pump-part ${item ? `pump-part-${item.status}` : "pump-part-unavailable"} ${item?.componentId === selectedId ? "pump-part-selected" : ""}`;
  };
  const select = (kind: AssetComponent["kind"]) => {
    const item = component(kind);
    if (item) onSelect(item.componentId);
  };
  const activate = (kind: AssetComponent["kind"]) => (event: React.KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(kind);
    }
  };
  const hotspot = (kind: AssetComponent["kind"]): React.SVGProps<SVGGElement> => {
    const item = component(kind);
    return {
      className: partClass(kind),
      role: item ? "button" : undefined,
      tabIndex: item ? 0 : undefined,
      "aria-label": item ? `${item.name}: ${item.status}` : undefined,
      "aria-hidden": item ? undefined : true,
      onClick: item ? () => select(kind) : undefined,
      onKeyDown: item ? activate(kind) : undefined,
    };
  };

  return (
    <svg
      className="pump-visualization"
      viewBox="0 0 760 380"
      role="application"
      aria-label={`Interactive three-dimensional-like centrifugal pump view, rotated ${Math.round(rotation)} degrees`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") { event.preventDefault(); onRotation(clampRotation(rotation - 5)); }
        if (event.key === "ArrowRight") { event.preventDefault(); onRotation(clampRotation(rotation + 5)); }
      }}
      onPointerDown={(event) => {
        drag.current = { pointerId: event.pointerId, x: event.clientX, rotation };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        onRotation(clampRotation(drag.current.rotation + (event.clientX - drag.current.x) * 0.28));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId === event.pointerId) drag.current = undefined;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = undefined; }}
    >
      <title>Centrifugal pump interactive component view</title>
      <desc>Drag horizontally or use arrow keys to rotate. Tab to the motor, shaft, bearing, seal, casing, impeller, valve, and any available inlet to select them.</desc>
      <defs>
        <linearGradient id="pump-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d8e2dd" /><stop offset=".55" stopColor="#789188" /><stop offset="1" stopColor="#36544b" /></linearGradient>
        <linearGradient id="pump-green" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6ea693" /><stop offset=".5" stopColor="#276b5b" /><stop offset="1" stopColor="#17483e" /></linearGradient>
        <linearGradient id="pump-dark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#344c45" /><stop offset="1" stopColor="#142a24" /></linearGradient>
        <filter id="pump-shadow" x="-20%" y="-30%" width="150%" height="170%"><feDropShadow dx="0" dy="14" stdDeviation="10" floodColor="#17342c" floodOpacity=".24" /></filter>
      </defs>
      <g className="asset-grid-lines" aria-hidden="true">
        {Array.from({ length: 15 }, (_, index) => <path key={`v-${index}`} d={`M${index * 55 - 10} 310 L${index * 55 + 160} 375`} />)}
        {Array.from({ length: 7 }, (_, index) => <path key={`h-${index}`} d={`M20 ${300 + index * 12} L740 ${300 + index * 12}`} />)}
      </g>
      <ellipse className="pump-floor-shadow" cx="385" cy="321" rx="290" ry="34" aria-hidden="true" />
      <g filter="url(#pump-shadow)" transform={`translate(380 195) rotate(${rotation}) skewX(-3) translate(-380 -195)`}>
        <path className="pump-base" d="M105 270 L585 270 L640 302 L158 302 Z" aria-hidden="true" />
        <path className="pump-base-top" d="M115 258 L582 258 L616 277 L150 277 Z" aria-hidden="true" />

        <g {...hotspot("motor")}>
          <path d="M128 142 L294 142 L319 158 L319 243 L294 259 L128 259 L105 242 L105 160 Z" fill="url(#pump-green)" />
          <path d="M128 142 L294 142 L319 158 L151 159 Z" className="pump-highlight" />
          <ellipse cx="117" cy="200" rx="26" ry="50" fill="url(#pump-dark)" />
          {Array.from({ length: 6 }, (_, index) => <path key={index} d={`M150 ${158 + index * 15} L290 ${158 + index * 15}`} className="motor-fin" />)}
          <path d="M176 126 L249 126 L264 142 L161 142 Z" fill="url(#pump-dark)" />
          <circle cx="118" cy="200" r="8" className="pump-detail" />
        </g>

        <g {...hotspot("shaft")}>
          <path d="M313 178 L370 178 L382 188 L382 225 L370 235 L313 235 Z" fill="url(#pump-dark)" />
          <path d="M325 184 L360 184 L369 192 L369 221 L360 229 L325 229 Z" className="coupling-guard" />
          <path d="M319 207 L377 207" className="shaft-line" />
        </g>

        <g {...hotspot("bearing")}>
          <path d="M380 174 L423 174 L438 188 L438 236 L423 249 L380 249 L368 236 L368 188 Z" fill="url(#pump-metal)" />
          <circle cx="402" cy="210" r="18" fill="url(#pump-dark)" />
          <circle cx="402" cy="210" r="7" className="pump-detail" />
          {component("bearing")?.status !== "normal" ? <g className="anomaly-beacon" aria-hidden="true"><circle cx="420" cy="165" r="14" /><text x="420" y="170">!</text></g> : null}
        </g>

        <g {...hotspot("casing")}>
          <path d="M442 151 C482 121 559 131 578 184 C598 242 548 276 488 257 C444 243 425 190 442 151 Z" fill="url(#pump-green)" />
          <path d="M465 158 C495 139 543 146 555 184 C568 222 537 245 502 238 C466 231 449 184 465 158 Z" className="pump-casing-inner" />
          <path d="M522 151 L560 114 L599 114 L599 172 L568 187" fill="url(#pump-green)" />
        </g>

        <g {...hotspot("impeller")}>
          <circle cx="503" cy="199" r="29" fill="url(#pump-dark)" />
          <circle cx="503" cy="199" r="11" className="pump-detail" />
          <path d="M503 173 C516 185 516 213 503 225 C490 213 490 185 503 173 Z" className="impeller-blade" />
        </g>

        <g {...hotspot("seal")}>
          <ellipse cx="445" cy="207" rx="12" ry="24" fill="url(#pump-metal)" />
          <ellipse cx="445" cy="207" rx="5" ry="15" className="seal-ring" />
        </g>

        <g {...hotspot("inlet")}>
          <path d="M519 177 L656 177 L681 190 L681 218 L656 231 L519 231 Z" fill="url(#pump-metal)" />
          <ellipse cx="677" cy="204" rx="18" ry="31" fill="url(#pump-dark)" />
          <ellipse cx="677" cy="204" rx="10" ry="21" className="pipe-opening" />
        </g>

        <g {...hotspot("valve")}>
          <path d="M555 120 L555 73 L570 57 L607 57 L624 74 L624 121 Z" fill="url(#pump-metal)" />
          <ellipse cx="590" cy="61" rx="35" ry="13" fill="url(#pump-dark)" />
          <ellipse cx="590" cy="61" rx="23" ry="8" className="pipe-opening" />
        </g>

        <g className="pump-feet" aria-hidden="true"><path d="M151 258 L205 258 L196 283 L158 283 Z" /><path d="M494 252 L548 252 L557 283 L506 283 Z" /></g>
      </g>
      <g className="orientation-compass" transform="translate(692 306)" aria-hidden="true"><circle r="29" /><path d="M0 -21 L5 -5 L0 -9 L-5 -5 Z" /><text x="0" y="-12">N</text><text x="18" y="5">E</text></g>
    </svg>
  );
}

function MetricChart({ metric, signal, points }: { metric: typeof metricDefinitions[number]; signal: AssetTelemetrySignal; points: TelemetryPoint[] }) {
  const values = points.length ? points.map((point) => Number(point[metric.key])) : [0];
  const latest = values.at(-1) ?? 0;
  const warningThresholds = [
    signal.warningLow === undefined ? undefined : { label: "low", value: signal.warningLow },
    signal.warningHigh === undefined ? undefined : { label: "high", value: signal.warningHigh },
  ].filter((item): item is { label: string; value: number } => item !== undefined);
  const thresholdValues = warningThresholds.map((item) => item.value);
  const sampleMin = Math.min(...values);
  const sampleMax = Math.max(...values);
  const min = Math.min(...values, ...thresholdValues);
  const max = Math.max(...values, ...thresholdValues);
  const range = Math.max(max - min, Math.abs(max) * 0.04, 1);
  const timestamps = points.length
    ? points.map((point, index) => {
      const parsed = Date.parse(point.timestamp);
      return Number.isFinite(parsed) ? parsed : index;
    })
    : [0];
  const firstTimestamp = timestamps[0] ?? 0;
  const timestampSpan = Math.max(1, (timestamps.at(-1) ?? firstTimestamp) - firstTimestamp);
  const x = (index: number) => 9 + (((timestamps[index] ?? firstTimestamp) - firstTimestamp) / timestampSpan) * 222;
  const y = (value: number) => 69 - ((value - (min - range * 0.12)) / (range * 1.24)) * 55;
  const path = values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const attention = signal.status !== "normal";
  const thresholdSummary = warningThresholds.length
    ? ` Server warning limits: ${warningThresholds.map((item) => `${item.label} ${item.value} ${signal.unit}`).join(", ")}.`
    : " No warning limit is configured for this signal.";

  return (
    <Panel className={attention ? "telemetry-card telemetry-attention" : "telemetry-card"}>
      <div className="telemetry-card-header"><div><span>{signal.label} <small className="telemetry-provenance">{signal.valueKind}</small></span><strong>{latest.toFixed(metric.decimals)} <small>{signal.unit}</small></strong></div><StatusPill tone={signal.status === "critical" ? "danger" : attention ? "warning" : "positive"}>{signal.status}</StatusPill></div>
      <svg viewBox="0 0 240 82" role="img" aria-label={`${signal.label} trend, latest ${latest.toFixed(metric.decimals)} ${signal.unit}, ${signal.status}`}>
        <title>{signal.label} trend</title><desc>{values.length} timestamp-scaled samples from {points[0]?.timestamp ?? "an unknown time"} to {points.at(-1)?.timestamp ?? "an unknown time"}. Latest value is {latest.toFixed(metric.decimals)} {signal.unit}.{thresholdSummary}</desc>
        <path className="metric-grid" d="M9 15 H231 M9 42 H231 M9 69 H231" />
        {warningThresholds.map((threshold) => {
          const thresholdY = y(threshold.value);
          return <g key={threshold.label}><path className="metric-threshold" d={`M9 ${thresholdY.toFixed(1)} H231`} /><text className="metric-threshold-label" x="228" y={Math.max(10, thresholdY - 3)}>{threshold.label} {threshold.value}</text></g>;
        })}
        <path className="metric-area" d={`${path} L231 72 L9 72 Z`} />
        <path className="metric-line" d={path} />
        <circle className={attention ? "metric-point metric-point-attention" : "metric-point"} cx={x(values.length - 1)} cy={y(latest)} r="3.7" />
      </svg>
      <div className="telemetry-range"><span>{sampleMin.toFixed(metric.decimals)} sample min</span><span>{sampleMax.toFixed(metric.decimals)} sample max</span></div>
    </Panel>
  );
}

function LifecycleDetail({ event }: { event: LifecycleEvent }) {
  return (
    <div className="lifecycle-detail" aria-live="polite">
      <span className={`lifecycle-detail-mark lifecycle-${event.status}`} aria-hidden="true">{event.status === "complete" ? "✓" : event.status === "current" ? "●" : "○"}</span>
      <div><p className="eyebrow">{stageLabel(event.stage)} · {event.status}</p><h3>{event.title}</h3><p>{event.detail}</p></div>
      <DefinitionList rows={[{ label: "Date", value: event.date ? formatDate(event.date) : "Pending" }, { label: "Evidence", value: event.artifact ?? "No artifact attached" }]} />
    </div>
  );
}

function ControlState({ title, state }: { title: string; state: AssetCommandPreview["currentState"] }) {
  return (
    <div className="control-state-card"><div><strong>{title}</strong><span>version {state.version}</span></div><dl><div><dt>Speed</dt><dd>{state.speedPct}%</dd></div><div><dt>Valve</dt><dd>{state.valvePct}%</dd></div><div><dt>Trip</dt><dd>{state.emergencyStopped ? "Active" : "Clear"}</dd></div></dl></div>
  );
}

function componentTone(component: AssetComponent): "positive" | "warning" | "danger" {
  return component.status === "critical" ? "danger" : component.status === "attention" ? "warning" : "positive";
}

function componentGlyph(kind: AssetComponent["kind"]) {
  return ({ motor: "M", shaft: "S", bearing: "B", impeller: "I", casing: "C", seal: "⦿", valve: "V", inlet: "←" })[kind];
}

function stageLabel(stage: LifecycleEvent["stage"]) {
  return ({ design: "Design", manufacture: "Manufacture", commission: "Commission", operation: "Operation", service: "Service", maintenance: "Maintenance", decommission: "Decommission" })[stage];
}

function clampRotation(value: number) {
  return Math.max(-48, Math.min(48, value));
}

function formatAge(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 1) return "just now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "An unexpected asset-twin error occurred.";
}

function mergeTelemetry(current: AssetTelemetry | undefined, incoming: AssetTelemetry): AssetTelemetry {
  if (!current || current.assetId !== incoming.assetId) return incoming;
  const byTimestamp = new Map(current.points.map((point) => [point.timestamp, point]));
  incoming.points.forEach((point) => byTimestamp.set(point.timestamp, point));
  return { ...incoming, points: [...byTimestamp.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp)).slice(-20) };
}
