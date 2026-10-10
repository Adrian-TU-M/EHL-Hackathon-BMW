from pathlib import Path

import pytest

from moderator.agenda import prepare, rank, scores
from moderator.models import Calculation, Claim, Rating, Scope
from moderator.sources import applicable, load_catalog, topics_for
from moderator.validation import semantic_result, validate_claim


def test_agenda_observation_dedup_positive_and_unclassified(catalog, scope):
    a = prepare(catalog, scope)
    climate = next(t for t in a.topics if t.id == "topic-climate")
    assert climate.observation_count == 2  # rows 2+3 are one observation
    assert climate.denominator == 3
    assert "f2" in climate.counterevidence_ids
    assert any(t.id == "topic-app" and "f3" in t.evidence_ids for t in a.topics)
    assert not any("foreign" in t.evidence_ids for t in a.topics)
    assert not any("g68" in t.evidence_ids for t in a.topics)
    assert "s2030" in climate.evidence_ids  # context retains actual/forecast labels


def test_score_interval_does_not_renormalize():
    rs = {
        k: Rating(
            value=5 if k == "need" else None,
            evidence_ids=["f1"] if k == "need" else [],
            rationale="test",
        )
        for k in ["need", "severity", "future", "gap"]
    }
    assert scores(rs) == (40, 100, 40)
    with pytest.raises(ValueError):
        Rating(value=3, rationale="unsupported")


def test_stable_rank_and_pins(catalog, scope):
    topics = prepare(catalog, scope).topics
    assert [t.id for t in rank(topics)] == [t.id for t in rank(list(reversed(topics)))]
    topics[-1].pinned = True
    assert rank(topics)[0].id == topics[-1].id


@pytest.mark.parametrize(
    "text,key",
    [
        ("my BMW app fails", "app"),
        ("keys don't unlock", "access"),
        ("boot space", "luggage"),
        ("climate control", "climate"),
        ("rattle noise", "noise"),
        ("charging", "charging"),
        ("battery range", "range"),
    ],
)
def test_topic_extraction(text, key):
    assert key in topics_for(text)


def test_scope_and_german_equipment(catalog, scope):
    by = {e.id: e for e in catalog.evidence}
    assert not applicable(
        by["g68"], Scope(vehicle="G60", market="China", powertrain="Electric"), True
    )
    assert applicable(by["s2025"], scope, True)
    assert not applicable(by["s2025"], scope, False)
    assert not applicable(by["equipment"], scope, True)
    eu = scope.model_copy(update={"market": "Europe"})
    assert applicable(by["equipment"], eu, True)
    assert not applicable(by["equipment"], eu, False)


@pytest.mark.parametrize(
    "eid,kind,issue",
    [
        ("made-up", "observation", "Unknown"),
        ("foreign", "observation", "Scope"),
        ("s2030", "observation", "Future"),
        ("us-study", "observation", None),
    ],
)
def test_claim_scope_and_forecast(catalog, scope, eid, kind, issue):
    by = {e.id: e for e in catalog.evidence}
    c = Claim(
        id="c",
        actor="customer",
        statement="A test assertion",
        kind=kind,
        evidence_ids=[eid],
    )
    validate_claim(c, by, scope, set(by) | {eid}, set())
    if issue:
        assert c.validation == "unsupported" and any(issue in i for i in c.issues)
    else:
        assert c.validation == "unverified"  # citation is not entailment
        semantic_result(c, set(), {"c": "Unsupported sample size"})
        assert c.validation == "unsupported"


def test_excluded_evidence_and_denominators(catalog, scope):
    by = {e.id: e for e in catalog.evidence}
    by["f1"].excluded_reason = "PM excluded"
    c = Claim(
        id="c",
        actor="customer",
        statement="test",
        kind="observation",
        evidence_ids=["f1"],
    )
    assert validate_claim(c, by, scope, set(by), set()).validation == "unsupported"
    c = Claim(
        id="c2",
        actor="customer",
        statement="One respondent",
        kind="inference",
        evidence_ids=["us-study"],
        calculation=Calculation(
            operation="share",
            values=[1],
            result=1,
            unit="normalized column",
            denominator=1,
            evidence_ids=["us-study"],
            method="test",
            period="2025",
        ),
    )
    validate_claim(c, by, scope, set(by), set())
    assert any("sample counts" in i for i in c.issues)
    assert any("denominator" in i for i in c.issues)


def test_deterministic_calculation(catalog, scope):
    by = {e.id: e for e in catalog.evidence}
    c = Claim(
        id="growth",
        actor="market",
        statement="Grouped growth",
        kind="inference",
        evidence_ids=["s2024", "s2025"],
        calculation=Calculation(
            operation="growth",
            values=[100, 110],
            result=0.1,
            unit="vehicles",
            evidence_ids=["s2024", "s2025"],
            method="(new-old)/old",
            period="2024–2025",
        ),
    )
    assert validate_claim(c, by, scope, set(by), set()).validation == "unverified"
    c.calculation.result = 0.2
    assert validate_claim(c, by, scope, set(by), set()).validation == "unsupported"


def test_private_supplied_collection_counts_and_lineage():
    root = Path(__file__).resolve().parents[2] / "private-data"
    if not (root / "inputs/F70_feedback_hackathon.xlsx").exists():
        pytest.skip("Private supplied collection is not in this checkout")
    c = load_catalog(root / "inputs", root / "catalogs")
    for v, expected in {
        "F70": (4076, 2128),
        "G60": (5005, 4000),
        "G70": (4690, 4000),
    }.items():
        source = next(s for s in c.sources if s.id == f"{v}_feedback")
        assert (
            source.coverage["classification_rows"],
            source.coverage["distinct_feedback_ids"],
        ) == expected
        records = [e for e in c.evidence if e.source_id == source.id]
        assert sum(len(e.classification_rows) for e in records) == expected[0]
        assert all(e.country != "CN" for e in records)
    studies = [e for e in c.evidence if e.kind == "study_distribution"]
    assert len(studies) == 206
    assert all(
        e.quantitative["n"] is None
        and abs(sum(e.quantitative["distribution"].values()) - 1) < 1e-6
        for e in studies
    )
    assert all(
        e.quantitative["n"] is None for e in c.evidence if e.kind == "study_mean"
    )
    assert (
        next(e for e in c.evidence if e.id == "sales:F70:C3").quantitative["formula"]
        == "-D3-C10"
        or next(e for e in c.evidence if e.id == "sales:F70:C3").quantitative["formula"]
        == "=-D3-C10"
    )
    assert all(
        e.vehicle == "G60_G68"
        for e in c.evidence
        if e.source_id == "sales" and "G60_G68" in e.id
    )
    assert len(c.sources) == 9 and all(len(s.sha256) == 64 for s in c.sources)
    report = next(e for e in c.evidence if e.id == "annual-report:p79")
    assert "Series" in report.passage and "Grouped model families" in " ".join(
        report.limitations
    )
