import asyncio
from copy import deepcopy
import pytest
from fastapi.testclient import TestClient
from judge.api import create_app
from judge.providers import ModelAIAdapter
from judge.adapters import DemoAIAdapter, DemoModeratorAdapter
from judge.models import JudgeRequest, DraftAssessment, Weights
from judge.scoring import score, influence
from judge.service import JudgeService


def request_data():
    return {
        "scope": {"vehicle": "G60", "market": "Europe", "powertrain": "Electric", "horizon": 4},
        "features": [{"id": "f1", "version": 1, "title": "Charging", "description": "Improve charging usability", "topic": "Charging"}],
        "arguments": [{"id": "a1", "agent": "customer", "feature_ids": ["f1"],
                       "statement": "Charging controls are difficult", "evidence_ids": ["e1"]}],
        "evidence": [{"id": "e1", "domain": "customer", "source": "Study", "location": "row 10",
                      "published_at": "2026-01-01", "provenance": "provided", "passage": "Charging controls are difficult"}],
    }


def draft_data():
    return {
        "arguments": [{"argument_id": "a1", "support": 4, "relevance": 5,
                       "influence": 5, "verdict": "supported", "explanation": "Directly supported",
                       "citations": [{"evidence_id": "e1", "quote": "Charging controls are difficult"}]}],
        "features": [{"feature_id": "f1", "feature_version": 1, "recommendation": "recommend",
                      "rationale": "Reduce evidenced friction", "evidence_strength": "Limited",
                      "priority": 1, "coverage": 1,
                      "criteria": {key: {"value": 4 if key == "need" else None,
                                         "argument_ids": ["a1"] if key == "need" else [],
                                         "rationale": "Evidence supports customer need" if key == "need" else "Unknown"}
                                   for key in ("need", "severity", "gap", "future", "feasibility")}}],
    }


class FixtureAI:
    execution = "live"
    def __init__(self, data=None):
        self.data = data or draft_data()
    async def evaluate(self, request):
        return DraftAssessment.model_validate(deepcopy(self.data))


def evaluate(data=None, draft=None):
    return asyncio.run(JudgeService(FixtureAI(draft)).assess(JudgeRequest.model_validate(data or request_data())))


def test_score_matches_frontend_and_preserves_unknowns():
    values = {key: None for key in ("need", "severity", "gap", "future", "feasibility")}
    assert score(values, Weights()) == (None, 0)
    values["need"] = 5
    assert score(values, Weights()) == (100, 30)
    assert score(values, Weights(need=0, severity=0, gap=0, future=0, feasibility=0)) == (None, 0)
    assert influence(None, 5) is None
    assert influence(4, 5) == 4


def test_scores_are_computed_not_trusted_from_model():
    result = evaluate()
    assert result.arguments[0].influence == 4
    assert result.features[0].priority == 80
    assert result.features[0].coverage == 30
    assert result.ranked_feature_ids == ["f1"]


@pytest.mark.parametrize("mutation", ["fabricated_quote", "unattached_source", "excluded_source", "missing_argument", "wrong_version", "unsupported_criterion", "missing_criterion"])
def test_invalid_lineage_and_output_rejected(mutation):
    data, draft = request_data(), draft_data()
    if mutation == "fabricated_quote": draft["arguments"][0]["citations"][0]["quote"] = "Everyone wants this"
    if mutation == "unattached_source": data["arguments"][0]["evidence_ids"] = []
    if mutation == "excluded_source": data["evidence"][0]["exclusion_reason"] = "Invalid sample"
    if mutation == "missing_argument": draft["arguments"] = []
    if mutation == "wrong_version": draft["features"][0]["feature_version"] = 2
    if mutation == "unsupported_criterion": draft["features"][0]["criteria"]["need"]["argument_ids"] = []
    if mutation == "missing_criterion": del draft["features"][0]["criteria"]["gap"]
    with pytest.raises(ValueError): evaluate(data, draft)


def test_cross_argument_citation_error_identifies_the_repair_without_source_text():
    data, draft = request_data(), draft_data()
    data["evidence"].append(data["evidence"][0] | {"id": "e2", "passage": "Private unrelated passage"})
    draft["arguments"][0]["citations"] = [{"evidence_id": "e2", "quote": "Private unrelated passage"}]
    with pytest.raises(ValueError) as error:
        evaluate(data, draft)
    message = str(error.value)
    assert "argument_id='a1'" in message
    assert "evidence_id='e2'" in message
    assert "allowed evidence_ids=['e1']" in message
    assert "Private unrelated passage" not in message


def test_synthetic_evidence_cannot_be_strong_or_approved_by_judge():
    data = request_data()
    data["evidence"][0]["provenance"] = "synthetic"
    result = evaluate(data)
    assert result.arguments[0].support == 1
    assert result.features[0].evidence_strength == "Illustrative"
    assert result.features[0].recommendation == "defer"
    assert result.next_action == "request_clarification"
    data["clarification_used"] = True
    assert evaluate(data).next_action == "pause_for_pm"


def test_duplicate_observations_are_flagged_not_extra_votes():
    data, draft = request_data(), draft_data()
    arg = deepcopy(data["arguments"][0]); arg["id"] = "a2"
    data["arguments"].append(arg)
    assessment = deepcopy(draft["arguments"][0]); assessment["argument_id"] = "a2"
    draft["arguments"].append(assessment)
    result = evaluate(data, draft)
    assert "not independent corroboration" in result.arguments[0].issues[0]
    assert result.features[0].priority == 80


def test_missing_sources_remain_visible_not_zero():
    data, draft = request_data(), draft_data()
    data["evidence"] = []
    draft["arguments"][0].update(support=None, relevance=None, verdict="unknown", citations=[])
    draft["features"][0]["criteria"]["need"].update(value=None, argument_ids=[])
    result = evaluate(data, draft)
    assert result.arguments[0].support is None
    assert result.arguments[0].issues == ["Missing evidence: e1"]
    assert result.features[0].priority is None


def test_api_validates_inputs_and_reports_invalid_model():
    client = TestClient(create_app(ai=FixtureAI()))
    body = request_data(); body["weights"] = {"need": -1}
    assert client.post("/analyses/test/judge-assessments", json=body).status_code == 422
    draft = draft_data(); draft["arguments"][0]["support"] = 99
    client = TestClient(create_app(ai=FixtureAI(draft)))
    assert client.post("/analyses/test/judge-assessments", json=request_data()).status_code == 502


def test_unconfigured_adapter_fails_without_demo_fallback(monkeypatch):
    monkeypatch.delenv("JUDGE_DEMO_MODE", raising=False)
    monkeypatch.delenv("JUDGE_MODEL_URL", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("JUDGE_API_KEY", raising=False)
    monkeypatch.setenv("JUDGE_BASE_URL", "https://api.openai.com/v1")
    client = TestClient(create_app(ai=ModelAIAdapter()))
    response = client.post("/analyses/test/judge-assessments", json=request_data())
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def create_council(client, mode="manual"):
    result = client.post("/analyses/test/councils", json={"mode": mode, "request": request_data()})
    assert result.status_code == 200, result.text
    return result.json()


def continue_council(client, view):
    result = client.post(f"/councils/{view['id']}/control", json={"action": "continue", "expected_revision": view["revision"], "rationale": "Reviewed this stage"})
    assert result.status_code == 200, result.text
    return result.json()


def demo_client():
    return TestClient(create_app(ai=DemoAIAdapter(), moderator=DemoModeratorAdapter()))


def test_manual_pauses_at_each_stage_and_requires_final_review():
    client = demo_client()
    view = create_council(client)
    observed = [view["stage"]]
    while view["status"] != "complete":
        assert view["status"] == "paused"
        view = continue_council(client, view)
        observed.append(view["stage"])
    assert observed == ["topic", "perspectives", "challenge", "assessment", "revision", "proposal", "review"]
    assert not any("approve" in e["statement"] and e["actor"] == "PM" for e in view["events"])
    assert view["execution"] == "demo"


def test_auto_clarifies_once_then_pauses_and_stale_controls_fail():
    client = demo_client()
    view = create_council(client, "auto")
    assert view["stage"] == "revision"
    assert view["status"] == "paused"
    assert view["request"]["clarification_used"] is True
    bad = client.post(f"/councils/{view['id']}/control", json={"action": "continue", "expected_revision": 0, "rationale": "Reviewed"})
    assert bad.status_code == 409
    view = continue_council(client, view)
    assert view["status"] == "complete"
    assert view["assessment"]["next_action"] == "pause_for_pm"


def test_whole_council_message_is_idempotent_and_replay_has_no_side_effects():
    client = demo_client()
    view = create_council(client, "auto")
    view = continue_council(client, view)
    body = {"id": "pm-1", "expected_revision": view["revision"], "content": "I dislike complexity"}
    url = f"/councils/{view['id']}/messages"
    result = client.post(url, json=body)
    assert result.status_code == 200
    updated = result.json()
    assert updated["round"] == 2
    replies = [e for e in updated["events"][len(view["events"]):] if e["stage"] == "perspectives"]
    assert {e["actor"] for e in replies} >= {"customer", "market", "competitor"}
    assert client.post(url, json=body).json() == updated
    body["content"] = "A different payload"
    assert client.post(url, json=body).status_code == 409
    replay = client.get(f"/councils/{view['id']}/events", headers={"Last-Event-ID": str(updated["events"][-1]["sequence"])})
    assert "event: council" not in replay.text
    assert "event: snapshot" in replay.text
    assert client.get(f"/councils/{view['id']}").json() == updated


def test_decision_version_checks_edits_and_reassessment():
    client = demo_client()
    view = continue_council(client, create_council(client, "auto"))
    url = f"/councils/{view['id']}/decisions"
    body = {"id": "d1", "feature_id": "f1", "expected_version": 99,
            "assessment_id": view["assessment"]["id"], "action": "approve", "rationale": "Reviewed"}
    assert client.post(url, json=body).status_code == 409
    body.update(expected_version=1, action="edit", description="Simplify the charging controls")
    response = client.post(url, json=body)
    assert response.status_code == 200
    revised = response.json()
    assert revised["request"]["features"][0]["version"] == 2
    assert revised["assessment"] is None
    assert revised["status"] == "paused"
    body.update(id="d2", action="approve", expected_version=2)
    assert client.post(url, json=body).status_code == 409
    refreshed = continue_council(client, revised)
    assert refreshed["assessment"]["features"][0]["feature_version"] == 2


def test_timeout_and_adapter_failure_leave_snapshot_unchanged():
    class FailingModerator(DemoModeratorAdapter):
        async def respond(self, stage, request):
            if stage == "perspectives": raise TimeoutError()
            return await super().respond(stage, request)
    client = TestClient(create_app(ai=DemoAIAdapter(), moderator=FailingModerator()))
    view = create_council(client)
    response = client.post(f"/councils/{view['id']}/control", json={"action": "continue", "expected_revision": view["revision"], "rationale": "Reviewed"})
    assert response.status_code == 504
    assert client.get(f"/councils/{view['id']}").json() == view


def test_priority_proposal_does_not_apply_until_confirmed():
    class ProposalAI(DemoAIAdapter):
        async def evaluate(self, request):
            from judge.models import PriorityProposal
            draft = await super().evaluate(request)
            draft.proposed_priorities = PriorityProposal(weights=Weights(need=60), constraints=["Reduce complexity"], rationale="PM preference")
            return draft
    client = TestClient(create_app(ai=ProposalAI(), moderator=DemoModeratorAdapter()))
    view = create_council(client, "auto")
    assert view["request"]["weights"]["need"] == 30
    response = client.post(f"/councils/{view['id']}/priorities/confirm", json={"expected_revision": view["revision"], "assessment_id": view["assessment"]["id"], "rationale": "Confirm my preference"})
    assert response.status_code == 200
    assert response.json()["request"]["weights"]["need"] == 60
    assert response.json()["request"]["constraints"] == ["Reduce complexity"]
    assert response.json()["assessment"]["arguments"] == view["assessment"]["arguments"]


def test_interrupt_cancels_active_adapter_and_preserves_last_checkpoint():
    from judge.models import CouncilCreate, CouncilControl
    from judge.workflow import CouncilService, CouncilRepository, Conflict
    async def scenario():
        started = asyncio.Event()
        cancelled = asyncio.Event()
        class SlowModerator(DemoModeratorAdapter):
            async def respond(self, stage, request):
                if stage == "perspectives":
                    started.set()
                    try:
                        await asyncio.sleep(60)
                    finally:
                        cancelled.set()
                return await super().respond(stage, request)
        service = CouncilService(JudgeService(DemoAIAdapter()), SlowModerator(), CouncilRepository())
        view = await service.create("test", CouncilCreate(request=JudgeRequest.model_validate(request_data())))
        task = asyncio.create_task(service.control(view.id, CouncilControl(action="continue", expected_revision=1, rationale="Reviewed")))
        await asyncio.wait_for(started.wait(), 2)
        stopped = await service.control(view.id, CouncilControl(action="interrupt", expected_revision=1, rationale="Stop processing"))
        with pytest.raises(Conflict): await task
        assert cancelled.is_set()
        assert stopped.status == "interrupted"
        assert stopped.stage == "topic"
        assert len(stopped.request.arguments) == 1
    asyncio.run(scenario())


def test_round_budget_includes_prior_manual_stage_processing():
    client = demo_client()
    view = create_council(client)
    stored = client.app.state.councils.repository.views[view["id"]]
    stored.processing_seconds = 120
    result = client.post(f"/councils/{view['id']}/control", json={"action": "continue", "expected_revision": view["revision"], "rationale": "Reviewed"})
    assert result.status_code == 504


def test_decision_retries_do_not_repeat_the_audit_write():
    client = demo_client()
    view = continue_council(client, create_council(client, "auto"))
    url = f"/councils/{view['id']}/decisions"
    body = {"id": "approve-1", "feature_id": "f1", "expected_version": 1,
            "assessment_id": view["assessment"]["id"], "action": "approve", "rationale": "Explicit PM prototype approval"}
    first = client.post(url, json=body)
    assert first.status_code == 200
    count = len(client.get(f"/councils/{view['id']}/audit").json())
    assert client.post(url, json=body).json() == first.json()
    assert len(client.get(f"/councils/{view['id']}/audit").json()) == count
    body["rationale"] = "Different intent"
    assert client.post(url, json=body).status_code == 409
