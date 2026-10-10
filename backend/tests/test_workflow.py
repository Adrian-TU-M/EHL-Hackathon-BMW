import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from moderator.adapters import DeterministicAdapters, Reply
from moderator.app import create_app
from moderator.engine import Conflict, Engine
from moderator.models import (
    Assumption,
    AssumptionChange,
    ConfirmAgenda,
    Control,
    Limits,
    ReviewInput,
)


async def confirmed(engine, scope, selected=1, limits=None):
    s = await engine.create(scope, limits=limits)
    await engine.confirm(
        s.id,
        ConfirmAgenda(
            expected_version=1, selected_ids=s.agenda.selected_ids[:selected]
        ),
    )
    return s


async def control(engine, s, action="start", rationale="", **kwargs):
    return await engine.control(
        s.id,
        Control(
            action=action,
            expected_revision=s.revision,
            idempotency_key=f"{action}-{s.revision}",
            rationale=rationale,
            **kwargs,
        ),
    )


class Recording(DeterministicAdapters):
    def __init__(self):
        self.calls = []
        self.openings = set()

    async def call(self, actor, operation, data, *args):
        self.calls.append((actor, operation, data))
        if operation == "perspective":
            assert "positions" not in data  # no other opening leaked
            self.openings.add(actor)
            await asyncio.sleep(0.002)
            assert len(self.openings) == 3  # starts are concurrent
        return await super().call(actor, operation, data, *args)


async def test_independent_challenges_dissent_and_automatic_advancement(engine, scope):
    adapter = Recording()
    engine.adapters = adapter
    s = await confirmed(engine, scope, 2)
    await control(engine, s)
    await engine.tasks[s.id]
    assert s.status == "complete" and len(s.outcomes) == 2
    assert all(o.review_status == "Pending review" for o in s.outcomes)
    for o in s.outcomes:
        assert {p.actor for p in o.packet.positions} == {
            "customer",
            "market",
            "competitor",
        }
        assert next(
            p for p in o.packet.positions if p.actor == "competitor"
        ).abstention_reason
        assert len([e for e in o.packet.transcript if e.stage == "challenge"]) == 3
        assert all(c.status != "open" for c in o.packet.challenges)
        assert any(c.status == "unresolved" for c in o.packet.challenges)
        assert o.closure_reason == "unresolved_disagreement"
        assert o.packet.source_snapshot == s.agenda.source_snapshot
        assert o.packet.transcript[-1].stage == "closure"
    assert not any(operation == "clarification" for _, operation, _ in adapter.calls)
    ev = engine.store.events(s.id)
    assert [x.sequence for x in ev] == list(range(1, len(ev) + 1))
    assert [x.sequence for x in engine.store.events(s.id, after=3)] == list(
        range(4, len(ev) + 1)
    )


class Clarifying(DeterministicAdapters):
    def __init__(self, actor="customer"):
        self.actor, self.questions = actor, 0

    async def call(self, actor, operation, data, *args):
        reply = await super().call(actor, operation, data, *args)
        if operation == "assessment":
            eid = next(e["id"] for e in data["evidence"] if e["domain"] == "customer")
            reply.data["clarification"] = {
                "actor": self.actor,
                "question": "What is documented for this population?",
                "rationale": "Could change applicability",
                "material": True,
                "answerable": True,
                "evidence_ids": [eid],
            }
        if operation == "clarification":
            self.questions += 1
        return reply


@pytest.mark.parametrize("actor,expected", [("customer", 1), ("competitor", 0)])
async def test_only_material_answerable_single_clarification(
    engine, scope, actor, expected
):
    a = Clarifying(actor)
    engine.adapters = a
    s = await confirmed(engine, scope)
    await control(engine, s)
    await engine.tasks[s.id]
    assert a.questions == expected and s.status == "complete"


class Invalid(DeterministicAdapters):
    def __init__(self):
        self.counts = {}

    async def call(self, actor, operation, data, *args):
        if operation == "perspective" and actor == "customer":
            self.counts[operation] = self.counts.get(operation, 0) + 1
            return Reply({"malformed": True}, 50)
        return await super().call(actor, operation, data, *args)


async def test_single_malformed_repair_and_incomplete_not_consensus(engine, scope):
    a = Invalid()
    engine.adapters = a
    s = await confirmed(engine, scope)
    await control(engine, s)
    await engine.tasks[s.id]
    assert a.counts["perspective"] == 2
    assert s.outcomes[0].closure_reason == "insufficient_evidence"
    assert next(
        p for p in s.outcomes[0].packet.positions if p.actor == "customer"
    ).abstention_reason


class Slow(DeterministicAdapters):
    async def call(self, actor, operation, data, *args):
        if operation == "perspective":
            await asyncio.sleep(1)
        return await super().call(actor, operation, data, *args)


async def test_timeout_incomplete(engine, scope):
    engine.adapters = Slow()
    s = await confirmed(engine, scope, limits=Limits(call_seconds=0.01))
    await control(engine, s)
    await engine.tasks[s.id]
    assert s.outcomes[0].closure_reason == "insufficient_evidence"
    assert all(p.abstention_reason for p in s.outcomes[0].packet.positions)


async def test_pause_cancel_late_responses_interrupt_skip_reorder_finish(engine, scope):
    engine.adapters = Slow()
    s = await confirmed(engine, scope, 3)
    await control(engine, s)
    await asyncio.sleep(0.005)
    await control(engine, s, "pause")
    assert s.status == "paused" and not s.work.positions
    count = s.sequence
    await asyncio.sleep(0.02)
    assert s.sequence == count  # superseded results cannot publish
    assert s.work.tokens > 0  # cancelled reservations stay charged
    rest = s.agenda.selected_ids[1:]
    await control(engine, s, "reorder", "PM order", topic_ids=list(reversed(rest)))
    await control(engine, s, "interrupt")
    assert s.status == "interrupted"
    await control(engine, s, "skip", "Defer first topic")
    await asyncio.sleep(0.005)
    assert s.outcomes[0].closure_reason == "pm_stopped"
    await control(engine, s, "finish", "PM ending session")
    assert s.status == "complete" and len(s.outcomes) >= 1
    with pytest.raises(Conflict):
        await control(engine, s, "resume")


async def test_restart_pauses_and_retains_atomic_checkpoint(engine, scope):
    engine.adapters = Slow()
    s = await confirmed(engine, scope)
    await control(engine, s)
    await asyncio.sleep(0.005)
    await engine.cancel(s.id)
    assert (
        engine.store.get(s.id).status == "running"
    )  # cancellation itself is not PM pause
    recovered = Engine(engine.catalog, engine.store, DeterministicAdapters())
    assert recovered.get(s.id).status == "paused"
    assert recovered.get(s.id).work.tokens > 0
    assert recovered.store.events(s.id)[-1].stage == "recovery"
    await control(recovered, recovered.get(s.id), "resume")
    await recovered.tasks[s.id]
    assert recovered.get(s.id).status == "complete"


async def test_budget_is_not_renewed_on_resume(engine, scope):
    s = await confirmed(
        engine, scope, limits=Limits(topic_tokens=100, session_tokens=200)
    )
    await control(engine, s)
    await engine.tasks[s.id]
    assert s.status == "complete" and s.outcomes[0].closure_reason == "budget_exhausted"
    with pytest.raises(Conflict):
        await control(engine, s, "resume")
    linked = await engine.create(scope, parent=s.id)
    assert linked.parent_session_id == s.id and linked.run_id != s.run_id


async def test_command_idempotency_and_version_conflict(engine, scope):
    s = await confirmed(engine, scope)
    cmd = Control(action="pause", expected_revision=s.revision, idempotency_key="pause")
    await engine.control(s.id, cmd)
    sequence = s.sequence
    await engine.control(s.id, cmd)
    assert s.sequence == sequence
    with pytest.raises(Conflict):
        await engine.control(s.id, cmd.model_copy(update={"action": "resume"}))
    with pytest.raises(Conflict):
        await engine.control(
            s.id, Control(action="start", expected_revision=0, idempotency_key="stale")
        )


async def test_assumption_versions_invalidate_only_dependents(engine, scope):
    s = await confirmed(engine, scope, 2)
    s.assumptions = [
        Assumption(
            id="A1",
            statement="Transfer holds under scenario",
            author="PM",
            scope=scope,
            rationale="Test scenario",
            validation_needed="Scoped research",
        )
    ]
    await control(engine, s)
    await engine.tasks[s.id]
    s.outcomes[0].packet.claims[0].assumption_ids = ["A1"]
    await engine.change_assumption(
        s.id,
        "A1",
        AssumptionChange(
            expected_version=1,
            statement="Transfer contested",
            status="contested",
            rationale="Counterevidence",
        ),
    )
    assert s.assumptions[0].version == 2 and s.assumption_history[0].version == 1
    assert not s.outcomes[0].assessment_valid and s.outcomes[0].version == 2
    assert s.outcomes[1].assessment_valid and s.outcomes[1].version == 1
    assert s.outcomes[1].packet.assumptions[0].version == 1
    with pytest.raises(Conflict):
        await engine.review(
            s.id,
            s.outcomes[0].topic_id,
            ReviewInput(expected_version=1, status="Approved", rationale="stale"),
        )
    with pytest.raises(Conflict):
        await engine.review(
            s.id,
            s.outcomes[0].topic_id,
            ReviewInput(expected_version=2, status="Approved", rationale="invalidated"),
        )


async def test_restricted_specialist_retrieval(engine, scope):
    engine.adapters = Slow()
    s = await confirmed(engine, scope)
    await control(engine, s)
    await asyncio.sleep(0.005)
    token = engine.access(s, "competitor").split("/")[-1]
    with pytest.raises(ValueError):
        engine.retrieve(token, ["f1"])
    await control(engine, s, "pause")
    with pytest.raises(Conflict):
        engine.retrieve(token)


async def test_http_boundary_and_unavailable_configuration(engine, scope):
    app = create_app(engine)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        assert (await client.get("/api/moderator/health")).json()[
            "mode"
        ] == "deterministic"
        r = await client.post(
            "/api/moderator/agendas", json={"scope": scope.model_dump()}
        )
        assert r.status_code == 201
        s = r.json()
        assert (await client.get(f"/api/moderator/sessions/{s['id']}/export")).json()[
            "schema_version"
        ] == 1
        assert (
            await client.post(
                f"/api/moderator/sessions/{s['id']}/controls",
                json={
                    "action": "start",
                    "expected_revision": 0,
                    "idempotency_key": "start",
                },
            )
        ).status_code == 409
        assert (
            await client.post(
                "/api/moderator/agendas",
                json={"scope": {**scope.model_dump(), "vehicle": "G68"}},
            )
        ).status_code == 422
        assert (await client.get("/api/moderator/sessions/missing")).status_code == 404


async def test_live_config_unavailable_is_explicit(engine, scope):
    from moderator.adapters import HttpAdapters

    engine.adapters = HttpAdapters()
    s = await confirmed(engine, scope)
    await control(engine, s)
    assert s.status == "unavailable" and s.availability
    await engine.shutdown()
