from customer_agent.dashboard import build_dashboard, drilldown, feature_ranking, quotes
from customer_agent.schemas import DashboardFilters

from .conftest import fb, write_feedback

LEVELS = ["very minor", "minor", "serious", "very serious"]


def test_dashboard_counts_records_by_raw_type(data_dir, load, maps):
    db = build_dashboard(load(data_dir), maps, DashboardFilters(vehicle="X10", market="Europe"), LEVELS)
    assert db.records == 6 and db.rows == 8
    # X10-0001 is both Difficult to Use and Wants (and an unclassified row): counted once per type.
    assert db.byType == {"Likes": 3, "Defect": 1, "Difficult to Use": 2, "Wants": 1, "Unclassified": 1}
    assert db.kpis.improvement.numerator == 3 and db.kpis.likes.numerator == 3
    assert db.kpis.records.denominator == 6
    assert {r.type for r in db.rankings} == {"Likes", "Defect", "Difficult to Use", "Wants"}
    assert any("Small sample" in w for w in db.coverage.warnings)
    assert db.kpis.satisfaction and db.kpis.satisfaction.attribute == "Overall product satisfaction"


def test_filters_and_options(data_dir, load, maps):
    data = load(data_dir)
    db = build_dashboard(data, maps, DashboardFilters(vehicle="X10", market="All", category="Navigation"), LEVELS)
    assert db.records == 2                              # X10-0001 and X10-0004
    assert ("Navigation", 2) in db.options.categories    # options ignore the category filter
    assert all(n.category == "Navigation" for n in db.tree)


def test_severity_and_segments(data_dir, load, maps):
    rows = [fb(f"X10-1{i:03d}", "US", "BEVE" if i % 2 else "ICE", "Defect",
               f"I had a {'serious' if i % 3 else 'minor'} problem with Seats - broken: \"x\"", "Seats",
               "Malfunction", source="Source C") for i in range(70)]
    write_feedback(data_dir / "X10_feedback_hackathon.xlsx", rows)
    db = build_dashboard(load(data_dir), maps, DashboardFilters(vehicle="X10", market="United States"), LEVELS)
    defect = next(r for r in db.rankings if r.type == "Defect")
    assert defect.items[0].severity == {"minor": 24, "serious": 46}
    split = next(s for s in db.segments if s.dimension == "powertrain")
    assert {v.value for v in split.values} == {"Combustion", "Electric"} and not split.hidden


def test_quotes_and_drilldown(data_dir, load, maps):
    data = load(data_dir)
    f = DashboardFilters(vehicle="X10", market="Europe")
    page = quotes(data, f, "Likes", query="cabin")
    assert page.total == 1 and page.items[0].id == "X10-0009"
    dd = drilldown(data, maps, DashboardFilters(vehicle="X10", market="Europe", category="Navigation"), "Likes")
    assert (dd.claim.numerator, dd.claim.denominator) == (1, 6)
    assert [q.id for q in dd.quotes.items] == ["X10-0004"]
    assert dd.theme == "Infotainment & connectivity" and dd.studyRefs


def test_drilldown_by_theme_group(data_dir, load, maps):
    dd = drilldown(load(data_dir), maps, DashboardFilters(vehicle="X10", market="Europe"), "Complaint",
                   theme="Infotainment & connectivity")
    assert {q.id for q in dd.quotes.items} == {"X10-0001", "X10-0008"}
    assert ("Apple CarPlay", 1) in dd.subcategories        # source categories within the group
    assert dd.claim.denominator == 6


def test_feature_ranking_splits_and_sorts(data_dir, load):
    fr = feature_ranking(load(data_dir), DashboardFilters(vehicle="X10", market="Europe"))
    assert fr.records == 6
    assert [r.records for r in fr.dislikes] == sorted((r.records for r in fr.dislikes), reverse=True)
    assert {r.category for r in fr.dislikes} == {"Touch screen, operation", "Public charging / external providers",
                                                 "Apple CarPlay"}
    nav = next(r for r in fr.likes if r.category == "Navigation")
    assert nav.records == 2 and nav.byType == {"Likes": 1, "Wants": 1}   # X10-0004 likes, X10-0001 wants
    assert all("no_class_found" != r.category for r in fr.dislikes + fr.likes)
