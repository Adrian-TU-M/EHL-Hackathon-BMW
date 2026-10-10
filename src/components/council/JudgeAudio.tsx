import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { api } from "../../lib/api/live";
import { Button } from "../ui/Primitives";
import { useSavedJudgeAudio } from "./useSavedJudgeAudio";

/** Endpoint must identify a saved server-side assessment, never arbitrary text. */
export function JudgeAudio({
  endpoint,
  assessmentId,
  label = "Hear the Judge",
}: {
  endpoint: string;
  assessmentId: string;
  label?: string;
}) {
  const [voice, setVoice] = useState<{
    configured: boolean;
    message: string;
  } | null>(null);
  const { audio, url, busy, error, play } = useSavedJudgeAudio(
    JSON.stringify([endpoint, assessmentId]),
  );
  useEffect(() => {
    const controller = new AbortController();
    void api<{ configured: boolean; message: string }>("/voice/status", {
      signal: controller.signal,
    })
      .then((next) => {
        if (!controller.signal.aborted) setVoice(next);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <div className="judge-audio-playback">
      <Button
        variant="secondary"
        disabled={busy || !voice?.configured}
        onClick={() => void play(endpoint, { assessment_id: assessmentId })}
      >
        <Volume2 size={15} />
        {busy ? "Preparing voice…" : label}
      </Button>
      {voice && !voice.configured && (
        <p className="small muted">{voice.message}</p>
      )}
      {url && (
        <audio
          ref={audio}
          controls
          autoPlay
          src={url}
          aria-label="Saved Judge assessment from ElevenLabs"
          style={{ width: "100%", marginTop: 12 }}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
