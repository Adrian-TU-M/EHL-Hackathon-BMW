from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api import competitor, council
from backend.config import Settings
from backend.jobs import router as jobs_router

settings = Settings.from_env()
app = FastAPI(
    title="BMW NEXT Agent Backend",
    version="0.2.0",
    description="Local Qwen competitor research API. PM-triggered local council and persisted live jobs.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
app.include_router(competitor.router)
app.include_router(council.router)
app.include_router(jobs_router)


@app.get("/api/health", tags=["Health"])
async def health() -> dict:
    return {
        "status": "ok",
        "api_running": True,
        "analysis_readiness_url": "/api/competitor/status",
        "debate_readiness_url": "/api/competitor/status",
        "ollama_model": settings.ollama_model,
        "ollama_connection": "not_checked",
    }
