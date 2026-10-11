import { useEffect, useRef, useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import { api, post } from "../../lib/api/live";
import {
  JudgeConversationSession,
  type JudgeMessage,
} from "./JudgeConversationSession";

/** Reuse the original SDK UI for the saved-proposal council route as well. */
export function ProposalVoiceConversation({ runId }: { runId: string }) {
  const [session, setSession] = useState<{
    agent_id: string;
    assessment_id: string;
    context: unknown;
    messages: JudgeMessage[];
  }>();
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const endpoint = `/review/debates/${runId}/conversation`;
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    api<NonNullable<typeof session>>(endpoint, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setSession(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [endpoint]);
  if (!session)
    return (
      <p role={error ? "alert" : "status"}>
        {error || "Loading the saved Jury…"}
      </p>
    );
  const agentId =
    session.agent_id || import.meta.env.VITE_ELEVENLABS_AGENT_ID?.trim();
  if (!agentId)
    return (
      <p>
        Configure the original ElevenLabs Judge agent ID to start a voice
        session. Local text discussion is available below the verdict.
      </p>
    );
  return (
    <>
      <ConversationProvider key={session.assessment_id}>
        <JudgeConversationSession
          agentId={agentId}
          run={session.assessment_id}
          context={JSON.stringify(session.context)}
          messages={session.messages}
          onMessage={(message) => {
            setSession(
              (current) =>
                current && {
                  ...current,
                  messages: current.messages.some((m) => m.id === message.id)
                    ? current.messages
                    : [...current.messages, message],
                },
            );
            writes.current = writes.current
              .catch(() => {})
              .then(() =>
                post(endpoint, {
                  ...message,
                  assessment_id: session.assessment_id,
                }),
              )
              .catch((e) => {
                if (mounted.current)
                  setError(`Transcript could not be saved: ${e.message}`);
              });
          }}
        />
      </ConversationProvider>
      <p className="small muted">
        Original ElevenLabs voice agent · this saved Qwen verdict. Only the PM
        changes a requirement or decision.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );
}
