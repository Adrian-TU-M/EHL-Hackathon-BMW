import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  FileText,
  SlidersHorizontal,
  Check,
  Search,
  ArrowRight,
  Info,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import {
  Badge,
  Button,
  PageHeader,
  SectionTitle,
  StatusBadge,
  EmptyState,
} from "../components/ui/Primitives";
import { ReviewDialog } from "../components/requirements/ReviewDialog";
import { EvidenceDialog } from "../components/dashboard/EvidenceDialog";
import { RiskImpact } from "../components/charts/RiskImpact";
import {
  criterionLabels,
  ranked,
  scenarios,
  scoreRequirement,
} from "../lib/scoring";
import type { Criterion, Requirement, Weights } from "../lib/types";
import { JudgePanel } from "../components/requirements/JudgePanel";
export default function Decisions() {
  const { requirements, weights, setWeights, evidence } = useAppStore();
  const [draft, setDraft] = useState<Weights>(weights);
  useEffect(() => setDraft(weights), [weights]);
  const [review, setReview] = useState<Requirement | null>(null);
  const [ids, setIds] = useState<string[] | null>(null);
  const [filter, setFilter] = useState("All statuses");
  const [query, setQuery] = useState("");
  const [showWeights, setShowWeights] = useState(false);
  const [compare, setCompare] = useState("innovation");
  const ranking = ranked(requirements, weights);
  const visible = ranking.filter(
    (r) =>
      (filter === "All statuses" || r.status === filter) &&
      `${r.id} ${r.title} ${r.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const selected = scenarios.find(
    (s) => JSON.stringify(s.weights) === JSON.stringify(weights),
  );
  const comparison = scenarios.find((s) => s.id === compare)!;
  const alternate = ranked(requirements, comparison.weights);
  const stable = ranking
    .slice(0, 3)
    .filter((r) => alternate.slice(0, 3).some((a) => a.id === r.id));
  const changed = JSON.stringify(draft) !== JSON.stringify(weights);
  function preset(id: string) {
    const s = scenarios.find((s) => s.id === id)!;
    setWeights(s.weights, `Selected ${s.name}: ${s.assumption}`);
    setDraft(s.weights);
  }
  return (
    <>
      <PageHeader
        eyebrow="YOUR PERSPECTIVE / THE FINAL WORD"
        title="Shape the next generation."
        description="Turn evidence into priorities. Turn priorities into considered decisions."
        action={
          <Button
            variant="secondary"
            onClick={() => setShowWeights(!showWeights)}
          >
            <SlidersHorizontal size={16} /> Scoring preferences
          </Button>
        }
      />
      <JudgePanel />
      <div className="strategy-bar">
        <div>
          <span className="eyebrow">YOUR STRATEGY</span>
          <strong>{selected?.name || "Custom priorities"}</strong>
        </div>
        <div className="segmented">
          {scenarios.map((s) => (
            <button
              key={s.id}
              className={s.id === selected?.id ? "active" : ""}
              onClick={() => preset(s.id)}
            >
              {s.shortName}
            </button>
          ))}
        </div>
      </div>
      {showWeights && (
        <section className="panel panel-padding weights-panel">
          <SectionTitle
            title="Make the trade-offs explicit"
            detail="Priority = weighted mean of known 0–5 ratings × 20. Evidence strength is assessed separately."
          />
          <div className="weight-sliders">
            {(Object.keys(criterionLabels) as Criterion[]).map((c) => (
              <label key={c}>
                <span>
                  {criterionLabels[c]}
                  <strong>{draft[c]}</strong>
                </span>
                <input
                  aria-label={`${criterionLabels[c]} weight`}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={draft[c]}
                  onChange={(e) =>
                    setDraft({ ...draft, [c]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <div className="weight-preview">
            Preview:{" "}
            {ranked(requirements, draft)
              .slice(0, 3)
              .map(
                (r) =>
                  `${r.id} (${scoreRequirement(r, draft).score ?? "Unknown"})`,
              )
              .join(" → ")}
          </div>
          <div className="flex-between">
            <p className="small muted">
              Unknown criterion values stay unknown. Score coverage discloses
              missing assessments.
            </p>
            <Button
              disabled={!changed}
              onClick={() =>
                setWeights(
                  draft,
                  "PM adjusted prioritization weights using the scoring controls.",
                )
              }
            >
              Apply & record weights
            </Button>
          </div>
        </section>
      )}
      <div className="decision-analytics">
        <section className="panel panel-padding">
          <SectionTitle
            title="Value, with a view of risk"
            detail="Qualitative 1–5 assessments · numbers reference the priority list"
            action={<Badge>DEMO</Badge>}
          />
          <RiskImpact requirements={ranking} onSelect={setReview} />
          <p className="chart-note">
            Potential customer impact is an assessment, not measured uplift.
            Click a point or use the requirement list to review.
          </p>
        </section>
        <section className="panel panel-padding scenario-panel">
          <SectionTitle
            title="Would your priorities change?"
            detail="Compare today’s weights with another set of assumptions."
          />
          <div className="scenario-headings">
            <span>{selected?.shortName || "Your weights"}</span>
            <ArrowRight size={15} />
            <select
              aria-label="Compare scenario"
              value={compare}
              onChange={(e) => setCompare(e.target.value)}
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {ranking.slice(0, 3).map((r, i) => {
            const rank = alternate.findIndex((a) => a.id === r.id) + 1;
            return (
              <div className="scenario-rank" key={r.id}>
                <span>0{i + 1}</span>
                <div>
                  <strong>{r.title}</strong>
                  <small>{r.id}</small>
                </div>
                <strong className={rank === i + 1 ? "stable" : "changed"}>
                  {String(rank).padStart(2, "0")}
                  {rank === i + 1 ? (
                    <Check size={13} />
                  ) : (
                    <ArrowUpRight size={13} />
                  )}
                </strong>
              </div>
            );
          })}
          <div className="scenario-assumption">
            <Info size={15} />
            <p>{comparison.assumption}</p>
          </div>
          <span className="stable-note">
            <span /> {stable.length} requirements remain in both top threes.
          </span>
        </section>
      </div>
      <div className="requirements-heading">
        <SectionTitle
          title="Your decision portfolio"
          detail={`${requirements.filter((r) => r.status === "Approved").length} approved · ${requirements.filter((r) => r.status === "Pending review").length} awaiting review`}
        />
        <div className="requirement-filters">
          <div className="search-field">
            <Search size={15} />
            <input
              aria-label="Search requirements"
              placeholder="Find a requirement…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="Requirement status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {[
              "All statuses",
              "Pending review",
              "Approved",
              "Rejected",
              "Challenged",
              "Deferred",
              "Evidence requested",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="requirement-list">
        {visible.map((r) => {
          const score = scoreRequirement(r, weights);
          const activeSources = r.evidenceIds.filter(
            (id) => !evidence.find((e) => e.id === id)?.exclusionReason,
          ).length;
          return (
            <article className="requirement-card" key={r.id}>
              <div className="requirement-order">
                {String(ranking.indexOf(r) + 1).padStart(2, "0")}
              </div>
              <div className="requirement-body">
                <div className="flex-between">
                  <div className="flex">
                    <span className="mono small">{r.id}</span>
                    <span className="muted small">v{r.version}</span>
                    <Badge>{r.topic}</Badge>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <h3>{r.title}</h3>
                <p>{r.description}</p>
                <div className="requirement-metrics">
                  <span>
                    Evidence{" "}
                    <strong>
                      {activeSources === 0 ? "None" : r.evidenceLevel}
                    </strong>
                  </span>
                  <span>
                    Impact <strong>{r.impact}/5</strong>
                  </span>
                  <span>
                    Risk <strong>{r.risk}/5</strong>
                  </span>
                  <span>
                    Rough effort <strong>{r.effort}</strong>
                  </span>
                  <button onClick={() => setIds(r.evidenceIds)}>
                    <FileText size={13} />
                    {activeSources} active sources <ArrowUpRight size={12} />
                  </button>
                </div>
                <details className="requirement-details">
                  <summary>
                    Assumptions, alternatives & scoring rationale
                  </summary>
                  <p>{r.rationale}</p>
                  <div className="criterion-values">
                    {(Object.keys(criterionLabels) as Criterion[]).map((c) => (
                      <span key={c}>
                        {criterionLabels[c]}
                        <strong>
                          {r.criteria[c] ?? "Unknown"}
                          {r.criteria[c] !== null && "/5"}
                        </strong>
                      </span>
                    ))}
                  </div>
                  <p>
                    <strong>Assumptions:</strong> {r.assumptions.join(" ")}
                  </p>
                  <p>
                    <strong>Uncertainty:</strong> {r.uncertainties.join(" ")}
                  </p>
                  <div className="alternative-grid">
                    {r.alternatives.map((a) => (
                      <div key={a.title}>
                        <h4>{a.title}</h4>
                        <p>
                          Value {a.impact}/5 · Risk {a.risk}/5 · {a.effort}{" "}
                          effort
                        </p>
                        <small>{a.uncertainty}</small>
                      </div>
                    ))}
                  </div>
                  {r.decisionRationale && (
                    <p>
                      <strong>PM rationale:</strong> {r.decisionRationale}
                    </p>
                  )}
                </details>
              </div>
              <div className="requirement-score">
                <strong>{score.score ?? "—"}</strong>
                <span>PRIORITY / 100</span>
                <small>{score.coverage}% rubric coverage</small>
                <Button variant="secondary" onClick={() => setReview(r)}>
                  {r.status === "Pending review" ? "Review" : "Revisit"}
                  <ArrowUpRight size={15} />
                </Button>
              </div>
            </article>
          );
        })}
        {!visible.length && (
          <EmptyState
            title="No matching requirements"
            detail="Adjust the search or status filter to see more of your portfolio."
          />
        )}
      </div>
      {review && (
        <ReviewDialog requirement={review} onClose={() => setReview(null)} />
      )}{" "}
      {ids && <EvidenceDialog ids={ids} onClose={() => setIds(null)} />}
    </>
  );
}
