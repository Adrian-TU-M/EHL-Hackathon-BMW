import { jsPDF } from "jspdf";
import type { AnalysisSnapshot, Criterion } from "../types";
import {
  criterionLabels,
  ranked,
  scenarios,
  scoreRequirement,
} from "../scoring";
import { vehicleNames } from "../mock-data";
const clean = (s: string) =>
  s
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/→/g, " > ")
    .replace(/·/g, " / ")
    .replace(/…/g, "...");
/** Export one immutable state snapshot. No screenshot-dependent or print-dialog export. */
export function createReport(snapshot: AnalysisSnapshot) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const width = 170;
  let y = 28;
  let section = "PRODUCT INTELLIGENCE REPORT";
  doc.setProperties({
    title: "BMW NEXT - Product Intelligence Report",
    subject: "Synthetic demo - human decision record",
    author: "BMW NEXT / Unofficial hackathon prototype",
    creator: "BMW NEXT",
  });
  function header() {
    doc.setFillColor(28, 105, 212);
    doc.rect(20, 14, 7, 1.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(21, 40, 63);
    doc.text("BMW NEXT", 31, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(124, 143, 166);
    doc.text(section, 190, 16, { align: "right" });
    doc.setDrawColor(225, 232, 241);
    doc.line(20, 21, 190, 21);
  }
  function next(title = section) {
    section = title;
    doc.addPage();
    y = 32;
    header();
  }
  function ensure(height: number) {
    if (y + height > 270) next();
  }
  function text(
    value: string,
    size = 10,
    color: [number, number, number] = [93, 112, 137],
    bold = false,
  ) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(clean(value), width) as string[];
    const lineHeight = size * 0.46;
    for (const line of lines) {
      ensure(lineHeight + 1);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      doc.text(line, 20, y, { baseline: "top" });
      y += lineHeight;
    }
    y += 4;
  }
  function heading(value: string) {
    ensure(25);
    y += 6;
    text(value, 17, [28, 48, 73], true);
    y += 3;
  }
  function label(value: string) {
    ensure(15);
    text(value.toUpperCase(), 7, [28, 105, 212], true);
  }
  function rule() {
    doc.setDrawColor(230, 236, 244);
    doc.line(20, y, 190, y);
    y += 9;
  }
  header();
  y = 45;
  label("AI analyzes. AI challenges. AI explains. Humans decide.");
  y += 5;
  text("The next generation,\ninformed by intelligence.", 31, [17, 35, 57]);
  y += 9;
  text(
    `BMW ${vehicleNames[snapshot.scope.vehicle]} / ${snapshot.scope.vehicle}`,
    19,
    [28, 105, 212],
  );
  text(
    `${snapshot.scope.market} / ${snapshot.scope.powertrain} / ${snapshot.scope.horizon}-year planning horizon`,
    11,
  );
  text(
    `Prepared ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    9,
  );
  y += 7;
  rule();
  heading("Executive overview");
  text(
    snapshot.scope.prompt ||
      "Explore customer priorities for the next vehicle generation with a balanced product strategy.",
  );
  const ordered = ranked(snapshot.requirements, snapshot.weights);
  const approved = ordered.filter((r) => r.status === "Approved");
  text(
    `${ordered.length} provisional requirements; ${approved.length} approved decisions; ${ordered.filter((r) => r.status === "Pending review").length} awaiting review. ${snapshot.evidence.filter((e) => !e.exclusionReason).length} active evidence records.`,
  );
  text(
    `Leading priorities: ${ordered
      .slice(0, 3)
      .map((r) => `${r.id} - ${r.title}`)
      .join("; ")}.`,
    10,
  );
  heading("Read this report in context");
  text(
    "UNOFFICIAL HACKATHON CONCEPT / SYNTHETIC DEMO",
    9,
    [163, 119, 47],
    true,
  );
  text(
    "No supplied BMW dataset or verified competitor research has been analyzed. All source passages, quantitative series, scores, impact and risk assessments are illustrative. Scenarios are preference sensitivity exercises, not sales or ROI forecasts. Human approval is specific to a requirement version.",
  );
  text(
    "The judge assessment is provisional and challengeable. Missing criterion values remain unknown. Browser history is local demo storage, not an immutable production audit database.",
    9,
  );
  next("REQUIREMENT PORTFOLIO");
  heading("Customer-facing requirements");
  text(
    "Priority is a weighted mean of known 0-5 rubric ratings, scaled to 100. Evidence strength is separate. Coverage is the share of active criterion weight supported by an assessment.",
    9,
  );
  for (const r of ordered) {
    ensure(115);
    rule();
    label(`${r.id} / VERSION ${r.version} / ${r.status}`);
    text(r.title, 17, [31, 51, 76], true);
    text(r.description, 11);
    const score = scoreRequirement(r, snapshot.weights);
    text(
      `Priority ${score.score ?? "Unknown"}/100 (${score.coverage}% coverage) | Evidence: ${r.evidenceLevel} | Impact ${r.impact}/5 | Risk ${r.risk}/5 | Rough effort: ${r.effort}`,
      9,
      [28, 105, 212],
    );
    text(
      `Supporting findings: ${r.findingIds.join(", ")}. Sources: ${r.evidenceIds.join(", ")}.`,
      8,
    );
    text(`Prioritization rationale: ${r.rationale}`, 9);
    text(`Assumptions: ${r.assumptions.join(" ")}`, 9);
    text(`Uncertainties: ${r.uncertainties.join(" ")}`, 9);
    text(
      `PM decision: ${r.status}${r.approvedVersion ? ` (approved version ${r.approvedVersion})` : ""}. Rationale: ${r.decisionRationale || "No human decision recorded."}`,
      9,
      [46, 74, 103],
    );
    text(
      `Alternatives: ${r.alternatives.map((a) => `${a.title} [impact ${a.impact}/5; risk ${a.risk}/5; effort ${a.effort}; ${a.uncertainty}]`).join(" / ")}`,
      8,
    );
  }
  next("SCENARIOS & PRIORITIZATION");
  heading("Make the assumptions explicit");
  for (const scenario of scenarios) {
    ensure(42);
    label(scenario.name);
    text(scenario.assumption, 10);
    text(
      ranked(snapshot.requirements, scenario.weights)
        .map(
          (r, i) =>
            `${i + 1}. ${r.id}: ${scoreRequirement(r, scenario.weights).score ?? "Unknown"}`,
        )
        .join(" | "),
      9,
      [36, 91, 160],
    );
    rule();
  }
  heading("Current scoring preferences");
  for (const key of Object.keys(criterionLabels) as Criterion[])
    text(
      `${criterionLabels[key]}: ${snapshot.weights[key]} relative weight`,
      9,
    );
  text(
    "Risk and potential customer impact use qualitative 1-5 judgments. Effort is rough and requires engineering validation. No cost estimate, sales uplift, customer-approval percentage or financial return is implied.",
    9,
  );
  next("EVIDENCE & SOURCE LINEAGE");
  heading("Evidence register");
  text(
    "Each source retains its provenance. Synthetic records are examples, not observed customers. Provided passages were attached by the PM; source authenticity and population denominators still require verification.",
    10,
  );
  for (const e of snapshot.evidence) {
    ensure(61);
    label(`${e.id} / ${e.domain} / ${e.category}`);
    text(e.passage, 10);
    text(
      `Source: ${e.source}. Location: ${e.location}. Date: ${e.publishedAt}. Scope: ${e.vehicle}, ${e.market}, ${e.powertrain}. Provenance: ${e.provenance.toUpperCase()}.${e.sourceUrl ? " URL: " + e.sourceUrl : ""}`,
      8,
    );
    if (e.exclusionReason)
      text(
        `EXCLUDED FROM ACTIVE SUPPORT: ${e.exclusionReason}`,
        9,
        [167, 107, 52],
        true,
      );
    if (e.quantitative)
      text(
        `Calculation: ${e.quantitative.numerator}/${e.quantitative.denominator} ${e.quantitative.unit}. Method: ${e.quantitative.method}. Limitations: ${e.quantitative.limitations}`,
        8,
      );
    rule();
  }
  heading("Findings linked to requirements");
  for (const f of snapshot.findings) {
    ensure(32);
    text(`${f.id} - ${f.title}`, 11, [45, 68, 96], true);
    text(
      `${f.detail} Sources: ${f.evidenceIds.join(", ")}. Limitation: ${f.uncertainty}`,
      9,
    );
  }
  next("COUNCIL & HUMAN PERSPECTIVE");
  heading("Council summary");
  text(
    `Status: ${snapshot.council.status}. Topic: ${snapshot.council.topic}. Run: ${snapshot.council.run}. One challenge round and one clarification maximum.`,
    10,
  );
  if (snapshot.council.challenge)
    text(`PM challenge: ${snapshot.council.challenge}`, 10, [157, 115, 50]);
  if (snapshot.council.cursor < 0)
    text(
      "No council discussion has started. Requirements were initialized as clearly provisional demo proposals.",
    );
  for (const e of snapshot.council.events.slice(
    0,
    snapshot.council.cursor + 1,
  )) {
    ensure(40);
    label(`${e.stage} / ${e.actor}`);
    text(e.statement, 10);
    if (e.evidenceIds.length) text(`Sources: ${e.evidenceIds.join(", ")}`, 8);
    if (e.assumption) text(`Assumption: ${e.assumption}`, 9);
  }
  if (snapshot.judgeCouncil) {
    next("JUDGE ASSESSMENT & PM REVIEW");
    const council = snapshot.judgeCouncil;
    heading("Python Judge council");
    text(`${council.execution.toUpperCase()} backend / ${council.mode} / ${council.status} / round ${council.round}`, 10);
    if (council.checkpoint) text(`Checkpoint: ${council.checkpoint.reason}`);
    const assessment = council.assessment;
    for (const source of council.request.evidence.filter(e => !snapshot.evidence.some(local => local.id === e.id))) {
      label(`${source.id} / ${source.provenance}`);
      text(`${source.source} / ${source.location} / ${source.published_at ?? "Date unknown"}`, 9);
      text(source.passage, 9);
      if (source.source_url) text(source.source_url, 8);
    }
    if (assessment) {
      text(`Assessment ${assessment.id}, ${assessment.created_at}. Priority is not a probability.`, 9);
      for (const feature of assessment.features) {
        heading(`${feature.feature_id} / v${feature.feature_version}: ${feature.recommendation}`);
        text(`Priority ${feature.priority ?? "Unknown"}/100, coverage ${feature.coverage}%, evidence ${feature.evidence_strength}.`);
        text(feature.rationale);
        text(`Benefits: ${feature.benefits.join(" ")}. Drawbacks: ${feature.drawbacks.join(" ")}. Risks: ${feature.risks.join(" ")}.`, 9);
        text(`Assumptions: ${feature.assumptions.join(" ")}. Uncertainties: ${feature.uncertainties.join(" ")}. Alternatives: ${feature.alternatives.join(" ")}.`, 9);
      }
      for (const argument of assessment.arguments) {
        label(argument.argument_id);
        text(`Support ${argument.support ?? "Unknown"}/5, relevance ${argument.relevance ?? "Unknown"}/5, influence ${argument.influence ?? "Unknown"}/5. ${argument.verdict}.`, 9);
        text(argument.explanation, 9);
        for (const citation of argument.citations) text(`${citation.evidence_id}: ${citation.quote}`, 9);
        text(argument.assumptions.concat(argument.issues).join(" "), 9);
      }
    }
    for (const event of council.events) { label(`${event.actor} / ${event.stage}`); text(event.statement, 9); }
  }
  next("CHRONOLOGICAL AUDIT");
  heading("The decision record");
  text(
    "Events are shown oldest first. The transcript does not replace this audit. The local demo can be modified in the browser; production immutability requires backend storage.",
    9,
  );
  for (const event of snapshot.audit) {
    ensure(40);
    label(`${new Date(event.timestamp).toISOString()} / ${event.actor}`);
    text(event.action, 11, [43, 62, 89], true);
    text(event.rationale, 9);
    if (event.requirementId)
      text(
        `Requirement: ${event.requirementId}, version ${event.version ?? "unknown"}. Sources: ${event.evidenceIds.join(", ") || "None"}.`,
        8,
      );
    if (event.before) text(`Before: ${event.before}`, 8);
    if (event.after) text(`After: ${event.after}`, 8);
    rule();
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(225, 232, 241);
    doc.line(20, 279, 190, 279);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(144, 158, 176);
    doc.text("BMW NEXT / SYNTHETIC DEMO / HUMAN REVIEW REQUIRED", 20, 285);
    doc.text(`${i} / ${pages}`, 190, 285, { align: "right" });
  }
  return doc;
}
export async function downloadReport(snapshot: AnalysisSnapshot) {
  createReport(structuredClone(snapshotData(snapshot))).save(
    `BMW-NEXT-${snapshot.scope.vehicle}-${snapshot.scope.market.replace(/\s/g, "-")}-report.pdf`,
  );
}
function snapshotData(s: AnalysisSnapshot): AnalysisSnapshot {
  return {
    scope: s.scope,
    requirements: s.requirements,
    evidence: s.evidence,
    findings: s.findings,
    audit: s.audit,
    weights: s.weights,
    council: s.council,
    judgeCouncil: s.judgeCouncil,
  };
}
