import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Button, EmptyState, Loading, PageHeader } from "../components/ui/Primitives";
import { useAppStore } from "../store/useAppStore";
import type { CustomerScopeFilters } from "../store/useAppStore";
import { MARKET_OPTIONS, POWERTRAIN_OPTIONS, customerBackendAvailable, liveCustomerSource } from "../lib/api/customer";
import type { CustomerDataSource, CustomerEvidence, CustomerFilters, Drilldown, FeatureRanking, FeatureRow } from "../lib/api/customer";
import { demoCustomerSource } from "../lib/api/customerDemo";
import { EvidenceDrawer } from "../components/customer/EvidenceDrawer";
import type { DrawerRequest } from "../components/customer/EvidenceDrawer";
import { Footnote, TYPE_LABELS, fmt, pct } from "../components/customer/shared";
import "../components/customer/customer.css";

const VEHICLES = ["F70", "G60", "G70"];
const INITIAL_ROWS = 20;
const DETAIL_ROWS = 5; // the top N rows of each table can be expanded inline
const DETAIL_QUOTES = 3; // quotes per feedback type in an expanded row

const label = (opts: { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label ?? v;

export default function Customer() {
  const scope = useAppStore((s) => s.scope);
  const stored = useAppStore((s) => s.customerFilters);
  const setStored = useAppStore((s) => s.setCustomerFilters);
  const filters: CustomerScopeFilters = stored ?? {
    vehicle: scope.vehicle,
    market: scope.market,
    powertrain: "All",
    source: "All",
    category: "All",
    feedbackType: "All",
    query: "",
  };
  const update = useCallback((patch: Partial<CustomerScopeFilters>) => setStored({ ...filters, ...patch }), [filters, setStored]);
  const apiFilters: CustomerFilters = useMemo(
    () => ({
      vehicle: filters.vehicle,
      market: filters.market,
      powertrain: filters.powertrain,
      source: "All",
      category: "All",
    }),
    [filters.vehicle, filters.market, filters.powertrain],
  );

  const [source, setSource] = useState<CustomerDataSource | null>(null);
  const [data, setData] = useState<FeatureRanking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerRequest | null>(null);

  // Live backend when reachable, otherwise the clearly labelled demo fallback.
  useEffect(() => {
    const ctrl = new AbortController();
    customerBackendAvailable(ctrl.signal).then((ok) => !ctrl.signal.aborted && setSource(ok ? liveCustomerSource : demoCustomerSource));
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (!source) return;
    const ctrl = new AbortController();
    setError(null);
    source
      .features(apiFilters, ctrl.signal)
      .then(setData)
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        if (source.mode === "live")
          setSource(demoCustomerSource); // never mix live and demo numbers
        else setError(String(e.message ?? e));
      });
    return () => ctrl.abort();
  }, [source, apiFilters]);

  const open = (row: FeatureRow, type?: string) =>
    setDrawer({
      kind: "query",
      title: `${row.category}${type ? ` · ${TYPE_LABELS[type] ?? type}` : ""}`,
      filters: { ...apiFilters, category: row.category },
      type,
    });

  const header = (
    <PageHeader
      eyebrow="01 / THE HUMAN PERSPECTIVE"
      title="Listen closer. See further."
      description="What customers dislike, and what they want or like, ranked by how often they mention it."
      action={
        data && (
          <span className={`ci-status ${data.dataSource}`}>
            <i aria-hidden="true" />
            {data.dataSource === "demo" ? "Demo data" : "Live · BMW data"}
          </span>
        )
      }
    />
  );
  if (!source || !data)
    return (
      <>
        {header}
        {error ? <EmptyState title="Customer data could not be loaded" detail={error} /> : <Loading label="Loading customer feedback…" />}
      </>
    );

  const demo = data.dataSource === "demo";
  const available = data.coverage.available;
  const has = (v: string, m: string, p: string) =>
    demo || available.some((a) => a.vehicle === v && (m === "All" || a.market === m) && (p === "All" || a.powertrain === p));
  const scopeLine = `${filters.vehicle} · ${label(MARKET_OPTIONS, filters.market)} · ${filters.powertrain === "All" ? "all powertrains" : label(POWERTRAIN_OPTIONS, filters.powertrain)}`;
  const warnings = data.coverage.warnings.filter((w) => !w.startsWith("No customer identifier"));

  return (
    <div className="ci-page">
      {header}
      <p className="ci-scope-line" data-testid="scope-line">
        {scopeLine} · {data.records ? `${fmt(data.records)} ${demo ? "demo" : "feedback"} records` : "no feedback records"}
      </p>

      <div className="ci-glass ci-filters">
        <select aria-label="Vehicle" value={filters.vehicle} onChange={(e) => update({ vehicle: e.target.value })}>
          {VEHICLES.map((v) => (
            <option key={v} value={v} disabled={!has(v, filters.market, filters.powertrain)}>
              {v}
            </option>
          ))}
        </select>
        <select aria-label="Market" value={filters.market} onChange={(e) => update({ market: e.target.value })}>
          {MARKET_OPTIONS.map((m) => {
            const ok = has(filters.vehicle, m.value, filters.powertrain);
            return (
              <option key={m.value} value={m.value} disabled={!ok} title={ok ? "" : `No ${m.label} feedback for ${filters.vehicle}`}>
                {m.label}
              </option>
            );
          })}
        </select>
        <select aria-label="Powertrain" value={filters.powertrain} onChange={(e) => update({ powertrain: e.target.value })}>
          {POWERTRAIN_OPTIONS.map((p) => {
            const ok = has(filters.vehicle, filters.market, p.value);
            return (
              <option key={p.value} value={p.value} disabled={!ok} title={ok ? "" : `${filters.vehicle} has no ${p.label} feedback`}>
                {p.label}
              </option>
            );
          })}
        </select>
      </div>

      {warnings.length > 0 && (
        <div className="ci-glass ci-banner" role="status">
          <AlertTriangle size={15} />
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="ci-rankings">
        <RankingTable
          tone="red"
          title="What customers don’t like"
          detail="Defects and things that are hard to use"
          rows={data.dislikes}
          total={data.records}
          rowType={() => "Complaint"}
          detailTypes={() => ["Complaint"]}
          source={source}
          filters={apiFilters}
          onOpen={open}
        />
        <RankingTable
          tone="green"
          title="What customers want or like"
          detail="Praise for current models and requested features"
          rows={data.likes}
          total={data.records}
          rowType={(r) => Object.keys(r.byType)[0]}
          detailTypes={(r) => Object.keys(r.byType)}
          source={source}
          filters={apiFilters}
          onOpen={open}
        />
      </div>
      <Footnote>
        Mentions = unique feedback records (comments) about a feature, most mentioned first; a comment with several classifications in one feature is counted once. Share
        = mentions ÷ {fmt(data.records)} records in {scopeLine}. This is the share of supplied feedback, not of all customers, and the data has no customer ID. Click a
        row for the original comments.
      </Footnote>

      {drawer && <EvidenceDrawer request={drawer} source={source} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function RankingTable({
  tone,
  title,
  detail,
  rows,
  total,
  rowType,
  detailTypes,
  source,
  filters,
  onOpen,
}: {
  tone: "red" | "green";
  title: string;
  detail: string;
  rows: FeatureRow[];
  total: number;
  rowType: (r: FeatureRow) => string;
  detailTypes: (r: FeatureRow) => string[];
  source: CustomerDataSource;
  filters: CustomerFilters;
  onOpen: (r: FeatureRow, type?: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (category: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(category)) next.add(category);
      return next;
    });
  const visible = showAll ? rows : rows.slice(0, INITIAL_ROWS);
  const max = rows[0]?.records ?? 1;
  const onKey = (r: FeatureRow) => (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(r, rowType(r));
    }
  };
  return (
    <section className={`ci-glass ci-rank ${tone}`} data-testid={`ranking-${tone}`}>
      <header className="ci-rank-head">
        <div>
          <h2>
            <i className="ci-dot" aria-hidden="true" />
            {title}
          </h2>
          <p>{detail}</p>
        </div>
        <span className="ci-rank-total">{fmt(rows.length)} features</span>
      </header>
      {rows.length ? (
        <table className="ci-rank-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Feature</th>
              <th>Mentions</th>
              <th>Share</th>
              <th>Split</th>
              <th aria-label="Details" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <Fragment key={r.category}>
                <tr
                  data-testid="rank-row"
                  tabIndex={0}
                  onClick={() => onOpen(r, rowType(r))}
                  onKeyDown={onKey(r)}
                  aria-label={`${i + 1}. ${r.category}: ${r.records} mentions. Open comments.`}
                >
                  <td className="ci-rank-n">{i + 1}</td>
                  <td className="ci-rank-feature">
                    <strong>{r.category}</strong>
                  </td>
                  <td className="ci-rank-count">
                    <span className="ci-rank-bar">
                      <i style={{ width: `${(r.records / max) * 100}%` }} />
                    </span>
                    <strong>{fmt(r.records)}</strong>
                  </td>
                  <td className="ci-rank-share">{pct(r.records, total, 1)}</td>
                  <td className="ci-rank-types">
                    {Object.entries(r.byType).map(([t, n], k) => (
                      <span key={t}>
                        {k > 0 && <span className="ci-sep"> · </span>}
                        <button
                          className="ci-split"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(r, t);
                          }}
                        >
                          {fmt(n)} {(TYPE_LABELS[t] ?? t).toLowerCase()}
                        </button>
                      </span>
                    ))}
                  </td>
                  <td className="ci-rank-expand">
                    {i < DETAIL_ROWS && (
                      <button
                        className={`ci-expand ${expanded.has(r.category) ? "open" : ""}`}
                        aria-expanded={expanded.has(r.category)}
                        aria-label={`${expanded.has(r.category) ? "Hide" : "Show"} details for ${r.category}`}
                        data-testid="expand-row"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(r.category);
                        }}
                      >
                        <ChevronDown size={14} />
                      </button>
                    )}
                  </td>
                </tr>
                {i < DETAIL_ROWS && expanded.has(r.category) && (
                  <tr className="ci-detail-row" data-testid="detail-row">
                    <td colSpan={6}>
                      <FeatureDetail row={r} types={detailTypes(r)} source={source} filters={filters} onOpenAll={() => onOpen(r, rowType(r))} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="ci-nodata">No data for this scope</div>
      )}
      {rows.length > INITIAL_ROWS && (
        <div className="ci-more">
          <Button variant="secondary" onClick={() => setShowAll((s) => !s)}>
            {showAll ? `Show top ${INITIAL_ROWS}` : `Show all ${fmt(rows.length)}`}
          </Button>
        </div>
      )}
    </section>
  );
}

/** "rows 15" / "rows 15, 16" in the backend location string → "row 15". */
const sourceLine = (e: CustomerEvidence) => {
  const row = e.location
    .match(/rows? ([\d, ]+)/)?.[1]
    ?.split(",")[0]
    ?.trim();
  return row ? `${e.source}, row ${row}` : e.source;
};

function FeatureDetail({
  row,
  types,
  source,
  filters,
  onOpenAll,
}: {
  row: FeatureRow;
  types: string[];
  source: CustomerDataSource;
  filters: CustomerFilters;
  onOpenAll: () => void;
}) {
  const [groups, setGroups] = useState<{ type: string; d: Drilldown }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = types.join("|");
  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all(key.split("|").map((type) => source.drilldown({ ...filters, category: row.category }, { type }, ctrl.signal).then((d) => ({ type, d }))))
      .then((g) => !ctrl.signal.aborted && setGroups(g))
      .catch((e) => !ctrl.signal.aborted && setError(String(e.message ?? e)));
    return () => ctrl.abort();
  }, [source, filters, row.category, key]);

  if (error) return <p className="ci-detail-note">Comments could not be loaded: {error}</p>;
  if (!groups) return <p className="ci-detail-note">Loading comments…</p>;
  const subcategories = groups[0]?.d.subcategories.slice(0, 4) ?? [];
  return (
    <div className="ci-detail">
      {subcategories.length > 0 && (
        <p className="ci-detail-aspects">
          <span>Mostly about</span> {subcategories.map(([name, n]) => `${name} (${fmt(n)})`).join(" · ")}
        </p>
      )}
      {groups.map(({ type, d }) => (
        <div key={type} className="ci-detail-group">
          {groups.length > 1 && (
            <h3>
              {TYPE_LABELS[type] ?? type} <span>{fmt(d.quotes.total)}</span>
            </h3>
          )}
          {d.quotes.items.slice(0, DETAIL_QUOTES).map((e) => (
            <figure key={e.id} className="ci-detail-quote" data-testid="detail-quote">
              <blockquote>“{e.passage}”</blockquote>
              <figcaption>
                <strong>{e.id}</strong>
                {[e.country || e.market, e.powertrain].filter(Boolean).join(" · ")}
                <span className="ci-detail-source">Source: {sourceLine(e)}</span>
              </figcaption>
            </figure>
          ))}
          {d.quotes.items.length === 0 && <p className="ci-detail-note">No comments.</p>}
        </div>
      ))}
      <button className="ci-split ci-detail-all" onClick={onOpenAll}>
        All comments and method →
      </button>
    </div>
  );
}
