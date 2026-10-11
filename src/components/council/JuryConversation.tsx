import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConversationProvider, type ClientTools } from "@elevenlabs/react";
import { Send } from "lucide-react";
import type { TopicOutcome } from "../../lib/council/contracts";
import { Button } from "../ui/Primitives";
import { JudgeConversationSession, type JudgeMessage } from "./JudgeConversationSession";

interface Thread { assessment_id: string; messages: JudgeMessage[] }
interface VoiceSession {
  assessment_id: string;
  agent_id: string;
  bridge: "ask_jury" | "saved_verdict_context";
  context: Record<string, unknown>;
  messages: JudgeMessage[];
}
async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Jury is unavailable. Retry this question.");
  return data;
}

/** The teammate's ElevenLabs SDK conversation, bound to the actual saved Jury. */
export function JuryConversation({ sessionId, outcome }: { sessionId: string; outcome: TopicOutcome }) {
  const assessment = outcome.assessment!.native_assessment!;
  const endpoint = `/api/moderator/sessions/${encodeURIComponent(sessionId)}/outcomes/${encodeURIComponent(outcome.topic_id)}/discussion`;
  const [voiceSession, setVoiceSession] = useState<VoiceSession | null>(null);
  const [messages, setMessages] = useState<JudgeMessage[]>([]);
  const [textMessages, setTextMessages] = useState<JudgeMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [localText, setLocalText] = useState(false);
  const mounted = useRef(true);
  const toolRequests = useRef(new Map<string, Promise<string>>());
  const lastPmEvent = useRef("");
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    setVoiceSession(null); setMessages([]); setTextMessages([]); setError("");
    toolRequests.current.clear();
    Promise.all([
      jsonRequest<VoiceSession>(`${endpoint}/conversation`, { signal: controller.signal }),
      jsonRequest<Thread>(endpoint, { signal: controller.signal }),
    ]).then(([voice, thread]) => {
      if (controller.signal.aborted) return;
      setVoiceSession(voice); setMessages(voice.messages); setTextMessages(thread.messages);
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => { mounted.current = false; controller.abort(); };
  }, [endpoint]);
  const record = useCallback((message: JudgeMessage) => {
    if (message.actor === "PM") lastPmEvent.current = message.id;
    setMessages((previous) => previous.some((m) => m.id === message.id) ? previous : [...previous, message]);
    writeQueue.current = writeQueue.current.catch(() => {}).then(() => jsonRequest(`${endpoint}/conversation`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...message, assessment_id: assessment.id }),
    })).catch((e) => { if (mounted.current) setError(`Transcript could not be saved: ${e.message}`); });
  }, [endpoint, assessment.id]);
  const askJury = useCallback(async (question: string) => {
    const thread = await jsonRequest<Thread>(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), assessment_id: assessment.id, content: question }),
    });
    if (mounted.current) setTextMessages(thread.messages);
    const reply = thread.messages.at(-1);
    if (!reply || reply.actor !== "judge") throw new Error("The saved Judge did not return a reply.");
    return reply.text;
  }, [endpoint, assessment.id]);
  const clientTools = useMemo<ClientTools>(() => ({
    ask_jury: async ({ question }) => {
      if (typeof question !== "string" || !question.trim() || question.length > 3000)
        return "Please ask one concise question about the saved Jury verdict.";
      const key = `${lastPmEvent.current}:${question}`;
      let call = toolRequests.current.get(key);
      if (!call) {
        call = askJury(question).catch((e) => {
          if (mounted.current) setError(e.message);
          return "The local Jury is temporarily unavailable. Please wait and ask again; no decision has been changed.";
        });
        toolRequests.current.set(key, call);
      }
      return call;
    },
  }), [askJury]);
  const agentId = voiceSession?.agent_id || import.meta.env.VITE_ELEVENLABS_AGENT_ID?.trim();
  return <section className="jury-live-handoff" aria-label="Discuss the actual Judge verdict">
    <header className="jury-live-heading"><span className="eyebrow">JURY / SAVED VERDICT</span><h2>Discuss with the Judge</h2>
      <p>{assessment.features[0]?.rationale || outcome.assessment?.summary}</p>
    </header>
    {voiceSession && agentId && !localText ? <ConversationProvider key={`${sessionId}:${assessment.id}`}>
      <JudgeConversationSession context={JSON.stringify(voiceSession.context)} run={assessment.id} agentId={agentId}
        messages={messages} onMessage={record} clientTools={voiceSession.bridge === "ask_jury" ? clientTools : undefined} />
    </ConversationProvider> : <div className="judge-conversation">
      {!voiceSession && !error ? <p role="status">Loading saved Jury…</p> : <>
        {!agentId && <p className="notice">The original ElevenLabs voice session needs your teammate’s Judge agent ID. Local Qwen text discussion is connected below.</p>}
        <div className="judge-message-list text-discussion" aria-live="polite">
          {textMessages.map((m) => <article key={m.id} className={`judge-message ${m.actor === "PM" ? "from-pm" : "from-judge"}`}><strong>{m.actor === "PM" ? "You · PM" : "Judge · local Qwen"}</strong><p>{m.text}</p></article>)}
          {pending && <p role="status">The local Judge is considering your question…</p>}
        </div>
        <form className="judge-text-form" onSubmit={async (event) => {
          event.preventDefault(); if (!input.trim() || pending) return;
          setPending(true); setError("");
          try { await askJury(input.trim()); if (mounted.current) setInput(""); }
          catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Could not reach Jury"); }
          finally { if (mounted.current) setPending(false); }
        }}><textarea aria-label="Your question" placeholder="Ask about the verdict or share your feedback…" rows={2} value={input} onChange={(event) => setInput(event.target.value)} />
          <Button disabled={!input.trim() || pending}><Send size={14} /> Ask Jury</Button>
        </form>
      </>}
    </div>}
    {agentId && <><p className="small muted">Original ElevenLabs voice agent · connected to this saved Qwen verdict. PM decisions remain on Decisions & scenarios.</p><button className="text-button" onClick={() => setLocalText(!localText)}>{localText ? "Return to ElevenLabs discussion" : "Ask local Qwen directly in text"}</button></>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
