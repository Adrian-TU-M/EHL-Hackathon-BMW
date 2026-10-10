"""HTTP API for the Customer Agent. Run:

    uvicorn customer_agent.api:app --host 127.0.0.1 --port 8001
"""

from __future__ import annotations

import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .agent import CustomerAgent
from .config import load_settings
from .ingest import load_customer_data
from .llm import LLMOutputError, LLMUnavailable, OllamaClient
from .mappings import Mappings
from .retrieval import search
from .dashboard import build_dashboard, drilldown, feature_ranking, quotes
from .manifest import load_manifest
from .schemas import (
    AnalysisResult,
    CouncilEvent,
    Coverage,
    Dashboard,
    DashboardFilters,
    Drilldown,
    Evidence,
    FeatureRanking,
    PerspectiveRequest,
    QuotePage,
    Scope,
    ThemeStat,
)
from .stats import coverage, theme_stats

settings = load_settings()
_state: dict = {}
_lock = threading.Lock()


def _load() -> None:
    data = load_customer_data(settings.data_dir, settings.manifest_path, settings.mappings_dir)
    maps = Mappings(settings.mappings_dir)
    levels: list[str] = []
    for spec in load_manifest(settings.manifest_path):
        for lvl in ((spec.options.get("derived") or {}).get("severity") or {}).get("levels", []):
            if lvl not in levels:
                levels.append(lvl)
    _state.update(data=data, maps=maps, severity_levels=levels,
                  agent=CustomerAgent(data, maps, OllamaClient(settings)))


@asynccontextmanager
async def lifespan(_: FastAPI):
    _load()
    yield


app = FastAPI(title="BMW NEXT Customer Agent", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _scope(vehicle: str, market: str, powertrain: str | None) -> Scope:
    return Scope(vehicle=vehicle, market=market, powertrain=powertrain or None)


def _run_llm(fn, *args):
    try:
        return fn(*args)
    except LLMUnavailable as exc:
        raise HTTPException(status_code=503, detail={"error": "llm_unavailable", "message": str(exc)})
    except LLMOutputError as exc:
        raise HTTPException(status_code=502, detail={"error": "llm_invalid_output", "message": str(exc)})


@app.get("/health")
def health() -> dict:
    data = _state["data"]
    return {
        "ollama": _state["agent"].llm.status(),
        "dataDir": str(settings.data_dir),
        "sources": data.sources,
        "unmatchedFiles": data.discovery.unmatched,
        "feedbackRows": len(data.rows),
        "uniqueRecords": len(data.records),
        "studyRows": len(data.studies),
        "customersIdentifiable": data.has_customer_ids,
        "warnings": data.warnings,
    }


@app.post("/customer/reload")
def reload() -> dict:
    """Re-ingest the data directory (after adding datasets or editing mappings)."""
    with _lock:
        _load()
    return health()


@app.get("/customer/coverage", response_model=Coverage)
def get_coverage(vehicle: str, market: str, powertrain: str | None = None) -> Coverage:
    return coverage(_state["data"], _scope(vehicle, market, powertrain))


@app.get("/customer/themes", response_model=list[ThemeStat])
def get_themes(vehicle: str, market: str, powertrain: str | None = None,
               limit: int = Query(20, ge=1, le=200)) -> list[ThemeStat]:
    return theme_stats(_state["data"], _state["maps"], _scope(vehicle, market, powertrain), limit)


@app.get("/customer/evidence", response_model=list[Evidence])
def get_evidence(vehicle: str, market: str, powertrain: str | None = None, theme: str | None = None,
                 type: str | None = None, q: str | None = None,
                 limit: int = Query(50, ge=1, le=500)) -> list[Evidence]:
    return search(_state["data"], _scope(vehicle, market, powertrain), theme, type, q, limit)


@app.post("/customer/analysis", response_model=AnalysisResult)
def post_analysis(scope: Scope) -> AnalysisResult:
    return _run_llm(_state["agent"].analyze, scope)


@app.post("/customer/perspective", response_model=CouncilEvent)
def post_perspective(request: PerspectiveRequest) -> CouncilEvent:
    return _run_llm(_state["agent"].perspective, request)


def _filters(vehicle: str, market: str, powertrain: str, source: str, category: str) -> DashboardFilters:
    return DashboardFilters(vehicle=vehicle, market=market, powertrain=powertrain, source=source,
                            category=category)


@app.get("/customer/dashboard", response_model=Dashboard)
def get_dashboard(vehicle: str, market: str = "All", powertrain: str = "All", source: str = "All",
                  category: str = "All") -> Dashboard:
    """All deterministic aggregates for the Customer Intelligence page in one call."""
    return build_dashboard(_state["data"], _state["maps"],
                           _filters(vehicle, market, powertrain, source, category), _state["severity_levels"])


@app.get("/customer/quotes", response_model=QuotePage)
def get_quotes(vehicle: str, market: str = "All", powertrain: str = "All", source: str = "All",
               category: str = "All", type: str | None = None, theme: str | None = None,
               q: str | None = None, offset: int = Query(0, ge=0),
               limit: int = Query(24, ge=1, le=200)) -> QuotePage:
    return quotes(_state["data"], _filters(vehicle, market, powertrain, source, category), type, theme, q,
                  offset, limit)


@app.get("/customer/drilldown", response_model=Drilldown)
def get_drilldown(vehicle: str, market: str = "All", powertrain: str = "All", source: str = "All",
                  category: str = "All", type: str | None = None, theme: str | None = None,
                  limit: int = Query(30, ge=1, le=200)) -> Drilldown:
    """Evidence drawer: claim, subcategories, linked study results and original quotes."""
    return drilldown(_state["data"], _state["maps"], _filters(vehicle, market, powertrain, source, category),
                     type, limit, theme)


@app.get("/customer/features", response_model=FeatureRanking)
def get_features(vehicle: str, market: str = "All", powertrain: str = "All", source: str = "All",
                 category: str = "All") -> FeatureRanking:
    """Every category ranked by unique records: dislikes (Defect, Difficult to Use) vs. likes and wants."""
    return feature_ranking(_state["data"], _filters(vehicle, market, powertrain, source, category))
