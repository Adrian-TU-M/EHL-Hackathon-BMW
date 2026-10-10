import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Play,
  Pause,
  Square,
  ArrowRight,
  ChevronDown,
  MessageSquare,
  FileText,
  Maximize2,
  Check,
  CircleDot,
  SlidersHorizontal,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { Badge, Button, Loading, Modal } from "../components/ui/Primitives";
import { EvidenceDialog } from "../components/dashboard/EvidenceDialog";
import { agentMeta } from "../components/agents/AgentSculpture";
import { stages } from "../lib/council/machine";
import { EvidenceDrawer } from "../components/customer/EvidenceDrawer";
import type { DrawerRequest } from "../components/customer/EvidenceDrawer";
import { liveCustomerSource } from "../lib/api/customer";
import "../components/customer/customer.css";
import type { AgentState, Topic } from "../lib/types";
import { JudgeHandoff } from "../components/council/JudgeHandoff";
const STANCE: Record<string, string> = {
  agree: "agrees with",
  partly_agree: "partly agrees with",
  disagree: "disagrees with",
  outside_evidence: "outside customer evidence, replying to",
};
const CouncilScene = lazy(() => import("../components/council/CouncilScene"));
export default function Council() {
  const {
    council,
    requirements,
    scope,
    startCouncil,
    controlCouncil,
    evidence,
    councilEvidence,
  } = useAppStore();
  const [liveDrawer, setLiveDrawer] = useState<DrawerRequest | null>(null);
  const [topic, setTopic] = useState<Topic>(council.topic);
  const [expanded, setExpanded] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [rationale, setRationale] = useState("");
  const [ids, setIds] = useState<string[] | null>(null);
  const [showcase, setShowcase] = useState(false);
  const [visualState, setVisualState] = useState<AgentState>("idle");
  const navigate = useNavigate();
  const event = council.events[council.cursor];
  const stageIndex = stages.findIndex((s) => s.id === event?.stage);
  const active = council.status === "running";
  const paused = ["paused", "interrupted"].includes(council.status);
  const complete = council.status === "complete";
  const currentSources = evidence.filter((e) =>
    event?.evidenceIds.includes(e.id),
  );
  const liveSources = councilEvidence.filter((e) =>
    event?.evidenceIds.includes(e.id),
  );
  const waitingOn = council.events[council.cursor + 1]?.pending
    ? council.events[council.cursor + 1]
    : undefined;
  const live = council.liveCustomer;
  // Live Customer Agent citations open the customer evidence drawer; scripted ones the demo dialog.
  const openIds = (list: string[]) => {
    const items = councilEvidence.filter((e) => list.includes(e.id));
    if (items.length)
      setLiveDrawer({
        kind: "evidence",
        title: "Customer Agent evidence",
        items,
        note: "Original BMW feedback cited by the live Customer Agent (qwen3:8b). Citations were checked in code against the records shown to the model.",
      });
    else setIds(list);
  };
  return (
    <div className="council-page">
      <div className="council-page-header">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> THE INTELLIGENCE COUNCIL
          </div>
          <h1>
            Different perspectives.
            <br />
            <span>One considered direction.</span>
          </h1>
          <p>Evidence in focus. Assumptions in the open. You in control.</p>
        </div>
        <Badge tone="dark">
          {live
            ? "LIVE CUSTOMER AGENT · OTHER AGENTS SCRIPTED"
            : "SCRIPTED DEMO COUNCIL"}
        </Badge>
      </div>
      <div className="council-stagebar">
        {stages.map((s, i) => (
          <div
            key={s.id}
            className={`${i === stageIndex ? "current" : ""} ${i < stageIndex ? "done" : ""}`}
          >
            <span>
              {i < stageIndex ? (
                <Check size={11} />
              ) : (
                String(i + 1).padStart(2, "0")
              )}
            </span>
            <strong>{s.label}</strong>
            {i < stages.length - 1 && <i />}
          </div>
        ))}
      </div>
      <div className="council-layout">
        <aside className="council-context">
          <div className="eyebrow">ON THE TABLE</div>
          <label className="field-label" htmlFor="council-topic">
            Discussion topic
          </label>
          <select
            id="council-topic"
            value={topic}
            disabled={active || paused}
            onChange={(e) => setTopic(e.target.value as Topic)}
          >
            {requirements.map((r) => (
              <option key={r.topic}>{r.topic}</option>
            ))}
          </select>
          <h2>{requirements.find((r) => r.topic === topic)?.title}</h2>
          <div className="council-scope">
            <span>
              VEHICLE <strong>BMW {scope.vehicle}</strong>
            </span>
            <span>
              MARKET <strong>{scope.market}</strong>
            </span>
            <span>
              HORIZON <strong>{2026 + scope.horizon}</strong>
            </span>
          </div>
          <div className="council-rules">
            <span>
              <CircleDot size={13} /> 3 independent perspectives
            </span>
            <span>
              <CircleDot size={13} /> 1 challenge round
            </span>
            <span>
              <CircleDot size={13} /> 1 clarification maximum
            </span>
            <span>
              <CircleDot size={13} /> Final decision stays with you
            </span>
          </div>
          <div className="council-controls">
            {council.status === "idle" || complete ? (
              <Button onClick={() => startCouncil(topic)}>
                <Play size={15} />
                {complete ? "Start a new discussion" : "Start discussion"}
              </Button>
            ) : (
              <Button
                onClick={() => controlCouncil(active ? "pause" : "resume")}
              >
                {active ? <Pause size={15} /> : <Play size={15} />}{" "}
                {active ? "Pause discussion" : "Resume discussion"}
              </Button>
            )}
            <div>
              <Button
                variant="secondary"
                disabled={!active && !paused}
                onClick={() => controlCouncil("interrupt")}
              >
                <Square size={13} /> Interrupt
              </Button>
              <Button
                variant="secondary"
                disabled={!active && !paused}
                onClick={() => {
                  controlCouncil("pause");
                  setChallenge(true);
                }}
              >
                <MessageSquare size={14} /> Challenge
              </Button>
            </div>
          </div>
          <div className="council-runtime">
            <span className={active ? "live-dot" : "quiet-dot"} />
            {active
              ? "Council in session"
              : paused
                ? "Paused for your perspective"
                : complete
                  ? "Ready for PM review"
                  : "Awaiting your direction"}
            <small>
              {Math.round(council.elapsedMs / 1000)}s / 120s maximum
            </small>
          </div>
        </aside>
        <section className="council-center">
          <div className="chamber-caption">
            <span>
              COUNCIL CHAMBER <span className="muted">/</span> 01
            </span>
            <button
              onClick={() => setShowcase(true)}
              aria-label="Open agent state showcase"
            >
              <SlidersHorizontal size={14} /> Avatars
            </button>
          </div>
          <Suspense
            fallback={<Loading label="Preparing the council chamber…" />}
          >
            <CouncilScene council={council} />
          </Suspense>
          <div className="speaker-card">
            <div className="flex-between">
              <span className="eyebrow">
                {event
                  ? `${agentMeta[event.actor].name.toUpperCase()} / ${agentMeta[event.actor].role.toUpperCase()}`
                  : "FIVE PERSPECTIVES, IN CONVERSATION"}
              </span>
              <div
                className={`voice-bars ${active ? "active" : ""}`}
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            {event?.model && (
              <small className="council-live-tag" data-testid="live-turn">
                Live · {event.model.replace("ollama:", "")} · BMW feedback
                {event.respondingTo && event.stance && event.stance !== "none" && (
                  <> · {STANCE[event.stance]} {event.respondingTo}</>
                )}
              </small>
            )}
            {event?.evidenceBase && (
              <small className="council-evidence-base" data-testid="evidence-base">
                {event.evidenceBase}
              </small>
            )}
            <p key={event?.id} aria-live="polite">
              {event?.statement ||
                "Your council is ready. Choose a customer experience and start the discussion. Each specialist brings a distinct perspective; the judge evaluates the evidence before you decide."}
            </p>
            {waitingOn && active && (
              <small className="council-waiting" role="status">
                {agentMeta[waitingOn.actor].name} is reading the BMW feedback
                and preparing a response…
              </small>
            )}
            {council.challenge && (
              <div className="challenge-record">
                <strong>Your challenge</strong>
                <span>{council.challenge}</span>
              </div>
            )}
            <button
              className="text-link"
              onClick={() => setExpanded(!expanded)}
              disabled={council.cursor < 0}
            >
              {expanded ? "Collapse discussion" : "Expand debate"}
              <ChevronDown size={14} className={expanded ? "rotate" : ""} />
            </button>
          </div>
        </section>
        <aside className="council-evidence">
          <div className="flex-between">
            <span className="eyebrow">EVIDENCE IN FOCUS</span>
            <FileText size={16} />
          </div>
          {liveSources.length > 0 &&
            liveSources.slice(0, 3).map((e) => (
              <button
                className="council-source"
                key={e.id}
                data-testid="live-source"
                onClick={() => openIds([e.id])}
              >
                <Badge tone="dark">customer · BMW data</Badge>
                <p>{e.passage}</p>
                <span>
                  {e.id} · {e.country || e.market} · {e.source}{" "}
                  <Maximize2 size={12} />
                </span>
              </button>
            ))}
          {liveSources.length > 0 ? null : currentSources.length ? (
            currentSources.slice(0, 3).map((e) => (
              <button
                className="council-source"
                key={e.id}
                onClick={() => openIds([e.id])}
              >
                <Badge tone="dark">{e.domain}</Badge>
                <p>{e.passage}</p>
                <span>
                  {e.id} · SYNTHETIC <Maximize2 size={12} />
                </span>
                {e.exclusionReason && (
                  <strong className="error">Excluded by PM</strong>
                )}
              </button>
            ))
          ) : (
            <div className="council-source-empty">
              <FileText size={26} />
              <p>Source references will follow each agent’s statement.</p>
            </div>
          )}
          <div className="council-assumption">
            <span className="eyebrow">ASSUMPTIONS & LIMITATIONS</span>
            <p>
              {event?.assumption ||
                (live
                  ? "Customer statements come from the live Customer Agent on supplied BMW feedback. Market, competitor, moderator and judge turns are still scripted."
                  : "No real datasets are connected. The discussion demonstrates the workflow, not verified BMW findings.")}
            </p>
          </div>
          {stageIndex >= 3 && (
            <div className="judge-note">
              <span className="eyebrow">JUDGE’S POSITION</span>
              <p>
                Coherent customer need; illustrative evidence. Prevalence and
                feasibility remain unresolved.
              </p>
              <small>Provisional · subject to human challenge</small>
            </div>
          )}
        </aside>
      </div>
      {expanded && (
        <section className="transcript">
          <div className="flex-between">
            <h2>The discussion, in full.</h2>
            <Badge tone="dark">VISIBLE AGENT STATEMENTS</Badge>
          </div>
          <p className="small">
            Generated discussion summaries, challenges and assessments. No
            hidden model reasoning.
          </p>
          {council.events.slice(0, council.cursor + 1).map((e, i) => (
            <div className="transcript-event" key={e.id}>
              <span className="mono">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <strong style={{ color: agentMeta[e.actor].color }}>
                  {agentMeta[e.actor].name} <span>{e.stage}</span>
                  {e.model && (
                    <span className="council-live-tag"> live</span>
                  )}
                </strong>
                {e.evidenceBase && (
                  <small className="council-evidence-base">{e.evidenceBase}</small>
                )}
                <p>{e.statement}</p>
                {e.assumption && <small>Assumption: {e.assumption}</small>}
                {e.evidenceIds.length > 0 && (
                  <button
                    className="text-link"
                    onClick={() => openIds(e.evidenceIds)}
                  >
                    {e.evidenceIds.join(" · ")}
                    <FileText size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
      {complete && requirements.find((r) => r.topic === council.topic) ? (
        <JudgeHandoff
          requirementId={
            requirements.find((r) => r.topic === council.topic)!.id
          }
        />
      ) : (
        <div className="council-review-footer">
          <div>
            <strong>An open discussion. A deliberate decision.</strong>
            <span>The council never approves a requirement on your behalf.</span>
          </div>
          <Button disabled onClick={() => navigate("/decisions")}>
            Continue to PM review <ArrowRight size={16} />
          </Button>
        </div>
      )}
      {ids && <EvidenceDialog ids={ids} onClose={() => setIds(null)} />}{" "}
      {liveDrawer && (
        <EvidenceDrawer
          request={liveDrawer}
          source={liveCustomerSource}
          onClose={() => setLiveDrawer(null)}
        />
      )}
      {challenge && (
        <Modal
          title="Bring your perspective"
          onClose={() => setChallenge(false)}
        >
          <p>
            The discussion is paused. Your challenge will stay visible in the
            council and audit trail.{" "}
            {live
              ? "The live Customer Agent will answer it from the BMW feedback when you resume."
              : "In this demo, it does not generate a new AI response."}
          </p>
          <label className="field-label" htmlFor="council-challenge">
            What needs closer examination?
          </label>
          <textarea
            id="council-challenge"
            rows={4}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Challenge a source, assumption, or interpretation…"
          />
          <Button
            disabled={!rationale.trim()}
            onClick={() => {
              controlCouncil("challenge", rationale);
              setChallenge(false);
              setRationale("");
            }}
          >
            Record challenge
          </Button>
        </Modal>
      )}
      {showcase && (
        <Modal
          title="Agent state studio"
          wide
          onClose={() => setShowcase(false)}
        >
          <p>
            Procedural sculptures share a state contract with the council
            workflow.
          </p>
          <select
            aria-label="Agent visualization state"
            value={visualState}
            onChange={(e) => setVisualState(e.target.value as AgentState)}
          >
            {[
              "idle",
              "thinking",
              "speaking",
              "challenging",
              "waiting",
              "evaluating",
              "paused",
              "complete",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <div className="showcase-scene">
            <CouncilScene council={council} showcase={visualState} />
          </div>
        </Modal>
      )}
    </div>
  );
}
