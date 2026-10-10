"""Standalone competitor analysis. This module never invokes the council."""
import asyncio
from functools import lru_cache
from pathlib import Path
from uuid import UUID
from datetime import date
import httpx
from fastapi import APIRouter, Depends, HTTPException
from backend.agents.competitor import AgentOutputError, CompetitorAgent
from backend.config import Settings
from backend.schemas.agent import AgentRequest, AgentResult
from backend.storage import RunStore
from backend.tools.retrieval import EvidenceRepository, EvidenceUnavailableError

router = APIRouter(prefix="/api/competitor", tags=["Competitor"])
from backend.runtime import run_lock as _run_lock

@lru_cache(maxsize=2)
def _load_index(path: Path, modified: int) -> EvidenceRepository:
    return EvidenceRepository.load(path)

def get_repository() -> EvidenceRepository:
    path = Settings.from_env().evidence_index
    try:
        return _load_index(path, path.stat().st_mtime_ns if path.exists() else 0)
    except EvidenceUnavailableError as exc:
        raise HTTPException(503, str(exc)) from exc

@router.get("/status")
async def status() -> dict:
    settings = Settings.from_env()
    try:
        repository = get_repository()
        count = len(repository.records)
        competitor_count = sum(r.source_type == "competitor_official" for r in repository.records.values())
        current_count = sum(r.source_type == "competitor_official" and repository.is_current(r) for r in repository.records.values())
        index_error = None
    except HTTPException as exc:
        count = competitor_count = current_count = 0
        index_error = exc.detail
    available = False
    ollama_error = None
    digest = None
    server_running = False
    model_loaded = False
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            response = await client.get(f"{settings.ollama_base_url}/api/tags")
            response.raise_for_status()
            server_running = True
            model = next((m for m in response.json().get("models", []) if m.get("name") == settings.ollama_model), None)
            available = model is not None
            digest = model.get("digest") if model else None
            if not available:
                ollama_error = f"Run: ollama pull {settings.ollama_model}"
            running = await client.get(f"{settings.ollama_base_url}/api/ps")
            running.raise_for_status()
            model_loaded = any(m.get("name") == settings.ollama_model for m in running.json().get("models", []))
    except (httpx.HTTPError, ValueError):
        ollama_error = "Cannot reach Ollama. Start it with ollama serve."
    return {"analysis_ready": bool(count and available), "busy": _run_lock.locked(),
            "evidence_records": count, "competitor_records": competitor_count,
            "currently_reviewed_competitor_records": current_count,
            "ollama_url": settings.ollama_base_url, "ollama_server_running": server_running,
            "model_installed": available, "model_loaded": model_loaded,
            "model": settings.ollama_model, "model_digest": digest,
            "index_error": index_error, "ollama_error": ollama_error,
            "debate_ready": bool(count and available), "coverage": "Limited curated sources; inspect each run's uncertainties."}

@router.get("/sources")
async def sources(repository: EvidenceRepository = Depends(get_repository)) -> dict:
    records = [r for r in repository.records.values() if r.source_type == "competitor_official"]
    current = [r for r in records if repository.is_current(r)]
    covered_markets = {r.market for r in current}
    return {
        "eligibility_evaluated_on": date.today().isoformat(),
        "source_url_count": len({r.source_uri for r in records}),
        "currently_reviewed_records": len(current),
        "missing_markets": sorted({"Europe", "United States", "China"} - covered_markets),
        "limitations": "Coverage is topic/trim/country-specific, not a complete competitor database. Current reference means a reviewed source, not guaranteed fitment.",
        "records": [{**r.model_dump(mode="json"), "eligible_for_current_search": repository.is_current(r)} for r in records],
    }

@router.post("/analyze", response_model=AgentResult)
async def analyze(request: AgentRequest, repository: EvidenceRepository = Depends(get_repository)) -> AgentResult:
    if request.stage != "analysis" or request.prior_positions or request.challenge:
        raise HTTPException(422, "Use the PM-triggered council endpoint for debate.")
    for evidence_id in request.evidence_ids:
        try:
            repository.read(evidence_id, request.scope)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    if _run_lock.locked():
        raise HTTPException(409, "A competitor run is already in progress. Try again after it finishes.")
    settings = Settings.from_env()
    async with _run_lock:
        try:
            result = await CompetitorAgent(settings, repository).run(request)
            RunStore(settings.runs_dir).save(result)
            return result
        except (TimeoutError, httpx.TimeoutException) as exc:
            raise HTTPException(504, "Qwen exceeded the run timeout; no result was saved.") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(503, "Ollama is unavailable or rejected the model request. Check /api/competitor/status.") from exc
        except AgentOutputError as exc:
            raise HTTPException(502, str(exc)) from exc

@router.get("/runs/{run_id}", response_model=AgentResult)
async def read_run(run_id: UUID) -> AgentResult:
    try:
        return RunStore(Settings.from_env().runs_dir).read(run_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, "Run not found") from exc

@router.post('/jobs', status_code=202)
async def create_job(request: AgentRequest, repository: EvidenceRepository = Depends(get_repository)):
    from backend.jobs import submit
    if request.stage != 'analysis' or request.prior_positions or request.challenge:
        raise HTTPException(422, 'Use the PM-triggered council endpoint for debate.')
    for eid in request.evidence_ids:
        try:
            record = repository.read(eid, request.scope)
            if record.source_type == 'competitor_official' and (not repository.is_current(record) or
                (request.competitor_brand and (record.brand != request.competitor_brand or record.model != request.competitor_model))):
                raise ValueError('Selected competitor evidence is expired or does not match the selected model.')
        except ValueError as exc: raise HTTPException(422, str(exc)) from exc
    settings = Settings.from_env()
    async def work(progress):
        progress('Qwen researching BMW and the selected competitor')
        result = await CompetitorAgent(settings, repository).run(request)
        RunStore(settings.runs_dir).save(result)
        return result
    return await submit('analysis', request.model_dump(mode='json'), work, request.client_job_id)
