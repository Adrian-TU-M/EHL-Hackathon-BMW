// Original continuous conversation UI from 627539b / 54c0b73 (Customer branch).
// Inject saved context/history so the live council and demo use the same implementation.
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useConversation, type ClientTools } from "@elevenlabs/react";
import { MessageSquareText, Mic, MicOff, PauseCircle, Send, Volume2 } from "lucide-react";
import { Button } from "../ui/Primitives";

export interface JudgeMessage { id: string; actor: "PM" | "judge"; text: string }

export function JudgeConversationSession({
  context,
  run,
  agentId,
  messages,
  onMessage: recordCouncilMessage,
  clientTools,
}: {
  context: string;
  run: string | number;
  agentId: string;
  messages: JudgeMessage[];
  onMessage: (message: JudgeMessage) => void;
  clientTools?: ClientTools;
}) {
  const [channel, setChannel] = useState<"text" | "voice">("voice");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [voicePaused, setVoicePaused] = useState(false);
  const voicePausedRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
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
    clientTools,
    // TextConversation does not support setVolume; passing a value there causes
    // its React hook to throw and leaves the dialog blank.
    volume: channel === "voice" ? 1 : undefined,
    onMessage: ({ message, role, event_id }) => {
      const text = message.trim();
      if (!text) return;
      if (channel === "voice" && voicePausedRef.current) return;
      // Text input is recorded optimistically in sendText so it appears in
      // the transcript immediately and remains visible even if the SDK does
      // not echo the user's message through onMessage.
      if (channel === "text" && role === "user") return;
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
    const previousDiscussion = messagesRef.current
      .map((message) => `${message.actor === "PM" ? "PM" : "Judge"}: ${message.text}`)
      .join("\n");
    sendContextualUpdate(
      `The PM has chosen to discuss this council recommendation. Use the following application context. Respond only to a new PM message, once per turn. After answering, stop speaking and wait for the PM; do not ask a follow-up question, check whether they are still there, or speak again just because time has passed. If asked to revise, suggest exact wording in your reply and tell the PM they can apply it with the app's Revise wording action. Never approve or reject anything for the PM. In text mode, reply only in text; do not narrate or read your response aloud. Any prior discussion below is historical context only; do not respond to it as a new message.\n\n${context}\n\nPrior PM-Judge discussion:\n${previousDiscussion || "None"}`,
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
    voicePausedRef.current = false;
    setVoicePaused(false);
    try { startSession({
      agentId,
      clientTools,
      textOnly: channel === "text",
      connectionType: channel === "text" ? "websocket" : "webrtc",
    }); } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to connect to ElevenLabs.");
    }
  }

  function pauseVoiceConversation() {
    voicePausedRef.current = true;
    setVoicePaused(true);
    setMuted(true);
    setInputLevel(0);
    setOutputLevel(0);
    void endSession();
  }

  function finishPausedConversation() {
    voicePausedRef.current = false;
    setVoicePaused(false);
  }

  function sendText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || status !== "connected") return;
    sendUserActivity();
    sendUserMessage(text);
    recordCouncilMessage({
      id: `pm-text-${run}-${crypto.randomUUID()}`,
      actor: "PM",
      text,
    });
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
        {channel === "voice" && voicePaused ? (
          <>
            <div className="judge-connection-status">
              <PauseCircle size={16} /> Voice discussion paused. The Judge will not listen or reply until you resume.
            </div>
            <div className="inline-actions">
              <Button onClick={connect}>
                <Mic size={14} /> Resume conversation
              </Button>
              <Button variant="secondary" onClick={finishPausedConversation}>
                End session
              </Button>
            </div>
          </>
        ) : status === "disconnected" ? (
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
                  <Button variant="secondary" onClick={pauseVoiceConversation}>
                    <PauseCircle size={14} /> Pause conversation
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
