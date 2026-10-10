import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  MessageSquareText,
  PauseCircle,
  Send,
  Volume2,
  X,
} from "lucide-react";
import { api, post, type Debate } from "../../lib/api/live";
import type { JudgeAssessment } from "../../lib/api/judge";
import { Badge, Button } from "../ui/Primitives";
import { useSavedJudgeAudio } from "./useSavedJudgeAudio";

export interface LiveReview {
  run_id: string;
  source_run_id: string;
  analysis_id: string;
  revision: number;
  status: string;
  request: {
    features: {
      id: string;
      version: number;
      title: string;
      description: string;
    }[];
  };
  assessment: JudgeAssessment | null;
  decisions: { action: string; version: number; rationale: string }[];
  messages: {
    id: string;
    actor: string;
    text: string;
    evidence_ids?: string[];
  }[];
}
interface VoiceStatus {
  configured: boolean;
  message: string;
}

export function LiveJudgeReview({
  debate,
  onReview,
}: {
  debate: Pick<Debate, "run_id" | "model">;
  onReview?: (review: LiveReview) => void;
}) {
  const [review, setReview] = useState<LiveReview | null>(null);
  const [voice, setVoice] = useState<VoiceStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [edit, setEdit] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const {
    audio,
    url: audioUrl,
    busy: voiceBusy,
    error: voiceError,
    play,
    stop: stopVoice,
  } = useSavedJudgeAudio(
    JSON.stringify([
      debate.run_id,
      review?.assessment?.id,
      review?.request.features[0]?.version,
    ]),
  );
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const reviewGeneration = useRef(0);
  const callback = useRef(onReview);
  callback.current = onReview;

  useEffect(() => {
    reviewGeneration.current += 1;
    const controller = new AbortController();
    pending.current = null;
    setReview(null);
    setError("");
    setBusy(false);
    setMessage("");
    setEdit(null);
    setReason("");
    void api<LiveReview>(`/review/debates/${debate.run_id}`, {
      signal: controller.signal,
    })
      .then((next) => {
        if (controller.signal.aborted) return;
        setReview(next);
        callback.current?.(next);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    void api<VoiceStatus>("/voice/status", { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setVoice(next);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      reviewGeneration.current += 1;
    };
  }, [debate.run_id]);

  async function command(path: string, fields: Record<string, unknown>) {
    if (!review) return;
    const generation = reviewGeneration.current;
    stopVoice();
    setBusy(true);
    setError("");
    const payload = {
      expected_revision: review.revision,
      expected_version: review.request.features[0].version,
      assessment_id: review.assessment?.id ?? null,
      ...fields,
    };
    const fingerprint = JSON.stringify({ path, ...payload });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const next = await post<LiveReview>(
        `/review/debates/${debate.run_id}/${path}`,
        { ...payload, id: pending.current.id },
      );
      // A saved command may finish after navigation; it still belongs to its
      // original run and must not replace the newly displayed review.
      if (generation !== reviewGeneration.current) return;
      pending.current = null;
      setReview(next);
      callback.current?.(next);
      setEdit(null);
      setReason("");
      setMessage("");
      stopVoice();
    } catch (e) {
      if (generation === reviewGeneration.current)
        setError(e instanceof Error ? e.message : "Unable to save PM review.");
    } finally {
      if (generation === reviewGeneration.current) setBusy(false);
    }
  }

  async function speak(messageId?: string) {
    if (!review) return;
    setError("");
    await play(`/api/voice/debates/${debate.run_id}`, {
      assessment_id: review.assessment?.id,
      message_id: messageId,
    });
  }

  function send(event: FormEvent) {
    event.preventDefault();
    void command("messages", { content: message.trim() });
  }

  if (!review)
    return (
      <section className="judge-handoff">
        <h2>Judge review</h2>
        <p role={error ? "alert" : "status"}>
          {error || "Loading the saved assessment…"}
        </p>
      </section>
    );
  const feature = review.request.features[0];
  const assessment = review.assessment?.features.find(
    (item) => item.feature_id === feature.id,
  );
  return (
    <section className="judge-handoff" aria-label="Live Judge review">
      <div className="judge-handoff-heading">
        <div>
          <div className="eyebrow">JUDGE TO PM</div>
          <h2>Your decision.</h2>
          <p>
            The council has finished. Review the evidence, discuss the
            trade-offs, then decide.
          </p>
        </div>
        <Badge tone="blue">
          {review.status.replaceAll("_", " ").toUpperCase()} · V
          {feature.version}
        </Badge>
      </div>
      <div className="judge-recommendation">
        <strong>{feature.title}</strong>
        <p>{feature.description}</p>
        {assessment && (
          <small>
            <strong>{assessment.recommendation.replaceAll("_", " ")}:</strong>{" "}
            {assessment.rationale}
          </small>
        )}
      </div>
      {assessment && (
        <details className="details-panel">
          <summary>Judge scoring and evidence</summary>
          <p>
            Priority {assessment.priority ?? "Unknown"}/100 · coverage{" "}
            {assessment.coverage}% · evidence {assessment.evidence_strength}.
            Priority is a rubric score, not a success probability.
          </p>
          {Object.entries(assessment.criteria).map(([key, value]) => (
            <p key={key}>
              <strong>
                {key}: {value.value ?? "Unknown"}
              </strong>{" "}
              — {value.rationale}
            </p>
          ))}
          <p>
            <strong>Benefits:</strong>{" "}
            {assessment.benefits.join(" ") || "Not established."}
          </p>
          <p>
            <strong>Trade-offs:</strong>{" "}
            {assessment.drawbacks.concat(assessment.risks).join(" ") ||
              "Not established."}
          </p>
          <p>
            <strong>Uncertainties:</strong>{" "}
            {assessment.uncertainties.join(" ") ||
              "See the source limitations."}
          </p>
          {review.assessment?.arguments.map((argument) => (
            <article key={argument.argument_id}>
              <strong>
                {argument.argument_id} · {argument.verdict}
              </strong>
              <p>{argument.explanation}</p>
              {argument.citations.map((citation, index) => (
                <blockquote key={`${citation.evidence_id}-${index}`}>
                  {citation.quote}
                  <small> {citation.evidence_id}</small>
                </blockquote>
              ))}
            </article>
          ))}
        </details>
      )}
      <div className="judge-handoff-actions">
        <Button
          disabled={busy || !assessment}
          onClick={() =>
            void command("decisions", {
              action: "approve",
              rationale:
                reason.trim() ||
                "PM approved the displayed requirement and assessment.",
            })
          }
        >
          <Check size={15} /> Approve
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void command("decisions", {
              action: "defer",
              rationale:
                reason.trim() || "PM deferred the decision for further review.",
            })
          }
        >
          <PauseCircle size={15} /> Review later
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => setEdit(feature.description)}
        >
          Revise wording
        </Button>
        <Button
          variant="secondary"
          disabled={busy || !assessment || !reason.trim()}
          onClick={() =>
            void command("decisions", {
              action: "reject",
              rationale: reason.trim(),
            })
          }
        >
          <X size={15} /> Reject
        </Button>
        <Button
          variant="secondary"
          disabled={voiceBusy || busy || !assessment || !voice?.configured}
          onClick={() => void speak()}
        >
          <Volume2 size={15} />{" "}
          {voiceBusy ? "Preparing voice…" : "Hear the Judge"}
        </Button>
      </div>
      <label className="field-label" htmlFor={`review-reason-${debate.run_id}`}>
        Decision note <span className="muted">(required to reject)</span>
      </label>
      <input
        id={`review-reason-${debate.run_id}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Your reason or remaining concern…"
        maxLength={2000}
      />
      {voice && !voice.configured && (
        <p className="small muted">{voice.message}</p>
      )}
      {audioUrl && (
        <audio
          ref={audio}
          controls
          autoPlay
          src={audioUrl}
          aria-label="Saved Judge verdict from ElevenLabs"
          style={{ width: "100%", marginTop: 16 }}
        />
      )}
      {edit !== null && (
        <div className="judge-revision-editor">
          <label className="field-label" htmlFor="live-judge-revision">
            Revised requirement
          </label>
          <textarea
            id="live-judge-revision"
            rows={3}
            value={edit}
            onChange={(e) => setEdit(e.target.value)}
          />
          <div className="inline-actions">
            <Button
              disabled={busy || !edit.trim()}
              onClick={() =>
                void command("decisions", {
                  action: "edit",
                  description: edit.trim(),
                  rationale:
                    reason.trim() ||
                    "PM revised the requirement after council review.",
                })
              }
            >
              Save new version
            </Button>
            <Button variant="secondary" onClick={() => setEdit(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {!assessment && (
        <div className="notice">
          <p>
            Wording changed. Ask the Judge to reassess this version before
            approving it.
          </p>
          <Button disabled={busy} onClick={() => void command("reassess", {})}>
            Reassess this version
          </Button>
        </div>
      )}
      <details className="details-panel">
        <summary>
          <MessageSquareText size={15} /> Discuss with the local Judge
        </summary>
        <div className="judge-message-list">
          {review.messages.map((item) => (
            <article
              className={`judge-message ${item.actor === "PM" ? "from-pm" : "from-judge"}`}
              key={item.id}
            >
              <strong>{item.actor === "PM" ? "You · PM" : "Judge"}</strong>
              <p>{item.text}</p>
              {item.actor === "judge" && voice?.configured && (
                <Button
                  variant="secondary"
                  disabled={voiceBusy || busy}
                  onClick={() => void speak(item.id)}
                >
                  <Volume2 size={14} /> Listen
                </Button>
              )}
            </article>
          ))}
        </div>
        <form className="judge-text-form" onSubmit={send}>
          <input
            aria-label="Message the local Judge"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ask about the evidence or propose a change…"
            maxLength={2000}
          />
          <Button disabled={busy || !assessment || !message.trim()}>
            <Send size={15} /> Ask Judge
          </Button>
        </form>
        <p className="small muted">
          {debate.model} on this laptop. Discussion does not approve or change
          the requirement automatically.
        </p>
      </details>
      {busy && (
        <p role="status">
          {message
            ? "The local Judge is reviewing your question…"
            : "Saving your review…"}
        </p>
      )}
      {(error || voiceError) && (
        <p className="error" role="alert">
          {error || voiceError}
        </p>
      )}
      {!!review.decisions.length && (
        <details className="details-panel">
          <summary>PM decision history</summary>
          {review.decisions.map((item, index) => (
            <p key={index}>
              V{item.version} · {item.action} — {item.rationale}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
