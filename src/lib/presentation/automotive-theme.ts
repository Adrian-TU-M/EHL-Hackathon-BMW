import type { Audience, Presentation, SlideSpec } from "./contracts";
import type { SlideElement, SlideLayout, TableElement } from "./layout";
import { money, tablePrimitives, wrapText, semanticRole } from "./layout";

export const BMW_AUTOMOTIVE_THEME = {
  id: "bmw-executive-v2",
  width: 960,
  height: 540,
  margin: 48,
  white: "FFFFFF",
  navy: "091321",
  ink: "14212F",
  blue: "1C69D4",
  cyan: "00ACEC",
  muted: "596A7C",
} as const;

/** All coordinates and line breaks are shared by SVG, PDF and editable PPTX. */
export function layoutAutomotiveSlide(
  p: Presentation,
  s: SlideSpec,
  index: number,
  audience: Audience,
  options: { cinematic?: boolean } = {},
): SlideLayout {
  const t = BMW_AUTOMOTIVE_THEME;
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
  const table = (
    rows: string[][],
    widths: number[],
    y = options.cinematic ? 226 : 212,
    h = options.cinematic ? 272 : 286,
  ) => {
    const item: TableElement = {
      kind: "table",
      x: 48,
      y,
      w: 864,
      h,
      rows,
      columnWidths: widths,
      fontSize: 18,
      headerColor: t.navy,
      ...(options.cinematic ? { headerHeight: 36 } : {}),
      ...(role === "alternatives"
        ? {
            columnFills: [t.navy, t.cyan, t.navy],
            columnTextColors: [t.white, t.navy, t.white],
          }
        : {}),
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
  const vehicle = String(p.snapshot.scope.vehicle || "").toLowerCase();
  const hasPhoto = ["f70", "g60", "g70"].includes(vehicle);
  const photo = (x: number, y: number, w: number, h: number) => {
    if (hasPhoto)
      elements.push({
        kind: "image",
        x,
        y,
        w,
        h,
        url: `/images/bmw-${vehicle}.webp`,
        fit: "cover",
        align: role === "cover" ? "right" : "center",
      });
  };
  const logo = (x: number, y: number, size = 42) =>
    elements.push({
      kind: "image",
      x,
      y,
      w: size,
      h: size,
      url: "/images/bmw-logo.svg",
      fit: "contain",
    });
  if (role === "cover") {
    // A full-height automotive image and an opaque title panel retain contrast.
    photo(472, 0, 488, 496);
    rect(0, 496, 960, 44, t.navy);
    logo(48, 37, 52);
    text("BMW NEXT", 122, 39, 276, 28, 18, t.white, true);
    text(department, 48, 116, 352, 40, 12, t.cyan, true);
    text(s.title, 48, 172, hasPhoto ? 400 : 864, 120, 44, ink, true, 2);
    text(s.takeaway, 48, 350, hasPhoto ? 400 : 864, 94, 20, muted);
    text(
      s.points[0] || "",
      48,
      451,
      hasPhoto ? 400 : 864,
      32,
      22,
      t.cyan,
      true,
    );
    // Presenter metadata sits in a solid strip, never on vehicle details.
    text(
      [p.brief.presenter_name, p.brief.presenter_role, p.brief.meeting_date]
        .filter(Boolean)
        .join(" · "),
      472,
      509,
      400,
      18,
      11,
      muted,
    );
    footer();
    return { background: t.navy, elements, issues };
  }
  const photographicHeader =
    !options.cinematic &&
    ["problem", "experience", "pilot"].includes(role) &&
    hasPhoto;
  if (photographicHeader) photo(664, 0, 296, 145);
  if (!dark && !photographicHeader) rect(868, 24, 48, 48, t.navy);
  logo(872, 28, 40);
  text(
    s.section || department,
    48,
    31,
    796,
    20,
    11,
    dark ? t.cyan : t.blue,
    true,
  );
  text(
    s.title,
    48,
    options.cinematic ? 67 : 73,
    photographicHeader ? 584 : 864,
    options.cinematic ? 100 : 82,
    options.cinematic ? 40 : 32,
    ink,
    true,
    2,
  );
  if (!options.cinematic) rect(48, 163, 64, 4, t.cyan);
  text(
    s.takeaway,
    options.cinematic ? 48 : 132,
    options.cinematic ? 175 : 157,
    options.cinematic ? 864 : 780,
    options.cinematic ? 46 : 51,
    18,
    muted,
    false,
    2,
  );
  const items = s.content?.items;
  if (role === "investment") {
    const f = p.brief.financials;
    rect(600, 220, 312, 278, t.navy);
    elements.push({
      kind: "chart",
      color: t.cyan,
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
    text("POTENTIAL PROGRAM", 620, 236, 272, 22, 12, t.cyan, true);
    text(
      money(p.business_case.investment, p.brief.currency),
      620,
      258,
      272,
      60,
      42,
      t.white,
      true,
    );
    text(
      `Annual operating cost: ${money(f.annual_opex.value, p.brief.currency)}`,
      620,
      334,
      272,
      62,
      20,
      "B8C5D8",
    );
    text(
      p.business_case.missing.length
        ? "Unknown inputs remain. No return forecast is justified."
        : "Benefits count once across the portfolio. Validate the assumptions before commitment.",
      620,
      412,
      272,
      81,
      18,
      "B8C5D8",
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
      rect(628, 220, 284, 258, "F0F4F8");
      elements.push({
        kind: "chart",
        color: t.cyan,
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
    photo(608, 220, 304, 145);
    text(
      audience === "engineering" || audience === "sales"
        ? "COMMITMENT REQUESTED"
        : "INITIAL FUNDING REQUEST",
      48,
      226,
      520,
      22,
      12,
      t.cyan,
      true,
    );
    text(
      audience === "engineering"
        ? "Confirm the pilot scope"
        : audience === "sales"
          ? "Agree the launch evidence"
          : money(p.business_case.initial_ask, p.brief.currency),
      48,
      254,
      520,
      112,
      44,
      ink,
      true,
    );
    if (audience === "engineering" || audience === "sales")
      text(s.points[0] || "", 48, 374, 864, 24, 18, muted);
    s.points.slice(1).forEach((point, i, all) => {
      const w = 864 / all.length,
        x = 48 + i * w;
      rect(x, 402, w - 24, 2, t.cyan);
      text(point, x, 416, w - 24, 86, 18, muted);
    });
  } else if (s.content?.kind === "evidence" && items) {
    rect(48, 220, 548, 248, t.navy);
    text("CUSTOMER VOICE", 70, 235, 500, 22, 11, t.cyan, true);
    items.forEach((item, i) => {
      text(`“${item.detail}”`, 70, 269 + i * 96, 502, 91, 20, t.white, i === 0);
    });
    const limits = [
      ...new Set(
        items.map(
          (v) => v.condition || "Evidence limits remain to be established",
        ),
      ),
    ];
    if (limits.length === 1) photo(624, 220, 288, 128);
    text(
      "WHAT THIS DOES NOT PROVE",
      624,
      limits.length === 1 ? 354 : 235,
      288,
      18,
      11,
      t.blue,
      true,
    );
    limits.forEach((limit, i) =>
      text(
        limit,
        624,
        limits.length === 1 ? 380 : 269 + (i * 198) / limits.length,
        288,
        limits.length === 1 ? 106 : 198 / limits.length - 4,
        18,
        t.muted,
      ),
    );
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
      text(`Owner: ${item.owner || "To confirm"}`, x, 487, w, 23, 18, muted);
    });
  } else if (s.content?.kind === "journey" && items) {
    // Editable experience sequence: native text and rules rather than a screenshot.
    const step = 864 / items.length;
    items.forEach((item, i) => {
      const x = 48 + i * step,
        w = step - 22;
      text(String(i + 1).padStart(2, "0"), x, 225, w, 53, 36, t.blue, true);
      rect(x, 290, step - 8, 3, t.cyan);
      text(item.label, x, 310, w, 60, 22, ink, true);
      text(item.detail, x, 384, w, 115, 18, muted);
    });
  } else if (items) {
    const portfolio = s.content?.kind === "portfolio";
    if (portfolio) {
      rect(48, 220, 88, 278, t.navy);
      elements.push({
        kind: "text",
        x: 75,
        y: 476,
        w: 240,
        h: 40,
        size: 28,
        color: t.white,
        bold: true,
        lines: ["PORTFOLIO"],
        rotation: -90,
      });
    }
    items.forEach((item, i) => {
      const y = 222 + i * (276 / items.length);
      if (!portfolio)
        text(String(i + 1).padStart(2, "0"), 48, y, 64, 55, 36, t.blue, true);
      text(
        item.label || "Customer need",
        portfolio ? 160 : 136,
        y,
        portfolio ? 220 : 244,
        78,
        22,
        ink,
        true,
      );
      text(item.detail, 420, y, 492, 78, 20, muted);
      if (i < items.length - 1) rect(136, y + 82, 776, 1, "D5DFEA");
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
      const y = 214 + i * 69;
      text(labels[i], 48, y, 182, 50, 16, t.blue, true);
      text(point, 245, y, 667, 68, 18, ink, i === 0);
    });
    const refs = p.snapshot.evidence.filter((e) =>
      s.evidence_ids.includes(e.id),
    );
    const sourceLine = `Sources: ${refs.map((e) => `${e.id} · ${e.location}`).join("; ")}`;
    if (refs.length)
      text(
        wrapText(sourceLine, 864, 10).length === 1
          ? sourceLine
          : `${refs.length} frozen sources · Full source locations and passages in speaker notes`,
        48,
        491,
        864,
        16,
        10,
        muted,
      );
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
