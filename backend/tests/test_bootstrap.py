"""First-run index setup must preserve existing evidence snapshots and review dates."""
import json
from dataclasses import replace
from unittest.mock import Mock

import pytest

from backend import bootstrap
from backend.config import Settings


def source():
    return {"id": "official-1", "source_type": "competitor_official", "source_title": "Official source",
            "source_uri": "https://example.com/official", "locator": "release", "passage": "A documented feature.",
            "retrieved_at": "2026-10-01T12:00:00Z", "brand": "Example", "model": "Example", "market": "Europe",
            "reference_status": "current_reference", "verified_on": "2026-10-01", "review_due_on": "2026-10-31"}


def prepare(tmp_path, monkeypatch):
    data = tmp_path / "BMW-Data"
    data.mkdir()
    for filename in bootstrap.INPUTS:
        (data / filename).touch()
    evidence = tmp_path / "evidence.json"
    market = tmp_path / "market.json"
    monkeypatch.setenv("MARKET_INDEX", str(market))
    settings = replace(Settings.from_env(), data_dir=tmp_path, evidence_index=evidence)
    return settings, evidence, market


def test_setup_retains_existing_indexes_byte_for_byte(tmp_path, monkeypatch):
    settings, evidence, market = prepare(tmp_path, monkeypatch)
    payload = json.dumps({"version": 1, "records": [source()]})
    for path in (evidence, market):path.write_text(payload)
    previous = {path: path.stat().st_mtime_ns for path in (evidence, market)}
    builder = Mock(side_effect=AssertionError("Existing indexes must not be rewritten"))
    monkeypatch.setattr(bootstrap, "build_index", builder)
    monkeypatch.setattr(bootstrap, "build_market_index", builder)
    report = bootstrap.ensure_indexes(settings)
    assert all(value["action"] == "kept" for value in report.values())
    for path in (evidence, market):
        assert path.read_text() == payload
        assert path.stat().st_mtime_ns == previous[path]


def test_missing_index_build_does_not_renew_verification_dates(tmp_path, monkeypatch):
    settings, evidence, market = prepare(tmp_path, monkeypatch)
    payload = json.dumps({"version": 1, "records": [source()]})
    market.write_text(payload)
    built = []
    def build(directory, output, catalog):
        built.append(output)
        output.write_text(payload)
    monkeypatch.setattr(bootstrap, "build_index", build)
    report = bootstrap.ensure_indexes(settings)
    assert built == [evidence]
    assert report["competitor"]["action"] == "built" and report["market"]["action"] == "kept"
    assert json.loads(evidence.read_text())["records"][0]["verified_on"] == "2026-10-01"


def test_missing_inputs_fail_before_building_indexes(tmp_path, monkeypatch):
    settings, evidence, market = prepare(tmp_path, monkeypatch)
    (tmp_path / "BMW-Data" / "sales_volumes.xlsx").unlink()
    with pytest.raises(FileNotFoundError, match="sales_volumes.xlsx"):
        bootstrap.ensure_indexes(settings)
    assert not evidence.exists() and not market.exists()
