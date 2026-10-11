from __future__ import annotations

import asyncio
import os
import json
from uuid import UUID
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import Field
from backend.config import Settings

from backend.presentation.api import router as presentation_router
from backend.presentation.service import PresentationService
from backend.presentation.storage import PresentationStore

from .adapters import DeterministicAdapters, HttpAdapters
from .local import OllamaAdapters
from .catalog_bridge import specialist_catalog
from .engine import Conflict, Engine
from .external import ExternalInput, extend_catalog, fetch_source
from .models import (
    AssumptionChange,
    ConfirmAgenda,
    Control,
    Limits,
    Model,
    ProposalReviewInput,
    ReviewInput,
    Scope,
)
from .sources import load_catalog
from .storage import Store

ROOT = Path(__file__).resolve().parents[2]


class PrepareInput(Model):
    scope: Scope
    parent_session_id: str | None = None
    limits: Limits = Field(default_factory=Limits)


class RetrievalInput(Model):
    ids: list[str] = Field(max_length=100)


class VoiceInput(Model):
    assessment_id: str


class VehicleStart(Model):
    scope: Scope
    idempotency_key: UUID


def create_app(engine: Engine | None = None):
    @asynccontextmanager
    async def lifespan(app):
        if engine:
            app.state.engine = engine
            app.state.data_error = None
        else:
            private = Path(os.getenv("MODERATOR_DATA_DIR", str(ROOT / "private-data")))
            if os.getenv("PRESENTATION_ONLY") == "1":
                catalog, error = None, "Presentation-only mode; council source loading disabled"
            else:
                try:
                    catalog = specialist_catalog(load_catalog(Settings.from_env().data_dir.expanduser(), private / "catalogs"))
                    error = None
                except (FileNotFoundError, ValueError) as e:
                    catalog, error = None, str(e)

            mode = os.getenv("MODERATOR_ADAPTER", "ollama")
            adapters = (DeterministicAdapters() if mode == "deterministic" else
                        HttpAdapters() if mode == "http" else OllamaAdapters())
            app.state.engine = Engine(
                catalog, Store(private / "moderator.sqlite3"), adapters
            )
            app.state.data_error = error
        presentation_path = (
            Path(os.getenv("PRESENTATION_DATA_DIR", os.getenv("MODERATOR_DATA_DIR", str(ROOT / "private-data"))))
            / "presentations.sqlite3"
        )
        # Browser/API tests use their fixture database directory instead of private data.
        if engine and not os.getenv("PRESENTATION_DATA_DIR"):
            db_file = engine.store.db.execute("PRAGMA database_list").fetchone()[2]
            presentation_path = Path(db_file).parent / "presentations.sqlite3"
        app.state.presentations = PresentationService(
            PresentationStore(presentation_path), app.state.engine
        )
        loop = asyncio.get_running_loop()
        app.state.engine.on_commit = lambda sid: loop.call_soon(
            app.state.presentations.reconcile, sid
        )
        for sid in app.state.engine.sessions:
            app.state.presentations.reconcile(sid)
        yield
        app.state.engine.on_commit = None
        await app.state.presentations.close()
        await app.state.engine.shutdown()
        if not engine:
            app.state.engine.store.close()

    app = FastAPI(title="BMW moderator controller", version="1.0.0", lifespan=lifespan)
    start_lock = asyncio.Lock()

    @app.post("/api/moderator/vehicle-debates", status_code=201)
    async def start_vehicle(body: VehicleStart, request: Request):
        """One explicit PM action covers every scoped, eligible Moderator topic."""
        e = request.app.state.engine
        key = str(body.idempotency_key)
        fingerprint = json.dumps(body.scope.model_dump(), sort_keys=True)
        async with start_lock:
            saved = e.store.db.execute("SELECT fingerprint, session_id FROM vehicle_starts WHERE command_key=?", (key,)).fetchone()
            if saved and saved[0] != fingerprint:
                raise Conflict("This start request already belongs to a different vehicle scope")
            if saved:
                s = e.get(saved[1])
            else:
                # Deterministic source discovery is immediate; no model job is
                # needed just to show the PM that their debate has started.
                s = await e.create(body.scope, limits=Limits(session_seconds=21600, session_tokens=6000000), refine_agenda=False)
                with e.store.db:
                    e.store.db.execute("INSERT INTO vehicle_starts VALUES (?,?,?)", (key, fingerprint, s.id))
            if s.status == "awaiting_confirmation":
                topics = [t.id for t in s.agenda.topics if t.eligible]
                if not topics:
                    raise HTTPException(422, "No scoped evidence supports an agenda for this car. Choose a supported vehicle and market.")
                s = await e.confirm(s.id, ConfirmAgenda(expected_version=s.agenda.version, selected_ids=topics))
            if s.status == "ready":
                s = await e.control(s.id, Control(action="start", expected_revision=s.revision, idempotency_key=key))
            return s

    from .discussion import install_discussion
    install_discussion(app)
    app.include_router(presentation_router)

    @app.exception_handler(Conflict)
    async def conflict(_, error):
        return JSONResponse(status_code=409, content={"detail": str(error)})

    @app.exception_handler(KeyError)
    async def missing(_, error):
        return JSONResponse(
            status_code=404,
            content={
                "detail": "Session, topic, assumption or access capability not found"
            },
        )

    @app.exception_handler(ValueError)
    async def invalid(_, error):
        return JSONResponse(status_code=422, content={"detail": str(error)})

    @app.get("/api/moderator/health")
    async def health(request: Request):
        e = request.app.state.engine
        runtime = {}
        if e.adapters.mode == "ollama":
            from backend.api.competitor import status
            state = await status()
            runtime = {"model": state.get("model"), "model_installed": state.get("model_installed"),
                       "ollama_url": e.adapters.settings.ollama_base_url}
        return {
            "available": bool(e.catalog) and not e.adapters.missing() and runtime.get("model_installed", True),
            "mode": e.adapters.mode,
            "source_snapshot": e.catalog.snapshot_hash if e.catalog else None,
            "limitations": e.adapters.missing()
            + ([request.app.state.data_error] if request.app.state.data_error else []),
            "source_count": len(e.catalog.sources) if e.catalog else 0,
            **runtime,
        }

    @app.get("/api/moderator/inventory")
    async def inventory(request: Request):
        catalog = request.app.state.engine.catalog
        if not catalog:
            raise HTTPException(503, "Supplied source collection unavailable")
        return {
            "version": catalog.version,
            "snapshot_hash": catalog.snapshot_hash,
            "sources": catalog.sources,
            "warnings": catalog.warnings,
        }

    @app.post("/api/moderator/sources/external", status_code=201)
    async def external(body: ExternalInput, request: Request):
        e = request.app.state.engine
        private = Path(os.getenv("MODERATOR_DATA_DIR", str(ROOT / "private-data")))
        try:
            source, records = await fetch_source(body, private / "external")
        except (OSError, ValueError) as error:
            raise HTTPException(422, str(error)) from error
        except Exception as error:
            raise HTTPException(
                502, "Source retrieval failed; no evidence added"
            ) from error
        catalog = extend_catalog(e.catalog, source, records)
        e.install_catalog(catalog)
        return {
            "source": source,
            "source_snapshot": catalog.snapshot_hash,
            "message": "Available for new agendas; confirmed sessions retain their frozen sources.",
        }

    @app.post("/api/moderator/agendas", status_code=201)
    async def prepare(body: PrepareInput, request: Request):
        e = request.app.state.engine
        if not e.catalog:
            raise HTTPException(
                503,
                "Supplied source collection unavailable; see health for missing artifacts",
            )
        return await e.create(body.scope, body.parent_session_id, body.limits)

    @app.post("/api/moderator/sessions/{sid}/confirm")
    async def confirm(sid: str, body: ConfirmAgenda, request: Request):
        return await request.app.state.engine.confirm(sid, body)

    @app.get("/api/moderator/sessions")
    async def sessions(request: Request):
        return {"sessions": request.app.state.engine.store.recent_sessions()}

    @app.get("/api/moderator/sessions/{sid}")
    async def session(sid: str, request: Request):
        return request.app.state.engine.get(sid)

    @app.post("/api/moderator/sessions/{sid}/controls")
    async def control(sid: str, body: Control, request: Request):
        return await request.app.state.engine.control(sid, body)

    @app.patch("/api/moderator/sessions/{sid}/assumptions/{aid}")
    async def assumption(sid: str, aid: str, body: AssumptionChange, request: Request):
        return await request.app.state.engine.change_assumption(sid, aid, body)

    @app.post("/api/moderator/sessions/{sid}/outcomes/{tid}/review")
    async def review(sid: str, tid: str, body: ReviewInput, request: Request):
        return await request.app.state.engine.review(sid, tid, body)

    @app.get("/api/moderator/sessions/{sid}/outcomes")
    async def outcomes(sid: str, request: Request):
        return request.app.state.engine.get(sid).outcomes

    @app.post("/api/moderator/sessions/{sid}/outcomes/{tid}/voice")
    async def voice(sid: str, tid: str, body: VoiceInput, request: Request):
        from backend.council.judge import assessment_text
        from backend.judge.models import JudgeAssessment as NativeAssessment, JudgeRequest
        from backend.judge.service import digest
        from backend.voice import synthesize
        session = request.app.state.engine.get(sid)
        outcome = next((item for item in session.outcomes if item.topic_id == tid), None)
        if not outcome:
            raise HTTPException(404, "Completed topic outcome not found")
        if not outcome.assessment_valid or not outcome.assessment or not outcome.assessment.native_assessment:
            raise HTTPException(409, "A valid completed Judge assessment is required for voice")
        assessment = NativeAssessment.model_validate(outcome.assessment.native_assessment)
        if assessment.id != body.assessment_id:
            raise HTTPException(409, "The Judge assessment changed. Refresh before playback.")
        native_request = outcome.assessment.native_request
        if not native_request or assessment.input_digest != digest(JudgeRequest.model_validate(native_request)):
            raise HTTPException(409, "The saved evidence packet no longer matches this Judge assessment.")
        path = await synthesize(assessment_text(assessment))
        return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=3600"})
    @app.post("/api/moderator/sessions/{sid}/outcomes/{tid}/proposals/{pid}/review")
    async def review_proposal(
        sid: str, tid: str, pid: str, body: ProposalReviewInput, request: Request
    ):
        return await request.app.state.engine.review_proposal(sid, tid, pid, body)

    @app.get("/api/moderator/sessions/{sid}/packet")
    async def packet(sid: str, request: Request):
        e = request.app.state.engine
        s = e.get(sid)
        if not s.work:
            raise HTTPException(
                409, "No active topic; completed packets are in outcomes"
            )
        return e.packet(s)

    @app.get("/api/moderator/sessions/{sid}/export")
    async def export(sid: str, request: Request):
        e = request.app.state.engine
        s = e.get(sid)
        # Serialization has no awaits: snapshot/events represent the same checkpoint.
        return {
            "schema_version": 1,
            "session": s.model_dump(),
            "events": [x.model_dump() for x in e.store.events(sid)],
        }

    @app.get("/api/moderator/evidence/{eid:path}")
    async def evidence(eid: str, request: Request, source_snapshot: str | None = None):
        e = request.app.state.engine
        index = (
            {x.id: x for x in e.catalogs[source_snapshot].evidence}
            if source_snapshot
            else e.evidence
        )
        if eid not in index:
            raise KeyError(eid)
        return index[eid]

    @app.get("/api/moderator/retrieval/{token}")
    async def retrieval_index(token: str, request: Request, offset: int = 0):
        if offset < 0:
            raise HTTPException(422, "Offset must be non-negative")
        return request.app.state.engine.retrieve(token, offset=offset)

    @app.post("/api/moderator/retrieval/{token}")
    async def retrieval(token: str, body: RetrievalInput, request: Request):
        return request.app.state.engine.retrieve(token, body.ids)

    @app.get("/api/moderator/sessions/{sid}/events")
    async def events(
        sid: str,
        request: Request,
        after: int = 0,
        last_event_id: str | None = Header(default=None),
    ):
        e = request.app.state.engine
        e.get(sid)
        cursor = max(after, int(last_event_id or 0))
        if cursor < 0:
            raise HTTPException(422, "Event cursor must be non-negative")

        async def stream():
            nonlocal cursor
            idle = 0
            while not await request.is_disconnected():
                batch = e.store.events(sid, cursor)
                for event in batch:
                    cursor = event.sequence
                    yield f"id: {cursor}\nevent: council\ndata: {event.model_dump_json()}\n\n"
                if not batch:
                    idle += 1
                    if idle % 20 == 0:
                        yield ": heartbeat\n\n"
                if e.get(sid).status == "complete" and not batch:
                    return
                await asyncio.sleep(0.25)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app


app = create_app()
