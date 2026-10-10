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
from .schemas import AnalysisResult, CouncilEvent, Coverage, Evidence, PerspectiveRequest, Scope, ThemeStat
from .stats import coverage, theme_stats

settings = load_settings()
_state: dict = {}
_lock = threading.Lock()


def _load() -> None:
    data = load_customer_data(settings.data_dir, settings.manifest_path, settings.mappings_dir)
    maps = Mappings(settings.mappings_dir)
    _state.update(data=data, maps=maps, agent=CustomerAgent(data, maps, OllamaClient(settings)))


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
