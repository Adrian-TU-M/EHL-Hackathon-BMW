import type { Audience, Presentation, SlideSpec } from "./contracts";
import type {
  ImageElement,
  SlideElement,
  SlideLayout,
  TableElement,
} from "./layout";
import { semanticRole, wrapText, tablePrimitives, money } from "./layout";
import { layoutAutomotiveSlide } from "./automotive-theme";

const navy = "091321",
  white = "FFFFFF",
  cyan = "00ACEC",
  muted = "AFBDCA";
const names: Record<Audience, string> = {
  executive: "EXECUTIVE LEADERSHIP",
  finance: "FINANCE",
  engineering: "ENGINEERING",
  sales: "SALES & MARKETING",
};

// These bounds include the bumpers, roof and tyres, plus space around the vehicle.
// A narrow image panel may leave navy space above/below instead of losing the car.
const vehicleFraming: Record<string, NonNullable<ImageElement["framing"]>> = {
  g60: {
    aspectRatio: 1920 / 840,
    subject: { x: 0.265, y: 0.22, w: 0.59, h: 0.68 },
  },
  f70: {
    aspectRatio: 1920 / 840,
    subject: { x: 0.285, y: 0.2, w: 0.65, h: 0.66 },
  },
  g70: {
    aspectRatio: 1606 / 700,
    subject: { x: 0.45, y: 0.23, w: 0.52, h: 0.49 },
  },
};

/** Original cinematic art direction; content, sources and financial data remain frozen. */
export function layoutCinematicSlide(
  p: Presentation,
  s: SlideSpec,
  index: number,
  audience: Audience,
): SlideLayout {
  const role = semanticRole(s),
    vehicle = String(p.snapshot.scope.vehicle || "").toLowerCase();
  const scoped = ["g60", "f70", "g70"].includes(vehicle);
  const elements: SlideElement[] = [],
    issues: string[] = [];
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    opacity = 1,
  ) => elements.push({ kind: "rect", x, y, w, h, color, opacity });
  const photo = (x: number, y: number, w: number, h: number) => {
    if (scoped)
      elements.push({
        kind: "image",
        x,
        y,
        w,
        h,
        url: `/images/bmw-${vehicle}.webp`,
        fit: "cover",
        framing: vehicleFraming[vehicle],
      });
  };
  const text = (
    value: string,
    x: number,
    y: number,
    w: number,
    h: number,
    size = 20,
    color = white,
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
  const logo = (x = 48, y = 32) =>
    elements.push({
      kind: "image",
      x,
      y,
      w: 48,
      h: 48,
      url: "/images/bmw-logo.svg",
      fit: "contain",
    });
  const footer = (x = 48) => {
    text(
      [
        s.synthetic ? "SYNTHETIC DEMO" : "",
        p.finalized_revision !== p.revision || p.stale ? "DRAFT" : "",
      ]
        .filter(Boolean)
        .join(" / "),
      x,
      513,
      700,
      16,
      10,
      muted,
    );
    text(String(index + 1).padStart(2, "0"), 880, 510, 32, 20, 12, muted);
  };
  const header = (x = 48, w = 864) => {
    text(s.section || names[audience], x, 29, w, 20, 11, cyan, true);
    text(s.title, x, 67, w, 100, 40, white, true, 2);
    text(s.takeaway, x, 169, w, 46, 18, muted, false, 2);
  };
  const rail = (word: string) => {
    rect(0, 0, 126, 540, "060C14");
    logo(39, 32);
    elements.push({
      kind: "text",
      x: 35,
      y: 475,
      w: 400,
      h: 60,
      size: 48,
      color: white,
      bold: true,
      lines: [word],
      rotation: -90,
    });
  };
  const table = (
    rows: string[][],
    widths: number[],
    x: number,
    w: number,
    y = 226,
    h = 272,
    contrast = false,
  ) => {
    const e: TableElement = {
      kind: "table",
      x,
      y,
      w,
      h,
      rows,
      columnWidths: widths,
      fontSize: 18,
      headerHeight: 36,
      headerColor: "172839",
      columnFills: contrast
        ? ["101D2B", cyan, "101D2B"]
        : rows[0].map(() => "101D2B"),
      columnTextColors: contrast
        ? [white, navy, white]
        : rows[0].map(() => white),
    };
    for (const c of tablePrimitives(e))
      if (c.kind === "text" && c.lines.length * c.size * 1.24 > c.h)
        issues.push(
          `Slide ${index + 1}: shorten table cell “${c.lines.join(" ").slice(0, 38)}”.`,
        );
    elements.push(e);
  };
  if (role === "cover") {
    // Keep the photo beside the copy, so the title panel cannot hide the bodywork.
    photo(472, 0, 488, 496);
    rect(472, 0, 488, 496, navy, 0.12);
    logo();
    text("BMW NEXT", 120, 42, 304, 25, 18, white, true);
    text(names[audience], 48, 116, 376, 32, 12, cyan, true);
    text(s.title, 48, 172, 400, 120, 44, white, true, 2);
    text(s.takeaway, 48, 337, 376, 100, 22, muted);
    text(s.points[0] || "", 48, 454, 400, 29, 22, cyan, true);
    rect(0, 496, 960, 44, navy, 0.98);
    text(
      [p.brief.presenter_name, p.brief.presenter_role, p.brief.meeting_date]
        .filter(Boolean)
        .join(" · "),
      472,
      511,
      400,
      18,
      11,
      muted,
    );
    footer();
    return { background: navy, elements, issues };
  }
  if (role === "evidence" && s.content?.kind === "evidence") {
    photo(126, 0, 834, 540);
    rect(126, 0, 834, 540, navy, 0.82);
    rail("EVIDENCE");
    header(166, 746);
    s.content.items.forEach((item, i) => {
      text(
        String(i + 1).padStart(2, "0"),
        166,
        229 + i * 124,
        42,
        29,
        18,
        cyan,
        true,
      );
      text(
        `“${item.detail}”`,
        224,
        226 + i * 124,
        416,
        120,
        22,
        white,
        i === 0,
      );
    });
    const limits = [
      ...new Set(
        s.content.items.map(
          (i) => i.condition || "Evidence limits remain to be established",
        ),
      ),
    ];
    text("LIMITS OF THE EVIDENCE", 680, 229, 232, 42, 12, cyan, true);
    limits.forEach((v, i) =>
      text(
        v,
        680,
        284 + (i * 200) / limits.length,
        232,
        200 / limits.length - 8,
        18,
        muted,
      ),
    );
    text(
      `Sources: ${s.content.items
        .map((i) => i.source_id)
        .filter(Boolean)
        .join(", ")}`,
      166,
      486,
      746,
      20,
      10,
      muted,
    );
    footer(166);
    return { background: navy, elements, issues };
  }
  if (role === "alternatives" && s.content?.kind === "comparison") {
    photo(126, 0, 834, 540);
    rect(126, 0, 834, 540, navy, 0.88);
    rail("CHOICES");
    header(166, 746);
    table(
      [
        ["Option", "Approach", "Tradeoff"],
        ...s.content.items.map((i) => [
          i.label,
          i.detail,
          i.condition || "To assess",
        ]),
      ],
      [0.25, 0.4, 0.35],
      166,
      746,
      226,
      272,
      true,
    );
    footer(166);
    return { background: navy, elements, issues };
  }
  if (role === "investment") {
    rail("INVESTMENT");
    header(166, 746);
    const f = p.brief.financials;
    if ([f.pilot, f.development, f.rollout].every((v) => v.value !== null))
      elements.push({
        kind: "chart",
        x: 166,
        y: 244,
        w: 450,
        h: 246,
        labels: ["Pilot", "Development", "Rollout"],
        values: [f.pilot.value!, f.development.value!, f.rollout.value!].map(
          (v) => v / 1e6,
        ),
        caption: `Staged capital (${p.brief.currency} millions)`,
        color: cyan,
        ink: white,
        background: navy,
      });
    else
      text("Spending not yet estimated", 166, 270, 450, 110, 32, white, true);
    rect(649, 230, 1, 263, "304052");
    text("POTENTIAL PROGRAM", 680, 237, 232, 30, 12, cyan, true);
    text(
      money(p.business_case.investment, p.brief.currency),
      680,
      276,
      232,
      78,
      p.business_case.investment === null
        ? 32
        : money(p.business_case.investment, p.brief.currency).length > 6
          ? 40
          : 60,
      white,
      true,
    );
    text(
      `Annual operating cost: ${money(f.annual_opex.value, p.brief.currency)}`,
      680,
      355,
      232,
      65,
      18,
      muted,
    );
    text(
      p.business_case.missing.length
        ? "Unknown inputs remain. No return forecast is justified."
        : "Count benefits once. Validate inputs before funding.",
      680,
      425,
      232,
      76,
      18,
      muted,
    );
    footer(166);
    return { background: navy, elements, issues };
  }
  if (role === "decision" || s.layout === "closing") {
    photo(0, 0, 960, 540);
    rect(0, 0, 960, 540, navy, 0.82);
    header();
    text(
      audience === "engineering" || audience === "sales"
        ? "COMMITMENT REQUESTED"
        : "INITIAL FUNDING REQUEST",
      48,
      239,
      464,
      30,
      12,
      cyan,
      true,
    );
    const ask =
      audience === "engineering"
        ? "Confirm the pilot scope"
        : audience === "sales"
          ? "Agree the launch evidence"
          : money(p.business_case.initial_ask, p.brief.currency);
    text(
      ask,
      48,
      284,
      464,
      127,
      audience === "engineering" || audience === "sales" ? 44 : 64,
      white,
      true,
    );
    if (audience === "engineering" || audience === "sales")
      text(s.points[0] || "", 48, 440, 464, 58, 18, muted);
    s.points.slice(1).forEach((point, i, all) => {
      const y = 239 + (i * 252) / all.length;
      text(String(i + 1).padStart(2, "0"), 560, y, 44, 33, 22, cyan, true);
      text(point, 620, y, 292, 252 / all.length - 8, 18, white);
    });
    footer();
    return { background: navy, elements, issues };
  }
  if (role === "problem" && s.content?.kind === "problem") {
    photo(0, 0, 960, 540);
    rect(0, 0, 960, 540, navy, 0.9);
    header();
    const step = 864 / s.content.items.length;
    s.content.items.forEach((i, n) => {
      const x = 48 + n * step,
        w = step - 28;
      text(String(n + 1).padStart(2, "0"), x, 230, w, 63, 48, cyan, true);
      text(i.label, x, 309, w, 84, 22, white, true);
      text(i.detail, x, 403, w, 99, 18, muted);
    });
    footer();
    return { background: navy, elements, issues };
  }
  // The remaining structured layouts retain the same geometry and editable fields.
  const base = layoutAutomotiveSlide(p, s, index, audience, {
    cinematic: role !== "appendix",
  });
  const mapped = base.elements
    .filter((e) => e.kind !== "image")
    .map((e): SlideElement => {
      if (e.kind === "text")
        return {
          ...e,
          color:
            e.color === "14212F"
              ? white
              : e.color === "596A7C"
                ? muted
                : e.color === "1C69D4"
                  ? cyan
                  : e.color,
        };
      if (e.kind === "rect")
        return {
          ...e,
          color: ["F0F4F8", "FFFFFF"].includes(e.color)
            ? "132335"
            : e.color === "1C69D4"
              ? cyan
              : e.color === "D5DFEA"
                ? "304052"
                : e.color,
        };
      if (e.kind === "chart")
        return { ...e, ink: white, background: navy, color: cyan };
      if (e.kind === "table")
        return {
          ...e,
          headerHeight: 36,
          headerColor: "172839",
          columnFills: e.rows[0].map(() => "101D2B"),
          columnTextColors: e.rows[0].map(() => white),
        };
      return e;
    });
  // Quiet automotive background below strong, native analytical content.
  photo(0, 0, 960, 540);
  rect(0, 0, 960, 540, navy, role === "appendix" ? 0.96 : 0.82);
  elements.push(...mapped);
  // Recheck the changed table header/body allocation rather than keeping old fit results.
  for (const e of mapped)
    if (e.kind === "table")
      for (const c of tablePrimitives(e))
        if (c.kind === "text" && c.lines.length * c.size * 1.24 > c.h)
          issues.push(
            `Slide ${index + 1}: shorten table cell “${c.lines.join(" ").slice(0, 38)}”.`,
          );
  return { background: navy, elements, issues: [...base.issues, ...issues] };
}
