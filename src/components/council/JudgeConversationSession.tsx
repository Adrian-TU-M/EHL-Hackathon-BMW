// Original continuous conversation UI from 627539b / 54c0b73 (Customer branch).
// Inject saved context/history so the live council and demo use the same implementation.
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  conversationMessages,
  savedConversationThread,
  rememberConversationThread,
} from "../../lib/council/conversation-thread";
import {
  useLocalJudgeConversation,
  type LocalJudgeTransport,
} from "./useLocalJudgeConversation";
import { JuryAvatar } from "./JuryAvatar";
import { useConversation, type ClientTools } from "@elevenlabs/react";
import {
  MessageSquareText,
  Mic,
  MicOff,
  PauseCircle,
  Send,
  Volume2,
  X,
} from "lucide-react";
import { Button } from "../ui/Primitives";

export interface JudgeMessage {
  id: string;
  actor: "PM" | "judge";
  text: string;
}

export function JudgeConversationSession({
  context,
  run,
  agentId,
  messages,
  onMessage: recordCouncilMessage,
  clientTools,
  localTransport,
  reviewHref,
}: {
  context: string;
  run: string | number;
  agentId: string;
  messages: JudgeMessage[];
  onMessage: (message: JudgeMessage) => void;
  clientTools?: ClientTools;
  localTransport?: LocalJudgeTransport;
  reviewHref?: string;
}) {
  const [thread, setThread] = useState(() => savedConversationThread(run));
  const threadRef = useRef(thread);
  const connectionId = useRef(crypto.randomUUID());
  const visibleMessages = conversationMessages(messages, thread);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [channel, setChannel] = useState<"text" | "voice">("voice");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [voicePaused, setVoicePaused] = useState(false);
  const voicePausedRef = useRef(false);
  const messagesRef = useRef(visibleMessages);
  messagesRef.current = visibleMessages;
  const hostedConversation = useConversation({
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
        id: `jc:${threadRef.current}:${connectionId.current}:${role}:${event_id ?? crypto.randomUUID()}`,
        actor: role === "user" ? "PM" : "judge",
        text,
      });
    },
    onError: (message) => setError(message),
  });

  const localConversation = useLocalJudgeConversation({
    transport: localTransport,
    onError: setError,
    onMessage: ({ message, role, event_id }) => {
      if (channel === "text" && role === "user") return;
      recordCouncilMessage({
        id: `jc:${threadRef.current}:${connectionId.current}:${role}:${event_id}`,
        actor: role === "user" ? "PM" : "judge",
        text: message,
      });
    },
  });
  const conversation = localTransport ? localConversation : hostedConversation;
  const {
    status,
    isMuted,
    isSpeaking,
    isListening,
    setMuted,
    endSession,
    sendUserMessage,
    sendUserActivity,
    getInputVolume,
    getOutputVolume,
  } = conversation;
  const { startSession, sendContextualUpdate } = hostedConversation;
  const thinking = localTransport ? localConversation.isThinking : false;

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
    if (localTransport || status !== "connected") return;
    const previousDiscussion = messagesRef.current
      .map(
        (message) =>
          `${message.actor === "PM" ? "PM" : "Judge"}: ${message.text}`,
      )
      .join("\n");
    sendContextualUpdate(
      `The PM has chosen to discuss this council recommendation. Use the following application context. Respond only to a new PM message, once per turn. After answering, stop speaking and wait for the PM; do not ask a follow-up question, check whether they are still there, or speak again just because time has passed. If asked to revise, suggest exact wording in your reply and tell the PM they can apply it with the app's Revise wording action. Never approve or reject anything for the PM. In text mode, reply only in text; do not narrate or read your response aloud. Any prior discussion below is historical context only; do not respond to it as a new message.\n\n${context}\n\nPrior PM-Judge discussion:\n${previousDiscussion || "None"}`,
      { contextId: `bmw-next-council-${run}` },
    );
  }, [status, context, run, sendContextualUpdate, localTransport]);

  useEffect(
    () => () => {
      void endSession();
    },
    [endSession],
  );

  useEffect(() => {
    if (!voiceOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = oldOverflow;
      previousFocus?.focus();
    };
  }, [voiceOpen]);

  function closeVoice() {
    void endSession();
    setVoiceOpen(false);
    setInputLevel(0);
    setOutputLevel(0);
    voicePausedRef.current = false;
    setVoicePaused(false);
  }

  function connect(fresh = false) {
    if (status === "connected" || status === "connecting") return;
    if (fresh) {
      const nextThread = crypto.randomUUID();
      // A new SDK session receives the verdict, without any previous PM discussion.
      messagesRef.current = [];
      threadRef.current = nextThread;
      setThread(nextThread);
      rememberConversationThread(run, nextThread);
    }
    connectionId.current = crypto.randomUUID();
    setInput("");
    if (channel === "voice") setVoiceOpen(true);
    setError("");
    voicePausedRef.current = false;
    setVoicePaused(false);
    try {
      // The SDK owns pending-session cancellation and resets mute on disconnect.
      // Its startSession returns void; asynchronous failures arrive through onError.
      if (localTransport) {
        void localConversation.startSession({
          textOnly: channel === "text",
          thread: threadRef.current,
        });
        return;
      }
      startSession({
        agentId,
        clientTools,
        textOnly: channel === "text",
        connectionType: channel === "text" ? "websocket" : "webrtc",
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to connect to ElevenLabs.",
      );
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
    closeVoice();
  }

  function sendText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || status !== "connected") return;
    sendUserActivity();
    sendUserMessage(text);
    recordCouncilMessage({
      id: `jc:${threadRef.current}:${connectionId.current}:PM:${crypto.randomUUID()}`,
      actor: "PM",
      text,
    });
    setInput("");
  }

  useEffect(() => {
    if (voiceOpen && transcriptRef.current)
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [visibleMessages.length, voiceOpen]);

  const content = (
    <div className="judge-conversation">
      <div className="judge-conversation-context">
        <strong>
          {visibleMessages.length
            ? "Discussion transcript"
            : "Recommendation in focus"}
        </strong>
        <span>
          {visibleMessages.length
            ? "Your discussion is saved to the local audit history."
            : "The Judge will receive this requirement and its supporting evidence."}
        </span>
      </div>

      {channel === "voice" && (
        <JuryAvatar
          speaking={status === "connected" && isSpeaking}
          listening={
            status === "connected" && !isMuted && !isSpeaking && !thinking
          }
          thinking={status === "connecting" || thinking}
          text={
            visibleMessages
              .filter((message) => message.actor === "judge")
              .at(-1)?.text || ""
          }
          energy={isSpeaking ? outputLevel * 3 : isMuted ? 0 : inputLevel * 3}
          label={
            voicePaused
              ? "Conversation paused"
              : status === "connecting"
                ? "Connecting"
                : status !== "connected"
                  ? "Meet your Judge"
                  : thinking
                    ? "Local Qwen is considering your question"
                    : isSpeaking
                      ? "Judge speaking"
                      : isMuted
                        ? "Microphone muted"
                        : userIsSpeaking
                          ? "Your turn"
                          : "Listening"
          }
        />
      )}

      <div
        ref={transcriptRef}
        className={`judge-message-list ${channel === "text" ? "text-discussion" : ""}`}
        aria-live="polite"
      >
        {visibleMessages.map((message) => (
          <article
            className={`judge-message ${message.actor === "PM" ? "from-pm" : "from-judge"}`}
            key={message.id}
          >
            <strong>{message.actor === "PM" ? "You · PM" : "Judge"}</strong>
            <p>{message.text}</p>
          </article>
        ))}
        {!visibleMessages.length && status === "disconnected" && (
          <p className="small muted">
            Start a text or voice session. Text discussion stays written; voice
            discussion uses the Judge's ElevenLabs voice.
          </p>
        )}
      </div>

      <div className="judge-conversation-controls">
        {channel === "voice" && voicePaused ? (
          <>
            <div className="judge-connection-status">
              <PauseCircle size={16} /> Voice discussion paused. The Judge will
              not listen or reply until you resume.
            </div>
            <div className="inline-actions">
              <Button onClick={() => connect(false)}>
                <Mic size={14} /> Resume conversation
              </Button>
              <Button variant="secondary" onClick={finishPausedConversation}>
                End session
              </Button>
            </div>
          </>
        ) : status === "disconnected" || status === "error" ? (
          <>
            <div
              className="judge-channel-select"
              role="group"
              aria-label="Discussion mode"
            >
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
            <Button onClick={() => connect(true)}>
              {channel === "voice" ? <Mic size={15} /> : <Volume2 size={15} />}
              Start new conversation
            </Button>
            {visibleMessages.length > 0 && (
              <Button variant="secondary" onClick={() => connect(false)}>
                Continue conversation
              </Button>
            )}
            <p className="small muted jury-thread-note">
              A new conversation keeps this verdict, with a fresh chat. Previous
              chats stay in the audit history.
            </p>
          </>
        ) : status === "connecting" ? (
          <div className="judge-connection-status">
            Connecting to the Judge…
          </div>
        ) : (
          <>
            <div className="judge-connection-status">
              <span className="live-dot" />
              {channel === "voice"
                ? "Voice discussion active"
                : "Text discussion active"}
            </div>
            {channel === "voice" ? (
              <>
                <div
                  className={`judge-voice-status ${userIsSpeaking ? "user-speaking" : ""} ${isSpeaking ? "judge-speaking" : ""}`}
                  aria-live="polite"
                >
                  <span className="judge-voice-indicator">
                    {isSpeaking ? (
                      <Volume2 size={16} />
                    ) : isMuted ? (
                      <MicOff size={16} />
                    ) : (
                      <Mic size={16} />
                    )}
                  </span>
                  <div className="judge-voice-status-copy">
                    <strong>
                      {thinking
                        ? "Local Qwen is thinking…"
                        : isSpeaking
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
                      {thinking
                        ? "Checking this saved verdict and its evidence. The local model may be finishing a council turn."
                        : isSpeaking
                          ? outputLevel > 0.03
                            ? "Audio is playing through your selected output."
                            : "The Judge is replying. Check your device output if you hear nothing."
                          : "Speak naturally; the indicator lights when your microphone picks up your voice."}
                    </span>
                  </div>
                  <div
                    className="judge-audio-meter"
                    aria-label={`Microphone level ${Math.round(inputLevel * 100)} percent`}
                  >
                    <span
                      style={{
                        width: `${Math.min(100, Math.round(inputLevel * 300))}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="inline-actions">
                  <Button
                    variant="secondary"
                    onClick={() => setMuted(!isMuted)}
                  >
                    {isMuted ? <Mic size={14} /> : <MicOff size={14} />}
                    {isMuted ? "Unmute" : "Mute"}
                  </Button>
                  <Button variant="secondary" onClick={pauseVoiceConversation}>
                    <PauseCircle size={14} /> Pause conversation
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      channel === "voice" ? closeVoice() : void endSession()
                    }
                  >
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
                <Button
                  disabled={!input.trim() || thinking}
                  aria-label="Send message"
                >
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
      {reviewHref && (
        <Link className="vc-link-button" to={reviewHref} onClick={closeVoice}>
          Review and confirm requirements
        </Link>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {channel === "voice" && status === "disconnected" && (
        <p className="small muted">
          Your browser will ask for microphone access when you start the voice
          discussion.
        </p>
      )}
    </div>
  );
  return voiceOpen ? (
    createPortal(
      <dialog
        ref={dialogRef}
        className={`jury-voice-popup ${isSpeaking ? "judge-talking" : userIsSpeaking ? "pm-talking" : ""}`}
        aria-labelledby="jury-voice-title"
        onCancel={(event) => {
          event.preventDefault();
          closeVoice();
        }}
        style={
          {
            "--aurora-energy": Math.min(
              1,
              (isSpeaking ? outputLevel : isMuted ? 0 : inputLevel) * 3,
            ),
          } as CSSProperties
        }
      >
        <div className="jury-aurora" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <header className="jury-popup-heading">
          <div>
            <span>BMW NEXT / INTELLIGENT DIALOGUE</span>
            <h2 id="jury-voice-title">A moment with your Judge.</h2>
          </div>
          <button
            type="button"
            className="jury-popup-close"
            onClick={closeVoice}
            aria-label="Close voice conversation"
          >
            <X size={22} />
          </button>
        </header>
        <div className="jury-popup-content">{content}</div>
      </dialog>,
      document.body,
    )
  ) : channel === "voice" ? (
    <div className="jury-compact-launch">
      <JuryAvatar
        speaking={false}
        listening={false}
        thinking={false}
        text=""
        energy={0}
        label="BMW Jury voice assistant"
      />
      <div className="jury-launch-actions">
        <Button onClick={() => connect(true)}>
          <Mic size={18} /> Start new conversation
        </Button>
        {visibleMessages.length > 0 && (
          <button className="text-link" onClick={() => connect(false)}>
            Continue previous chat
          </button>
        )}
        <button className="text-link" onClick={() => setChannel("text")}>
          Use text instead
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  ) : (
    content
  );
}
