"""Verify runtime delegation, canonical citations and prior-turn identity."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import pytest
from backend.config import Settings
from backend.moderator.native import NativeSpecialists, customer_citation
from backend.moderator.models import Evidence, AgentPosition, ChallengeResponse, Rebuttal
from backend.schemas.council import CouncilTurn
from backend.schemas.agent import AgentPosition as Position, Claim, Challenge
from backend.customer_agent.schemas import CouncilEvent


def inputs(actor):
    evidence = [Evidence(id="G60_feedback:G60-0001" if actor == "customer" else f"specialist:{actor}-1", source_id="fixture", domain=actor,
                         location="row 1", passage="The physical controls are easy to find.", kind="feedback" if actor == "customer" else "external_context")]
    data = {"brief": {"topic_id": "topic-controls", "question": "How should the controls improve?", "objective": "Usability", "limitations": [],
                      "scope": {"vehicle": "G60", "market": "Europe", "powertrain": "Electric", "horizon": 4}},
            "evidence_access": "token", "evidence": [e.model_dump() for e in evidence],
            "positions": [{"actor": "market" if actor != "market" else "customer", "summary": "Test usable controls.",
                           "claims": [{"id": "topic-controls:peer:native-position", "statement": "Test usable controls.", "evidence_ids": ["peer-source"]}]}]}
    catalog = SimpleNamespace(sources=[])
    return evidence, data, NativeSpecialists(Settings.from_env(), lambda _: (catalog, evidence))


@pytest.mark.asyncio
async def test_customer_calls_teammate_workflow_and_preserves_result(monkeypatch):
    evidence, data, bridge = inputs("customer")
    event = CouncilEvent(id="native-customer-event", stage="perspectives", statement="The supplied comment praises physical controls.",
                         recommendation="Test retaining them.", evidenceIds=["G60-0001"], evidenceBase="One observation, not prevalence.",
                         model="ollama:qwen3:8b")
    agent = SimpleNamespace(perspective=Mock(return_value=event))
    monkeypatch.setattr("backend.moderator.native.get_agent", lambda _: agent)
    result = await bridge.call("customer", "perspective", data)
    position = AgentPosition.model_validate(result.data)
    agent.perspective.assert_called_once()
    request = agent.perspective.call_args.args[0]
    assert request.scope.vehicle == "G60" and request.question == data["brief"]["question"]
    assert position.native_output == event.model_dump()
    assert position.implementation.endswith("CustomerAgent.perspective")
    assert "Test retaining them" in position.summary
    assert all(c.evidence_ids == [evidence[0].id] for c in position.claims)
    assert len({c.id for c in position.claims}) == len(position.claims)


@pytest.mark.asyncio
@pytest.mark.parametrize("actor,factory", [("market", "MarketParticipant"), ("competitor", "GroundedParticipant")])
async def test_native_specialist_challenges_actual_peer_and_answers_exact_claim(actor, factory, monkeypatch):
    evidence, data, bridge = inputs(actor)
    peer = data["positions"][0]["actor"]
    peer_id = data["positions"][0]["claims"][0]["id"]
    participant = SimpleNamespace(turn=AsyncMock(return_value=CouncilTurn(agent_id=actor, stage="challenge",
        position=Position(agent_id=actor, stance="revise", rationale="Validate this proposal against the cited controls evidence.",
            claims=[Claim(id="native-fact", text=evidence[0].passage, kind="fact", evidence_ids=[evidence[0].id])]),
        challenges=[Challenge(target_agent_id=peer, target_claim_id=peer_id, question="What customer test would support that proposal?", evidence_ids=[evidence[0].id])])) )
    monkeypatch.setattr(f"backend.moderator.native.{factory}", lambda *args: participant)
    result = ChallengeResponse.model_validate((await bridge.call(actor, "challenge", data)).data)
    assert result.challenge.target_claim_id == peer_id
    assert result.challenge.target_actor == peer
    assert result.challenge.native_output["stage"] == "challenge"
    assert participant.turn.call_args.args[3][0].position.claims[0].id == peer_id
    own_claim = f"topic-controls:{actor}:native-position"
    data["positions"].append({"actor": actor, "summary": "Our earlier position", "claims": [{"id": own_claim, "statement": "Our earlier position", "evidence_ids": [evidence[0].id]}]})
    data["challenges"] = [{"id": "exact-challenge", "actor": peer, "target_actor": actor, "target_claim_id": own_claim,
                           "question": "What uncertainty remains?", "evidence_ids": []}]
    participant.turn.return_value = CouncilTurn(agent_id=actor, stage="revision", position=Position(agent_id=actor, stance="revise",
        rationale="This evidence does not establish broad demand; test usability before prioritising.",
        claims=[Claim(id="native-fact", text=evidence[0].passage, kind="fact", evidence_ids=[evidence[0].id])]), answered_claim_ids=[own_claim])
    answer = Rebuttal.model_validate((await bridge.call(actor, "rebuttal", data)).data)
    assert answer.responses[0].challenge_id == "exact-challenge"
    assert answer.responses[0].status == "unresolved"  # a speaker cannot grant themselves consensus
    assert participant.turn.call_args.args[3][-1].challenges[0].question == "What uncertainty remains?"


def test_customer_study_maps_exact_sheet_row_vehicle_and_rejects_unknown():
    scope = {"vehicle": "G60", "market": "Europe"}
    assert customer_citation("STUDY:CN_EU_2025:8:G60", scope, {"studies:mean:5:8": 1}) == "studies:mean:5:8"
    with pytest.raises(ValueError, match="outside the frozen scope"):
        customer_citation("G60-0002", scope, {"G60_feedback:G60-0001": 1})
