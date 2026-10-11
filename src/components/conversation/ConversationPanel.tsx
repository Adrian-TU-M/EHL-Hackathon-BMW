import { useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import type { ClientTools } from "@elevenlabs/react";
import { Mic, MicOff, MessageSquareText, Send, Square } from "lucide-react";
import { Button } from "../ui/Primitives";

interface Props {
  agentId: string;
  context: string;
  contextId: string;
  roleTitle: string;
  tools: ClientTools;
  onMessage: (message: {
    id: string;
    role: "user" | "assistant";
    text: string;
  }) => void;
}

// Shared conversation controls adapted from main's Judge handoff. No Judge-specific
// store actions or prompts are imported into a presentation conversation.
export function ConversationPanel(props: Props) {
  return (
    <ConversationProvider>
      <Session {...props} />
    </ConversationProvider>
  );
}

function Session({
  agentId,
  context,
  contextId,
  roleTitle,
  tools,
  onMessage,
}: Props) {
  const [channel, setChannel] = useState<"text" | "voice">("voice");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<
    { id: string; role: string; text: string }[]
  >([]);
  const conversationKey = useRef("");
  const conversation = useConversation({
    volume: channel === "voice" ? 1 : undefined,
    clientTools: tools,
    onError: (message) => setError(message),
    onMessage: ({ message, role, event_id }) => {
      if (!message.trim()) return;
      const entry = {
        id: `${contextId}-${conversationKey.current}-${event_id ?? crypto.randomUUID()}-${role}`,
        role: role === "user" ? ("user" as const) : ("assistant" as const),
        text: message.trim(),
      };
      setMessages((previous) =>
        previous.some((m) => m.id === entry.id)
          ? previous
          : [...previous, entry],
      );
      onMessage(entry);
    },
  });
  const { status, endSession, sendContextualUpdate } = conversation;
  useEffect(() => {
    if (status === "connected") sendContextualUpdate(context, { contextId });
  }, [status, context, contextId, sendContextualUpdate]);
  useEffect(() => () => endSession(), [endSession]);
  async function connect() {
    setError("");
    conversationKey.current = crypto.randomUUID();
    try {
      await conversation.startSession({
        agentId,
        textOnly: channel === "text",
        connectionType: channel === "text" ? "websocket" : "webrtc",
      });
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section className="conversation-panel">
      <div className="voice-heading">
        <div>
          <span className="eyebrow">ELEVENLABS</span>
          <h3>{roleTitle}</h3>
        </div>
        <span
          className={`voice-state ${status === "connected" ? "connected" : ""}`}
        >
          {status === "connected"
            ? conversation.isSpeaking
              ? "Assistant speaking"
              : conversation.isMuted
                ? "Microphone muted"
                : "Your turn"
            : status}
        </span>
      </div>
      {error ? (
        <p role="alert" className="studio-error">
          {error}. You can continue using the text editor.
        </p>
      ) : null}
      {status === "disconnected" ? (
        <div className="studio-actions">
          <label>
            Conversation channel
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as "text" | "voice")}
            >
              <option value="voice">Voice</option>
              <option value="text">Text</option>
            </select>
          </label>
          <Button onClick={connect}>
            {channel === "voice" ? (
              <Mic size={16} />
            ) : (
              <MessageSquareText size={16} />
            )}
            Start {channel} conversation
          </Button>
        </div>
      ) : (
        <div className="studio-actions">
          {channel === "voice" ? (
            <Button
              variant="secondary"
              onClick={() => conversation.setMuted(!conversation.isMuted)}
            >
              {conversation.isMuted ? <MicOff size={16} /> : <Mic size={16} />}
              {conversation.isMuted ? "Unmute" : "Mute"}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={endSession}>
            <Square size={14} />
            End conversation
          </Button>
        </div>
      )}
      <div className="voice-transcript" aria-live="polite">
        {messages.map((m) => (
          <article key={m.id}>
            <strong>{m.role === "user" ? "You" : roleTitle}</strong>
            <p>{m.text}</p>
          </article>
        ))}
      </div>
      {status === "connected" ? (
        <form
          className="studio-actions"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) {
              conversation.sendUserMessage(input.trim());
              setInput("");
            }
          }}
        >
          <input
            aria-label="Message the presentation assistant"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              conversation.sendUserActivity();
            }}
          />
          <Button type="submit" disabled={!input.trim()}>
            <Send size={16} />
            Send
          </Button>
        </form>
      ) : null}
      <p className="small muted">
        Starting voice asks for microphone access. Suggested slide edits require
        Apply in the studio.
      </p>
    </section>
  );
}
