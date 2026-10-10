"""Add reviewed specialist sources before an agenda freezes its source snapshot."""
from __future__ import annotations

import hashlib
import json
from datetime import date

from backend.config import Settings
from backend.market.catalog import load_catalog as load_market, source_checks
from backend.schemas.evidence import EvidenceRecord
from backend.tools.retrieval import EvidenceRepository

from .models import Catalog, Evidence, Source
from .sources import topics_for


def specialist_catalog(base: Catalog, settings: Settings | None = None) -> Catalog:
    settings = settings or Settings.from_env()
    records: dict[str, EvidenceRecord] = {}
    warnings = list(base.warnings)
    try:
        for raw in load_market()["records"]:
            record = EvidenceRecord.model_validate(raw)
            # Study/volume inputs already occur in the supplied moderator extraction.
            if record.source_type not in {"industry_signal", "market_metric"}:
                continue
            if record.source_type == "industry_signal" and not EvidenceRepository.is_current(record):
                continue
            if record.published_on and record.published_on > date.today():
                continue
            if source_checks().get(record.id, {}).get("status") == "needs_review":
                continue
            records[record.id] = record
    except (OSError, ValueError, KeyError):
        warnings.append("Reviewed Market index unavailable; supplied BMW evidence remains available.")
    try:
        for record in EvidenceRepository.load(settings.evidence_index).records.values():
            if record.source_type == "competitor_official" and EvidenceRepository.is_current(record):
                if not record.published_on or record.published_on <= date.today():
                    records[record.id] = record
    except (OSError, ValueError, RuntimeError):
        warnings.append("Reviewed Competitor index unavailable; competitor applicability remains unknown.")
    sources = list(base.sources)
    evidence = list(base.evidence)
    existing = {e.id for e in evidence}
    for record in records.values():
        eid = f"specialist:{record.id}"
        if eid in existing:
            continue
        domain = "competitor" if record.source_type == "competitor_official" else "market"
        digest = hashlib.sha256(record.model_dump_json().encode()).hexdigest()
        sid = f"specialist-source:{record.id}"
        limitations = list(record.caveats)
        limitations.append("Reviewed source content is not proof of feature demand, causal sales impact or selected BMW trim fitment.")
        source = Source(
            id=sid, name=record.source_title, sha256=digest, domain=domain,
            source_url=record.source_uri if record.source_uri.startswith("https://") else None,
            provenance="external" if record.source_uri.startswith("https://") else "supplied",
            retrieved_at=record.retrieved_at.isoformat(), publisher=record.brand,
            quality="primary", edition=str(record.published_on) if record.published_on else None,
            coverage={"reviewed_on": str(record.verified_on), "review_due_on": str(record.review_due_on),
                      "model": record.model, "market": record.market, "source_type": record.source_type},
            limitations=limitations,
        )
        # A competitor model is not a BMW vehicle scope restriction. Its exact model
        # stays in passage/source metadata; Global means cross-market context only.
        vehicle = record.model if record.brand == "BMW" and record.model in {"F70", "G60", "G68", "G70", "G60_G68"} else None
        regions = {"Global": None, "EU": "EU"}
        passage = record.passage
        if record.source_type == "competitor_official":
            passage = f"{record.brand} {record.model} ({record.market}): {passage}"
        evidence.append(Evidence(
            id=eid, source_id=sid, domain=domain, location=record.locator,
            passage=passage, vehicle=vehicle,
            region=regions.get(record.market, record.market),
            powertrain=record.powertrain, published_at=str(record.published_on) if record.published_on else None,
            kind="external_context", context_type="unknown",
            topics=topics_for(" ".join([passage, *record.categories])), limitations=limitations,
        ))
        sources.append(source)
        existing.add(eid)
    # Content address both extraction and review metadata: a later review creates
    # a new snapshot and never mutates an already confirmed session.
    digest = hashlib.sha256(json.dumps({
        "sources": [s.model_dump(exclude={"retrieved_at"}) for s in sources],
        "evidence": [e.model_dump() for e in evidence],
    }, sort_keys=True).encode()).hexdigest()
    return Catalog(snapshot_hash=digest, sources=sources, evidence=evidence,
                   warnings=list(dict.fromkeys(warnings)))
