"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DigitalTwinApi,
  EventApproval,
  EventBranchComparison,
  EventDecisionReceipt,
  EventEffectOrder,
  EventImpactEdge,
  EventImpactNode,
  EventIntent,
  EventInterpretation,
  EventReview,
  EventReplay,
  EventScenarioBranch,
  EventTimelineEntry,
} from "@/lib/api/types";
import { ApiProblem } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { Button, DefinitionList, Hash, Panel, Skeleton, StatePanel, StatusPill } from "./ui";

type Selection = { type: "node"; value: EventImpactNode } | { type: "edge"; value: EventImpactEdge };

const examples = [
  "Sarah, the lead backend engineer, left the company today.",
  "Our AWS database experienced a 3-hour outage yesterday.",
  "We might lose our biggest customer because they are unhappy.",
];

const effectLanes: Array<{ order: EventEffectOrder; label: string; description: string }> = [
  { order: "event", label: "Event", description: "Reported change" },
  { order: "direct", label: "Direct", description: "Immediate state and relationship effects" },
  { order: "second", label: "2nd order", description: "Effects caused by direct changes" },
  { order: "third", label: "3rd order", description: "Downstream modeled effects" },
  { order: "long_term", label: "Long term", description: "Later mitigations or consequences" },
  { order: "unknown", label: "Unknown", description: "Not supported by current evidence" },
];

export function EventIntelligence({ api, canReview, canApply, sourceMode }: { api: DigitalTwinApi; canReview: boolean; canApply: boolean; sourceMode: DigitalTwinApi["sourceMode"] }) {
  const [input, setInput] = useState(examples[0]);
  const [intent, setIntent] = useState<EventIntent>("auto");
  const [interpretation, setInterpretation] = useState<EventInterpretation>();
  const [interpretationOptions, setInterpretationOptions] = useState<EventInterpretation[]>([]);
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection>();
  const [targetMode, setTargetMode] = useState<"reality" | "scenario">("reality");
  const [exactReviewConfirmed, setExactReviewConfirmed] = useState(false);
  const [review, setReview] = useState<EventReview>();
  const [approval, setApproval] = useState<EventApproval>();
  const [activeReceipt, setActiveReceipt] = useState<EventDecisionReceipt>();
  const [rollbackReceipt, setRollbackReceipt] = useState<EventDecisionReceipt>();
  const [timeline, setTimeline] = useState<EventTimelineEntry[]>([]);
  const [branches, setBranches] = useState<EventScenarioBranch[]>([]);
  const [selectedTimelineKey, setSelectedTimelineKey] = useState<string>();
  const [eventReplay, setEventReplay] = useState<EventReplay>();
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [announcement, setAnnouncement] = useState("");

  const loadTimeline = useCallback(async (preferred?: { eventId: string; status: EventTimelineEntry["status"] }) => {
    setTimelineLoading(true);
    try {
      const [entries, scenarioBranches] = await Promise.all([api.getEventTimeline(), api.getEventBranches()]);
      setTimeline(entries);
      setBranches(scenarioBranches);
      setSelectedTimelineKey((current) => {
        const preferredEntry = preferred ? entries.find((entry) => entry.eventId === preferred.eventId && entry.status === preferred.status) : undefined;
        return preferredEntry?.timelineEntryId ?? (current && entries.some((entry) => entry.timelineEntryId === current) ? current : entries[0]?.timelineEntryId);
      });
    } catch (timelineError) {
      setError(toMessage(timelineError));
    } finally {
      setTimelineLoading(false);
    }
  }, [api]);

  useEffect(() => { void loadTimeline(); }, [loadTimeline]);

  const selectedTimeline = timeline.find((entry) => entry.timelineEntryId === selectedTimelineKey);
  const selectedBranch = selectedTimeline?.status === "scenario"
    ? branches.find((branch) => branch.createdByEventId === selectedTimeline.eventId || branch.eventIds.includes(selectedTimeline.eventId))
    : undefined;
  const requiredResolutionComplete = interpretation?.entityResolutions.every((resolution) =>
    !resolution.requiredConfirmation || resolution.candidates.some((candidate) => selectedEntityIds.includes(candidate.entityId)),
  ) ?? false;
  const approvedRoles = new Set(approval?.decisions.map((decision) => decision.role) ?? []);
  const canRecord = approval?.status === "approved" && review && !activeReceipt;
  const isScenario = targetMode === "scenario";

  async function analyze() {
    if (!input.trim()) {
      setError("Describe what happened before asking the twin to interpret it.");
      return;
    }
    setBusy("interpret");
    setError(undefined);
    setReview(undefined);
    setApproval(undefined);
    setActiveReceipt(undefined);
    setExactReviewConfirmed(false);
    try {
      const result = await api.interpretEvent(input, intent);
      const options = [result, ...(result.additionalEvents ?? [])];
      setInterpretationOptions(options);
      activateInterpretation(result);
      setAnnouncement(`Interpreted ${result.title}. ${result.nodes.length - 1} possible effects require review.`);
    } catch (analysisError) {
      setError(toMessage(analysisError));
    } finally {
      setBusy(undefined);
    }
  }

  function activateInterpretation(result: EventInterpretation) {
    setInterpretation(result);
    setSelectedEntityIds(result.entityResolutions.flatMap((resolution) => resolution.candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.entityId)));
    setSelection(result.nodes[0] ? { type: "node", value: result.nodes[0] } : undefined);
    setTargetMode(result.processingMode === "scenario_only" || !result.canApplyToTwin || !canApply ? "scenario" : "reality");
    setReview(undefined);
    setApproval(undefined);
    setActiveReceipt(undefined);
    setExactReviewConfirmed(false);
  }

  function selectCandidate(mention: string, entityId: string) {
    if (!interpretation) return;
    const otherCandidateIds = interpretation.entityResolutions.find((item) => item.mention === mention)?.candidates.map((candidate) => candidate.entityId) ?? [];
    setSelectedEntityIds((current) => [...current.filter((id) => !otherCandidateIds.includes(id)), entityId]);
    setReview(undefined);
    setApproval(undefined);
    setActiveReceipt(undefined);
    setExactReviewConfirmed(false);
  }

  async function reviewExactEvent() {
    if (!interpretation) return;
    setBusy("review");
    setError(undefined);
    try {
      const reviewed = await api.reviewEvent(interpretation.previewId, interpretation.digest, targetMode, selectedEntityIds);
      setReview(reviewed);
      setInterpretation(reviewed.reviewedInterpretation);
      setInterpretationOptions((current) => current.map((item) => item.previewId === reviewed.previewId ? reviewed.reviewedInterpretation : item));
      setSelection(reviewed.reviewedInterpretation.nodes[0] ? { type: "node", value: reviewed.reviewedInterpretation.nodes[0] } : undefined);
      setApproval(undefined);
      setActiveReceipt(undefined);
      setExactReviewConfirmed(false);
      setAnnouncement("The server rebuilt and sealed the exact event payload for this entity selection. Review it once more before requesting approval.");
    } catch (reviewError) {
      setError(toMessage(reviewError));
    } finally {
      setBusy(undefined);
    }
  }

  async function requestApproval() {
    if (!review || !exactReviewConfirmed) return;
    setBusy("request-approval");
    setError(undefined);
    try {
      const requested = await api.requestEventApproval(review);
      setApproval(requested);
      setAnnouncement(requested.approvalKind === "scenario_policy" ? "Exact scenario payload passed isolation policy and is ready for an isolated branch." : "Exact reality payload is now awaiting two distinct approvals.");
    } catch (approvalError) {
      setError(toMessage(approvalError));
    } finally {
      setBusy(undefined);
    }
  }

  async function approve(role: "operations" | "security") {
    if (!approval) return;
    setBusy(`approve-${role}`);
    setError(undefined);
    try {
      const updated = await api.approveEvent(approval.approvalId, role, approval.payloadHash);
      setApproval(updated);
      setAnnouncement(`${role === "operations" ? "Operations" : "Security"} approval recorded for the exact reviewed payload.`);
    } catch (approvalError) {
      setError(toMessage(approvalError));
    } finally {
      setBusy(undefined);
    }
  }

  async function applyDecision() {
    if (!review || !approval) return;
    setBusy("apply");
    setError(undefined);
    try {
      const result = await api.applyReviewedEvent(review, approval);
      setActiveReceipt(result);
      setAnnouncement(result.message);
      await loadTimeline({ eventId: result.eventId, status: result.decision === "scenario_branched" ? "scenario" : "applied" });
    } catch (applyError) {
      setError(toMessage(applyError));
    } finally {
      setBusy(undefined);
    }
  }

  async function rollback() {
    if (!selectedTimeline?.receiptId) return;
    setBusy("rollback");
    setError(undefined);
    try {
      const result = await api.rollbackEvent(selectedTimeline.eventId, selectedTimeline.receiptId, `event-rollback-${selectedTimeline.eventId}-g${selectedTimeline.graphVersionAfter}`);
      setRollbackReceipt(result);
      setRollbackConfirmed(false);
      setAnnouncement(result.message);
      await loadTimeline({ eventId: result.eventId, status: "rolled_back" });
    } catch (rollbackError) {
      setError(toMessage(rollbackError));
    } finally {
      setBusy(undefined);
    }
  }

  async function reconstructEvent() {
    if (!selectedTimeline) return;
    setBusy("replay");
    setError(undefined);
    try {
      const replay = await api.getEventReplay(selectedTimeline.eventId);
      setEventReplay(replay);
      setAnnouncement(`Reconstructed ${replay.timeline.length} audited timeline record${replay.timeline.length === 1 ? "" : "s"} for ${selectedTimeline.title}.`);
    } catch (replayError) {
      setError(toMessage(replayError));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="event-intelligence-stack">
      <div className="live-announcement" aria-live="polite">{announcement}</div>
      <header className="section-heading event-heading">
        <div>
          <p className="eyebrow">Event Intelligence and Causal Impact Engine</p>
          <h1>Understand what changed—and what may change next</h1>
          <p>Turn an untrusted event report into a reviewable graph of evidence, consequences, uncertainty, and bounded actions.</p>
        </div>
        <StatusPill tone={sourceMode === "connected" ? "positive" : "violet"}>{sourceMode === "connected" ? "Connected API · trusted local demo auth" : "Local synthetic demo data"}</StatusPill>
      </header>

      <div className="event-safety-banner" role="note">
        <span aria-hidden="true">◇</span>
        <div><strong>No real-world systems are changed here.</strong><p>Interpretation is read-only. Approved reality updates affect this synthetic twin projection; scenarios stay isolated. External HR, identity, cloud, customer, and operational systems are never written.</p></div>
        <StatusPill tone="info">External write: false</StatusPill>
      </div>

      {error ? <div className="asset-inline-error" role="alert"><strong>Event operation failed.</strong><span>{error}</span><button type="button" aria-label="Dismiss event error" onClick={() => setError(undefined)}>×</button></div> : null}

      <Panel className="event-input-panel" aria-labelledby="event-input-title">
        <div className="event-input-copy">
          <p className="eyebrow">Manual event entry</p>
          <h2 id="event-input-title">What happened?</h2>
          <p>Describe an observed event or a hypothetical. Dates, uncertainty, and affected names help; missing information remains visible instead of being invented.</p>
          <div className="event-examples" aria-label="Example event statements">
            {examples.map((example, index) => <button type="button" key={example} onClick={() => { setInput(example); setIntent(index === 2 ? "auto" : "auto"); }}>{index === 0 ? "Person left" : index === 1 ? "Database outage" : "Customer may leave"}</button>)}
          </div>
        </div>
        <div className="event-input-form">
          <label htmlFor="event-statement">Event statement</label>
          <textarea id="event-statement" maxLength={4_000} rows={5} value={input} onChange={(event) => setInput(event.target.value)} />
          <div className="event-input-meta"><span>{input.length.toLocaleString()} / 4,000 characters</span><span>Text is treated as data, never instructions</span></div>
          <label htmlFor="event-intent">Interpret as</label>
          <select id="event-intent" value={intent} onChange={(event) => setIntent(event.target.value as EventIntent)}>
            <option value="auto">Detect reality vs. scenario</option>
            <option value="reality">Reported reality—still requires verification</option>
            <option value="scenario">What-if scenario only</option>
          </select>
          <Button onClick={() => void analyze()} busy={busy === "interpret"}>Interpret event and trace impacts</Button>
        </div>
      </Panel>

      {interpretation ? (
        <>
          {interpretationOptions.length > 1 ? (
            <Panel className="event-batch-picker">
              <div><p className="eyebrow">Multiple events detected</p><strong>Review each extracted event independently</strong><p>One approval cannot authorize multiple event payloads.</p></div>
              <label htmlFor="event-batch-selection">Event to review</label>
              <select id="event-batch-selection" value={interpretation.previewId} onChange={(event) => { const selected = interpretationOptions.find((item) => item.previewId === event.target.value); if (selected) activateInterpretation(selected); }}>
                {interpretationOptions.map((item, index) => <option value={item.previewId} key={item.previewId}>{index + 1}. {item.title} · {Math.round(item.confidence * 100)}%</option>)}
              </select>
            </Panel>
          ) : null}
          <InterpretationSummary interpretation={interpretation} />
          <EntityResolutionPanel interpretation={interpretation} selectedEntityIds={selectedEntityIds} onSelect={selectCandidate} />
          <ImpactGraph interpretation={interpretation} selection={selection} onSelect={setSelection} />
          <ImpactDetail selection={selection} interpretation={interpretation} />
          <ChangeComparison interpretation={interpretation} />
          <Consequences interpretation={interpretation} />
          <ReviewGate
            interpretation={interpretation}
            canReview={canReview}
            canApply={canApply}
            requiredResolutionComplete={requiredResolutionComplete}
            targetMode={targetMode}
            onTargetMode={(mode) => { setTargetMode(mode); setReview(undefined); setApproval(undefined); setActiveReceipt(undefined); setExactReviewConfirmed(false); }}
            exactReviewConfirmed={exactReviewConfirmed}
            onConfirm={setExactReviewConfirmed}
            review={review}
            approval={approval}
            receipt={activeReceipt}
            busy={busy}
            approvedRoles={approvedRoles}
            onReview={() => void reviewExactEvent()}
            onRequestApproval={() => void requestApproval()}
            onApprove={(role) => void approve(role)}
            onApply={() => void applyDecision()}
            canRecord={Boolean(canRecord)}
            isScenario={isScenario}
          />
        </>
      ) : (
        <StatePanel type="empty" title="No event has been interpreted yet" description="Enter a reality report or what-if statement. The system will expose its entity matches, causal limits, and uncertainty before any review action is available." />
      )}

      <TimelinePanel
        entries={timeline}
        loading={timelineLoading}
        selectedId={selectedTimelineKey}
        onSelect={(id) => { setSelectedTimelineKey(id); setRollbackConfirmed(false); setEventReplay(undefined); }}
        selected={selectedTimeline}
        selectedBranch={selectedBranch}
        rollbackConfirmed={rollbackConfirmed}
        onRollbackConfirm={setRollbackConfirmed}
        onRollback={() => void rollback()}
        canRollback={canApply}
        busy={busy === "rollback"}
        replay={eventReplay}
        replayBusy={busy === "replay"}
        onReplay={() => void reconstructEvent()}
        rollbackReceipt={rollbackReceipt}
      />
      <BranchComparisonPanel api={api} branches={branches} />
    </div>
  );
}

function InterpretationSummary({ interpretation }: { interpretation: EventInterpretation }) {
  const score = Math.round(interpretation.confidence * 100);
  const routeTone = interpretation.processingMode === "reality_review" ? "warning" : interpretation.processingMode === "rejected" ? "danger" : "violet";
  return (
    <section className="event-summary-grid" aria-labelledby="interpretation-title">
      <Panel className="event-interpretation-card">
        <div className="event-panel-header"><div><p className="eyebrow">Event interpretation preview</p><h2 id="interpretation-title">{interpretation.title}</h2></div><StatusPill tone={routeTone}>{interpretation.processingMode === "reality_review" ? "Reality review" : interpretation.processingMode === "scenario_only" ? "Scenario only" : "Rejected"}</StatusPill></div>
        <DefinitionList rows={[
          { label: "Event type", value: <code>{interpretation.eventType}</code> },
          { label: "When", value: interpretation.occurredAt ? formatDateTime(interpretation.occurredAt) : "Unknown" },
          ...(interpretation.location ? [{ label: "Location", value: interpretation.location }] : []),
          { label: "Source", value: interpretation.source },
          { label: "Verification", value: interpretation.verificationStatus.replaceAll("_", " ") },
          { label: "Graph snapshot", value: <>v{interpretation.graphSnapshotVersion || "unavailable"}{interpretation.graphSnapshotHash ? <> · <Hash value={interpretation.graphSnapshotHash} /></> : null}</> },
          { label: "Interpreter", value: `${interpretation.model.provider.replaceAll("_", " ")} · ${interpretation.model.version} · ${interpretation.model.generativeModelUsed ? "generative model used" : "no generative model"}` },
        ]} />
        <p className="event-mode-reason">{interpretation.modeReason}</p>
      </Panel>
      <Panel className="event-confidence-card">
        <p className="eyebrow">Event confidence</p>
        <div className="confidence-score"><strong>{score}%</strong><span>{interpretation.confidenceLevel}</span></div>
        <div className="confidence-track" aria-label={`Event interpretation confidence ${score} percent`}><span style={{ width: `${score}%` }} /></div>
        <p>This score reflects extraction and available evidence—not proof that the event occurred, and not a probability that every impact will happen.</p>
        <div className="confidence-distinction"><span><strong>Reality status</strong>{interpretation.verificationStatus.replaceAll("_", " ")}</span><span><strong>Impact confidence</strong>Shown separately on every effect</span></div>
      </Panel>
    </section>
  );
}

function EntityResolutionPanel({ interpretation, selectedEntityIds, onSelect }: { interpretation: EventInterpretation; selectedEntityIds: string[]; onSelect: (mention: string, entityId: string) => void }) {
  return (
    <Panel className="entity-resolution-panel" aria-labelledby="entity-resolution-title">
      <div className="section-title-row"><div><p className="eyebrow">Entity resolution</p><h2 id="entity-resolution-title">Confirm what the statement refers to</h2></div><StatusPill tone={interpretation.entityResolutions.some((item) => item.requiredConfirmation) ? "warning" : "positive"}>{interpretation.entityResolutions.filter((item) => item.requiredConfirmation).length} confirmation required</StatusPill></div>
      <div className="entity-resolution-grid">
        {interpretation.entityResolutions.map((resolution, resolutionIndex) => (
          <fieldset key={resolution.mention} className="entity-resolution-group">
            <legend><span>“{resolution.mention}”</span>{resolution.requiredConfirmation ? <strong>Human confirmation required</strong> : <small>Context-derived</small>}</legend>
            {resolution.candidates.map((candidate) => {
              const id = `event-entity-${resolutionIndex}-${candidate.entityId}`;
              return (
                <label className={selectedEntityIds.includes(candidate.entityId) ? "entity-candidate selected" : "entity-candidate"} htmlFor={id} key={candidate.entityId}>
                  <input id={id} type="radio" name={`event-entity-${resolutionIndex}`} checked={selectedEntityIds.includes(candidate.entityId)} onChange={() => onSelect(resolution.mention, candidate.entityId)} />
                  <span className="entity-candidate-main"><strong>{candidate.label}</strong><small>{candidate.entityType} · {Math.round(candidate.confidence * 100)}% match</small><p>{candidate.reason}</p></span>
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
      <p className="event-comparison-note">Required matches start unselected. After a choice, build the server-sealed review to recompute every impact and state difference for that exact entity.</p>
    </Panel>
  );
}

function ImpactGraph({ interpretation, selection, onSelect }: { interpretation: EventInterpretation; selection?: Selection; onSelect: (selection: Selection) => void }) {
  const nodeLabel = new Map(interpretation.nodes.map((node) => [node.nodeId, node.label]));
  return (
    <Panel className="impact-graph-panel" aria-labelledby="impact-graph-title">
      <div className="section-title-row"><div><p className="eyebrow">Causal impact graph</p><h2 id="impact-graph-title">What changes because of this event?</h2></div><div className="impact-legend"><span><i className="known" />Modeled effect</span><span><i className="unknown" />Unknown effect</span></div></div>
      <p className="impact-graph-note">Select a node or causal link for its explanation and evidence. Arrows represent bounded hypotheses—not proof of causation.</p>
      <div className="impact-graph-lanes" role="group" aria-label="Event causal impact graph by effect order">
        {effectLanes.map((lane) => {
          const laneNodes = interpretation.nodes.filter((node) => node.effectOrder === lane.order);
          if (!laneNodes.length) return null;
          return (
            <section className={`impact-lane impact-lane-${lane.order}`} key={lane.order} aria-labelledby={`impact-lane-${lane.order}`}>
              <header><strong id={`impact-lane-${lane.order}`}>{lane.label}</strong><span>{lane.description}</span></header>
              <div className="impact-lane-items">
                {laneNodes.map((node) => {
                  const incoming = interpretation.edges.filter((edge) => edge.toNodeId === node.nodeId);
                  return (
                    <div className="impact-node-group" key={node.nodeId}>
                      {incoming.map((edge) => <button type="button" className={selection?.type === "edge" && selection.value.edgeId === edge.edgeId ? "impact-edge selected" : "impact-edge"} aria-label={`Causal link: ${nodeLabel.get(edge.fromNodeId) ?? edge.fromNodeId} ${edge.relation} ${node.label}`} onClick={() => onSelect({ type: "edge", value: edge })} key={edge.edgeId}><span aria-hidden="true">→</span>{edge.relation}<small>{formatConfidence(edge.confidence)}</small></button>)}
                      <button type="button" className={selection?.type === "node" && selection.value.nodeId === node.nodeId ? `impact-node severity-${node.severity} selected` : `impact-node severity-${node.severity}`} onClick={() => onSelect({ type: "node", value: node })} aria-pressed={selection?.type === "node" && selection.value.nodeId === node.nodeId}>
                        <span className="impact-node-kind">{node.kind.replaceAll("_", " ")}</span><strong>{node.label}</strong><span>{node.change}</span><small>{formatConfidence(node.confidence)} · {node.timeHorizon}</small>
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Panel>
  );
}

function ImpactDetail({ selection, interpretation }: { selection?: Selection; interpretation: EventInterpretation }) {
  if (!selection) return null;
  if (selection.type === "node") {
    const node = selection.value;
    return (
      <Panel className="impact-detail-panel" aria-live="polite">
        <div><p className="eyebrow">Selected {node.kind}</p><h3>{node.label}</h3><p>{node.explanation}</p></div>
        <DefinitionList rows={[{ label: "Effect order", value: effectLabel(node.effectOrder) }, { label: "Severity", value: node.severity }, { label: "Confidence", value: formatConfidence(node.confidence) }, { label: "Horizon", value: node.timeHorizon }]} />
        <div><strong>Evidence and limits</strong>{node.evidence.length ? <ul>{node.evidence.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No supporting evidence beyond the event report; treat this effect as unknown.</p>}</div>
      </Panel>
    );
  }
  const edge = selection.value;
  const source = interpretation.nodes.find((node) => node.nodeId === edge.fromNodeId)?.label ?? edge.fromNodeId;
  const target = interpretation.nodes.find((node) => node.nodeId === edge.toNodeId)?.label ?? edge.toNodeId;
  return (
    <Panel className="impact-detail-panel" aria-live="polite">
      <div><p className="eyebrow">Selected causal link</p><h3>{source} → {target}</h3><p>{edge.explanation}</p></div>
      <DefinitionList rows={[{ label: "Relationship", value: edge.relation }, { label: "Effect order", value: effectLabel(edge.effectOrder) }, { label: "Confidence", value: formatConfidence(edge.confidence) }]} />
      <div><strong>Evidence and limits</strong>{edge.evidence.length ? <ul>{edge.evidence.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No direct evidence supports this link. It remains an explicit unknown.</p>}</div>
    </Panel>
  );
}

function ChangeComparison({ interpretation }: { interpretation: EventInterpretation }) {
  return (
    <Panel className="event-change-panel" aria-labelledby="event-change-title">
      <div className="section-title-row"><div><p className="eyebrow">Before / after review</p><h2 id="event-change-title">Proposed twin state differences</h2></div><StatusPill tone="warning">Preview only</StatusPill></div>
      <div className="event-diff-table-wrap">
        <table className="event-diff-table">
          <caption className="visually-hidden">Proposed state changes before and after the event</caption>
          <thead><tr><th>Subject</th><th>Field or relationship</th><th>Before</th><th aria-label="Changes to">→</th><th>After</th><th>Confidence</th></tr></thead>
          <tbody>{interpretation.stateDeltas.map((delta) => <tr key={delta.deltaId}><th scope="row"><strong>{delta.subject}</strong><span>{delta.operation}</span></th><td><code>{delta.field}</code></td><td>{delta.before}</td><td className="event-diff-arrow">→</td><td>{delta.after}</td><td>{formatConfidence(delta.confidence)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="event-comparison-note">“After” means the reviewed synthetic projection or isolated scenario state. Permission revocation and other external workflows are recommendations until independently verified.</p>
    </Panel>
  );
}

function Consequences({ interpretation }: { interpretation: EventInterpretation }) {
  return (
    <section className="event-consequence-grid" aria-label="Risks, predictions, and recommendations">
      <Panel className="event-delta-panel">
        <p className="eyebrow">Risk and prediction deltas</p><h2>What may move</h2>
        <div className="event-delta-list">{interpretation.riskDeltas.map((delta) => <article key={delta.deltaId}><div><StatusPill tone={delta.kind === "risk" ? "warning" : "violet"}>{delta.kind}</StatusPill><strong>{delta.label}</strong></div><div className="event-delta-values"><span>{delta.before}</span><i aria-hidden="true">→</i><strong>{delta.after}</strong></div><p>{delta.explanation}</p><small>{formatConfidence(delta.confidence)} · conditional estimate</small></article>)}</div>
      </Panel>
      <Panel className="event-recommendation-panel">
        <p className="eyebrow">What should we do next?</p><h2>Human-owned recommendations</h2>
        <ol>{interpretation.recommendations.map((recommendation) => <li key={recommendation.recommendationId}><span aria-hidden="true">{recommendation.urgency === "now" ? "!" : "✓"}</span><div><strong>{recommendation.title}</strong><p>{recommendation.rationale}</p><small>{recommendation.urgency.replaceAll("_", " ")} · Owner: {recommendation.owner}</small></div></li>)}</ol>
      </Panel>
      <Panel className="event-uncertainty-panel">
        <p className="eyebrow">Uncertainty register</p><h2>Assumptions and unknowns</h2>
        <div><strong>Assumptions used</strong><ul>{interpretation.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><strong>Still unknown</strong><ul>{interpretation.unknowns.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <details><summary>Safety and model warnings ({interpretation.warnings.length})</summary><ul>{interpretation.warnings.map((item) => <li key={item}>{item}</li>)}</ul></details>
      </Panel>
    </section>
  );
}

type ReviewGateProps = {
  interpretation: EventInterpretation;
  canReview: boolean;
  canApply: boolean;
  requiredResolutionComplete: boolean;
  targetMode: "reality" | "scenario";
  onTargetMode: (mode: "reality" | "scenario") => void;
  exactReviewConfirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
  review?: EventReview;
  approval?: EventApproval;
  receipt?: EventDecisionReceipt;
  busy?: string;
  approvedRoles: Set<"operations" | "security">;
  onReview: () => void;
  onRequestApproval: () => void;
  onApprove: (role: "operations" | "security") => void;
  onApply: () => void;
  canRecord: boolean;
  isScenario: boolean;
};

function ReviewGate(props: ReviewGateProps) {
  const realityEligible = props.interpretation.processingMode === "reality_review" && props.interpretation.canApplyToTwin && props.canApply;
  const reviewEligible = props.canReview && props.interpretation.processingMode !== "rejected";
  return (
    <Panel className="event-review-panel" aria-labelledby="event-review-title">
      <div className="section-title-row"><div><p className="eyebrow">Human review and controlled recording</p><h2 id="event-review-title">Choose reality update or alternate future</h2></div><Hash value={props.interpretation.digest} /></div>
      <div className="event-review-grid">
        <div className="event-review-controls">
          <label htmlFor="event-target-mode">Review destination</label>
          <select id="event-target-mode" value={props.targetMode} disabled={Boolean(props.review)} onChange={(event) => props.onTargetMode(event.target.value as "reality" | "scenario")}>
            <option value="reality" disabled={!realityEligible}>Reality graph—synthetic projection only</option>
            <option value="scenario">Isolated scenario branch</option>
          </select>
          {!realityEligible ? <p className="event-gate-message">Reality update is unavailable because the event is uncertain, unverified, or outside this membership’s authority. Scenario review remains available.</p> : null}
          {!props.review ? (
            <>
              <p className="event-gate-message">The current interpretation is a preview. The server will recompute impacts for the selected entities and return the exact payload before approval can begin.</p>
              <Button onClick={props.onReview} busy={props.busy === "review"} disabled={!reviewEligible || !props.requiredResolutionComplete}>{props.targetMode === "scenario" ? "Build exact scenario review" : "Build exact reality review"}</Button>
            </>
          ) : (
            <>
              <div className="event-sealed-review"><strong>Server-sealed payload displayed</strong><p>The graph, differences, evidence, assumptions, and digest above now match the reviewed event returned by the API.</p><Hash value={props.review.reviewedPayloadHash} /></div>
              <label className="check-row" htmlFor="event-exact-review"><input id="event-exact-review" type="checkbox" checked={props.exactReviewConfirmed} disabled={Boolean(props.approval)} onChange={(event) => props.onConfirm(event.target.checked)} /><span>I reviewed this exact server-sealed payload and its graph snapshot.</span></label>
              {!props.approval ? <Button onClick={props.onRequestApproval} busy={props.busy === "request-approval"} disabled={!props.exactReviewConfirmed}>{props.targetMode === "scenario" ? "Request scenario isolation policy" : "Request operations and security approval"}</Button> : null}
            </>
          )}
          {!props.canReview ? <p className="event-gate-message">This membership may interpret events but cannot review or record them.</p> : props.interpretation.processingMode === "rejected" ? <p className="event-gate-message">This input was rejected or quarantined. It cannot become a reality update or scenario branch.</p> : null}
        </div>
        <div className="event-approval-flow">
          {!props.review ? <StatePanel type="empty" title="Exact review not built" description="Choose every required entity, then ask the server to recompute the exact causal payload." /> : !props.approval ? <StatePanel type="empty" title="Exact payload ready for confirmation" description="Inspect the server-sealed graph and differences, confirm its digest, then request the required approval policy." /> : props.approval.approvalKind === "scenario_policy" ? (
            <div className="event-policy-approval"><span aria-hidden="true">✓</span><div><strong>Scenario isolation policy passed</strong><p>No reality graph or external system will change. This branch is reversible by deletion and remains labeled hypothetical.</p></div></div>
          ) : (
            <div className="event-approvals">
              <p>Reality updates require two distinct authenticated reviewers bound to <Hash value={props.approval.payloadHash} /> at graph snapshot v{props.approval.graphSnapshotVersion || "unavailable"}{props.approval.graphSnapshotHash ? <> · <Hash value={props.approval.graphSnapshotHash} /></> : null}. Approval expires {formatDateTime(props.approval.expiresAt)}.</p>
              <p><strong>Synthetic approval demo:</strong> these two one-browser buttons simulate distinct authenticated actors. Production requires each approver to use a separate signed-in session.</p>
              {(["operations", "security"] as const).map((role) => <div className={props.approvedRoles.has(role) ? "event-approver approved" : "event-approver"} key={role}><span className="actor-avatar">{role === "operations" ? "OB" : "SP"}</span><div><strong>{role === "operations" ? "Operations review" : "Security review"}</strong><small>{props.approvedRoles.has(role) ? "Exact payload approved" : "Synthetic distinct actor; separate production session required"}</small></div>{props.approvedRoles.has(role) ? <span className="approval-check" aria-label={`${role} approved`}>✓</span> : <Button variant="secondary" busy={props.busy === `approve-${role}`} onClick={() => props.onApprove(role)}>Synthetic demo: approve as {role} actor</Button>}</div>)}
            </div>
          )}
          {props.review && props.approval ? <Button onClick={props.onApply} busy={props.busy === "apply"} disabled={!props.canRecord || Boolean(props.receipt)}>{props.isScenario ? "Create isolated scenario branch" : "Apply once to synthetic reality graph"}</Button> : null}
        </div>
      </div>
      {props.receipt ? (
        <div className="event-receipt" role="status">
          <span className="receipt-check" aria-hidden="true">✓</span>
          <div><p className="eyebrow">Audited receipt</p><h3>{props.receipt.decision === "scenario_branched" ? "Alternate future created" : props.receipt.decision === "rolled_back" ? "Reality update rolled back" : "Synthetic reality graph updated"}</h3><p>{props.receipt.message}</p></div>
          <DefinitionList rows={[
            { label: "Event version", value: `${props.receipt.eventVersionBefore} → ${props.receipt.eventVersionAfter}` },
            { label: "Graph version", value: `${props.receipt.graphVersionBefore} → ${props.receipt.graphVersionAfter}` },
            ...(props.receipt.beforeStateHash && props.receipt.afterStateHash ? [{ label: "State transition", value: <><Hash value={props.receipt.beforeStateHash} /> → <Hash value={props.receipt.afterStateHash} /></> }] : []),
            { label: "Outbox position", value: props.receipt.outboxPosition || "Unavailable" },
            { label: "Audit event", value: <code>{props.receipt.auditEventId}</code> },
            { label: "Replayed", value: props.receipt.replayed ? "Yes—original receipt returned" : "No—executed once" },
            { label: "External writes", value: "None" },
          ]} />
        </div>
      ) : null}
    </Panel>
  );
}

type TimelinePanelProps = {
  entries: EventTimelineEntry[];
  loading: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
  selected?: EventTimelineEntry;
  selectedBranch?: EventScenarioBranch;
  rollbackConfirmed: boolean;
  onRollbackConfirm: (value: boolean) => void;
  onRollback: () => void;
  canRollback: boolean;
  busy: boolean;
  replay?: EventReplay;
  replayBusy: boolean;
  onReplay: () => void;
  rollbackReceipt?: EventDecisionReceipt;
};

function TimelinePanel({ entries, loading, selectedId, onSelect, selected, selectedBranch, rollbackConfirmed, onRollbackConfirm, onRollback, canRollback, busy, replay, replayBusy, onReplay, rollbackReceipt }: TimelinePanelProps) {
  return (
    <Panel className="event-timeline-panel" aria-labelledby="event-timeline-title">
      <div className="section-title-row"><div><p className="eyebrow">Event history and alternate futures</p><h2 id="event-timeline-title">Replayable tenant timeline</h2></div><StatusPill tone="neutral">{entries.length} recorded entries</StatusPill></div>
      {loading ? <Skeleton lines={4} /> : !entries.length ? <StatePanel type="empty" title="No event history in this scope" description="Interpreted drafts do not enter history. Only approved synthetic reality changes, isolated branches, and rollbacks appear here." /> : (
        <div className="event-timeline-layout">
          <div className="event-timeline-list" aria-label="Event history">
            {entries.map((entry) => <button type="button" key={entry.timelineEntryId} className={selectedId === entry.timelineEntryId ? "event-timeline-entry selected" : "event-timeline-entry"} onClick={() => onSelect(entry.timelineEntryId)} aria-pressed={selectedId === entry.timelineEntryId}><span className={`timeline-marker timeline-${entry.status}`} aria-hidden="true" /><span><small>{formatDateTime(entry.occurredAt)}</small><strong>{entry.title}</strong><span>{entry.summary}</span></span><StatusPill tone={entry.status === "applied" ? "positive" : entry.status === "scenario" ? "violet" : entry.status === "rolled_back" ? "warning" : "danger"}>{entry.status.replaceAll("_", " ")}</StatusPill></button>)}
          </div>
          {selected ? (
            <div className="timeline-inspector">
              <p className="eyebrow">Selected historical record</p><h3>{selected.title}</h3><p>{selected.summary}</p>
              <DefinitionList rows={[{ label: "Timeline record", value: <code>{selected.timelineEntryId}</code> }, { label: "Event type", value: <code>{selected.eventType}</code> }, { label: "Confidence", value: `${Math.round(selected.confidence * 100)}% · ${selected.confidenceLevel}` }, { label: "Effects", value: selected.effectCount }, { label: "Recorded", value: formatDateTime(selected.recordedAt) }, { label: "Graph version", value: `${selected.graphVersionBefore} → ${selected.graphVersionAfter}` }, { label: "Receipt", value: selected.receiptId ? <code>{selected.receiptId}</code> : "Unavailable" }, { label: "Status", value: selected.status.replaceAll("_", " ") }]} />
              <Button variant="secondary" busy={replayBusy} onClick={onReplay}>Reconstruct this event</Button>
              {replay?.eventId === selected.eventId ? <ReplayDetail replay={replay} /> : null}
              {rollbackReceipt?.eventId === selected.eventId && selected.status === "rolled_back" ? <div className="timeline-replay-status" role="status"><strong>Compensation receipt</strong><p><code>{rollbackReceipt.receiptId}</code> created graph version {rollbackReceipt.graphVersionAfter}; the active review workspace was not changed.</p></div> : null}
              {selectedBranch ? <div className="timeline-rollback"><strong>Scenario base</strong><p>This hypothetical branch remains anchored to the exact graph snapshot from which it was created.</p><DefinitionList rows={[{ label: "Scenario base graph version", value: selectedBranch.baseGraphVersion }, { label: "Scenario base graph hash", value: selectedBranch.baseGraphHash ? <Hash value={selectedBranch.baseGraphHash} /> : "Unavailable" }, { label: "Branch state hash", value: selectedBranch.stateHash ? <Hash value={selectedBranch.stateHash} /> : "Unavailable" }]} /></div> : null}
              {selected.rollbackAvailable && selected.receiptId ? <div className="timeline-rollback"><strong>Guarded compensation</strong><p>Rollback creates a new audited version. Reality events must be compensated latest-first; history is retained and source systems are never written.</p><label className="check-row" htmlFor={`rollback-${selected.timelineEntryId}`}><input id={`rollback-${selected.timelineEntryId}`} type="checkbox" checked={rollbackConfirmed} onChange={(event) => onRollbackConfirm(event.target.checked)} /><span>Restore the synthetic projection only if its current version still matches this event.</span></label><Button variant="danger" disabled={!canRollback || !rollbackConfirmed} busy={busy} onClick={onRollback}>Roll back this event</Button></div> : <p className="timeline-no-rollback">No rollback is available: this is a scenario, already compensated, rejected, superseded by a later reality event, or outside the active permission set.</p>}
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

function ReplayDetail({ replay }: { replay: EventReplay }) {
  return (
    <div className="timeline-replay-detail" role="status">
      <div className="section-title-row"><div><strong>Audited reconstruction</strong><p>{replay.reconstructable ? "Receipts and timeline records form a complete reconstruction." : "Some reconstruction evidence is unavailable."}</p></div><StatusPill tone={replay.reconstructable ? "positive" : "warning"}>{replay.currentStatus.replaceAll("_", " ")}</StatusPill></div>
      {replay.graph ? <DefinitionList rows={[{ label: "Graph versions", value: `${replay.graph.beforeVersion} → ${replay.graph.afterVersion}` }, { label: "Before state", value: replay.graph.beforeStateHash ? <Hash value={replay.graph.beforeStateHash} /> : "Unavailable" }, { label: "After state", value: replay.graph.afterStateHash ? <Hash value={replay.graph.afterStateHash} /> : "Unavailable" }, { label: "Receipts", value: replay.receipts.length }]} /> : null}
      {replay.entityChanges.length ? <div className="replay-change-list"><strong>Entity changes</strong>{replay.entityChanges.map((change) => <article key={change.entityId}><b>{change.displayName}</b><span>{summarizeState(change.before)} → {summarizeState(change.after)}</span></article>)}</div> : null}
      {replay.relationshipChanges.length ? <div className="replay-change-list"><strong>Relationship changes</strong>{replay.relationshipChanges.map((change) => <article key={change.relationshipId}><b>{change.type}</b><span>{change.beforeState ?? "Absent"} → {change.afterState ?? "Absent"}</span></article>)}</div> : null}
    </div>
  );
}

function BranchComparisonPanel({ api, branches }: { api: DigitalTwinApi; branches: EventScenarioBranch[] }) {
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [comparison, setComparison] = useState<EventBranchComparison>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!branches.length) return;
    setLeftId((current) => branches.some((branch) => branch.branchId === current) ? current : branches.find((branch) => branch.mode === "baseline")?.branchId ?? branches[0].branchId);
    setRightId((current) => branches.some((branch) => branch.branchId === current) ? current : branches.find((branch) => branch.mode === "scenario")?.branchId ?? branches[1]?.branchId ?? branches[0].branchId);
    setComparison(undefined);
  }, [branches]);

  async function compare() {
    if (!leftId || !rightId || leftId === rightId) return;
    setBusy(true);
    setError(undefined);
    try {
      setComparison(await api.compareEventBranches(leftId, rightId));
    } catch (compareError) {
      setError(toMessage(compareError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="event-branch-comparison" aria-labelledby="branch-comparison-title">
      <div className="section-title-row"><div><p className="eyebrow">Alternate-future comparison</p><h2 id="branch-comparison-title">Compare exact branch states</h2></div><StatusPill tone="violet">{branches.length} branches</StatusPill></div>
      {branches.length < 2 ? <StatePanel type="empty" title="Create a scenario branch to compare" description="Branch comparison becomes available when this tenant has at least two authorized states." /> : <>
        <div className="branch-compare-controls"><label>Left branch<select aria-label="Left branch" value={leftId} onChange={(event) => { setLeftId(event.target.value); setComparison(undefined); }}>{branches.map((branch) => <option value={branch.branchId} key={branch.branchId}>{branch.name}</option>)}</select></label><label>Right branch<select aria-label="Right branch" value={rightId} onChange={(event) => { setRightId(event.target.value); setComparison(undefined); }}>{branches.map((branch) => <option value={branch.branchId} key={branch.branchId}>{branch.name}</option>)}</select></label><Button variant="secondary" busy={busy} disabled={!leftId || !rightId || leftId === rightId} onClick={() => void compare()}>Compare branches</Button></div>
        {error ? <div className="asset-inline-error" role="alert"><strong>Branch comparison failed.</strong><span>{error}</span></div> : null}
        {comparison ? <div className="branch-comparison-result" role="status"><DefinitionList rows={[{ label: "Same base snapshot", value: comparison.sameBaseSnapshot ? "Yes" : "No" }, { label: "Same current state", value: comparison.stateHashEqual ? "Yes" : "No" }, { label: `${comparison.left.name} only`, value: comparison.leftOnlyEventIds.length || "None" }, { label: `${comparison.right.name} only`, value: comparison.rightOnlyEventIds.length || "None" }, { label: "Shared events", value: comparison.commonEventIds.length || "None" }]} /><div><strong>State hashes</strong><p><Hash value={comparison.left.stateHash} /> versus <Hash value={comparison.right.stateHash} /></p></div></div> : null}
      </>}
    </Panel>
  );
}

function summarizeState(state: Record<string, unknown> | null): string {
  if (!state) return "Absent";
  const entries = Object.entries(state);
  if (!entries.length) return "Empty state";
  return entries.slice(0, 3).map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`).join(", ");
}

function formatConfidence(value: number | null) {
  return value === null ? "Unknown confidence" : `${Math.round(value * 100)}% confidence`;
}

function effectLabel(order: EventEffectOrder) {
  if (order === "second") return "Second order";
  if (order === "third") return "Third order";
  if (order === "long_term") return "Long term";
  return order.charAt(0).toUpperCase() + order.slice(1);
}

function toMessage(error: unknown) {
  if (error instanceof ApiProblem) return `${error.message}${error.retryable ? " You can retry safely." : ""}`;
  if (error instanceof Error) return error.message;
  return "An unexpected event-intelligence error occurred.";
}
