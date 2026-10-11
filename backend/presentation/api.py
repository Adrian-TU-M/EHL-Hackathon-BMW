import asyncio
from typing import Any, Literal

from fastapi import APIRouter, Header, Request
from fastapi.responses import StreamingResponse
from pydantic import Field

from .content import source_notes
from .models import Audience, Model, OutlineItem, PresentationBrief, SlideSpec, ThemeId
from .sources import council_snapshot, dashboard_snapshot

router = APIRouter(prefix="/api/presentations", tags=["presentations"])


class CreateInput(Model):
    kind: Literal["isolated_demo", "dashboard_demo", "council"]
    idempotency_key: str = Field(min_length=1, max_length=100)
    mode: Literal["demo", "ollama"] = "ollama"
    dashboard: dict[str, Any] | None = None
    session_id: str | None = None


class VersionInput(Model):
    expected_revision: int = Field(ge=1)


class BriefInput(VersionInput):
    brief: PresentationBrief


class OutlineInput(VersionInput):
    audience: Audience | None = None
    items: list[OutlineItem] = Field(min_length=12, max_length=12)


class JobInput(VersionInput):
    operation: Literal["outline", "slides", "variant"]
    audience: Audience = "executive"
    idempotency_key: str = Field(min_length=1, max_length=100)


class ThemeInput(VersionInput):
    audience: Audience
    theme_id: ThemeId = "bmw-cinematic-v1"


class RevisionInput(VersionInput):
    audience: Audience
    slide_id: str
    instruction: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=1, max_length=100)


class EditInput(VersionInput):
    audience: Audience
    slides: list[SlideSpec] = Field(min_length=1, max_length=100)


class RefreshInput(VersionInput):
    dashboard: dict[str, Any] | None = None


class FinalizeInput(VersionInput):
    acknowledgment: str = Field(default="", max_length=4000)


class RehearsalInput(VersionInput):
    persona: Literal["cfo", "engineering", "executive", "sales"]
    audience: Audience


class AnswerInput(Model):
    answer: str = Field(min_length=1, max_length=5000)


class VoiceMessage(Model):
    id: str = Field(max_length=200)
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=10000)


def service(request):
    return request.app.state.presentations


@router.get("/health")
async def health(request: Request):
    return {
        "available": True,
        "demo_available": True,
        "ollama": await service(request).writer.health(),
    }


@router.get("")
async def listing(request: Request):
    s = service(request)
    sessions = [
        {
            "id": x.id,
            "status": x.status,
            "mode": x.mode,
            "scope": x.agenda.scope.model_dump(),
            "created_at": x.created_at,
            "proposal_count": sum(len(o.assessment.proposals) for o in x.outcomes if o.assessment_valid and o.assessment),
            "approved_count": len(council_snapshot(s.engine, x.id).decisions),
        }
        for x in sorted(s.engine.sessions.values(), key=lambda x: x.created_at, reverse=True)
    ]
    return {
        "presentations": [
            {
                "id": p.id,
                "title": p.brief.title,
                "revision": p.revision,
                "mode": p.mode,
                "synthetic": p.snapshot.synthetic,
                "source_kind": p.snapshot.kind,
                "updated_at": p.updated_at,
            }
            for p in s.store.list()
        ],
        "sessions": sessions,
    }


@router.post("", status_code=201)
async def create(body: CreateInput, request: Request):
    if body.kind == "council" and not body.session_id:
        raise ValueError("A council session ID is required")
    return service(request).create(
        body.kind, body.idempotency_key, body.dashboard, body.session_id, body.mode
    )


@router.get("/{pid}")
async def get(pid: str, request: Request):
    s = service(request)
    return s.current(s.store.get(pid))


@router.put("/{pid}/brief")
async def brief(pid: str, body: BriefInput, request: Request):
    return service(request).brief(pid, body.expected_revision, body.brief)


@router.post("/{pid}/outline/approve")
async def approve(pid: str, body: OutlineInput, request: Request):
    return service(request).approve_outline(
        pid, body.expected_revision, body.items, body.audience
    )


@router.post("/{pid}/theme")
async def theme(pid: str, body: ThemeInput, request: Request):
    return service(request).apply_theme(
        pid, body.expected_revision, body.audience, body.theme_id
    )


@router.post("/{pid}/jobs")
async def jobs(pid: str, body: JobInput, request: Request):
    return service(request).start_job(
        pid, body.expected_revision, body.operation, body.audience, body.idempotency_key
    )


@router.post("/{pid}/jobs/{jid}/cancel")
async def cancel(pid: str, jid: str, request: Request):
    return await service(request).cancel(pid, jid)


@router.post("/{pid}/revision-proposals")
async def revise(pid: str, body: RevisionInput, request: Request):
    return service(request).start_job(
        pid,
        body.expected_revision,
        "revision",
        body.audience,
        body.idempotency_key,
        {"slide_id": body.slide_id, "instruction": body.instruction},
    )


@router.post("/{pid}/revision-proposals/{cid}/{action}")
async def apply(
    pid: str,
    cid: str,
    action: Literal["apply", "discard"],
    body: VersionInput,
    request: Request,
):
    return service(request).apply(pid, body.expected_revision, cid, action == "discard")


@router.put("/{pid}/slides")
async def edit(pid: str, body: EditInput, request: Request):
    return service(request).edit(
        pid, body.expected_revision, body.audience, body.slides
    )


@router.post("/{pid}/source-check")
async def source_check(pid: str, body: RefreshInput, request: Request):
    s = service(request)
    p = s.store.get(pid)
    s.guard(p, body.expected_revision, idle=False)
    if p.snapshot.kind == "dashboard_demo" and body.dashboard is not None:
        return s.compare(p, dashboard_snapshot(body.dashboard))
    return s.current(p)


@router.post("/{pid}/refresh")
async def refresh(pid: str, body: RefreshInput, request: Request):
    return service(request).refresh(pid, body.expected_revision, body.dashboard)


@router.post("/{pid}/finalize")
async def finalize(pid: str, body: FinalizeInput, request: Request):
    return service(request).finalize(pid, body.expected_revision, body.acknowledgment)


@router.get("/{pid}/export")
async def export(pid: str, request: Request):
    s = service(request)
    p = s.current(s.store.get(pid))
    # Draft exports remain available, with revision/source status embedded.
    return {
        "presentation": p,
        "speaker_notes": {
            a: {slide.id: source_notes(p, slide) for slide in deck.slides}
            for a, deck in p.decks.items()
        },
    }


@router.post("/{pid}/rehearsals")
async def rehearsal(pid: str, body: RehearsalInput, request: Request):
    return service(request).rehearsal_start(
        pid, body.expected_revision, body.persona, body.audience
    )


@router.post("/{pid}/rehearsals/{rid}/answers")
async def answer(pid: str, rid: str, body: AnswerInput, request: Request):
    if not body.answer.strip():
        raise ValueError("Enter your answer before continuing")
    return await service(request).rehearsal_answer(pid, rid, body.answer)


@router.post("/{pid}/voice-messages")
async def voice_message(pid: str, body: VoiceMessage, request: Request):
    s = service(request)
    p = s.store.get(pid)
    if not any(m["id"] == body.id for m in p.voice_messages):
        p.voice_messages.append(body.model_dump())
        s.event(p, "voice", "Presentation conversation message recorded")
    return {"saved": True}


@router.get("/{pid}/events")
async def events(
    pid: str,
    request: Request,
    after: int = 0,
    last_event_id: str | None = Header(default=None),
):
    s = service(request)
    s.store.get(pid)
    cursor = max(after, int(last_event_id or 0))
    if cursor < 0:
        raise ValueError("Event cursor must be nonnegative")

    async def stream():
        nonlocal cursor
        idle = 0
        while not await request.is_disconnected():
            p = s.store.get(pid)
            batch = [e for e in p.events if e["sequence"] > cursor]
            for event in batch:
                cursor = event["sequence"]
                import json

                yield f"id: {cursor}\nevent: presentation\ndata: {json.dumps(event)}\n\n"
            if not batch:
                idle += 1
                if idle % 20 == 0:
                    yield ": heartbeat\n\n"
            await asyncio.sleep(0.3)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
