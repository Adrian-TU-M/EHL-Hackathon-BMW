from typing import Literal
from uuid import UUID
from pydantic import Field
from backend.schemas.common import Contract, NonEmpty, ProposalReference, Scope, AgentId
from backend.schemas.agent import AgentPosition, Challenge
from backend.schemas.evidence import EvidenceRecord

class DebateRequest(Contract):
    client_job_id: UUID | None = None
    analysis_id: NonEmpty
    source_run_id: UUID
    proposal: ProposalReference
    scope: Scope
    trigger: Literal['pm_requested']
    question: NonEmpty = Field(max_length=800)

class CouncilTurn(Contract):
    agent_id: AgentId
    stage: Literal['perspectives', 'challenge', 'revision', 'assessment']
    position: AgentPosition
    challenges: list[Challenge] = Field(default_factory=list, max_length=2)
    answered_claim_ids: list[str] = Field(default_factory=list)

class DebateResult(Contract):
    run_id: str
    source_run_id: str
    analysis_id: str
    proposal: ProposalReference
    scope: Scope
    question: str
    model: str
    turns: list[CouncilTurn]
    # Framing and closing are kept separate from the six substantive turns.
    moderation: list[CouncilTurn] = Field(default_factory=list)
    judge_assessment: dict | None = None
    judge_request: dict | None = None
    evidence: list[EvidenceRecord]
    decision: Literal['awaiting_pm_review'] = 'awaiting_pm_review'
    limitations: list[str]
