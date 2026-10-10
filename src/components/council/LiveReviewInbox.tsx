import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { api } from "../../lib/api/live";
import { Badge, Button } from "../ui/Primitives";
import { LiveJudgeReview, type LiveReview } from "./LiveJudgeReview";

interface ReviewSummary {
  run_id: string;
  source_run_id: string;
  job_id: string;
  lead_agent: string;
  model: string;
  status: string;
  title: string;
  version: number;
  scope: { vehicle: string; market: string; topic: string };
}

export function LiveReviewInbox() {
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void api<{ reviews: ReviewSummary[] }>("/review/inbox", {
      signal: controller.signal,
    })
      .then((result) => setReviews(result.reviews))
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [refresh]);
  function updated(review: LiveReview) {
    setReviews((current) =>
      current.map((item) =>
        item.run_id === review.run_id
          ? {
              ...item,
              status: review.status,
              version: review.request.features[0].version,
            }
          : item,
      ),
    );
  }
  const active = reviews.find((review) => review.run_id === selected);
  if (!reviews.length && !error) return null;
  return (
    <section
      className="panel panel-padding"
      aria-label="Saved live council reviews"
    >
      <div className="flex-between">
        <div>
          <div className="eyebrow">SAVED COUNCIL DECISIONS</div>
          <h2>Your live proposals.</h2>
          <p>
            Real council assessments, saved on this laptop. Decisions apply to
            the displayed requirement version.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw size={15} /> Refresh
        </Button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {reviews.map((review) => (
        <div className="judge-feature" key={review.run_id}>
          <div className="flex-between">
            <div>
              <strong>{review.title}</strong>
              <p className="small muted">
                BMW {review.scope.vehicle} · {review.scope.market} · V
                {review.version}
              </p>
            </div>
            <Badge tone="blue">
              {review.status.replaceAll("_", " ").toUpperCase()}
            </Badge>
          </div>
          <div className="inline-actions">
            <Button
              variant="secondary"
              onClick={() =>
                setSelected(selected === review.run_id ? null : review.run_id)
              }
            >
              {selected === review.run_id ? "Close review" : "Review decision"}
            </Button>
            <Link
              className="text-link"
              to={`/council?agent=${review.lead_agent}&source_run=${review.source_run_id}&job=${review.job_id}`}
            >
              Open debate <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      ))}
      {active && (
        <LiveJudgeReview
          key={active.run_id}
          debate={active}
          onReview={updated}
        />
      )}
    </section>
  );
}
