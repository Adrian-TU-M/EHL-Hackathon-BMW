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
