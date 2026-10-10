import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, LoaderCircle, Play, ShieldCheck } from "lucide-react";
import {
  api,
  LiveApiError,
  post,
  type Analysis,
  type Debate,
  type Job,
  type Runtime,
} from "../lib/api/live";
import { useLiveJob } from "../lib/api/useLiveJob";
import "./competitor.css";
export default function LiveCouncil() {
  const [params] = useSearchParams();
  const sourceId = params.get("source_run");
  const [source, setSource] = useState<Analysis | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [question, setQuestion] = useState(
    "Should BMW investigate this feature? Challenge the evidence, benefits and trade-offs.",
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const {
    job,
    error: pollError,
    busy,
    attach,
    reserve,
    discard,
  } = useLiveJob<Debate>("bmw-live-debate-job", params.get("job"));
  useEffect(() => {
    const abort = new AbortController();
    setSource(null);
    setError("");
    async function load() {
      try {
        setRuntime(
          await api<Runtime>("/competitor/status", { signal: abort.signal }),
        );
        if (sourceId)
          setSource(
            await api<Analysis>(
              `/competitor/runs/${encodeURIComponent(sourceId)}`,
              { signal: abort.signal },
            ),
          );
        else {
          const latest = localStorage.getItem("bmw-live-analysis-job");
          if (latest) {
            const saved = await api<Job<Analysis>>(`/jobs/${latest}`, {
              signal: abort.signal,
            });
            if (saved.status === "succeeded") setSource(saved.result);
          }
        }
      } catch (e) {
        if (!abort.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not load saved analysis.",
          );
      }
    }
    void load();
    return () => abort.abort();
  }, [sourceId]);
  async function start() {
    if (!source || busy || submitting) return;
    setSubmitting(true);
    setError("");
    const clientJobId = reserve();
    try {
      attach(
        await post<Job<Debate>>("/council/debate", {
          client_job_id: clientJobId,
          analysis_id: source.analysis_id,
          source_run_id: source.run_id,
          proposal: { proposal_id: source.run_id, version: 1 },
          scope: source.scope,
          trigger: "pm_requested",
          question,
        }),
      );
    } catch (e) {
      if (e instanceof LiveApiError && [409, 422].includes(e.status)) discard();
      setError(e instanceof Error ? e.message : "Could not start council.");
    } finally {
      setSubmitting(false);
    }
  }
  const result =
    job?.status === "succeeded" && job.kind === "debate" ? job.result : null;
  const expectedSource = sourceId || source?.run_id;
  const matches =
    result && (!expectedSource || result.source_run_id === expectedSource);
  return (
    <div className="cx-page lc-page">
      <header className="cx-header">
        <div>
          <span className="eyebrow">LIVE AGENT COUNCIL / PM CONTROLLED</span>
          <h1>
            A real debate.
            <br />
            Your decision.
          </h1>
          <p>
            Saved evidence → independent perspectives → challenge → competitor
            response → judge.
          </p>
        </div>
        <span className="cx-live-badge">
          {runtime?.model || "Checking model…"}
        </span>
      </header>
      <Link className="text-link" to="/competitor">
        <ArrowLeft size={15} /> Back to competitor research
      </Link>
      <p className="cx-note">
        Customer and Market use local starter agents. All participants run on
        the shared Ollama model. Market success percentages are unavailable
        without a suitable dataset.
      </p>
      {(error || pollError) && (
        <div className="cx-error" role="alert">
          {error || pollError}
        </div>
      )}
      {source ? (
        <section className="cx-result">
          <span className="eyebrow">SAVED PROPOSAL / VERSION 1</span>
          <h2>
            {source.competitor_brand} {source.competitor_model} → BMW{" "}
            {source.scope.vehicle}
          </h2>
          <p>
            {source.scope.topic} · {source.scope.market} ·{" "}
            {source.scope.powertrain}
          </p>
          <p>
            {source.recommendations[0]?.proposed_change ||
              source.position.rationale}
          </p>
          <details className="cx-details">
            <summary>Original competitor position</summary>
            <p>{source.position.rationale}</p>
            {source.position.claims.map((c) => (
              <p key={c.id}>{c.text}</p>
            ))}
            <small>Immutable run: {source.run_id}</small>
          </details>
          <label className="cx-question">
            Your debate question
            <textarea
              aria-label="Live debate question"
              maxLength={800}
              rows={3}
              value={question}
              disabled={busy || submitting}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <button
            className="button primary"
            disabled={
              busy || submitting || !question.trim() || !runtime?.debate_ready
            }
            onClick={start}
          >
            {busy || submitting ? (
              <LoaderCircle className="cx-spin" size={16} />
            ) : (
              <Play size={16} />
            )}
            Start live debate
          </button>
          <p className="cx-note">
            This click starts real inference. Allow several minutes. No
            requirement is approved automatically.
          </p>
        </section>
      ) : (
        !sourceId && (
          <section className="cx-empty">
            <h2>Bring a saved competitor analysis.</h2>
            <p>
              Run an analysis on the Competitors page, then choose “Bring to
              council”.
            </p>
            <Link className="button primary" to="/competitor">
              Open competitor research
            </Link>
          </section>
        )
      )}
      {(busy || job?.status === "failed") && (
        <div className="cx-progress" role="status">
          <strong>{job?.phase || "Restoring council job…"}</strong>
          <p>
            {job?.error ||
              "The backend is generating and checking real statements. You can return to this page while it runs."}
          </p>
          <small>
            {job?.request.scope.vehicle} · {job?.request.scope.topic}
          </small>
        </div>
      )}
      {result && !matches && (
        <p className="cx-note">
          The saved debate belongs to another proposal. Start a debate for the
          proposal above.
        </p>
      )}
      {matches && result && (
        <section className="lc-transcript">
          <div className="cx-result-head">
            <h2>Council transcript</h2>
            <Link
              className="text-link"
              to={`/council?source_run=${result.source_run_id}&job=${job?.id}`}
            >
              Link to this saved debate
            </Link>
            <span className="cx-live-badge">Awaiting PM review</span>
          </div>
          {result.turns.map((turn, i) => (
            <article
              key={`${turn.agent_id}-${turn.stage}`}
              className={`lc-turn lc-${turn.agent_id}`}
            >
              <div className="lc-turn-heading">
                <span>{String(i + 1).padStart(2, "0")}</span>
                <h3>{turn.agent_id}</h3>
                <small>
                  {turn.stage} · {turn.position.stance.replaceAll("_", " ")}
                </small>
              </div>
              <p>{turn.position.rationale}</p>
              {turn.position.claims.map((c) => (
                <div className="lc-claim" key={c.id} id={c.id}>
                  <strong>
                    {c.id} · {c.kind}
                  </strong>
                  <p>{c.text}</p>
                  {c.evidence_ids.length > 0 && (
                    <details>
                      <summary>
                        Supporting evidence ({c.evidence_ids.length})
                      </summary>
                      {c.evidence_ids.map((id) => {
                        const e = result.evidence.find((s) => s.id === id);
                        return (
                          <div key={id}>
                            <strong>{e?.source_title || id}</strong>
                            <p>{e?.passage}</p>
                            {e?.source_uri.startsWith("https://") && (
                              <a
                                href={e.source_uri}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Official source ↗
                              </a>
                            )}
                            <small>{e?.locator}</small>
                          </div>
                        );
                      })}
                    </details>
                  )}
                </div>
              ))}
              {turn.challenges.map((c, i) => (
                <div className="lc-challenge" key={i}>
                  <a href={`#${c.target_claim_id}`}>
                    Challenge to {c.target_agent_id}: {c.target_claim_id}
                  </a>
                  <p>{c.question}</p>
                </div>
              ))}
              {turn.answered_claim_ids.length > 0 && (
                <div className="lc-answers">
                  Responding to:{" "}
                  {turn.answered_claim_ids.map((id) => (
                    <a key={id} href={`#${id}`}>
                      {id}
                    </a>
                  ))}
                </div>
              )}
            </article>
          ))}
          <details className="cx-details">
            <summary>Run provenance & limitations</summary>
            <p>
              Model: {result.model} · Analysis: {result.source_run_id} · Debate:{" "}
              {result.run_id}
            </p>
            <ul>
              {result.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
          <div className="cx-progress">
            <ShieldCheck size={20} />
            <strong>Research complete. Decision remains with the PM.</strong>
            <p>
              This debate is saved on the backend. It does not modify or approve
              requirements.
            </p>
          </div>
        </section>
      )}
      <Link className="cx-note" to="/council?demo=1">
        Open the separate scripted UI demonstration
      </Link>
    </div>
  );
}
