import { create } from "zustand";
import { moderatorApi } from "../lib/council/api";
import type {
  ModeratorEvent,
  ModeratorSession,
} from "../lib/council/contracts";
function storedId() {
  try {
    return localStorage.getItem("bmw-moderator-session") || undefined;
  } catch {
    return undefined;
  }
}
interface State {
  id?: string;
  session?: ModeratorSession;
  events: ModeratorEvent[];
  error?: string;
  connected: boolean;
  accept: (s: ModeratorSession) => void;
  event: (e: ModeratorEvent) => void;
  refresh: () => Promise<void>;
  setError: (e?: string) => void;
  setConnected: (v: boolean) => void;
}
const transcriptReads = new Map<string, Promise<void>>();
export const useModeratorStore = create<State>((set, get) => ({
  id: storedId(),
  events: [],
  connected: false,
  accept(session) {
    if (
      get().session?.id === session.id &&
      (get().session!.sequence > session.sequence ||
        get().session!.revision > session.revision)
    )
      return;
    const changed = get().id !== session.id;
    set({
      id: session.id,
      session,
      error: undefined,
      ...(changed ? { events: [] } : {}),
    });
    // A fresh browser/deep link must show the already-published debate even if
    // SSE replay is delayed. Also repair gaps after reconnecting, not just the
    // final transcript. Export is a read of the canonical saved record.
    if (
      get().events.length < session.sequence &&
      !transcriptReads.has(session.id)
    ) {
      const pending = moderatorApi
        .export(session.id)
        .then((records) => {
          if (get().id !== session.id || records.session.id !== session.id)
            return;
          // Preserve SSE turns that arrived after this export's snapshot.
          const newer = get().events.filter(
            (event) => event.sequence > records.session.sequence,
          );
          set({
            events: [...records.events, ...newer].sort(
              (a, b) => a.sequence - b.sequence,
            ),
          });
          // Session refresh owns the current stage and PM revision. A delayed
          // transcript snapshot must never rewind those controls.
        })
        .catch(() => {
          /* The read-only refresh below retries; no model call is restarted. */
        })
        .finally(() => {
          if (transcriptReads.get(session.id) === pending)
            transcriptReads.delete(session.id);
        });
      transcriptReads.set(session.id, pending);
    }
    try {
      localStorage.setItem("bmw-moderator-session", session.id);
    } catch {
      /* server owns records */
    }
  },
  event(event) {
    if (
      event.session_id !== get().id ||
      get().events.some((e) => e.id === event.id)
    )
      return;
    set({
      events: [...get().events, event].sort((a, b) => a.sequence - b.sequence),
    });
  },
  async refresh() {
    const id = get().id;
    if (!id) return;
    try {
      const s = await moderatorApi.session(id);
      if (id === get().id) get().accept(s);
    } catch (e) {
      if (id === get().id)
        set({
          error: e instanceof Error ? e.message : "Moderator unavailable",
        });
    }
  },
  setError: (error) => set({ error }),
  setConnected: (connected) => set({ connected }),
}));

export function connectModerator(id: string): () => void {
  const store = useModeratorStore;
  let disposed = false,
    refreshing = false,
    queued = false;
  const after = store.getState().events.at(-1)?.sequence || 0;
  const stream = new EventSource(
    `/api/moderator/sessions/${id}/events?after=${after}`,
  );
  async function refresh() {
    if (refreshing) {
      queued = true;
      return;
    }
    refreshing = true;
    do {
      queued = false;
      if (!disposed) await store.getState().refresh();
    } while (queued && !disposed);
    refreshing = false;
    if (
      !disposed &&
      store.getState().id === id &&
      store.getState().session?.status === "complete"
    ) {
      stream.close();
      store.getState().setConnected(false);
      clearInterval(poll);
    }
  }
  // SSE remains the immediate update path. Polling protects against a silent
  // dropped stream and keeps stage/assessment changes visible after a reload.
  const poll = setInterval(() => {
    if (!disposed && store.getState().id === id) void refresh();
  }, 5000);
  void refresh();
  stream.onopen = () => {
    if (disposed || store.getState().id !== id) return;
    store.getState().setConnected(true);
    store.getState().setError(undefined);
  };
  stream.addEventListener("council", (e) => {
    if (disposed || store.getState().id !== id) return;
    try {
      store.getState().event(JSON.parse((e as MessageEvent).data));
      void refresh();
    } catch {
      store
        .getState()
        .setError(
          "Invalid moderator event; reconnect to replay the server record.",
        );
    }
  });
  stream.onerror = () => {
    if (disposed || store.getState().id !== id) return;
    store.getState().setConnected(false);
    void refresh();
  };
  return () => {
    disposed = true;
    clearInterval(poll);
    stream.close();
    store.getState().setConnected(false);
  };
}
