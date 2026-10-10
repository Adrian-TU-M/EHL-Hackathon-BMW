"""Dataset manifest: which files in the data directory are customer sources, and how to read them.

Only customer-domain kinds are accepted, so the Customer Agent cannot load sales,
option-list or competitor files even if they sit in the same directory (spec §4.6).
"""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd
import yaml

CUSTOMER_KINDS = {"feedback", "study_means", "study_distribution"}
DATA_SUFFIXES = {".xlsx", ".xls", ".csv"}

# Header aliases for feedback files that have no manifest entry.
FEEDBACK_ALIASES: dict[str, tuple[str, ...]] = {
    "id": ("id", "feedback id", "record id", "response id"),
    "text": ("customer feedback", "feedback", "comment", "verbatim", "text", "feedback text"),
    "country": ("country", "country code", "market code"),
    "vehicle": ("derivate (e-code)", "vehicle", "model code", "e-code", "model"),
    "powertrain": ("engine type", "powertrain", "drive type", "fuel type"),
    "feedback_type": ("feedback type", "type", "polarity"),
    "category_l2": ("vfc level2 name", "category", "topic", "category level 2"),
    "category_l3": ("vfc level3 name", "subcategory", "category level 3"),
    "source": ("source", "channel"),
    "customer_id": ("customer id", "customer_id", "respondent id", "vin hash"),
    "date": ("date", "feedback date", "created at", "created"),
}
REQUIRED_FEEDBACK = ("id", "text")


@dataclass
class SourceSpec:
    name: str
    kind: str
    glob: str
    columns: dict[str, str] = field(default_factory=dict)
    options: dict = field(default_factory=dict)


@dataclass
class DiscoveredFile:
    spec: SourceSpec
    path: Path
    sheet: str | int | None = None


@dataclass
class Discovery:
    files: list[DiscoveredFile]
    unmatched: list[str]
    problems: list[str]


def load_manifest(path: Path) -> list[SourceSpec]:
    raw = yaml.safe_load(path.read_text()) or {}
    specs = []
    for entry in raw.get("sources", []):
        kind = entry["kind"]
        if kind not in CUSTOMER_KINDS:
            raise ValueError(
                f"Source {entry.get('name')!r} has kind {kind!r}; the Customer Agent only "
                f"reads {sorted(CUSTOMER_KINDS)}."
            )
        options = {k: v for k, v in entry.items() if k not in {"name", "kind", "glob", "columns"}}
        specs.append(
            SourceSpec(entry["name"], kind, entry["glob"], entry.get("columns") or {}, options)
        )
    return specs


def read_table(path: Path, sheet: str | int | None = 0, header: int | None = 0) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path, header=header, dtype=str, keep_default_na=False)
    return pd.read_excel(path, sheet_name=sheet, header=header, dtype=object)


def detect_feedback_columns(headers: list[str]) -> dict[str, str] | None:
    """Map canonical fields to headers by alias. None if required fields are missing/ambiguous."""
    lookup: dict[str, list[str]] = {}
    for header in headers:
        lookup.setdefault(str(header).strip().lower(), []).append(str(header))
    mapping: dict[str, str] = {}
    for canonical, aliases in FEEDBACK_ALIASES.items():
        hits = [h for a in aliases for h in lookup.get(a, [])]
        if len(set(hits)) > 1 and canonical in REQUIRED_FEEDBACK:
            return None
        if hits:
            mapping[canonical] = hits[0]
    if not all(f in mapping for f in REQUIRED_FEEDBACK):
        return None
    return mapping


def _sheet_matches(path: Path, sheet: str, marker: str) -> bool:
    frame = pd.read_excel(path, sheet_name=sheet, header=None, nrows=12, dtype=object)
    return frame.astype(str).isin([marker]).any().any()


def _is_temp(path: Path) -> bool:
    """Office lock files ("~$Book.xlsx", created while a file is open in Excel) and hidden/
    resource-fork files (".x", "._x") are not data."""
    return path.name.startswith(("~$", "."))


def discover(data_dir: Path, specs: list[SourceSpec]) -> Discovery:
    files: list[DiscoveredFile] = []
    unmatched: list[str] = []
    problems: list[str] = []
    if not data_dir.is_dir():
        return Discovery([], [], [f"Data directory not found: {data_dir}"])
    for path in sorted(p for p in data_dir.iterdir() if p.suffix.lower() in DATA_SUFFIXES and not _is_temp(p)):
        matched = [s for s in specs if fnmatch.fnmatch(path.name, s.glob)]
        if not matched:
            # No manifest entry: accept as feedback only if headers are unambiguous.
            try:
                headers = list(read_table(path, header=0).columns)
            except Exception as exc:  # unreadable file is reported, not fatal
                problems.append(f"{path.name}: unreadable ({exc})")
                continue
            columns = detect_feedback_columns(headers)
            if columns:
                spec = SourceSpec(f"auto:{path.stem}", "feedback", path.name, columns,
                                  {"auto_detected": True})
                files.append(DiscoveredFile(spec, path, 0))
            else:
                unmatched.append(path.name)
            continue
        for spec in matched:
            if spec.kind == "feedback":
                files.append(DiscoveredFile(spec, path, spec.options.get("sheet", 0)))
                continue
            if path.suffix.lower() == ".csv":
                problems.append(f"{path.name}: study kinds need an Excel workbook")
                continue
            sheets = pd.ExcelFile(path).sheet_names
            pattern = spec.options.get("sheet", "*")
            marker = spec.options.get("match_header")
            for sheet in sheets:
                if fnmatch.fnmatch(sheet, pattern) and (
                    marker is None or _sheet_matches(path, sheet, marker)
                ):
                    files.append(DiscoveredFile(spec, path, sheet))
    return Discovery(files, unmatched, problems)
