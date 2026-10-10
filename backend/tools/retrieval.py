"""Scoped lexical retrieval over local evidence; no model-selected paths or URLs."""
import json
from datetime import date
from pathlib import Path
import re
from backend.schemas.common import Scope
from backend.schemas.evidence import EvidenceRecord

ALIASES = {
    "display": "screen touchscreen infotainment bildschirm entertainment cockpit",
    "displays": "display screen touchscreen infotainment bildschirm entertainment cockpit",
    "comfort": "seat ride noise quiet komfort sitz",
    "charging": "charge battery range lade laden reichweite",
    "assistance": "assist parking lane driving park assistenz",
}
STOP_WORDS = {"the", "and", "for", "with", "that", "this", "from", "bmw", "have", "has", "are", "can"}

class EvidenceUnavailableError(RuntimeError):
    pass

class EvidenceRepository:
    def __init__(self, records: list[EvidenceRecord]):
        self.records = {record.id: record for record in records}
        if len(self.records) != len(records):
            raise ValueError("Duplicate evidence IDs")
        self.tokens = {r.id: set(re.findall(r"\w+", " ".join([r.passage, r.brand, r.model, *r.categories]).lower())) for r in records}

    @classmethod
    def load(cls, path: Path) -> "EvidenceRepository":
        if not path.is_file():
            raise EvidenceUnavailableError("Build the evidence index first: python -m backend.ingest --data-dir <BMW-Data path>")
        try:
            payload = json.loads(path.read_text())
            if payload["version"] != 1:
                raise ValueError("Unknown index version")
            return cls([EvidenceRecord.model_validate(item) for item in payload["records"]])
        except (ValueError, KeyError, TypeError) as exc:
            raise EvidenceUnavailableError("Evidence index is invalid; rebuild it.") from exc

    @staticmethod
    def is_current(record: EvidenceRecord, on: date | None = None) -> bool:
        today = on or date.today()
        return (record.reference_status == "current_reference"
                and record.verified_on is not None and record.review_due_on is not None
                and record.verified_on <= today <= record.review_due_on)

    @staticmethod
    def in_scope(record: EvidenceRecord, scope: Scope) -> bool:
        return (record.market == scope.market
                and (record.brand != "BMW" or record.model == scope.vehicle)
                and (record.powertrain is None or record.powertrain == scope.powertrain))

    def read(self, evidence_id: str, scope: Scope) -> EvidenceRecord:
        record = self.records.get(evidence_id)
        if record is None or not self.in_scope(record, scope):
            raise ValueError("Unknown or out-of-scope evidence ID")
        return record

    def search(self, query: str, scope: Scope, source_type: str = "all", limit: int = 4) -> list[EvidenceRecord]:
        words = set(re.findall(r"\w+", query.lower())) - STOP_WORDS
        for word in list(words):
            words.update(ALIASES.get(word, "").split())
        scored = []
        for record in self.records.values():
            if record.source_type == "competitor_official" and not self.is_current(record):
                continue
            if not self.in_scope(record, scope) or (source_type != "all" and record.source_type != source_type):
                continue
            score = len(words & self.tokens[record.id])
            if score:
                scored.append((score, record.id, record))
        ranked = [row[2] for row in sorted(scored, key=lambda row: (-row[0], row[1]))]
        if source_type == "competitor_official":
            # Preserve relevance within each brand, while preventing one brand's
            # many short records from crowding every other competitor out.
            selected = []
            brands = set()
            for record in ranked:
                if record.brand not in brands:
                    selected.append(record)
                    brands.add(record.brand)
            selected_ids = {record.id for record in selected}
            ranked = selected + [record for record in ranked if record.id not in selected_ids]
        return ranked[:limit]
