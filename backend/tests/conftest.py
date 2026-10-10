"""Synthetic fixtures generated per test in a temp dir. No BMW data is used or committed."""

from __future__ import annotations

import shutil
from pathlib import Path

import pandas as pd
import pytest

from customer_agent.config import BACKEND_DIR, load_settings
from customer_agent.ingest import load_customer_data
from customer_agent.mappings import Mappings

FEEDBACK_COLUMNS = ["ID", "Source", "Brand", "Sales Description", "Country", "Derivate (e-code)",
                    "Engine Type", "Feedback Type", "Customer Feedback", "Vfc level2 3 Name",
                    "Vfc level2 Name", "Vfc level3 Name"]


def fb(id_, country, engine, ftype, text, l2, l3="", vehicle="X10", source="Source A"):
    return [id_, source, "[BMW]", "[BMW Test]", country, vehicle, engine, ftype, text, f"{l2} : {l3}", l2, l3]


def write_feedback(path: Path, rows: list[list]) -> None:
    pd.DataFrame(rows, columns=FEEDBACK_COLUMNS).to_excel(path, index=False)


def write_study(path: Path, models_cn=("BMW 5 Series G68",), models_eu=("BMW 1 Series X10", "BMW 5 Series G60")) -> None:
    """CN_EU means sheet + US distribution sheet in the same layout as the supplied study."""
    n_cols = 1 + len(models_cn) + len(models_eu)
    country_row = [None, "China"] + [None] * (len(models_cn) - 1) + ["EU"] + [None] * (len(models_eu) - 1)
    means = [
        [None, "Dataset country"] + [None] * (n_cols - 2),
        country_row,
        ["Overall product satisfaction", *models_cn, *models_eu],
        ["Mean"] + [8.0 + i * 0.1 for i in range(n_cols - 1)],
        ["Overall seating comfort"] + [None] * (n_cols - 1),
        ["Mean"] + [7.0 + i * 0.2 for i in range(n_cols - 1)],
        ["Easy to use information and entertainment system including in-car apps"] + [None] * (n_cols - 1),
        ["Mean"] + [6.5 + i * 0.3 for i in range(n_cols - 1)],
    ]
    levels = ["I Hate It", "A Failure", "Unsatisfactory", "Satisfactory", "Excellent", "Delightful", "I Love It"]
    marker = "% of column, sample base"
    dist = [["Overall comfort of the seats", None, "BMW 1 Series X10", "BMW 5 Series G60"],
            ["Sample total", marker, 1, 1], [None, None, None, None]]
    shares = [0.01, 0.02, 0.07, 0.2, 0.3, 0.2, 0.2]
    dist += [[lvl, marker, v, v] for lvl, v in zip(levels, shares)]
    dist += [["Menu structure of infotainment system", None, None, None],
             ["Sample total", marker, 1, 1], [None, None, None, None]]
    dist += [[lvl, marker, v, round(v * 0.5 + (0.1 if i == 3 else 0), 3)] for i, (lvl, v) in enumerate(zip(levels, shares))]
    with pd.ExcelWriter(path) as writer:
        pd.DataFrame(means).to_excel(writer, sheet_name="CN_EU_2025", header=False, index=False)
        pd.DataFrame(dist).to_excel(writer, sheet_name="US_2025", header=False, index=False)


BASE_ROWS = [
    # One comment, three classification rows -> one record.
    fb("X10-0001", "GB", "BEVE", "Difficult to Use", "The touch screen menus are confusing while driving.", "Touch screen, operation", "Not user-friendly"),
    fb("X10-0001", "GB", "BEVE", "Wants", "The touch screen menus are confusing while driving.", "Navigation", "Customer request: function"),
    fb("X10-0001", "GB", "BEVE", "", "The touch screen menus are confusing while driving.", "no_class_found"),
    fb("X10-0002", "DE", "BEVE", "Defect", "Charging stops at public chargers fail constantly.", "Public charging / external providers", "Malfunction"),
    fb("X10-0003", "FR", "ICE", "Likes", "The seats are wonderfully comfortable on long trips.", "Seats", "Likes comfort"),
    fb("X10-0004", "NO", "PHEV", "Likes", "Navigation is clear and easy to read.", "Navigation", "Like: usability"),
    fb("X10-0005", "US", "ICE", "Wants", "I want a bigger cupholder for my bottle.", "Cupholder", "Customer request: function"),
    fb("X10-0006", "CN", "BEVE", "Difficult to Use", "Voice control does not understand my commands.", "Voice control / speech recognition", "Not user-friendly"),
    fb("X10-0007", "ZZ", "ICE", "Likes", "Great car overall.", "Teleporter bay", "Like: function"),
    fb("X10-0008", "GB", "BEVE", "Difficult to Use", "The infotainment lags when switching to CarPlay.", "Apple CarPlay", "Not user-friendly"),
    fb("X10-0009", "GB", "BEVE", "Likes", "Ambient lighting makes the cabin feel premium.", "Ambient light", "Like: function"),
]


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    d = tmp_path / "data"
    d.mkdir()
    write_feedback(d / "X10_feedback_hackathon.xlsx", BASE_ROWS)
    write_study(d / "X10_G60_customer_studies.xlsx")
    # A sales file must never be ingested by the Customer Agent.
    pd.DataFrame({"market": ["Europe"], "market_code": ["EU"], "volume_2024": [1]}).to_excel(
        d / "sales_volumes.xlsx", index=False)
    return d


@pytest.fixture
def config_dir(tmp_path: Path) -> Path:
    """Copy of the real manifest + mappings that a test may extend."""
    c = tmp_path / "config"
    shutil.copytree(BACKEND_DIR / "mappings", c / "mappings")
    shutil.copy(BACKEND_DIR / "datasets.yaml", c / "datasets.yaml")
    return c


@pytest.fixture
def load(config_dir: Path):
    def _load(data_dir: Path):
        return load_customer_data(data_dir, config_dir / "datasets.yaml", config_dir / "mappings")
    return _load


@pytest.fixture
def maps(config_dir: Path) -> Mappings:
    return Mappings(config_dir / "mappings")


class FakeLLM:
    """Returns queued responses in order; records the prompts it received."""

    model = "fake-model"

    def __init__(self, *responses: dict):
        self.responses = list(responses)
        self.prompts: list[str] = []

    def chat_json(self, system: str, user: str, schema: dict, temperature: float = 0.2) -> dict:
        self.prompts.append(user)
        return self.responses.pop(0) if self.responses else {"checks": []}

    def status(self) -> dict:
        return {"reachable": True, "model": self.model, "modelAvailable": True}


@pytest.fixture
def real_data():
    s = load_settings()
    if not (s.data_dir / "G60_feedback_hackathon.xlsx").exists():
        pytest.skip("Supplied BMW datasets not available in BMW_DATA_DIR")
    return load_customer_data(s.data_dir, s.manifest_path, s.mappings_dir)


import pytest

from moderator.adapters import DeterministicAdapters
from moderator.engine import Engine
from moderator.models import Catalog, Evidence, Scope, Source
from moderator.storage import Store


@pytest.fixture
def scope():
    return Scope(vehicle="G60", market="United States", powertrain="Electric")


def make_catalog():
    return Catalog(
        snapshot_hash="synthetic-test-v1",
        sources=[
            Source(
                id="feedback",
                name="Synthetic feedback",
                sha256="f" * 64,
                domain="customer",
                provenance="synthetic",
            ),
            Source(
                id="sales",
                name="Synthetic sales",
                sha256="a" * 64,
                domain="market",
                provenance="synthetic",
            ),
        ],
        evidence=[
            Evidence(
                id="f1",
                source_id="feedback",
                domain="customer",
                location="Feedback!A2:L3",
                passage="Climate controls are difficult to use.",
                vehicle="G60",
                country="US",
                powertrain="Electric",
                kind="feedback",
                observation_id="1",
                classification_rows=[2, 3],
                classifications=["climate"],
                feedback_types=["Difficult to Use"],
                topics=["climate", "controls"],
            ),
            Evidence(
                id="f2",
                source_id="feedback",
                domain="customer",
                location="Feedback!A4:L4",
                passage="I like the quiet cabin and climate system.",
                vehicle="G60",
                country="US",
                powertrain="Electric",
                kind="feedback",
                observation_id="2",
                classification_rows=[4],
                feedback_types=["Likes"],
                topics=["climate", "noise"],
            ),
            Evidence(
                id="f3",
                source_id="feedback",
                domain="customer",
                location="Feedback!A5:L5",
                passage="The app sometimes cannot unlock the vehicle.",
                vehicle="G60",
                country="US",
                powertrain="Electric",
                kind="feedback",
                observation_id="3",
                classification_rows=[5],
                topics=["app", "access"],
            ),
            Evidence(
                id="foreign",
                source_id="feedback",
                domain="customer",
                location="Feedback!A6:L6",
                passage="German combustion charging feedback.",
                vehicle="G60",
                country="DE",
                powertrain="Combustion",
                kind="feedback",
                observation_id="4",
                topics=["charging"],
            ),
            Evidence(
                id="g68",
                source_id="feedback",
                domain="customer",
                location="Study!B4",
                passage="G68 China mean, unknown rating scale",
                vehicle="G68",
                region="China",
                kind="study_mean",
                topics=["climate"],
                quantitative={
                    "value": 8,
                    "unit": "undocumented rating scale",
                    "n": None,
                },
            ),
            Evidence(
                id="us-study",
                source_id="feedback",
                domain="customer",
                location="US!C2:C9",
                passage="Normalized US distribution; n unknown",
                vehicle="G60",
                region="United States",
                kind="study_distribution",
                topics=["climate"],
                quantitative={
                    "distribution": {"Good": 0.6, "Bad": 0.4},
                    "sample_total": 1,
                    "n": None,
                    "unit": "normalized column",
                },
            ),
            Evidence(
                id="s2024",
                source_id="sales",
                domain="market",
                location="G60_G68!C4",
                passage="G60/G68 US 2024: 100 vehicles, grouped.",
                vehicle="G60_G68",
                region="United States",
                period="2024",
                kind="sales_actual",
                topics=["market-context"],
                quantitative={"value": 100, "unit": "vehicles"},
            ),
            Evidence(
                id="s2025",
                source_id="sales",
                domain="market",
                location="G60_G68!D4",
                passage="G60/G68 US 2025: 110 vehicles, grouped.",
                vehicle="G60_G68",
                region="United States",
                period="2025",
                kind="sales_actual",
                topics=["market-context"],
                quantitative={"value": 110, "unit": "vehicles"},
            ),
            Evidence(
                id="s2030",
                source_id="sales",
                domain="market",
                location="G60_G68!E4",
                passage="G60/G68 US supplied future 2030: 120 vehicles, grouped.",
                vehicle="G60_G68",
                region="United States",
                period="2030",
                kind="provided_forecast",
                topics=["market-context"],
                quantitative={"value": 120, "unit": "vehicles"},
            ),
            Evidence(
                id="equipment",
                source_id="feedback",
                domain="product",
                location="German PDF page 5",
                passage="Equipment table with unverified columns",
                vehicle="G60",
                region="Germany",
                kind="equipment",
                topics=["climate"],
            ),
        ],
    )


@pytest.fixture
def catalog():
    return make_catalog()


@pytest.fixture
def engine(catalog, tmp_path):
    return Engine(catalog, Store(tmp_path / "test.sqlite3"), DeterministicAdapters())
