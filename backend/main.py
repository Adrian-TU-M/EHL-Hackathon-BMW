from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api import competitor, council
from backend.config import Settings

settings = Settings.from_env()
app = FastAPI(
    title="BMW NEXT Agent Backend",
    version="0.1.0",
    description="Scaffold only. Analysis and debate return 501 until evidence and agents are connected.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
app.include_router(competitor.router)
app.include_router(council.router)


@app.get("/api/health", tags=["Health"])
async def health() -> dict:
    return {
        "status": "scaffold",
        "api_running": True,
        "analysis_ready": False,
        "debate_ready": False,
        "ollama_model": settings.ollama_model,
        "ollama_connection": "not_checked",
    }
