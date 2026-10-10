from customer_agent.retrieval import resolve_themes, search
from customer_agent.schemas import Scope
from customer_agent.stats import coverage, study_refs, theme_stats

EU_EV = Scope(vehicle="X10", market="Europe", powertrain="Electric")


def test_theme_claims_expose_denominator_filters_and_limits(data_dir, load, maps):
    data = load(data_dir)
    stats = theme_stats(data, maps, EU_EV)
    assert stats
    for s in stats:
        for c in (s.shareOfRecords, s.complaintShare):
            assert 0 <= c.numerator <= c.denominator
            assert c.denominator == 4               # 4 unique EU electric records
            assert "powertrain=Electric" in c.filters
            assert "not of all customers" in c.limitations
            assert "unique customers cannot be counted" in c.limitations
            assert c.period.startswith("unknown")


def test_records_not_rows_are_counted(data_dir, load, maps):
    data = load(data_dir)
    info = next(s for s in theme_stats(data, maps, EU_EV) if s.theme == "Infotainment & connectivity")
    # X10-0001 has two infotainment rows (complaint + request) but is one record.
    assert info.classificationRows == 3
    assert info.records == 2
    assert info.complaints == 2 and info.requests == 1


def test_coverage_for_market_without_feedback(data_dir, load):
    cov = coverage(load(data_dir), Scope(vehicle="G68", market="China"))
    assert cov.uniqueRecords == 0
    assert cov.studies, "China study means should still be available"
    assert any("studies only" in w for w in cov.warnings)


def test_china_feedback_is_analysable_when_present(data_dir, load):
    cov = coverage(load(data_dir), Scope(vehicle="X10", market="China"))
    assert cov.uniqueRecords == 1


def test_study_refs_compare_against_peers(data_dir, load, maps):
    data = load(data_dir)
    refs = study_refs(data, maps, Scope(vehicle="X10", market="Europe"), "Seats & comfort")
    assert refs and refs[0].comparison and "G60" in refs[0].comparison
    assert "Sample size not supplied" in refs[0].quantitative.limitations


def test_search_and_theme_resolution(data_dir, load):
    data = load(data_dir)
    assert resolve_themes(data, "Displays") == ["Infotainment & connectivity"]   # frontend Topic
    assert resolve_themes(data, "Charging & range") == ["Charging & range"]       # theme name
    hits = search(data, Scope(vehicle="X10", market="Europe"), query="carplay")
    assert [e.id for e in hits] == ["X10-0008"]
    ev = search(data, Scope(vehicle="X10", market="Europe"), theme="Displays", polarity="Complaint")
    assert {e.id for e in ev} == {"X10-0001", "X10-0008"}
    assert all(e.provenance == "bmw-supplied" and e.domain == "customer" for e in ev)
