import type { Audience, Presentation, SlideSpec } from "./contracts";
import { layoutCinematicSlide } from "./cinematic-theme";
import { layoutAutomotiveSlide } from "./automotive-theme";
import { layoutExecutiveSlide } from "./executive-theme";

export const SLIDE_WIDTH = 960;
export const SLIDE_HEIGHT = 540;
export const money = (v: number | null, currency: string) =>
  v === null
    ? "Not estimated"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        notation: v >= 1e6 ? "compact" : "standard",
        maximumFractionDigits: v >= 1e6 ? 2 : 0,
      }).format(v);

export interface TextElement {
  kind: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  color: string;
  bold: boolean;
  lines: string[];
  /** Degrees clockwise in slide coordinates, around x/y. */
  rotation?: number;
}
export interface RectElement {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  opacity?: number;
}
export interface ImageElement {
  kind: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
  fit?: "contain" | "cover";
  align?: "left" | "center" | "right";
  /** Normalized source bounds, including breathing room around the entire subject. */
  framing?: {
    aspectRatio: number;
    subject: { x: number; y: number; w: number; h: number };
  };
}

/** Shared SVG/export framing. Limit cover zoom before any part of the car is cropped. */
export function framedImagePlacement(e: ImageElement) {
  if (!e.framing) return null;
  const { aspectRatio, subject } = e.framing;
  const cover = Math.max(e.w / aspectRatio, e.h);
  const scale = Math.min(
    cover,
    e.w / (aspectRatio * subject.w),
    e.h / subject.h,
  );
  const w = aspectRatio * scale,
    h = scale;
  const position = (frame: number, image: number, center: number) =>
    image <= frame
      ? (frame - image) / 2
      : Math.max(frame - image, Math.min(0, frame / 2 - center * image));
  return {
    x: position(e.w, w, subject.x + subject.w / 2),
    y: position(e.h, h, subject.y + subject.h / 2),
    w,
    h,
  };
}
export interface ChartElement {
  kind: "chart";
  x: number;
  y: number;
  w: number;
  h: number;
  labels: string[];
  values: number[];
  caption: string;
  color?: string;
  ink?: string;
  background?: string;
}
export interface TableElement {
  kind: "table";
  x: number;
  y: number;
  w: number;
  h: number;
  rows: string[][];
  columnWidths?: number[];
  fontSize?: number;
  headerColor?: string;
  headerHeight?: number;
  columnFills?: string[];
  columnTextColors?: string[];
}
export type SlideElement =
  TextElement | RectElement | ImageElement | ChartElement | TableElement;
export interface SlideLayout {
  background: string;
  elements: SlideElement[];
  issues: string[];
}

// Fixed line breaks travel with the layout into each export. Conservative Arial metrics
// avoid browser/PDF/PowerPoint font substitution changing paragraph flow.
// Standard Arial/Helvetica advance widths, with separate bold metrics. Using the
// same measured line breaks prevents Office from adding an unplanned wrap.
const normalAdvances = [
  0.278, 0.278, 0.355, 0.556, 0.556, 0.889, 0.667, 0.191, 0.333, 0.333, 0.389,
  0.584, 0.278, 0.333, 0.278, 0.278, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556,
  0.556, 0.556, 0.556, 0.556, 0.278, 0.278, 0.584, 0.584, 0.584, 0.556, 1.015,
  0.667, 0.667, 0.722, 0.722, 0.667, 0.611, 0.778, 0.722, 0.278, 0.5, 0.667,
  0.556, 0.833, 0.722, 0.778, 0.667, 0.778, 0.722, 0.667, 0.611, 0.722, 0.667,
  0.944, 0.667, 0.667, 0.611, 0.278, 0.278, 0.278, 0.469, 0.556, 0.333, 0.556,
  0.556, 0.5, 0.556, 0.556, 0.278, 0.556, 0.556, 0.222, 0.222, 0.5, 0.222,
  0.833, 0.556, 0.556, 0.556, 0.556, 0.333, 0.5, 0.278, 0.556, 0.5, 0.722, 0.5,
  0.5, 0.5, 0.334, 0.26, 0.334, 0.584,
];
const boldAdvances = [
  0.278, 0.333, 0.474, 0.556, 0.556, 0.889, 0.722, 0.238, 0.333, 0.333, 0.389,
  0.584, 0.278, 0.333, 0.278, 0.278, 0.556, 0.556, 0.556, 0.556, 0.556, 0.556,
  0.556, 0.556, 0.556, 0.556, 0.333, 0.333, 0.584, 0.584, 0.584, 0.611, 0.975,
  0.722, 0.722, 0.722, 0.722, 0.667, 0.611, 0.778, 0.722, 0.278, 0.556, 0.722,
  0.611, 0.833, 0.722, 0.778, 0.667, 0.778, 0.722, 0.667, 0.611, 0.722, 0.667,
  0.944, 0.667, 0.667, 0.611, 0.333, 0.278, 0.333, 0.584, 0.556, 0.333, 0.556,
  0.611, 0.556, 0.611, 0.556, 0.333, 0.611, 0.611, 0.278, 0.278, 0.556, 0.278,
  0.889, 0.611, 0.611, 0.611, 0.611, 0.389, 0.556, 0.333, 0.611, 0.556, 0.778,
  0.556, 0.556, 0.5, 0.389, 0.28, 0.389, 0.584,
];
function width(text: string, size: number, bold = false) {
  const advances = bold ? boldAdvances : normalAdvances;
  return (
    [...text].reduce(
      (sum, c) =>
        sum + (advances[c.charCodeAt(0) - 32] ?? (c === "×" ? 0.584 : 0.62)),
      0,
    ) * size
  );
}
export function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  bold = false,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      if (line && width(line + " " + word, size, bold) > maxWidth) {
        lines.push(line);
        line = "";
      }
      if (width(word, size, bold) > maxWidth) {
        let fragment = "";
        for (const char of word) {
          if (width(fragment + char, size, bold) > maxWidth) {
            lines.push(fragment);
            fragment = "";
          }
          fragment += char;
        }
        line = fragment;
      } else line = line ? line + " " + word : word;
    }
    lines.push(line);
  }
  return lines;
}

function layoutLegacySlide(
  p: Presentation,
  slide: SlideSpec,
  index: number,
  _audience: Audience,
): SlideLayout {
  const dark = ["cover", "closing"].includes(slide.layout);
  const ink = dark ? "FFFFFF" : "14212F";
  const muted = dark ? "B8C5D8" : "596A7C";
  const elements: SlideElement[] = [];
  const issues: string[] = [];
  const text = (
    value: string,
    x: number,
    y: number,
    w: number,
    h: number,
    size: number,
    color = ink,
    bold = false,
  ) => {
    const lines = wrapText(value, w - 16, size, bold);
    if (lines.length * size * 1.24 > h)
      issues.push(`Slide ${index + 1}: shorten ${value.slice(0, 45)} to fit`);
    elements.push({ kind: "text", x, y, w, h, size, color, bold, lines });
  };
  elements.push({ kind: "rect", x: 48, y: 30, w: 40, h: 4, color: "1C69D4" });
  const draft = p.finalized_revision !== p.revision || p.stale;
  const disclosure = [
    slide.synthetic ? "SYNTHETIC DEMO" : "",
    draft ? "DRAFT" : "",
  ]
    .filter(Boolean)
    .join(" / ");
  text(disclosure, 48, 509, 760, 17, 10, muted);
  text(String(index + 1).padStart(2, "0"), 872, 508, 40, 19, 12, muted);

  if (slide.layout === "cover") {
    text("BMW NEXT", 48, 59, 400, 24, 14, "75A9EF", true);
    text(slide.title, 48, 103, 420, 149, 32, ink, true);
    text(slide.takeaway, 48, 266, 420, 64, 18, muted);
    slide.points.forEach((point, i) =>
      text(
        point,
        48,
        348 + i * 47,
        420,
        45,
        18,
        i === 0 ? "FFFFFF" : muted,
        i === 0,
      ),
    );
    const vehicle = String(p.snapshot.scope.vehicle || "G60").toLowerCase();
    elements.push({
      kind: "image",
      url: `/images/bmw-${["f70", "g60", "g70"].includes(vehicle) ? vehicle : "g60"}.webp`,
      x: 495,
      y: 145,
      w: 440,
      h: 248,
    });
    return { background: "091321", elements, issues };
  }
  text(slide.title, 48, 55, 864, 84, 32, ink, true);
  text(slide.takeaway, 48, 144, 864, 52, 18, muted);

  if (
    slide.layout === "financial" &&
    semanticRole(slide) === "scenarios" &&
    p.business_case.scenarios.length
  ) {
    const scenarios = p.business_case.scenarios;
    elements.push({
      kind: "chart",
      x: 48,
      y: 218,
      w: 540,
      h: 230,
      labels: scenarios.map((s) => s.name),
      values: scenarios.map((s) => s.net_value / 1e6),
      caption: `Three-year net value (${p.brief.currency} millions)`,
    });
    const base = scenarios.find((s) => s.name === "Base")!;
    text("BASE CASE", 640, 218, 270, 30, 14, "1C69D4", true);
    text(
      base.roi === null ? "ROI unknown" : `${Math.round(base.roi * 100)}% ROI`,
      640,
      256,
      270,
      46,
      30,
      ink,
      true,
    );
    text(`NPV ${money(base.npv, p.brief.currency)}`, 640, 316, 270, 54, 20);
    text(
      `Break-even: ${base.break_even_year === null ? "beyond model horizon" : "year " + base.break_even_year}`,
      640,
      383,
      270,
      62,
      18,
      muted,
    );
    text(
      "Adoption sensitivity only. Assumptions require validation.",
      48,
      467,
      864,
      28,
      12,
      muted,
    );
  } else if (
    slide.layout === "financial" &&
    semanticRole(slide) === "investment"
  ) {
    const f = p.brief.financials;
    elements.push({
      kind: "table",
      x: 48,
      y: 218,
      w: 530,
      h: 224,
      rows: [
        ["Investment allocation", p.brief.currency],
        ["Pilot", money(f.pilot.value, p.brief.currency)],
        ["Development", money(f.development.value, p.brief.currency)],
        ["Rollout", money(f.rollout.value, p.brief.currency)],
        ["Annual operating cost", money(f.annual_opex.value, p.brief.currency)],
      ],
    });
    text("VALUE MODEL", 630, 219, 280, 28, 14, "1C69D4", true);
    text(
      "Eligible vehicles x adoption x incremental contribution",
      630,
      260,
      280,
      90,
      22,
      ink,
      true,
    );
    text(
      p.business_case.missing.length
        ? "Missing assumptions are shown in the brief. Returns remain unknown."
        : "Portfolio benefits count once. Estimates are inputs, not measured outcomes.",
      630,
      368,
      280,
      100,
      18,
      muted,
    );
  } else if (slide.layout === "comparison" || slide.layout === "roadmap") {
    const count = Math.max(slide.points.length, 1);
    const col = 864 / count;
    slide.points.forEach((point, i) => {
      text(
        String(i + 1).padStart(2, "0"),
        48 + i * col,
        219,
        col - 24,
        46,
        30,
        "1C69D4",
        true,
      );
      text(point, 48 + i * col, 291, col - 24, 196, 18);
    });
  } else {
    const count = Math.max(slide.points.length, 1);
    const row = Math.min(80, 280 / count);
    slide.points.forEach((point, i) => {
      elements.push({
        kind: "rect",
        x: 48,
        y: 226 + i * row,
        w: 3,
        h: 30,
        color: "1C69D4",
      });
      text(point, 70, 222 + i * row, 830, row - 8, 20);
    });
  }
  return { background: dark ? "091321" : "FFFFFF", elements, issues };
}

export const PRESENTATION_THEMES = {
  "legacy-v1": { name: "Original", version: 1 },
  "premium-v1": { name: "BMW NEXT · Premium 01", version: 1 },
} as const;

const roles = [
  "cover",
  "problem",
  "evidence",
  "portfolio",
  "experience",
  "alternatives",
  "investment",
  "scenarios",
  "dependencies",
  "pilot",
  "risks",
  "decision",
];
export function semanticRole(slide: SlideSpec): string {
  return (
    slide.role ||
    (/^slide-\d+$/.test(slide.id)
      ? roles[Number(slide.id.slice(6)) - 1]
      : undefined) ||
    slide.layout
  );
}

// Projected text omits historic workflow boilerplate. Stored text and audit history stay intact.
export function presentationText(value: string): string {
  return value
    .replace(/(?:Synthetic PM approval|PM rationale|PM approval):\s*/gi, "")
    .replace(/\s*\/\s*approved version \d+/gi, "")
    .replace(/^(REQ-[\w-]+) v\d+:\s*/, "")
    .replace(
      /Requirement approval does not constitute budget approval/gi,
      "Further spending requires leadership authorization at each release gate",
    );
}

export function layoutSlide(
  p: Presentation,
  original: SlideSpec,
  index: number,
  audience: Audience,
): SlideLayout {
  const slide = {
    ...original,
    title: presentationText(original.title),
    takeaway: presentationText(original.takeaway),
    points: original.points.map(presentationText),
  };
  if (p.decks[audience]?.theme_id === "bmw-cinematic-v1")
    return layoutCinematicSlide(p, slide, index, audience);
  if (p.decks[audience]?.theme_id === "bmw-executive-v2")
    return layoutAutomotiveSlide(p, slide, index, audience);
  if (p.decks[audience]?.theme_id === "bmw-executive-v1")
    return layoutExecutiveSlide(p, slide, index, audience);
  if (p.decks[audience]?.theme_id !== "premium-v1")
    return layoutLegacySlide(p, slide, index, audience);
  return layoutPremiumSlide(p, slide, index, audience);
}

function layoutPremiumSlide(
  p: Presentation,
  slide: SlideSpec,
  index: number,
  audience: Audience,
): SlideLayout {
  const role = semanticRole(slide);
  const dark =
    role === "cover" || role === "decision" || slide.layout === "closing";
  const ink = dark ? "FFFFFF" : "14212F",
    muted = dark ? "B8C5D8" : "596A7C",
    blue = dark ? "75A9EF" : "1C69D4";
  const elements: SlideElement[] = [],
    issues: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, color: string) =>
    elements.push({ kind: "rect", x, y, w, h, color });
  const text = (
    value: string,
    x: number,
    y: number,
    w: number,
    h: number,
    size = 18,
    color = ink,
    bold = false,
  ) => {
    if (!value.trim()) return;
    const lines = wrapText(value, w - 16, size, bold);
    if (lines.length * size * 1.24 > h)
      issues.push(`Slide ${index + 1}: shorten ${value.slice(0, 45)} to fit`);
    elements.push({ kind: "text", x, y, w, h, size, color, bold, lines });
  };
  const department = {
    executive: "EXECUTIVE LEADERSHIP",
    finance: "FINANCE",
    engineering: "ENGINEERING",
    sales: "SALES & MARKETING",
  }[audience];
  const disclosure = [
    slide.synthetic ? "SYNTHETIC DEMO" : "",
    p.finalized_revision !== p.revision || p.stale ? "DRAFT" : "",
  ]
    .filter(Boolean)
    .join(" / ");
  text(disclosure, 48, 510, 700, 17, 10, muted);
  text(String(index + 1).padStart(2, "0"), 880, 508, 32, 20, 12, muted);
  rect(48, 32, 40, 4, blue);
  if (role === "cover") {
    text(department, 48, 64, 820, 24, 14, blue, true);
    text(slide.title, 48, 126, 864, 166, 42, ink, true);
    text(slide.takeaway, 48, 318, 492, 86, 22, muted);
    text(slide.points[0] || "", 48, 418, 540, 40, 22, ink, true);
    const attribution = [
      p.brief.presenter_name,
      p.brief.presenter_role,
      p.brief.meeting_date,
    ]
      .filter(Boolean)
      .join(" · ");
    text(attribution, 48, 467, 540, 31, 14, muted);
    const vehicle = String(p.snapshot.scope.vehicle || "G60").toLowerCase();
    elements.push({
      kind: "image",
      x: 610,
      y: 321,
      w: 302,
      h: 170,
      url: `/images/bmw-${["f70", "g60", "g70"].includes(vehicle) ? vehicle : "g60"}.webp`,
    });
    return { background: "091321", elements, issues };
  }
  text(slide.section || department, 104, 28, 808, 22, 12, blue, true);
  text(slide.title, 48, 65, 864, 86, 32, ink, true);
  text(slide.takeaway, 48, 160, 864, 52, 18, muted);
  if (role === "scenarios" && p.business_case.scenarios.length) {
    elements.push({
      kind: "chart",
      x: 48,
      y: 236,
      w: 552,
      h: 234,
      labels: p.business_case.scenarios.map((s) => s.name),
      values: p.business_case.scenarios.map((s) => s.net_value / 1e6),
      caption: `Three-year net value (${p.brief.currency} millions)`,
    });
    const base = p.business_case.scenarios.find((s) => s.name === "Base");
    if (base) {
      rect(630, 234, 2, 232, "D5DFEA");
      text("BASE CASE", 660, 236, 250, 22, 12, blue, true);
      text(
        base.roi === null ? "ROI unknown" : `${Math.round(base.roi * 100)}%`,
        660,
        272,
        250,
        62,
        44,
        ink,
        true,
      );
      text("Return on total cost", 660, 335, 250, 28, 16, muted);
      text(
        `NPV ${money(base.npv, p.brief.currency)}`,
        660,
        376,
        250,
        42,
        22,
        ink,
        true,
      );
      text(
        `Break-even: ${base.break_even_year === null ? "beyond model horizon" : "year " + base.break_even_year}`,
        660,
        425,
        250,
        54,
        18,
        muted,
      );
    }
    text(
      "Adoption sensitivity only; estimates require validation.",
      48,
      483,
      864,
      18,
      11,
      muted,
    );
  } else if (role === "investment") {
    const f = p.brief.financials;
    elements.push({
      kind: "table",
      x: 48,
      y: 230,
      w: 530,
      h: 245,
      rows: [
        ["Investment allocation", p.brief.currency],
        ["Pilot", money(f.pilot.value, p.brief.currency)],
        ["Development", money(f.development.value, p.brief.currency)],
        ["Rollout", money(f.rollout.value, p.brief.currency)],
        ["Annual operating cost", money(f.annual_opex.value, p.brief.currency)],
      ],
    });
    text("VALUE ASSUMPTIONS", 628, 230, 284, 24, 12, blue, true);
    text(
      "Eligible vehicles × adoption × incremental contribution",
      628,
      270,
      284,
      116,
      24,
      ink,
      true,
    );
    text(
      p.business_case.missing.length
        ? "Inputs remain unknown. Complete the brief before using a return forecast."
        : "Benefits count once across the portfolio. Estimates require validation.",
      628,
      399,
      284,
      91,
      18,
      muted,
    );
  } else if (role === "decision" || slide.layout === "closing") {
    const departmental = audience === "engineering" || audience === "sales";
    text(
      departmental ? "COMMITMENT REQUESTED" : "INITIAL FUNDING REQUEST",
      48,
      227,
      864,
      24,
      12,
      blue,
      true,
    );
    text(
      audience === "engineering"
        ? "Confirm the pilot scope"
        : audience === "sales"
          ? "Agree the launch evidence"
          : money(p.business_case.initial_ask, p.brief.currency),
      48,
      264,
      864,
      72,
      departmental ? 42 : 50,
      ink,
      true,
    );
    const nonfinancial = audience === "engineering" || audience === "sales";
    if (nonfinancial)
      text(slide.points[0] || "", 48, 345, 864, 56, 20, ink, true);
    const rest = slide.points.slice(1);
    rest.forEach((point, i) => {
      const col = 864 / Math.max(rest.length, 1);
      rect(48 + i * col, nonfinancial ? 411 : 363, col - 24, 1, "35465A");
      text(
        point,
        48 + i * col,
        nonfinancial ? 424 : 381,
        col - 24,
        nonfinancial ? 77 : 113,
        18,
        muted,
      );
    });
  } else if (role === "evidence") {
    const quotes = slide.points.slice(0, 2);
    quotes.forEach((point, i) => {
      rect(48, 231 + i * 124, 3, 100, "1C69D4");
      text(point, 68, 228 + i * 124, 522, 120, 22, ink, i === 0);
    });
    text("WHAT THIS ESTABLISHES", 638, 230, 274, 24, 12, blue, true);
    text(slide.points.slice(2).join(" "), 638, 273, 274, 198, 18, muted);
    const refs = p.snapshot.evidence
      .filter((e) => slide.evidence_ids.includes(e.id))
      .map((e) => e.id)
      .join(", ");
    text(`Sources: ${refs}`, 48, 484, 864, 18, 10, muted);
  } else if (slide.layout === "comparison") {
    const col = 864 / Math.max(slide.points.length, 1);
    slide.points.forEach((point, i) => {
      const split = point.indexOf(":");
      const heading = split > 0 ? point.slice(0, split) : `Option ${i + 1}`;
      const body = split > 0 ? point.slice(split + 1).trim() : point;
      text(heading, 48 + i * col, 231, col - 26, 76, 22, ink, true);
      rect(
        48 + i * col,
        318,
        col - 26,
        2,
        i === slide.points.length - 1 ? "1C69D4" : "D5DFEA",
      );
      text(body, 48 + i * col, 340, col - 26, 140, 20, muted);
    });
  } else if (slide.layout === "risk") {
    slide.points.forEach((point, i) => {
      const x = 48 + (i % 2) * 444,
        y = 229 + Math.floor(i / 2) * 133;
      text(String(i + 1).padStart(2, "0"), x, y, 40, 24, 14, blue, true);
      text(point, x + 42, y, 380, 119, 18);
      rect(x, y + 124, 420, 1, "D5DFEA");
    });
  } else if (role === "dependencies") {
    slide.points.forEach((point, i) => {
      const y = 231 + i * 64;
      text(String(i + 1).padStart(2, "0"), 48, y, 50, 30, 22, blue, true);
      text(point, 120, y, 792, 54, 20);
      if (i < slide.points.length - 1) rect(120, y + 56, 792, 1, "D5DFEA");
    });
  } else if (slide.layout === "roadmap" || slide.layout === "portfolio") {
    const col = 864 / Math.max(slide.points.length, 1);
    slide.points.forEach((point, i) => {
      text(
        String(i + 1).padStart(2, "0"),
        48 + i * col,
        230,
        col - 24,
        47,
        32,
        blue,
        true,
      );
      rect(48 + i * col, 288, col - 24, 2, "D5DFEA");
      text(point, 48 + i * col, 310, col - 24, 180, 18);
    });
  } else if (slide.layout === "appendix") {
    const labels = [
      "CUSTOMER REQUIREMENT",
      "REASON FOR THIS DIRECTION",
      "OPEN QUESTIONS",
      "SCENARIO CONTEXT",
    ];
    slide.points.forEach((point, i) => {
      const x = 48 + (i % 2) * 444,
        y = 228 + Math.floor(i / 2) * 151;
      text(labels[i], x, y, 420, 23, 12, blue, true);
      text(point, x, y + 31, 420, i < 2 ? 113 : 90, 18, ink, i === 0);
    });
  } else {
    const row = 260 / Math.max(slide.points.length, 1);
    slide.points.forEach((point, i) => {
      const y = 230 + i * row;
      text(String(i + 1).padStart(2, "0"), 48, y, 50, 33, 22, blue, true);
      text(point, 120, y, 792, row - 9, 20, ink, i === 0);
      if (i < slide.points.length - 1) rect(120, y + row - 6, 792, 1, "D5DFEA");
    });
  }
  return { background: dark ? "091321" : "FFFFFF", elements, issues };
}

export function chartPrimitives(
  chart: ChartElement,
): (TextElement | RectElement)[] {
  const min = Math.min(0, ...chart.values),
    max = Math.max(0.01, ...chart.values);
  const labelWidth = 140;
  const plotX = chart.x + labelWidth + 12,
    plotW = chart.w - labelWidth - 76,
    zero = plotX + (-min / (max - min)) * plotW;
  const result: (TextElement | RectElement)[] = [];
  chart.values.forEach((v, i) => {
    const endpoint = plotX + ((v - min) / (max - min)) * plotW;
    const y = chart.y + 20 + i * 60;
    result.push({
      kind: "text",
      x: chart.x,
      y,
      w: labelWidth,
      h: 26,
      size: 18,
      bold: false,
      color: chart.ink || "14212F",
      lines: [chart.labels[i]],
    });
    result.push({
      kind: "rect",
      x: Math.min(zero, endpoint),
      y,
      w: Math.max(1, Math.abs(endpoint - zero)),
      h: 28,
      color: v < 0 ? "A14A32" : chart.color || "1C69D4",
    });
    result.push({
      kind: "text",
      x: chart.x + chart.w - 52,
      y,
      w: 52,
      h: 26,
      size: 18,
      bold: true,
      color: chart.ink || "14212F",
      lines: [v.toFixed(2)],
    });
  });
  result.push({
    kind: "text",
    x: chart.x,
    y: chart.y + chart.h - 15,
    w: chart.w,
    h: 18,
    size: 11,
    bold: false,
    color: chart.ink || "596A7C",
    lines: [chart.caption],
  });
  return result;
}

export function tablePrimitives(
  table: TableElement,
): (TextElement | RectElement)[] {
  const headerH = table.headerHeight ?? table.h / table.rows.length;
  const rowH =
    table.rows.length > 1
      ? (table.h - headerH) / (table.rows.length - 1)
      : headerH;
  const widths =
    table.columnWidths ||
    (table.rows[0].length === 2
      ? [0.62, 0.38]
      : table.rows[0].map(() => 1 / table.rows[0].length));
  return table.rows.flatMap((row, i) =>
    row.flatMap((value, j) => {
      const x =
        table.x + widths.slice(0, j).reduce((a, b) => a + b, 0) * table.w;
      const y = table.y + (i === 0 ? 0 : headerH + (i - 1) * rowH);
      const height = i === 0 ? headerH : rowH;
      return [
        {
          kind: "rect" as const,
          x,
          y,
          w: table.w * widths[j],
          h: height,
          color:
            i === 0
              ? table.headerColor || "14212F"
              : table.columnFills?.[j] || (i % 2 ? "F0F4F8" : "FFFFFF"),
        },
        {
          kind: "text" as const,
          x: x + 10,
          y: y + 6,
          w: table.w * widths[j] - 20,
          h: height - 12,
          size: table.fontSize || 18,
          color: i === 0 ? "FFFFFF" : table.columnTextColors?.[j] || "14212F",
          bold: i === 0,
          lines: wrapText(
            value,
            table.w * widths[j] - 20,
            table.fontSize || 18,
            i === 0,
          ),
        },
      ];
    }),
  );
}
