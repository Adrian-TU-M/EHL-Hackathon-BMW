"""Deterministic ingestion of customer sources into tidy frames.

Feedback: one row per classification (``rows``) and one row per unique feedback
record (``records``). A comment repeated across classification rows under the same ID
is one record, never several independent observations (spec §3).

Studies: tidy rows ``(study_id, source, market, vehicle, attribute, metric, value, ...)``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from .manifest import DiscoveredFile, Discovery, discover, load_manifest, read_table
from .mappings import Mappings, _clean

ROW_COLUMNS = [
    "record_id", "raw_id", "text", "country", "market", "vehicle", "powertrain",
    "powertrain_raw", "feedback_type", "polarity", "category_l2", "category_l3",
    "theme", "topic", "channel", "customer_id", "date", "file", "excel_row", "dataset", "severity",
]


@dataclass
class CustomerData:
    rows: pd.DataFrame
    records: pd.DataFrame
    studies: pd.DataFrame
    discovery: Discovery
    sources: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def has_customer_ids(self) -> bool:
        return bool(self.rows["customer_id"].astype(bool).any()) if len(self.rows) else False

    @property
    def has_dates(self) -> bool:
        return bool(self.rows["date"].astype(bool).any()) if len(self.rows) else False


def _col(frame: pd.DataFrame, columns: dict[str, str], key: str) -> pd.Series:
    header = columns.get(key)
    if header and header in frame.columns:
        return frame[header].map(_clean)
    return pd.Series([""] * len(frame), index=frame.index, dtype=object)


def load_feedback(item: DiscoveredFile, maps: Mappings) -> pd.DataFrame:
    frame = read_table(item.path, item.spec.options.get("sheet", 0) or 0)
    cols = item.spec.columns
    missing = [k for k in ("id", "text") if cols.get(k) not in frame.columns]
    if missing:
        raise ValueError(f"{item.path.name}: mapped columns not found for {missing}")
    out = pd.DataFrame(index=frame.index)
    out["raw_id"] = _col(frame, cols, "id")
    out["text"] = _col(frame, cols, "text")
    out["country"] = _col(frame, cols, "country")
    out["market"] = out["country"].map(maps.market)
    out["vehicle"] = _col(frame, cols, "vehicle").map(lambda v: maps.vehicle(v) if v else "Unknown")
    out["powertrain_raw"] = _col(frame, cols, "powertrain")
    out["powertrain"] = out["powertrain_raw"].map(maps.powertrain)
    out["feedback_type"] = _col(frame, cols, "feedback_type")
    out["polarity"] = out["feedback_type"].map(maps.polarity)
    out["category_l2"] = _col(frame, cols, "category_l2")
    out["category_l3"] = _col(frame, cols, "category_l3")
    themes = out["category_l2"].map(maps.theme)
    out["theme"] = themes.map(lambda t: t[0])
    out["topic"] = themes.map(lambda t: t[1] or "")  # "" = no frontend Topic fits
    out["channel"] = _col(frame, cols, "source")
    out["customer_id"] = _col(frame, cols, "customer_id")
    out["date"] = _col(frame, cols, "date")
    out["file"] = item.path.name
    out["excel_row"] = frame.index + 2  # 1-based row number in the sheet, after the header
    out["dataset"] = item.spec.name
    out["severity"] = ""
    for field, rule in (item.spec.options.get("derived") or {}).items():
        if field == "severity":
            pattern = re.compile(rule["pattern"], re.IGNORECASE)
            out["severity"] = out["text"].map(
                lambda t: (m.group(1).lower() if (m := pattern.search(t)) else ""))
    out = out[out["raw_id"] != ""]
    out["record_id"] = out["raw_id"]
    return out[ROW_COLUMNS]


def build_records(rows: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """One row per unique feedback record; classifications aggregated."""
    warnings: list[str] = []
    if rows.empty:
        return pd.DataFrame(columns=ROW_COLUMNS + ["classification_rows", "themes", "polarities"]), warnings
    conflicts = rows.groupby("record_id")["text"].nunique()
    n_conflicts = int((conflicts > 1).sum())
    if n_conflicts:
        warnings.append(
            f"{n_conflicts} feedback IDs carry different texts across rows; the first text is used."
        )
    grouped = rows.groupby("record_id", sort=False)
    records = grouped.first()
    records["classification_rows"] = grouped.size()
    records["themes"] = grouped["theme"].agg(lambda s: sorted(set(s)))
    records["polarities"] = grouped["polarity"].agg(lambda s: sorted(set(s)))
    return records.reset_index(), warnings


def _year(sheet: str) -> str:
    match = re.search(r"(19|20)\d{2}", sheet)
    return match.group(0) if match else "unknown"


def parse_study_means(item: DiscoveredFile, maps: Mappings) -> list[dict]:
    """Layout: a row of country labels (forward-filled across columns), a row of model
    labels, then alternating attribute-label rows and `Mean` value rows."""
    frame = pd.read_excel(item.path, sheet_name=item.sheet, header=None, dtype=object)
    marker = item.spec.options.get("match_header", "Mean")
    label = frame.iloc[:, 0].map(_clean)
    # Model header row: the row (before the first marker row) with the most text cells.
    first_marker = next((i for i in range(len(frame)) if label.iat[i] == marker), len(frame))

    def text_cells(i: int) -> int:
        return sum(bool(isinstance(v, str) and _clean(v)) for v in frame.iloc[i, 1:])

    model_row = max(range(first_marker), key=lambda i: (text_cells(i), i))
    # Country row: closest row above the model row with any text in the data columns.
    country_by_col: dict[int, str] = {}
    for i in range(model_row - 1, -1, -1):
        cells = [_clean(frame.iat[i, c]) for c in range(1, frame.shape[1])]
        if any(cells) and not any(c.lower() == "dataset country" for c in cells):
            current = ""
            for offset, cell in enumerate(cells, start=1):
                current = cell or current
                country_by_col[offset] = current
            break
    year = _year(str(item.sheet)) if item.spec.options.get("year_from_sheet") else "unknown"
    out = []
    attribute = label.iat[model_row]
    for i in range(model_row + 1, len(frame)):
        if label.iat[i] == marker:
            for c in range(1, frame.shape[1]):
                value = frame.iat[i, c]
                model = _clean(frame.iat[model_row, c])
                if model == "" or pd.isna(value):
                    continue
                country = country_by_col.get(c, "")
                out.append({
                    "source": item.path.name, "sheet": str(item.sheet), "dataset": item.spec.name,
                    "kind": "study_means", "market": maps.market(country), "country_label": country,
                    "vehicle": maps.vehicle(model), "model_label": model, "attribute": attribute,
                    "metric": "mean", "value": float(value), "distribution": None,
                    "year": year, "sample_size": None, "row": i + 1, "bottom_box": None,
                    "levels_note": "mean score as supplied (0-10 scale)",
                })
        elif label.iat[i]:
            attribute = label.iat[i]
    return out


def parse_study_distribution(item: DiscoveredFile, maps: Mappings) -> list[dict]:
    """Layout: question-title rows (empty marker column) followed by level rows whose
    second column holds the marker (e.g. '% of column, sample base')."""
    frame = pd.read_excel(item.path, sheet_name=item.sheet, header=None, dtype=object)
    marker = item.spec.options.get("match_header")
    top = {lvl.lower() for lvl in item.spec.options.get("positive_levels", [])}
    bottom = {lvl.lower() for lvl in item.spec.options.get("negative_levels", [])}
    sheet = str(item.sheet)
    market_label = sheet.split("_")[0] if item.spec.options.get("market_from_sheet") else ""
    year = _year(sheet) if item.spec.options.get("year_from_sheet") else "unknown"
    models = {c: _clean(frame.iat[0, c]) for c in range(2, frame.shape[1]) if _clean(frame.iat[0, c])}
    blocks: list[tuple[str, int, dict[str, dict[str, float]]]] = []
    question, q_row, dist = None, 0, {}
    for i in range(len(frame)):
        first, second = _clean(frame.iat[i, 0]), _clean(frame.iat[i, 1])
        if first and second != marker:
            if question:
                blocks.append((question, q_row, dist))
            question, q_row, dist = first, i + 1, {}
        elif second == marker and question and first.lower() != "sample total":
            for c, model in models.items():
                value = frame.iat[i, c]
                if not pd.isna(value):
                    dist.setdefault(model, {})[first] = float(value)
    if question:
        blocks.append((question, q_row, dist))
    out = []
    for question, q_row, dist in blocks:
        for model, levels in dist.items():
            top_box = sum(v for k, v in levels.items() if k.lower() in top) if top else None
            bottom_box = sum(v for k, v in levels.items() if k.lower() in bottom) if bottom else None
            out.append({
                "source": item.path.name, "sheet": sheet, "dataset": item.spec.name,
                "kind": "study_distribution", "market": maps.market(market_label),
                "country_label": market_label, "vehicle": maps.vehicle(model), "model_label": model,
                "attribute": question, "metric": "top_box_share", "value": top_box,
                "distribution": levels, "year": year, "sample_size": None, "row": q_row,
                "bottom_box": bottom_box,
                "levels_note": f"top box = {' + '.join(item.spec.options.get('positive_levels', []))}; "
                f"bottom box = {' + '.join(item.spec.options.get('negative_levels', []))}",
            })
    return out


def load_customer_data(data_dir: Path, manifest_path: Path, mappings_dir: Path) -> CustomerData:
    maps = Mappings(mappings_dir)
    discovery = discover(data_dir, load_manifest(manifest_path))
    feedback_frames, study_rows, sources, warnings = [], [], [], list(discovery.problems)
    for item in discovery.files:
        try:
            if item.spec.kind == "feedback":
                frame = load_feedback(item, maps)
                feedback_frames.append(frame)
                sources.append({"file": item.path.name, "kind": "feedback", "dataset": item.spec.name,
                                "rows": len(frame), "auto_detected": bool(item.spec.options.get("auto_detected"))})
            else:
                parser = parse_study_means if item.spec.kind == "study_means" else parse_study_distribution
                parsed = parser(item, maps)
                study_rows.extend(parsed)
                sources.append({"file": item.path.name, "sheet": str(item.sheet), "kind": item.spec.kind,
                                "dataset": item.spec.name, "rows": len(parsed)})
        except Exception as exc:  # one bad file must not take down the agent
            warnings.append(f"{item.path.name}{'/' + str(item.sheet) if item.sheet else ''}: {exc}")
    rows = pd.concat(feedback_frames, ignore_index=True) if feedback_frames else pd.DataFrame(columns=ROW_COLUMNS)
    # Same raw ID in different files = different records; namespace them.
    if len(rows):
        files_per_id = rows.groupby("raw_id")["file"].nunique()
        clashing = set(files_per_id[files_per_id > 1].index)
        if clashing:
            mask = rows["raw_id"].isin(clashing)
            rows.loc[mask, "record_id"] = rows.loc[mask, "file"].map(lambda f: Path(f).stem) + ":" + rows.loc[mask, "raw_id"]
            warnings.append(f"{len(clashing)} feedback IDs occur in several files; they were namespaced by file.")
    records, record_warnings = build_records(rows)
    warnings.extend(record_warnings)
    unmapped = sorted({v for col in ("market", "powertrain") for v in rows.get(col, []) if str(v).startswith("Unmapped:")})
    if unmapped:
        warnings.append(f"Unmapped codes (add them to mappings/*.yaml): {', '.join(unmapped)}")
    studies = pd.DataFrame(study_rows)
    return CustomerData(rows, records, studies, discovery, sources, warnings)
