"""Customer-domain retrieval over the ingested frames. Deterministic: scope filters,
theme resolution, keyword ranking. It only ever sees ``CustomerData`` (feedback +
studies), so it cannot surface sales or competitor material."""

from __future__ import annotations

import re
import zlib

import pandas as pd

from .ingest import CustomerData
from .mappings import UNCLASSIFIED
from .schemas import Evidence, Scope

POLARITY_ORDER = ("Complaint", "Request", "Positive", UNCLASSIFIED)


def is_all(value: str | None) -> bool:
    return not value or value.strip().lower() == "all"


def _match(series: pd.Series, value: str | None) -> pd.Series:
    if is_all(value):
        return pd.Series(True, index=series.index)
    return series.str.lower() == value.strip().lower()


def scope_rows(data: CustomerData, scope: Scope) -> pd.DataFrame:
    rows = data.rows
    mask = _match(rows["vehicle"], scope.vehicle) & _match(rows["market"], scope.market)
    mask &= _match(rows["powertrain"], scope.powertrain)
    return rows[mask]


def resolve_themes(data: CustomerData, topic: str | None) -> list[str]:
    """A theme name, a frontend Topic (all themes mapped to it), or a keyword."""
    if not topic:
        return []
    themes = data.rows[["theme", "topic"]].drop_duplicates()
    exact = themes[themes["theme"].str.lower() == topic.lower()]
    if len(exact):
        return exact["theme"].tolist()
    by_topic = themes[themes["topic"].str.lower() == topic.lower()]
    if len(by_topic):
        return sorted(by_topic["theme"].unique())
    needle = topic.lower()
    rows = data.rows
    hit = rows[rows["theme"].str.lower().str.contains(needle, regex=False)
               | rows["category_l2"].str.lower().str.contains(needle, regex=False)]
    return sorted(hit["theme"].unique())


def record_polarity(record_rows: pd.DataFrame) -> str:
    present = set(record_rows["polarity"])
    return next(p for p in POLARITY_ORDER if p in present or p == UNCLASSIFIED)


def to_evidence(data: CustomerData, record_rows: pd.DataFrame) -> Evidence:
    """Build an Evidence item for one record from (a subset of) its classification rows."""
    first = record_rows.iloc[0]
    all_rows = data.rows[data.rows["record_id"] == first["record_id"]]
    themes = record_rows["theme"].tolist()
    theme = max(set(themes), key=themes.count)
    topic = record_rows[record_rows["theme"] == theme]["topic"].iloc[0] or None
    excel_rows = ", ".join(str(r) for r in sorted(all_rows["excel_row"].tolist()))
    channel = f" · {first['channel']}" if first["channel"] else ""
    return Evidence(
        id=first["record_id"],
        source=f"{first['file']}{channel}",
        location=f"{first['file']} rows {excel_rows} · feedback ID {first['raw_id']} "
        f"· 1 unique record, {len(all_rows)} classification row(s)",
        publishedAt=first["date"] or "unknown",
        vehicle=first["vehicle"],
        market=first["market"],
        country=first["country"],
        powertrain=first["powertrain"],
        category=topic or theme,
        theme=theme,
        topic=topic,
        subcategories=sorted({c for c in record_rows["category_l2"] if c}),
        type=record_polarity(record_rows),
        feedbackTypes=sorted({t for t in all_rows["feedback_type"] if t}),
        passage=first["text"],
        classificationRows=len(all_rows),
        channel=first["channel"],
        severity=first["severity"] or None,
    )


def search(
    data: CustomerData,
    scope: Scope,
    theme: str | None = None,
    polarity: str | None = None,
    query: str | None = None,
    limit: int = 50,
) -> list[Evidence]:
    rows = scope_rows(data, scope)
    if theme:
        rows = rows[rows["theme"].isin(resolve_themes(data, theme))]
    if polarity:
        rows = rows[rows["polarity"].str.lower() == polarity.lower()]
    if rows.empty:
        return []
    ranked = rank_records(rows, query)
    if query and not len(ranked):
        return []
    out = []
    for record_id in ranked[:limit]:
        out.append(to_evidence(data, rows[rows["record_id"] == record_id]))
    return out


def rank_records(rows: pd.DataFrame, query: str | None) -> list[str]:
    records = rows.drop_duplicates("record_id")[["record_id", "text"]]
    if query:
        tokens = [t for t in re.findall(r"\w+", query.lower()) if len(t) > 1]
        lower = records["text"].str.lower()
        score = sum(lower.str.count(re.escape(t)) for t in tokens) if tokens else 0
        records = records.assign(score=score)
        records = records[records["score"] > 0].sort_values(["score", "record_id"], ascending=[False, True])
    else:
        # Prefer informative passages: moderate length first, stable by ID.
        length = records["text"].str.len()
        records = records.assign(informative=((length >= 40) & (length <= 700)).astype(int))
        records = records.sort_values(["informative", "record_id"], ascending=[False, True])
    return records["record_id"].tolist()


def representative(
    rows: pd.DataFrame, theme: str, polarity: str | None, k: int = 8
) -> list[str]:
    """Pick up to k record IDs for a theme, round-robin across subcategories for variety."""
    subset = rows[rows["theme"] == theme]
    if polarity:
        subset = subset[subset["polarity"] == polarity]
    subset = subset[subset["text"].str.len().between(30, 900)]
    if subset.empty:
        return []
    order = subset.groupby("category_l2")["record_id"].nunique().sort_values(ascending=False).index
    buckets = {
        # Stable pseudo-random order (crc32) spreads picks across the file reproducibly.
        c: sorted(subset[subset["category_l2"] == c]["record_id"].unique(),
                  key=lambda r: zlib.crc32(r.encode()))
        for c in order
    }
    picked: list[str] = []
    while len(picked) < k and any(buckets.values()):
        for c in order:
            if buckets[c] and len(picked) < k:
                rid = buckets[c].pop(0)
                if rid not in picked:
                    picked.append(rid)
    return picked
