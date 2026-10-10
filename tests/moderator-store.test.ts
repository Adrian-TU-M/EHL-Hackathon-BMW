import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moderatorApi } from "../src/lib/council/api";
import type {
  ModeratorEvent,
  ModeratorExport,
  ModeratorSession,
} from "../src/lib/council/contracts";
import {
  connectModerator,
  useModeratorStore,
} from "../src/store/useModeratorStore";

function session(id: string, sequence: number): ModeratorSession {
  return {
    id,
    sequence,
    revision: sequence,
    status: "running",
  } as ModeratorSession;
}
function event(id: string, sequence: number): ModeratorEvent {
  return {
    id: `${id}-${sequence}`,
    session_id: id,
    sequence,
    actor: "customer",
    statement: `Published turn ${sequence}`,
  } as ModeratorEvent;
}
function records(id: string, sequence: number): ModeratorExport {
  return {
    schema_version: 1,
    session: session(id, sequence),
    events: Array.from({ length: sequence }, (_, index) =>
      event(id, index + 1),
    ),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  useModeratorStore.setState({
    id: undefined,
    session: undefined,
    events: [],
    connected: false,
    error: undefined,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("live Moderator transcript recovery", () => {
  it("hydrates a running session once and preserves newer SSE turns", async () => {
    const read = deferred<ModeratorExport>();
    const exported = vi
      .spyOn(moderatorApi, "export")
      .mockReturnValue(read.promise);
    const store = useModeratorStore.getState();
    store.accept(session("live-a", 2));
    store.accept(session("live-a", 2));
    expect(exported).toHaveBeenCalledTimes(1);
    store.event(event("live-a", 3));
    read.resolve(records("live-a", 2));
    await vi.waitFor(() =>
      expect(
        useModeratorStore.getState().events.map((turn) => turn.sequence),
      ).toEqual([1, 2, 3]),
    );
    expect(useModeratorStore.getState().session?.status).toBe("running");
  });

  it("does not replace the selected session with a late transcript from another run", async () => {
    const oldRead = deferred<ModeratorExport>();
    const newRead = deferred<ModeratorExport>();
    vi.spyOn(moderatorApi, "export").mockImplementation((id) =>
      id === "old" ? oldRead.promise : newRead.promise,
    );
    useModeratorStore.getState().accept(session("old", 2));
    useModeratorStore.getState().accept(session("new", 1));
    oldRead.resolve(records("old", 2));
    newRead.resolve(records("new", 1));
    await vi.waitFor(() =>
      expect(
        useModeratorStore.getState().events.map((turn) => turn.id),
      ).toEqual(["new-1"]),
    );
    expect(useModeratorStore.getState().id).toBe("new");
  });

  it("keeps stages and history current through read-only polling when SSE is silent", async () => {
    vi.useFakeTimers();
    class SilentEventSource {
      onopen = null;
      onerror = null;
      addEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", SilentEventSource);
    useModeratorStore.getState().accept(session("silent", 0));
    const readSession = vi
      .spyOn(moderatorApi, "session")
      .mockResolvedValue(session("silent", 1));
    vi.spyOn(moderatorApi, "export").mockImplementation(async () =>
      records("silent", readSession.mock.calls.length),
    );
    const disconnect = connectModerator("silent");
    await vi.advanceTimersByTimeAsync(0);
    expect(useModeratorStore.getState().events).toHaveLength(1);
    readSession.mockResolvedValue(session("silent", 2));
    await vi.advanceTimersByTimeAsync(5000);
    expect(useModeratorStore.getState().session?.sequence).toBe(2);
    expect(useModeratorStore.getState().events).toHaveLength(2);
    disconnect();
    await vi.advanceTimersByTimeAsync(10000);
    expect(readSession).toHaveBeenCalledTimes(2);
  });
});
