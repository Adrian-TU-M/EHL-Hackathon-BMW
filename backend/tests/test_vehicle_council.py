import json
from uuid import uuid4
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

from moderator.app import create_app
from moderator.models import ConfirmAgenda, Control
from backend.judge.adapters import DemoAIAdapter
from backend.judge.service import JudgeService
from backend.tests.test_judge_integration import setup_inputs
from backend.council.judge import build_judge_request


@pytest.mark.asyncio
async def test_one_pm_start_selects_entire_scoped_agenda_and_is_idempotent(engine, scope):
    app = create_app(engine)
    app.state.engine = engine
    body = {"scope": scope.model_dump(), "idempotency_key": str(uuid4())}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first = await client.post("/api/moderator/vehicle-debates", json=body)
        assert first.status_code == 201, first.text
        data = first.json()
        eligible = {t["id"] for t in data["agenda"]["topics"] if t["eligible"]}
        assert set(data["agenda"]["selected_ids"]) == eligible
        assert data["agenda"]["scope"] == body["scope"]
        assert data["agenda"]["confirmed_at"]
        await engine.tasks[data["id"]]
        completed = engine.get(data["id"])
        assert completed.status == "complete"
        assert {o.topic_id for o in completed.outcomes} == eligible
        assert all(o.review_status == "Pending review" for o in completed.outcomes)
        again = await client.post("/api/moderator/vehicle-debates", json=body)
        assert again.json()["id"] == data["id"]
        assert again.json()["status"] == "complete"
        changed = {**body, "scope": {**body["scope"], "vehicle": "G70"}}
        assert (await client.post("/api/moderator/vehicle-debates", json=changed)).status_code == 409


async def assessed(engine, scope):
    session = await engine.create(scope, refine_agenda=False)
    await engine.confirm(session.id, ConfirmAgenda(expected_version=1, selected_ids=session.agenda.selected_ids[:1]))
    await engine.control(session.id, Control(action="start", expected_revision=session.revision, idempotency_key="test-start"))
    await engine.tasks[session.id]
    context, sources, turns = setup_inputs()
    request = build_judge_request(context, sources, turns)
    assessment = await JudgeService(DemoAIAdapter()).assess(request)
    outcome = session.outcomes[0]
    outcome.assessment.native_assessment = assessment.model_dump(mode="json")
    outcome.assessment.native_request = request.model_dump(mode="json")
    engine.store.save(session)
    return session, outcome, assessment


@pytest.mark.asyncio
async def test_jury_conversation_is_saved_idempotent_and_never_approves(engine, scope, monkeypatch):
    session, outcome, assessment = await assessed(engine, scope)
    model = AsyncMock(return_value={"message": {"content": json.dumps({"answer": "A focused customer test is needed; this evidence does not establish broad demand.", "evidence_ids": []})}})
    monkeypatch.setattr("backend.llm.ollama.OllamaClient.chat", model)
    app = create_app(engine); app.state.engine = engine
    url = f"/api/moderator/sessions/{session.id}/outcomes/{outcome.topic_id}/discussion"
    body = {"id": str(uuid4()), "assessment_id": assessment.id, "content": "What should we validate before approval?"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get(url)).json()["messages"] == []
        result = await client.post(url, json=body)
        assert result.status_code == 200, result.text
        assert [m["actor"] for m in result.json()["messages"]] == ["PM", "judge"]
        assert (await client.post(url, json=body)).json() == result.json()
        assert model.await_count == 1
        assert (await client.get(url)).json() == result.json()
        assert outcome.review_status == "Pending review"
        assert outcome.decisions == []
        changed = {**body, "content": "Approve this now"}
        assert (await client.post(url, json=changed)).status_code == 409
        stale = {**body, "id": str(uuid4()), "assessment_id": "stale"}
        assert (await client.post(url, json=stale)).status_code == 409
        assert model.await_count == 1


@pytest.mark.asyncio
async def test_jury_rejects_unknown_sources_and_assessment_changes_in_flight(engine, scope, monkeypatch):
    session, outcome, assessment = await assessed(engine, scope)
    app = create_app(engine); app.state.engine = engine
    url = f"/api/moderator/sessions/{session.id}/outcomes/{outcome.topic_id}/discussion"
    body = {"id": str(uuid4()), "assessment_id": assessment.id, "content": "Why?"}
    model = AsyncMock(return_value={"message": {"content": json.dumps({"answer": "Unsupported answer", "evidence_ids": ["invented"]})}})
    monkeypatch.setattr("backend.llm.ollama.OllamaClient.chat", model)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.post(url, json=body)).status_code == 502
        assert (await client.get(url)).json()["messages"] == []
        async def invalidate(*args, **kwargs):
            outcome.assessment_valid = False
            return {"message": {"content": json.dumps({"answer": "Old answer", "evidence_ids": []})}}
        model.side_effect = invalidate
        assert (await client.post(url, json=body)).status_code == 409


@pytest.mark.asyncio
async def test_voice_discussion_only_speaks_a_saved_jury_reply(engine, scope, monkeypatch, tmp_path):
    session, outcome, assessment = await assessed(engine, scope)
    app = create_app(engine); app.state.engine = engine
    url = f"/api/moderator/sessions/{session.id}/outcomes/{outcome.topic_id}/discussion/voice"
    reply_id = str(uuid4()); pm_id = str(uuid4())
    thread = {"assessment_id": assessment.id, "messages": [{"id": reply_id, "actor": "judge", "text": "Saved answer"}, {"id": pm_id, "actor": "PM", "text": "PM input"}]}
    engine.store.db.execute("INSERT INTO jury_discussions VALUES (?,?,?)", (session.id, assessment.id, json.dumps(thread)))
    engine.store.db.commit()
    path = tmp_path / "reply.mp3"; path.write_bytes(b"test-audio")
    synth = AsyncMock(return_value=path); monkeypatch.setattr("backend.voice.synthesize", synth)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        result = await client.post(url, json={"assessment_id": assessment.id, "message_id": reply_id})
        assert result.status_code == 200
        synth.assert_awaited_once_with("Saved answer")
        assert (await client.post(url, json={"assessment_id": assessment.id, "message_id": pm_id})).status_code == 404
        outcome.assessment_valid = False
        assert (await client.post(url, json={"assessment_id": assessment.id, "message_id": reply_id})).status_code == 409


@pytest.mark.asyncio
async def test_original_voice_context_and_transcript_are_bound_to_saved_assessment(engine, scope, monkeypatch):
    session, outcome, assessment = await assessed(engine, scope)
    monkeypatch.setenv("ELEVENLABS_AGENT_ID", "agent-original-teammate")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "never-disclose-this-secret")
    app = create_app(engine); app.state.engine = engine
    url = f"/api/moderator/sessions/{session.id}/outcomes/{outcome.topic_id}/discussion/conversation"
    revision = session.revision
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        context = await client.get(url)
        assert context.status_code == 200
        body = context.json()
        assert body["agent_id"] == "agent-original-teammate"
        assert body["context"]["assessment_id"] == assessment.id
        assert body["context"]["features"] == [f.model_dump(mode="json") for f in assessment.features]
        assert "never-disclose-this-secret" not in context.text
        assert "evidence" not in body["context"]  # no raw dataset upload
        event = {"id": "elevenlabs-actual-event", "assessment_id": assessment.id, "actor": "PM", "text": "Why was this deferred?"}
        assert (await client.post(url, json=event)).status_code == 200
        assert (await client.post(url, json=event)).status_code == 200
        assert len((await client.get(url)).json()["messages"]) == 1
        assert session.revision == revision and outcome.decisions == []
        assert (await client.post(url, json={**event, "text": "Different event"})).status_code == 409
        outcome.assessment_valid = False
        assert (await client.get(url)).status_code == 409
        assert (await client.post(url, json=event)).status_code == 409
