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
export const useModeratorStore = create<State>((set, get) => ({
  id: storedId(),
  events: [],
  connected: false,
  accept(session) {
    if (
      get().session?.id === session.id &&
      get().session!.sequence > session.sequence
    )
      return;
    const changed = get().id !== session.id;
    set({
      id: session.id,
      session,
      error: undefined,
      ...(changed ? { events: [] } : {}),
    });
    if (
      session.status === "complete" &&
      (get().events.at(-1)?.sequence || 0) < session.sequence
    ) {
      void moderatorApi
        .export(session.id)
        .then((records) => {
          if (
            get().id === session.id &&
            (get().events.at(-1)?.sequence || 0) <= records.session.sequence
          )
            set({ events: records.events });
        })
        .catch(() => {
          /* SSE or a later refresh can replay the canonical record. */
        });
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
    if (store.getState().session?.status === "complete") {
      stream.close();
      store.getState().setConnected(false);
    }
  }
  void refresh();
  stream.onopen = () => {
    store.getState().setConnected(true);
    store.getState().setError(undefined);
  };
  stream.addEventListener("council", (e) => {
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
    store.getState().setConnected(false);
    void refresh();
  };
  return () => {
    disposed = true;
    stream.close();
    store.getState().setConnected(false);
  };
}
