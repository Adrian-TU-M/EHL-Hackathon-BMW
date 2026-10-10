"""Deterministic statistics. Every number the agent reports comes from here, wrapped in
a QuantitativeClaim (spec §7); the LLM never produces numbers."""

from __future__ import annotations

import pandas as pd

from .ingest import CustomerData
from .mappings import UNCLASSIFIED, Mappings
from .retrieval import scope_rows
from .schemas import Coverage, QuantitativeClaim, Scope, StudyRef, ThemeStat

SAMPLE_CAVEAT = (
    "Share of supplied feedback records, not of all customers: feedback is self-selected "
    "and channel-dependent, so it indicates reported friction, not population prevalence."
)
NO_CUSTOMER_ID = "No customer identifier in the source, so unique customers cannot be counted."


def _filters(scope: Scope) -> list[str]:
    out = [f"vehicle={scope.vehicle}", f"market={scope.market}"]
    out.append(f"powertrain={scope.powertrain}" if scope.powertrain else "powertrain=all")
    return out


def period(data: CustomerData, rows: pd.DataFrame) -> str:
    dates = rows["date"][rows["date"] != ""] if len(rows) else []
    if len(dates):
        return f"{min(dates)} – {max(dates)}"
    return "unknown (no date column in source)"


def _unit(data: CustomerData) -> tuple[str, str]:
    if data.has_customer_ids:
        return "unique-records", "Customer IDs available; see uniqueCustomers in coverage."
    return "unique-records", NO_CUSTOMER_ID


def claim(data: CustomerData, scope: Scope, rows: pd.DataFrame, numerator: int,
          denominator: int, method: str, extra_limits: str = "") -> QuantitativeClaim:
    unit, id_note = _unit(data)
    files = ", ".join(sorted(rows["file"].unique())) if len(rows) else "none"
    return QuantitativeClaim(
        numerator=numerator,
        denominator=denominator,
        unit=unit,
        sourceId=files,
        filters=_filters(scope),
        market=scope.market,
        period=period(data, rows),
        method=method,
        limitations=" ".join(x for x in (SAMPLE_CAVEAT, id_note, extra_limits) if x),
    )


def _records_with(rows: pd.DataFrame, **conds: str) -> int:
    subset = rows
    for col, val in conds.items():
        subset = subset[subset[col] == val]
    return int(subset["record_id"].nunique())


def coverage(data: CustomerData, scope: Scope) -> Coverage:
    rows = scope_rows(data, scope)
    records = rows.drop_duplicates("record_id")
    warnings = list(data.warnings)
    if rows.empty:
        have = data.rows[data.rows["market"].str.lower() == scope.market.lower()]
        warnings.append(
            f"No feedback records for {scope.vehicle} / {scope.market}"
            f"{' / ' + scope.powertrain if scope.powertrain else ''}."
            + ("" if len(have) else f" The supplied feedback contains no {scope.market} records at all.")
        )
    studies = study_rows(data, scope)
    if rows.empty and len(studies):
        warnings.append("Customer study data is available for this scope; analysis uses studies only.")
    if not data.has_customer_ids:
        warnings.append(NO_CUSTOMER_ID)
    if scope.powertrain and len(studies):
        warnings.append("Customer studies are not split by powertrain; study values cover all powertrains.")
    available = (
        data.rows.groupby(["vehicle", "market", "powertrain"])["record_id"].nunique()
        .reset_index(name="records").sort_values("records", ascending=False).to_dict("records")
    )
    by_polarity = {p: _records_with(rows, polarity=p) for p in ("Complaint", "Request", "Positive", UNCLASSIFIED)}
    return Coverage(
        scope=scope,
        feedbackRows=len(rows),
        uniqueRecords=int(records["record_id"].nunique()),
        uniqueCustomers=int(records["customer_id"].replace("", pd.NA).nunique()) if data.has_customer_ids else None,
        customersIdentifiable=data.has_customer_ids,
        byPolarity=by_polarity,
        byPowertrain=records["powertrain"].value_counts().to_dict(),
        byChannel=records["channel"].value_counts().to_dict(),
        studies=[
            {"source": s, "metric": m, "attributes": int(g["attribute"].nunique())}
            for (s, m), g in studies.groupby(["sheet", "metric"])
        ] if len(studies) else [],
        available=available,
        warnings=warnings,
    )


def study_rows(data: CustomerData, scope: Scope) -> pd.DataFrame:
    s = data.studies
    if s.empty:
        return s
    return s[(s["market"].str.lower() == scope.market.lower()) & (s["vehicle"].str.lower() == scope.vehicle.lower())]


def study_refs(data: CustomerData, maps: Mappings, scope: Scope, theme: str | None) -> list[StudyRef]:
    """Study attributes for the scope; filtered to a theme via the same keyword taxonomy."""
    mine = study_rows(data, scope)
    if mine.empty:
        return []
    out = []
    for _, row in mine.iterrows():
        attr_theme, _ = maps.theme(row["attribute"])
        if theme and attr_theme != theme:
            continue
        peers = data.studies[
            (data.studies["sheet"] == row["sheet"]) & (data.studies["attribute"] == row["attribute"])
            & (data.studies["market"] == row["market"]) & (data.studies["metric"] == row["metric"])
            & (data.studies["vehicle"] != row["vehicle"])
        ]
        comparison = {p["vehicle"]: round(float(p["value"]), 3) for _, p in peers.iterrows() if pd.notna(p["value"])}
        is_mean = row["metric"] == "mean"
        value = None if pd.isna(row["value"]) else round(float(row["value"]), 3)
        ref_id = f"STUDY:{row['sheet']}:{row['row']}:{row['vehicle']}"
        out.append(StudyRef(
            id=ref_id, source=f"{row['source']} / {row['sheet']}", market=row["market"],
            vehicle=row["vehicle"], attribute=row["attribute"], metric=row["metric"], value=value,
            comparison=comparison,
            quantitative=QuantitativeClaim(
                numerator=value if value is not None else 0,
                denominator=None if is_mean else 1,
                unit="mean score" if is_mean else "share of respondents (top-3 box)",
                sourceId=f"{row['source']} / {row['sheet']} row {row['row']}",
                filters=[f"vehicle={row['vehicle']}", f"market={row['market']}"],
                market=row["market"], period=str(row["year"]),
                method="Mean as supplied by the study" if is_mean else
                "Sum of 'Excellent', 'Delightful', 'I Love It' shares as supplied",
                limitations="Sample size not supplied with the study; scale as supplied. "
                "Study values are not split by powertrain.",
            ),
        ))
    return out


def theme_stats(data: CustomerData, maps: Mappings, scope: Scope, limit: int | None = None) -> list[ThemeStat]:
    rows = scope_rows(data, scope)
    total = int(rows["record_id"].nunique())
    classified = rows[rows["theme"] != UNCLASSIFIED]
    stats: list[ThemeStat] = []
    for theme, trows in classified.groupby("theme"):
        n = int(trows["record_id"].nunique())
        complaints = _records_with(trows, polarity="Complaint")
        requests = _records_with(trows, polarity="Request")
        positives = _records_with(trows, polarity="Positive")
        subs = trows.groupby("category_l2")["record_id"].nunique().sort_values(ascending=False)
        segments = {}
        for dim in ("powertrain", "market", "channel"):
            counts = trows.groupby(dim)["record_id"].nunique()
            if len(counts) > 1:
                segments[dim] = {str(k): int(v) for k, v in counts.items()}
        stats.append(ThemeStat(
            theme=theme, topic=trows["topic"].iloc[0] or None, records=n, classificationRows=len(trows),
            complaints=complaints, requests=requests, positives=positives,
            shareOfRecords=claim(data, scope, rows, n, total,
                                 f"Unique feedback IDs with at least one classification row in theme '{theme}' "
                                 "÷ all unique feedback IDs in scope (a record can belong to several themes)."),
            complaintShare=claim(data, scope, rows, complaints, total,
                                 f"Unique feedback IDs with a Complaint-type row (Defect / Difficult to Use) in '{theme}' "
                                 "÷ all unique feedback IDs in scope."),
            topSubcategories=[(str(k), int(v)) for k, v in subs.head(6).items()],
            segments=segments,
            studyRefs=study_refs(data, maps, scope, theme),
        ))
    stats.sort(key=lambda s: (-(s.complaints + s.requests), -s.records, s.theme))
    return stats[:limit] if limit else stats

