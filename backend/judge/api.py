import asyncio
import os
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError
import httpx
from .adapters import HttpAIAdapter, HttpModeratorAdapter, DemoAIAdapter, DemoModeratorAdapter, ContextModeratorAdapter, Unavailable
from .providers import ModelAIAdapter, ExternalProcessingRequired
from .models import (JudgeRequest, JudgeAssessment, CouncilCreate, CouncilView,
                     CouncilControl, PMMessage, DecisionInput, ConfirmPriorities)
from .service import JudgeService
from .workflow import CouncilService, CouncilRepository, Conflict


def create_app(ai=None, moderator=None, repository=None):
    demo = os.getenv("JUDGE_DEMO_MODE") == "1"
    selected_ai = DemoAIAdapter() if demo else HttpAIAdapter() if os.getenv("JUDGE_MODEL_URL") else ModelAIAdapter()
    selected_moderator = DemoModeratorAdapter() if demo else ContextModeratorAdapter() if os.getenv("JUDGE_INPUT_MODE") == "context" else HttpModeratorAdapter()
    judge = JudgeService(ai or selected_ai)
    councils = CouncilService(judge, moderator or selected_moderator,
                              repository or CouncilRepository())
    app = FastAPI(title="BMW NEXT Judge", version="0.1.0")
    app.state.judge = judge
    app.state.councils = councils

    @app.exception_handler(ExternalProcessingRequired)
    async def processing_approval(request, exc):
        return JSONResponse(status_code=403, content={"detail": str(exc)})

    @app.exception_handler(Conflict)
    async def conflict_handler(request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(KeyError)
    async def not_found(request, exc):
        return JSONResponse(status_code=404, content={"detail": "Council not found"})

    @app.exception_handler(Unavailable)
    async def unavailable(request, exc):
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    @app.exception_handler(TimeoutError)
    async def timeout(request, exc):
        return JSONResponse(status_code=504, content={"detail": "Judge/moderator exceeded the processing time limit"})

    @app.exception_handler(httpx.HTTPError)
    async def upstream(request, exc):
        return JSONResponse(status_code=502, content={"detail": "AI or moderator service unavailable; no demo fallback was used"})

    @app.exception_handler(ValueError)
    @app.exception_handler(ValidationError)
    async def invalid_output(request, exc):
        return JSONResponse(status_code=502, content={"detail": "Invalid adapter output: " + str(exc)[:500]})

    @app.get("/health")
    async def health():
        readiness = await judge.ai.readiness() if isinstance(judge.ai, ModelAIAdapter) else {}
        return {"execution": judge.ai.execution, "storage": "in-memory, single-process",
                **readiness,
                "model": getattr(judge.ai, "model", None), "provider": getattr(judge.ai, "provider", None),
                "external_approval_required": isinstance(judge.ai, ModelAIAdapter) and not judge.ai.local,
                "destination": getattr(judge.ai, "destination", None),
                "input_mode": getattr(councils.moderator, "input_mode", "team")}

    @app.post("/analyses/{analysis_id}/judge-assessments", response_model=JudgeAssessment)
    async def assess(analysis_id: str, body: JudgeRequest):
        return await judge.assess(body)

    @app.post("/analyses/{analysis_id}/councils", response_model=CouncilView)
    async def create(analysis_id: str, body: CouncilCreate):
        if isinstance(judge.ai, ModelAIAdapter):
            judge.ai.check_access(body.request)
            await judge.ai.ensure_ready()
        return await councils.create(analysis_id, body)

    @app.get("/councils/{cid}", response_model=CouncilView)
    async def get(cid: str):
        return councils.repository.get(cid)

    @app.post("/councils/{cid}/control", response_model=CouncilView)
    async def control(cid: str, body: CouncilControl):
        return await councils.control(cid, body)

    @app.post("/councils/{cid}/messages", response_model=CouncilView)
    async def message(cid: str, body: PMMessage):
        return await councils.message(cid, body)

    @app.post("/councils/{cid}/priorities/confirm", response_model=CouncilView)
    async def confirm(cid: str, body: ConfirmPriorities):
        return await councils.confirm_priorities(cid, body)

    @app.post("/councils/{cid}/decisions", response_model=CouncilView)
    async def decide(cid: str, body: DecisionInput):
        return await councils.decide(cid, body)

    @app.get("/councils/{cid}/audit")
    async def audit(cid: str):
        councils.repository.get(cid)
        return councils.repository.audit[cid]

    @app.get("/councils/{cid}/events")
    async def events(cid: str, request: Request, after: int = 0):
        view = councils.repository.get(cid)
        try:
            cursor = max(after, int(request.headers.get("last-event-id", "0")))
        except ValueError:
            raise HTTPException(422, "Last-Event-ID must be an integer sequence")
        async def stream():
            # Replay is side-effect free; commands remain explicit POSTs.
            for event in view.events:
                if event.sequence > cursor:
                    yield f"id: {event.sequence}\nevent: council\ndata: {event.model_dump_json()}\n\n"
                    await asyncio.sleep(0)
            yield "event: snapshot\ndata: " + view.model_dump_json() + "\n\n"
        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
