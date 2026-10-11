import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException

from backend.config import Settings
from backend.council.judge import (JudgeParticipant, ReviewDecision, ReviewCommand, build_judge_request, assess_request,
    load_review, decide, reassess, assessment_text, review_inbox)
from backend.judge.adapters import DemoAIAdapter
from backend.judge.providers import ModelAIAdapter
from backend.judge.service import JudgeService
from backend.schemas.agent import AgentPosition, Claim
from backend.schemas.council import CouncilTurn
from backend.schemas.evidence import EvidenceRecord
from backend.voice import VoiceRequest, saved_speech, synthesize, status


def setup_inputs():
    proposal_id = str(uuid4())
    source = EvidenceRecord(id="customer-123", source_type="customer_feedback", source_title="BMW feedback",
        source_uri="private:feedback", locator="Feedback!I3", passage="Charging stops were difficult to plan.",
        retrieved_at="2026-10-10T12:00:00Z", brand="BMW", model="G60", market="Europe", feedback_id="123")
    turns = [CouncilTurn(agent_id=role, stage="perspectives", position=AgentPosition(agent_id=role,
        claims=[Claim(id=f"{role}-claim", text=source.passage, kind="fact", evidence_ids=[source.id])],
        stance="revise", rationale="Test whether the proposal improves route planning.")) for role in ("customer", "market", "competitor")]
    context = {"proposal": {"proposal_id": proposal_id, "version": 1}, "scope": {
        "vehicle": "G60", "market": "Europe", "powertrain": "Electric", "horizon": 4, "topic": "Charging"},
        "question": "Should BMW test improved route planning?", "recommendations": [{"title": "Route planning", "proposed_change": "Test charging route guidance with customers."}],
        "limitations": ["One comment does not establish population demand."]}
    return context, [source], turns


class IntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.settings = Settings.from_env().__class__(**{**Settings.from_env().__dict__, "runs_dir": Path(self.tmp.name)})
        context, sources, turns = setup_inputs()
        self.request = build_judge_request(context, sources, turns)
        self.assessment = await JudgeService(DemoAIAdapter()).assess(self.request)
        self.run_id = str(uuid4())
        job = {"kind": "debate", "status": "succeeded", "result": {"run_id": self.run_id,
            "source_run_id": context["proposal"]["proposal_id"], "analysis_id": "analysis-one",
            "turns": [t.model_dump(mode="json") for t in turns], "scope": context["scope"], "model": self.settings.ollama_model,
            "judge_request": self.request.model_dump(mode="json"), "judge_assessment": self.assessment.model_dump(mode="json")}}
        directory = self.settings.runs_dir / "jobs"
        directory.mkdir()
        (directory / "job.json").write_text(json.dumps(job))

    async def asyncTearDown(self):
        self.tmp.cleanup()

    def command(self, review, **extra):
        return {"id": str(uuid4()), "expected_revision": review["revision"],
            "expected_version": review["request"]["features"][0]["version"],
            "assessment_id": (review["assessment"] or {}).get("id"), **extra}

    async def test_proposal_voice_transcript_preserves_decisions_and_rejects_stale_assessments(self):
        from backend.council.judge import router
        app = FastAPI()
        app.include_router(router)
        url = f"/api/review/debates/{self.run_id}/conversation"
        with patch("backend.council.judge.Settings.from_env", return_value=self.settings), \
             patch.dict("os.environ", {"ELEVENLABS_AGENT_ID": "agent-teammate"}):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get(url)
                self.assertEqual(response.status_code, 200)
                context = response.json()
                self.assertEqual(context["agent_id"], "agent-teammate")
                self.assertEqual(context["context"]["assessment_id"], self.assessment.id)
                self.assertNotIn("evidence", context["context"])
                event = {"id": "sdk-event", "assessment_id": self.assessment.id,
                         "actor": "judge", "text": "A customer test remains necessary."}
                self.assertEqual((await client.post(url, json=event)).status_code, 200)
                self.assertEqual((await client.post(url, json=event)).status_code, 200)
                review = load_review(self.run_id)
                self.assertEqual(review["revision"], 1)
                self.assertEqual(review["decisions"], [])
                self.assertEqual(len(review["voice_messages"][self.assessment.id]), 1)
                self.assertEqual((await client.post(url, json={**event, "text": "Changed"})).status_code, 409)
                await decide(self.run_id, ReviewDecision(**self.command(review, action="edit",
                    rationale="Narrow the proposal", description="Test route guidance before release.")))
                self.assertEqual((await client.get(url)).status_code, 409)
                self.assertEqual((await client.post(url, json=event)).status_code, 409)

    async def test_actual_inputs_preserved_and_shared_model_ignores_legacy_cloud_config(self):
        self.assertEqual({a.agent for a in self.request.arguments}, {"customer", "market", "competitor"})
        self.assertEqual(self.request.evidence[0].passage, "Charging stops were difficult to plan.")
        self.assertEqual(self.request.evidence[0].observation_id, "123")
        with patch.dict("os.environ", {"JUDGE_BASE_URL": "https://api.openai.com", "JUDGE_MODEL": "cloud-model"}):
            adapter = ModelAIAdapter(settings=self.settings)
        self.assertEqual(adapter.model, self.settings.ollama_model)
        self.assertEqual(adapter.base_url, self.settings.ollama_base_url)
        self.assertTrue(adapter.local)

    async def test_source_proposal_judge_preserves_population_and_caveats(self):
        context, sources, turns = setup_inputs()
        source = sources[0].model_copy(update={"brand": "BMW Group", "model": "Group", "market": "Global",
            "country": "DE", "model_year": 2025, "trim": "Reported aggregate", "powertrain": "Electric",
            "caveats": ["Includes MINI and Rolls-Royce; not G60 demand.", "Anecdotal feedback does not establish prevalence."]})
        request = build_judge_request(context, [source], turns)
        self.assertEqual(request.evidence[0].passage, source.passage)
        self.assertEqual(request.evidence[0].location, source.locator)
        metadata = json.loads(request.constraints[-1].split(": ", 1)[1])
        self.assertEqual(metadata["population"]["brand"], "BMW Group")
        self.assertEqual(metadata["population"]["model"], "Group")
        self.assertEqual(metadata["population"]["market"], "Global")
        self.assertEqual(metadata["population"]["country"], "DE")
        self.assertEqual(metadata["caveats"], source.caveats)

    async def test_usage_counts_initial_and_repair_calls(self):
        draft = self.assessment.model_dump(include={"arguments", "features", "clarification_requests", "proposed_priorities"})
        draft["arguments"][0].update(support=2, verdict="partial", citations=[{"evidence_id": "customer-123", "quote": "Charging stops were difficult to plan."}])
        calls = []
        def response(request):
            if request.url.path == "/api/tags":
                return httpx.Response(200, json={"models": [{"name": self.settings.ollama_model}]})
            calls.append(request)
            output = json.loads(json.dumps(draft))
            if len(calls) == 1:
                output["arguments"][0]["citations"][0]["quote"] = "This fabricated quotation must be rejected."
            return httpx.Response(200, json={"done": True, "done_reason": "stop", "prompt_eval_count": 100 if len(calls) == 1 else 150,
                "eval_count": 200 if len(calls) == 1 else 250, "message": {"content": json.dumps(output)}})
        adapter = ModelAIAdapter(settings=self.settings, transport=httpx.MockTransport(response))
        usage = {}
        with patch("backend.council.judge.ModelAIAdapter", return_value=adapter):
            await assess_request(self.request, self.settings, usage)
        self.assertEqual(len(calls), 2)
        self.assertEqual(usage, {"input_tokens": 250, "output_tokens": 450})

    async def test_participant_retains_rubric_and_answers_real_claims(self):
        context, sources, turns = setup_inputs()
        participant = JudgeParticipant(self.settings)
        with patch("backend.council.judge.assess_request", AsyncMock(return_value=self.assessment)):
            turn = await participant.turn("assessment", context, sources, turns)
        self.assertEqual(turn.agent_id, "judge")
        self.assertEqual(set(turn.answered_claim_ids), {c.id for t in turns for c in t.position.claims})
        self.assertIs(participant.assessment, self.assessment)
        self.assertEqual(turn.position.stance, "insufficient_evidence")

    async def test_moderator_outer_repair_hint_reaches_provider_without_changing_request(self):
        from backend.moderator.judge_bridge import assess_packet
        from backend.judge.service import digest
        hint = "Citation must reference evidence attached to its argument. " * 30
        adapter = ModelAIAdapter(settings=self.settings)
        original = self.request.model_dump(mode="json")
        captured = {}
        async def assess(request):
            captured.update(hint=adapter.validation_error, request=request)
            return self.assessment
        with patch("backend.moderator.judge_bridge.judge_request", return_value=self.request), \
             patch("backend.council.judge.ModelAIAdapter", return_value=adapter), \
             patch("backend.council.judge.JudgeService") as service:
            service.return_value.assess = AsyncMock(side_effect=assess)
            reply = await assess_packet({"packet": {"claims": [
                {"id": arg.id, "validation": "supported", "evidence_ids": arg.evidence_ids}
                for arg in self.request.arguments]}, "validation_error": hint}, self.settings)
        self.assertEqual(captured["hint"], hint[:700])
        self.assertIs(captured["request"], self.request)
        self.assertEqual(self.request.model_dump(mode="json"), original)
        self.assertEqual(reply.data["native_assessment"]["input_digest"], digest(self.request))

    async def test_uncited_hypothesis_cannot_raise_support_or_priority(self):
        from backend.judge.models import DraftAssessment
        draft = self.assessment.model_dump(include={"arguments", "features", "clarification_requests", "proposed_priorities"})
        argument = draft["arguments"][0]
        argument.update(support=4, verdict="supported", citations=[])
        draft["features"][0]["criteria"]["need"].update(value=4, argument_ids=[argument["argument_id"]])
        class AI:
            execution = "live"
            async def evaluate(self, request):
                return DraftAssessment.model_validate(draft)
        result = await JudgeService(AI()).assess(self.request)
        self.assertIsNone(result.arguments[0].support)
        self.assertEqual(result.arguments[0].verdict, "unknown")
        self.assertIsNone(result.features[0].criteria["need"].value)
        self.assertIsNone(result.features[0].priority)
        self.assertEqual(result.features[0].recommendation, "defer")

    async def test_customer_feedback_cannot_establish_engineering_feasibility(self):
        from backend.judge.models import DraftAssessment
        draft = self.assessment.model_dump(include={"arguments", "features", "clarification_requests", "proposed_priorities"})
        argument = draft["arguments"][0]
        argument.update(support=2, verdict="partial", citations=[{"evidence_id": "customer-123", "quote": "Charging stops were difficult to plan."}])
        draft["features"][0]["criteria"]["feasibility"].update(value=3, argument_ids=[argument["argument_id"]])
        class AI:
            execution = "live"
            async def evaluate(self, request):
                return DraftAssessment.model_validate(draft)
        result = await JudgeService(AI()).assess(self.request)
        self.assertIsNone(result.features[0].criteria["feasibility"].value)
        self.assertLess(result.features[0].coverage, 100)

    async def test_rejected_argument_quotes_cannot_create_strong_feature_evidence(self):
        from backend.judge.models import DraftAssessment
        draft = self.assessment.model_dump(include={"arguments", "features", "clarification_requests", "proposed_priorities"})
        draft["arguments"][0].update(support=4, verdict="unsupported", citations=[{"evidence_id": "customer-123", "quote": "Charging stops were difficult to plan."}])
        draft["features"][0].update(recommendation="recommend", evidence_strength="Strong", consequential_uncertainty=False)
        class AI:
            execution = "live"
            async def evaluate(self, request):
                return DraftAssessment.model_validate(draft)
        result = await JudgeService(AI()).assess(self.request)
        self.assertEqual(result.arguments[0].support, 0)
        self.assertEqual(result.features[0].evidence_strength, "Unknown")
        self.assertEqual(result.features[0].recommendation, "defer")

    async def test_unknown_verdict_cannot_retain_positive_support(self):
        from backend.judge.models import DraftAssessment
        draft = self.assessment.model_dump(include={"arguments", "features", "clarification_requests", "proposed_priorities"})
        draft["arguments"][0].update(support=4, verdict="unknown", citations=[{"evidence_id": "customer-123", "quote": "Charging stops were difficult to plan."}])
        class AI:
            execution = "live"
            async def evaluate(self, request):
                return DraftAssessment.model_validate(draft)
        result = await JudgeService(AI()).assess(self.request)
        self.assertIsNone(result.arguments[0].support)
        self.assertIsNone(result.arguments[0].influence)
        self.assertEqual(result.features[0].evidence_strength, "Unknown")

    async def test_shared_judge_provider_state_is_serialized(self):
        class AI(DemoAIAdapter):
            def __init__(self):
                self.active = self.maximum = 0
            async def evaluate(self, request):
                self.active += 1
                self.maximum = max(self.maximum, self.active)
                await asyncio.sleep(0)
                result = await super().evaluate(request)
                self.active -= 1
                return result
        ai = AI()
        service = JudgeService(ai)
        results = await asyncio.gather(service.assess(self.request), service.assess(self.request))
        self.assertEqual(ai.maximum, 1)
        self.assertNotEqual(results[0].id, results[1].id)

    async def test_review_rejects_tampered_assessment_identity(self):
        path = self.settings.runs_dir / "jobs" / "job.json"
        job = json.loads(path.read_text())
        job["result"]["judge_request"]["features"][0]["description"] = "Tampered new proposal"
        path.write_text(json.dumps(job))
        with self.assertRaises(HTTPException) as caught:
            load_review(self.run_id, self.settings)
        self.assertEqual(caught.exception.status_code, 409)

    async def test_review_decisions_are_durable_idempotent_and_version_checked(self):
        with patch("backend.council.judge.Settings.from_env", return_value=self.settings):
            review = load_review(self.run_id)
            body = ReviewDecision.model_validate(self.command(review, action="approve", rationale="PM accepted"))
            result = await decide(self.run_id, body)
            repeated = await decide(self.run_id, body)
            self.assertEqual(result, repeated)
            self.assertEqual(result["status"], "approved")
            self.assertEqual(len(load_review(self.run_id)["decisions"]), 1)
            stale = ReviewDecision.model_validate({**body.model_dump(), "id": uuid4()})
            with self.assertRaises(HTTPException) as caught:
                await decide(self.run_id, stale)
            self.assertEqual(caught.exception.status_code, 409)

    async def test_inbox_discovers_completed_debate_and_keeps_deferred_decision(self):
        with patch("backend.council.judge.Settings.from_env", return_value=self.settings):
            inbox = await review_inbox()
            self.assertEqual(inbox["reviews"][0]["run_id"], self.run_id)
            review = load_review(self.run_id)
            await decide(self.run_id, ReviewDecision.model_validate(self.command(review, action="defer", rationale="Review next week")))
            self.assertEqual((await review_inbox())["reviews"][0]["status"], "deferred")

    async def test_edit_invalidates_voice_and_approval_until_explicit_reassessment(self):
        with patch("backend.council.judge.Settings.from_env", return_value=self.settings):
            review = load_review(self.run_id)
            edited = await decide(self.run_id, ReviewDecision.model_validate(self.command(review,
                action="edit", rationale="PM changed wording", description="Pilot simpler planning with a scoped customer group.")))
            self.assertEqual(edited["request"]["features"][0]["version"], 2)
            self.assertIsNone(edited["assessment"])
            with self.assertRaises(HTTPException):
                saved_speech(edited, VoiceRequest())
            with self.assertRaises(HTTPException):
                await decide(self.run_id, ReviewDecision.model_validate(self.command(edited, action="approve", rationale="Approve")))
            async def assessed(request, settings=None):
                return await JudgeService(DemoAIAdapter()).assess(request)
            with patch("backend.council.judge.assess_request", assessed):
                updated = await reassess(self.run_id, ReviewCommand.model_validate(self.command(edited)))
            self.assertEqual(updated["assessment"]["features"][0]["feature_version"], 2)
            self.assertEqual(updated["status"], "pending")

    async def test_audio_is_exact_saved_output_cached_and_key_stays_server_side(self):
        requests = []
        def handle(request):
            requests.append(request)
            self.assertEqual(request.headers["xi-api-key"], "test-secret")
            self.assertEqual(json.loads(request.content)["text"], assessment_text(self.assessment))
            return httpx.Response(200, headers={"content-type": "audio/mpeg"}, content=b"ID3-test-mp3")
        with patch.dict("os.environ", {"ELEVENLABS_API_KEY": "test-secret"}):
            summary = saved_speech(load_review(self.run_id, self.settings), VoiceRequest(assessment_id=self.assessment.id))
            first = await synthesize(summary, self.settings, httpx.MockTransport(handle))
            second = await synthesize(summary, self.settings, httpx.MockTransport(handle))
            state = await status()
        self.assertEqual(first, second)
        self.assertEqual(len(requests), 1)
        self.assertEqual(first.read_bytes(), b"ID3-test-mp3")
        self.assertNotIn("test-secret", json.dumps(state))

    async def test_voice_fails_honestly_without_key_or_with_provider_error(self):
        with patch.dict("os.environ", {"ELEVENLABS_API_KEY": ""}):
            with self.assertRaises(HTTPException) as caught:
                await synthesize("Saved verdict", self.settings)
            self.assertEqual(caught.exception.status_code, 503)
            self.assertFalse((await status())["configured"])
        with patch.dict("os.environ", {"ELEVENLABS_API_KEY": "test-secret"}):
            with self.assertRaises(HTTPException) as caught:
                await synthesize("Saved verdict", self.settings, httpx.MockTransport(lambda _: httpx.Response(401)))
            self.assertNotIn("test-secret", caught.exception.detail)
        self.assertFalse((self.settings.runs_dir / "voice").exists())

    async def test_voice_http_boundary_never_exposes_key_or_accepts_client_verdict(self):
        import backend.voice as voice
        app = FastAPI()
        app.include_router(voice.router)
        review = load_review(self.run_id, self.settings)
        provider_calls = []
        def reject(request):
            provider_calls.append(request)
            self.assertNotIn("server-only-secret", str(request.url))
            self.assertNotIn("server-only-secret", request.content.decode())
            self.assertEqual(request.headers["xi-api-key"], "server-only-secret")
            return httpx.Response(401, json={"detail": "private diagnostics include server-only-secret"})
        async def isolated_synthesis(text):
            return await synthesize(text, self.settings, httpx.MockTransport(reject))
        with patch.dict("os.environ", {"ELEVENLABS_API_KEY": "server-only-secret"}), patch.object(voice, "load_review", return_value=review), patch.object(voice, "synthesize", isolated_synthesis):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                state = await client.get("/api/voice/status")
                self.assertNotIn("server-only-secret", state.text)
                invalid = await client.post(f"/api/voice/debates/{self.run_id}", json={"text": "An invented verdict"})
                self.assertEqual(invalid.status_code, 422)
                self.assertFalse(provider_calls)
                failed = await client.post(f"/api/voice/debates/{self.run_id}", json={"assessment_id": self.assessment.id})
                self.assertEqual(failed.status_code, 503)
                self.assertNotIn("server-only-secret", failed.text)
                self.assertNotIn("private diagnostics", failed.text)
        self.assertEqual(len(provider_calls), 1)

    async def test_moderator_judge_bridge_preserves_rejection_and_scope(self):
        from backend.moderator.judge_bridge import judge_request
        data = {"packet": {"version": 1, "brief": {"topic_id": "controls", "question": "Improve controls?",
            "objective": "Usability", "scope": self.request.scope.model_dump()}, "claims": [
                {"id": state, "actor": "customer", "statement": "A source observation", "evidence_ids": ["source1", "wrong-scope"],
                 "validation": state, "issues": ["Check original source"]} for state in ("supported", "unsupported", "unverified")],
            "challenges": [], "alternatives": [], "assumptions": []}, "source_inventory": [],
            "evidence": [{"id": eid, "source_id": "file", "domain": "customer", "location": "row 1",
                "passage": "One customer described confusing controls.", "region": region, "vehicle": "G60"}
                for eid, region in (("source1", "Europe"), ("wrong-scope", "China"))]}
        request = judge_request(data)
        self.assertEqual(request.arguments[0].evidence_ids, ["source1"])
        self.assertEqual(request.arguments[1].evidence_ids, [])
        self.assertEqual(request.arguments[2].evidence_ids, [])
        self.assertIn("unsupported", request.arguments[1].assumptions[-1])
        self.assertIsNotNone(request.evidence[1].exclusion_reason)
        self.assertTrue(any('"region": "China"' in item for item in request.constraints))


if __name__ == "__main__":
    unittest.main()
