import asyncio
import json
import httpx
import pytest
from fastapi.testclient import TestClient
from judge.providers import ModelAIAdapter, ExternalProcessingRequired, assessment_schema
from judge.adapters import ContextModeratorAdapter, Unavailable
from judge.models import JudgeRequest
from judge.service import JudgeService
from judge.api import create_app
from test_judge import request_data, draft_data


@pytest.fixture(autouse=True)
def isolated_config(monkeypatch):
    for name in ("JUDGE_BASE_URL", "JUDGE_MODEL", "JUDGE_API_FORMAT", "JUDGE_API_KEY", "JUDGE_RESPONSE_FORMAT", "JUDGE_MODEL_TIMEOUT_SECONDS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("JUDGE_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "test-credential-not-real")


def mock_response(draft=None):
    return {"status": "completed", "output": [{"type": "message", "content": [{
        "type": "output_text", "text": json.dumps(draft or draft_data())}]}]}


def test_external_payload_is_blocked_before_network():
    calls = []
    ai = ModelAIAdapter(transport=httpx.MockTransport(lambda request: calls.append(request)))
    with pytest.raises(ExternalProcessingRequired):
        asyncio.run(ai.evaluate(JudgeRequest.model_validate(request_data())))
    assert not calls


def test_responses_context_and_schema_are_sent_only_after_approval():
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(200, json=mock_response())
    body = request_data() | {"background": "Use a compact charging interface", "pm_message": "Prioritize usability", "external_processing_approved": True}
    result = asyncio.run(JudgeService(ModelAIAdapter(transport=httpx.MockTransport(respond))).assess(JudgeRequest.model_validate(body)))
    wire = json.loads(calls[0].content)
    context = json.loads(wire["input"])
    assert context["background"] == body["background"]
    assert context["pm_message"] == body["pm_message"]
    assert "external_processing_approved" not in context
    assert wire["store"] is False and wire["text"]["format"]["strict"] is True
    assert result.model == "gpt-4.1-mini" and result.execution == "live"
    assert result.features[0].priority == 80


def test_schema_has_closed_fixed_objects_and_nullable_scores():
    schema = assessment_schema()
    def visit(node):
        if isinstance(node, dict):
            if node.get("type") == "object":
                assert node["additionalProperties"] is False
                assert set(node["required"]) == set(node.get("properties", {}))
            for child in node.values(): visit(child)
        elif isinstance(node, list):
            for child in node: visit(child)
    visit(schema)
    assert set(schema["$defs"]["FeatureAssessment"]["properties"]["criteria"]["properties"]) == {"need", "severity", "gap", "future", "feasibility"}
    assert {x.get("type") for x in schema["$defs"]["CriterionAssessment"]["properties"]["value"]["anyOf"]} == {"number", "null"}


def test_generation_schema_is_bounded_to_the_frozen_request():
    request = JudgeRequest.model_validate(request_data())
    schema = assessment_schema(request)
    for collection in ("arguments", "features"):
        assert schema["properties"][collection]["minItems"] == len(getattr(request, collection))
        assert schema["properties"][collection]["maxItems"] == len(getattr(request, collection))
    definitions = schema["$defs"]
    assert definitions["ArgumentAssessment"]["properties"]["argument_id"]["enum"] == [a.id for a in request.arguments]
    assert definitions["FeatureAssessment"]["properties"]["feature_id"]["enum"] == [f.id for f in request.features]
    assert definitions["CriterionAssessment"]["properties"]["argument_ids"]["items"]["enum"] == [a.id for a in request.arguments]
    assert definitions["Citation"]["properties"]["evidence_id"]["enum"] == [e.id for e in request.evidence if not e.exclusion_reason]
    assert definitions["ArgumentAssessment"]["properties"]["explanation"]["maxLength"] == 240
    assert definitions["ArgumentAssessment"]["properties"]["citations"]["maxItems"] == 1
    assert definitions["Citation"]["properties"]["quote"]["maxLength"] == 240
    assert definitions["ArgumentAssessment"]["properties"]["issues"]["items"]["maxLength"] == 160
    assert definitions["FeatureAssessment"]["properties"]["uncertainties"]["maxItems"] == 2
    assert definitions["FeatureAssessment"]["properties"]["uncertainties"]["items"]["maxLength"] == 200
    assert definitions["CriterionAssessment"]["properties"]["rationale"]["maxLength"] == 240
    assert schema["properties"]["clarification_requests"]["maxItems"] == 1
    assert "maxItems" not in assessment_schema()["properties"]["arguments"]
    # Generating a bounded output must not trim source passages or mutate inputs.
    assert request.model_dump(mode="json") == JudgeRequest.model_validate(request_data()).model_dump(mode="json")


def test_empty_argument_and_evidence_schema_does_not_emit_invalid_empty_enums():
    request = JudgeRequest.model_validate(request_data() | {"arguments": [], "evidence": []})
    schema = assessment_schema(request)
    assert schema["properties"]["arguments"]["maxItems"] == 0
    assert schema["$defs"]["CriterionAssessment"]["properties"]["argument_ids"]["maxItems"] == 0
    assert schema["$defs"]["ArgumentAssessment"]["properties"]["citations"]["maxItems"] == 0
    assert '"enum": []' not in json.dumps(schema)


def test_schema_binds_each_argument_to_its_own_eligible_evidence():
    body = request_data()
    source = body["evidence"][0]
    body["evidence"] += [source | {"id": "e2"}, source | {"id": "excluded", "exclusion_reason": "Wrong scope"}]
    argument = body["arguments"][0]
    body["arguments"] += [argument | {"id": "a2", "evidence_ids": ["e2", "missing", "excluded", "e2"]},
                          argument | {"id": "hypothesis", "evidence_ids": []},
                          argument | {"id": "unusable", "evidence_ids": ["excluded", "missing"]}]
    schema = assessment_schema(JudgeRequest.model_validate(body))
    variants = {item["properties"]["argument_id"]["enum"][0]: item
                for item in schema["properties"]["arguments"]["items"]["anyOf"]}
    assert set(variants) == {"a1", "a2", "hypothesis", "unusable"}
    for aid, allowed in (("a1", ["e1"]), ("a2", ["e2"])):
        item = variants[aid]
        citations = item["properties"]["citations"]
        assert citations["maxItems"] == 1
        assert citations["items"]["properties"]["evidence_id"]["enum"] == allowed
        assert item["additionalProperties"] is False
        assert set(item["required"]) == set(item["properties"])
    for aid in ("hypothesis", "unusable"):
        props = variants[aid]["properties"]
        assert props["citations"]["maxItems"] == 0
        assert props["support"] == {"type": "null"}
        assert props["verdict"]["enum"] == ["unknown"]
    # Reused field references resolve to the actual bounded field definitions.
    def visit(node):
        if isinstance(node, dict):
            if "$ref" in node:
                target = schema
                for part in node["$ref"][2:].split("/"):
                    target = target[part]
                assert isinstance(target, dict)
            for child in node.values():
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)
    visit(schema)


def test_schema_binds_feature_versions_to_their_actual_ids():
    body = request_data()
    body["features"].append(body["features"][0] | {"id": "f2", "version": 7})
    schema = assessment_schema(JudgeRequest.model_validate(body))
    variants = schema["properties"]["features"]["items"]["anyOf"]
    assert [(item["properties"]["feature_id"]["enum"], item["properties"]["feature_version"]["enum"])
            for item in variants] == [(["f1"], [1]), (["f2"], [7])]


def test_local_chat_endpoint_does_not_receive_openai_secret(monkeypatch):
    monkeypatch.setenv("JUDGE_BASE_URL", "http://127.0.0.1:9000/v1")
    monkeypatch.setenv("JUDGE_MODEL", "local-qwen")
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(draft_data())}}]})
    result = asyncio.run(ModelAIAdapter(transport=httpx.MockTransport(respond)).evaluate(JudgeRequest.model_validate(request_data())))
    assert calls[0].url.path == "/v1/chat/completions"
    assert "authorization" not in calls[0].headers
    assert json.loads(calls[0].content)["model"] == "local-qwen"
    assert result.features[0].feature_id == "f1"


@pytest.mark.parametrize("payload", [
    {"status": "incomplete", "output": []},
    {"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal"}]}]},
])
def test_incomplete_or_declined_output_cannot_be_saved(payload):
    ai = ModelAIAdapter(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=payload)))
    body = request_data() | {"external_processing_approved": True}
    with pytest.raises(ValueError):
        asyncio.run(ai.evaluate(JudgeRequest.model_validate(body)))


@pytest.mark.parametrize("status", [401, 403, 429])
def test_provider_errors_are_actionable_without_secret_content(status):
    ai = ModelAIAdapter(transport=httpx.MockTransport(lambda r: httpx.Response(status, json={"error": "private provider diagnostics"})))
    with pytest.raises(Unavailable) as exc:
        asyncio.run(ai.evaluate(JudgeRequest.model_validate(request_data() | {"external_processing_approved": True})))
    assert "private provider" not in str(exc.value)


def test_context_mode_keeps_supplied_arguments_and_supports_final_decisions():
    ai = ModelAIAdapter(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=mock_response())))
    client = TestClient(create_app(ai=ai, moderator=ContextModeratorAdapter()))
    body = request_data() | {"external_processing_approved": True}
    view = client.post("/analyses/test/councils", json={"request": body, "mode": "auto"}).json()
    assert view["status"] == "complete" and view["input_mode"] == "context"
    assert len(view["request"]["arguments"]) == 1
    for index, action in enumerate(("approve", "reject")):
        response = client.post(f"/councils/{view['id']}/decisions", json={"id": str(index), "feature_id": "f1", "expected_version": 1,
            "assessment_id": view["assessment"]["id"], "action": action, "rationale": "Reviewed the actual evidence and trade-offs"})
        assert response.status_code == 200
        assert response.json()["decisions"][-1]["action"] == action


def qwen_transport(calls, *, installed=True, done=True, reason="stop"):
    def respond(request):
        calls.append(request)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "qwen3:8b"}] if installed else []})
        assert request.url.path == "/api/chat"
        return httpx.Response(200, json={"done": done, "done_reason": reason,
            "message": {"content": json.dumps(draft_data())}})
    return httpx.MockTransport(respond)


def test_default_is_local_qwen_with_actual_context_and_no_openai_key(monkeypatch):
    monkeypatch.delenv("JUDGE_BASE_URL")
    calls = []
    ai = ModelAIAdapter(transport=qwen_transport(calls))
    body = request_data() | {"background": "Actual charging project context", "pm_message": "Focus on driver usability"}
    result = asyncio.run(JudgeService(ai).assess(JudgeRequest.model_validate(body)))
    assert ai.base_url == "http://127.0.0.1:11434" and ai.api_format == "ollama"
    assert result.provider == "qwen" and result.model == "qwen3:8b"
    assert ai.timeout_seconds == 300 and ai.round_timeout_seconds >= 2 * ai.call_timeout_seconds
    assert all("authorization" not in request.headers for request in calls)
    wire = json.loads(calls[-1].content)
    context = json.loads(wire["messages"][1]["content"])
    assert context["background"] == body["background"] and context["pm_message"] == body["pm_message"]
    assert wire["stream"] is False and wire["think"] is False
    assert wire["format"] == assessment_schema(JudgeRequest.model_validate(body)) and wire["options"]["temperature"] == 0
    assert result.features[0].priority == 80


def test_qwen_health_and_council_keep_pm_approve_reject_connected(monkeypatch):
    monkeypatch.delenv("JUDGE_BASE_URL")
    calls = []
    ai = ModelAIAdapter(transport=qwen_transport(calls))
    client = TestClient(create_app(ai=ai, moderator=ContextModeratorAdapter()))
    health = client.get("/health").json()
    assert health["model_ready"] is True and health["provider"] == "qwen"
    assert health["external_approval_required"] is False
    response = client.post("/analyses/test/councils", json={"request": request_data(), "mode": "auto"})
    assert response.status_code == 200, response.text
    view = response.json()
    assert view["status"] == "complete" and view["assessment"]["provider"] == "qwen"
    for action in ("approve", "reject"):
        decision = client.post(f"/councils/{view['id']}/decisions", json={"id": action, "feature_id": "f1", "expected_version": 1,
            "assessment_id": view["assessment"]["id"], "action": action, "rationale": "Reviewed Qwen's evidence and trade-offs"})
        assert decision.status_code == 200
        assert decision.json()["decisions"][-1]["action"] == action


def test_missing_qwen_model_is_actionable_503_without_inference_or_demo(monkeypatch):
    monkeypatch.delenv("JUDGE_BASE_URL")
    calls = []
    client = TestClient(create_app(ai=ModelAIAdapter(transport=qwen_transport(calls, installed=False)), moderator=ContextModeratorAdapter()))
    assert client.get("/health").json()["model_ready"] is False
    response = client.post("/analyses/test/judge-assessments", json=request_data())
    assert response.status_code == 503 and "ollama pull qwen3:8b" in response.json()["detail"]
    response = client.post("/analyses/test/councils", json={"request": request_data(), "mode": "manual"})
    assert response.status_code == 503
    assert all(request.method == "GET" for request in calls)


def test_unavailable_ollama_is_actionable_without_falling_back(monkeypatch):
    monkeypatch.delenv("JUDGE_BASE_URL")
    calls = []
    def offline(request):
        calls.append(request)
        raise httpx.ConnectError("offline", request=request)
    ai = ModelAIAdapter(transport=httpx.MockTransport(offline))
    with pytest.raises(Unavailable, match="Ollama is unavailable"):
        asyncio.run(ai.evaluate(JudgeRequest.model_validate(request_data())))
    assert len(calls) == 1 and calls[0].url.host == "127.0.0.1"


@pytest.mark.parametrize("done, reason", [(False, "stop"), (True, "length")])
def test_truncated_qwen_output_is_not_saved(monkeypatch, done, reason):
    monkeypatch.delenv("JUDGE_BASE_URL")
    ai = ModelAIAdapter(transport=qwen_transport([], done=done, reason=reason))
    with pytest.raises(ValueError, match="incomplete"):
        asyncio.run(ai.evaluate(JudgeRequest.model_validate(request_data())))
