import type { Audience, Presentation, SlideSpec } from "./contracts";
import type { SlideElement, SlideLayout, TableElement } from "./layout";
import { money, tablePrimitives, wrapText, semanticRole } from "./layout";

export const BMW_EXECUTIVE_THEME = {
  id: "bmw-executive-v1",
  width: 960,
  height: 540,
  margin: 48,
  white: "FFFFFF",
  navy: "091321",
  ink: "14212F",
  blue: "1C69D4",
  muted: "596A7C",
} as const;

/** All coordinates and line breaks are shared by SVG, PDF and editable PPTX. */
export function layoutExecutiveSlide(
  p: Presentation,
  s: SlideSpec,
  index: number,
  audience: Audience,
): SlideLayout {
  const t = BMW_EXECUTIVE_THEME;
  const role = semanticRole(s);
  const dark =
    role === "cover" || role === "decision" || s.layout === "closing";
  const ink = dark ? t.white : t.ink,
    muted = dark ? "B8C5D8" : t.muted;
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
    size = 20,
    color: string = ink,
    bold = false,
    maxLines?: number,
  ) => {
    if (!value.trim()) return;
    const lines = wrapText(value, w, size, bold);
    if (lines.length * size * 1.24 > h || (maxLines && lines.length > maxLines))
      issues.push(
        `Slide ${index + 1}: shorten “${value.slice(0, 42)}” or move detail to notes.`,
      );
    elements.push({ kind: "text", x, y, w, h, size, color, bold, lines });
  };
  const table = (rows: string[][], widths: number[], y = 212, h = 286) => {
    const item: TableElement = {
      kind: "table",
      x: 48,
      y,
      w: 864,
      h,
      rows,
      columnWidths: widths,
      fontSize: 18,
    };
    for (const cell of tablePrimitives(item)) {
      if (cell.kind === "text" && cell.lines.length * cell.size * 1.24 > cell.h)
        issues.push(
          `Slide ${index + 1}: shorten table cell “${cell.lines.join(" ").slice(0, 38)}”.`,
        );
    }
    elements.push(item);
  };
  const department = {
    executive: "EXECUTIVE LEADERSHIP",
    finance: "FINANCE",
    engineering: "ENGINEERING",
    sales: "SALES & MARKETING",
  }[audience];
  const disclosure = [
    s.synthetic ? "SYNTHETIC DEMO" : "",
    p.finalized_revision !== p.revision || p.stale ? "DRAFT" : "",
  ]
    .filter(Boolean)
    .join(" / ");
  const footer = () => {
    text(disclosure, 48, 513, 720, 16, 10, muted);
    text(String(index + 1).padStart(2, "0"), 880, 510, 32, 20, 12, muted);
  };
  if (role === "cover") {
    const vehicle = String(p.snapshot.scope.vehicle || "").toLowerCase();
    const hasPhoto = ["f70", "g60", "g70"].includes(vehicle);
    elements.push({
      kind: "image",
      x: 48,
      y: 34,
      w: 50,
      h: 50,
      url: "/images/bmw-logo.svg",
      fit: "contain",
    });
    text(department, 120, 49, 610, 24, 12, "75A9EF", true);
    if (hasPhoto)
      elements.push({
        kind: "image",
        x: 480,
        y: 114,
        w: 480,
        h: 320,
        url: `/images/bmw-${vehicle}.webp`,
        fit: "cover",
      });
    text(s.title, 48, 156, hasPhoto ? 402 : 864, 118, 44, ink, true, 2);
    text(s.takeaway, 48, 366, hasPhoto ? 400 : 864, 77, 20, muted);
    text(s.points[0] || "", 48, 451, 800, 30, 22, ink, true);
    text(
      [p.brief.presenter_name, p.brief.presenter_role, p.brief.meeting_date]
        .filter(Boolean)
        .join(" · "),
      48,
      487,
      800,
      18,
      12,
      muted,
    );
    footer();
    return { background: t.navy, elements, issues };
  }
  rect(48, 34, 32, 3, t.blue);
  text(
    s.section || department,
    94,
    28,
    818,
    20,
    11,
    dark ? "75A9EF" : t.blue,
    true,
  );
  text(s.title, 48, 65, 864, 82, 32, ink, true, 2);
  text(s.takeaway, 48, 156, 864, 51, 18, muted, false, 2);
  const items = s.content?.items;
  if (role === "investment") {
    const f = p.brief.financials;
    elements.push({
      kind: "chart",
      x: 48,
      y: 234,
      w: 520,
      h: 242,
      labels: ["Pilot", "Development", "Rollout"],
      values: [
        f.pilot.value || 0,
        f.development.value || 0,
        f.rollout.value || 0,
      ].map((v) => v / 1e6),
      caption: `Staged capital (${p.brief.currency} millions)`,
    });
    text("POTENTIAL PROGRAM", 620, 224, 292, 22, 12, t.blue, true);
    text(
      money(p.business_case.investment, p.brief.currency),
      620,
      258,
      292,
      60,
      42,
      ink,
      true,
    );
    text(
      `Annual operating cost: ${money(f.annual_opex.value, p.brief.currency)}`,
      620,
      334,
      292,
      62,
      20,
      muted,
    );
    text(
      p.business_case.missing.length
        ? "Unknown inputs remain. No return forecast is justified."
        : "Benefits count once across the portfolio. Validate the assumptions before commitment.",
      620,
      412,
      292,
      81,
      18,
      muted,
    );
    if ([f.pilot, f.development, f.rollout].some((v) => v.value === null)) {
      elements.splice(
        elements.findIndex((e) => e.kind === "chart"),
        1,
      );
      text("Spending not yet estimated", 48, 270, 520, 130, 32, ink, true);
    }
  } else if (role === "scenarios") {
    const base = p.business_case.scenarios.find((v) => v.name === "Base");
    if (base) {
      elements.push({
        kind: "chart",
        x: 48,
        y: 234,
        w: 552,
        h: 242,
        labels: p.business_case.scenarios.map((v) => v.name),
        values: p.business_case.scenarios.map((v) => v.net_value / 1e6),
        caption: `Three-year net value (${p.brief.currency} millions)`,
      });
      text("BASE CASE", 648, 224, 264, 22, 12, t.blue, true);
      text(
        base.roi === null ? "Unknown" : `${Math.round(base.roi * 100)}%`,
        648,
        258,
        264,
        60,
        44,
        ink,
        true,
      );
      text("Return on total cost", 648, 326, 264, 30, 18, muted);
      text(
        `NPV ${money(base.npv, p.brief.currency)}`,
        648,
        373,
        264,
        42,
        24,
        ink,
        true,
      );
      text(
        base.break_even_year === null
          ? "Break-even beyond model horizon"
          : `Break-even: year ${base.break_even_year}`,
        648,
        429,
        264,
        52,
        18,
        muted,
      );
      text(
        "Adoption sensitivity only; other assumptions held constant. Estimates require validation.",
        48,
        486,
        864,
        16,
        10,
        muted,
      );
    } else
      text("Financial inputs remain unknown", 48, 254, 864, 100, 32, ink, true);
  } else if (role === "decision" || s.layout === "closing") {
    text(
      audience === "engineering" || audience === "sales"
        ? "COMMITMENT REQUESTED"
        : "INITIAL FUNDING REQUEST",
      48,
      226,
      864,
      22,
      12,
      "75A9EF",
      true,
    );
    text(
      audience === "engineering"
        ? "Confirm the pilot scope"
        : audience === "sales"
          ? "Agree the launch evidence"
          : money(p.business_case.initial_ask, p.brief.currency),
      48,
      267,
      864,
      70,
      44,
      ink,
      true,
    );
    s.points.slice(1).forEach((point, i, all) => {
      const w = 864 / all.length;
      rect(48 + i * w, 362, w - 24, 1, "35465A");
      text(point, 48 + i * w, 382, w - 24, 112, 18, muted);
    });
    if (audience === "engineering" || audience === "sales")
      text(s.points[0] || "", 48, 335, 864, 24, 18, muted);
  } else if (s.content?.kind === "evidence" && items) {
    items.forEach((item, i) => {
      const y = 223 + i * 125;
      rect(48, y, 3, 94, t.blue);
      text(item.detail, 68, y, 524, 106, 22, ink, i === 0);
      text(
        item.condition || "Evidence limits remain to be established",
        638,
        y,
        274,
        98,
        18,
        muted,
      );
    });
    text(
      `Sources: ${items
        .map((v) => v.source_id)
        .filter(Boolean)
        .join(", ")}`,
      48,
      486,
      864,
      16,
      10,
      muted,
    );
  } else if (s.content?.kind === "comparison" && items) {
    table(
      [
        ["Option", "Approach", "Tradeoff"],
        ...items.map((v) => [
          v.label || "Option",
          v.detail,
          v.condition || "To assess",
        ]),
      ],
      [0.24, 0.42, 0.34],
    );
  } else if (s.content?.kind === "responsibilities" && items) {
    table(
      [
        ["Department", "Responsibility", "Dependency / owner"],
        ...items.map((v) => [
          v.label,
          v.detail,
          `${v.dependency || "To confirm"}\n${v.owner || "Owner to confirm"}`,
        ]),
      ],
      [0.22, 0.45, 0.33],
    );
  } else if (s.content?.kind === "risks" && items) {
    table(
      [
        ["Objection / consequence", "Mitigation", "Stop condition"],
        ...items.map((v) => [
          v.detail,
          v.dependency || "To confirm",
          v.condition || "To confirm",
        ]),
      ],
      [0.46, 0.29, 0.25],
    );
  } else if (s.content?.kind === "roadmap" && items) {
    items.forEach((item, i) => {
      const x = 48 + i * (864 / items.length),
        w = 864 / items.length - 22;
      text(item.timing || "Timing to confirm", x, 222, w, 50, 18, t.blue, true);
      rect(x, 279, w, 3, t.blue);
      text(item.label, x, 290, w, 56, 22, ink, true);
      text(item.detail, x, 347, w, 79, 18, muted);
      text(item.condition || "Gate to confirm", x, 428, w, 55, 18, ink);
      text(item.owner || "Owner to confirm", x, 487, w, 23, 18, muted);
    });
  } else if (s.content?.kind === "journey" && items) {
    items.forEach((item, i) => {
      const y = 221 + i * (276 / items.length);
      text(String(i + 1).padStart(2, "0"), 48, y, 52, 36, 26, t.blue, true);
      text(item.label, 120, y, 240, 58, 20, ink, true);
      text(item.detail, 390, y, 522, 58, 18, muted);
      if (i < items.length - 1) rect(120, y + 62, 792, 1, "D5DFEA");
    });
  } else if (items) {
    items.forEach((item, i) => {
      const y = 222 + i * (276 / items.length);
      text(item.label || "Customer need", 48, y, 270, 78, 22, ink, true);
      text(item.detail, 360, y, 552, 78, 20, muted);
      if (i < items.length - 1) rect(48, y + 82, 864, 1, "D5DFEA");
    });
  } else if (role === "appendix" || s.layout === "appendix") {
    // Editorial rows avoid the old four-quadrant appendix collisions.
    const labels = [
      "Requirement",
      "Business reasoning",
      "Open questions",
      "Scenario context",
    ];
    s.points.forEach((point, i) => {
      const y = 220 + i * 69;
      text(labels[i], 48, y, 182, 50, 16, t.blue, true);
      text(point, 245, y, 667, 66, 18, ink, i === 0);
    });
  } else {
    // Lossless fallback for historical PM text; no inferred owners, facts or dates.
    s.points.forEach((point, i) => {
      const y = 222 + i * (276 / Math.max(s.points.length, 1));
      text(
        point,
        48,
        y,
        864,
        276 / Math.max(s.points.length, 1) - 8,
        20,
        ink,
        i === 0,
      );
    });
  }
  footer();
  return { background: dark ? t.navy : t.white, elements, issues };
}
