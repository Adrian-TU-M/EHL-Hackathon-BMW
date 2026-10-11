"""The merged live council hands exact PM-approved versions to Presentation Studio."""
import pytest
from httpx import ASGITransport, AsyncClient
from backend.moderator.app import create_app
from moderator.models import JudgeProposal
from backend.presentation.service import PresentationService
from backend.presentation.storage import PresentationStore
from backend.tests.test_vehicle_council import assessed


@pytest.mark.asyncio
async def test_unified_routes_preserve_jury_and_require_explicit_requirement_approval(engine, scope, tmp_path):
    session, outcome, assessment = await assessed(engine, scope)
    outcome.assessment.proposals = [JudgeProposal(id="fixture-proposal", title="Accessible controls", description="Run a bounded usability pilot.", evidence_ids=["f1"])]
    app = create_app(engine)
    app.state.engine = engine
    service = PresentationService(PresentationStore(tmp_path / "decks.sqlite3"), engine)
    app.state.presentations = service
    proposal = outcome.assessment.proposals[0]
    create = {"kind": "council", "mode": "ollama", "session_id": session.id, "idempotency_key": "integration-deck"}
    review_url = f"/api/moderator/sessions/{session.id}/outcomes/{outcome.topic_id}/proposals/{proposal.id}/review"
    approval = {"expected_version": proposal.version, "expected_outcome_version": outcome.version,
                "status": "Approved", "rationale": "Approve this bounded test for the presentation."}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            before = (await client.get("/api/presentations")).json()["sessions"][0]
            assert before["approved_count"] == 0
            assert before["proposal_count"] == 1
            assert before["scope"]["vehicle"] == scope.vehicle
            assert before["mode"] == session.mode
            assert (await client.post("/api/presentations", json=create)).status_code == 422
            assert (await client.post(review_url, json={**approval, "expected_version": proposal.version + 1})).status_code == 409
            assert (await client.post(review_url, json=approval)).status_code == 200
            assert (await client.get("/api/presentations")).json()["sessions"][0]["approved_count"] == 1
            response = await client.post("/api/presentations", json=create)
            assert response.status_code == 201, response.text
            p = response.json()
            assert p["mode"] == "ollama"
            assert p["snapshot"]["kind"] == "council" and p["snapshot"]["source_id"] == session.id
            assert [d["id"] for d in p["snapshot"]["decisions"]] == [proposal.id]
            assert p["snapshot"]["decisions"][0]["description"] == proposal.description
            assert p["snapshot"]["decisions"][0]["pm_rationale"] == approval["rationale"]
            assert (await client.put(f"/api/presentations/{p['id']}/brief", json={"expected_revision": p["revision"] + 1, "brief": p["brief"]})).status_code == 409
            voice = await client.get(f"/api/moderator/sessions/{session.id}/outcomes/{outcome.topic_id}/discussion/conversation")
            assert voice.status_code == 200
            assert voice.json()["assessment_id"] == assessment.id
            assert outcome.review_status == "Pending review"  # requirement approval doesn't approve the whole outcome
    finally:
        await service.close()
