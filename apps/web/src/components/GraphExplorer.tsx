"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DigitalTwinApi, TwinGraph, TwinNodeSummary } from "@/lib/api/types";
import { Button, DefinitionList, Panel, StatePanel, StatusPill } from "./ui";

const shortType = (type: string) => type.split("/").pop()?.replaceAll("_", " ") ?? type;
const positionFor = (index: number, count: number) => {
  if (count === 1) return { x: 430, y: 280 };
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  const radius = count < 7 ? 175 : 230 + Math.min(120, count * 3);
  return { x: 430 + Math.cos(angle) * radius, y: 280 + Math.sin(angle) * radius };
};

export function GraphExplorer({ api, canManage }: { api: DigitalTwinApi; canManage: boolean }) {
  const [graph, setGraph] = useState<TwinGraph>();
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState<string>();
  const [showAddNode, setShowAddNode] = useState(false);
  const [showAddRelationship, setShowAddRelationship] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try { const result = await api.getTwinGraph(); setGraph(result); setSelectedId((current) => current ?? result.nodes[0]?.node_id); setError(undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load the company graph."); }
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);
  const selected = graph?.nodes.find((node) => node.node_id === selectedId);
  const connected = graph?.relationships.filter((edge) => edge.source_node_id === selectedId || edge.target_node_id === selectedId) ?? [];

  const createNode = async (form: FormData) => {
    setBusy(true); try { const node = await api.createTwinNode({ typeId: String(form.get("typeId")), label: String(form.get("label")).trim() }); setShowAddNode(false); await refresh(); setSelectedId(node.node_id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add node."); } finally { setBusy(false); }
  };
  const createRelationship = async (form: FormData) => {
    setBusy(true); try { await api.createTwinRelationship({ typeId: String(form.get("typeId")), sourceNodeId: String(form.get("source")), targetNodeId: String(form.get("target")) }); setShowAddRelationship(false); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add relationship."); } finally { setBusy(false); }
  };

  if (error && !graph) return <StatePanel type="error" title="Company graph unavailable" description={error} />;
  if (!graph) return <StatePanel type="empty" title="Loading company graph" description="Reading the authorized tenant graph." />;
  return <div className="company-graph-layout">
    <Panel className="company-graph-panel">
      <header className="panel-header company-graph-header"><div><p className="eyebrow">Authoritative company model · tenant scoped</p><h2>Company relationship map</h2><p className="subtle">Add people, departments, projects, and the connections between them. {graph.nodes.length} nodes · {graph.relationships.length} relationships.</p></div><div className="graph-actions"><Button variant="secondary" onClick={() => void refresh()}>Refresh</Button>{canManage ? <><Button variant="secondary" onClick={() => setShowAddRelationship(true)} disabled={graph.nodes.length < 2}>Add relationship</Button><Button onClick={() => setShowAddNode(true)}>Add node</Button></> : null}</div></header>
      {error ? <p className="graph-error" role="alert">{error}</p> : null}
      {!canManage ? <p className="graph-security-note">Viewing is permission-filtered. A tenant graph administrator can add or connect entities; the API enforces this boundary for every change.</p> : null}
      {graph.nodes.length === 0 ? <StatePanel type="empty" title="No company entities yet" description={canManage ? "Add the first person, department, or project to start mapping how the company works." : "No graph entities are available to your membership."} /> : <GraphCanvas graph={graph} selectedId={selectedId} onSelect={setSelectedId} />}
    </Panel>
    <aside className="graph-inspector"><Panel>{selected ? <NodeInspector node={selected} graph={graph} connected={connected} /> : <StatePanel type="empty" title="Select a node" description="Choose a person or entity to inspect its relationships." />}</Panel></aside>
    {showAddNode ? <GraphDialog title="Add company node" onClose={() => setShowAddNode(false)}><form action={createNode} className="graph-form"><label>Entity type<select name="typeId" defaultValue={graph.nodeTypes.find((type) => type.type_id.endsWith("/Employee"))?.type_id} required>{graph.nodeTypes.map((type) => <option key={type.type_id} value={type.type_id}>{type.display_name}</option>)}</select></label><label>Name or label<input name="label" maxLength={160} required placeholder="e.g. Maya Chen" autoFocus /></label><p>Only a label and approved type are collected here. Add sensitive employee details only through governed source systems.</p><div><Button type="button" variant="secondary" onClick={() => setShowAddNode(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add node"}</Button></div></form></GraphDialog> : null}
    {showAddRelationship ? <GraphDialog title="Connect company entities" onClose={() => setShowAddRelationship(false)}><form action={createRelationship} className="graph-form"><label>From<select name="source" required>{graph.nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.label}</option>)}</select></label><label>Relationship<select name="typeId" required>{graph.relationshipTypes.map((type) => <option key={type.type_id} value={type.type_id}>{type.display_name}</option>)}</select></label><label>To<select name="target" required defaultValue={graph.nodes[1]?.node_id}>{graph.nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.label}</option>)}</select></label><div><Button type="button" variant="secondary" onClick={() => setShowAddRelationship(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Connecting…" : "Add relationship"}</Button></div></form></GraphDialog> : null}
  </div>;
}

function GraphCanvas({ graph, selectedId, onSelect }: { graph: TwinGraph; selectedId?: string; onSelect: (id: string) => void }) {
  const positions = useMemo(() => new Map(graph.nodes.map((node, index) => [node.node_id, positionFor(index, graph.nodes.length)])), [graph.nodes]);
  return <div className="company-graph-canvas" aria-label="Interactive company relationship graph"><svg viewBox="0 0 860 560" role="img" aria-label={`${graph.nodes.length} company entities and ${graph.relationships.length} relationships`}><defs><marker id="company-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" /></marker></defs>{graph.relationships.map((edge) => { const from = positions.get(edge.source_node_id); const to = positions.get(edge.target_node_id); if (!from || !to) return null; return <g key={edge.relationship_id}><line className="company-edge" x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#company-arrow)"/><text className="company-edge-label" x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 6}>{shortType(edge.type_id)}</text></g>; })}{graph.nodes.map((node) => { const point = positions.get(node.node_id)!; return <g key={node.node_id} className="company-node" transform={`translate(${point.x - 72} ${point.y - 31})`} onClick={() => onSelect(node.node_id)} tabIndex={0} role="button" aria-pressed={selectedId === node.node_id} aria-label={`${node.label}, ${shortType(node.type_id)}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(node.node_id); }}><rect className={selectedId === node.node_id ? "company-node-selected" : ""} width="144" height="62" rx="7"/><text x="12" y="25">{node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label}</text><text className="company-node-type" x="12" y="45">{shortType(node.type_id)}</text></g>; })}</svg></div>;
}

function NodeInspector({ node, graph, connected }: { node: TwinNodeSummary; graph: TwinGraph; connected: TwinGraph["relationships"] }) { const name = (id: string) => graph.nodes.find((item) => item.node_id === id)?.label ?? "Unavailable entity"; return <><div className="inspector-title"><StatusPill tone="info">{shortType(node.type_id)}</StatusPill><StatusPill tone="neutral">{node.state}</StatusPill></div><p className="eyebrow">Company entity</p><h2>{node.label}</h2><DefinitionList rows={[{ label: "Classification", value: node.classification }, { label: "Connections", value: String(connected.length) }, { label: "Version", value: String(node.version) }]} /><div className="inspector-divider"/><h3>Relationships</h3>{connected.length ? <ul className="node-relationship-list">{connected.map((edge) => <li key={edge.relationship_id}><strong>{shortType(edge.type_id)}</strong><span>{edge.source_node_id === node.node_id ? `to ${name(edge.target_node_id)}` : `from ${name(edge.source_node_id)}`}</span></li>)}</ul> : <p className="subtle">No connections recorded for this entity.</p>}</>;
}
function GraphDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) { return <div className="graph-dialog-backdrop" role="presentation"><section className="graph-dialog" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button aria-label="Close" onClick={onClose}>×</button></header>{children}</section></div>; }
