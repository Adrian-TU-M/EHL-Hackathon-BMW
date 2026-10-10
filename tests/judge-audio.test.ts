import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSavedJudgeAudio } from "../src/components/council/useSavedJudgeAudio";

afterEach(() => vi.unstubAllGlobals());

describe("saved Judge audio request lifetime", () => {
  it("discards a late response after its assessment was replaced", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const payload = { assessment_id: "original-assessment" };
    const audio = fetchSavedJudgeAudio(
      "/api/voice/debates/saved-run",
      payload,
      controller.signal,
    );
    payload.assessment_id = "new-assessment";
    controller.abort();
    resolve(new Response(new Blob(["old audio"], { type: "audio/mpeg" })));
    expect(await audio).toBeNull();
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
    expect(JSON.parse(init.body as string)).toEqual({
      assessment_id: "original-assessment",
    });
  });

  it("discards audio when cancellation happens while its body downloads", async () => {
    let completeBody!: (blob: Blob) => void;
    const body = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          completeBody = resolve;
        }),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: body }));
    const controller = new AbortController();
    const audio = fetchSavedJudgeAudio(
      "/api/voice/debates/saved-run",
      { assessment_id: "old" },
      controller.signal,
    );
    await vi.waitFor(() => expect(body).toHaveBeenCalledOnce());
    controller.abort();
    completeBody(new Blob(["old audio"]));
    expect(await audio).toBeNull();
  });

  it("returns the current saved reply and keeps real provider failures visible", async () => {
    const blob = new Blob(["current audio"], { type: "audio/mpeg" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }),
    );
    expect(
      await fetchSavedJudgeAudio(
        "/api/voice/debates/saved-run",
        { message_id: "saved-message" },
        new AbortController().signal,
      ),
    ).toBe(blob);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          json: async () => ({ detail: "Voice access unavailable" }),
        }),
    );
    await expect(
      fetchSavedJudgeAudio(
        "/api/voice/debates/saved-run",
        { assessment_id: "current" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Voice access unavailable");
  });
});
