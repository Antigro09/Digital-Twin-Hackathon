---
id: CH-17
title: H1 Synthetic Physical-Asset Twin
status: committed
version: 1.0.0
owners:
  - product-engineering
  - simulation-team
  - security-engineering
last_reviewed: 2026-07-14
---

# H1 Synthetic Physical-Asset Twin

## 1. Purpose and truth boundary

This chapter defines a second bounded H1 demonstration path for a synthetic industrial asset. It complements, but does not replace or alter, the frozen GitHub/Jira launch-risk workload in `CH-02`. The path demonstrates live-looking telemetry, spatial inspection, deterministic analytics, lifecycle history, and guarded control against an in-process simulator.

Every asset, sensor sample, lifecycle event, analytic result, and command effect is synthetic. H1 has no IoT gateway, message broker, OPC UA, Modbus, MQTT, SCADA, PLC, historian, CMMS, or physical-device connection. It reads no customer telemetry and sends no command outside the application. The interface and API MUST label this boundary, and control receipts MUST state `simulation: true` and `external_write: false`.

The Jira update defined in `CH-02` remains the only H1 external mutation. A simulated asset command changes only tenant-scoped demonstration state and is not evidence that the platform is safe or suitable for real operational-technology control.

| Requirement | H1 commitment |
|---|---|
| `REQ-PHY-001` | Produce deterministic, timestamped synthetic temperature, pressure, vibration, flow, and operating-state samples with sequence and quality metadata. |
| `REQ-PHY-002` | Provide an interactive procedural 3D-style physical-asset view linked to components and telemetry, with a complete keyboard-operable structured alternative. |
| `REQ-PHY-003` | Detect and forecast synthetic degradation with versioned deterministic algorithms and explicit limitations, without claiming validated machine learning or real failure prediction. |
| `REQ-PHY-004` | Present design, manufacture, commissioning, service, maintenance, and planned decommissioning history as versioned synthetic lifecycle records. |
| `REQ-PHY-005` | Preview and execute only allowlisted simulated commands with tenant authorization, expected-version checks, limits, idempotency, audit evidence, and fail-closed safety checks. |

## 2. Reference asset and snapshot

H1 contains one synthetic centrifugal pump and its component hierarchy. Stable tenant-qualified IDs identify the motor, coupling, drive-end bearing, pump casing, inlet, and outlet. The asset snapshot contains:

- identity, type, location, lifecycle stage, operating state, health summary, and version;
- a component list with spatial hotspot identifiers and associated sensor tags;
- current telemetry and a bounded recent history;
- deterministic anomalies, forecasts, model card, and per-signal contributions;
- lifecycle stages, dated events, maintenance records, and provenance labels;
- current simulator control state and an allowlist of available commands; and
- a data watermark showing the deterministic simulator sequence and observation time.

The H1 asset record is a demonstration projection over checked-in fixture parameters. It does not promote the full `edt.pack.physical` enterprise domain pack or real IoT connector certification from H4 into H1.

## 3. Synthetic near-real-time telemetry

The server runs a deterministic five-second simulator clock initialized from the fixture. A read materializes only frames due on that clock, so repeated or concurrent readers inside one interval observe the same current frame and cannot make simulated time run faster. Long inactive gaps are bounded to twelve catch-up frames and then rebase to the current server clock rather than replaying an unbounded backlog. The frozen-clock test profile advances exactly one frame per request for reproducible assertions. The `limit` query selects a rolling window of 1 to 120 recent frames; it does not itself select an advancement count. A sample has an asset ID, monotonically increasing sequence, sample timestamp, quality status, and typed values with units. Values vary within configured operating envelopes; a deterministic degradation term produces a reproducible bearing-vibration trend. The same fixture version, initial state, command history, and sequence MUST produce the same canonical samples.

The web client polls the telemetry resource while the twin screen is active, pauses when the document is hidden, aborts outstanding requests on navigation, and stops after repeated errors until the user explicitly retries. The screen shows last update, connection state, data age, units, thresholds, and whether a value is observed from the simulator or derived. A user can pause live updates without losing the last safe snapshot.

This polling loop is a bounded H1 substitute for a telemetry stream. It is not a claim of continuous ingestion, device clock synchronization, exactly-once delivery, industrial event rates, or production freshness. A real connector must separately define authentication, device identity, ordering, clock skew, buffering, backpressure, quality codes, calibration, retention, reconciliation, network segmentation, and safety behavior.

## 4. Interactive procedural 3D-style inspection

The asset screen renders a purpose-built perspective SVG representation of physical equipment rather than a photorealistic CAD model. Users can rotate and reset the view, select a component hotspot, and correlate the selected component with current measurements, anomaly contributions, forecast, and lifecycle/maintenance context. Selection is state, not decoration: the component ID is shared by the procedural scene and its structured inspector.

The procedural scene MUST NOT be the only way to locate or understand an issue. The same components, statuses, measurements, units, alerts, and actions are available as keyboard-operable controls and a table/list in logical order. Focus is visible, selection is announced, color is not the sole status encoding, pointer gestures have button equivalents, and reduced-motion mode disables continuous nonessential animation. An SVG or rendering failure leaves the structured view fully usable.

This is distinct from the rejected H1-H3 3D organizational view in `CH-11`: the physical scene supports a concrete spatial maintenance question and has no exclusive information.

## 5. Deterministic anomaly and forecast demonstration

H1 analytics are transparent numerical demonstrations, not an LLM decision and not a validated predictive-maintenance model. The service computes multivariate exponentially weighted moving statistics and normalized residual/z-score contributions over synthetic history, then uses a deterministic least-squares trend to estimate a threshold-crossing horizon or remaining-useful-life range when the data supports it.

Every result identifies input watermark, algorithm and model version, generated time, affected component, signal contributions, severity, confidence expression, forecast horizon or failure mode, recommended maintenance, and missing-data/validity caveat. Identical inputs and model version MUST produce identical results. Insufficient history, non-finite values, or an ill-conditioned trend produces `no_failure_mode_indicated` with null horizon fields and an explicit limitation, not an invented forecast.

The interface MUST use language such as `synthetic anomaly` and `conditional demonstration forecast`. It MUST NOT claim that a failure will occur, that the algorithm learned from real equipment, that a probability is calibrated on field outcomes, or that a recommended action is an engineering safety determination. Production use requires representative historical data, leakage review, backtesting, calibration, false-positive/negative analysis, drift monitoring, human-factors review, domain-engineer approval, and prospective validation.

## 6. Lifecycle history

The twin presents a coherent synthetic history from design and manufacture through commissioning, service, maintenance, and planned decommissioning. Each lifecycle event has a stable ID, stage, status, effective date/time, title, description, and optional artifact reference. Completed history is append-only in H1; corrections create a superseding event rather than silently rewriting prior history.

Lifecycle records provide context, not authority to perform maintenance or retire equipment. Planned work and decommissioning dates remain proposals. A future CMMS/PLM integration must define source precedence, reconciliation, permissions, retention, legal/quality records, version conflicts, and write governance before the platform can claim lifecycle synchronization.

## 7. Guarded simulated control

H1 exposes `set_speed_pct`, `set_valve_pct`, `emergency_stop`, and `reset` only when the current synthetic asset state and actor capability allow them. Control is a two-step workflow:

1. The server validates the requested command, reason, expected asset version, allowlisted type, numeric range, transition rule, and tenant context, then returns a short-lived exact-payload preview with before/after simulator state, safety checks, payload hash, and ETag.
2. Execution requires the preview ID, `Idempotency-Key`, and matching `If-Match`. The server reauthorizes the actor, revalidates expiry and expected version, verifies the preview hash, and either applies one in-process state transition or rejects without an effect.

The same idempotency key and payload returns the original receipt; reuse with different input fails. A stale asset version, expired preview, failed safety check, unsupported transition, out-of-range setpoint, or policy failure performs no state change. `emergency_stop` has no confirmation bypass in the demo; it remains a simulated command with the same authentication, validation, idempotency, and audit requirements. `reset` may clear a simulated trip only when its transition rule passes.

Preview and receipt payloads disclose simulation mode, before/after state, asset versions, payload hash, actor-safe audit reference, and hash-chained audit evidence. They never imply a PLC acknowledgement or physical verification. Adding real device egress is a new external action class and blocks release until an accepted ADR, OT threat model, safety-hazard analysis, device identity and protocol contract, network-zone design, emergency/timeout semantics, independent interlocks, approval policy, post-command verification, rollback/compensation analysis, and representative hardware-in-the-loop evidence exist.

## 8. Public API and authorization

The normative OpenAPI contract defines:

| Operation | Semantics |
|---|---|
| `GET /v1/assets` | List tenant-authorized synthetic asset summaries. |
| `GET /v1/assets/{assetId}/twin` | Return the component, visualization, telemetry, analytic, lifecycle, control, and watermark snapshot. |
| `GET /v1/assets/{assetId}/telemetry?limit=...` | Observe the simulator clock and return a bounded deterministic sample batch. |
| `POST /v1/assets/{assetId}/control-previews` | Validate and freeze an exact synthetic command preview. |
| `POST /v1/assets/{assetId}/control-previews/{previewId}/execute` | Revalidate and execute the preview once against simulator state. |

Tenant context derives from the authenticated membership; no asset route accepts a tenant selector. Reads require `asset.read`, preview requires `asset.control.preview`, and execution requires `asset.control.execute`. The Beacon analyst has read-only access to its tenant-scoped synthetic asset view and no control grant. Unauthorized and unknown asset IDs receive the same non-enumerating response. Command bodies reject unknown properties. Responses are `private, no-store`; simulator identifiers and payloads are tenant-scoped; every preview, execution, rejection, conflict, and replay is audited.

## 9. Acceptance and limitations

`AC-PHY-001` is satisfied only when `TST-PHY-001` demonstrates all of the following from a clean synthetic seed:

- telemetry visibly advances, pauses, recovers, and reproduces from the same frozen fixture, state, and sequence without network or device input;
- selecting a component in the 3D view and structured alternative exposes the same status and measurements, including under keyboard-only and reduced-motion operation;
- the anomaly/forecast result reproduces exactly and displays its model card and synthetic/no-real-world-validity warning;
- all lifecycle stages and event provenance remain inspectable without rewriting history;
- every invalid, stale, expired, unauthorized, cross-tenant, out-of-range, mutated, or duplicate-conflicting command produces zero state transitions;
- a valid command produces one simulator transition, an idempotent replay returns the same receipt, and the hash-linked audit trail verifies; and
- UI, API examples, logs, and generated editions never describe the simulator as a connected physical asset.

This capability proves product interaction and guardrail behavior only. It does not establish industrial reliability, real-time determinism, functional safety, cybersecurity certification, model accuracy, asset fitness, maintenance efficacy, or authority to operate physical equipment.
