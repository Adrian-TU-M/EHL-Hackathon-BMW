
import pytest
from fastapi.testclient import TestClient

from .conftest import FakeLLM


@pytest.fixture
def client(data_dir, config_dir, monkeypatch):
    monkeypatch.setenv("BMW_DATA_DIR", str(data_dir))
    monkeypatch.setenv("CUSTOMER_AGENT_MANIFEST", str(config_dir / "datasets.yaml"))
    monkeypatch.setenv("CUSTOMER_AGENT_MAPPINGS", str(config_dir / "mappings"))
    from customer_agent import api, config

    monkeypatch.setattr(api, "settings", config.load_settings())
    with TestClient(api.app) as c:
        yield c, api


def test_api_endpoints(client):
    c, api = client
    health = c.get("/health").json()
    assert health["uniqueRecords"] == 9 and "sales_volumes.xlsx" in health["unmatchedFiles"]
    cov = c.get("/customer/coverage", params={"vehicle": "X10", "market": "Europe"}).json()
    assert cov["uniqueRecords"] == 6 and cov["customersIdentifiable"] is False
    themes = c.get("/customer/themes", params={"vehicle": "X10", "market": "Europe", "limit": 2}).json()
    assert len(themes) == 2 and themes[0]["shareOfRecords"]["denominator"] == 6
    ev = c.get("/customer/evidence", params={"vehicle": "X10", "market": "Europe", "q": "cabin"}).json()
    assert [e["id"] for e in ev] == ["X10-0009"]
    assert c.get("/customer/coverage", params={"vehicle": "X10"}).status_code == 422

    api._state["agent"].llm = FakeLLM({"findings": []})
    r = c.post("/customer/analysis", json={"vehicle": "X10", "market": "Europe"})
    assert r.status_code == 200 and r.json()["findings"] == []


def test_llm_unavailable_returns_503(client, monkeypatch):
    c, api = client
    from customer_agent.llm import LLMUnavailable

    def boom(*a, **k):
        raise LLMUnavailable("Ollama is not running")

    monkeypatch.setattr(api._state["agent"].llm, "chat_json", boom)
    r = c.post("/customer/analysis", json={"vehicle": "X10", "market": "Europe", "powertrain": "Electric"})
    assert r.status_code == 503 and r.json()["detail"]["error"] == "llm_unavailable"


@pytest.mark.ollama
def test_live_qwen_analysis_cites_only_real_records(data_dir, load, maps):
    from customer_agent.agent import CustomerAgent
    from customer_agent.config import load_settings
    from customer_agent.llm import OllamaClient
    from customer_agent.schemas import Scope

    data = load(data_dir)
    llm = OllamaClient(load_settings())
    if not llm.status()["modelAvailable"]:
        pytest.skip(f"{llm.model} not available in Ollama")
    result = CustomerAgent(data, maps, llm).analyze(Scope(vehicle="X10", market="Europe"))
    known = set(data.records["record_id"])
    for f in result.findings:
        assert f.evidenceIds and set(f.evidenceIds) <= known
        assert "%" not in f.detail
