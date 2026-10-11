"""Regression for replying to later-round arguments; no model responses mocked."""
from backend.moderator.native import prior_turns
from backend.agents.market import validate_text
import pytest


def test_reply_can_resolve_prior_response_without_reopening_answered_questions():
    earlier = {"id": "round1", "actor": "market", "target_actor": "competitor",
        "target_claim_id": "competitor-opening", "question": "Which comparison would help?",
        "reasoning": "Compare equivalent tasks.", "evidence_ids": ["source-market"],
        "response": "Compare the same route under equivalent conditions.", "response_evidence_ids": ["source-competitor"]}
    pending = {"id": "round2", "actor": "customer", "target_actor": "competitor",
        "target_claim_id": "response:round1", "question": "How does that address usability?",
        "reasoning": "Usability still needs testing.", "evidence_ids": ["source-customer"], "response": None}
    turns = prior_turns({"positions": [{"actor": "competitor", "summary": "Compare the feature.",
        "claims": [{"id": "competitor-opening", "statement": "A documented feature.", "evidence_ids": ["source-competitor"]}]}],
        "challenges": [pending], "history_challenges": [earlier, pending]})
    claims = {claim.id: claim for turn in turns for claim in turn.position.claims}
    questions = [challenge for turn in turns for challenge in turn.challenges]
    assert pending["target_claim_id"] in claims
    assert claims[pending["target_claim_id"]].text == earlier["response"]
    assert len(questions) == 1 and questions[0].question == pending["question"]
    assert claims["discussion:round2"].text == pending["reasoning"]


def test_peer_record_ids_and_model_names_are_not_confused_with_statistics():
    validate_text("Does Tesla Model 3 address the issue reported in G60-3232?", [], ["G60_feedback:G60-3232"])
    validate_text("How does the G6 comparison apply?", [], ["G6"])
    for text in ("That increases sales by 3%.", "There were 3232 customers.", "The issue is in G60-9999."):
        with pytest.raises(ValueError, match="Unsupported numerical values"):
            validate_text(text, [], ["G60_feedback:G60-3232"])
