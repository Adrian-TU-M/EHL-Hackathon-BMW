from contextlib import AsyncExitStack, asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api import competitor, council, market
from backend.config import Settings
from backend.jobs import router as jobs_router

from backend.customer_agent.api import app as customer_app
from backend.judge.api import app as judge_app
from backend.moderator.app import app as moderator_app
from backend.council.judge import router as review_router
from backend.voice import router as voice_router

settings = Settings.from_env()

@asynccontextmanager
async def lifespan(app):
    # Mounted FastAPI applications do not receive startup/shutdown automatically.
    async with AsyncExitStack() as stack:
        for child in (customer_app, judge_app, moderator_app):
            await stack.enter_async_context(child.router.lifespan_context(child))
        yield

app = FastAPI(
    title="BMW NEXT Agent Backend",
    version="1.0.0",
    lifespan=lifespan,
    description="Shared local Qwen backend for Customer, Market, Competitor, Moderator and Judge; PM-triggered debates and ElevenLabs narration.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list({settings.frontend_origin, "http://127.0.0.1:5173", "http://localhost:5173"}),
    allow_methods=["GET", "POST", "PATCH", "PUT"],
    allow_headers=["Content-Type"],
)
app.include_router(competitor.router)
app.include_router(council.router)
app.include_router(jobs_router)
app.include_router(market.router)


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


app.include_router(review_router)
app.include_router(voice_router)
app.mount("/customer-api", customer_app)
app.mount("/api/judge", judge_app)
# The moderator retains its original /api/moderator routes and exception handlers.
app.mount("/", moderator_app)
