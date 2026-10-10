import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Loading } from "../ui/Primitives";
import type {
  CustomerDataSource,
  CustomerEvidence,
  CustomerFilters,
  Drilldown,
  QuantitativeClaim,
} from "../../lib/api/customer";
import { ClaimDetails, NoData, QuoteCard, TYPE_LABELS, fmt } from "./shared";

export type DrawerRequest =
  | { kind: "query"; title: string; filters: CustomerFilters; type?: string; theme?: string }
  | { kind: "evidence"; title: string; items: CustomerEvidence[]; claim?: QuantitativeClaim; note?: string };

export function EvidenceDrawer({
  request,
  source,
  onClose,
}: {
  request: DrawerRequest;
  source: CustomerDataSource;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [data, setData] = useState<Drilldown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    if (request.kind !== "query") return;
    const ctrl = new AbortController();
    setData(null);
    setError(null);
    source
      .drilldown(request.filters, { type: request.type, theme: request.theme }, ctrl.signal)
      .then(setData)
      .catch((e) => !ctrl.signal.aborted && setError(String(e.message ?? e)));
    return () => ctrl.abort();
  }, [request, source]);

  const claim = request.kind === "query" ? data?.claim : request.claim;
  const quotes = request.kind === "query" ? data?.quotes.items : request.items;
  const total = request.kind === "query" ? data?.quotes.total : request.items.length;

  return (
    <dialog
      ref={ref}
      className="ci-drawer"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="ci-drawer-inner">
        <header className="ci-drawer-head">
          <div>
            <div className="eyebrow">EVIDENCE</div>
            <h2 id={titleId}>{request.title}</h2>
          </div>
          <button className="icon-button" aria-label="Close evidence drawer" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {request.kind === "query" && (
          <div className="ci-chips ci-drawer-filters">
            {Object.entries(request.filters).map(([k, v]) => (
              <span key={k} className="ci-chip">
                {k}: {v}
              </span>
            ))}
            {request.type && <span className="ci-chip strong">type: {TYPE_LABELS[request.type] ?? request.type}</span>}
            {request.theme && <span className="ci-chip strong">theme group: {request.theme}</span>}
          </div>
        )}
        {request.kind === "evidence" && request.note && <p className="muted small">{request.note}</p>}
        {error && <div className="notice amber">Could not load evidence: {error}</div>}
        {request.kind === "query" && !data && !error && <Loading label="Loading original feedback…" />}
        {claim && (
          <section className="ci-drawer-section">
            <h3>How this number is calculated</h3>
            <ClaimDetails claim={claim} />
          </section>
        )}
        {data && data.subcategories.length > 0 && (
          <section className="ci-drawer-section">
            <h3>Top subcategories</h3>
            <ul className="ci-mini-list">
              {data.subcategories.map(([name, n]) => (
                <li key={name}>
                  <span>{name}</span>
                  <strong>{fmt(n)}</strong>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data && data.studyRefs.length > 0 && (
          <section className="ci-drawer-section">
            <h3>Linked customer-study results · {data.theme}</h3>
            <ul className="ci-mini-list">
              {data.studyRefs.slice(0, 8).map((r) => (
                <li key={r.id} title={r.quantitative.limitations}>
                  <span>
                    {r.attribute} <small className="muted">({r.market} {r.vehicle})</small>
                  </span>
                  <strong>
                    {r.value === null ? "Unknown" : r.metric === "mean" ? r.value.toFixed(2) : `${(r.value * 100).toFixed(0)}%`}
                  </strong>
                </li>
              ))}
            </ul>
          </section>
        )}
        {quotes && (
          <section className="ci-drawer-section">
            <h3>
              Original feedback <span className="ci-muted">{fmt(total)} records</span>
            </h3>
            {quotes.length ? (
              <div className="ci-drawer-quotes">
                {quotes.map((e) => (
                  <QuoteCard key={e.id} e={e} />
                ))}
              </div>
            ) : (
              <NoData>No feedback records match this selection.</NoData>
            )}
            {total !== undefined && quotes.length < total && (
              <p className="muted small">
                Showing {quotes.length} of {fmt(total)}. Use “Voice of the customer” below to page through all records.
              </p>
            )}
          </section>
        )}
      </div>
    </dialog>
  );
}
