import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Download,
  History,
  Pause,
  Play,
  Radio,
  RotateCcw,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { useCouncilSession } from "../components/council/useCouncilSession";
import {
  moderatorApi,
  downloadRecords,
  type ModeratorSessionSummary,
} from "../lib/council/api";
import { SourceCards } from "../components/council/ModeratorReview";
import { JuryConversation } from "../components/council/JuryConversation";
import { AgendaDialog } from "../components/council/AgendaDialog";
import { agentMeta } from "../components/agents/AgentSculpture";
import { Button } from "../components/ui/Primitives";
import type { AgentId, AgentState, CouncilState } from "../lib/types";
import type { ModeratorEvent } from "../lib/council/contracts";
import "../styles/vehicle-council.css";

const CouncilScene = lazy(() => import("../components/council/CouncilScene"));
const stages: Record<string, string> = {
  perspectives: "Opening positions",
  moderation: "Moderator framing the disagreement",
  synthesis: "Moderator reviewing the responses",
  validation: "Checking sources",
  challenges: "Cross-examination",
  rebuttals: "Responses",
  rebuttal_validation: "Checking responses",
  assessment: "Jury deliberation",
  clarification: "Clarifying uncertainty",
  clarification_validation: "Checking clarification",
  close: "Saving verdict",
};
const isAgent = (actor: string): actor is AgentId => actor in agentMeta;
const isSpeech = (e: ModeratorEvent) =>
  isAgent(e.actor) &&
  [
    "perspective",
    "perspectives",
    "challenge",
    "rebuttal",
    "assessment",
    "clarification",
    "topic",
    "moderation",
    "closure",
  ].includes(e.stage);

function challengePosition(event: ModeratorEvent): string | undefined {
  if (event.stage !== "challenge") return;
  const challenge = event.data.challenge as
    | {
        reasoning?: string;
        native_output?: {
          statement?: string;
          position?: { rationale?: string };
        };
      }
    | undefined;
  return (
    challenge?.reasoning ||
    challenge?.native_output?.position?.rationale ||
    challenge?.native_output?.statement
  );
}

export default function VehicleCouncil() {
  const scope = useAppStore((s) => s.scope);
  const [params, setParams] = useSearchParams();
  const {
    session: saved,
    events,
    accept,
    error,
    setError,
    connected,
    loading,
    loadError,
  } = useCouncilSession();
  const s = params.get("new") === "1" ? undefined : saved;
  const [busy, setBusy] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(params.get("advanced") === "1");
  const [tab, setTab] = useState<"discussion" | "jury" | "agenda">(
    "discussion",
  );
  const [history, setHistory] = useState(false);
  const [sessions, setSessions] = useState<ModeratorSessionSummary[]>([]);
  const [ids, setIds] = useState<string[] | null>(null);
  const [filter, setFilter] = useState<AgentId | null>(null);
  const [runtime, setRuntime] = useState<{
    available: boolean;
    model?: string;
    limitations: string[];
  }>();
  const command = useRef(crypto.randomUUID());
  const feed = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    let cancelled = false;
    moderatorApi
      .health()
      .then((x) => {
        if (!cancelled) setRuntime(x);
      })
      .catch(() => {
        if (!cancelled)
          setRuntime({
            available: false,
            limitations: ["Start the local backend to connect the council."],
          });
      });
    moderatorApi
      .sessions()
      .then((x) => {
        if (!cancelled) setSessions(x.sessions);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    command.current = crypto.randomUUID();
  }, [
    scope.vehicle,
    scope.market,
    scope.powertrain,
    scope.horizon,
    scope.prompt,
  ]);
  useEffect(() => {
    setFilter(null);
    follow.current = true;
  }, [s?.id]);
  useEffect(() => {
    if (follow.current && feed.current)
      feed.current.scrollTop = feed.current.scrollHeight;
  }, [events.length, filter, tab]);
  const active = s?.status === "running";
  const completed = s?.status === "complete";
  const topic = s?.agenda.topics.find((t) => t.id === s.work?.brief.topic_id);
  const agenda =
    s?.agenda.topics.filter((t) => s.agenda.selected_ids.includes(t.id)) || [];
  const published = s ? events.filter(isSpeech) : [];
  const last = published.at(-1);
  const [recentSpeaker, setRecentSpeaker] = useState<string | null>(null);
  useEffect(() => {
    const remaining = last
      ? 12000 - (Date.now() - Date.parse(last.timestamp))
      : 0;
    setRecentSpeaker(remaining > 0 ? last!.actor : null);
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRecentSpeaker(null), remaining);
    return () => clearTimeout(timer);
  }, [last?.id, last?.timestamp, last?.actor]);
  const outcomes =
    s?.outcomes.filter(
      (o) => o.assessment_valid && o.assessment?.native_assessment,
    ) || [];
  const [juryTopic, setJuryTopic] = useState("");
  const outcome =
    outcomes.find((o) => o.topic_id === juryTopic) || outcomes.at(-1);
  const states: Partial<Record<AgentId, AgentState>> = Object.fromEntries(
    Object.keys(agentMeta).map((a) => [a, "idle"]),
  );
  if (active) {
    if (s.work?.stage === "assessment") states.judge = "evaluating";
    else if (s.work?.stage?.includes("validation"))
      states.moderator = "evaluating";
    else states.customer = states.market = states.competitor = "thinking";
  }
  if (
    recentSpeaker &&
    isAgent(recentSpeaker) &&
    active &&
    s?.work?.stage !== "assessment"
  )
    states[recentSpeaker] = "speaking";
  const scene: CouncilState = {
    status: active ? "running" : completed ? "complete" : "idle",
    cursor: -1,
    elapsedMs: 0,
    topic: "Displays",
    run: 1,
    discussion: [],
    handoff: "pending",
    events: [],
  };
  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      setAgendaOpen(true);
      if (s?.status === "awaiting_confirmation") return;
      const next = await moderatorApi.startVehicle(
        scope,
        command.current,
        true,
      );
      accept(next);
      setParams({ session: next.id });
      setTab("discussion");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start council");
    } finally {
      setBusy(false);
    }
  }
  async function beginSelected(ids: string[]) {
    if (!s) return;
    setBusy(true);
    setError(undefined);
    try {
      const confirmed =
        s.status === "awaiting_confirmation"
          ? await moderatorApi.confirm(s, ids, [])
          : s;
      accept(confirmed);
      const running = await moderatorApi.control(confirmed, "start");
      accept(running);
      setAgendaOpen(false);
      setParams({ session: running.id });
      setTab("discussion");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start debate");
    } finally {
      setBusy(false);
    }
  }
  async function control() {
    if (!s) return;
    setBusy(true);
    setError(undefined);
    try {
      accept(
        await moderatorApi.control(
          s,
          active ? "pause" : s.status === "ready" ? "start" : "resume",
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update council");
    } finally {
      setBusy(false);
    }
  }
  const needsReview =
    completed && (outcomes.length !== s.outcomes.length || !outcomes.length);
  const status = loading
    ? "Opening saved council"
    : busy && !s
      ? "Preparing the full car agenda"
      : active
        ? stages[s.work?.stage || ""] || "Moderator preparing the next topic"
        : needsReview
          ? "Discussion closed · Jury review needed"
          : completed
            ? "Council complete"
            : s
              ? s.status === "awaiting_confirmation"
                ? "Choose your debate topics"
                : "Council paused"
              : "Ready when you are";
  return (
    <div className="vehicle-council">
      {agendaOpen && (
        <AgendaDialog
          key={s?.id || "preparing"}
          session={s}
          busy={busy}
          error={error}
          onStart={beginSelected}
          onClose={() => {
            setAgendaOpen(false);
            if (s) setParams({ session: s.id });
          }}
        />
      )}
      <header className="vc-heading">
        <div>
          <span className="eyebrow">BMW NEXT / AGENT COUNCIL</span>
          <h1>One car. Five perspectives.</h1>
          <p>
            {s?.agenda.scope.vehicle || scope.vehicle} ·{" "}
            {s?.agenda.scope.market || scope.market} ·{" "}
            {s?.agenda.scope.powertrain || scope.powertrain}
          </p>
        </div>
        <div className="vc-actions">
          <Button
            variant="secondary"
            onClick={() => setHistory(!history)}
            aria-expanded={history}
          >
            <History size={16} /> Saved councils
          </Button>
          {s && !active && (
            <Button
              variant="secondary"
              onClick={() => {
                command.current = crypto.randomUUID();
                setParams({ new: "1" });
              }}
            >
              <RotateCcw size={15} /> New council
            </Button>
          )}
          {s?.agenda.confirmed_at && !completed ? (
            <Button disabled={busy || loading} onClick={control}>
              {active ? <Pause size={16} /> : <Play size={16} />}
              {active ? "Pause debate" : "Resume debate"}
            </Button>
          ) : (
            !completed && (
              <Button
                disabled={busy || loading || !runtime?.available}
                onClick={start}
              >
                <Play size={16} />
                {busy ? "Starting…" : "Start car debate"}
              </Button>
            )
          )}
          {!!s?.outcomes.length && (
            <Link className="vc-link-button" to={`/decisions?session=${s.id}`}>
              Review decisions <ArrowRight size={16} />
            </Link>
          )}
        </div>
      </header>
      {(error || loadError) && (
        <p className="vc-error" role="alert">
          {loadError || error}
        </p>
      )}
      {s &&
        (s.agenda.scope.vehicle !== scope.vehicle ||
          s.agenda.scope.market !== scope.market ||
          s.agenda.scope.powertrain !== scope.powertrain) && (
          <p className="vc-timing">
            Viewing the saved {s.agenda.scope.vehicle} · {s.agenda.scope.market}{" "}
            · {s.agenda.scope.powertrain} council. Its evidence and scope remain
            attached to that car.
          </p>
        )}
      {!runtime?.available &&
        runtime?.limitations.map((x) => (
          <p className="vc-error" key={x}>
            {x}
          </p>
        ))}
      {history && (
        <section className="vc-history" aria-label="Saved councils">
          <h2>Continue a council</h2>
          {sessions.length ? (
            sessions.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setParams({ session: item.id });
                  setHistory(false);
                }}
              >
                <strong>
                  {item.scope.vehicle} · {item.scope.market}
                </strong>
                <span>
                  {item.status} · {item.outcome_count}/{item.selected_count}{" "}
                  topics reviewed
                </span>
                <small>
                  {item.created_at
                    ? new Date(item.created_at).toLocaleString()
                    : item.id}
                </small>
              </button>
            ))
          ) : (
            <p>No saved councils yet.</p>
          )}
        </section>
      )}
      <div className="vc-workspace">
        <section className="vc-chamber" aria-label="Live council chamber">
          <div className="vc-chamber-top">
            <span className={active ? "vc-live" : ""}>
              <Radio size={14} /> {status}
            </span>
            <small>
              {runtime?.model || "Local Qwen"}
              {active && !connected ? " · reconnecting" : ""}
            </small>
          </div>
          <Suspense
            fallback={
              <div className="vc-scene-loading">
                Preparing the council table…
              </div>
            }
          >
            <CouncilScene
              council={scene}
              agentStates={states}
              onSelectAgent={(agent) => {
                setFilter((previous) => (previous === agent ? null : agent));
                setTab("discussion");
              }}
              selectedAgent={filter}
            />
          </Suspense>
          <div className="vc-chamber-caption">
            <span>
              {active
                ? `${topic?.label || "Full car agenda"} · ${Math.min((s?.cursor || 0) + 1, agenda.length)} of ${agenda.length}`
                : completed
                  ? `${outcomes.length} Jury verdict${outcomes.length === 1 ? "" : "s"} ready for your review`
                  : "Customer needs. Market direction. Competitive advantage."}
            </span>
            <small>
              Drag to orbit · select an agent to read their contributions
            </small>
          </div>
        </section>
        <div className="vc-workspace-panel">
          {!s ? (
            <section className="vc-ready">
              <div>
                <span className="eyebrow">
                  YOU SET THE CAR. MODERATOR SETS THE AGENDA.
                </span>
                <h2>A complete vehicle review.</h2>
                <p>
                  Choose the topics. Moderator guides the debate, the agents
                  challenge and refine their proposals, and Jury sends concrete
                  requirements to Decisions & Scenarios for your approval.
                </p>
              </div>
              <div className="vc-flow">
                <span>
                  01 <b>Debate</b>
                </span>
                <span>
                  02 <b>Discuss with Jury</b>
                </span>
                <span>
                  03 <b>PM decision</b>
                </span>
              </div>
            </section>
          ) : (
            <>
              <div className="vc-progress">
                <div
                  style={{
                    width: `${agenda.length ? (s.outcomes.length / agenda.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <div
                className="vc-tabs"
                role="tablist"
                aria-label="Council workspace"
              >
                {(
                  [
                    ["discussion", "Live discussion"],
                    ["jury", "Talk to Jury"],
                    ["agenda", "Full agenda"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={tab === value}
                    onClick={() =>
                      value === "agenda" ? setAgendaOpen(true) : setTab(value)
                    }
                  >
                    {label}
                    {value === "jury" && outcomes.length > 0 && (
                      <span>{outcomes.length}</span>
                    )}
                  </button>
                ))}
                <small>
                  {s.outcomes.length}/{agenda.length} topics closed
                </small>
              </div>
              {tab === "discussion" && (
                <section
                  className="vc-discussion"
                  aria-label="Published live debate"
                >
                  <div className="vc-discussion-heading">
                    <h2>
                      {filter
                        ? `${agentMeta[filter].name} contributions`
                        : "At the table"}
                    </h2>
                    <span>{published.length} published turns</span>
                    {filter && (
                      <button
                        className="text-link"
                        onClick={() => setFilter(null)}
                      >
                        Show everyone
                      </button>
                    )}
                  </div>
                  <div
                    className="vc-transcript"
                    ref={feed}
                    onScroll={() => {
                      const el = feed.current;
                      if (el)
                        follow.current =
                          el.scrollHeight - el.scrollTop - el.clientHeight < 70;
                    }}
                    role="log"
                    aria-label="Council transcript"
                    aria-live="polite"
                    aria-relevant="additions"
                  >
                    {published
                      .filter((e) => !filter || e.actor === filter)
                      .map((e) => (
                        <article className={`vc-turn vc-${e.actor}`} key={e.id}>
                          <img
                            className="vc-character-portrait"
                            src={`/images/agents/${e.actor}.png`}
                            alt={`${agentMeta[e.actor as AgentId]?.name} character`}
                            width={64}
                            height={64}
                          />
                          <div>
                            <header>
                              <strong>
                                {agentMeta[e.actor as AgentId]?.name}
                              </strong>
                              <span>
                                {e.stage.replaceAll("_", " ")} ·{" "}
                                {
                                  s.agenda.topics.find(
                                    (t) => t.id === e.topic_id,
                                  )?.label
                                }
                              </span>
                            </header>
                            {e.stage === "rebuttal" && !!e.data.challenge && (
                              <blockquote>
                                Replying to{" "}
                                {
                                  (
                                    e.data.challenge as {
                                      actor: string;
                                      question: string;
                                    }
                                  ).actor
                                }
                                :{" "}
                                {
                                  (
                                    e.data.challenge as {
                                      actor: string;
                                      question: string;
                                    }
                                  ).question
                                }
                              </blockquote>
                            )}
                            {e.stage === "challenge" && !!e.data.challenge && (
                              <small className="vc-challenge-target">
                                To{" "}
                                {
                                  (e.data.challenge as { target_actor: string })
                                    .target_actor
                                }
                              </small>
                            )}
                            {challengePosition(e) && (
                              <p className="vc-challenge-position">
                                {challengePosition(e)}
                              </p>
                            )}
                            <p>
                              {e.stage === "challenge" &&
                                challengePosition(e) && (
                                  <strong>My question: </strong>
                                )}
                              {e.statement}
                            </p>
                            {e.stage === "moderation" && !!e.data.questions && (
                              <div className="moderator-prompts">
                                {Object.entries(
                                  e.data.questions as Record<string, string>,
                                ).map(([role, question]) => (
                                  <p key={role}>
                                    <strong>
                                      {agentMeta[role as AgentId]?.name || role}
                                    </strong>{" "}
                                    · {question}
                                  </p>
                                ))}
                              </div>
                            )}
                            {e.evidence_ids.length > 0 && (
                              <button
                                className="text-link"
                                onClick={() => setIds(e.evidence_ids)}
                              >
                                {e.evidence_ids.length} source
                                {e.evidence_ids.length === 1 ? "" : "s"} ↗
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    {!published.length && (
                      <div className="vc-empty">
                        <Radio size={28} />
                        <h3>
                          {active
                            ? "The agents are reading the car’s evidence."
                            : "The published discussion will appear here."}
                        </h3>
                        <p>
                          Actual statements appear when each turn is ready. The
                          stage above updates while local Qwen works.
                        </p>
                      </div>
                    )}
                    {active && (
                      <div className="vc-working" role="status">
                        <i />
                        <span>
                          {stages[s.work?.stage || ""] ||
                            "Moderator preparing the next topic"}
                          …
                        </span>
                      </div>
                    )}
                  </div>
                  <footer className="vc-transcript-footer">
                    <small>
                      Saved automatically · ordered from first to latest
                    </small>
                    <button
                      className="text-link"
                      onClick={() => {
                        follow.current = true;
                        feed.current?.scrollTo({
                          top: feed.current.scrollHeight,
                          behavior: "smooth",
                        });
                      }}
                    >
                      Jump to latest ↓
                    </button>
                  </footer>
                </section>
              )}
              {tab === "jury" &&
                (outcome ? (
                  <section className="vc-jury-section">
                    <label className="vc-outcome-select">
                      Discuss a completed verdict
                      <select
                        value={outcome.topic_id}
                        onChange={(e) => setJuryTopic(e.target.value)}
                      >
                        {outcomes.map((o) => (
                          <option key={o.topic_id} value={o.topic_id}>
                            {s.agenda.topics.find((t) => t.id === o.topic_id)
                              ?.label || o.topic_id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <JuryConversation
                      key={`${s.id}:${outcome.assessment?.native_assessment?.id}`}
                      sessionId={s.id}
                      outcome={outcome}
                    />
                  </section>
                ) : (
                  <div className="vc-empty">
                    <h2>
                      {completed
                        ? "Jury assessment unavailable."
                        : "Jury joins when the first verdict is ready."}
                    </h2>
                    <p>
                      {completed
                        ? "This discussion closed without a valid Jury assessment. The agenda’s audit record contains the failure details."
                        : "You can discuss each completed assessment while the rest of the car’s agenda continues."}
                    </p>
                  </div>
                ))}
              {tab === "agenda" && (
                <section className="vc-agenda">
                  <h2>The car’s complete agenda</h2>
                  <p>
                    {agenda.length} confirmed topics ·{" "}
                    {s.agenda.topics.filter((t) => !t.eligible).length} excluded
                    because evidence does not match this car and scope.
                  </p>
                  <ol>
                    {agenda.map((t) => (
                      <li
                        key={t.id}
                        className={t.id === topic?.id ? "current" : ""}
                      >
                        <span>
                          {s.outcomes.some((o) => o.topic_id === t.id)
                            ? "Reviewed"
                            : t.id === topic?.id
                              ? "In discussion"
                              : "Upcoming"}
                        </span>
                        <strong>{t.label}</strong>
                        <small>{t.area}</small>
                      </li>
                    ))}
                  </ol>
                  <details>
                    <summary>Evidence scope & audit record</summary>
                    <p>
                      {s.agenda.scope.prompt ||
                        "Review innovation opportunities across the vehicle."}
                    </p>
                    <p>Frozen source snapshot: {s.agenda.source_snapshot}</p>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        moderatorApi
                          .export(s.id)
                          .then(downloadRecords)
                          .catch((e) => setError(e.message))
                      }
                    >
                      <Download size={15} /> Download transcript & evidence
                      record
                    </Button>
                    <Link
                      className="text-link"
                      to={`/council?session=${s.id}&advanced=1`}
                    >
                      View selected topics ↗
                    </Link>
                  </details>
                </section>
              )}
              <p className="vc-timing">
                Local Qwen · source-grounded proposals · final decisions stay
                with you.
              </p>
            </>
          )}
        </div>
      </div>
      {ids && <SourceCards ids={ids} onClose={() => setIds(null)} />}
    </div>
  );
}
