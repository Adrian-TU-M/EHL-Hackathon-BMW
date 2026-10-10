from pathlib import Path

import pandas as pd
import pytest
import yaml

from customer_agent.manifest import load_manifest

from .conftest import fb, write_feedback, write_study


def test_dedup_counts_one_record_per_id(data_dir, load):
    data = load(data_dir)
    assert len(data.rows) == 11
    assert len(data.records) == 9
    rec = data.records.set_index("record_id").loc["X10-0001"]
    assert rec["classification_rows"] == 3
    assert set(rec["polarities"]) == {"Complaint", "Request", "Unclassified"}


def test_value_normalization(data_dir, load):
    rows = load(data_dir).rows.drop_duplicates("record_id").set_index("record_id")
    assert rows.loc["X10-0001", "powertrain"] == "Electric"
    assert rows.loc["X10-0003", "powertrain"] == "Combustion"
    assert rows.loc["X10-0004", "powertrain"] == "Plug-in hybrid"
    assert rows.loc["X10-0002", "polarity"] == "Complaint"
    assert rows.loc["X10-0005", "polarity"] == "Request"
    assert rows.loc["X10-0003", "polarity"] == "Positive"


def test_markets_are_data_driven(data_dir, load):
    data = load(data_dir)
    markets = data.rows.drop_duplicates("record_id").set_index("record_id")["market"]
    assert markets["X10-0004"] == "Europe"          # "NO" must not become a YAML boolean
    assert markets["X10-0006"] == "China"           # China works as soon as the data has it
    assert markets["X10-0005"] == "United States"
    assert markets["X10-0007"] == "Unmapped:ZZ"
    assert any("Unmapped:ZZ" in w for w in data.warnings)


def test_unseen_category_becomes_its_own_theme(data_dir, load):
    rows = load(data_dir).rows.set_index("record_id")
    assert rows.loc["X10-0007", "theme"] == "Teleporter bay"
    assert rows.loc["X10-0002", "theme"] == "Charging & range"
    assert rows.loc["X10-0008", "theme"] == "Infotainment & connectivity"


def test_only_customer_sources_are_loaded(data_dir, load):
    data = load(data_dir)
    assert "sales_volumes.xlsx" in data.discovery.unmatched
    assert all(s["file"] != "sales_volumes.xlsx" for s in data.sources)


def test_manifest_rejects_non_customer_kinds(tmp_path: Path):
    path = tmp_path / "m.yaml"
    path.write_text(yaml.safe_dump({"sources": [{"name": "s", "kind": "sales", "glob": "*.xlsx"}]}))
    with pytest.raises(ValueError, match="only reads"):
        load_manifest(path)


def test_new_dataset_with_renamed_columns_via_manifest(data_dir, load, config_dir):
    pd.DataFrame({
        "comment_id": ["K1", "K1", "K2"], "verbatim": ["Seat too firm", "Seat too firm", "Love the HUD"],
        "iso_country": ["CN", "CN", "KR"], "model": ["G60", "G60", "G60"], "drive": ["BEV", "BEV", "ICE"],
        "sentiment": ["Complaint", "Request", "Positive"], "topic": ["Seats", "Seats", "Head-Up Display"],
        "respondent": ["C-1", "C-1", "C-2"], "submitted": ["2026-01-02", "2026-01-02", "2026-03-04"],
    }).to_csv(data_dir / "partner_survey.csv", index=False)
    manifest = yaml.safe_load((config_dir / "datasets.yaml").read_text())
    manifest["sources"].append({"name": "partner", "kind": "feedback", "glob": "partner_*.csv", "columns": {
        "id": "comment_id", "text": "verbatim", "country": "iso_country", "vehicle": "model",
        "powertrain": "drive", "feedback_type": "sentiment", "category_l2": "topic",
        "customer_id": "respondent", "date": "submitted"}})
    (config_dir / "datasets.yaml").write_text(yaml.safe_dump(manifest))
    data = load(data_dir)
    partner = data.rows[data.rows["dataset"] == "partner"]
    assert partner["record_id"].nunique() == 2
    assert set(partner["market"]) == {"China", "South Korea"}
    assert data.has_customer_ids and data.has_dates


def test_unlisted_feedback_file_is_auto_detected(data_dir, load):
    pd.DataFrame({"Feedback ID": ["A1"], "Comment": ["Trunk opening is too small"], "Country": ["JP"],
                  "Category": ["Luggage compartment"]}).to_csv(data_dir / "dealer_notes.csv", index=False)
    data = load(data_dir)
    auto = [s for s in data.sources if s["file"] == "dealer_notes.csv"]
    assert auto and auto[0]["auto_detected"]
    assert data.rows.set_index("record_id").loc["A1", "theme"] == "Trunk & cargo"


def test_same_id_in_two_files_is_namespaced(data_dir, load):
    write_feedback(data_dir / "Y20_feedback_hackathon.xlsx",
                   [fb("X10-0001", "GB", "ICE", "Likes", "Different car, different comment.", "Seats", vehicle="Y20")])
    data = load(data_dir)
    assert data.records["record_id"].nunique() == 10
    assert any("namespaced" in w for w in data.warnings)


def test_study_parsing_picks_up_models_and_markets(data_dir, load):
    write_study(data_dir / "X10_G60_customer_studies.xlsx",
                models_eu=("BMW 1 Series X10", "BMW 5 Series G60", "BMW 3 Series Z30"))
    studies = load(data_dir).studies
    means = studies[studies["kind"] == "study_means"]
    assert set(means["vehicle"]) == {"G68", "X10", "G60", "Z30"}
    assert set(means["market"]) == {"China", "Europe"}
    assert means["attribute"].nunique() == 3
    dist = studies[studies["kind"] == "study_distribution"]
    assert set(dist["market"]) == {"United States"}
    seats = dist[(dist["attribute"] == "Overall comfort of the seats") & (dist["vehicle"] == "X10")].iloc[0]
    assert seats["value"] == pytest.approx(0.4)       # top box: Delightful + I Love It
    assert seats["bottom_box"] == pytest.approx(0.1)  # I Hate It + A Failure + Unsatisfactory
    assert seats["sample_size"] is None


@pytest.mark.bmwdata
def test_supplied_bmw_data_counts(real_data):
    records = real_data.records.groupby("vehicle")["record_id"].nunique().to_dict()
    assert records == {"F70": 2128, "G60": 4000, "G70": 4000}
    assert set(real_data.rows[real_data.rows["vehicle"] == "F70"]["powertrain"]) == {"Combustion"}
    assert not (real_data.rows["market"] == "China").any()
    assert not real_data.has_customer_ids
    assert not [w for w in real_data.warnings if "Unmapped" in w]
