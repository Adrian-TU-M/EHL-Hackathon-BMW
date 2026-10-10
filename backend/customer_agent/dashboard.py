"""Deterministic aggregates for the Customer Intelligence page. No LLM involved.

Every count is of unique feedback records (IDs), never classification rows. Raw
feedback-type labels (e.g. Likes / Defect / Difficult to Use / Wants) are kept so the
page can rank them separately; rows without a type are "Unclassified".
"""

from __future__ import annotations

import re

import pandas as pd

from .ingest import CustomerData
from .mappings import UNCLASSIFIED, Mappings
from .retrieval import is_all, rank_records, scope_rows, to_evidence
from .schemas import (
    Dashboard,
    DashboardFilters,
    DashboardKpis,
    DashboardOptions,
    FeatureRanking,
    FeatureRow,
    Drilldown,
    QuantitativeClaim,
    QuotePage,
    Ranking,
    RankItem,
    Scope,
    SegmentSplit,
    SegmentValue,
    StudyRow,
    TreeLeaf,
    TreeNode,
)
from .stats import NO_CUSTOMER_ID, SAMPLE_CAVEAT, coverage, period, study_refs, study_rows, theme_stats

MIN_SEGMENT = 30   # segments below this are hidden with a note
SMALL_SAMPLE = 100  # below this the page shows a small-sample caveat
TOP_N = 8
TYPE_ORDER = ["Likes", "Defect", "Difficult to Use", "Wants"]
OVERALL = re.compile(r"overall (product )?satisfaction", re.IGNORECASE)


def _scope(f: DashboardFilters) -> Scope:
    return Scope(vehicle=f.vehicle, market=f.market, powertrain=None if is_all(f.powertrain) else f.powertrain)


def filtered_rows(data: CustomerData, f: DashboardFilters) -> pd.DataFrame:
    rows = scope_rows(data, _scope(f))
    if not is_all(f.source):
        rows = rows[rows["channel"].str.lower() == f.source.lower()]
    if not is_all(f.category):
        rows = rows[rows["category_l2"].str.lower() == f.category.lower()]
    return rows


def _type_label(row_type: pd.Series) -> pd.Series:
    return row_type.where(row_type != "", UNCLASSIFIED)


def _filter_list(f: DashboardFilters) -> list[str]:
    return [f"{k}={v}" for k, v in f.model_dump().items()]


def _claim(data: CustomerData, f: DashboardFilters, rows: pd.DataFrame, numerator: int,
           denominator: int, method: str) -> QuantitativeClaim:
    files = ", ".join(sorted(rows["file"].unique())) if len(rows) else "none"
    id_note = "" if data.has_customer_ids else NO_CUSTOMER_ID
    return QuantitativeClaim(
        numerator=numerator, denominator=denominator, unit="unique-records", sourceId=files,
        filters=_filter_list(f), market=f.market, period=period(data, rows), method=method,
        limitations=" ".join(x for x in (SAMPLE_CAVEAT, id_note) if x),
    )


def _records(rows: pd.DataFrame) -> int:
    return int(rows["record_id"].nunique())


def _types_present(rows: pd.DataFrame) -> list[str]:
    present = set(_type_label(rows["feedback_type"]))
    ordered = [t for t in TYPE_ORDER if t in present]
    ordered += sorted(t for t in present if t not in TYPE_ORDER and t != UNCLASSIFIED)
    return ordered + ([UNCLASSIFIED] if UNCLASSIFIED in present else [])


def _rankings(data: CustomerData, f: DashboardFilters, rows: pd.DataFrame, total: int,
              levels: list[str]) -> list[Ranking]:
    out = []
    if rows.empty:
        return []
    labelled = rows.assign(type_label=_type_label(rows["feedback_type"]))
    classified = labelled[~labelled["category_l2"].map(lambda c: c.strip().lower() in {"", "no_class_found"})]
    for t in _types_present(rows):
        if t == UNCLASSIFIED:
            continue
        trows = classified[classified["type_label"] == t]
        polarity = labelled[labelled["type_label"] == t]["polarity"].iloc[0]
        items = []
        counts = trows.groupby("category_l2")["record_id"].nunique().sort_values(ascending=False)
        for category, n in counts.head(TOP_N).items():
            crows = trows[trows["category_l2"] == category]
            severity = {}
            if levels and crows["severity"].astype(bool).any():
                per = crows.drop_duplicates("record_id")["severity"].replace("", "unspecified").value_counts()
                severity = {lvl: int(per.get(lvl, 0)) for lvl in levels + ["unspecified"] if per.get(lvl, 0)}
            items.append(RankItem(category=category, theme=crows["theme"].iloc[0], records=int(n),
                                  severity=severity))
        n_type = _records(labelled[labelled["type_label"] == t])
        out.append(Ranking(
            type=t, polarity=polarity, records=n_type, items=items,
            claim=_claim(data, f, rows, n_type, total,
                         f"Unique feedback IDs with at least one '{t}' classification ÷ all unique "
                         "feedback IDs after filters. Bars count unique IDs per source category."),
        ))
    return out


def _tree(rows: pd.DataFrame, limit: int = 40) -> list[TreeNode]:
    if rows.empty:
        return []
    classified = rows[~rows["category_l2"].map(lambda c: c.strip().lower() in {"", "no_class_found"})]
    nodes = []
    for category, crows in classified.groupby("category_l2"):
        def n(pol: str) -> int:
            return _records(crows[crows["polarity"] == pol])
        leaves = (crows[crows["category_l3"] != ""].groupby("category_l3")["record_id"].nunique()
                  .sort_values(ascending=False))
        nodes.append(TreeNode(
            category=category, theme=crows["theme"].iloc[0], records=_records(crows),
            positive=n("Positive"), negative=n("Complaint"), request=n("Request"),
            children=[TreeLeaf(name=str(k), records=int(v)) for k, v in leaves.head(8).items()],
        ))
    nodes.sort(key=lambda x: (-x.records, x.category))
    return nodes[:limit]


def _segments(rows: pd.DataFrame, tree: list[TreeNode]) -> list[SegmentSplit]:
    if rows.empty:
        return []
    top_negative = sorted((t for t in tree if t.negative), key=lambda t: -t.negative)[:4]
    out = []
    for dim in ("powertrain", "market", "channel"):
        values = sorted(v for v in rows[dim].unique() if v)
        if len(values) < 2:
            continue
        totals = rows.groupby(dim)["record_id"].nunique()
        for node in top_negative:
            neg = rows[(rows["category_l2"] == node.category) & (rows["polarity"] == "Complaint")]
            neg_by = neg.groupby(dim)["record_id"].nunique()
            seg_values, hidden = [], []
            for v in values:
                total = int(totals.get(v, 0))
                if total < MIN_SEGMENT:
                    hidden.append(v)
                    continue
                k = int(neg_by.get(v, 0))
                seg_values.append(SegmentValue(value=v, negative=k, total=total, share=round(k / total, 4)))
            out.append(SegmentSplit(dimension=dim, category=node.category, values=seg_values, hidden=hidden))
    return out


def _study_table(data: CustomerData, maps: Mappings) -> list[StudyRow]:
    s = data.studies
    if s.empty:
        return []
    out = []
    for _, r in s.iterrows():
        out.append(StudyRow(
            id=f"STUDY:{r['sheet']}:{r['row']}:{r['vehicle']}", source=r["source"], sheet=r["sheet"],
            kind=r["kind"], market=r["market"], vehicle=r["vehicle"], attribute=r["attribute"],
            theme=maps.theme(r["attribute"])[0], metric=r["metric"],
            value=None if pd.isna(r["value"]) else float(r["value"]),
            bottomBox=None if pd.isna(r.get("bottom_box")) else float(r["bottom_box"]),
            distribution=r["distribution"] if isinstance(r["distribution"], dict) else None,
            year=str(r["year"]), levelsNote=str(r.get("levels_note", "")),
        ))
    return out


def build_dashboard(data: CustomerData, maps: Mappings, f: DashboardFilters, levels: list[str]) -> Dashboard:
    scope = _scope(f)
    scoped = scope_rows(data, scope)  # before source/category filters: drives filter options
    rows = filtered_rows(data, f)
    total = _records(rows)
    labelled = _type_label(rows["feedback_type"])
    by_type = {t: _records(rows[labelled == t]) for t in _types_present(rows)}
    improvement = _records(rows[rows["polarity"].isin(["Complaint", "Request"])])
    likes = _records(rows[rows["polarity"] == "Positive"])
    satisfaction = next((r for r in study_refs(data, maps, scope, None) if OVERALL.search(r.attribute)), None)
    tree = _tree(rows)
    studies_scope = study_rows(data, scope)
    cov = coverage(data, scope)
    if 0 < total < SMALL_SAMPLE:
        cov.warnings.append(f"Small sample: {total} feedback records after filters; treat shares as indicative.")
    if not data.has_dates:
        cov.warnings.append("No feedback dates in the source, so no time trends can be shown.")
    if len(studies_scope) and studies_scope["sample_size"].isna().all():
        cov.warnings.append("Study sample sizes are not provided.")
    return Dashboard(
        filters=f, records=total, rows=len(rows), byType=by_type,
        kpis=DashboardKpis(
            records=_claim(data, f, rows, total, total, "Unique feedback IDs after filters (classification rows deduplicated)."),
            improvement=_claim(data, f, rows, improvement, total,
                               "Unique feedback IDs with at least one Defect, Difficult to Use or Wants row ÷ all unique IDs."),
            likes=_claim(data, f, rows, likes, total, "Unique feedback IDs with at least one Likes row ÷ all unique IDs."),
            satisfaction=satisfaction,
        ),
        rankings=_rankings(data, f, rows, total, levels),
        tree=tree,
        segments=_segments(rows, tree),
        themes=theme_stats(data, maps, scope),
        studies=_study_table(data, maps),
        coverage=cov,
        options=DashboardOptions(
            sources=[(str(k), int(v)) for k, v in scoped.groupby("channel")["record_id"].nunique().items() if k],
            categories=[(str(k), int(v)) for k, v in scoped.groupby("category_l2")["record_id"].nunique()
                        .sort_values(ascending=False).items()
                        if k and k.lower() != "no_class_found"],
            types=_types_present(scoped) if len(scoped) else [],
            severityLevels=levels,
            available=cov.available,
            studyAvailable=(data.studies[["vehicle", "market"]].drop_duplicates().to_dict("records")
                            if not data.studies.empty else []),
        ),
        minSegment=MIN_SEGMENT,
    )


def _type_mask(rows: pd.DataFrame, feedback_type: str | None) -> pd.Series:
    if is_all(feedback_type):
        return pd.Series(True, index=rows.index)
    t = feedback_type.strip().lower()
    if t == UNCLASSIFIED.lower():
        return rows["feedback_type"] == ""
    return (rows["feedback_type"].str.lower() == t) | (rows["polarity"].str.lower() == t)


def quotes(data: CustomerData, f: DashboardFilters, feedback_type: str | None = None,
           theme: str | None = None, query: str | None = None, offset: int = 0,
           limit: int = 24) -> QuotePage:
    rows = filtered_rows(data, f)
    rows = rows[_type_mask(rows, feedback_type)]
    if theme:
        rows = rows[rows["theme"].str.lower() == theme.lower()]
    if rows.empty:
        return QuotePage(total=0, offset=offset, items=[])
    ranked = rank_records(rows, query)
    page = ranked[offset: offset + limit]
    items = [to_evidence(data, rows[rows["record_id"] == rid]) for rid in page]
    return QuotePage(total=len(ranked), offset=offset, items=items)


def drilldown(data: CustomerData, maps: Mappings, f: DashboardFilters, feedback_type: str | None,
              limit: int = 30, theme: str | None = None) -> Drilldown:
    """Evidence for one source category (or one theme group), optionally one feedback type."""
    rows = filtered_rows(data, f)
    subset = rows[_type_mask(rows, feedback_type)]
    category = None if is_all(f.category) else f.category
    if theme:
        subset = subset[subset["theme"].str.lower() == theme.lower()]
    elif category:
        theme = subset["theme"].iloc[0] if len(subset) else maps.theme(category)[0]
    n = _records(subset)
    base = DashboardFilters(**{**f.model_dump(), "category": "All"})
    denominator = _records(filtered_rows(data, base))
    # Within a theme group, show its source categories; within a category, its subcategories.
    level = "category_l2" if theme and not category else "category_l3"
    subs = (subset[~subset[level].str.lower().isin(["", "no_class_found"])].groupby(level)["record_id"]
            .nunique().sort_values(ascending=False))
    label = f"'{feedback_type}' " if not is_all(feedback_type) else ""
    where = f" in category {category!r}" if category else (f" in theme group {theme!r}" if theme else "")
    return Drilldown(
        filters=f, category=category, theme=theme, type=None if is_all(feedback_type) else feedback_type,
        claim=_claim(data, f, rows, n, denominator,
                     f"Unique feedback IDs with a {label}classification{where} ÷ all unique feedback IDs "
                     "in scope (all categories)."),
        subcategories=[(str(k), int(v)) for k, v in subs.head(10).items()],
        studyRefs=study_refs(data, maps, _scope(f), theme) if theme else [],
        quotes=quotes(data, f, feedback_type, theme, None, 0, limit),
    )


def _feature_side(rows: pd.DataFrame, polarities: set[str]) -> list[FeatureRow]:
    side = rows[rows["polarity"].isin(polarities)]
    side = side[~side["category_l2"].str.strip().str.lower().isin(["", "no_class_found"])]
    out = []
    for category, crows in side.groupby("category_l2"):
        by_type = crows.assign(t=_type_label(crows["feedback_type"])).groupby("t")["record_id"].nunique()
        out.append(FeatureRow(category=category, theme=crows["theme"].iloc[0], records=_records(crows),
                              byType={str(k): int(v) for k, v in by_type.sort_values(ascending=False).items()}))
    out.sort(key=lambda r: (-r.records, r.category))
    return out


def feature_ranking(data: CustomerData, f: DashboardFilters) -> FeatureRanking:
    """All categories ranked: what customers dislike (complaints) vs. want or like."""
    rows = filtered_rows(data, f)
    return FeatureRanking(
        filters=f, records=_records(rows),
        dislikes=_feature_side(rows, {"Complaint"}),
        likes=_feature_side(rows, {"Positive", "Request"}),
        coverage=coverage(data, _scope(f)),
    )
