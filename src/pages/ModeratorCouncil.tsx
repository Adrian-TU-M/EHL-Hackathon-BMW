import { lazy, Suspense, useEffect, useState } from "react";
import {
  Play,
  Pause,
  Download,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  Radio,
  History,
  ChevronDown,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useAppStore } from "../store/useAppStore";
import { useModeratorStore } from "../store/useModeratorStore";
import { Badge, Button, Loading, Modal } from "../components/ui/Primitives";
import {
  moderatorApi,
  downloadRecords,
  type ModeratorSessionSummary,
} from "../lib/council/api";
import type {
  AgendaTopic,
  ModeratorControl,
  ModeratorSession,
} from "../lib/council/contracts";
import type { AgentId, AgentState, CouncilState, Topic } from "../lib/types";
import {
  ModeratorReview,
  SourceCards,
} from "../components/council/ModeratorReview";
import "../styles/moderator.css";
const CouncilScene = lazy(() => import("../components/council/CouncilScene"));
const workflow = [
  "Topic brief",
  "Independent positions",
  "Claim checks",
  "Challenges",
  "Rebuttals",
  "Judge assessment",
  "Optional clarification",
  "Closure",
];
const workflowStages = [
  "topic",
  "perspectives",
  "validation",
  "challenges",
  "rebuttals",
  "assessment",
  "clarification",
  "close",
];
const roleNames: Record<string, string> = {
  customer: "Customer",
  market: "Market",
  competitor: "Competitor",
  moderator: "Moderator",
  judge: "Judge",
};

export default function ModeratorCouncil() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSession = searchParams.get("session");
  const scope = useAppStore((s) => s.scope);
  const {
    session: s,
    events,
    error,
    connected,
    accept,
    setError,
  } = useModeratorStore();
  const [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string[] | null>(null),
    [pins, setPins] = useState<string[]>([]);
  const [override, setOverride] = useState<ModeratorControl | null>(null),
    [rationale, setRationale] = useState("");
  const [remaining, setRemaining] = useState<string[]>([]),
    [ids, setIds] = useState<string[] | null>(null),
    [expanded, setExpanded] = useState(false);
  const [sourceForm, setSourceForm] = useState(false),
    [sourceNotice, setSourceNotice] = useState("");
  const [savedSessions, setSavedSessions] = useState<ModeratorSessionSummary[]>(
    [],
  );
  const [sessionLookup, setSessionLookup] = useState("");
  const [sessionListUnavailable, setSessionListUnavailable] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [runtime, setRuntime] = useState<{
    available: boolean;
    model?: string;
    limitations: string[];
  } | null>(null);
  useEffect(() => {
    let disposed = false;
    moderatorApi
      .sessions()
      .then(({ sessions }) => {
        if (!disposed) setSavedSessions(sessions);
      })
      .catch(() => {
        // Older running backends still support opening a saved ID or shared link.
        if (!disposed) setSessionListUnavailable(true);
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    setSelected(null);
    setPins([]);
    setExpanded(false);
  }, [s?.id]);
  useEffect(() => {
    if (!s || requestedSession) return;
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("session", s.id);
        return next;
      },
      { replace: true },
    );
  }, [s, requestedSession, setSearchParams]);
  useEffect(() => {
    if (
      !requestedSession ||
      useModeratorStore.getState().session?.id === requestedSession
    )
      return;
    let disposed = false;
    moderatorApi
      .session(requestedSession)
      .then((session) => {
        if (!disposed) accept(session);
      })
      .catch((error) => {
        if (!disposed)
          setError(
            error instanceof Error
              ? error.message
              : "Saved council unavailable",
          );
      });
    return () => {
      disposed = true;
    };
  }, [requestedSession, accept, setError]);
  useEffect(() => {
    let disposed = false;
    moderatorApi
      .health()
      .then((value) => {
        if (!disposed) setRuntime(value);
      })
      .catch(() => {
        if (!disposed)
          setRuntime({
            available: false,
            limitations: ["The local council backend is unavailable."],
          });
      });
    return () => {
      disposed = true;
    };
  }, []);
  async function perform(fn: () => Promise<ModeratorSession>) {
    setBusy(true);
    setError(undefined);
    try {
      const session = await fn();
      accept(session);
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("session", session.id);
          return next;
        },
        { replace: true },
      );
    } catch (e) {
      await useModeratorStore.getState().refresh();
      setError(e instanceof Error ? e.message : "Moderator unavailable");
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    setSelected(null);
    setPins([]);
    await perform(() => moderatorApi.prepare(scope, s?.id));
  }
  function openSavedSession(value: string) {
    let id = value.trim();
    if (!id) return;
    try {
      if (id.includes("?") || id.includes("/")) {
        id =
          new URL(id, window.location.origin).searchParams.get("session") || "";
      }
    } catch {
      id = "";
    }
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      setError(
        "Enter a saved session ID or a council link containing ?session=.",
      );
      return;
    }
    setError(undefined);
    setSearchParams({ session: id, advanced: "1" });
  }
  const chosen = selected || s?.agenda.selected_ids || [],
    topic = s?.agenda.topics.find((t) => t.id === s.work?.brief.topic_id),
    latest = events.at(-1);
  const active = s?.status === "running",
    confirmed = !!s?.agenda.confirmed_at,
    paused =
      s && ["paused", "interrupted", "unavailable", "ready"].includes(s.status);
  const stageIndex = workflowStages.indexOf(s?.work?.stage || "");
  const stageLabel =
    stageIndex >= 0
      ? workflow[stageIndex]
      : s?.status === "complete"
        ? "Ready for PM review"
        : "Awaiting the next stage";
  const published = events.filter((event) =>
    ["customer", "market", "competitor", "judge"].includes(event.actor),
  );
  const latestOutcome = s?.outcomes.at(-1);
  const judgeAssessment = s?.work?.assessment || latestOutcome?.assessment;
  const judgeValid = s?.work?.assessment
    ? true
    : latestOutcome?.assessment_valid;
  const needsJudgeAttention =
    s?.status === "complete" &&
    (!s.outcomes.length ||
      s.outcomes.some(
        (outcome) =>
          !outcome.assessment_valid || !outcome.assessment?.native_assessment,
      ));
  const otherSessions = savedSessions.filter((session) => session.id !== s?.id);
  const scene: CouncilState = {
    status:
      !s || !confirmed
        ? "idle"
        : active
          ? "running"
          : s.status === "complete"
            ? "complete"
            : "paused",
    cursor: events.length - 1,
    elapsedMs: (s?.active_seconds || 0) * 1000,
    topic: (topic?.area || "Displays") as Topic,
    run: 1,
    discussion: [],
    handoff: "pending",
    events: events.map((e) => ({
      id: e.id,
      actor: ["customer", "market", "competitor", "judge"].includes(e.actor)
        ? (e.actor as "customer" | "market" | "competitor" | "judge")
        : "moderator",
      stage:
        e.stage === "challenge" || e.stage === "rebuttal"
          ? "challenge"
          : e.stage === "assessment"
            ? "assessment"
            : e.stage === "perspectives"
              ? "perspectives"
              : e.stage === "closure"
                ? "review"
                : "topic",
      statement: e.statement,
      evidenceIds: e.evidence_ids,
    })),
  };
  // Activity comes from the real saved workflow stage, independently of the
  // last published utterance. No placeholder speech enters the transcript.
  const agentStates: Partial<Record<AgentId, AgentState>> | undefined = active
    ? {
        customer: "waiting",
        market: "waiting",
        competitor: "waiting",
        moderator: "waiting",
        judge: "waiting",
      }
    : undefined;
  if (agentStates) {
    if (s?.work?.stage === "assessment") agentStates.judge = "evaluating";
    else if (
      ["perspectives", "challenges", "rebuttals", "clarification"].includes(
        s?.work?.stage || "",
      )
    ) {
      agentStates.customer =
        agentStates.market =
        agentStates.competitor =
          "thinking";
    } else agentStates.moderator = "evaluating";
  }
  function openOverride(action: ModeratorControl) {
    setRationale("");
    setOverride(action);
    setRemaining(
      s?.agenda.selected_ids.slice(s.cursor + (s.work ? 1 : 0)) || [],
    );
  }
  function move(id: string, direction: number) {
    const next = [...remaining],
      i = next.indexOf(id),
      j = i + direction;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setRemaining(next);
  }
  return (
    <div
      className={`council-page moderator-page ${confirmed ? "moderator-live" : "moderator-setup"}`}
    >
      <div className="council-page-header">
        <div>
          <div className="eyebrow">THE INTELLIGENCE COUNCIL</div>
          <h1>
            {confirmed
              ? active
                ? "The council is in session."
                : needsJudgeAttention
                  ? "Discussion closed. Review needed."
                  : s?.status === "complete"
                    ? "Your council has spoken."
                    : "Your discussion, saved."
              : "Five perspectives. One decision."}
          </h1>
          <p>
            {confirmed
              ? "Follow the arguments, inspect their evidence, then make the final call."
              : "Choose the topics. Start the debate. Let the agents challenge each other."}
          </p>
        </div>
        <Badge tone="dark">
          {s?.mode === "deterministic"
            ? "DETERMINISTIC INTEGRATION MODE"
            : s?.mode === "ollama" || runtime?.available
              ? `LOCAL COUNCIL · ${runtime?.model || "QWEN"}`
              : "CHECKING LOCAL COUNCIL"}
        </Badge>
      </div>
      {(!s || otherSessions.length > 0) && (
        <details
          className="moderator-saved"
          aria-label="Saved council debates"
          open={!s}
        >
          <summary>
            <span className="eyebrow">
              <History size={13} />{" "}
              {s ? "Other saved debates" : "Continue a debate"}
            </span>
            <ChevronDown size={14} />
          </summary>
          <p>Opening a session does not start or resume inference.</p>
          {otherSessions
            .slice(0, showAllSessions ? otherSessions.length : 3)
            .map((saved) => (
              <button
                className="moderator-saved-card"
                key={saved.id}
                onClick={() => openSavedSession(saved.id)}
              >
                <span>
                  <strong>
                    BMW {saved.scope.vehicle} · {saved.scope.market}
                  </strong>
                  <small>
                    {saved.topic_label || "Confirmed scope"} ·{" "}
                    {saved.status === "complete" &&
                    saved.native_assessment_count < saved.outcome_count
                      ? "Needs attention — Judge assessment unavailable"
                      : saved.status.replaceAll("_", " ")}
                  </small>
                </span>
                <span>
                  Open debate <ArrowUpRight size={15} />
                </span>
              </button>
            ))}
          {otherSessions.length > 3 && (
            <button
              className="text-link"
              onClick={() => setShowAllSessions(!showAllSessions)}
            >
              {showAllSessions
                ? "Show fewer"
                : `Show all recent (${otherSessions.length})`}
            </button>
          )}
          {!otherSessions.length && (
            <p>
              {sessionListUnavailable
                ? "Open the shared council link from the browser where the debate was started, or paste its session ID below."
                : "No other saved sessions yet. Prepare a new agenda below, or open a shared link."}
            </p>
          )}
        </details>
      )}
      <details className="moderator-session-link">
        <summary>Open a saved session by link or ID</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            openSavedSession(sessionLookup);
          }}
        >
          <label className="sr-only" htmlFor="saved-session-link">
            Saved council link or session ID
          </label>
          <input
            id="saved-session-link"
            value={sessionLookup}
            onChange={(event) => setSessionLookup(event.target.value)}
            placeholder="Paste a council link or session ID"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={!sessionLookup.trim()}
          >
            Open session
          </Button>
        </form>
      </details>
      {requestedSession && s?.id !== requestedSession && (
        <div className="moderator-notice" role="status">
          Opening saved debate…
        </div>
      )}
      {s &&
        (s.agenda.scope.vehicle !== scope.vehicle ||
          s.agenda.scope.market !== scope.market ||
          s.agenda.scope.powertrain !== scope.powertrain ||
          s.agenda.scope.horizon !== scope.horizon) && (
          <div className="moderator-notice" role="status">
            This saved debate retains its confirmed {s.agenda.scope.vehicle} ·{" "}
            {s.agenda.scope.market} · {s.agenda.scope.powertrain} scope. Current
            workspace filters do not change its evidence or results.
          </div>
        )}
      {!confirmed && (
        <div className="moderator-start-guide">
          <div>
            <span className="eyebrow">
              {s ? "02 / YOUR CONFIRMATION" : "01 / SET THE AGENDA"}
            </span>
            <h2>
              {s
                ? "Choose what the council should discuss."
                : "Start with your evidence."}
            </h2>
            <p>
              {s
                ? "Review the proposed topics below, then confirm to start local Qwen. Preparing an agenda alone does not start a debate."
                : "The Moderator proposes topics from the supplied data. You choose which ones enter the debate."}
            </p>
          </div>
          <Button
            disabled={
              busy || runtime?.available === false || (!!s && !chosen.length)
            }
            onClick={() =>
              s
                ? perform(async () => {
                    const next = await moderatorApi.confirm(s, chosen, pins);
                    return moderatorApi.control(next, "start");
                  })
                : prepare()
            }
          >
            <Play size={15} />{" "}
            {busy
              ? "Preparing…"
              : s
                ? "Confirm agenda & start debate"
                : "Prepare agenda"}
          </Button>
        </div>
      )}
      <details className="moderator-about">
        <summary>How this council works · sources & scope</summary>
        <div className="moderator-notice">
          Customer, Market and Competitor specialists debate the same confirmed
          scope. The Moderator checks claims; the Judge applies the requirement
          rubric. All reasoning runs on your laptop. The PM starts the debate
          and reviews its outcome.{" "}
          {s?.mode === "deterministic" &&
            "Integration mode quotes sources and exercises the workflow; it does not generate final requirement scores."}{" "}
          <button className="text-link" onClick={() => setSourceForm(true)}>
            Import external source
          </button>
        </div>
      </details>
      {runtime && !runtime.available && (
        <div className="moderator-notice error" role="alert">
          {runtime.limitations.join(" · ") ||
            "Start Ollama and make sure the shared Qwen model is installed."}
        </div>
      )}
      {sourceNotice && (
        <div className="moderator-notice" role="status">
          {sourceNotice}
        </div>
      )}
      {error && (
        <div className="moderator-notice error" role="alert">
          {error}
        </div>
      )}
      {s?.availability.length ? (
        <div className="moderator-notice" role="status">
          Live configuration unavailable: {s.availability.join(" · ")}
        </div>
      ) : null}
      {confirmed && (
        <div className="moderator-live-toolbar">
          <div>
            <span
              className={`moderator-status-dot ${active ? "is-live" : ""}`}
            />
            <strong>
              {active
                ? "Live debate"
                : needsJudgeAttention
                  ? "Needs attention"
                  : s?.status === "complete"
                    ? "Debate complete"
                    : s?.status.replaceAll("_", " ")}
            </strong>
            <span>
              {needsJudgeAttention
                ? "Judge assessment unavailable"
                : stageLabel}
            </span>
          </div>
          <div>
            {active || paused ? (
              <Button
                disabled={busy || !!s?.work?.blocked_preference}
                onClick={() =>
                  perform(() =>
                    moderatorApi.control(
                      s!,
                      active
                        ? "pause"
                        : s!.status === "ready"
                          ? "start"
                          : "resume",
                    ),
                  )
                }
              >
                {active ? <Pause size={14} /> : <Play size={14} />}
                {active ? "Pause discussion" : "Resume discussion"}
              </Button>
            ) : null}
            <a className="text-link" href="#moderator-judge-review">
              Judge & PM review <ArrowDown size={14} />
            </a>
          </div>
        </div>
      )}
      {confirmed && (
        <div className="council-stagebar" aria-label="Debate stages">
          {workflow.map((label, i) => (
            <div
              key={label}
              className={s?.work?.stage === workflowStages[i] ? "current" : ""}
            >
              <span>{i + 1}</span>
              <strong>{label}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="council-layout">
        <aside className="council-context">
          <details className="moderator-session-tools" open={!confirmed}>
            <summary>
              Scope & session controls <ChevronDown size={14} />
            </summary>
            <div className="eyebrow">
              {confirmed ? "CONFIRMED SCOPE" : "PROPOSED SCOPE"}
            </div>
            <h2>
              {s?.agenda.scope.vehicle || scope.vehicle} /{" "}
              {s?.agenda.scope.market || scope.market}
            </h2>
            <p>
              {s?.agenda.scope.powertrain || scope.powertrain} ·{" "}
              {2026 + (s?.agenda.scope.horizon || scope.horizon)}
            </p>
            <p>
              {s?.agenda.scope.prompt ||
                scope.prompt ||
                "Balanced customer priorities"}
            </p>
            <div className="council-rules">
              <span>3 independent positions</span>
              <span>1 challenge per specialist</span>
              <span>1 clarification maximum</span>
              <span>Shared local Qwen · one inference at a time</span>
            </div>
            <div className="council-controls">
              {s?.status === "complete" ? (
                <Button
                  onClick={prepare}
                  disabled={busy || runtime?.available === false}
                >
                  {busy
                    ? "Preparing…"
                    : s
                      ? "Prepare linked new run"
                      : "Prepare agenda"}
                </Button>
              ) : null}
              {confirmed && s?.status !== "complete" ? (
                <>
                  {(
                    [
                      "interrupt",
                      "challenge",
                      "skip",
                      "reorder",
                      "finish",
                    ] as const
                  ).map((action) => (
                    <Button
                      key={action}
                      variant="secondary"
                      disabled={busy || (action === "challenge" && !s.work)}
                      onClick={() =>
                        action === "interrupt"
                          ? perform(() => moderatorApi.control(s, action))
                          : openOverride(action)
                      }
                    >
                      {
                        {
                          interrupt: "Interrupt",
                          challenge: "Challenge",
                          skip: "Skip current topic",
                          reorder: "Reorder remaining topics",
                          finish: "Finish session",
                        }[action]
                      }
                    </Button>
                  ))}
                </>
              ) : null}
              {s && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      downloadRecords(await moderatorApi.export(s.id));
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  <Download size={14} /> Export versioned records
                </Button>
              )}
              {s?.parent_session_id && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    perform(() => moderatorApi.session(s.parent_session_id!))
                  }
                >
                  Inspect previous linked run
                </Button>
              )}
            </div>
            <div className="council-runtime">
              <span>
                {s?.status.replaceAll("_", " ") || "No session"} ·{" "}
                {connected ? "events connected" : "events disconnected"}
              </span>
              <small>
                {s?.outcomes.length || 0} / {s?.agenda.selected_ids.length || 0}{" "}
                topics closed · {s?.tokens || 0} model tokens charged
              </small>
            </div>
            {s?.work?.blocked_preference && (
              <div className="moderator-notice">
                A scope or substantive preference change needs a newly confirmed
                agenda.
                <Button variant="secondary" onClick={prepare} disabled={busy}>
                  Prepare linked agenda
                </Button>
              </div>
            )}
          </details>
        </aside>
        <section className="council-center">
          {confirmed && (
            <section
              className="moderator-conversation"
              aria-label="Published live debate"
            >
              <div className="flex-between">
                <span className="eyebrow">
                  <Radio size={14} /> THE DISCUSSION
                </span>
                <small>
                  {published.length} published turns ·{" "}
                  {connected
                    ? "Connected"
                    : active
                      ? "Reconnecting"
                      : "Saved record"}
                </small>
              </div>
              <h2>
                {topic?.label ||
                  latestOutcome?.packet.brief.question ||
                  "Your confirmed topics"}
              </h2>
              {active && (
                <p className="moderator-inference-note" role="status">
                  {runtime?.model || "Local Qwen"} is{" "}
                  {stageLabel.toLowerCase() === "claim checks"
                    ? "checking the claims"
                    : `working on ${stageLabel.toLowerCase()}`}
                  . Each checked stage can take several minutes on this laptop.
                  Statements appear when generation and evidence checks finish.
                </p>
              )}
              <div
                className="moderator-live-feed"
                aria-live="polite"
                aria-relevant="additions"
              >
                {published.length ? (
                  published
                    .slice(-4)
                    .reverse()
                    .map((event) => (
                      <article
                        className={`moderator-utterance role-${event.actor}`}
                        key={event.id}
                      >
                        <div>
                          <strong>
                            {roleNames[event.actor] || event.actor}
                          </strong>
                          <span>
                            {event.stage.replaceAll("_", " ")} · #
                            {event.sequence}
                          </span>
                        </div>
                        <p>{event.statement}</p>
                        {!!event.evidence_ids.length && (
                          <button
                            className="text-link"
                            onClick={() => setIds(event.evidence_ids)}
                          >
                            Inspect evidence ({event.evidence_ids.length}){" "}
                            <ArrowUpRight size={13} />
                          </button>
                        )}
                      </article>
                    ))
                ) : (
                  <div className="moderator-waiting">
                    <span className="moderator-status-dot" />
                    <div>
                      <strong>
                        {(s?.sequence || 0) > 0
                          ? "Loading the published discussion…"
                          : active && s?.work?.stage === "perspectives"
                            ? "The agents are preparing their opening positions."
                            : "No specialist position has been published yet."}
                      </strong>
                      <p>
                        {(s?.sequence || 0) > 0
                          ? "Restoring the saved transcript. The live stage shown above comes from the current session."
                          : active
                            ? "Customer, Market and Competitor read the frozen evidence independently. Their checked arguments will appear here."
                            : "Resume the discussion to continue from the saved stage."}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="moderator-stream-footer">
                <button
                  className="text-link"
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? "Hide full transcript" : "Read full transcript"} (
                  {events.length})
                </button>
                <span>
                  {s?.outcomes.length || 0} of{" "}
                  {s?.agenda.selected_ids.length || 0} topics closed
                </span>
              </div>
            </section>
          )}
          <div className="chamber-caption">
            <span>
              COUNCIL CHAMBER /{" "}
              {s ? Math.min(s.cursor + 1, s.agenda.selected_ids.length) : "—"}
            </span>
            <span>{topic?.label || "Agenda preparation"}</span>
          </div>
          <Suspense fallback={<Loading label="Preparing council chamber…" />}>
            <CouncilScene council={scene} agentStates={agentStates} />
          </Suspense>
          {!confirmed && (
            <div className="speaker-card">
              <div className="eyebrow">
                {latest
                  ? `${latest.actor.toUpperCase()} / ${latest.stage}`
                  : "MODERATOR"}
              </div>
              <p aria-live="polite">
                {latest?.statement ||
                  "The council is ready when you are. Prepare an agenda, choose your topics, then confirm to begin the live debate."}
              </p>
              {latest?.evidence_ids.length ? (
                <button
                  className="text-link"
                  onClick={() => setIds(latest.evidence_ids)}
                >
                  Inspect cited sources ({latest.evidence_ids.length})
                </button>
              ) : null}
              <button
                className="text-link"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded
                  ? "Collapse transcript"
                  : "Show complete published transcript"}{" "}
                ({events.length})
              </button>
            </div>
          )}
        </section>
        <aside className="council-evidence">
          {confirmed && (
            <div className="moderator-judge-focus">
              <span className="eyebrow">THE JUDGE</span>
              <h2>
                {judgeAssessment?.native_assessment && judgeValid
                  ? "An assessment to consider."
                  : needsJudgeAttention
                    ? "Assessment unavailable."
                    : "Evidence before a verdict."}
              </h2>
              <p>
                {judgeValid && judgeAssessment?.native_assessment
                  ? judgeAssessment.summary
                  : needsJudgeAttention
                    ? "The discussion is saved, but it did not produce a valid Judge assessment. Inspect the recorded outcome before taking a decision."
                    : "The Judge weighs the published positions, challenges and rebuttals. Your approval is always a separate step."}
              </p>
              {judgeValid && judgeAssessment?.native_assessment ? (
                <a className="text-link" href="#moderator-judge-review">
                  Read assessment & hear the Judge <ArrowDown size={14} />
                </a>
              ) : (
                <small>
                  {active
                    ? "Waiting for the checked debate"
                    : "No final approval is implied"}
                </small>
              )}
            </div>
          )}
          <details className="moderator-evidence-details" open={!confirmed}>
            <summary>Topic evidence & claim checks</summary>
            <div className="eyebrow">DECISION COVERAGE</div>
            <h3>{topic?.question || "Source-grounded agenda"}</h3>
            <p>
              {topic?.rationale ||
                "Every candidate remains in the backlog with its score interval and known-weight coverage."}
            </p>
            {s?.work && (
              <>
                <p>
                  {Math.round(s.work.active_seconds)} / {s.limits.topic_seconds}{" "}
                  active seconds
                  <br />
                  {s.work.tokens} / {s.limits.topic_tokens} topic tokens
                </p>
                <p>
                  {
                    s.work.claims.filter((c) => c.validation === "supported")
                      .length
                  }{" "}
                  supported claims ·{" "}
                  {
                    s.work.claims.filter((c) => c.validation !== "supported")
                      .length
                  }{" "}
                  unsupported/unverified
                </p>
                {s.work.challenges.map((c) => (
                  <p key={c.id}>
                    <Badge>{c.status}</Badge> {c.question}
                  </p>
                ))}
              </>
            )}
            {topic && (
              <button
                className="text-link"
                onClick={() => setIds(topic.evidence_ids)}
              >
                Inspect topic evidence ({topic.evidence_ids.length})
              </button>
            )}
          </details>
        </aside>
      </div>
      <div id="moderator-judge-review">
        <ModeratorReview />
      </div>
      {s && (
        <details
          className="moderator-section moderator-agenda-panel"
          open={!confirmed}
        >
          <summary>
            <span>
              {confirmed
                ? "Frozen agenda & backlog"
                : "Review the proposed agenda"}
            </span>
            <span>
              {chosen.length} selected <ChevronDown size={15} />
            </span>
          </summary>
          <div className="flex-between">
            <h2>
              {confirmed
                ? "Frozen agenda & backlog"
                : "Review the proposed agenda"}
            </h2>
            <Badge>
              {chosen.length} selected / {s.agenda.topics.length} candidates
            </Badge>
          </div>
          <p>
            Need 40% · severity 35% · future relevance 20% · verified
            competitive gap 5%. Missing factors retain their possible range.
            Pins come first, then substantiated severe issues, supported score,
            PM relevance, coverage, and stable ID.
          </p>
          {s.agenda.warnings.map((w) => (
            <p key={w} className="muted">
              {w}
            </p>
          ))}
          <div className="moderator-agenda">
            {s.agenda.topics.map((t) => (
              <AgendaRow
                key={t.id}
                topic={t}
                selected={chosen.includes(t.id)}
                pinned={pins.includes(t.id) || t.pinned}
                frozen={confirmed}
                position={s.agenda.selected_ids.indexOf(t.id) + 1}
                toggle={() =>
                  setSelected(
                    chosen.includes(t.id)
                      ? chosen.filter((i) => i !== t.id)
                      : [...chosen, t.id],
                  )
                }
                pin={() =>
                  setPins(
                    pins.includes(t.id)
                      ? pins.filter((i) => i !== t.id)
                      : [...pins, t.id],
                  )
                }
                sources={setIds}
              />
            ))}
          </div>
        </details>
      )}
      {expanded && (
        <section className="moderator-section">
          <h2>Complete published transcript</h2>
          {events.map((e) => (
            <article className="moderator-record" key={e.id}>
              <small>
                #{e.sequence} · {e.topic_id || "Session"} · {e.actor} /{" "}
                {e.stage}
              </small>
              <p>{e.statement}</p>
              {!!e.evidence_ids.length && (
                <button
                  className="text-link"
                  onClick={() => setIds(e.evidence_ids)}
                >
                  Source cards
                </button>
              )}
              <details>
                <summary>Structured event and assumption versions</summary>
                <pre>{JSON.stringify(e.data, null, 2)}</pre>
                <pre>{JSON.stringify(e.assumption_versions)}</pre>
              </details>
            </article>
          ))}
        </section>
      )}
      {ids && <SourceCards ids={ids} onClose={() => setIds(null)} />}
      {sourceForm && (
        <ExternalSourceForm
          onClose={() => setSourceForm(false)}
          imported={(message) => {
            setSourceNotice(message);
            setSourceForm(false);
          }}
        />
      )}
      {override && s && (
        <Modal
          title={`${override[0].toUpperCase()}${override.slice(1)} session`}
          onClose={() => setOverride(null)}
        >
          <p>
            {override === "challenge"
              ? "Your question is published to the judge packet. The workflow pauses before resuming."
              : "This override preserves completed topics and records your rationale."}
          </p>
          {override === "reorder" && (
            <ol className="moderator-order">
              {remaining.map((id, i) => (
                <li key={id}>
                  <span>{s.agenda.topics.find((t) => t.id === id)?.label}</span>
                  <button
                    aria-label={`Move ${id} earlier`}
                    disabled={i === 0}
                    onClick={() => move(id, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    aria-label={`Move ${id} later`}
                    disabled={i === remaining.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <label className="field-label" htmlFor="override-rationale">
            Rationale or specific question
          </label>
          <textarea
            id="override-rationale"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={4}
          />
          <Button
            disabled={busy || !rationale.trim()}
            onClick={async () => {
              await perform(() =>
                moderatorApi.control(s, override, rationale, remaining),
              );
              setOverride(null);
            }}
          >
            Record {override}
          </Button>
        </Modal>
      )}
    </div>
  );
}

function ExternalSourceForm({
  onClose,
  imported,
}: {
  onClose: () => void;
  imported: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Import an external source" onClose={onClose}>
      <p>
        Use a public HTTPS HTML, text or PDF source. Publication, market and
        model claims must match the document. New imports enter new agendas;
        confirmed runs retain their evidence.
      </p>
      <form
        className="moderator-source-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const body = Object.fromEntries(data.entries());
          setBusy(true);
          setError("");
          try {
            const result = await moderatorApi.external({
              ...body,
              published_at: body.published_at || null,
              vehicle: body.vehicle || null,
              region: body.region || null,
            });
            imported(result.message);
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <p role="alert">{error}</p>}
        <label className="field-label" htmlFor="external-url">
          Public HTTPS source URL
        </label>
        <input
          id="external-url"
          name="url"
          type="url"
          required
          placeholder="https://…"
        />
        <label className="field-label" htmlFor="external-title">
          Document title
        </label>
        <input id="external-title" name="title" required />
        <label className="field-label" htmlFor="external-publisher">
          Publisher
        </label>
        <input id="external-publisher" name="publisher" required />
        <label className="field-label" htmlFor="external-domain">
          Evidence domain
        </label>
        <select id="external-domain" name="domain" defaultValue="competitor">
          {["competitor", "market", "customer", "product", "corporate"].map(
            (d) => (
              <option key={d}>{d}</option>
            ),
          )}
        </select>
        <label className="field-label" htmlFor="external-quality">
          Declared source quality
        </label>
        <select id="external-quality" name="quality" defaultValue="unverified">
          {["unverified", "primary", "secondary"].map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <label className="field-label" htmlFor="external-vehicle">
          BMW applicability documented by source
        </label>
        <select id="external-vehicle" name="vehicle" defaultValue="">
          <option value="">Unspecified / context</option>
          {["F70", "G60", "G68", "G70", "G60_G68"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <label className="field-label" htmlFor="external-region">
          Documented market
        </label>
        <select id="external-region" name="region" defaultValue="">
          <option value="">Unspecified / context</option>
          {["Germany", "EU", "Europe", "United States", "China"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <label className="field-label" htmlFor="external-date">
          Publication date (leave blank if unknown)
        </label>
        <input id="external-date" name="published_at" type="date" />
        <Button type="submit" disabled={busy}>
          {busy ? "Importing…" : "Import and preserve source"}
        </Button>
      </form>
    </Modal>
  );
}

function AgendaRow({
  topic: t,
  selected,
  pinned,
  frozen,
  position,
  toggle,
  pin,
  sources,
}: {
  topic: AgendaTopic;
  selected: boolean;
  pinned: boolean;
  frozen: boolean;
  position: number;
  toggle: () => void;
  pin: () => void;
  sources: (ids: string[]) => void;
}) {
  return (
    <article className={`moderator-record ${selected ? "selected" : ""}`}>
      <div className="flex-between">
        <label>
          <input
            type="checkbox"
            checked={selected}
            disabled={frozen || !t.eligible}
            onChange={toggle}
          />{" "}
          {frozen && position > 0 ? `${position}. ` : ""}
          <strong>{t.label}</strong>
        </label>
        <Badge>
          {selected ? "Selected" : "Backlog"}{" "}
          {t.exploratory ? "· exploratory" : ""}
        </Badge>
      </div>
      <p>{t.question}</p>
      <p>
        <strong>
          {t.lower_score}–{t.upper_score} / 100
        </strong>{" "}
        · known weight {t.coverage}% · {t.observation_count} / {t.denominator}{" "}
        scoped observations
      </p>
      <details>
        <summary>Selection rationale and evidence</summary>
        <p>{t.rationale}</p>
        {Object.entries(t.ratings).map(([key, r]) => (
          <p key={key}>
            <strong>
              {key}: {r.value ?? "unknown"}
            </strong>{" "}
            — {r.rationale}{" "}
            {!!r.evidence_ids.length && (
              <button
                className="text-link"
                onClick={() => sources(r.evidence_ids)}
              >
                Evidence
              </button>
            )}
          </p>
        ))}
        <p>{t.limitations.join(" ")}</p>
        <button className="text-link" onClick={() => sources(t.evidence_ids)}>
          All supporting signals and counterevidence
        </button>
      </details>
      {!frozen && selected && (
        <label>
          <input type="checkbox" checked={pinned} onChange={pin} /> PM pin
          (discuss first)
        </label>
      )}
    </article>
  );
}
