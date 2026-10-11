import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  layoutSlide,
  wrapText,
  chartPrimitives,
  semanticRole,
  tablePrimitives,
  framedImagePlacement,
} from "../src/lib/presentation/layout";
import {
  presentationClientTools,
  type PresentationVoiceContext,
} from "../src/lib/presentation/voice-tools";
import { presentationApi } from "../src/lib/presentation/api";
import type {
  Presentation,
  SlideSpec,
} from "../src/lib/presentation/contracts";

vi.mock("../src/lib/presentation/api", () => ({
  presentationApi: { revise: vi.fn(), answer: vi.fn() },
}));

describe("BMW Executive Automotive theme", () => {
  it("uses a scoped hero photograph and falls back to typography for unknown vehicles", () => {
    const p = fixture();
    p.decks.executive!.theme_id = "bmw-executive-v1";
    const slide = p.decks.executive!.slides[0];
    slide.role = "cover";
    const layout = layoutSlide(p, slide, 0, "executive");
    expect(
      layout.elements.some(
        (e) =>
          e.kind === "image" &&
          e.url.endsWith("bmw-g60.webp") &&
          e.w === 480 &&
          e.fit === "cover",
      ),
    ).toBe(true);
    expect(
      layout.elements.some(
        (e) =>
          e.kind === "image" && e.url.endsWith("bmw-logo.svg") && e.w === e.h,
      ),
    ).toBe(true);
    p.snapshot.scope.vehicle = "Unknown";
    expect(
      layoutSlide(p, slide, 0, "executive").elements.filter(
        (e) => e.kind === "image",
      ),
    ).toHaveLength(1);
  });
  it("flags overlong titles and table cells without reducing font sizes", () => {
    const p = fixture();
    p.decks.executive!.theme_id = "bmw-executive-v1";
    const slide = p.decks.executive!.slides[0];
    slide.role = "risks";
    slide.title = "A very long title ".repeat(20);
    slide.content = {
      kind: "risks",
      items: [
        {
          label: "",
          detail: "Long cell ".repeat(60),
          owner: "",
          timing: "",
          dependency: "To validate",
          condition: "Hold",
          source_id: "",
        },
      ],
    };
    const layout = layoutSlide(p, slide, 0, "executive");
    expect(layout.issues.some((v) => v.includes("shorten table cell"))).toBe(
      true,
    );
    expect(layout.issues.some((v) => v.includes("move detail to notes"))).toBe(
      true,
    );
    expect(
      layout.elements.find((e) => e.kind === "text" && e.bold && e.size === 32),
    ).toBeDefined();
  });
  it("renders multi-column tables with shared wrapping and preserves unknown finance", () => {
    const cells = tablePrimitives({
      kind: "table",
      x: 48,
      y: 220,
      w: 864,
      h: 260,
      rows: [
        ["Option", "Approach", "Tradeoff"],
        ["Pilot", "Validate the need", "Unknown"],
      ],
      columnWidths: [0.24, 0.42, 0.34],
      fontSize: 18,
    });
    const header = cells.filter((e) => e.kind === "text").slice(0, 3);
    header.forEach((e, i) => expect(e.x).toBeCloseTo([58, 265.36, 628.24][i]));
    const p = fixture();
    p.decks.executive!.theme_id = "bmw-executive-v1";
    p.decks.executive!.slides[0].role = "investment";
    const layout = layoutSlide(p, p.decks.executive!.slides[0], 6, "executive");
    expect(layout.elements.some((e) => e.kind === "chart")).toBe(false);
    expect(
      layout.elements.some(
        (e) =>
          e.kind === "text" &&
          e.lines.join(" ") === "Spending not yet estimated",
      ),
    ).toBe(true);
  });
});

describe("BMW template-inspired version 02", () => {
  it("preserves historical rendering and uses a right-focused vehicle hero", () => {
    const p = fixture(),
      s = p.decks.executive!.slides[0];
    s.role = "cover";
    s.points = ["Initial request: $600,000"];
    p.decks.executive!.theme_id = "bmw-executive-v1";
    const historical = layoutSlide(p, s, 0, "executive");
    p.decks.executive!.theme_id = "bmw-executive-v2";
    const updated = layoutSlide(p, s, 0, "executive");
    const hero = updated.elements.find(
      (e) => e.kind === "image" && e.url.includes("bmw-g60"),
    );
    expect(hero).toMatchObject({ h: 496, align: "right", fit: "cover" });
    expect(updated.issues).toEqual([]);
    p.decks.executive!.theme_id = "bmw-executive-v1";
    expect(layoutSlide(p, s, 0, "executive")).toEqual(historical);
    p.decks.executive!.theme_id = "bmw-executive-v2";
    p.snapshot.scope.vehicle = "Unsupported";
    expect(
      layoutSlide(p, s, 0, "executive").elements.filter(
        (e) => e.kind === "image",
      ),
    ).toHaveLength(1);
  });
  it("retains every distinct evidence limitation without repeating identical ones", () => {
    const p = fixture(),
      s = p.decks.executive!.slides[0];
    p.decks.executive!.theme_id = "bmw-executive-v2";
    s.role = "evidence";
    const item = {
      label: "Source",
      detail: "A supported customer quotation",
      source_id: "e1",
      condition: "Prevalence remains unknown",
      owner: "",
      timing: "",
      dependency: "",
    };
    s.content = { kind: "evidence", items: [item, { ...item }] };
    let layout = layoutSlide(p, s, 0, "executive");
    expect(layout.issues).toEqual([]);
    expect(
      layout.elements.filter(
        (e) => e.kind === "text" && e.lines.join(" ") === item.condition,
      ),
    ).toHaveLength(1);
    s.content.items[1].condition = "Commercial effects remain unknown";
    layout = layoutSlide(p, s, 0, "executive");
    expect(layout.issues).toEqual([]);
    expect(
      layout.elements.filter(
        (e) => e.kind === "text" && e.lines.join(" ").includes("unknown"),
      ),
    ).toHaveLength(2);
  });
  it("keeps long appendix content readable and sends extensive reference detail to notes", () => {
    const p = fixture(),
      s = p.decks.executive!.slides[0];
    p.decks.executive!.theme_id = "bmw-executive-v2";
    s.role = "appendix";
    s.layout = "appendix";
    s.points = Array(4).fill(
      "Keep the frozen customer requirement visible and preserve every uncertainty, with delivery dependencies, validation measures, owners and dates confirmed before further investment.",
    );
    p.snapshot.evidence[0].location =
      "A very long exact source location ".repeat(20);
    const original = JSON.stringify(s);
    const layout = layoutSlide(p, s, 14, "executive");
    expect(layout.issues).toEqual([]);
    expect(JSON.stringify(s)).toBe(original);
    expect(
      layout.elements.some(
        (e) =>
          e.kind === "text" &&
          e.lines
            .join(" ")
            .includes("Full source locations and passages in speaker notes"),
      ),
    ).toBe(true);
    expect(
      layout.elements
        .filter((e) => e.kind === "text" && e.x === 245)
        .every((e) => e.kind === "text" && e.size === 18),
    ).toBe(true);
  });
  it("shares comparison-column fills and readable text colours across renderers", () => {
    const p = fixture(),
      s = p.decks.executive!.slides[0];
    p.decks.executive!.theme_id = "bmw-executive-v2";
    s.role = "alternatives";
    s.content = {
      kind: "comparison",
      items: [
        {
          label: "Pilot",
          detail: "Validate the need",
          condition: "Unknown effectiveness",
          source_id: "",
          owner: "",
          timing: "",
          dependency: "",
        },
      ],
    };
    const table = layoutSlide(p, s, 0, "executive").elements.find(
      (e) => e.kind === "table",
    );
    expect(table?.kind).toBe("table");
    if (table?.kind !== "table")
      throw new Error("Missing native comparison table");
    const cells = tablePrimitives(table);
    expect(cells.some((e) => e.kind === "rect" && e.color === "00ACEC")).toBe(
      true,
    );
    expect(
      cells.some(
        (e) =>
          e.kind === "text" &&
          e.color === "FFFFFF" &&
          e.lines.includes("Pilot"),
      ),
    ).toBe(true);
    expect(
      cells.some(
        (e) =>
          e.kind === "text" &&
          e.color === "091321" &&
          e.lines.includes("Validate the need"),
      ),
    ).toBe(true);
  });
});

describe("Cinematic automotive theme", () => {
  it("keeps the locked PM content intact while introducing photographic composition", () => {
    const p = fixture(),
      s = p.decks.executive!.slides[0];
    p.decks.executive!.theme_id = "bmw-cinematic-v1";
    s.role = "cover";
    s.points = ["Initial request: Not estimated"];
    s.locked = true;
    const before = JSON.stringify(s);
    const layout = layoutSlide(p, s, 0, "executive");
    expect(layout.background).toBe("091321");
    expect(layout.issues).toEqual([]);
    expect(
      layout.elements.some(
        (e) =>
          e.kind === "image" && e.url.endsWith("bmw-g60.webp") && e.x >= 472,
      ),
    ).toBe(true);
    expect(layout.elements.some((e) => e.kind === "image" && e.framing)).toBe(
      true,
    );
    expect(JSON.stringify(s)).toBe(before);
  });
  it.each([
    // Independently annotated whole-car extents in the original photographs.
    ["g60", 1920, 840, 550, 210, 1040, 520],
    ["f70", 1920, 840, 595, 205, 1150, 485],
    ["g70", 1606, 700, 765, 190, 775, 290],
  ] as const)(
    "keeps the %s bumpers, roof and wheels inside every photographic frame",
    (vehicle, width, height, x, y, w, h) => {
      const p = fixture(),
        s = p.decks.executive!.slides[0];
      p.decks.executive!.theme_id = "bmw-cinematic-v1";
      p.snapshot.scope.vehicle = vehicle;
      s.role = "cover";
      const image = layoutSlide(p, s, 0, "executive").elements.find(
        (e) => e.kind === "image" && e.url.endsWith(".webp"),
      );
      if (!image || image.kind !== "image")
        throw new Error("Missing vehicle photograph");
      for (const [frameW, frameH] of [
        [488, 496],
        [834, 540],
        [960, 540],
      ]) {
        const frame = framedImagePlacement({ ...image, w: frameW, h: frameH })!;
        expect(frame.x + (x / width) * frame.w).toBeGreaterThan(0);
        expect(frame.y + (y / height) * frame.h).toBeGreaterThan(0);
        expect(frame.x + ((x + w) / width) * frame.w).toBeLessThan(frameW);
        expect(frame.y + ((y + h) / height) * frame.h).toBeLessThan(frameH);
        expect(frame.w / frame.h).toBeCloseTo(width / height);
      }
    },
  );
  it("exports unknown investment inputs without a fabricated chart or unreadable figure", () => {
    const p = fixture(),
      s = p.decks.executive!.slides[0];
    p.decks.executive!.theme_id = "bmw-cinematic-v1";
    s.role = "investment";
    const layout = layoutSlide(p, s, 6, "executive");
    expect(layout.issues).toEqual([]);
    expect(layout.elements.some((e) => e.kind === "chart")).toBe(false);
    expect(
      layout.elements.some(
        (e) =>
          e.kind === "text" &&
          e.lines.join(" ") === "Spending not yet estimated",
      ),
    ).toBe(true);
  });
  it("uses the same compact header and expanded body-row geometry in native tables", () => {
    const cells = tablePrimitives({
      kind: "table",
      x: 166,
      y: 226,
      w: 746,
      h: 272,
      headerHeight: 36,
      rows: [
        ["Option", "Approach"],
        ["Pilot", "Validate the need"],
        ["Retain", "Observe"],
      ],
      columnWidths: [0.3, 0.7],
      fontSize: 18,
    });
    const text = cells.filter((e) => e.kind === "text");
    expect(text.map((e) => e.y)).toEqual([232, 232, 268, 268, 386, 386]);
    expect(text[2].h).toBe(106);
  });
});

const unknown = () => ({
  value: null,
  origin: "unknown" as const,
  reference: "",
});
function fixture(): Presentation {
  const slide: SlideSpec = {
    id: "slide-1",
    title: "The customer need",
    takeaway: "Test the approved need before scaling",
    layout: "evidence",
    points: ["Approved customer need; prevalence remains unknown"],
    notes: "Source: fixture row A2",
    decision_ids: ["r1"],
    evidence_ids: ["e1"],
    locked: false,
    synthetic: true,
  };
  return {
    id: "p1",
    revision: 1,
    created_at: "fixture",
    updated_at: "fixture",
    mode: "demo",
    brief: {
      title: "A bounded pilot",
      audience: "executive",
      minutes: 12,
      currency: "USD",
      emphasis: "Customer value",
      constraints: "Unknown delivery cost",
      funding_structure: "staged",
      financials: {
        pilot: unknown(),
        development: unknown(),
        rollout: unknown(),
        annual_opex: unknown(),
        eligible_volume: unknown(),
        contribution: unknown(),
        adoption: [unknown(), unknown(), unknown()],
        discount_rate: unknown(),
      },
    },
    snapshot: {
      schema_version: 1,
      kind: "isolated_demo",
      source_id: "fixture",
      source_hash: "hash",
      captured_at: "fixture",
      scope: { vehicle: "G60" },
      weights: {},
      synthetic: true,
      limitations: ["Synthetic"],
      decisions: [],
      evidence: [
        {
          id: "e1",
          source: "Fixture",
          location: "A2",
          passage: "Customer friction",
          provenance: "synthetic",
          limitations: [],
        },
        {
          id: "unrelated",
          source: "Fixture",
          location: "A3",
          passage: "Other topic",
          provenance: "synthetic",
          limitations: [],
        },
      ],
    },
    business_case: {
      currency: "USD",
      investment: null,
      initial_ask: null,
      scenarios: [],
      missing: ["pilot"],
      assumptions: {},
      limitations: [],
      argument: null,
    },
    outline: [],
    outline_approved: true,
    decks: {
      executive: { audience: "executive", slides: [slide], complete: true },
    },
    dossiers: [],
    proposals: [],
    jobs: [],
    history: [],
    rehearsals: [],
    voice_messages: [],
    events: [],
    finalized_revision: null,
    stale: false,
    update_available: false,
    review_findings: [],
  };
}

describe("Shared slide layout boundaries", () => {
  it("preserves synthetic and draft disclosures through finalization and stale approval", () => {
    const p = fixture(),
      slide = p.decks.executive!.slides[0];
    const text = () =>
      layoutSlide(p, slide, 0, "executive")
        .elements.filter((e) => e.kind === "text")
        .flatMap((e) => e.lines)
        .join(" ");
    expect(text()).toContain("SYNTHETIC DEMO / DRAFT");
    p.finalized_revision = p.revision;
    expect(text()).toContain("SYNTHETIC DEMO");
    expect(text()).not.toMatch(/PM FINALIZED|PM approved|REVISION/i);
    p.stale = true;
    expect(text()).toContain("SYNTHETIC DEMO / DRAFT");
  });
  it("rejects overflowing content instead of hiding it or shrinking body text", () => {
    const p = fixture(),
      slide = p.decks.executive!.slides[0];
    expect(layoutSlide(p, slide, 0, "executive").issues).toEqual([]);
    slide.takeaway = "An overlong argument with repeated details. ".repeat(18);
    expect(layoutSlide(p, slide, 0, "executive").issues.length).toBeGreaterThan(
      0,
    );
    expect(wrapText("W".repeat(80), 160, 20).length).toBeGreaterThan(5);
  });
  it("accounts for bold glyph width before PowerPoint adds a second wrap", () => {
    const text = "feedback, minimizing visual search during normal";
    expect(wrapText(text, 404, 18, false)).toHaveLength(1);
    expect(wrapText(text, 404, 18, true)).toEqual([
      "feedback, minimizing visual search during",
      "normal",
    ]);
  });
  it("renders the PM-edited cover title", () => {
    const p = fixture(),
      slide = p.decks.executive!.slides[0];
    slide.layout = "cover";
    slide.title = "The PM's investment decision";
    const rendered = layoutSlide(p, slide, 0, "executive")
      .elements.filter((e) => e.kind === "text")
      .flatMap((e) => e.lines)
      .join(" ");
    expect(rendered).toContain(slide.title);
  });
  it("keeps positive, negative and zero scenario bars within chart bounds", () => {
    const elements = chartPrimitives({
      kind: "chart",
      x: 48,
      y: 200,
      w: 540,
      h: 230,
      labels: ["Downside", "Base", "Upside"],
      values: [-1.05, 0, 4.2],
      caption: "USD millions / illustrative",
    });
    for (const element of elements) {
      expect(element.x).toBeGreaterThanOrEqual(48);
      expect(element.x + element.w).toBeLessThanOrEqual(588);
    }
    expect(
      elements.some((e) => e.kind === "rect" && e.color === "A14A32"),
    ).toBe(true);
  });
  it("uses semantic financial roles after department-specific reordering", () => {
    const p = fixture(),
      slide = p.decks.executive!.slides[0];
    p.decks.executive!.theme_id = "premium-v1";
    slide.role = "investment";
    slide.layout = "financial";
    slide.id = "arbitrary-id";
    slide.section = "Spending and assumptions";
    const result = layoutSlide(p, slide, 1, "executive");
    expect(result.elements.some((e) => e.kind === "table")).toBe(true);
    expect(result.issues).toEqual([]);
    expect(semanticRole(slide)).toBe("investment");
  });
  it("shows named presenter details and removes historic approval prefixes", () => {
    const p = fixture(),
      slide = p.decks.executive!.slides[0];
    p.decks.executive!.theme_id = "premium-v1";
    slide.role = "cover";
    slide.layout = "cover";
    slide.takeaway = "PM rationale: Test before scaling";
    slide.points = ["Initial request: $600,000"];
    p.brief.presenter_name = "Alex Morgan";
    p.brief.presenter_role = "Product Manager";
    p.brief.meeting_date = "2026-10-10";
    const layout = layoutSlide(p, slide, 0, "executive");
    const text = layout.elements
      .filter((e) => e.kind === "text")
      .flatMap((e) => e.lines)
      .join(" ");
    expect(text).toContain("Alex Morgan · Product Manager · 2026-10-10");
    expect(text).not.toContain("PM rationale");
    expect(layout.issues).toEqual([]);
    expect(slide.takeaway).toContain("PM rationale");
  });
});

describe("ElevenLabs client tool boundaries", () => {
  beforeEach(() => vi.clearAllMocks());
  function setup() {
    const p = fixture();
    const state: PresentationVoiceContext = {
      presentation: p,
      audience: "executive",
      slide: p.decks.executive!.slides[0],
      onAccept: vi.fn(),
      onNavigate: vi.fn(),
    };
    return { state, tools: presentationClientTools(() => state) };
  }
  it("reads only relevant source passages and navigates valid one-based slides", async () => {
    const { state, tools } = setup();
    const data = JSON.parse(String(await tools.get_presentation_context({})));
    expect(data.evidence.map((e: { id: string }) => e.id)).toEqual(["e1"]);
    await tools.show_slide({ slide_number: 1 });
    await tools.show_slide({ slide_number: 100 });
    expect(state.onNavigate).toHaveBeenCalledTimes(1);
    expect(state.onNavigate).toHaveBeenCalledWith(0);
  });
  it("requests a proposal without applying edits or changing financial inputs", async () => {
    const { state, tools } = setup();
    const before = structuredClone(state.presentation);
    vi.mocked(presentationApi.revise).mockResolvedValue(state.presentation);
    const result = await tools.request_revision({
      instruction: "Make this clearer for Finance",
    });
    expect(result).toContain("PM must review and apply");
    expect(presentationApi.revise).toHaveBeenCalledWith(
      state.presentation,
      "executive",
      "slide-1",
      "Make this clearer for Finance",
    );
    expect(state.presentation).toEqual(before);
  });
  it("blocks revision requests in rehearsal and routes answers separately", async () => {
    const { state, tools } = setup();
    state.persona = "cfo";
    state.presentation.rehearsals.push({
      id: "rehearsal-1",
      persona: "cfo",
      audience: "executive",
      deck_revision: 1,
      messages: [],
      feedback: [],
      complete: false,
    });
    expect(
      await tools.request_revision({ instruction: "Change the budget" }),
    ).toContain("read-only");
    expect(presentationApi.revise).not.toHaveBeenCalled();
    vi.mocked(presentationApi.answer).mockResolvedValue(state.presentation);
    await tools.submit_rehearsal_answer({
      answer: "The pilot tests the assumptions.",
    });
    expect(presentationApi.answer).toHaveBeenCalledWith(
      state.presentation,
      "rehearsal-1",
      "The pilot tests the assumptions.",
    );
  });
  it("keeps previous rehearsals out of editing context and rejects mismatched sessions", async () => {
    const { state, tools } = setup();
    state.presentation.rehearsals.push({
      id: "rehearsal-1",
      persona: "cfo",
      audience: "executive",
      deck_revision: 1,
      messages: [],
      feedback: [],
      complete: false,
    });
    let context = JSON.parse(String(await tools.get_presentation_context({})));
    expect(context.mode).toBe("editing");
    expect(context.rehearsal).toBeUndefined();
    state.persona = "cfo";
    context = JSON.parse(String(await tools.get_presentation_context({})));
    expect(context.mode).toBe("rehearsal");
    expect(context.rehearsal.id).toBe("rehearsal-1");
    state.persona = "engineering";
    expect(
      await tools.submit_rehearsal_answer({ answer: "A response" }),
    ).toContain("Start a rehearsal");
    state.persona = "cfo";
    state.presentation.revision = 2;
    expect(
      await tools.submit_rehearsal_answer({ answer: "A response" }),
    ).toContain("Start a rehearsal");
    expect(presentationApi.answer).not.toHaveBeenCalled();
  });
});

it("fits four real council requirement labels without blocking export", () => {
  const p = fixture();
  p.decks.executive!.theme_id = "bmw-cinematic-v1";
  const slide = p.decks.executive!.slides[0];
  slide.role = "portfolio";
  slide.layout = "portfolio";
  slide.content = {
    kind: "portfolio",
    items: [
      {
        label: "How should usable range meet journey needs?",
        detail:
          "Adaptive range estimation for cold weather and dynamic fast-charging adjustments",
      },
      {
        label: "Essential controls accessibility",
        detail:
          "Evaluate physical buttons for essential controls during driving.",
      },
      {
        label: "Simpler and dependable charging",
        detail:
          "Charging card integration and real-time charger data in navigation",
      },
      {
        label: "Display legibility and usability",
        detail: "Evaluate haptic controls and a panoramic display",
      },
    ].map((item) => ({
      ...item,
      owner: "",
      timing: "",
      dependency: "",
      condition: "",
      source_id: "",
    })),
  };
  const layout = layoutSlide(p, slide, 3, "executive");
  expect(layout.issues).toEqual([]);
  expect(
    layout.elements
      .filter((e) => e.kind === "text")
      .every((e) => e.y + e.h <= 540),
  ).toBe(true);
});
