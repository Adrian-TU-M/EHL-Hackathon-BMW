from __future__ import annotations

from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

Criterion = Literal["need", "severity", "gap", "future", "feasibility"]
Domain = Literal["customer", "market", "competitor"]
Stage = Literal["topic", "perspectives", "challenge", "assessment", "revision", "proposal", "review"]
Rating = Annotated[float, Field(ge=0, le=5, allow_inf_nan=False)]
Text = Annotated[str, Field(min_length=1, max_length=20000)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Weights(Model):
    need: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)] = 30
    severity: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)] = 25
    gap: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)] = 15
    future: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)] = 20
    feasibility: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)] = 10


class Scope(Model):
    vehicle: Text
    market: Text
    powertrain: Text
    horizon: Annotated[int, Field(ge=1, le=20)]
    prompt: str = ""


class Evidence(Model):
    id: Text
    domain: Domain
    source: Text
    location: Text
    published_at: Text
    passage: Text
    provenance: Literal["synthetic", "provided", "external"]
    source_url: HttpUrl | None = None
    observation_id: str | None = None
    exclusion_reason: str | None = None
    quantitative: dict | None = None


class Feature(Model):
    id: Text
    version: Annotated[int, Field(ge=1)]
    title: Text
    description: Text
    topic: Text


class Argument(Model):
    id: Text
    agent: Domain
    feature_ids: Annotated[list[str], Field(min_length=1)]
    statement: Text
    evidence_ids: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    challenges: list[str] = Field(default_factory=list)


class JudgeRequest(Model):
    scope: Scope
    background: Annotated[str, Field(max_length=20000)] = ""
    external_processing_approved: bool = False
    features: Annotated[list[Feature], Field(min_length=1, max_length=100)]
    arguments: Annotated[list[Argument], Field(max_length=500)]
    evidence: Annotated[list[Evidence], Field(max_length=1000)]
    weights: Weights = Field(default_factory=Weights)
    constraints: list[str] = Field(default_factory=list)
    pm_message: str | None = None
    clarification_used: bool = False

    @model_validator(mode="after")
    def check_lineage(self):
        for items in (self.features, self.arguments, self.evidence):
            ids = [item.id for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError("IDs must be unique within each collection")
        features = {f.id for f in self.features}
        for arg in self.arguments:
            if not set(arg.feature_ids) <= features:
                raise ValueError("Argument refers to an unknown feature")
        # Missing evidence references are allowed: the Judge must flag them.
        return self


class Citation(Model):
    evidence_id: Text
    quote: Text


class ArgumentAssessment(Model):
    argument_id: Text
    support: Rating | None
    relevance: Rating | None
    influence: Rating | None = None
    verdict: Literal["supported", "partial", "unsupported", "contradicted", "unknown"]
    explanation: Text
    citations: list[Citation] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)


class CriterionAssessment(Model):
    value: Rating | None
    argument_ids: list[str] = Field(default_factory=list)
    rationale: Text


class FeatureAssessment(Model):
    feature_id: Text
    feature_version: Annotated[int, Field(ge=1)]
    recommendation: Literal["recommend", "revise", "defer", "do_not_recommend"]
    rationale: Text
    criteria: dict[Criterion, CriterionAssessment]
    priority: int | None = None
    coverage: int = 0
    evidence_strength: Literal["Illustrative", "Limited", "Moderate", "Strong", "Unknown"]
    benefits: list[str] = Field(default_factory=list)
    drawbacks: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    alternatives: list[str] = Field(default_factory=list)
    proposed_description: str | None = None
    consequential_uncertainty: bool = False


class PriorityProposal(Model):
    weights: Weights
    constraints: list[str] = Field(default_factory=list)
    rationale: Text


class DraftAssessment(Model):
    arguments: list[ArgumentAssessment]
    features: list[FeatureAssessment]
    clarification_requests: list[str] = Field(default_factory=list)
    proposed_priorities: PriorityProposal | None = None


class JudgeAssessment(DraftAssessment):
    id: str
    created_at: str
    weights: Weights
    constraints: list[str]
    ranked_feature_ids: list[str]
    next_action: Literal["continue", "request_clarification", "pause_for_pm"]
    execution: Literal["live", "demo"]
    input_digest: str
    model: str | None = None
    provider: str | None = None


class CouncilEvent(Model):
    sequence: int
    id: str
    stage: Stage
    actor: Literal["customer", "market", "competitor", "moderator", "judge", "PM"]
    statement: Text
    evidence_ids: list[str] = Field(default_factory=list)
    timestamp: str


class StageResult(Model):
    """Returned by the teammate moderator; retrieval occurs outside the Judge."""
    statements: list[Argument] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    features: list[Feature] = Field(default_factory=list)
    summary: Text


class CouncilCreate(Model):
    request: JudgeRequest
    mode: Literal["manual", "auto"] = "manual"


class CouncilControl(Model):
    action: Literal["continue", "pause", "resume", "interrupt"]
    expected_revision: int
    rationale: Text


class PMMessage(Model):
    id: Text
    expected_revision: int
    content: Text


class ReviewCheckpoint(Model):
    stage: Stage
    reason: Text


class CouncilView(Model):
    id: str
    analysis_id: str
    mode: Literal["manual", "auto"]
    status: Literal["running", "paused", "interrupted", "complete"]
    stage: Stage
    revision: int
    round: int
    checkpoint: ReviewCheckpoint | None
    request: JudgeRequest
    assessment: JudgeAssessment | None
    events: list[CouncilEvent]
    execution: Literal["live", "demo"]
    input_mode: Literal["team", "context", "demo"] = "team"
    decisions: list[dict] = Field(default_factory=list)
    processing_seconds: float = 0


class DecisionInput(Model):
    id: Text
    feature_id: Text
    expected_version: int
    assessment_id: Text
    action: Literal["approve", "reject", "defer", "edit"]
    rationale: Text
    description: str | None = None


class ConfirmPriorities(Model):
    expected_revision: int
    assessment_id: Text
    rationale: Text
