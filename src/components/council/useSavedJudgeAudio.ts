import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Fetch only the immutable saved assessment/message named by the caller. */
export async function fetchSavedJudgeAudio(
  endpoint: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Blob | null> {
  const base = (import.meta.env.VITE_AGENT_API_URL || "").replace(/\/$/, "");
  try {
    const response = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (signal.aborted) return null;
    if (!response.ok) {
      const body = await response.json();
      if (signal.aborted) return null;
      throw new Error(
        typeof body.detail === "string"
          ? body.detail
          : "Judge voice is unavailable.",
      );
    }
    const blob = await response.blob();
    return signal.aborted ? null : blob;
  } catch (reason) {
    if (signal.aborted) return null;
    throw reason;
  }
}

/** One cancellable audio lifetime per saved assessment/version and component. */
export function useSavedJudgeAudio(identity: string) {
  const audio = useRef<HTMLAudioElement>(null);
  const request = useRef<AbortController | null>(null);
  const objectUrl = useRef("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const release = useCallback(() => {
    request.current?.abort();
    request.current = null;
    audio.current?.pause();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
  }, []);

  const stop = useCallback(() => {
    release();
    setUrl("");
    setBusy(false);
    setError("");
  }, [release]);

  // Stop the old assessment during commit, before its audio could autoplay
  // under new props. Cleanup also covers unmount and StrictMode remounts.
  useLayoutEffect(() => {
    stop();
    return release;
  }, [identity, release, stop]);

  async function play(endpoint: string, payload: Record<string, unknown>) {
    stop();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const blob = await fetchSavedJudgeAudio(
        endpoint,
        payload,
        controller.signal,
      );
      if (!blob || controller.signal.aborted || request.current !== controller)
        return;
      objectUrl.current = URL.createObjectURL(blob);
      setUrl(objectUrl.current);
    } catch (reason) {
      if (!controller.signal.aborted && request.current === controller) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to play Judge voice.",
        );
      }
    } finally {
      // A late old request must not clear the new request's loading state.
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return { audio, url, busy, error, play, stop };
}
