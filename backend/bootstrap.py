"""Build missing private indexes from supplied local data; never fetch or reverify sources."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from backend.config import ROOT, Settings
from backend.ingest import build_index
from backend.market.ingest import build as build_market_index
from backend.schemas.evidence import EvidenceRecord

INPUTS = [
    *(f"{model}_feedback_hackathon.xlsx" for model in ("F70", "G60", "G70")),
    *(f"{model}_OptionList.PDF" for model in ("F70", "G60", "G70")),
    "sales_volumes.xlsx", "F70_G60_G68_G70_customer_studies.xlsx", "BMW-Group-Report-2025-en.pdf",
]


def resolve_path(path: Path) -> Path:
    path = path.expanduser()
    return path if path.is_absolute() else ROOT / path


def input_directory(settings: Settings) -> Path:
    directory = resolve_path(settings.data_dir)
    return directory / "BMW-Data" if (directory / "BMW-Data").is_dir() else directory


def validate_index(path: Path) -> int:
    data = json.loads(path.read_text())
    if data.get("version") != 1:
        raise ValueError(f"Unsupported index version: {path}")
    records = [EvidenceRecord.model_validate(record) for record in data["records"]]
    if not records or len({record.id for record in records}) != len(records):
        raise ValueError(f"Empty index or duplicate evidence IDs: {path}")
    return len(records)


def ensure_indexes(settings: Settings | None = None, *, force: bool = False) -> dict:
    settings = settings or Settings.from_env()
    directory = input_directory(settings)
    missing = [filename for filename in INPUTS if not (directory / filename).is_file()
               and not (filename == "BMW-Group-Report-2025-en.pdf" and (directory.parent / filename).is_file())]
    if missing:
        raise FileNotFoundError(
            f"BMW inputs are incomplete at {directory}. Set BMW_DATA_DIR in backend/.env "
            "to the supplied BMW-Data directory (or its parent). Missing: " + ", ".join(missing)
        )
    paths = {
        "competitor": resolve_path(settings.evidence_index),
        "market": resolve_path(Path(os.getenv("MARKET_INDEX", "backend/data/market.json"))),
    }
    report = {}
    for kind, path in paths.items():
        created = force or not path.exists()
        if created:
            if kind == "competitor":
                build_index(directory, path, ROOT / "backend/evidence/competitors.json")
            else:
                build_market_index(directory, path)
        try:
            count = validate_index(path)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise ValueError(f"Invalid {kind} index. Rebuild explicitly with python -m backend.bootstrap --force: {exc}") from exc
        report[kind] = {"path": str(path), "records": count, "action": "built" if created else "kept"}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Rebuild existing indexes after a deliberate data/catalog change")
    args = parser.parse_args()
    try:
        report = ensure_indexes(force=args.force)
    except (OSError, ValueError, KeyError) as exc:
        parser.exit(1, f"Backend setup: {exc}\n")
    for kind, item in report.items():
        print(f"{kind.title()} index {item['action']}: {item['records']} records ({item['path']})")
    print("Local inputs and reviewed catalogs only; external verification dates remain unchanged.")


if __name__ == "__main__":
    main()
