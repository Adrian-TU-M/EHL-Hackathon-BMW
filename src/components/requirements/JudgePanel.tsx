import { useRef, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { judgeApi, replayJudgeCouncil } from "../../lib/api/judge";
import type { JudgeCouncil } from "../../lib/api/judge";
import { Badge, Button } from "../ui/Primitives";
import { EvidenceDialog } from "../dashboard/EvidenceDialog";
import { ReviewDialog } from "./ReviewDialog";
import { criterionLabels } from "../../lib/scoring";
import type { Criterion } from "../../lib/types";

export function JudgePanel() {
  const snapshot = useAppStore();
  const view = snapshot.judgeCouncil;
  const [mode, setMode] = useState<"manual" | "auto">(view?.mode ?? "manual");
  const [message, setMessage] = useState("");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ids, setIds] = useState<string[] | null>(null);
  const [proposedEdit, setProposedEdit] = useState<{
    id: string;
    description: string;
  } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const pendingMessage = useRef<{ content: string; id: string } | null>(null);
  async function run(action: (signal: AbortSignal) => Promise<JudgeCouncil>) {
    if (busy) return;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const updated = await action(controller.signal);
      useAppStore.getState().applyJudgeCouncil(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Judge request failed.");
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }
  const assessment = view?.assessment;
  return (
    <section
      className="panel panel-padding judge-panel"
      aria-label="Judge Agent review"
    >
      <div className="flex-between">
        <div>
          <div className="eyebrow">JUDGE AGENT / EVIDENCE & PRIORITIES</div>
          <h2>Review the arguments. Choose the features.</h2>
        </div>
        <Badge>
          {view
            ? `${view.execution.toUpperCase()} BACKEND`
            : "PYTHON / FASTAPI"}
        </Badge>
      </div>
      <p>
        The moderator supplies evidence and coordinates the three specialists.
        The Judge assesses their arguments; you approve the final features.
      </p>
      <div className="judge-actions">
        <label>
          Next council mode{" "}
          <select
            aria-label="Judge review mode"
            value={mode}
            disabled={busy}
            onChange={(e) => setMode(e.target.value as "manual" | "auto")}
          >
            <option value="manual">Manual verification</option>
            <option value="auto">Auto debate</option>
          </select>
        </label>
        <Button
          disabled={busy}
          onClick={() =>
            run((signal) =>
              judgeApi.create(useAppStore.getState(), mode, signal),
            )
          }
        >
          {view ? "Start new Judge council" : "Start Judge council"}
        </Button>
        {view && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              run(async (signal) => {
                let refreshed = view;
                await replayJudgeCouncil(
                  view.id,
                  view.events.at(-1)?.sequence ?? 0,
                  () => {},
                  (next) => {
                    refreshed = next;
                  },
                  signal,
                );
                return refreshed;
              })
            }
          >
            Refresh backend state
          </Button>
        )}
      </div>
      {!view && (
        <p className="small muted">
          Requires the FastAPI service and configured team adapters. Backend
          demo mode is labelled explicitly; failed live requests never fall back
          to scripted responses.
        </p>
      )}
      {view && (
        <>
          <p>
            <strong>
              {view.status} · {view.stage} · round {view.round}
            </strong>{" "}
            · {view.mode} mode · revision {view.revision}
          </p>
          {view.checkpoint && (
            <div className="notice amber">
              <p>{view.checkpoint.reason}</p>
            </div>
          )}
          {view.status !== "complete" && (
            <div>
              <label
                className="field-label"
                htmlFor="judge-checkpoint-rationale"
              >
                Review note
              </label>
              <input
                id="judge-checkpoint-rationale"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="What did you verify or decide?"
              />
              <div className="judge-actions">
                <Button
                  disabled={busy || !rationale.trim()}
                  onClick={() =>
                    run((signal) =>
                      judgeApi.control(view, "continue", rationale, signal),
                    )
                  }
                >
                  Continue after review
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !rationale.trim()}
                  onClick={() =>
                    run((signal) =>
                      judgeApi.control(view, "interrupt", rationale, signal),
                    )
                  }
                >
                  Interrupt
                </Button>
              </div>
            </div>
          )}
          <details className="details-panel">
            <summary>
              Specialist statements and stage history ({view.events.length})
            </summary>
            {view.events.map((event) => (
              <div key={event.id} className="judge-transcript">
                <strong>
                  {event.actor} · {event.stage}
                </strong>
                <p>{event.statement}</p>
                {!!event.evidence_ids.length && (
                  <button
                    className="text-link"
                    onClick={() => setIds(event.evidence_ids)}
                  >
                    Sources: {event.evidence_ids.join(", ")}
                  </button>
                )}
              </div>
            ))}
          </details>
          {assessment && (
            <>
              <p className="small">
                Provisional assessment ·{" "}
                {new Date(assessment.created_at).toLocaleString()} · evidence
                strength is separate from priority.
              </p>
              {!!assessment.clarification_requests.length && (
                <p>
                  <strong>Clarification:</strong>{" "}
                  {assessment.clarification_requests.join(" ")}
                </p>
              )}
              {assessment.ranked_feature_ids.map((id, index) => {
                const feature = assessment.features.find(
                  (f) => f.feature_id === id,
                )!;
                const original = view.request.features.find((f) => f.id === id);
                return (
                  <article key={id} className="judge-feature">
                    <div className="flex-between">
                      <h3>
                        {index + 1}. {original?.title ?? id}
                      </h3>
                      <Badge>
                        {feature.recommendation.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <p>
                      <strong>
                        {feature.priority ?? "Unknown"}/100 priority
                      </strong>{" "}
                      · {feature.coverage}% coverage ·{" "}
                      {feature.evidence_strength} evidence · v
                      {feature.feature_version}
                    </p>
                    <p>{feature.rationale}</p>
                    <details>
                      <summary>
                        Benefits, drawbacks, scoring and alternatives
                      </summary>
                      {(
                        [
                          ["Benefits", feature.benefits],
                          ["Drawbacks", feature.drawbacks],
                          ["Risks", feature.risks],
                          ["Assumptions", feature.assumptions],
                          ["Uncertainties", feature.uncertainties],
                          ["Alternatives", feature.alternatives],
                        ] as [string, string[]][]
                      ).map(([label, values]) => (
                        <p key={label}>
                          <strong>{label}:</strong>{" "}
                          {values.join(" ") || "Not assessed"}
                        </p>
                      ))}
                      {(Object.keys(criterionLabels) as Criterion[]).map(
                        (key) => (
                          <p key={key}>
                            <strong>
                              {criterionLabels[key]}:{" "}
                              {feature.criteria[key].value ?? "Unknown"}
                            </strong>{" "}
                            — {feature.criteria[key].rationale} Arguments:{" "}
                            {feature.criteria[key].argument_ids.join(", ") ||
                              "None"}
                          </p>
                        ),
                      )}
                      {feature.proposed_description && (
                        <div>
                          <p>
                            <strong>Proposed edit:</strong>{" "}
                            {feature.proposed_description}
                          </p>
                          <Button
                            variant="secondary"
                            disabled={busy || view.status !== "complete"}
                            onClick={() =>
                              setProposedEdit({
                                id: feature.feature_id,
                                description: feature.proposed_description!,
                              })
                            }
                          >
                            Review proposed edit
                          </Button>
                        </div>
                      )}
                    </details>
                  </article>
                );
              })}
              <details className="details-panel">
                <summary>Argument support, relevance and influence</summary>
                {assessment.arguments.map((arg) => (
                  <article key={arg.argument_id} className="judge-feature">
                    <strong>
                      {arg.argument_id} · {arg.verdict}
                    </strong>
                    <p>
                      {
                        view.request.arguments.find(
                          (a) => a.id === arg.argument_id,
                        )?.statement
                      }
                    </p>
                    <p>
                      Support {arg.support ?? "Unknown"}/5 · relevance{" "}
                      {arg.relevance ?? "Unknown"}/5 · influence{" "}
                      {arg.influence ?? "Unknown"}/5
                    </p>
                    <p>{arg.explanation}</p>
                    {arg.citations.map((citation, i) => (
                      <blockquote key={i}>
                        {citation.quote}
                        <br />
                        <button
                          className="text-link"
                          onClick={() => setIds([citation.evidence_id])}
                        >
                          {citation.evidence_id}
                        </button>
                      </blockquote>
                    ))}
                    <p>{arg.assumptions.concat(arg.issues).join(" ")}</p>
                  </article>
                ))}
              </details>
              {assessment.proposed_priorities && (
                <div className="notice">
                  <p>
                    <strong>Proposed priorities:</strong>{" "}
                    {assessment.proposed_priorities.rationale}
                  </p>
                  <p>
                    {Object.entries(assessment.proposed_priorities.weights)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(" · ")}
                  </p>
                  <p>
                    Constraints:{" "}
                    {assessment.proposed_priorities.constraints.join("; ") ||
                      "None"}
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run((signal) =>
                        judgeApi.confirm(
                          view,
                          "PM confirmed the displayed priorities and constraints.",
                          signal,
                        ),
                      )
                    }
                  >
                    Confirm these priorities
                  </Button>
                </div>
              )}
            </>
          )}
          <label className="field-label" htmlFor="judge-pm-message">
            Your question or proposed feature change
          </label>
          <textarea
            id="judge-pm-message"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Explain what you dislike, ask for evidence, or describe your priorities…"
          />
          <Button
            disabled={busy || !message.trim()}
            onClick={() =>
              run(async (signal) => {
                const content = message.trim();
                if (pendingMessage.current?.content !== content)
                  pendingMessage.current = { content, id: crypto.randomUUID() };
                const next = await judgeApi.message(
                  view,
                  content,
                  pendingMessage.current.id,
                  signal,
                );
                pendingMessage.current = null;
                setMessage("");
                return next;
              })
            }
          >
            Ask the whole council
          </Button>
          <p className="small muted">
            Each message starts a bounded round. All three specialists reply,
            then the Judge reassesses. Manual mode pauses at each stage.
          </p>
        </>
      )}
      {busy && (
        <p role="status">
          Waiting for the council…{" "}
          <button onClick={() => abort.current?.abort()}>Cancel request</button>
          {view && (
            <button
              onClick={async () => {
                try {
                  const stopped = await judgeApi.control(
                    view,
                    "interrupt",
                    "PM interrupted active processing.",
                  );
                  useAppStore.getState().applyJudgeCouncil(stopped);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Unable to interrupt.",
                  );
                }
              }}
            >
              Stop council processing
            </button>
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {ids && (
        <EvidenceDialog
          ids={ids}
          onClose={() => setIds(null)}
          extraEvidence={view?.request.evidence}
        />
      )}
      {proposedEdit &&
        snapshot.requirements.find((r) => r.id === proposedEdit.id) && (
          <ReviewDialog
            requirement={snapshot.requirements.find(
              (r) => r.id === proposedEdit.id,
            )!}
            proposedDescription={proposedEdit.description}
            onClose={() => setProposedEdit(null)}
          />
        )}
    </section>
  );
}
