import { useEffect, useState } from "react";
import { useModeratorStore } from "../../store/useModeratorStore";
import { moderatorApi } from "../../lib/council/api";
import type {
  AssumptionRecord,
  SourceEvidence,
  TopicOutcome,
} from "../../lib/council/contracts";
import { Badge, Button, Modal } from "../ui/Primitives";
import "../../styles/moderator.css";
import { JudgeAudio } from "./JudgeAudio";

export function SourceCards({
  ids,
  onClose,
}: {
  ids: string[];
  onClose: () => void;
}) {
  const snapshot = useModeratorStore((s) => s.session?.agenda.source_snapshot);
  const [page, setPage] = useState(0),
    [sources, setSources] = useState<SourceEvidence[]>([]),
    [error, setError] = useState("");
  const unique = [...new Set(ids)],
    key = unique.slice(page * 10, page * 10 + 10).join("|");
  useEffect(() => {
    let disposed = false;
    setSources([]);
    setError("");
    Promise.all(
      key
        .split("|")
        .filter(Boolean)
        .map((id) => moderatorApi.evidence(id, snapshot)),
    )
      .then((s) => {
        if (!disposed) setSources(s);
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
    };
  }, [key, snapshot]);
  return (
    <Modal
      title={`Supplied evidence (${unique.length})`}
      wide
      onClose={onClose}
    >
      {error && <p role="alert">{error}</p>}
      {sources.length === 0 && !error && <p>Loading source passages…</p>}
      {sources.map((e) => (
        <article key={e.id} className="moderator-record">
          <strong>
            {e.source_id} · {e.location}
          </strong>
          <p>
            {e.id} · {e.kind} · {e.vehicle || "Corporate context"} ·{" "}
            {e.country || e.region || "Global"} ·{" "}
            {e.powertrain || "Powertrain unspecified"} ·{" "}
            {e.period || e.published_at || "Date unknown"}
          </p>
          <pre>{e.passage}</pre>
          <p>{e.limitations.join(" ")}</p>
          {e.quantitative && (
            <pre>{JSON.stringify(e.quantitative, null, 2)}</pre>
          )}
          {e.kind === "equipment" && (
            <Badge>
              Equipment row {e.equipment_verified ? "verified" : "unverified"}
            </Badge>
          )}
        </article>
      ))}
      <div className="moderator-actions">
        <Button
          variant="secondary"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous sources
        </Button>
        <span>
          Page {page + 1} / {Math.max(1, Math.ceil(unique.length / 10))}
        </span>
        <Button
          variant="secondary"
          disabled={(page + 1) * 10 >= unique.length}
          onClick={() => setPage(page + 1)}
        >
          Next sources
        </Button>
      </div>
    </Modal>
  );
}

export function ModeratorReview() {
  const { session: s, accept, setError } = useModeratorStore();
  const [review, setReview] = useState<TopicOutcome | null>(null),
    [assumption, setAssumption] = useState<AssumptionRecord | null>(null),
    [status, setStatus] = useState("Deferred"),
    [rationale, setRationale] = useState(""),
    [statement, setStatement] = useState("");
  const [ids, setIds] = useState<string[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setLocalError] = useState("");
  if (!s || (!s.outcomes.length && !s.assumptions.length)) return null;
  return (
    <section className="moderator-section">
      <h2>Moderator outcomes · human review</h2>
      <p>
        Closure records evidence coverage, not agreement. Reviewing an outcome
        does not approve a separately versioned requirement proposal.
      </p>
      {s.outcomes.map((o) => (
        <article className="moderator-record" key={o.topic_id}>
          <div className="flex-between">
            <h3>{o.packet.brief.question}</h3>
            <Badge>{o.closure_reason.replaceAll("_", " ")}</Badge>
          </div>
          <p>
            Version {o.version} · {o.review_status}
            {!o.assessment_valid &&
              " · assessment invalidated by assumption change"}
          </p>
          <p>
            {o.assessment?.summary ||
              "No completed judge assessment. Evidence is incomplete."}
          </p>
          {o.assessment?.native_assessment?.features.map((feature) => (
            <div className="moderator-judge-result" key={feature.feature_id}>
              <Badge>
                Judge: {feature.recommendation.replaceAll("_", " ")}
              </Badge>
              <p>
                Evidence: {feature.evidence_strength} · Priority{" "}
                {feature.priority ?? "unknown"}/100 · Known-weight coverage{" "}
                {feature.coverage}%
              </p>
              <small>
                Priority is the Judge's weighted rubric score, not a success
                probability.
              </small>
              <details>
                <summary>Why the Judge reached this assessment</summary>
                {Object.entries(feature.criteria).map(([criterion, rating]) => (
                  <p key={criterion}>
                    <strong>
                      {criterion}: {rating.value ?? "unknown"}
                      {rating.value !== null ? "/5" : ""}
                    </strong>{" "}
                    — {rating.rationale}
                  </p>
                ))}
                {feature.risks.map((risk, index) => (
                  <p key={index}>Risk: {risk}</p>
                ))}
                {feature.alternatives.map((alternative, index) => (
                  <p key={index}>Alternative: {alternative}</p>
                ))}
              </details>
            </div>
          ))}
          {o.assessment_valid && o.assessment?.native_assessment && (
            <JudgeAudio
              endpoint={`/api/moderator/sessions/${encodeURIComponent(s.id)}/outcomes/${encodeURIComponent(o.topic_id)}/voice`}
              assessmentId={o.assessment.native_assessment.id}
            />
          )}
          <details>
            <summary>Claims, alternatives and disagreement record</summary>
            {o.packet.positions.map((p) => (
              <p key={p.actor}>
                <strong>{p.actor}: </strong>
                {p.summary}{" "}
                {p.abstention_reason && `Abstention: ${p.abstention_reason}`}
              </p>
            ))}
            {o.packet.claims.map((c) => (
              <article className="moderator-record" key={c.id}>
                <Badge>
                  {c.kind} · {c.validation}
                </Badge>
                <p>{c.statement}</p>
                <small>
                  {c.id} · semantic check {c.semantic_check}
                </small>
                <p>{c.issues.join("; ")}</p>
                <button
                  className="text-link"
                  onClick={() => setIds(c.evidence_ids)}
                >
                  Inspect claim sources
                </button>
              </article>
            ))}
            {o.packet.challenges.map((c) => (
              <article className="moderator-record" key={c.id}>
                <strong>
                  {c.actor} → {c.target_actor} · {c.kind} · {c.status}
                </strong>
                <p>{c.question}</p>
                <p>Consequence: {c.consequence}</p>
                <p>{c.response || "No rebuttal"}</p>
              </article>
            ))}
            {o.packet.alternatives.map((a) => (
              <p key={a.id}>
                <strong>{a.title}</strong> — {a.description} Preservation
                trade-off: {a.tradeoff}
              </p>
            ))}
            {o.packet.unresolved_issues.map((i, n) => (
              <p key={n}>Open: {i}</p>
            ))}
            <details>
              <summary>Scoring inputs and judge proposals</summary>
              <pre>
                {JSON.stringify(
                  {
                    inputs: o.assessment?.scoring_inputs,
                    proposals: o.assessment?.proposals,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
            <details>
              <summary>Source inventory and coverage limitations</summary>
              {o.packet.source_inventory.map((source) => (
                <p key={source.id}>
                  <strong>{source.name}</strong>
                  <br />
                  {source.sha256}
                  <br />
                  {JSON.stringify(source.coverage)}
                  <br />
                  {source.limitations.join(" ")}
                </p>
              ))}
              <p>{o.packet.coverage_limitations.join(" ")}</p>
            </details>
          </details>
          {o.decisions.map((d, n) => (
            <p key={n}>
              PM {d.status} of v{d.version}: {d.rationale}
            </p>
          ))}
          <Button
            variant="secondary"
            onClick={() => {
              setReview(o);
              setRationale("");
              setLocalError("");
              setStatus("Deferred");
            }}
          >
            Review outcome v{o.version}
          </Button>
        </article>
      ))}
      <h3>Shared assumptions</h3>
      {!s.assumptions.length && (
        <p>
          No assumptions proposed. Missing data and methodological limitations
          remain unknowns.
        </p>
      )}
      {s.assumptions.map((a) => (
        <article className="moderator-record" key={a.id}>
          <strong>
            {a.id} · v{a.version} · {a.status}
          </strong>
          <p>{a.statement}</p>
          <p>{a.rationale}</p>
          <p>Validation needed: {a.validation_needed}</p>
          <p>
            {a.material ? "Material" : "Non-material"} · {a.scope.vehicle} /{" "}
            {a.scope.market}
          </p>
          <button
            className="text-link"
            onClick={() => {
              setAssumption(a);
              setStatement(a.statement);
              setStatus(a.status);
              setRationale("");
              setLocalError("");
            }}
          >
            Change assumption version
          </button>
        </article>
      ))}
      {!!s.assumption_history.length && (
        <details>
          <summary>Assumption history ({s.assumption_history.length})</summary>
          <pre>{JSON.stringify(s.assumption_history, null, 2)}</pre>
        </details>
      )}
      {ids && <SourceCards ids={ids} onClose={() => setIds(null)} />}
      {(review || assumption) && (
        <Modal
          title={
            review
              ? `Human review · v${review.version}`
              : `Assumption change · v${assumption!.version}`
          }
          onClose={() => {
            setReview(null);
            setAssumption(null);
          }}
        >
          {error && <p role="alert">{error}</p>}
          {assumption && (
            <>
              <label className="field-label" htmlFor="assumption-statement">
                Conditional assumption
              </label>
              <textarea
                id="assumption-statement"
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
              />
              <p>
                Changing this version invalidates only dependent assessments.
                Scenario acceptance does not make it true.
              </p>
            </>
          )}
          <label className="field-label" htmlFor="moderator-review-status">
            Status
          </label>
          <select
            id="moderator-review-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {(review
              ? [
                  "Approved",
                  "Rejected",
                  "Deferred",
                  "Evidence requested",
                  "Challenged",
                ]
              : [
                  "proposed",
                  "contested",
                  "accepted_for_scenario",
                  "refuted",
                  "superseded",
                ]
            ).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <label className="field-label" htmlFor="moderator-review-rationale">
            Rationale
          </label>
          <textarea
            id="moderator-review-rationale"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={4}
          />
          <Button
            disabled={
              busy || !rationale.trim() || (!!assumption && !statement.trim())
            }
            onClick={async () => {
              setBusy(true);
              setLocalError("");
              try {
                accept(
                  review
                    ? await moderatorApi.review(
                        s,
                        review.topic_id,
                        review.version,
                        status,
                        rationale,
                      )
                    : await moderatorApi.assumption(
                        s,
                        assumption!.id,
                        assumption!.version,
                        statement,
                        status,
                        rationale,
                      ),
                );
                setReview(null);
                setAssumption(null);
              } catch (e) {
                const message = String(e);
                setLocalError(message);
                setError(message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Record version-specific decision
          </Button>
        </Modal>
      )}
    </section>
  );
}
