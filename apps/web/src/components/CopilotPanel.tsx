"use client";

import { useState } from "react";
import type { AnswerMode, CitedAnswer } from "@/lib/api/types";
import { formatDateTime, formatPercent } from "@/lib/format";
import { Button, Panel, StatePanel, StatusPill } from "./ui";

const launchQuestion = "What is most likely to delay Orion 2.0, what evidence supports that conclusion, and what information is still missing?";

const examples: Array<{ label: string; question: string; mode: AnswerMode }> = [
  { label: "Grounded launch risk", question: launchQuestion, mode: "grounded" },
  { label: "Restricted evidence", question: "What launch risk can I verify if the identity review is restricted?", mode: "restricted" },
  { label: "Protected workforce request", question: "Who is the least productive person on Orion?", mode: "unsafe" },
];

export function CopilotPanel({
  answer,
  busy,
  onAsk,
}: {
  answer?: CitedAnswer;
  busy: boolean;
  onAsk: (question: string, mode: AnswerMode) => Promise<void>;
}) {
  const [question, setQuestion] = useState(launchQuestion);
  const [mode, setMode] = useState<AnswerMode>("grounded");

  return (
    <div className="copilot-layout">
      <Panel className="question-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Permission-aware organizational Q&amp;A</p>
            <h2>Ask with evidence, or abstain</h2>
            <p className="subtle">Answers are constrained to the active membership and include source-level citations.</p>
          </div>
          <StatusPill tone="positive">Grounded mode</StatusPill>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onAsk(question, mode);
          }}
        >
          <label className="field-label" htmlFor="question">Question</label>
          <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} rows={4} maxLength={600} />
          <div className="question-actions">
            <span className="subtle" aria-live="polite">{question.length} / 600</span>
            <Button type="submit" busy={busy} disabled={!question.trim()}>Analyze launch risk <span aria-hidden="true">→</span></Button>
          </div>
        </form>
        <div className="example-questions" aria-label="Example questions">
          <p className="field-label">Try a guardrail state</p>
          <div>
            {examples.map((example) => (
              <button
                type="button"
                key={example.mode}
                className={mode === example.mode ? "chip chip-selected" : "chip"}
                onClick={() => {
                  setMode(example.mode);
                  setQuestion(example.question);
                }}
              >
                {example.label}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <section className="answer-region" aria-live="polite" aria-busy={busy}>
        {answer ? <Answer answer={answer} /> : (
          <StatePanel type="empty" title="No analysis yet" description="Ask a question to create a cited answer trace." />
        )}
      </section>
    </div>
  );
}

function Answer({ answer }: { answer: CitedAnswer }) {
  const abstained = answer.confidence === "abstained";
  return (
    <Panel className={`answer-card ${abstained ? "answer-abstained" : ""}`}>
      <div className="answer-meta">
        <StatusPill tone={abstained ? "warning" : answer.confidence === "high" ? "positive" : "info"}>
          {abstained ? "Abstained" : `${answer.confidence} confidence`}
        </StatusPill>
        <span>{formatDateTime(answer.completedAt)}</span>
        <span>Run {answer.runId.slice(0, 8)}</span>
      </div>
      {abstained ? (
        <div className="abstention-heading">
          <span className="shield-mark" aria-hidden="true">◇</span>
          <div><p className="eyebrow">Safe boundary</p><h2>Evidence threshold not met</h2></div>
        </div>
      ) : <h2>Launch-risk explanation</h2>}
      <p className="answer-copy">{answer.answer}</p>

      {answer.abstentionReason ? (
        <div className="callout callout-warning"><strong>Why this stopped</strong><p>{answer.abstentionReason}</p>{answer.redactedSourceCount ? <p>{answer.redactedSourceCount} source withheld without revealing its locator.</p> : null}</div>
      ) : null}

      {answer.citations.length ? (
        <div className="citation-section">
          <h3>Evidence used</h3>
          <ol className="citation-list">
            {answer.citations.map((citation) => (
              <li key={citation.evidence.id}>
                <span className="citation-number" aria-hidden="true">{citation.number}</span>
                <div>
                  <p>{citation.claim}</p>
                  <a href={`#evidence-answer-${citation.evidence.id}`} className="citation-link">
                    {citation.evidence.source} · {citation.evidence.sourceKey} · rev {citation.evidence.revision}
                  </a>
                  <div id={`evidence-answer-${citation.evidence.id}`} className="citation-detail">
                    <span>{citation.evidence.excerpt}</span>
                    <span>{formatDateTime(citation.evidence.observedAt)} · {formatPercent(citation.evidence.confidence)} confidence</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {answer.missingData.length ? (
        <div className="missing-data">
          <h3>Still unknown</h3>
          <ul>{answer.missingData.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}
      <p className="answer-caveat"><span aria-hidden="true">ⓘ</span> {answer.caveat}</p>
    </Panel>
  );
}
