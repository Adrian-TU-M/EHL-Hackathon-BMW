from __future__ import annotations

import asyncio
import json
from typing import Annotated, Literal

from pydantic import Field, create_model

from moderator.engine import Conflict

from .content import (
    business_argument,
    short,
    templates,
    validate_deck,
    validate_slide,
)
from .design import COPY_BUDGETS, structure_slide, validate_written_copy
from .finance import calculate
from .llm import OllamaWriter
from .models import (
    AudienceOutline,
    BusinessArgument,
    DeckDocument,
    DeckRevision,
    GenerationJob,
    Model,
    OutlineItem,
    Presentation,
    PresentationBrief,
    RehearsalSession,
    RevisionProposal,
    SlideContent,
    SlideContentItem,
    SlideSpec,
    fingerprint,
    now,
)
from .sources import council_snapshot, dashboard_snapshot, demo_brief, demo_snapshot
from .stories import ROLES, audience_outline, outline, reset_outlines, role_of


class Dossier(Model):
    summary: str = Field(max_length=1500)
    objection: str = Field(max_length=1000)
    evidence_ids: list[str]


class OutlineCopy(Model):
    title: str = Field(min_length=1, max_length=100)
    purpose: str = Field(min_length=1, max_length=500)


class OutlineResponse(Model):
    items: list[OutlineCopy] = Field(min_length=12, max_length=12)


class SlideNarrative(Model):
    title: str = Field(min_length=1, max_length=100)
    takeaway: str = Field(max_length=220)
    notes: str = Field(max_length=1500)


class SlideCopy(SlideNarrative):
    points: list[Annotated[str, Field(max_length=180)]] = Field(max_length=4)


class StructuredSlideCopy(SlideNarrative):
    content: SlideContent


def copy_schema(slide):
    if slide.content:
        kind = slide.content.kind
        budgets = COPY_BUDGETS[kind]
        item_schema = create_model(
            f"{kind.title()}CopyItem",
            __base__=SlideContentItem,
            **{
                key: (str, Field(default="", max_length=limit))
                for key, limit in budgets.items()
            },
        )
        content_schema = create_model(
            f"{kind.title()}CopyContent",
            __base__=SlideContent,
            kind=(Literal[kind], ...),
            items=(
                list[item_schema],
                Field(
                    min_length=len(slide.content.items),
                    max_length=len(slide.content.items),
                ),
            ),
        )
        return create_model(
            f"StructuredSlideCopy{kind.title()}",
            __base__=StructuredSlideCopy,
            content=(content_schema, ...),
        )
    return (
        SlideNarrative
        if slide.layout in {"financial", "closing", "cover"}
        else SlideCopy
    )


def with_slide_copy(original: SlideSpec, copy: SlideNarrative) -> SlideSpec:
    # Model output contains prose only. Source identities and disclosure flags
    # are owned by the application, never reproduced by inference.
    values = original.model_dump() | copy.model_dump()
    if isinstance(copy, StructuredSlideCopy):
        if original.content:
            # Model prose never assigns owners/dates or rewrites frozen quotations.
            for item, source in zip(copy.content.items, original.content.items):
                item.owner, item.timing, item.source_id = (
                    source.owner,
                    source.timing,
                    source.source_id,
                )
                if source.source_id:
                    item.detail = source.detail
        values["points"] = [item.detail for item in copy.content.items]
        values["content"] = copy.content.model_dump()
    return SlideSpec.model_validate(values)


class ReviewResponse(Model):
    findings: list[str] = Field(max_length=12)


class RehearsalResponse(Model):
    feedback: str = Field(max_length=1500)
    unanswered_issues: list[Annotated[str, Field(max_length=250)]] = Field(max_length=3)


QUESTIONS = {
    "cfo": [
        "Which assumptions drive the return, and what happens if adoption is lower?",
        "What must the pilot prove before you request the next funding release?",
        "Which costs or benefits still need Finance validation?",
    ],
    "engineering": [
        "Which technical dependency is most likely to prevent delivery?",
        "How will you test failure recovery and safe driver interaction?",
        "Which requirements can you simplify if integration effort is too high?",
    ],
    "executive": [
        "Why should this portfolio receive funding now?",
        "What would make you stop or change the proposal?",
        "What specific decision do you need from leadership today?",
    ],
    "sales": [
        "Which customer benefit can we substantiate today?",
        "What claims must remain unproven until the pilot finishes?",
        "How will you validate messaging with the intended customer segment?",
    ],
}


class PresentationService:
    def __init__(self, store, engine, writer=None):
        self.store, self.engine = store, engine
        self.writer = writer or OllamaWriter()
        self.queue_lock = asyncio.Lock()
        self.tasks = {}
        self.closed = False
        # An interrupted job retains its checkpoints; retry is an explicit new job.
        for p in store.list():
            changed = False
            for job in p.jobs:
                if job.status in {"running", "queued"}:
                    job.status, job.error, job.finished_at = (
                        "failed",
                        "Server restarted; completed checkpoints are retained. Retry explicitly.",
                        now(),
                    )
                    changed = True
            if changed:
                self.event(p, "recovery", "Interrupted jobs recovered")

    def event(self, p, stage, message, **data):
        try:
            latest = self.store.get(p.id)
        except KeyError:
            latest = None
        if latest:
            # Model calls yield to transcript/source endpoints. Retain their writes.
            p.events = latest.events
            p.voice_messages = list(
                {
                    m["id"]: m for m in [*latest.voice_messages, *p.voice_messages]
                }.values()
            )
            sessions = {r.id: r for r in latest.rehearsals}
            for rehearsal in p.rehearsals:
                if rehearsal.id not in sessions or len(rehearsal.messages) >= len(
                    sessions[rehearsal.id].messages
                ):
                    sessions[rehearsal.id] = rehearsal
            p.rehearsals = list(sessions.values())
            if "job_id" in data:
                p.stale, p.update_available = latest.stale, latest.update_available
        p.updated_at = now()
        p.events.append(
            {
                "sequence": len(p.events) + 1,
                "at": now(),
                "stage": stage,
                "message": message,
                **data,
            }
        )
        self.store.save(p)

    def guard(self, p, expected, idle=True):
        if p.revision != expected:
            raise Conflict(
                "Presentation changed. Reload the current revision before applying this action."
            )
        if idle and any(j.status in {"queued", "running"} for j in p.jobs):
            raise Conflict("Wait for generation to finish or cancel it before editing.")

    def archive(self, p, reason, previous=None):
        source = previous or p
        p.history.append(
            DeckRevision(
                revision=p.revision,
                reason=reason,
                snapshot=source.snapshot.model_copy(deep=True),
                brief=source.brief.model_copy(deep=True),
                business_case=source.business_case.model_copy(deep=True),
                outline=[x.model_copy(deep=True) for x in source.outline],
                decks={k: v.model_copy(deep=True) for k, v in source.decks.items()},
                audience_outlines={
                    k: v.model_copy(deep=True)
                    for k, v in source.audience_outlines.items()
                },
            )
        )
        p.revision += 1
        p.finalized_revision = None

    def current(self, p):
        if p.snapshot.kind == "council":
            new = council_snapshot(self.engine, p.snapshot.source_id)
            self.compare(p, new)
        return p

    def compare(self, p, snapshot):
        before = (p.update_available, p.stale)
        p.update_available = snapshot.source_hash != p.snapshot.source_hash
        current = {d.id: d.model_dump() for d in snapshot.decisions}
        p.stale = any(current.get(d.id) != d.model_dump() for d in p.snapshot.decisions)
        if before != (p.update_available, p.stale):
            self.event(
                p,
                "sources",
                "Approved inputs changed; refresh required"
                if p.stale
                else "Source update available"
                if p.update_available
                else "Sources match this revision",
            )
        else:
            self.store.save(p)
        return p

    def create(self, kind, key, dashboard=None, session_id=None, mode="ollama"):
        identity = fingerprint(
            dict(kind=kind, dashboard=dashboard, session_id=session_id, mode=mode)
        )
        receipt = self.store.receipt(key)
        if receipt:
            if receipt[0] != identity:
                raise Conflict(
                    "Idempotency key was already used for a different presentation request"
                )
            return self.current(self.store.get(receipt[1]))
        if kind == "isolated_demo":
            snapshot, brief, mode = demo_snapshot(), demo_brief(), "demo"
        elif kind == "dashboard_demo":
            snapshot, brief = dashboard_snapshot(dashboard or {}), PresentationBrief()
        else:
            snapshot, brief = (
                council_snapshot(self.engine, session_id),
                PresentationBrief(),
            )
        if not snapshot.decisions:
            raise ValueError(
                "No current approved requirements. Approve individual requirements first or load the isolated demo."
            )
        if mode == "demo":
            snapshot.synthetic = True
        p = Presentation(
            mode=mode, snapshot=snapshot, brief=brief, business_case=calculate(brief)
        )
        reset_outlines(p)
        p.events.append(
            {
                "sequence": 1,
                "at": now(),
                "stage": "created",
                "message": "Approved decision snapshot frozen; review the brief and outline",
            }
        )
        self.store.save(p, (key, identity))
        return p

    def reconcile(self, sid):
        if self.closed:
            return
        try:
            for p in self.store.list():
                if p.snapshot.kind == "council" and p.snapshot.source_id == sid:
                    self.current(p)
            session = self.engine.get(sid)
            if (
                session.status != "complete"
                or not council_snapshot(self.engine, sid).decisions
            ):
                return
            key = f"auto-council:{sid}"
            if self.store.receipt(key):
                return
            p = self.create("council", key, session_id=sid)
            self.start_job(
                p.id, p.revision, "outline", p.brief.audience, f"auto-outline:{sid}"
            )
        except (KeyError, ValueError):
            # Presentation readiness cannot alter moderator commits or budgets.
            return

    def brief(self, pid, expected, brief):
        p = self.store.get(pid)
        self.guard(p, expected)
        if p.mode == "ollama" and any(
            i.get("origin") == "synthetic"
            for v in brief.financials.model_dump().values()
            for i in (v if isinstance(v, list) else [v])
        ):
            raise ValueError(
                "Synthetic financial inputs are only allowed in explicit demo mode"
            )
        attribution = {"presenter_name", "presenter_role", "meeting_date"}
        if p.brief.model_dump(exclude=attribution) == brief.model_dump(
            exclude=attribution
        ):
            self.archive(p, "Updated presenter attribution")
            p.brief = brief
            self.event(p, "brief", "Presenter details saved; slide content retained")
            return p
        self.archive(p, "PM changed the brief or financial assumptions")
        p.brief, p.business_case = brief, calculate(brief)
        p.outline_approved = False
        # Keep earlier decks in history; prevent obsolete financial values remaining current.
        p.decks, p.dossiers, p.review_findings = {}, [], []
        reset_outlines(p)
        self.event(p, "brief", "PM brief saved; outline needs review")
        return p

    def refresh(self, pid, expected, dashboard=None):
        p = self.store.get(pid)
        self.guard(p, expected)
        if p.snapshot.kind == "isolated_demo":
            snapshot = demo_snapshot()
        elif p.snapshot.kind == "dashboard_demo":
            if dashboard is None:
                raise ValueError("The current dashboard snapshot is required")
            snapshot = dashboard_snapshot(dashboard)
        else:
            snapshot = council_snapshot(self.engine, p.snapshot.source_id)
        if not snapshot.decisions:
            raise Conflict(
                "No eligible approved requirements remain. Previous versions are preserved."
            )
        self.archive(p, "PM refreshed approved decision inputs")
        if p.mode == "demo":
            snapshot.synthetic = True
        p.snapshot, p.stale, p.update_available = snapshot, False, False
        p.outline, p.outline_approved, p.decks, p.dossiers, p.review_findings = (
            outline(p),
            False,
            {},
            [],
            [],
        )
        reset_outlines(p)
        self.event(p, "snapshot", "New approved decision snapshot frozen")
        return p

    def approve_outline(self, pid, expected, items, audience=None):
        p = self.current(self.store.get(pid))
        self.guard(p, expected)
        if p.stale:
            raise Conflict(
                "Approved decisions changed. Refresh the snapshot before approving the outline."
            )
        if len(items) != 12 or len({i.id for i in items}) != 12:
            raise ValueError("The core outline must contain twelve unique slides")
        audience = audience or p.brief.audience
        baseline = {
            item.id: role_of(item) for item in audience_outline(p, audience).items
        }
        if {role_of(i) for i in items} != set(ROLES) or any(
            baseline.get(i.id) != role_of(i) for i in items
        ):
            raise ValueError(
                "Outline must retain all semantic slide roles and identities"
            )
        if role_of(items[0]) != "cover" or role_of(items[-1]) != "decision":
            raise ValueError("Keep the cover first and the decision last")
        if audience_outline(p, audience).items != items and any(
            s.locked
            for s in p.decks.get(audience, DeckDocument(audience=audience)).slides
        ):
            raise Conflict("Unlock slides before changing this department's outline")
        known = {d.id for d in p.snapshot.decisions}
        if (
            any(not set(i.decision_ids) <= known for i in items)
            or {d for i in items for d in i.decision_ids} != known
        ):
            raise ValueError(
                "Outline must cover the approved portfolio using only its decision IDs"
            )
        changed = audience_outline(p, audience).items != items
        self.archive(p, f"PM approved the {audience} outline")
        p.audience_outlines[audience] = AudienceOutline(items=items, approved=True)
        if changed:
            p.decks.pop(audience, None)
        if audience == p.brief.audience:
            p.outline, p.outline_approved = items, True
        self.event(p, "outline_approved", "PM approved the presentation argument")
        return p

    def start_job(self, pid, expected, operation, audience, key, payload=None):
        p = self.current(self.store.get(pid))
        prior = next((j for j in p.jobs if j.key == key), None)
        if prior:
            if (prior.operation, prior.audience, prior.payload) != (
                operation,
                audience,
                payload or {},
            ):
                raise Conflict("Generation key was already used with different inputs")
            return p
        self.guard(p, expected)
        if p.stale:
            raise Conflict("Refresh stale approved inputs before generation")
        if (
            operation in {"slides", "variant", "revision"}
            and not audience_outline(p, audience).approved
        ):
            raise Conflict("The PM must approve the outline first")
        if operation == "revision":
            deck = p.decks.get(audience)
            slide = (
                next(
                    (s for s in deck.slides if s.id == (payload or {}).get("slide_id")),
                    None,
                )
                if deck
                else None
            )
            if not slide or slide.locked:
                raise Conflict("Select an unlocked slide before requesting a change")
        if (
            operation in {"slides", "variant"}
            and p.decks.get(audience, DeckDocument(audience=audience)).complete
        ):
            raise Conflict(
                "This audience deck already exists. Use targeted revisions or change the brief."
            )
        job = GenerationJob(
            key=key,
            operation=operation,
            audience=audience,
            expected_revision=p.revision,
            payload=payload or {},
        )
        p.jobs.append(job)
        self.event(p, "queued", "Presentation generation queued", job_id=job.id)
        self.tasks[job.id] = asyncio.create_task(self.run(pid, job.id))
        return p

    def checkpoint(self, p, job, message, progress):
        job.message, job.progress = message, progress
        self.event(p, "progress", message, job_id=job.id, progress=progress)

    async def run(self, pid, jid):
        p = self.store.get(pid)
        previous = p.model_copy(deep=True)
        job = next(j for j in p.jobs if j.id == jid)
        try:
            async with self.queue_lock:
                job.status = "running"
                self.checkpoint(p, job, "Reading approved decision dossiers", 5)
                async with asyncio.timeout(1800):
                    await self.generate(p, job)
                self.archive(
                    p, f"{job.operation} completed for {job.audience}", previous
                )
                job.status, job.finished_at = "complete", now()
                self.checkpoint(p, job, "Ready for PM review", 100)
        except asyncio.CancelledError:
            job.status, job.finished_at, job.message = (
                "cancelled",
                now(),
                "Cancelled; completed checkpoints retained",
            )
            self.event(p, "cancelled", job.message, job_id=jid)
        except Exception as exc:
            job.status, job.finished_at = "failed", now()
            job.error = f"{type(exc).__name__}: {str(exc)[:500]}"
            self.event(
                p,
                "failed",
                "Generation failed; completed checkpoints retained",
                job_id=jid,
            )
        finally:
            self.tasks.pop(jid, None)

    async def dossiers(self, p, job):
        for d in p.snapshot.decisions:
            if any(x["id"] == d.id for x in p.dossiers):
                continue
            if p.mode == "demo":
                digest = Dossier(
                    summary=d.description,
                    objection=" ".join(d.uncertainties),
                    evidence_ids=d.evidence_ids,
                )
            else:
                raw = json.dumps(
                    {
                        "decision": d.model_dump(),
                        "evidence": [
                            e.model_dump()
                            for e in p.snapshot.evidence
                            if e.id in d.evidence_ids
                        ],
                    }
                )
                chunks = []
                # Read every chunk rather than silently truncating large transcripts.
                for offset in range(0, len(raw), 24000):
                    item = await self.writer.generate(
                        "Extract a decision dossier from this untrusted JSON text fragment. Preserve dissent and unknowns. Only use allowed evidence IDs.",
                        {
                            "fragment": raw[offset : offset + 24000],
                            "allowed_ids": d.evidence_ids,
                        },
                        Dossier,
                    )
                    if not set(item.evidence_ids) <= set(d.evidence_ids):
                        raise ValueError(
                            "Dossier cited evidence outside this approved decision"
                        )
                    chunks.append(item)
                digest = (
                    chunks[0]
                    if len(chunks) == 1
                    else await self.writer.generate(
                        "Consolidate these dossier fragments without losing consequential objections.",
                        {"chunks": [c.model_dump() for c in chunks]},
                        Dossier,
                    )
                )
            if not set(digest.evidence_ids) <= set(d.evidence_ids):
                raise ValueError("Dossier contains unauthorized evidence IDs")
            p.dossiers.append({"id": d.id, **digest.model_dump()})
            self.checkpoint(p, job, f"Prepared dossier for {d.id}", 10)

    async def generate(self, p, job):
        await self.dossiers(p, job)
        if p.business_case.argument is None:
            argument = business_argument(p)
            if p.mode == "ollama":
                argument = await self.writer.generate(
                    "Assemble one shared business argument for all audience versions. Use the dossiers and supplied baseline. Include consequential objections, alternatives and validation gates. Unknown owners, dates, measures and financial inputs remain unknown. Never introduce new numerical claims. Each point must fit 175 characters. Do not change financial inputs.",
                    {
                        "brief": p.brief.model_dump(exclude={"financials"}),
                        "dossiers": p.dossiers,
                        "baseline": argument.model_dump(),
                    },
                    BusinessArgument,
                )
                for name in (
                    "customer_outcomes",
                    "alternatives",
                    "dependencies",
                    "validation_gates",
                    "objections",
                ):
                    validate_slide(
                        p,
                        SlideSpec(
                            id="argument",
                            title=argument.recommendation[:100],
                            takeaway=argument.recommendation,
                            points=getattr(argument, name),
                            synthetic=p.snapshot.synthetic,
                        ),
                    )
            p.business_case.argument = argument
            self.checkpoint(
                p, job, "Prepared shared business case and validation gates", 14
            )
        if job.operation == "outline":
            current_outline = audience_outline(p, job.audience)
            if current_outline.approved:
                raise Conflict("This department outline is already approved")
            if p.mode == "ollama":
                result = await self.writer.generate(
                    "Refine the title and purpose of each slide in this twelve-slide outline. Return exactly twelve items in the supplied order, with title and purpose only. The application retains slide IDs, decision references, semantic roles and sections. Write for the selected department.",
                    {
                        "brief": p.brief.model_dump(exclude={"financials"}),
                        "dossiers": p.dossiers,
                        "audience": job.audience,
                        "outline": [i.model_dump() for i in current_outline.items],
                    },
                    OutlineResponse,
                )
                current_outline.items = [
                    OutlineItem.model_validate(
                        original.model_dump() | copy.model_dump()
                    )
                    for original, copy in zip(current_outline.items, result.items)
                ]
            p.audience_outlines[job.audience] = current_outline
            if job.audience == p.brief.audience:
                p.outline = current_outline.items
            return
        if job.operation == "revision":
            before = next(
                s
                for s in p.decks[job.audience].slides
                if s.id == job.payload["slide_id"]
            )
            if p.mode == "demo":
                after = before.model_copy(deep=True)
                after.notes = (
                    before.notes
                    + "\nSynthetic revision request: "
                    + job.payload["instruction"]
                )
                after.takeaway = short(
                    "Finance focus: validate costs and incremental contribution"
                    if "financ" in job.payload["instruction"].lower()
                    else "PM emphasis: " + job.payload["instruction"],
                    210,
                )
            else:
                schema = copy_schema(before)
                context = {
                    "instruction": job.payload["instruction"],
                    "slide": before.model_dump(),
                    "brief": p.brief.model_dump(exclude={"financials"}),
                    "dossiers": p.dossiers,
                    "source_passages": [
                        e.model_dump()
                        for e in p.snapshot.evidence
                        if e.id in before.evidence_ids
                    ],
                    "decisions": [
                        d.model_dump()
                        for d in p.snapshot.decisions
                        if d.id in before.decision_ids
                    ],
                }
                copy = await self.writer.generate(
                    "Propose an edit to the prose of this slide, including its structured content when requested by the schema. Preserve content kind, item count and source_id values in the same order. Keep quoted source passages exact, including supplied ellipses. Owners and dates remain unknown unless supplied. The application retains identities, layout, references and disclosure flags. Financial point text is protected. Never introduce numerical assertions or calculate ratios. Ground claims in source passages; individual reports do not establish frequency or business effects. Put detail in notes.",
                    context,
                    schema,
                )
                after = with_slide_copy(before, copy)
                try:
                    validate_written_copy(after)
                    validate_slide(p, after, before)
                except ValueError as exc:
                    copy = await self.writer.generate(
                        "Repair this revision's validation error, changing prose only. Preserve the requested intent and source caveats. Remove unsupported numerical assertions; explain assumptions qualitatively. Do not invent business effects or prevalence.",
                        {
                            **context,
                            "proposed_copy": copy.model_dump(),
                            "error": str(exc),
                        },
                        schema,
                    )
                    after = with_slide_copy(before, copy)
                    validate_written_copy(after)
            validate_slide(p, after, before)
            # Generation itself creates no deck revision; application is a separate PM action.
            p.proposals.append(
                RevisionProposal(
                    expected_revision=p.revision + 1,
                    audience=job.audience,
                    instruction=job.payload["instruction"],
                    before=before,
                    after=after,
                )
            )
            return
        generated = templates(p, job.audience)
        deck = p.decks.setdefault(
            job.audience,
            DeckDocument(audience=job.audience, theme_id="bmw-cinematic-v1"),
        )
        existing = {s.id for s in deck.slides}
        for i, template in enumerate(generated):
            if template.id in existing:
                continue
            if deck.theme_id in {
                "bmw-executive-v1",
                "bmw-executive-v2",
                "bmw-cinematic-v1",
            }:
                template = structure_slide(p, template)
            slide = template
            if p.mode == "ollama" and template.layout not in {
                "cover",
                "financial",
                "closing",
                "appendix",
            }:
                copy = await self.writer.generate(
                    "Write concise prose for this department slide using the requested schema. When content is structured, preserve kind, item count, source_id and exact evidence quotations (including ellipses). Owners, dates, dependencies and conditions must remain unknown unless supplied. No new numerical claims or unsupported business effects. Preserve consequential uncertainties. At most four short items. Prefer short labels and direct language. The application retains layout, references and disclosure flags. Put supporting detail in notes.",
                    {
                        "audience": job.audience,
                        "template": template.model_dump(),
                        "dossiers": p.dossiers,
                        "source_passages": [
                            e.model_dump()
                            for e in p.snapshot.evidence
                            if e.id in template.evidence_ids
                        ][:8],
                    },
                    copy_schema(template),
                )
                slide = with_slide_copy(template, copy)
            try:
                if p.mode == "ollama":
                    validate_written_copy(slide)
                validate_slide(p, slide, template)
            except ValueError as exc:
                if p.mode != "ollama" or slide == template:
                    raise
                copy = await self.writer.generate(
                    "Repair only this slide's prose validation error. Rewrite clipped text as complete natural phrases substantially below the field length limit. Never cut words or leave ellipses. Do not add numbers or unsupported claims; retain uncertainty, field structure and sources.",
                    {
                        "error": str(exc),
                        "slide": slide.model_dump(),
                        "template": template.model_dump(),
                        "dossiers": p.dossiers,
                    },
                    copy_schema(template),
                )
                slide = with_slide_copy(template, copy)
                validate_written_copy(slide)
                validate_slide(p, slide, template)
            deck.slides.append(slide)
            self.checkpoint(
                p,
                job,
                f"Wrote slide {i + 1} of {len(generated)}",
                15 + round(70 * (i + 1) / len(generated)),
            )
            await asyncio.sleep(0)
        validate_deck(p, deck.model_copy(update={"complete": True}))
        if p.mode == "ollama":
            result = await self.writer.generate(
                "Review source support, missing objections, audience clarity and financial consistency. Return only actionable unresolved findings, or an empty list. Unknowns explicitly disclosed are not errors. This check is advisory and does not replace PM review.",
                {
                    "dossiers": p.dossiers,
                    "slides": [s.model_dump(exclude={"notes"}) for s in deck.slides],
                    "business_case": p.business_case.model_dump(),
                },
                ReviewResponse,
            )
            p.review_findings = result.findings
        else:
            p.review_findings = [
                "Synthetic data illustrates the workflow. Real customer evidence, engineering estimates and finance validation are still required."
            ]
        deck.complete = True

    async def cancel(self, pid, jid):
        p = self.store.get(pid)
        if not any(j.id == jid for j in p.jobs):
            raise KeyError(jid)
        task = self.tasks.get(jid)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        # A task cancelled before its first instruction never reaches run's handler.
        p = self.store.get(pid)
        job = next(j for j in p.jobs if j.id == jid)
        if job.status in {"queued", "running"}:
            job.status, job.finished_at, job.message = (
                "cancelled",
                now(),
                "Cancelled; completed checkpoints retained",
            )
            self.event(p, "cancelled", job.message, job_id=jid)
        self.tasks.pop(jid, None)
        return self.store.get(pid)

    def apply_theme(self, pid, expected, audience, theme_id="bmw-cinematic-v1"):
        p = self.store.get(pid)
        self.guard(p, expected)
        deck = p.decks.get(audience)
        if not deck:
            raise Conflict("Generate this department deck first")
        if deck.theme_id == theme_id:
            return p
        self.archive(p, f"Applied {theme_id} to {audience}; slide content retained")
        deck.theme_id = theme_id
        self.event(p, "theme", "Theme applied; text, order and locked slides preserved")
        return p

    def edit(self, pid, expected, audience, slides):
        p = self.store.get(pid)
        self.guard(p, expected)
        deck = p.decks[audience]
        originals = {s.id: s for s in deck.slides}
        if set(originals) != {s.id for s in slides} or len(slides) != len(deck.slides):
            raise ValueError(
                "Manual edits must retain all slide IDs; reorder rather than remove approved coverage"
            )
        for slide in slides:
            validate_slide(p, slide, originals[slide.id])
        self.archive(p, "PM edited or reordered slides")
        deck.slides = slides
        self.event(p, "pm_edit", f"PM revised the {audience} deck")
        return p

    def apply(self, pid, expected, change_id, discard=False):
        p = self.store.get(pid)
        self.guard(p, expected)
        proposal = next((c for c in p.proposals if c.id == change_id), None)
        if not proposal or proposal.status != "pending":
            raise Conflict("This revision proposal is no longer pending")
        if not discard and proposal.expected_revision != p.revision:
            raise Conflict(
                "The deck changed after this suggestion. Request a new revision."
            )
        if not discard:
            original = next(
                s
                for s in p.decks[proposal.audience].slides
                if s.id == proposal.before.id
            )
            validate_slide(p, proposal.after, original)
        self.archive(
            p,
            "PM discarded a proposal" if discard else "PM applied a proposed revision",
        )
        proposal.status = "discarded" if discard else "applied"
        if not discard:
            p.decks[proposal.audience].slides = [
                proposal.after if s.id == proposal.before.id else s
                for s in p.decks[proposal.audience].slides
            ]
        self.event(p, "revision", proposal.status)
        return p

    def finalize(self, pid, expected, acknowledgment):
        p = self.current(self.store.get(pid))
        self.guard(p, expected)
        if p.stale:
            raise Conflict(
                "Approved inputs changed. Refresh and review before finalizing."
            )
        if not p.decks:
            raise ValueError("Generate a presentation first")
        for deck in p.decks.values():
            if not audience_outline(p, deck.audience).approved:
                raise Conflict(
                    "Approve each generated department outline before finalizing"
                )
            validate_deck(p, deck)
        if p.review_findings and not acknowledgment.strip():
            raise ValueError(
                "Record your review of the outstanding findings before finalizing"
            )
        p.finalized_revision = p.revision
        self.event(
            p, "finalized", "PM finalized this revision", rationale=acknowledgment
        )
        return p

    def rehearsal_start(self, pid, expected, persona, audience):
        p = self.store.get(pid)
        self.guard(p, expected)
        if audience not in p.decks or not p.decks[audience].complete:
            raise ValueError("Generate this audience deck before rehearsing")
        rehearsal = RehearsalSession(
            persona=persona,
            audience=audience,
            deck_revision=p.revision,
            messages=[{"role": "assistant", "text": QUESTIONS[persona][0]}],
        )
        p.rehearsals.append(rehearsal)
        self.event(p, "rehearsal", f"Started {persona} rehearsal")
        return p

    async def rehearsal_answer(self, pid, rid, answer):
        p = self.store.get(pid)
        self.guard(p, p.revision)
        rehearsal = next((r for r in p.rehearsals if r.id == rid), None)
        if not rehearsal or rehearsal.complete:
            raise Conflict("Start a new rehearsal session")
        if rehearsal.deck_revision != p.revision:
            raise Conflict(
                "Deck changed. Start a new rehearsal for the current revision."
            )
        turn = sum(m["role"] == "user" for m in rehearsal.messages)
        if turn >= 3:
            raise Conflict("This rehearsal is complete")
        if p.mode == "demo":
            grounding = any(
                d.id.lower() in answer.lower() for d in p.snapshot.decisions
            )
            feedback = (
                "You named an approved decision. Explain its evidence limitations and the release gate."
                if grounding
                else "No approved decision ID was named. Tie your answer to a specific decision and source passage."
            )
            feedback += (
                " Synthetic coaching fixture: answer quality requires PM review."
            )
            next_question = (
                QUESTIONS[rehearsal.persona][turn + 1]
                if turn < 2
                else "Rehearsal complete. Resolve the unanswered points before the meeting."
            )
            if turn == 2:
                next_question += "\nQuestions to resolve:\n" + "\n".join(
                    QUESTIONS[rehearsal.persona]
                )
        else:
            result = await self.writer.generate(
                "Coach the PM as the selected stakeholder persona. Evaluate the answer to current_question against the supplied evidence. Acknowledge what the PM actually addressed, then identify the specific missing support or action. Do not criticize an omission that the answer explicitly acknowledges. Do not repeat generic warnings as the entire feedback. Return concise feedback and up to three concrete unanswered issues across the session. Do not ask questions: the application controls the three-question sequence and ending. On the final turn summarize the strongest answer and remaining actionable gaps. Do not edit the deck.",
                {
                    "persona": rehearsal.persona,
                    "current_question": QUESTIONS[rehearsal.persona][turn],
                    "messages": rehearsal.messages,
                    "answer": answer,
                    "final_turn": turn == 2,
                    "dossiers": p.dossiers,
                    "business_case": p.business_case.model_dump(),
                    "deck": [
                        s.model_dump(exclude={"notes"})
                        for s in p.decks[rehearsal.audience].slides
                    ],
                    "evidence": [e.model_dump() for e in p.snapshot.evidence][:8],
                },
                RehearsalResponse,
            )
            feedback = result.feedback
            if turn < 2:
                next_question = QUESTIONS[rehearsal.persona][turn + 1]
            else:
                next_question = (
                    "Rehearsal complete. Review the feedback before the meeting."
                )
                if result.unanswered_issues:
                    next_question += "\nQuestions to resolve:\n" + "\n".join(
                        result.unanswered_issues
                    )
        latest = self.store.get(pid)
        if latest.revision != p.revision:
            raise Conflict("Deck changed during rehearsal; answer was not applied")
        # Merge into the latest record to retain concurrently saved voice transcripts.
        rehearsal = next(r for r in latest.rehearsals if r.id == rid)
        if sum(m["role"] == "user" for m in rehearsal.messages) != turn:
            raise Conflict("A rehearsal response is already recorded for this turn")
        rehearsal.messages.extend(
            [
                {"role": "user", "text": answer},
                {"role": "assistant", "text": feedback + "\n\n" + next_question},
            ]
        )
        rehearsal.feedback.append(feedback)
        rehearsal.complete = turn == 2
        self.event(
            latest, "rehearsal", "Rehearsal answer reviewed; presentation unchanged"
        )
        return latest

    async def close(self):
        self.closed = True
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.writer.close()
        self.store.close()
