---
id: CH-07
title: AI Agents, Reasoning, and Evaluations
status: Committed
version: 1.0.0
owners:
  - AI Platform
  - Applied AI
  - Security
last_reviewed: 2026-07-13
---

# AI Agents, Reasoning, and Evaluations

## 1. Purpose and safety boundary

The AI subsystem converts an authorized question into evidence retrieval, structured analysis, simulation requests, and reviewable drafts. It is not an authority system. A model cannot authenticate a user, choose a tenant, expand a delegation, grant access, establish a canonical fact, approve its own action, or call an external mutation without deterministic policy and approval services.

Agents are bounded capability profiles, not artificial executives. Labels such as CEO, HR, legal, or finance may appear as future user-facing viewpoints, but they do not confer authority and are not H1 runtime roles.

| ID | Requirement |
|---|---|
| REQ-AI-001 | AI workloads MUST use the Responses API and Agents SDK behind capability, policy, budget, and evaluation interfaces. |
| REQ-AI-002 | Agents MUST be versioned capability profiles with explicit tools, memory, context limits, handoffs, retries, evaluation, and termination. |
| REQ-AI-003 | Deterministic authorization, retrieval, validation, execution, verification, citation, approval, and audit MUST surround model behavior. |
| REQ-AI-004 | Connector/user content MUST NOT become privileged instructions or grant tools, and model output MUST be schema-validated. |
| REQ-AI-005 | Memory MUST be explicit, tenant-scoped, permission-trimmed, versioned, and deletable with no invisible self-modification. |
| REQ-AI-006 | The platform MUST retain evidence, structured rationale, action traces, and model versions rather than expose/store private chain-of-thought. |
| REQ-AI-007 | Models, prompts, tools, and fallbacks MUST pass use-case safety, quality, latency, and cost evaluations before promotion. |
| REQ-AI-008 | A child agent MUST inherit the intersection of user, tenant, caller, workflow, and tool-policy authority. |
| REQ-TEN-005 | Customer data MUST NOT be used for cross-tenant retrieval, memory, evaluation, analytics, or training without separately recorded opt-in design. |
| REQ-ACT-001 | External execution MUST bind the exact tenant, actor, credential, target, arguments, expiry, policy, and idempotency key. |
| REQ-ACT-004 | Employment, legal, financial, production, identity, destructive, and security-control decisions MUST remain non-executable through H3. |
| QAR-AI-001 | Missing, conflicting, or inaccessible evidence MUST produce cited uncertainty or abstention and pass the committed grounding thresholds. |
| QAR-AI-002 | Authorization and prompt-injection suites permit zero policy bypasses. |
| QAR-PERF-003 | H1 cited answers complete within 20 seconds at p95 with a hard per-run spend budget. |
| QAR-COST-001 | Time, token, spend, tool, and concurrency budgets MUST terminate loops safely. |

## 2. Runtime architecture

The Python AI worker uses the OpenAI Responses API through an internal `ModelGateway`. The OpenAI Agents SDK supplies the server-owned agent loop, tool dispatch, handoffs, guardrails, and traces; PostgreSQL and Temporal remain authoritative for durable run state and approvals. The public API never exposes provider response IDs, API keys, raw prompts, or provider-specific tool objects.

OpenAI describes the Responses API as the agentic interface for multi-turn and tool-using applications, and its current model guidance recommends Responses for reasoning and tool calling. See [Responses API migration guidance](https://developers.openai.com/api/docs/guides/migrate-to-responses) and [current model guidance](https://developers.openai.com/api/docs/guides/latest-model). The [Agents SDK guide](https://developers.openai.com/api/docs/guides/agents) explicitly supports server ownership of deployment, tools, storage, and approval decisions, which is the boundary used here.

### 2.1 Model gateway contract

`ModelGateway.run(request)` accepts:

- `tenant_context_ref` and `actor_context_ref`, both resolved server-side;
- `capability_profile_id` and immutable profile version;
- `prompt_template_id` and content hash;
- ordered user input and authorized context references;
- strict output schema ID;
- allowlisted tool schemas and per-tool call limits;
- model policy ID, latency/cost/token budget, deadline, and cancellation token;
- trace and audit IDs;
- a privacy-preserving `safety_identifier` derived as an HMAC of tenant and actor IDs.

It returns `AgentRunResult` with structured output, model and revision actually used, usage, finish reason, tool-invocation references, validation results, citations, safety flags, and terminal state. Provider exceptions are normalized. Raw provider request/response payloads are not retained by default; an explicitly opted-in diagnostic sample may be encrypted under a restricted key, assigned a short TTL, and accessed only through time-limited break glass.

The OpenAI request defaults to `store: false`; the application owns conversation state and supplies only the context required for that turn. Any use of provider-side storage requires an approved data-processing profile and tenant configuration. API credentials are server-side secret references, isolated per environment, never placed in a tool schema or prompt.

### 2.2 Model policy

| Workload | H1 family default | Starting reasoning | Promotion objective |
|---|---|---|---|
| High-volume extraction and classification | `gpt-5.6-luna` | `none` or `low` | Schema validity, field accuracy, cost, and latency |
| Entity-resolution explanation and graph verification | `gpt-5.6-terra` | `low` | Pairwise decision accuracy and evidence use |
| Grounded query/research and mitigation drafting | `gpt-5.6-terra` | `medium` | Citation, abstention, usefulness, and latency |
| Scenario compilation and explanation | `gpt-5.6-terra` | `medium` | Operation accuracy and unsupported-change rejection |
| Difficult orchestration, adjudication, and eval grading | `gpt-5.6-sol` | `high`; `max` only after measurement | Quality-first benchmark with explicit cost ceiling |

OpenAI currently identifies `gpt-5.6-sol` for frontier capability, `gpt-5.6-terra` for balanced capability and cost, and `gpt-5.6-luna` for efficient high-volume work in [model guidance](https://developers.openai.com/api/docs/guides/latest-model). These are workload defaults, not unconditional production aliases. Production configuration records an explicitly evaluated model revision where available, the prompt and tool-schema hashes, reasoning setting, and fallback set.

A fallback is eligible only if it has passed the same capability eval gate and data-control requirements. The gateway may fall back for transient availability or rate-limit failure, never to bypass a safety refusal, tool denial, data residency rule, or output validation error. If no approved candidate remains, the run fails closed with a retryable or terminal status.

## 3. Durable run model

| Type | Required fields |
|---|---|
| `AgentRun` | Tenant, actor, capability/profile version, request hash, state, model policy, budgets, deadlines, cancellation state, parent run, delegation, input context refs, output ref, created/started/completed timestamps. |
| `ToolInvocation` | Run, tool/schema version, arguments hash and encrypted arguments ref, policy decision, authorization version, attempt, deadline, result hash/ref, side-effect class, status, error, started/completed timestamps. |
| `AgentHandoff` | From/to capability, purpose enum, reduced delegation, remaining budgets, summary ref, accepted/rejected status. |
| `RunCitation` | Output claim path, evidence ID, authorized locator, entailment score, verifier status. |
| `RunEvaluation` | Eval suite/version, dataset item, grader versions, scores, annotations, and release comparison. |

Run states are `queued`, `retrieving`, `reasoning`, `awaiting_tool`, `awaiting_confirmation`, `awaiting_approval`, `verifying`, `completed`, `abstained`, `cancelled`, `expired`, or `failed`. State transitions use optimistic concurrency and append an audit event. A process restart resumes from durable state and never silently repeats a side-effecting tool.

The system does not request, display, or persist private chain-of-thought. It stores structured plans, alternatives, assumptions, evidence links, tool choices, concise decision rationale, verifier findings, and provider-supplied reasoning summaries when permitted. This provides auditability without making hidden reasoning a product contract.

## 4. Capability profiles

Every profile declares purpose, allowed tools, output schema, retrieval limits, memory scope, maximum handoffs, token/cost/time budgets, retry policy, confidence thresholds, and termination conditions.

| Profile | Purpose | Allowed tools | Memory and authority | Termination |
|---|---|---|---|---|
| `query_research` | Answer organizational questions from accessible evidence. | Evidence search, entity lookup, bounded graph traversal, claim fetch, citation verifier. | Run context plus tenant session summary; read-only. | Complete with citations, abstain, or budget/deadline. |
| `extraction_resolution` | Convert untrusted source observations into candidate claims and duplicate candidates. | Schema registry, ontology lookup, normalization helpers, candidate lookup. | Current source object only; writes candidates through a validated ingestion command, never canonical merges. | Valid structured candidates or quarantine. |
| `graph_verification` | Check whether a proposed answer or dependency follows from claims and graph paths. | Claim/evidence fetch, bounded path query, constraint checker. | Read-only; cannot add or remove graph elements. | Verified, contradicted, insufficient evidence, or limit. |
| `scenario_planning` | Translate a confirmed user intent into scenario operations and request simulation. | Snapshot fetch, scenario schema validator, simulation runner. | Scenario-local; cannot infer person productivity or employment outcome. | Valid preview needing confirmation, result, or rejection. |
| `mitigation_drafting` | Draft evidence-backed remediation options. | Answer context, simulation comparison, policy catalog, Jira preview tool. | Draft-only. It cannot approve or execute. | Ranked alternatives plus assumptions and evidence. |
| `action_execution` | Submit an already approved exact Jira command to the deterministic action service. This H1 profile is a policy/trace wrapper and does not invoke a model. | Approval verification and `execute_approved_action` only. | No conversational memory, model generation, or argument editing. Authority is the attached one-time execution grant. | One receipt, conflict, expiry, cancellation, or failure. |

Extraction, query, and scenario profiles may run in parallel only when their inputs are independent. The orchestrator records a join policy and cancels remaining work when the deadline or budget is exhausted. Debate and voting are not default correctness mechanisms. For high-impact ambiguity, the system asks the user or routes independently produced candidates to a deterministic verifier; it does not manufacture consensus.

Self-review is implemented as a separate verification pass over structured output, evidence, policy, and tool history. The original model cannot mark its own output approved. Repeated reflection is capped at one repair attempt for H1 unless the profile specifies a measured benefit.

## 5. Retrieval and grounding

The retrieval service receives tenant and actor context from middleware, resolves current policy and source ACLs, and then performs lexical, vector, and bounded graph retrieval. A model never supplies SQL, Cypher, tenant ID, ACL predicate, object URI, or unbounded traversal depth.

The H1 retrieval envelope is limited to 40 evidence chunks, 20 entities, 100 claims, 500 graph nodes, depth 4, 50,000 input tokens, and 5 seconds. Each item contains a stable evidence ID, authorized display locator, classification, source authority, observed/effective time, content hash, and an explicit `UNTRUSTED_SOURCE_DATA` label. Retrieval that exceeds the limit returns a partial marker and refinement options.

An answer output uses this schema shape:

```json
{
  "answer": "string",
  "claims": [
    {
      "text": "string",
      "evidence_ids": ["UUID"],
      "status": "supported|conflicted|assumption|unsupported"
    }
  ],
  "assumptions": ["string"],
  "uncertainty": {"level": "low|medium|high", "reasons": ["string"]},
  "missing_data": ["string"],
  "recommended_next_steps": ["string"]
}
```

The citation verifier checks accessibility again, locator integrity, evidence existence, textual entailment, temporal fit, and conflict disclosure. A claim without valid support is removed, rewritten as an assumption, or causes abstention. Confidence labels derive from calibrated verifier bands and data completeness; the model cannot assign its own final confidence score.

## 6. Tool contract and authority

### 6.1 Tool schemas

Tools use JSON Schema with `additionalProperties: false`, explicit enums, lengths, numeric bounds, and required fields. Structured Outputs enforce schema adherence for model responses, while function calling is used to bridge the model to application tools; this distinction follows [OpenAI structured output guidance](https://developers.openai.com/api/docs/guides/structured-outputs).

H1 tools are:

| Tool | Side-effect class | Key limits |
|---|---|---|
| `evidence.search` | Read | Query <= 500 characters; filters are enums/IDs; result cap 40. |
| `entity.get` | Read | At most 20 authorized entity UUIDs. |
| `graph.traverse` | Read | Registered edge types only; depth <= 4; nodes <= 500; timeout <= 2 seconds. |
| `claims.verify` | Read/compute | At most 25 output claims and 100 evidence links. |
| `scenario.compile` | Draft | Registered operation enums only; no free-form executable expression. |
| `simulation.run` | Compute | Confirmed scenario ID; engine limits from CH-08. |
| `jira.remediation.preview` | Draft/read | Frozen H1 target `AST-142`; accepts authorized scenario/evidence references only. The deterministic service fetches the current issue and returns the exact three-field diff, expected source version, and immutable digest. |
| `approval.request` | Workflow | Exact preview digest; the model cannot name approvers or approve. |
| `approved_action.execute` | External write | One-time server-issued grant bound to command, digest, tenant, actor, and expiry. Arguments cannot be model-edited. |

There is no generic shell, HTTP fetch, SQL, Cypher, filesystem, email, browser, or provider SDK tool. Tool output is schema-validated, size-bounded, classified, and marked untrusted before reentering model context.

### 6.2 Tool-call decision path

1. Resolve the run, actor, tenant, profile, remaining budget, and cancellation state.
2. Validate the exact arguments against the registered schema and canonicalize them.
3. Evaluate policy against the current actor, delegation, tool, resources, purpose, and side-effect class.
4. Enforce rate, call-count, traversal, content, and egress limits.
5. For sensitive tools, pause for the required approval or confirmation. A pause persists the exact argument digest.
6. Invoke through a tenant-scoped service identity and deadline.
7. Validate and classify the result, append audit/trace records, and decrement budgets.
8. On retry, use the invocation ID and tool-specific idempotency contract. Side effects never retry without verification.

An agent handoff receives the intersection of the caller delegation and callee profile. It gets a structured, provenance-bearing summary rather than the complete prompt by default. The handoff is rejected when it would increase authority, cross a classification boundary, exceed maximum depth 2, or create a cycle.

## 7. Human confirmation and approval

Read-only questions need no per-tool approval after the user has authenticated and the application has authorized retrieval. However, every MCP operation exposed outside this trusted internal tool layer is configured for explicit user approval. OpenAI warns that remote MCP servers can see sensitive context and supports developer-required approval; see [MCP and connector guidance](https://developers.openai.com/api/docs/guides/tools-connectors-mcp).

Scenario compilation requires a user confirmation of structured changes before simulation. The H1 Jira remediation command requires two distinct authenticated human approvers. Any future external or high-impact command would require at least the same control, but employment, legal, financial, production, identity, destructive, and security-control decisions remain non-executable through H3 under REQ-ACT-004.

An `ApprovalRequest` binds tenant, command, exact canonical payload digest, before snapshot hash, policy version, requester, reason, evidence IDs, impact, expiry, and required approver roles. Approval expires after 15 minutes for H1 Jira actions. Any byte-significant payload change, source version change, policy change, credential change, or scope change voids prior approvals. A one-time execution grant is minted only after two valid approvals and is consumed atomically with the command ledger.

## 8. Prompt-injection and model-security controls

Connector content, retrieved text, tool output, plugin metadata, URLs, and user uploads are hostile data. Controls are layered:

1. Stable developer instructions contain policy and capability boundaries only. Untrusted values are never interpolated into developer messages. OpenAI explicitly warns against putting untrusted variables in higher-priority messages in [agent safety guidance](https://developers.openai.com/api/docs/guides/agent-builder-safety).
2. External content is delimited, labeled, source-attributed, size-limited, and passed as user/tool data. Instructions found inside it have no authority.
3. An extraction stage converts source content to strict schemas. Only necessary fields flow to downstream planning. Free-form text cannot become a tool name, URL, recipient, tenant, command, or approval argument.
4. Tools are least-privilege, typed, server-authorized, and egress-restricted. Retrieval tools cannot mutate; drafting tools cannot execute; execution cannot alter its approved payload.
5. Secrets, hidden ACLs, raw credentials, internal policy text, other tenants, and irrelevant source content are absent from model context.
6. Outputs are schema-validated, citation-verified, policy-checked, escaped for rendering, and scanned for secret patterns and disallowed instructions.
7. Suspicious input reduces tool availability, disables external tools, marks the trace, and may require human review. It never relaxes controls.
8. Adversarial datasets cover direct and indirect injection, encoded instructions, tool-output poisoning, citation spoofing, data exfiltration, instruction hierarchy confusion, and multi-turn persistence.

OpenAI recommends structured data flow, tool confirmations, guardrails, trace graders, and evals as complementary controls, while noting that they do not eliminate risk; see [Safety in building agents](https://developers.openai.com/api/docs/guides/agent-builder-safety).

## 9. Memory and context lifecycle

Memory has four explicit scopes:

- `run`: tool results and structured state until terminal state plus 30-day debugging retention;
- `session`: user-approved conversation summary, citations, and unresolved questions, tenant and actor bound, 24-hour default TTL;
- `tenant_knowledge`: only canonical entities, claims, and evidence managed by CH-05, never free-form model memory;
- `evaluation`: de-identified or synthetic cases in a separate governed store, never silently populated from customer traffic.

Summaries are model-generated candidates and cannot create facts. Before reuse they are authorized, size-bounded, and refreshed against current claims. Revoked evidence invalidates dependent summaries. Users can start a stateless run, inspect stored summaries, and delete session memory. No memory follows a user to another tenant.

Context assembly is deterministic: policy/profile, user goal, current delegation, structured plan state, authorized evidence, and bounded prior summary. It records each included item and exclusion reason. Token pressure drops lowest-ranked evidence before policy, delegation, or user goal and reports truncation.

## 10. Failure handling, budgets, and observability

| Failure | Required behavior |
|---|---|
| Model timeout or provider 5xx | Retry within profile budget, then use only an eval-approved fallback; otherwise fail with no fabricated answer. |
| Rate limit | Honor retry guidance, queue within deadline, or return retryable status. No unapproved provider switch. |
| Safety refusal | Return the refusal or safe alternative; do not retry a different model to evade it. |
| Invalid structured output | One schema-focused repair attempt with no new authority, then fail or abstain. |
| Tool timeout | Report partial progress, verify any ambiguous side effect, and never assume success. |
| Authorization/ACL change | Cancel pending tool calls, discard inaccessible context, and re-plan from current permissions. |
| Citation failure | Remove the claim or abstain; never expose an inaccessible locator. |
| Budget exhaustion | Terminate with partial, clearly labeled results and remaining questions; do not exceed hard limits. |
| Kill switch | Stop new runs, cancel cancellable calls, prevent approvals/execution, and retain audit state. |

H1 defaults per cited-answer run are 20-second wall time, 80,000 total model input tokens, 8,000 output tokens, 12 tool calls, 2 handoffs, depth 2, and a tenant-configured currency budget. Extraction jobs have separate batch budgets. Budget changes are policy version changes, not prompt instructions.

Metrics include runs by capability/model/revision/outcome, token and cost distribution, time to first/last output, tool selection and argument errors, handoff depth, schema-repair rate, citation coverage/precision, abstention, retrieval empty rate, injection flags, policy denials, approval waits, fallback rate, and cancellation latency. Traces store hashes and IDs by default; source text and prompts use a restricted encrypted sampling policy with tenant opt-in and short retention.

## 11. Evaluation and release gates

OpenAI recommends task-specific evals, continuous testing, production-representative datasets, automated scoring, and calibration against human judgment in [evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices). The platform implements these practices without depending on any provider-hosted eval product.

### 11.1 Datasets

- deterministic synthetic organizations with a complete ground-truth oracle;
- golden organizational questions with required, optional, conflicting, stale, and inaccessible evidence;
- extraction fixtures across GitHub, Jira, Unicode, malformed, and adversarial payloads;
- entity-resolution pairs including collisions, renamed users, shared names, and forbidden cross-tenant pairs;
- scenario-language examples mapped to exact structured operations;
- tool-routing and exact-argument cases;
- prompt-injection and data-exfiltration attacks in user, source, citation, and tool-result positions;
- model/provider failure, truncation, refusal, and malformed-output cases;
- human-reviewed production-like cases only under explicit governance and de-identification.

### 11.2 Metrics and H1 thresholds

| Metric | Release threshold |
|---|---|
| Strict output schema validity after first attempt | At least 99.5% |
| Extraction field micro-F1 on required fields | At least 0.98 |
| Entity-resolution precision for automated merges | At least 0.999; recall is reported but never traded for lower precision |
| Tool selection accuracy | At least 0.98 |
| Exact tool-argument match | At least 0.99 on executable/draft action fields |
| Citation precision | At least 0.98 |
| Citation coverage for factual answer claims | At least 0.95 |
| Unsupported material claim rate | Less than 0.01 |
| Unsupported-claim abstention | At least 0.95 |
| Scenario operation exact match | At least 0.97 |
| Cross-tenant disclosure or unauthorized action | Exactly 0 across the complete security suite |
| Adversarial injection prevention | 100% for privileged-tool and data-exfiltration cases; all failures block release |
| H1 cited-answer latency | p95 under 20 seconds at target concurrency |

Automated graders use deterministic checks where possible: schema, exact arguments, graph oracle, citation IDs, temporal answers, and policy decisions. Model graders are limited to rubric-scored semantic qualities, use a pinned grader revision, and are calibrated against at least two human reviewers. Disagreement samples enter adjudication; a model never grades its own release alone.

A model, prompt, retrieval, schema, or agent change runs the full affected suite. Promotion requires all safety invariants, all hard thresholds, no statistically significant critical regression, and documented cost/latency comparison. A canary starts at 5% of eligible synthetic or opted-in traffic and automatically rolls back on safety failure, schema regression over 0.5 percentage points, citation precision below threshold, or p95 latency over SLO for two windows.

### 11.3 Acceptance criteria

| ID | Acceptance criterion |
|---|---|
| AC-AI-001 | Golden cited answers meet citation precision/coverage thresholds and every material claim is reproducible from profile, prompt, model, tool, context, and evidence hashes. |
| AC-AI-002 | Missing, conflicting, restricted, and stale evidence cases produce calibrated uncertainty or abstention; mid-run revocation prevents tool, citation, and memory reuse. |
| AC-AI-003 | Direct, indirect, encoded, and multi-turn injection cannot select a tenant, reveal restricted evidence, alter an approved payload, or invoke an unauthorized tool. |
| AC-AI-004 | Tool choice and exact arguments meet Section 11.2; profiles reject undeclared tools and handoffs preserve equal-or-smaller authority/budget. |
| AC-ACT-001 | A Jira command cannot execute from model text; only a current exact-payload approval and one-time immutable grant reach the action service. |
| AC-REL-001 | The committed cited-answer workload meets the 20-second p95 target. |
| AC-REL-003 | Cancellation, deadline, budget, model outage, malformed output, and ambiguous tool failure reach the documented safe terminal state. |

Promotion evidence also reports quality, safety, latency, and cost against the current baseline. It is rejected when any Section 11.2 gate fails.

## 12. Risks and evolution

| ID | Risk | Mitigation |
|---|---|---|
| RSK-004 | Indirect prompt injection causes data exfiltration or reaches a privileged tool. | Untrusted-data separation, strict schemas, least-privilege tools, egress control, approval digest, validation, and adversarial gates. |
| RSK-012 | Provider/model outage or revision silently changes behavior. | Evaluated pinned revisions, immutable configuration hashes, canaries, regression gates, queue/fail closed, and no unapproved fallback. |
| RSK-003 | Long-running context retains stale or revoked source data. | Server-owned scoped memory, authorization at assembly/serialization, short TTL, provenance, invalidation, and side-channel tests. |
| RSK-006 | Model output substitutes an approved payload or becomes a confused deputy. | Exact canonical digest, role-distinct humans, deterministic executor, one-time grant, and execution-time policy check. |
| RSK-007 | Sensitive employment inference emerges from ordinary organizational data. | Prohibited-use schemas, aggregate-only simulation, tool/prompt controls, output classifiers, policy review, and security evals. |

Native OpenAI multi-agent features, remote MCP, additional model providers, fine-tuning, persistent provider state, voice agents, and autonomous background actions are Provisional. Each requires a separate data-flow review, threat model, eval suite, cost envelope, rollback, and explicit product horizon. Autonomous organizations, AI executives, and workforce prediction remain Research and have no production authority.
