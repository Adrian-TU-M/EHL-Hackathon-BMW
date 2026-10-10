import type { ReactNode } from "react";
import type { CustomerEvidence, QuantitativeClaim } from "../../lib/api/customer";

export const TYPE_LABELS: Record<string, string> = {
  Likes: "Likes",
  Defect: "Defect",
  "Difficult to Use": "Difficult to use",
  Wants: "Wants",
  Unclassified: "Unclassified",
};

export const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "Unknown" : n.toLocaleString("en-US");
export const pct = (num: number, den: number | null | undefined, digits = 0) =>
  den ? `${((num / den) * 100).toFixed(digits)}%` : "Unknown";

export function ClaimDetails({ claim }: { claim: QuantitativeClaim }) {
  return (
    <dl className="ci-claim">
      <div>
        <dt>Value</dt>
        <dd>
          <strong>{fmt(claim.numerator)}</strong>
          {claim.denominator !== null && (
            <> of {fmt(claim.denominator)} ({pct(claim.numerator, claim.denominator, 1)})</>
          )}{" "}
          <span className="muted">{claim.unit === "unique-records" ? "unique feedback records" : claim.unit}</span>
        </dd>
      </div>
      <div>
        <dt>Method</dt>
        <dd>{claim.method}</dd>
      </div>
      <div>
        <dt>Filters</dt>
        <dd className="ci-chips">
          {claim.filters.map((f) => (
            <span key={f} className="ci-chip">{f}</span>
          ))}
        </dd>
      </div>
      <div>
        <dt>Source</dt>
        <dd>{claim.sourceId}</dd>
      </div>
      <div>
        <dt>Market · period</dt>
        <dd>
          {claim.market} · {claim.period}
        </dd>
      </div>
      <div>
        <dt>Limitations</dt>
        <dd>{claim.limitations}</dd>
      </div>
    </dl>
  );
}

export function Footnote({ children }: { children: ReactNode }) {
  return <p className="chart-note ci-footnote">{children}</p>;
}

export function QuoteCard({ e }: { e: CustomerEvidence }) {
  return (
    <article className="ci-quote" data-testid="quote">
      <div className="ci-quote-types">
        {(e.feedbackTypes.length ? e.feedbackTypes : ["Unclassified"]).map((t) => TYPE_LABELS[t] ?? t).join(" · ")}
        {e.severity && ` · ${e.severity}`}
        {e.provenance === "synthetic" && " · demo"}
      </div>
      <blockquote>“{e.passage}”</blockquote>
      <footer>
        <strong>{e.id}</strong>
        <span>{e.country || e.market}</span>
        <span>{e.powertrain}</span>
        <span>{e.channel}</span>
        <span title={e.subcategories.join(", ")}>{e.theme}</span>
      </footer>
    </article>
  );
}

export function NoData({ children = "No data for this scope" }: { children?: ReactNode }) {
  return <div className="ci-nodata">{children}</div>;
}
