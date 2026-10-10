from typing import Literal

from pydantic import Field, model_validator

from backend.schemas.common import AgentId, Contract, NonEmpty, ProposalReference, Scope


class Claim(Contract):
    id: NonEmpty
    text: NonEmpty
    kind: Literal["fact", "inference", "hypothesis"]
    evidence_ids: list[NonEmpty] = Field(default_factory=list)

    @model_validator(mode="after")
    def facts_require_citations(self) -> "Claim":
        if self.kind == "fact" and not self.evidence_ids:
            raise ValueError("A factual claim requires evidence IDs; retrieval must verify them.")
        return self


class Effect(Contract):
    description: NonEmpty
    basis: Literal["observed", "hypothesis"]
    evidence_ids: list[NonEmpty] = Field(default_factory=list)
    uncertainty: NonEmpty


class Recommendation(Contract):
    title: NonEmpty
    proposed_change: NonEmpty
    rationale: NonEmpty
    evidence_ids: list[NonEmpty] = Field(default_factory=list)
    positive_effects: list[Effect] = Field(default_factory=list)
    negative_effects: list[Effect] = Field(default_factory=list)
    alternatives: list[NonEmpty] = Field(default_factory=list)
    validation_needed: list[NonEmpty] = Field(default_factory=list)


class AgentPosition(Contract):
    agent_id: AgentId
    claims: list[Claim]
    stance: Literal["support", "oppose", "revise", "insufficient_evidence"]
    rationale: NonEmpty


class Challenge(Contract):
    target_agent_id: AgentId
    target_claim_id: NonEmpty
    question: NonEmpty
    evidence_ids: list[NonEmpty] = Field(default_factory=list)


class AgentRequest(Contract):
    analysis_id: NonEmpty
    scope: Scope
    stage: Literal["analysis", "perspectives", "challenge", "revision"] = "analysis"
    proposal: ProposalReference | None = None
    evidence_ids: list[NonEmpty] = Field(default_factory=list)
    prior_positions: list[AgentPosition] = Field(default_factory=list)
    challenge: Challenge | None = None

    @model_validator(mode="after")
    def debate_requires_proposal(self) -> "AgentRequest":
        if self.stage != "analysis" and self.proposal is None:
            raise ValueError("Council stages require a specific proposal and version.")
        return self


class AgentResult(Contract):
    schema_version: Literal["1"] = "1"
    run_id: NonEmpty
    analysis_id: NonEmpty
    proposal: ProposalReference | None = None
    scope: Scope
    position: AgentPosition
    recommendations: list[Recommendation]
    challenges: list[Challenge] = Field(default_factory=list)
    assumptions: list[NonEmpty] = Field(default_factory=list)
    uncertainties: list[NonEmpty] = Field(default_factory=list)
    model: NonEmpty
    # The page and council must reuse this result/proposal, not generate unrelated copies.
