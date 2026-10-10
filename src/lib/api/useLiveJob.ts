import { useEffect, useState } from "react";
import { api, type Job } from "./live";
export function useLiveJob<T>(key: string, initialId?: string | null) {
  const [id, setId] = useState<string | null>(() => {
    try {
      return initialId || localStorage.getItem(key);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (initialId) setId(initialId);
  }, [initialId]);
  const [job, setJob] = useState<Job<T> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<Job<T>>(`/jobs/${encodeURIComponent(id!)}`, {
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        setJob(next);
        setError("");
        if (next.status === "queued" || next.status === "running")
          timer = setTimeout(poll, 1800);
      } catch (e) {
        if (abort.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Connection lost.");
        timer = setTimeout(poll, 5000);
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [id]);
  function reserve() {
    const nextId = crypto.randomUUID();
    try {
      localStorage.setItem(key, nextId);
    } catch {
      /* Memory-only fallback. */
    }
    setJob(null);
    setId(nextId);
    setError("");
    return nextId;
  }
  function discard() {
    setId(null);
    setJob(null);
    try {
      localStorage.removeItem(key);
    } catch {
      /* Optional storage. */
    }
  }
  function attach(next: Job<T>) {
    setJob(next);
    setId(next.id);
    setError("");
    try {
      localStorage.setItem(key, next.id);
    } catch {
      /* Current run still works without persistence. */
    }
  }
  return {
    job,
    error,
    attach,
    reserve,
    discard,
    busy:
      !!id &&
      (!job || job.status === "running" || job.status === "queued") &&
      !error,
  };
}
