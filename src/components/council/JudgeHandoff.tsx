import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import {
  ConversationProvider,
  useConversation,
} from "@elevenlabs/react";
import {
  Check,
  MessageSquareText,
  Mic,
  MicOff,
  PauseCircle,
  Send,
  Volume2,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../store/useAppStore";
import type { DecisionStatus } from "../../lib/types";
import { Badge, Button, Modal } from "../ui/Primitives";

const elevenLabsAgentId = import.meta.env.VITE_ELEVENLABS_AGENT_ID?.trim();

export function JudgeHandoff({ requirementId }: { requirementId: string }) {
  const navigate = useNavigate();
  const requirement = useAppStore((s) =>
    s.requirements.find((item) => item.id === requirementId),
  );
  const council = useAppStore((s) => s.council);
  const decide = useAppStore((s) => s.decide);
  const deferCouncilReview = useAppStore((s) => s.deferCouncilReview);
  const setCouncilHandoff = useAppStore((s) => s.setCouncilHandoff);
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const hasDiscussion = council.discussion.some((message) => message.actor === "PM");

  const evidence = useAppStore((s) => s.evidence);
  const context = useMemo(() => {
    if (!requirement) return "";
    return JSON.stringify(
      {
        scope: {
          vehicle: requirement.vehicle,
          market: requirement.market,
          powertrain: requirement.powertrain,
        },
        requirement: {
          id: requirement.id,
          version: requirement.version,
          topic: requirement.topic,
          title: requirement.title,
          description: requirement.description,
          rationale: requirement.rationale,
          assumptions: requirement.assumptions,
          uncertainties: requirement.uncertainties,
          alternatives: requirement.alternatives,
          evidenceLevel: requirement.evidenceLevel,
        },
        evidence: evidence
          .filter(
            (item) =>
              requirement.evidenceIds.includes(item.id) &&
              !item.exclusionReason,
          )
          .map((item) => ({
            id: item.id,
            source: item.source,
            location: item.location,
            publishedAt: item.publishedAt,
            provenance: item.provenance,
            passage: item.passage,
            quantitative: item.quantitative,
          })),
        councilStatements: council.events
          .slice(0, council.cursor + 1)
          .map(({ stage, actor, statement, evidenceIds, assumption }) => ({
            stage,
            actor,
            statement,
            evidenceIds,
            assumption,
          })),
      },
      null,
      2,
    );
  }, [requirement, evidence, council.events, council.cursor]);

  if (!requirement) return null;

  async function commit(status: DecisionStatus, rationale: string) {
    if (!requirement) return;
    setSaving(true);
    setError("");
    try {
      await decide({
        requirementId: requirement.id,
        expectedVersion: requirement.version,
        status,
        rationale,
        description: requirement.description,
      });
      setCouncilHandoff(
        status === "Approved"
          ? "approved"
          : status === "Rejected"
            ? "rejected"
            : "pending",
      );
      setRejecting(false);
      setSavedMessage(
        status === "Approved"
          ? "Approved for this requirement version."
          : "Rejection recorded in the decision history.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to record decision.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function applyRevision() {
    if (!requirement || !revision.trim()) return;
    if (revision.trim() === requirement.description.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await decide({
        requirementId: requirement.id,
        expectedVersion: requirement.version,
        status: "Pending review",
        rationale: "PM revised the requirement after discussing it with the Judge.",
        description: revision.trim(),
      });
      setEditing(false);
      setSavedMessage(`Revision saved as version ${requirement.version + 1}.`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to save revision.",
      );
    } finally {
      setSaving(false);
    }
  }

  function reviewLater() {
    deferCouncilReview();
    navigate("/decisions");
  }

  return (
    <section className="judge-handoff">
      <div className="judge-handoff-heading">
        <div>
          <div className="eyebrow">JUDGE TO PM</div>
          <h2>Your council recommendation</h2>
          <p>
            The discussion is complete. The Judge is ready to explain the
            recommendation or hear your feedback.
          </p>
        </div>
        <Badge tone="amber">PROVISIONAL · VERSION {requirement.version}</Badge>
      </div>

      <div className="judge-recommendation">
        <span className="mono">{requirement.id} / {requirement.topic}</span>
        <p>{requirement.description}</p>
        <small>
          Judge’s rationale: {requirement.rationale} Evidence: {requirement.evidenceLevel}.
        </small>
      </div>

      {savedMessage && <div className="notice green"><p>{savedMessage}</p></div>}
      {error && <p className="error" role="alert">{error}</p>}

      {council.handoff === "approved" || council.handoff === "rejected" ? (
        <div className="judge-handoff-result">
          <Badge tone={council.handoff === "approved" ? "green" : "amber"}>
            {council.handoff === "approved" ? "APPROVED" : "REJECTED"}
          </Badge>
          <span>
            This decision is recorded for version {requirement.version}. You can
            revisit it later in Decisions.
          </span>
          <Button variant="secondary" onClick={() => navigate("/decisions")}>
            Open decisions
          </Button>
        </div>
      ) : council.handoff === "review_later" ? (
        <div className="judge-handoff-result">
          <Badge tone="dark">REVIEW LATER</Badge>
          <span>The recommendation is waiting in your review queue.</span>
          <Button variant="secondary" onClick={() => navigate("/decisions")}>
            Open review queue
          </Button>
        </div>
      ) : (
        <>
          {editing && (
            <div className="judge-revision-editor">
              <label className="field-label" htmlFor="judge-revision">
                Revised customer-facing requirement
              </label>
              <textarea
                id="judge-revision"
                rows={3}
                value={revision}
                onChange={(event) => setRevision(event.target.value)}
              />
              <div className="inline-actions">
                <Button
                  disabled={saving || !revision.trim()}
                  onClick={() => void applyRevision()}
                >
                  Save as new version
                </Button>
                <Button variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {rejecting && (
            <div className="judge-revision-editor">
              <label className="field-label" htmlFor="judge-rejection-reason">
                Why are you rejecting this recommendation?
              </label>
              <textarea
                id="judge-rejection-reason"
                rows={2}
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Record your reason for the decision…"
              />
              <div className="inline-actions">
                <Button
                  disabled={saving || !rejectionReason.trim()}
                  onClick={() => void commit("Rejected", rejectionReason)}
                >
                  Confirm rejection
                </Button>
                <Button variant="secondary" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="judge-handoff-actions">
            <Button
              disabled={saving}
              onClick={() => void commit("Approved", "Approved as presented by the Judge.")}
            >
              <Check size={15} /> Approve now
            </Button>
            <Button variant="secondary" onClick={reviewLater}>
              <PauseCircle size={15} /> Review later
            </Button>
            <Button variant="secondary" onClick={() => setDiscussionOpen(true)}>
              <MessageSquareText size={15} /> Discuss with Judge
            </Button>
            {hasDiscussion && !editing && !rejecting && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRevision(requirement.description);
                    setEditing(true);
                  }}
                >
                  Revise wording
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setRejecting(true)}
                >
                  Reject recommendation
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {discussionOpen && (
        <Modal
          title="Discuss with the Judge"
          wide
          onClose={() => setDiscussionOpen(false)}
        >
          {!elevenLabsAgentId ? (
            <div className="notice amber">
              <p>
                Live discussion is not configured. Add
                <code> VITE_ELEVENLABS_AGENT_ID </code> to your local
                environment to enable text and voice.
              </p>
            </div>
          ) : (
            <ConversationProvider key={council.run}>
              <JudgeConversationSession
                context={context}
                run={council.run}
                agentId={elevenLabsAgentId}
              />
            </ConversationProvider>
          )}
          <div className="inline-actions judge-dialog-footer">
            {hasDiscussion && (
              <Button
                variant="secondary"
                onClick={() => {
                  setRevision(requirement.description);
                  setDiscussionOpen(false);
                  setEditing(true);
                }}
              >
                Use feedback to revise
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDiscussionOpen(false)}>
              <X size={14} /> Close discussion
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function JudgeConversationSession({
  context,
  run,
  agentId,
}: {
  context: string;
  run: number;
  agentId: string;
}) {
  const [channel, setChannel] = useState<"text" | "voice">("voice");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const messages = useAppStore((s) => s.council.discussion);
  const recordCouncilMessage = useAppStore((s) => s.recordCouncilMessage);
  const {
    status,
    isMuted,
    isSpeaking,
    isListening,
    setMuted,
    startSession,
    endSession,
    sendUserMessage,
    sendUserActivity,
    sendContextualUpdate,
    getInputVolume,
    getOutputVolume,
  } = useConversation({
    // TextConversation does not support setVolume; passing a value there causes
    // its React hook to throw and leaves the dialog blank.
    volume: channel === "voice" ? 1 : undefined,
    onMessage: ({ message, role, event_id }) => {
      const text = message.trim();
      if (!text) return;
      recordCouncilMessage({
        id: `el-${run}-${event_id}-${role}`,
        actor: role === "user" ? "PM" : "judge",
        text,
      });
    },
    onError: (message) => setError(message),
  });

  useEffect(() => {
    if (status !== "connected" || channel !== "voice") {
      setInputLevel(0);
      setOutputLevel(0);
      return;
    }

    const timer = window.setInterval(() => {
      try {
        setInputLevel(getInputVolume());
        setOutputLevel(getOutputVolume());
      } catch {
        // Audio meters are only available while a voice session is active.
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [status, channel, getInputVolume, getOutputVolume]);

  const userIsSpeaking = channel === "voice" && !isMuted && inputLevel > 0.08;

  useEffect(() => {
    if (status !== "connected") return;
    sendContextualUpdate(
      `The PM has chosen to discuss this council recommendation. Use the following application context. Respond only to a new PM message, once per turn. After answering, stop speaking and wait for the PM; do not ask a follow-up question, check whether they are still there, or speak again just because time has passed. If asked to revise, suggest exact wording in your reply and tell the PM they can apply it with the app's Revise wording action. Never approve or reject anything for the PM. In text mode, reply only in text; do not narrate or read your response aloud.\n\n${context}`,
      { contextId: `bmw-next-council-${run}` },
    );
  }, [status, context, run, sendContextualUpdate]);

  useEffect(
    () => () => {
      void endSession();
    },
    [endSession],
  );

  function connect() {
    setError("");
    startSession({
      agentId,
      textOnly: channel === "text",
      connectionType: channel === "text" ? "websocket" : "webrtc",
    });
  }

  function sendText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || status !== "connected") return;
    sendUserActivity();
    sendUserMessage(text);
    setInput("");
  }

  return (
    <div className="judge-conversation">
      <div className="judge-conversation-context">
        <strong>{messages.length ? "Discussion transcript" : "Recommendation in focus"}</strong>
        <span>
          {messages.length
            ? "Your discussion is saved to the local audit history."
            : "The Judge will receive this requirement and its supporting evidence."}
        </span>
      </div>

      {channel === "voice" && status === "connected" && (
        <div className="judge-orb-stage" aria-live="polite">
          <div
            className={`judge-orb ${isSpeaking ? "is-speaking" : ""} ${userIsSpeaking ? "user-is-speaking" : ""}`}
            style={{
              "--orb-energy": Math.min(1, outputLevel * 3),
              transform: `scale(${1 + Math.min(0.12, outputLevel * 0.1)})`,
            } as CSSProperties}
            role="img"
            aria-label={isSpeaking ? "Judge is speaking" : "Judge voice assistant"}
          >
            <span className="judge-orb-core" />
            <span className="judge-orb-cloud cloud-one" />
            <span className="judge-orb-cloud cloud-two" />
            <span className="judge-orb-cloud cloud-three" />
            <span className="judge-orb-glint" />
          </div>
          <strong>{isSpeaking ? "Judge speaking" : userIsSpeaking ? "Your turn" : "Listening"}</strong>
          <span>
            {isSpeaking
              ? "The Judge is responding aloud."
              : userIsSpeaking
                ? "Speak your thought, then pause."
                : "The Judge will wait for you to speak."}
          </span>
        </div>
      )}

      <div className={`judge-message-list ${channel === "text" ? "text-discussion" : ""}`} aria-live="polite">
        {messages.map((message) => (
          <article
            className={`judge-message ${message.actor === "PM" ? "from-pm" : "from-judge"}`}
            key={message.id}
          >
            <strong>{message.actor === "PM" ? "You · PM" : "Judge"}</strong>
            <p>{message.text}</p>
          </article>
        ))}
        {!messages.length && status === "disconnected" && (
          <p className="small muted">
            Start a text or voice session. Text discussion stays written; voice discussion uses the Judge's ElevenLabs voice.
          </p>
        )}
      </div>

      <div className="judge-conversation-controls">
        {status === "disconnected" ? (
          <>
            <div className="judge-channel-select" role="group" aria-label="Discussion mode">
              <button
                className={channel === "text" ? "selected" : ""}
                onClick={() => setChannel("text")}
              >
                <MessageSquareText size={14} /> Text
              </button>
              <button
                className={channel === "voice" ? "selected" : ""}
                onClick={() => setChannel("voice")}
              >
                <Mic size={14} /> Voice
              </button>
            </div>
            <Button onClick={connect}>
              {channel === "voice" ? <Mic size={15} /> : <Volume2 size={15} />}
              Start {channel} discussion
            </Button>
          </>
        ) : status === "connecting" ? (
          <div className="judge-connection-status">Connecting to the Judge…</div>
        ) : (
          <>
            <div className="judge-connection-status">
              <span className="live-dot" />
              {channel === "voice" ? "Voice discussion active" : "Text discussion active"}
            </div>
            {channel === "voice" ? (
              <>
                <div className={`judge-voice-status ${userIsSpeaking ? "user-speaking" : ""} ${isSpeaking ? "judge-speaking" : ""}`} aria-live="polite">
                  <span className="judge-voice-indicator">
                    {isSpeaking ? <Volume2 size={16} /> : isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                  </span>
                  <div className="judge-voice-status-copy">
                    <strong>
                      {isSpeaking
                        ? "Judge is speaking"
                        : isMuted
                          ? "Microphone muted"
                          : userIsSpeaking
                            ? "You're speaking"
                            : isListening
                              ? "Listening for you"
                              : "Voice session ready"}
                    </strong>
                    <span>
                    {isSpeaking
                      ? outputLevel > 0.03
                        ? "Audio is playing through your selected output."
                        : "The Judge is replying. Check your device output if you hear nothing."
                      : "Speak naturally; the indicator lights when your microphone picks up your voice."}
                    </span>
                  </div>
                  <div className="judge-audio-meter" aria-label={`Microphone level ${Math.round(inputLevel * 100)} percent`}>
                    <span style={{ width: `${Math.min(100, Math.round(inputLevel * 300))}%` }} />
                  </div>
                </div>
                <div className="inline-actions">
                  <Button variant="secondary" onClick={() => setMuted(!isMuted)}>
                    {isMuted ? <Mic size={14} /> : <MicOff size={14} />}
                    {isMuted ? "Unmute" : "Mute"}
                  </Button>
                  <Button variant="secondary" onClick={() => void endSession()}>
                    End session
                  </Button>
                </div>
              </>
            ) : (
              <form className="judge-text-form" onSubmit={sendText}>
                <textarea
                  aria-label="Message the Judge"
                  rows={2}
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    sendUserActivity();
                  }}
                  placeholder="Ask about the recommendation or share your feedback…"
                />
                <Button disabled={!input.trim()} aria-label="Send message">
                  <Send size={14} /> Send
                </Button>
                <Button variant="secondary" onClick={() => void endSession()}>
                  End session
                </Button>
              </form>
            )}
          </>
        )}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {channel === "voice" && status === "disconnected" && (
        <p className="small muted">
          Your browser will ask for microphone access when you start the voice discussion.
        </p>
      )}
    </div>
  );
}
