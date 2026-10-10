"""Contract tests for the real Customer implementation in the shared council."""
import asyncio
from dataclasses import replace
from types import SimpleNamespace

from backend.config import Settings
from backend.council.customer import CustomerParticipant, resolve_customer_evidence
from backend.customer_agent.agent import CustomerAgent
from backend.customer_agent.config import load_settings
from backend.customer_agent.retrieval import scope_rows, to_evidence
from backend.customer_agent.schemas import CouncilEvent, PerspectiveRequest, Scope
from backend.customer_agent.stats import study_refs
from backend.schemas.agent import AgentPosition, Claim
from backend.schemas.council import CouncilTurn
from .conftest import FakeLLM


def test_shared_model_and_parent_data_directory(tmp_path):
    (tmp_path / "BMW-Data").mkdir()
    shared = replace(Settings.from_env(), data_dir=tmp_path, ollama_model="qwen3:8b",
                     ollama_base_url="http://127.0.0.1:11434")
    native = load_settings(shared)
    assert native.data_dir == tmp_path / "BMW-Data"
    assert native.ollama_model == shared.ollama_model
    assert native.ollama_base_url == shared.ollama_base_url


def test_study_citations_are_resolved_without_assuming_scale(data_dir, load, maps):
    data = load(data_dir)
    scope = Scope(vehicle="G60", market="Europe")
    agent = CustomerAgent(data, maps, FakeLLM())
    ref = study_refs(data, maps, scope, None)[0]
    event = CouncilEvent(id="turn", stage="perspectives", statement="A supplied mean differs.", evidenceIds=[ref.id])
    records = resolve_customer_evidence(event, agent, scope, data_dir)
    assert len(records) == 1 and records[0].id == ref.id
    assert records[0].source_type == "customer_study"
    assert "scale unspecified" in records[0].passage
    assert "0-10" not in records[0].passage
    assert records == resolve_customer_evidence(event, agent, scope, data_dir)


def test_because_is_verified_before_returning_a_perspective(data_dir, load, maps):
    llm = FakeLLM(
        {"statement": "The screen confuses one driver.", "because": "The source proves all drivers demand AI.",
         "recommendation": "Add AI.", "evidenceIds": ["X10-0001"], "studyRefIds": [],
         "uncertainties": [], "assumption": ""},
        {"checks": [{"finding": 0, "id": "X10-0001", "supports": False}]},
    )
    event = CustomerAgent(load(data_dir), maps, llm).perspective(PerspectiveRequest(
        scope=Scope(vehicle="X10", market="Europe"), topic="Displays"))
    assert "all drivers demand AI" in llm.prompts[1]
    assert event.evidenceIds == []
    assert "cannot substantiate" in event.statement
    assert "all drivers demand AI" not in event.statement


def test_actual_customer_turn_preserves_sources_and_challenges_target(data_dir, load, maps):
    data = load(data_dir)
    # The shared production contract allows the BMW models; this fixture has X10
    # records, which the native schema intentionally supports as a dataset value.
    scope = Scope(vehicle="X10", market="Europe", powertrain="Electric", horizon=4)
    quote = to_evidence(data, scope_rows(data, scope).query("record_id == 'X10-0001'"))
    captured = []
    event = CouncilEvent(
        id="native", stage="discussion", statement="The supplied driver found menus confusing.",
        evidenceIds=[quote.id], evidence=[quote], stance="partly_agree",
        counterQuestion="How would this proposal simplify the reported task?",
        model="ollama:qwen3:8b",
    )
    native = SimpleNamespace(data=data, maps=maps, perspective=lambda req: captured.append(req) or event)
    target = CouncilTurn(agent_id="market", stage="perspectives", position=AgentPosition(
        agent_id="market", claims=[Claim(id="market-perspectives-1", text="Test a cockpit feature.", kind="hypothesis")],
        stance="revise", rationale="Investigate a new cockpit feature."))
    sources = []
    participant = CustomerParticipant(replace(Settings.from_env(), data_dir=data_dir), agent=native)
    turn = asyncio.run(participant.turn("challenge", {
        "scope": {**scope.model_dump(exclude={"prompt"}), "topic": "Displays"},
        "lead_agent": "market", "question": "What should BMW investigate?", "recommendations": [],
    }, sources, [target]))
    assert captured[0].stage == "discussion"
    assert captured[0].context[-1].actor == "market"
    assert turn.challenges[0].target_claim_id == "market-perspectives-1"
    assert turn.position.claims[0].evidence_ids == [quote.id]
    assert {r.id for r in sources} == {quote.id}
    assert sources[0].passage == quote.passage


def test_unified_app_initializes_mounted_customer_api(data_dir, config_dir, tmp_path, monkeypatch):
    import importlib
    from fastapi.testclient import TestClient
    from backend.customer_agent import api
    from backend.customer_agent.config import load_settings as native_settings
    from backend.customer_agent.llm import OllamaClient
    private = tmp_path / "isolated-moderator"
    monkeypatch.setenv("MODERATOR_DATA_DIR", str(private))
    monkeypatch.setenv("AGENT_RUNS_DIR", str(tmp_path / "isolated-runs"))
    monkeypatch.setenv("BMW_DATA_DIR", str(data_dir))
    monkeypatch.setenv("CUSTOMER_AGENT_MANIFEST", str(config_dir / "datasets.yaml"))
    monkeypatch.setenv("CUSTOMER_AGENT_MAPPINGS", str(config_dir / "mappings"))
    monkeypatch.setattr(api, "settings", native_settings())
    monkeypatch.setattr(OllamaClient, "status", lambda _: {"reachable": True, "model": "qwen3:8b", "modelAvailable": True})
    moderator_module = importlib.import_module("backend.moderator.app")
    actual_store = moderator_module.Store
    opened = []
    def isolated_store(path):
        # Fail before opening any live SQLite database, including its WAL files.
        assert path.parent.resolve() == private.resolve()
        opened.append(path)
        return actual_store(path)
    monkeypatch.setattr(moderator_module, "Store", isolated_store)
    from backend.main import app
    with TestClient(app) as client:
        response = client.get("/customer-api/customer/features", params={"vehicle": "X10", "market": "Europe"})
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["records"] == 6
        assert data["coverage"]["customersIdentifiable"] is False
        assert data["dislikes"] and data["likes"]
    assert opened == [private / "moderator.sqlite3"]
