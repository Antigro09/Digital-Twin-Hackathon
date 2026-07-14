"use client";

import { useMemo, useState } from "react";
import type { EvidenceRef, GraphNode, GraphResult } from "@/lib/api/types";
import { formatDateTime, formatPercent } from "@/lib/format";
import { Button, DefinitionList, Panel, StatePanel, StatusPill } from "./ui";

const kindTone = {
  code: "violet",
  work: "info",
  milestone: "warning",
} as const;

function EvidenceCard({ evidence }: { evidence: EvidenceRef }) {
  return (
    <article className="evidence-card" id={`evidence-${evidence.id}`}>
      <div className="evidence-card-header">
        <span className={`source-mark source-${evidence.source.toLowerCase()}`} aria-hidden="true">
          {evidence.source === "GitHub" ? "GH" : "JI"}
        </span>
        <div>
          <p className="eyebrow">{evidence.source} · {evidence.sourceKey}</p>
          <h4>{evidence.label}</h4>
        </div>
        <StatusPill tone={evidence.access === "full" ? "positive" : "warning"}>{evidence.access} access</StatusPill>
      </div>
      {evidence.excerpt ? <p className="evidence-excerpt">{evidence.excerpt}</p> : null}
      <DefinitionList
        rows={[
          { label: "Revision", value: evidence.revision },
          { label: "Observed", value: formatDateTime(evidence.observedAt) },
          { label: "Confidence", value: formatPercent(evidence.confidence) },
        ]}
      />
    </article>
  );
}

export function GraphExplorer({ graph }: { graph: GraphResult }) {
  const [selectedNodeId, setSelectedNodeId] = useState(graph.nodes[1]?.id ?? graph.nodes[0]?.id);
  const [showTable, setShowTable] = useState(false);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const selectedEvidence = useMemo(
    () => graph.evidence.filter((item) => selectedNode?.evidenceIds.includes(item.id)),
    [graph.evidence, selectedNode],
  );

  if (graph.nodes.length === 0) {
    return (
      <StatePanel
        type="revoked"
        title="No authorized graph projection"
        description="The Jira grant for this membership is revoked. The application returned no cached nodes, evidence, or restricted locators."
      />
    );
  }

  return (
    <div className="graph-layout">
      <Panel className="graph-panel" aria-labelledby="graph-heading">
        <header className="panel-header graph-header">
          <div>
            <p className="eyebrow">Bounded traversal · depth {graph.boundedDepth}</p>
            <h2 id="graph-heading">{graph.title}</h2>
            <p className="subtle">Projection as of {formatDateTime(graph.projectionAsOf)} · {graph.dataWatermark}</p>
          </div>
          <Button variant="secondary" onClick={() => setShowTable((current) => !current)} aria-expanded={showTable} aria-controls="path-table">
            {showTable ? "Hide path table" : "Show accessible path"}
          </Button>
        </header>

        <div className="graph-canvas" aria-label="Orion launch dependency graph">
          <div className="graph-track" role="list" aria-label="Critical dependency path">
            {graph.nodes.map((node, index) => (
              <div className="graph-step" key={node.id} role="listitem">
                <button
                  className={`graph-node graph-node-${node.kind} ${selectedNodeId === node.id ? "graph-node-selected" : ""}`}
                  onClick={() => setSelectedNodeId(node.id)}
                  aria-pressed={selectedNodeId === node.id}
                  aria-label={`${node.label}: ${node.title}, ${node.status}`}
                >
                  <span className="node-kind" aria-hidden="true">{node.kind === "code" ? "<>" : node.kind === "milestone" ? "◆" : "□"}</span>
                  <span className="node-label">{node.label}</span>
                  <strong>{node.title}</strong>
                  <span className="node-meta">{node.owner} · {node.status}</span>
                </button>
                {index < graph.nodes.length - 1 ? (
                  <div className="graph-connector" aria-hidden="true">
                    <span>{graph.edges[index]?.type.toLowerCase()}</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div id="path-table" hidden={!showTable} className="table-wrap">
          <table>
            <caption>Authorized dependency path in traversal order</caption>
            <thead><tr><th scope="col">From</th><th scope="col">Relationship</th><th scope="col">To</th><th scope="col">Evidence</th></tr></thead>
            <tbody>
              {graph.edges.map((edge) => {
                const from = graph.nodes.find((node) => node.id === edge.from);
                const to = graph.nodes.find((node) => node.id === edge.to);
                const source = graph.evidence.find((item) => item.id === edge.evidenceId);
                return (
                  <tr key={edge.id}>
                    <td>{from?.label}</td>
                    <td><StatusPill tone="neutral">{edge.type}</StatusPill></td>
                    <td>{to?.label}</td>
                    <td>{source?.sourceKey}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <aside className="graph-inspector" aria-live="polite">
        <Panel>
          {selectedNode ? <NodeInspector node={selectedNode} /> : null}
          <div className="inspector-divider" />
          <h3>Supporting evidence</h3>
          {selectedEvidence.map((item) => <EvidenceCard key={item.id} evidence={item} />)}
        </Panel>
      </aside>
    </div>
  );
}

function NodeInspector({ node }: { node: GraphNode }) {
  return (
    <div>
      <div className="inspector-title">
        <StatusPill tone={kindTone[node.kind]}>{node.kind}</StatusPill>
        <StatusPill tone={node.status === "At risk" || node.status === "Blocked" ? "warning" : "neutral"}>{node.status}</StatusPill>
      </div>
      <p className="eyebrow">{node.label}</p>
      <h2>{node.title}</h2>
      <DefinitionList rows={[{ label: "Owner", value: node.owner }, { label: "Evidence", value: `${node.evidenceIds.length} authorized source${node.evidenceIds.length === 1 ? "" : "s"}` }]} />
      <p className="permission-note"><span aria-hidden="true">✓</span> Visible because your active Aster Labs membership intersects every source ACL on this result.</p>
    </div>
  );
}
