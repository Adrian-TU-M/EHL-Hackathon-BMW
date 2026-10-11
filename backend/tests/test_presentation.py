import asyncio

import httpx
import pytest

from moderator.app import create_app
from moderator.engine import Conflict
from moderator.models import (
    ConfirmAgenda,
    Control,
    JudgeProposal,
    ProposalReviewInput,
    ReviewInput,
)
from presentation.content import scenario_note, validate_slide
from presentation.finance import calculate
from presentation.llm import OllamaWriter
from presentation.models import FinancialInput, PresentationBrief, SlideSpec
from presentation.service import PresentationService
from presentation.sources import (
    council_snapshot,
    dashboard_snapshot,
    demo_brief,
)
from presentation.storage import PresentationStore


class StubWriter:
    """Provider boundary fixture; not evidence of live model reasoning quality."""

    def __init__(self):
        self.fail = False
        self.block = False
        self.entered = asyncio.Event()

    async def health(self):
        return {"available": False, "model": "fixture"}

    async def close(self):
        pass

    async def generate(self, task, data, schema):
        self.entered.set()
        if self.block:
            await asyncio.Event().wait()
        if self.fail:
            raise ValueError("Model unavailable; no fallback")
        if schema is SlideSpec:
            return SlideSpec.model_validate(data["template"])
        if schema.__name__ in {
            "SlideCopy",
            "SlideNarrative",
        } or schema.__name__.startswith("StructuredSlideCopy"):
            original = data.get("template", data.get("slide"))
            return schema.model_validate({k: original[k] for k in schema.model_fields})
        if schema.__name__ == "Dossier":
            return schema(
                summary="Supplied customer need; prevalence unknown",
                objection="Feasibility unverified",
                evidence_ids=data.get(
                    "allowed_ids", data.get("chunks", [{}])[0].get("evidence_ids", [])
                ),
            )
        if schema.__name__ == "OutlineResponse":
            return schema(
                items=[
                    {"title": item["title"], "purpose": item["purpose"]}
                    for item in data["outline"]
                ]
            )
        if schema.__name__ == "BusinessArgument":
            return schema.model_validate(data["baseline"])
        if schema.__name__ == "ReviewResponse":
            return schema(findings=[])
        return schema(
            feedback="Answer needs a source and gate",
            unanswered_issues=["Validate the adoption assumption with Finance."],
        )


@pytest.fixture
def presentations(engine, tmp_path):
    return PresentationService(
        PresentationStore(tmp_path / "decks.sqlite3"), engine, StubWriter()
    )


async def finish(service, pid):
    tasks = list(service.tasks.values())
    await asyncio.gather(*tasks)
    return service.store.get(pid)


async def generated(service):
    p = service.create("isolated_demo", "demo")
    p = service.approve_outline(p.id, p.revision, p.outline)
    service.start_job(p.id, p.revision, "slides", "executive", "slides")
    return await finish(service, p.id)


def test_financial_cash_flow_sensitivity_and_missing_inputs():
    case = calculate(demo_brief())
    assert case.investment == 6_000_000 and case.initial_ask == 600_000
    low, base, high = case.scenarios
    assert base.total_cost == 8_400_000 and base.net_value == 2_100_000
    assert base.roi == 0.25 and base.break_even_year == 3
    assert base.cash_flows == [-600_000, -1_200_000, -300_000, 4_200_000]
    assert low.net_value == pytest.approx(-1_050_000) and low.break_even_year is None
    assert high.net_value == 4_200_000
    assert base.npv == pytest.approx(
        sum(f / 1.1**y for y, f in enumerate(base.cash_flows))
    )
    unknown = calculate(PresentationBrief())
    assert unknown.scenarios == [] and unknown.investment is None
    brief = demo_brief()
    brief.funding_structure = "upfront"
    upfront = calculate(brief)
    assert upfront.initial_ask == 6_000_000
    assert upfront.scenarios[1].net_value == base.net_value
    assert upfront.scenarios[1].npv < base.npv


def test_financial_provenance_and_invalid_rates():
    with pytest.raises(ValueError):
        FinancialInput(value=5, origin="unknown")
    with pytest.raises(ValueError):
        FinancialInput(value=5, origin="sourced")
    brief = demo_brief().model_dump()
    brief["financials"]["adoption"][0]["value"] = 1.5
    with pytest.raises(ValueError):
        PresentationBrief.model_validate(brief)


def test_break_even_excludes_temporary_positive_cash_before_rollout():
    brief = demo_brief()
    brief.financials.development.value = 0
    brief.financials.rollout.value = 8_000_000
    brief.financials.adoption[0].value = 0.3
    brief.financials.adoption[1].value = 0.3
    # Positive at year one, negative after rollout, then sustained at year three.
    base = calculate(brief).scenarios[1]
    assert sum(base.cash_flows[:2]) > 0
    assert sum(base.cash_flows[:3]) < 0
    assert base.break_even_year == 3


def test_dashboard_approval_filter_and_excluded_sources():
    record = dict(
        id="r1",
        title="Controls",
        description="Make controls discoverable",
        version=2,
        approvedVersion=2,
        status="Approved",
        decisionRationale="Reviewed",
        evidenceIds=["e1", "e2"],
    )
    snapshot = dashboard_snapshot(
        {
            "scope": {},
            "requirements": [
                record,
                dict(record, id="pending", status="Pending review"),
                dict(record, id="old", approvedVersion=1),
                dict(record, id="rejected", status="Rejected"),
            ],
            "evidence": [
                dict(id="e1", source="Demo", location="row 1", passage="Sample"),
                dict(
                    id="e2",
                    source="Demo",
                    location="row 2",
                    passage="Excluded",
                    exclusionReason="Wrong scope",
                ),
            ],
        }
    )
    assert [d.id for d in snapshot.decisions] == ["r1"]
    assert snapshot.decisions[0].evidence_ids == ["e1"]
    assert snapshot.synthetic and snapshot.kind == "dashboard_demo"


@pytest.mark.asyncio
async def test_demo_isolated_idempotent_and_complete(presentations, engine):
    p = await generated(presentations)
    assert len(p.decks["executive"].slides) == 15
    assert all(s.synthetic for s in p.decks["executive"].slides)
    assert {d.id for d in p.snapshot.decisions} == {"REQ-001", "REQ-002", "REQ-006"}
    assert p.business_case.scenarios[1].roi == 0.25
    assert engine.sessions == {}
    assert presentations.create("isolated_demo", "demo").id == p.id
    with pytest.raises(Conflict):
        presentations.create("isolated_demo", "demo", mode="demo")
    await presentations.close()


@pytest.mark.asyncio
async def test_revision_proposal_requires_application_and_guards_versions(
    presentations,
):
    p = await generated(presentations)
    original = p.decks["executive"].slides[1].model_dump()
    presentations.start_job(
        p.id,
        p.revision,
        "revision",
        "executive",
        "change",
        {"slide_id": "slide-2", "instruction": "Make this clearer for Finance"},
    )
    p = await finish(presentations, p.id)
    assert p.decks["executive"].slides[1].model_dump() == original
    proposal = p.proposals[-1]
    with pytest.raises(Conflict):
        presentations.apply(p.id, p.revision - 1, proposal.id)
    p = presentations.apply(p.id, p.revision, proposal.id)
    assert p.decks["executive"].slides[1].takeaway.startswith("Finance focus")
    assert p.history and p.proposals[-1].status == "applied"
    assert p.history[-1].decks["executive"].slides[1].model_dump() == original
    await presentations.close()


@pytest.mark.asyncio
async def test_locked_slides_and_financial_text_cannot_be_overwritten(presentations):
    p = await generated(presentations)
    slides = [s.model_copy(deep=True) for s in p.decks["executive"].slides]
    slides[1].locked = True
    p = presentations.edit(p.id, p.revision, "executive", slides)
    with pytest.raises(Conflict):
        presentations.start_job(
            p.id,
            p.revision,
            "revision",
            "executive",
            "locked",
            {"slide_id": "slide-2", "instruction": "change"},
        )
    slides[1].title = "A new title"
    with pytest.raises(ValueError, match="Unlock"):
        presentations.edit(p.id, p.revision, "executive", slides)
    protected = p.decks["executive"].slides[6].model_copy(deep=True)
    protected.points = ["Program capital: $1M"]
    with pytest.raises(ValueError, match="financial assumptions"):
        validate_slide(p, protected)
    foreign = p.decks["executive"].slides[2].model_copy(deep=True)
    foreign.evidence_ids = ["outside-snapshot"]
    with pytest.raises(ValueError, match="outside"):
        validate_slide(p, foreign)
    await presentations.close()


@pytest.mark.asyncio
async def test_audience_variants_share_case_and_rehearsal_preserves_deck(presentations):
    p = await generated(presentations)
    case = p.business_case.model_dump()
    with pytest.raises(Conflict, match="approve the outline"):
        presentations.start_job(p.id, p.revision, "variant", "finance", "blocked")
    p = presentations.approve_outline(
        p.id, p.revision, p.audience_outlines["finance"].items, "finance"
    )
    presentations.start_job(p.id, p.revision, "variant", "finance", "finance")
    p = await finish(presentations, p.id)
    assert p.business_case.model_dump() == case

    def by_role(a, role):
        return next(s for s in p.decks[a].slides if s.role == role)

    assert (
        by_role("executive", "scenarios").points
        == by_role("finance", "scenarios").points
    )
    assert [s.role for s in p.decks["executive"].slides] != [
        s.role for s in p.decks["finance"].slides
    ]
    assert (
        p.decks["executive"].slides[9].takeaway != p.decks["finance"].slides[9].takeaway
    )
    assert p.business_case.argument is not None
    original = p.decks["executive"].model_dump()
    revision = p.revision
    p = presentations.rehearsal_start(p.id, p.revision, "cfo", "executive")
    rid = p.rehearsals[-1].id
    for _ in range(3):
        p = await presentations.rehearsal_answer(
            p.id,
            rid,
            "We will validate adoption and cost before releasing development funding.",
        )
    assert p.rehearsals[-1].complete
    assert p.decks["executive"].model_dump() == original and p.revision == revision
    assert len(p.rehearsals[-1].feedback) == 3
    await presentations.close()


@pytest.mark.asyncio
async def test_stale_dashboard_and_refresh_history(presentations):
    data = {
        "scope": {},
        "requirements": [
            dict(
                id="r",
                title="Controls",
                description="Discoverable controls",
                version=1,
                approvedVersion=1,
                status="Approved",
                decisionRationale="PM reviewed",
                evidenceIds=[],
            )
        ],
    }
    p = presentations.create("dashboard_demo", "dashboard", dashboard=data, mode="demo")
    data["requirements"][0]["status"] = "Pending review"
    p = presentations.compare(p, dashboard_snapshot(data))
    assert p.stale and p.update_available
    with pytest.raises(Conflict, match="changed"):
        presentations.approve_outline(p.id, p.revision, p.outline)
    data["requirements"][0].update(version=2, approvedVersion=2, status="Approved")
    p = presentations.refresh(p.id, p.revision, data)
    assert not p.stale and not p.outline_approved
    assert p.history[-1].snapshot.decisions[0].version == 1
    assert p.snapshot.decisions[0].version == 2
    await presentations.close()


async def council_outcome(engine, scope):
    session = await engine.create(scope)
    session = await engine.confirm(
        session.id,
        ConfirmAgenda(
            expected_version=session.agenda.version,
            selected_ids=[session.agenda.topics[0].id],
        ),
    )
    await engine.control(
        session.id,
        Control(
            action="start", expected_revision=session.revision, idempotency_key="start"
        ),
    )
    await engine.tasks[session.id]
    outcome = session.outcomes[0]
    outcome.assessment.proposals = [
        JudgeProposal(
            id="p1",
            title="Discoverable controls",
            description="Make controls accessible",
            evidence_ids=["f1"],
        )
    ]
    engine.store.save(session)
    return session, outcome


@pytest.mark.asyncio
async def test_outcome_review_is_not_requirement_approval(engine, scope, presentations):
    s, o = await council_outcome(engine, scope)
    await engine.review(
        s.id,
        o.topic_id,
        ReviewInput(
            expected_version=o.version, status="Approved", rationale="Outcome reviewed"
        ),
    )
    assert not council_snapshot(engine, s.id).decisions
    with pytest.raises(Conflict):
        await engine.review_proposal(
            s.id,
            o.topic_id,
            "p1",
            ProposalReviewInput(
                expected_version=2,
                expected_outcome_version=o.version,
                status="Approved",
                rationale="PM reviewed",
            ),
        )
    await engine.review_proposal(
        s.id,
        o.topic_id,
        "p1",
        ProposalReviewInput(
            expected_version=1,
            expected_outcome_version=o.version,
            status="Approved",
            rationale="Pilot this requirement",
        ),
    )
    assert (
        council_snapshot(engine, s.id).decisions[0].pm_rationale
        == "Pilot this requirement"
    )
    presentations.reconcile(s.id)
    presentations.reconcile(s.id)
    assert len(presentations.store.list()) == 1
    p = presentations.store.list()[0]
    p = await finish(presentations, p.id)
    assert p.jobs[-1].status == "complete", p.jobs[-1].error
    o.version += 1
    o.assessment_valid = False
    assert not council_snapshot(engine, s.id).decisions
    assert presentations.current(p).stale
    await presentations.close()


@pytest.mark.asyncio
async def test_live_failure_and_cancellation_keep_checkpoints(presentations):
    data = {
        "scope": {},
        "requirements": [
            dict(
                id="r",
                title="Controls",
                description="Discoverable controls",
                version=1,
                approvedVersion=1,
                status="Approved",
                decisionRationale="PM reviewed",
                evidenceIds=[],
            )
        ],
    }
    p = presentations.create("dashboard_demo", "live", dashboard=data)
    p = presentations.approve_outline(p.id, p.revision, p.outline)
    presentations.writer.fail = True
    presentations.start_job(p.id, p.revision, "slides", "executive", "failed")
    p = await finish(presentations, p.id)
    assert p.jobs[-1].status == "failed" and p.mode == "ollama"
    assert p.snapshot.decisions and p.outline_approved
    presentations.writer.fail, presentations.writer.block = False, True
    presentations.writer.entered.clear()
    p = presentations.start_job(p.id, p.revision, "slides", "executive", "cancel")
    await presentations.writer.entered.wait()
    p = await presentations.cancel(p.id, p.jobs[-1].id)
    assert p.jobs[-1].status == "cancelled" and p.outline_approved
    await presentations.close()


@pytest.mark.asyncio
async def test_api_demo_flow_version_conflict_export_and_invalid_payload(engine):
    app = create_app(engine)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                "/api/presentations",
                json={"kind": "isolated_demo", "idempotency_key": "api-demo"},
            )
            assert r.status_code == 201
            p = r.json()
            response = await client.post(
                f"/api/presentations/{p['id']}/outline/approve",
                json={"expected_revision": 99, "items": p["outline"]},
            )
            assert response.status_code == 409
            p = (
                await client.post(
                    f"/api/presentations/{p['id']}/outline/approve",
                    json={"expected_revision": p["revision"], "items": p["outline"]},
                )
            ).json()
            p = (
                await client.post(
                    f"/api/presentations/{p['id']}/jobs",
                    json={
                        "expected_revision": p["revision"],
                        "operation": "slides",
                        "audience": "executive",
                        "idempotency_key": "api-slides",
                    },
                )
            ).json()
            await finish(app.state.presentations, p["id"])
            exported = (await client.get(f"/api/presentations/{p['id']}/export")).json()
            assert len(exported["presentation"]["decks"]["executive"]["slides"]) == 15
            assert "SYNTHETIC DEMO" in exported["speaker_notes"]["executive"]["slide-1"]
            assert (
                "Presentation fixture"
                in exported["speaker_notes"]["executive"]["slide-1"]
            )


@pytest.mark.asyncio
async def test_immediate_cancel_duplicate_job_and_restart_recovery(presentations):
    p = presentations.create("isolated_demo", "immediate")
    p = presentations.approve_outline(p.id, p.revision, p.outline)
    p = presentations.start_job(p.id, p.revision, "slides", "executive", "once")
    duplicate = presentations.start_job(p.id, 999, "slides", "executive", "once")
    assert len(duplicate.jobs) == 1
    cancelled = await presentations.cancel(p.id, p.jobs[-1].id)
    assert cancelled.jobs[-1].status == "cancelled"
    cancelled.jobs[-1].status = "running"
    presentations.store.save(cancelled)
    recovered = PresentationService(
        presentations.store, presentations.engine, presentations.writer
    )
    assert recovered.store.get(p.id).jobs[-1].status == "failed"
    assert "restarted" in recovered.store.get(p.id).jobs[-1].error
    assert recovered.store.get(p.id).outline_approved
    await recovered.close()


@pytest.mark.asyncio
async def test_generation_merges_voice_messages_and_source_flags(presentations):
    p = presentations.create("isolated_demo", "merge")
    p.mode = "ollama"
    presentations.store.save(p)
    presentations.writer.block = True
    p = presentations.start_job(p.id, p.revision, "outline", "executive", "merge-job")
    await presentations.writer.entered.wait()
    latest = presentations.store.get(p.id)
    latest.voice_messages.append(
        {"id": "voice-1", "role": "user", "text": "Please clarify the pilot."}
    )
    latest.stale = True
    presentations.event(latest, "voice", "Voice message recorded")
    p = await presentations.cancel(p.id, p.jobs[-1].id)
    assert p.voice_messages[0]["id"] == "voice-1" and p.stale
    assert [e["sequence"] for e in p.events] == list(range(1, len(p.events) + 1))
    assert any(e["stage"] == "voice" for e in p.events)
    await presentations.close()


@pytest.mark.asyncio
async def test_failed_slide_job_resumes_checkpoints_and_preserves_pm_edits(
    presentations,
):
    class CheckpointWriter(StubWriter):
        def __init__(self):
            super().__init__()
            self.interrupt_once = True
            self.written = []

        async def generate(self, task, data, schema):
            if schema.__name__ == "SlideCopy" or schema.__name__.startswith(
                "StructuredSlideCopy"
            ):
                sid = data["template"]["id"]
                self.written.append(sid)
                if sid == "slide-3" and self.interrupt_once:
                    self.interrupt_once = False
                    raise ValueError("Fixture provider interrupted on the third slide")
            return await super().generate(task, data, schema)

    presentations.writer = CheckpointWriter()
    p = presentations.create("isolated_demo", "checkpoint")
    p.mode = "ollama"  # Real provider path with explicitly synthetic inputs.
    presentations.store.save(p)
    p = presentations.approve_outline(p.id, p.revision, p.outline)
    presentations.start_job(p.id, p.revision, "slides", "executive", "interrupt")
    p = await finish(presentations, p.id)
    assert p.jobs[-1].status == "failed"
    deck = p.decks["executive"]
    assert len(deck.slides) == 2 and not deck.complete
    deck.slides[1].takeaway = "The PM's carefully reviewed message"
    deck.slides[1].locked = True
    p = presentations.edit(p.id, p.revision, "executive", deck.slides)
    saved = p.decks["executive"].slides[1].model_dump()
    presentations.start_job(p.id, p.revision, "slides", "executive", "resume")
    p = await finish(presentations, p.id)
    assert p.jobs[-1].status == "complete", p.jobs[-1].error
    assert len(p.decks["executive"].slides) == 15
    assert p.decks["executive"].slides[1].model_dump() == saved
    assert presentations.writer.written.count("slide-2") == 1
    assert p.decks["executive"].complete
    await presentations.close()


def test_scenario_priority_preserves_unknown_coverage_and_is_not_money(presentations):
    p = presentations.create("isolated_demo", "scenario")
    text = scenario_note(
        p,
        {"need": 5, "severity": None, "gap": None, "future": None, "feasibility": None},
    )
    assert "100/100" in text and "30%" in text and "not monetary" in text
    snapshot = p.snapshot.model_copy(deep=True)
    snapshot.weights["need"] = 40
    snapshot.source_hash = "new-scenario"
    result = presentations.compare(p, snapshot)
    assert result.update_available and not result.stale
    assert result.business_case.scenarios[1].net_value == 2_100_000


@pytest.mark.asyncio
async def test_ollama_schema_format_one_repair_and_no_synthetic_fallback():
    import json

    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        value = "invalid json" if len(requests) == 1 else json.dumps({"findings": []})
        return httpx.Response(200, json={"message": {"content": value}})

    from presentation.service import ReviewResponse

    writer = OllamaWriter()
    await writer.client.aclose()
    writer.client = httpx.AsyncClient(
        transport=httpx.MockTransport(respond), timeout=180
    )
    result = await writer.generate("Review", {}, ReviewResponse)
    assert result.findings == [] and len(requests) == 2
    assert requests[0]["format"] == ReviewResponse.model_json_schema()
    assert requests[0]["think"] is False and requests[0]["options"]["num_ctx"] == 16384
    assert "schema error" in requests[1]["messages"][1]["content"]
    requests.clear()
    await writer.client.aclose()
    writer.client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"message": {"content": "{}"}})
        ),
        timeout=180,
    )
    with pytest.raises(ValueError, match="after one repair"):
        await writer.generate("Review", {}, ReviewResponse)
    await writer.close()


@pytest.mark.asyncio
async def test_model_writes_prose_without_reproducing_source_metadata(presentations):
    from presentation.service import OutlineCopy, SlideCopy, SlideNarrative

    p = presentations.create("isolated_demo", "prose-only")
    p.mode = "ollama"
    presentations.store.save(p)
    originals = [i.model_dump() for i in p.outline]
    presentations.start_job(p.id, p.revision, "outline", "executive", "outline")
    p = await finish(presentations, p.id)
    assert p.jobs[-1].status == "complete", p.jobs[-1].error
    assert [i.model_dump() for i in p.outline] == originals
    p = presentations.approve_outline(p.id, p.revision, p.outline)
    presentations.start_job(p.id, p.revision, "slides", "executive", "slides")
    p = await finish(presentations, p.id)
    assert p.jobs[-1].status == "complete", p.jobs[-1].error
    assert all(s.synthetic for s in p.decks["executive"].slides)
    financial = next(s for s in p.decks["executive"].slides if s.layout == "financial")
    original = financial.model_dump()
    presentations.start_job(
        p.id,
        p.revision,
        "revision",
        "executive",
        "edit-finance",
        {"slide_id": financial.id, "instruction": "Clarify the speaking guidance"},
    )
    p = await finish(presentations, p.id)
    assert p.jobs[-1].status == "complete", p.jobs[-1].error
    assert p.proposals[-1].after.model_dump() == original
    assert p.decks["executive"].slides == p.history[-1].decks["executive"].slides
    for schema in (OutlineCopy, SlideCopy, SlideNarrative):
        assert (
            not {"id", "role", "section", "decision_ids", "evidence_ids", "synthetic"}
            & schema.model_fields.keys()
        )
    assert "points" not in SlideNarrative.model_fields
    with pytest.raises(ValueError):
        OutlineCopy(
            title="A conclusion",
            purpose="Explain the case",
            decision_ids=["unapproved"],
        )
    await presentations.close()


@pytest.mark.asyncio
async def test_live_revision_repairs_unsupported_number_before_proposing(presentations):
    class RepairWriter(StubWriter):
        attempts = 0

        async def generate(self, task, data, schema):
            result = await super().generate(task, data, schema)
            if schema.__name__ == "SlideNarrative":
                self.attempts += 1
                if self.attempts == 1:
                    result.notes = "Invented return ratio: 963111"
                else:
                    assert "Unreferenced numerical assertion" in data["error"]
                    result.notes = "Finance must validate the return assumptions."
            return result

    p = await generated(presentations)
    p.mode = "ollama"
    presentations.store.save(p)
    presentations.writer = RepairWriter()
    before = p.decks["executive"].model_dump()
    slide = next(s for s in p.decks["executive"].slides if s.layout == "financial")
    presentations.start_job(
        p.id,
        p.revision,
        "revision",
        "executive",
        "repair-revision",
        {"slide_id": slide.id, "instruction": "Clarify the Finance explanation"},
    )
    p = await finish(presentations, p.id)
    assert p.jobs[-1].status == "complete", p.jobs[-1].error
    assert presentations.writer.attempts == 2
    assert (
        p.proposals[-1].after.notes == "Finance must validate the return assumptions."
    )
    assert p.proposals[-1].after.points == slide.points
    assert p.decks["executive"].model_dump() == before
    await presentations.close()


@pytest.mark.asyncio
async def test_live_rehearsal_progresses_and_finishes_without_repeated_questions(
    presentations,
):
    from presentation.service import QUESTIONS

    p = await generated(presentations)
    p.mode = "ollama"
    presentations.store.save(p)
    before = p.decks["executive"].model_dump()
    revision = p.revision
    p = presentations.rehearsal_start(p.id, p.revision, "cfo", "executive")
    rid = p.rehearsals[-1].id
    for turn in range(3):
        p = await presentations.rehearsal_answer(
            p.id, rid, "These assumptions require validation."
        )
        response = p.rehearsals[-1].messages[-1]["text"]
        if turn < 2:
            assert response.endswith(QUESTIONS["cfo"][turn + 1])
        else:
            assert "Rehearsal complete" in response
            assert "Validate the adoption assumption with Finance." in response
            assert not any(q in response for q in QUESTIONS["cfo"])
        assert p.decks["executive"].model_dump() == before and p.revision == revision
    assert p.rehearsals[-1].complete
    await presentations.close()


@pytest.mark.asyncio
async def test_theme_upgrade_and_presenter_details_preserve_pm_work(presentations):
    p = await generated(presentations)
    deck = p.decks["executive"]
    deck.theme_id = "legacy-v1"
    deck.slides[2].title = "A personally reviewed evidence argument"
    deck.slides[2].locked = True
    before = deck.model_dump()
    frozen = p.snapshot.model_dump()
    presentations.store.save(p)
    old_revision = p.revision
    p = presentations.apply_theme(p.id, p.revision, "executive")
    assert p.revision == old_revision + 1
    assert p.history[-1].decks["executive"].model_dump() == before
    assert p.snapshot.model_dump() == frozen
    expected = dict(before, theme_id="bmw-cinematic-v1")
    assert p.decks["executive"].model_dump() == expected
    brief = p.brief.model_copy(
        update={
            "presenter_name": "Alex",
            "presenter_role": "Product Manager",
            "meeting_date": "2026-10-10",
        }
    )
    p = presentations.brief(p.id, p.revision, brief)
    assert p.decks["executive"].model_dump() == expected
    assert p.audience_outlines["executive"].approved
    with pytest.raises(Conflict):
        presentations.apply_theme(p.id, old_revision, "executive")
    await presentations.close()


@pytest.mark.asyncio
async def test_structured_sources_finance_and_locks_remain_protected(presentations):
    p = await generated(presentations)
    deck = p.decks["executive"]
    evidence = next(s for s in deck.slides if s.role == "evidence")
    assert evidence.content.kind == "evidence"
    changed = evidence.model_copy(deep=True)
    changed.content.items[0].detail = "A different claim"
    with pytest.raises(ValueError, match="quotations"):
        validate_slide(p, changed, evidence)
    changed = evidence.model_copy(deep=True)
    changed.content.items[0].source_id = "outside-snapshot"
    with pytest.raises(ValueError, match="frozen sources"):
        validate_slide(p, changed, evidence)
    changed = evidence.model_copy(deep=True)
    changed.content.items.pop()
    with pytest.raises(ValueError, match="item count"):
        validate_slide(p, changed, evidence)
    investment = next(s for s in deck.slides if s.role == "investment")
    changed = investment.model_copy(deep=True)
    changed.content = evidence.content
    with pytest.raises(ValueError):
        validate_slide(p, changed, investment)
    evidence.locked = True
    changed = evidence.model_copy(deep=True)
    changed.content.items[0].condition = "New limitation"
    with pytest.raises(ValueError, match="Unlock"):
        validate_slide(p, changed, evidence)
    await presentations.close()


@pytest.mark.asyncio
async def test_structured_revision_is_proposed_then_applied(presentations):
    class StructuredWriter(StubWriter):
        async def generate(self, task, data, schema):
            result = await super().generate(task, data, schema)
            if schema.__name__.startswith("StructuredSlideCopy"):
                result.content.items[0].detail = "Test the customer need before scaling"
                result.content.items[0].owner = "Invented owner"
                result.content.items[0].timing = "Invented deadline"
            return result

    p = await generated(presentations)
    slide = next(s for s in p.decks["executive"].slides if s.role == "problem")
    before = slide.model_dump()
    p.mode = "ollama"
    presentations.store.save(p)
    presentations.writer = StructuredWriter()
    presentations.start_job(
        p.id,
        p.revision,
        "revision",
        "executive",
        "structured-edit",
        {"slide_id": slide.id, "instruction": "Make this concise"},
    )
    p = await finish(presentations, p.id)
    assert p.jobs[-1].status == "complete", p.jobs[-1].error
    assert (
        next(s for s in p.decks["executive"].slides if s.id == slide.id).model_dump()
        == before
    )
    proposal = p.proposals[-1]
    assert proposal.after.content.items[0].owner == slide.content.items[0].owner
    assert proposal.after.content.items[0].timing == slide.content.items[0].timing
    assert (
        proposal.after.content.items[0].detail
        == "Test the customer need before scaling"
    )
    p = presentations.apply(p.id, p.revision, proposal.id)
    assert (
        next(s for s in p.decks["executive"].slides if s.id == slide.id)
        .content.items[0]
        .detail
        == "Test the customer need before scaling"
    )
    await presentations.close()


def test_model_copy_repair_detects_chopped_words():
    from presentation.design import validate_written_copy
    from presentation.models import SlideContent, SlideContentItem

    slide = SlideSpec(
        id="risk",
        role="risks",
        title="Resolve material objections",
        content=SlideContent(kind="risks", items=[SlideContentItem(detail="x" * 75)]),
    )
    with pytest.raises(ValueError, match="complete concise phrase"):
        validate_written_copy(slide)
    slide.content.items[0].detail = "A complete sentence with an unfinished..."
    with pytest.raises(ValueError, match="ellipses"):
        validate_written_copy(slide)
    slide.content.items[0].detail = "Validate the benefit before commitment."
    validate_written_copy(slide)


@pytest.mark.asyncio
async def test_theme_target_is_idempotent_and_legacy_content_is_not_inferred(
    presentations,
):
    p = await generated(presentations)
    same = presentations.apply_theme(p.id, p.revision, "executive")
    assert same.revision == p.revision
    p = presentations.apply_theme(p.id, p.revision, "executive", "premium-v1")
    for slide in p.decks["executive"].slides:
        slide.content = None
        slide.layout_id = None
    presentations.store.save(p)
    before = [s.model_dump() for s in p.decks["executive"].slides]
    p = presentations.apply_theme(p.id, p.revision, "executive", "bmw-executive-v1")
    assert [s.model_dump() for s in p.decks["executive"].slides] == before
    assert all(s.content is None for s in p.decks["executive"].slides)
    await presentations.close()


@pytest.mark.asyncio
async def test_department_outlines_roles_and_clean_language(presentations):
    from presentation.content import source_notes
    from presentation.stories import ROLES

    p = await generated(presentations)
    case = p.business_case.model_dump()
    for audience in ("finance", "engineering", "sales"):
        items = p.audience_outlines[audience].items
        assert len({i.section for i in items}) == 3
        assert {i.role for i in items} == set(ROLES)
        p = presentations.approve_outline(p.id, p.revision, items, audience)
        presentations.start_job(p.id, p.revision, "variant", audience, audience)
        p = await finish(presentations, p.id)
        assert p.jobs[-1].status == "complete", p.jobs[-1].error
        assert p.business_case.model_dump() == case
    assert len(p.decks) == 4
    for deck in p.decks.values():
        assert deck.theme_id == "bmw-cinematic-v1" and len(deck.slides) == 15
        for slide in deck.slides:
            text = " ".join(
                [slide.title, slide.takeaway, *slide.points, source_notes(p, slide)]
            )
            assert "PM rationale:" not in text and "PM approval:" not in text
            assert "approved version" not in text
            assert "SOURCE REFERENCES" in source_notes(p, slide)
    # A department cannot relabel a financial role to bypass calculated-content checks.
    items = [i.model_copy(deep=True) for i in p.audience_outlines["finance"].items]
    items[1].role = "problem"
    with pytest.raises(ValueError, match="semantic"):
        presentations.approve_outline(p.id, p.revision, items, "finance")
    await presentations.close()


def test_legacy_records_decode_without_rewriting_decks(presentations):
    p = presentations.create("isolated_demo", "legacy")
    raw = p.model_dump()
    raw.pop("audience_outlines")
    raw["outline_approved"] = True
    raw["decks"] = {
        "executive": {"audience": "executive", "slides": [], "complete": False}
    }
    import json

    restored = presentations.store.decode(json.dumps(raw))
    assert restored.audience_outlines["executive"].approved
    assert not restored.audience_outlines["finance"].approved
    assert restored.decks["executive"].theme_id == "legacy-v1"
