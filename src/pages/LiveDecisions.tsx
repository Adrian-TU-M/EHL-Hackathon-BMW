import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  MessageCircle,
  SlidersHorizontal,
} from "lucide-react";
import { useCouncilSession } from "../components/council/useCouncilSession";
import { JuryConversation } from "../components/council/JuryConversation";
import {
  ProposalReviews,
  SourceCards,
} from "../components/council/ModeratorReview";
import { presentationApi } from "../lib/presentation/api";
import { LiveReviewInbox } from "../components/council/LiveReviewInbox";
import { moderatorApi } from "../lib/council/api";
import { criterionLabels } from "../lib/scoring";
import { Button, Modal } from "../components/ui/Primitives";
import type { TopicOutcome } from "../lib/council/contracts";
import type { Criterion, Weights } from "../lib/types";
import type { FeatureAssessment } from "../lib/api/judge";
import "../styles/vehicle-council.css";

const scenarios: Record<string, Weights | null> = {
  "Jury priorities": null,
  "Customer first": {
    need: 40,
    severity: 30,
    gap: 10,
    future: 10,
    feasibility: 10,
  },
  "Innovation first": {
    need: 20,
    severity: 15,
    gap: 25,
    future: 30,
    feasibility: 10,
  },
};
export function scenarioScore(feature: FeatureAssessment, weights: Weights) {
  const keys = Object.keys(weights) as Criterion[];
  const known = keys.filter((key) => feature.criteria[key]?.value != null);
  const coverage = known.reduce((sum, key) => sum + weights[key], 0);
  return {
    coverage,
    priority: coverage
      ? Math.round(
          (100 *
            known.reduce(
              (sum, key) =>
                sum + (weights[key] * feature.criteria[key].value!) / 5,
              0,
            )) /
            coverage,
        )
      : null,
  };
}

export default function LiveDecisions() {
  const navigate = useNavigate();
  const { session: s, accept, loading, loadError } = useCouncilSession();
  const [scenario, setScenario] = useState("Jury priorities");
  const [statusFilter, setStatusFilter] = useState("All decisions");
  const [review, setReview] = useState<TopicOutcome | null>(null);
  const [discussion, setDiscussion] = useState<TopicOutcome | null>(null);
  const [ids, setIds] = useState<string[] | null>(null);
  const [status, setStatus] = useState("Deferred");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creatingPresentation, setCreatingPresentation] = useState(false);
  const [presentationError, setPresentationError] = useState("");
  const valid =
    s?.outcomes.filter(
      (o) => o.assessment_valid && o.assessment?.native_assessment,
    ) || [];
  const rows = valid
    .flatMap((outcome) =>
      outcome.assessment!.native_assessment!.features.map((feature) => ({
        outcome,
        feature,
        score: scenarios[scenario]
          ? scenarioScore(feature, scenarios[scenario]!)
          : { priority: feature.priority, coverage: feature.coverage },
      })),
    )
    .sort((a, b) => (b.score.priority ?? -1) - (a.score.priority ?? -1));
  const requirementStatus = (outcome: TopicOutcome, featureId: string) => {
    const proposal = outcome.assessment?.proposals.find(
      (p) => p.id === featureId,
    );
    const decision = [...(outcome.proposal_decisions || [])]
      .reverse()
      .find(
        (d) =>
          d.proposal_id === featureId &&
          d.proposal_version === proposal?.version &&
          d.outcome_version === outcome.version,
      );
    return decision?.status || "Pending review";
  };
  const shown = rows.filter(
    (row) =>
      statusFilter === "All decisions" ||
      requirementStatus(row.outcome, row.feature.feature_id) === statusFilter,
  );
  const approvedRequirements = valid.flatMap((outcome) =>
    outcome.closure_reason === "pm_stopped" ||
    outcome.closure_reason === "budget_exhausted" ||
    ["Rejected", "Challenged"].includes(outcome.review_status)
      ? []
      : (outcome.assessment?.proposals || []).filter((proposal) => {
          const decision = [...(outcome.proposal_decisions || [])]
            .reverse()
            .find((d) => d.proposal_id === proposal.id);
          return (
            decision?.status === "Approved" &&
            decision.proposal_version === proposal.version &&
            decision.outcome_version === outcome.version
          );
        }),
  );
  async function save() {
    if (!s || !review || !rationale.trim()) return;
    setBusy(true);
    setError("");
    try {
      accept(
        await moderatorApi.review(
          s,
          review.topic_id,
          review.version,
          status,
          rationale.trim(),
        ),
      );
      setReview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review could not be saved");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="live-decisions vehicle-council">
      <header className="vc-heading">
        <div>
          <span className="eyebrow">BMW NEXT / PM WORKSPACE</span>
          <h1>Decisions & scenarios.</h1>
          <p>
            {s
              ? `${s.agenda.scope.vehicle} · ${s.agenda.scope.market} · ${s.agenda.scope.powertrain}`
              : "The council’s evidence. Your decision."}
          </p>
        </div>
        <Link
          className="vc-link-button"
          to={s ? `/council?session=${s.id}` : "/council"}
        >
          <ArrowLeft size={16} /> Back to council
        </Link>
      </header>
      {loadError && (
        <p className="vc-error" role="alert">
          {loadError}
        </p>
      )}
      {loading ? (
        <p>Loading the saved council…</p>
      ) : !s ? (
        <div className="vc-empty">
          <h2>Start with a car debate.</h2>
          <p>Jury’s actual verdicts will appear here when they are ready.</p>
          <Link className="vc-link-button" to="/council">
            Open council <ArrowRight size={15} />
          </Link>
        </div>
      ) : (
        <>
          <div className="decision-overview">
            <div>
              <strong>{valid.length}</strong>
              <span>Jury verdicts</span>
            </div>
            <div>
              <strong>{approvedRequirements.length}</strong>
              <span>PM approved</span>
            </div>
            <div>
              <strong>
                {
                  rows.filter(
                    (row) =>
                      requirementStatus(row.outcome, row.feature.feature_id) ===
                      "Pending review",
                  ).length
                }
              </strong>
              <span>Awaiting your review</span>
            </div>
            <p>
              {s.status === "running"
                ? `Council continues · ${s.outcomes.length}/${s.agenda.selected_ids.length} topics closed`
                : "Every decision is saved against its assessed version."}
            </p>
          </div>
          <section
            className="panel panel-padding presentation-entry"
            style={{ marginBlock: 24 }}
          >
            <div className="flex-between">
              <div>
                <h3>Present your approved requirements.</h3>
                <p className="small muted">
                  {approvedRequirements.length} current requirement approvals.
                  Review each requirement below before creating a deck.
                </p>
              </div>
              <div className="flex">
                <Button
                  disabled={
                    creatingPresentation || !approvedRequirements.length
                  }
                  onClick={async () => {
                    setCreatingPresentation(true);
                    setPresentationError("");
                    try {
                      const p = await presentationApi.create(
                        "council",
                        "ollama",
                        s.id,
                      );
                      navigate(`/presentations/${p.id}`);
                    } catch (e) {
                      setPresentationError(
                        e instanceof Error ? e.message : String(e),
                      );
                    } finally {
                      setCreatingPresentation(false);
                    }
                  }}
                >
                  {creatingPresentation ? "Preparing…" : "Create presentation"}
                </Button>
                <Link className="text-link" to="/presentations">
                  Open presentation studio ↗
                </Link>
              </div>
            </div>
            {presentationError && <p role="alert">{presentationError}</p>}
          </section>
          <div className="decision-scenarios">
            <label>
              <SlidersHorizontal size={16} /> Compare priorities
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
              >
                {Object.keys(scenarios).map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Show
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {[
                  "All decisions",
                  "Pending review",
                  "Approved",
                  "Rejected",
                  "Deferred",
                  "Evidence requested",
                  "Challenged",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <small>
              {scenario === "Jury priorities"
                ? "Jury’s saved rubric scores · not success probabilities"
                : "What-if ranking using the same assessed criteria. Verdicts and PM decisions stay unchanged."}
            </small>
          </div>
          {s.outcomes.some(
            (o) => !o.assessment_valid || !o.assessment?.native_assessment,
          ) && (
            <p className="vc-error">
              Some closed topics need a valid Jury assessment before PM review.
              Open the council’s audit record for details.
            </p>
          )}
          <div className="decision-results">
            {shown.map(({ outcome, feature, score }, index) => (
              <article
                key={`${outcome.topic_id}:${feature.feature_id}`}
                className="decision-card"
              >
                <div className="decision-rank">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="decision-content">
                  <div className="decision-status">
                    <span>
                      Jury ·{" "}
                      {
                        {
                          recommend: "Proposed for validation",
                          revise: "Refine the concept",
                          defer: "More evidence needed",
                          do_not_recommend: "Not recommended",
                        }[feature.recommendation]
                      }
                    </span>
                    <span>
                      {requirementStatus(outcome, feature.feature_id) ===
                        "Approved" && <Check size={12} />}
                      {requirementStatus(outcome, feature.feature_id)}
                    </span>
                  </div>
                  <h2>
                    {feature.requirement_title ||
                      outcome.assessment?.proposals.find(
                        (p) => p.id === feature.feature_id,
                      )?.title ||
                      s.agenda.topics.find((t) => t.id === outcome.topic_id)
                        ?.label ||
                      outcome.packet.brief.question}
                  </h2>
                  <p>{feature.proposed_description || feature.rationale}</p>
                  <div className="decision-effects">
                    <div>
                      <strong>Potential benefit</strong>
                      <p>
                        {feature.benefits[0] ||
                          "Not established by this evidence."}
                      </p>
                    </div>
                    <div>
                      <strong>Trade-off / uncertainty</strong>
                      <p>
                        {feature.risks[0] ||
                          feature.drawbacks[0] ||
                          feature.uncertainties[0] ||
                          "Further validation required."}
                      </p>
                    </div>
                  </div>
                  <details>
                    <summary>Why Jury reached this verdict</summary>
                    <p>{feature.rationale}</p>
                    {Object.entries(feature.criteria).map(([key, rating]) => (
                      <p key={key}>
                        <strong>
                          {criterionLabels[key as Criterion]}:{" "}
                          {rating.value == null
                            ? "Unknown"
                            : `${rating.value}/5`}
                        </strong>{" "}
                        · {rating.rationale}
                      </p>
                    ))}
                    {feature.alternatives.map((x, i) => (
                      <p key={i}>Alternative: {x}</p>
                    ))}
                    <button
                      className="text-link"
                      onClick={() =>
                        setIds([
                          ...new Set(
                            outcome.assessment!.native_assessment!.arguments.flatMap(
                              (a) => a.citations.map((c) => c.evidence_id),
                            ),
                          ),
                        ])
                      }
                    >
                      Inspect cited evidence ↗
                    </button>
                    {outcome.decisions.map((d, i) => (
                      <p key={i}>
                        PM · {d.status}: {d.rationale}
                      </p>
                    ))}
                  </details>
                  <div className="vc-actions">
                    <Button
                      variant="secondary"
                      onClick={() => setDiscussion(outcome)}
                    >
                      <MessageCircle size={15} /> Discuss with Jury
                    </Button>
                    <details>
                      <summary>More review options</summary>
                      <Button
                        onClick={() => {
                          setReview(outcome);
                          setStatus("Deferred");
                          setRationale("");
                          setError("");
                        }}
                      >
                        Review whole topic <ArrowRight size={15} />
                      </Button>
                    </details>
                  </div>
                  <ProposalReviews
                    compact
                    outcome={outcome}
                    session={s}
                    onAccept={accept}
                  />
                </div>
                <div className="decision-score">
                  <strong>{score.priority ?? "—"}</strong>
                  <span>Priority / 100</span>
                  <small>{score.coverage}% known-weight coverage</small>
                  <small>{feature.evidence_strength} evidence</small>
                </div>
              </article>
            ))}
          </div>
          {!shown.length && (
            <div className="vc-empty">
              <h2>
                {valid.length
                  ? "No decisions match this filter."
                  : "Jury is still reviewing the evidence."}
              </h2>
              <p>
                Completed, valid verdicts appear automatically. You can follow
                the discussion in the council.
              </p>
            </div>
          )}
        </>
      )}
      <details className="vc-proposal-inbox">
        <summary>Individual agent proposals</summary>
        <LiveReviewInbox />
      </details>
      {review && (
        <Modal title="Your decision" onClose={() => !busy && setReview(null)}>
          <p>{review.packet.brief.question}</p>
          <label>
            Decision
            <select
              aria-label="Decision"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {[
                "Approved",
                "Rejected",
                "Deferred",
                "Evidence requested",
                "Challenged",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Rationale
            <textarea
              aria-label="Rationale"
              value={rationale}
              maxLength={4000}
              onChange={(e) => setRationale(e.target.value)}
              rows={4}
              placeholder="Record why you accept, reject or defer this assessed direction."
            />
          </label>
          <p>Applies to version {review.version} of this council outcome.</p>
          {error && (
            <p role="alert" className="vc-error">
              {error}
            </p>
          )}
          <Button disabled={busy || !rationale.trim()} onClick={save}>
            {busy ? "Saving…" : "Save PM decision"}
          </Button>
        </Modal>
      )}
      {discussion && s && (
        <Modal title="Talk to Jury" wide onClose={() => setDiscussion(null)}>
          <JuryConversation
            key={discussion.assessment?.native_assessment?.id}
            sessionId={s.id}
            outcome={discussion}
          />
        </Modal>
      )}
      {ids && <SourceCards ids={ids} onClose={() => setIds(null)} />}
    </div>
  );
}
