import { presentationApi } from "./api";
import type { Audience, Presentation } from "./contracts";
import {
  chartPrimitives,
  framedImagePlacement,
  layoutSlide,
  tablePrimitives,
  wrapText,
} from "./layout";
import type { ImageElement } from "./layout";

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function imageKey(e: ImageElement) {
  return `${e.url}:${e.fit || "contain"}:${e.align || "center"}:${e.w}:${e.h}:${JSON.stringify(e.framing)}`;
}

async function imageData(e: ImageElement) {
  const response = await fetch(e.url);
  if (!response.ok) throw new Error("The vehicle image could not be loaded");
  const blob = await response.blob();
  const imageUrl = URL.createObjectURL(blob);
  const bitmap = new Image();
  bitmap.src = imageUrl;
  try {
    await bitmap.decode();
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
  const canvas = document.createElement("canvas");
  const width = bitmap.naturalWidth || 256,
    height = bitmap.naturalHeight || 256;
  canvas.width = e.fit === "cover" ? e.w * 2 : width;
  canvas.height = e.fit === "cover" ? e.h * 2 : height;
  const scale =
    e.fit === "cover"
      ? Math.max(canvas.width / width, canvas.height / height)
      : 1;
  const frame = framedImagePlacement(e);
  canvas
    .getContext("2d")!
    .drawImage(
      bitmap,
      frame
        ? frame.x * 2
        : (canvas.width - width * scale) *
            (e.align === "left" ? 0 : e.align === "right" ? 1 : 0.5),
      frame ? frame.y * 2 : (canvas.height - height * scale) / 2,
      frame ? frame.w * 2 : width * scale,
      frame ? frame.h * 2 : height * scale,
    );
  return {
    data: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function exportPresentation(
  input: Presentation,
  audience: Audience,
  format: "pptx" | "pdf" | "json" | "notes",
  options: { reference?: boolean } = {},
) {
  const checked = await presentationApi.check(input);
  const { presentation: p, speaker_notes: notes } =
    await presentationApi.export(checked);
  const originalDeck = p.decks[audience];
  const referenceRoles = [
    "cover",
    "evidence",
    "alternatives",
    "investment",
    "pilot",
    "decision",
  ];
  const deck =
    options.reference && originalDeck
      ? {
          ...originalDeck,
          slides: referenceRoles.flatMap((role) =>
            originalDeck.slides.filter((s) => s.role === role).slice(0, 1),
          ),
        }
      : originalDeck;
  const name = `BMW-NEXT-${audience}${options.reference ? "-reference" : ""}-v${p.revision}${p.finalized_revision !== p.revision || p.stale ? "-draft" : ""}`;
  if (format === "json") {
    saveBlob(
      new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }),
      name + ".json",
    );
    return;
  }
  if (!deck?.complete)
    throw new Error("Finish generating this audience deck before exporting.");
  if (format === "notes") {
    saveBlob(
      new Blob(
        [
          deck.slides
            .map(
              (s, i) => `${i + 1}. ${s.title}\n\n${notes[audience][s.id]}\n\n`,
            )
            .join("\n"),
        ],
        { type: "text/plain;charset=utf-8" },
      ),
      name + "-notes.txt",
    );
    return;
  }
  const layouts = deck.slides.map((s, i) => layoutSlide(p, s, i, audience));
  const issues = layouts.flatMap((l) => l.issues);
  if (issues.length) throw new Error(issues[0]);
  const images = new Map<
    string,
    { data: string; width: number; height: number }
  >();
  const imageElements = [
    ...new Map(
      layouts.flatMap((l) =>
        l.elements
          .filter((e): e is ImageElement => e.kind === "image")
          .map((e) => [imageKey(e), e] as const),
      ),
    ).values(),
  ];
  await Promise.all(
    imageElements.map(async (e) => images.set(imageKey(e), await imageData(e))),
  );
  if (format === "pptx") {
    const { default: PptxGenJS } = await import("pptxgenjs");
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "BMW_WIDE", width: 960 / 72, height: 540 / 72 });
    pptx.layout = "BMW_WIDE";
    pptx.author = p.brief.presenter_name || "BMW NEXT";
    pptx.subject = p.snapshot.synthetic
      ? "Synthetic demo investment case"
      : "Customer experience investment case";
    pptx.title = p.brief.title;
    pptx.company = "Unofficial hackathon prototype";
    pptx.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };
    for (const [i, layout] of layouts.entries()) {
      const slide = pptx.addSlide();
      slide.background = { color: layout.background };
      for (const e of layout.elements) {
        const geo = { x: e.x / 72, y: e.y / 72, w: e.w / 72, h: e.h / 72 };
        if (e.kind === "text")
          slide.addText(e.lines.join("\n"), {
            ...geo,
            ...(e.rotation === -90
              ? {
                  x: (e.x + e.h / 2 - e.w / 2) / 72,
                  y: (e.y - e.w / 2 - e.h / 2) / 72,
                  rotate: 270,
                }
              : {}),
            fontFace: "Arial",
            fontSize: e.size,
            color: e.color,
            bold: e.bold,
            margin: 0,
            breakLine: false,
            paraSpaceAfter: 0,
            valign: "top",
            lineSpacingMultiple: 1.03,
          });
        else if (e.kind === "rect")
          slide.addShape(pptx.ShapeType.rect, {
            ...geo,
            fill: {
              color: e.color,
              transparency: (1 - (e.opacity ?? 1)) * 100,
            },
            line: { color: e.color, transparency: 100 },
          });
        else if (e.kind === "image") {
          const img = images.get(imageKey(e))!;
          slide.addImage({
            ...pptxgenImageContain(img.width / img.height, geo),
            data: img.data,
          });
        } else if (e.kind === "chart")
          slide.addChart(
            pptx.ChartType.bar,
            [
              {
                name: e.caption,
                labels: [...e.labels].reverse(),
                values: [...e.values].reverse(),
              },
            ],
            {
              ...geo,
              catAxisLabelFontFace: "Arial",
              catAxisLabelFontSize: 18,
              valAxisLabelFontFace: "Arial",
              valAxisLabelFontSize: 12,
              chartColors: [e.color || "1C69D4"],
              invertedColors: ["A14A32"],
              showLegend: false,
              showValue: true,
              showTitle: true,
              title: e.caption,
              titleFontFace: "Arial",
              titleFontSize: 12,
              dataLabelFormatCode: "0.00",
              dataLabelPosition: "outEnd",
              dataLabelColor: e.ink || "14212F",
              dataLabelFontFace: "Arial",
              dataLabelFontSize: 18,
              catAxisLineShow: false,
              catAxisLabelPos: "low",
              valAxisLineShow: false,
              barDir: "bar",
              catAxisLabelColor: e.ink || "14212F",
              valAxisLabelColor: e.ink || "14212F",
              titleColor: e.ink || "14212F",
              ...(e.background
                ? {
                    chartArea: { fill: { color: e.background } },
                    plotArea: { fill: { color: e.background } },
                  }
                : {}),
              valGridLine: {
                color: e.background ? "2B3B4D" : "E5EBF1",
                size: 0.5,
              },
            },
          );
        else
          slide.addTable(
            e.rows.map((row, i) =>
              row.map((text, col) => ({
                text: wrapText(
                  text,
                  e.w *
                    (e.columnWidths?.[col] ||
                      (row.length === 2 ? [0.62, 0.38][col] : 1 / row.length)) -
                    20,
                  e.fontSize || 18,
                  i === 0,
                ).join("\n"),
                options: {
                  bold: i === 0,
                  fill: {
                    color:
                      i === 0
                        ? e.headerColor || "14212F"
                        : e.columnFills?.[col] || (i % 2 ? "F0F4F8" : "FFFFFF"),
                  },
                  color:
                    i === 0 ? "FFFFFF" : e.columnTextColors?.[col] || "14212F",
                },
              })),
            ),
            {
              ...geo,
              fontFace: "Arial",
              fontSize: e.fontSize || 18,
              color: "14212F",
              border: { type: "solid", color: "E5EBF1", pt: 0.5 },
              margin: 6,
              rowH: e.headerHeight
                ? e.rows.map(
                    (_, i) =>
                      (i === 0
                        ? e.headerHeight!
                        : (e.h - e.headerHeight!) / (e.rows.length - 1)) / 72,
                  )
                : e.h / e.rows.length / 72,
              colW: (
                e.columnWidths ||
                (e.rows[0].length === 2
                  ? [0.62, 0.38]
                  : e.rows[0].map(() => 1 / e.rows[0].length))
              ).map((w) => (e.w * w) / 72),
              autoPage: false,
              bold: false,
            },
          );
      }
      slide.addNotes(notes[audience][deck.slides[i].id]);
    }
    await pptx.writeFile({ fileName: name + ".pptx", compression: true });
  } else {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "pt",
      format: [960, 540],
      compress: true,
    });
    pdf.setProperties({
      title: p.brief.title,
      subject: p.snapshot.synthetic
        ? "Synthetic demo investment case"
        : "Investment case",
      author: p.brief.presenter_name || "BMW NEXT",
    });
    for (const [i, layout] of layouts.entries()) {
      if (i) pdf.addPage([960, 540], "landscape");
      pdf.setFillColor("#" + layout.background);
      pdf.rect(0, 0, 960, 540, "F");
      for (const element of layout.elements) {
        const expanded =
          element.kind === "chart"
            ? chartPrimitives(element)
            : element.kind === "table"
              ? tablePrimitives(element)
              : [element];
        for (const e of expanded) {
          if (e.kind === "rect") {
            pdf.setFillColor("#" + e.color);
            if (e.opacity !== undefined)
              pdf.setGState(pdf.GState({ opacity: e.opacity }));
            pdf.rect(e.x, e.y, e.w, e.h, "F");
            if (e.opacity !== undefined)
              pdf.setGState(pdf.GState({ opacity: 1 }));
          } else if (e.kind === "text") {
            pdf.setFont("helvetica", e.bold ? "bold" : "normal");
            pdf.setFontSize(e.size);
            pdf.setTextColor("#" + e.color);
            pdf.text(
              e.lines,
              e.rotation === -90 ? e.x + e.size : e.x,
              e.rotation === -90 ? e.y : e.y + e.size,
              { lineHeightFactor: 1.24, angle: e.rotation ? -e.rotation : 0 },
            );
          } else if (e.kind === "image") {
            const data = images.get(imageKey(e))!.data;
            const props = pdf.getImageProperties(data),
              scale = Math.min(e.w / props.width, e.h / props.height);
            const w = props.width * scale,
              h = props.height * scale;
            pdf.addImage(
              data,
              "PNG",
              e.x + (e.w - w) / 2,
              e.y + (e.h - h) / 2,
              w,
              h,
            );
          }
        }
      }
    }
    pdf.save(name + ".pdf");
  }
}

// Use actual image dimensions, including square logos and pre-cropped cover photos.
function pptxgenImageContain(
  aspect: number,
  geo: { x: number; y: number; w: number; h: number },
) {
  const h = Math.min(geo.h, geo.w / aspect),
    w = h * aspect;
  return { x: geo.x + (geo.w - w) / 2, y: geo.y + (geo.h - h) / 2, w, h };
}
