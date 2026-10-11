from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

Role = Literal["customer", "market", "competitor"]
Actor = Literal[
    "customer", "market", "competitor", "moderator", "judge", "PM", "System"
]
Domain = Literal["customer", "market", "competitor", "product", "corporate"]
Closure = Literal[
    "completed",
    "insufficient_evidence",
    "unresolved_disagreement",
    "budget_exhausted",
    "pm_stopped",
]
ROLES: tuple[Role, ...] = ("customer", "market", "competitor")


def uid(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:16]}"


def now() -> str:
    return datetime.now(UTC).isoformat()


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class Scope(Model):
    vehicle: Literal["F70", "G60", "G70"]
    market: Literal["Europe", "United States", "China"]
    powertrain: Literal["Electric", "Plug-in hybrid", "Combustion"]
    horizon: int = Field(default=4, ge=3, le=5)
    prompt: str = Field(default="", max_length=4000)
    confirmedAt: str | None = None


class Source(Model):
    id: str
    name: str
    sha256: str
    domain: Domain
    source_url: str | None = None
    edition: str | None = None
    units: str | None = None
    coverage: dict[str, Any] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)
    provenance: Literal["supplied", "external", "synthetic"] = "supplied"
    retrieved_at: str | None = None
    publisher: str | None = None
    quality: Literal["primary", "secondary", "unverified"] = "unverified"


class Evidence(Model):
    id: str
    source_id: str
    domain: Domain
    location: str
    passage: str
    vehicle: str | None = None
    region: str | None = None
    country: str | None = None
    powertrain: str | None = None
    published_at: str | None = None
    period: str | None = None
    kind: Literal[
        "feedback",
        "study_mean",
        "study_distribution",
        "sales_actual",
        "provided_forecast",
        "equipment",
        "report_context",
        "external_context",
    ]
    context_type: Literal[
        "reported_result",
        "management_expectation",
        "corporate_target",
        "model_announcement",
        "mixed",
        "unknown",
    ] = "unknown"
    observation_id: str | None = None
    classification_rows: list[int] = Field(default_factory=list)
    classifications: list[str] = Field(default_factory=list)
    feedback_types: list[str] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    quantitative: dict[str, Any] | None = None
    limitations: list[str] = Field(default_factory=list)
    excluded_reason: str | None = None
    # PDF tables stay unverified until an equipment extractor supplies exact row/column evidence.
    equipment_verified: bool = False
    derivative: str | None = None
    availability: Literal["standard", "optional", "unavailable", "unknown"] = "unknown"
    dependencies: list[str] = Field(default_factory=list)


class Catalog(Model):
    version: int = 1
    snapshot_hash: str
    created_at: str = Field(default_factory=now)
    sources: list[Source]
    evidence: list[Evidence]
    warnings: list[str] = Field(default_factory=list)


class Rating(Model):
    value: float | None = Field(default=None, ge=0, le=5)
    evidence_ids: list[str] = Field(default_factory=list)
    rationale: str

    @model_validator(mode="after")
    def cited(self):
        if self.value is not None and not self.evidence_ids:
            raise ValueError("A known rating requires evidence")
        return self


class AgendaTopic(Model):
    id: str
    label: str
    area: str
    question: str
    evidence_ids: list[str]
    counterevidence_ids: list[str] = Field(default_factory=list)
    ratings: dict[str, Rating]
    lower_score: float
    upper_score: float
    coverage: float
    observation_count: int
    denominator: int
    exploratory: bool = False
    pinned: bool = False
    severe: bool = False
    goal_relevance: int = 0
    eligible: bool = True
    rationale: str
    limitations: list[str] = Field(default_factory=list)


class Agenda(Model):
    id: str = Field(default_factory=lambda: uid("agenda"))
    version: int = 1
    scope: Scope
    source_snapshot: str
    weights: dict[str, float] = Field(
        default_factory=lambda: {"need": 40, "severity": 35, "future": 20, "gap": 5}
    )
    topics: list[AgendaTopic]
    selected_ids: list[str]
    confirmed_at: str | None = None
    warnings: list[str] = Field(default_factory=list)
    policy_version: str = "customer-led-v1"
    semantic_refinement: str = "not_configured"


class Assumption(Model):
    id: str
    version: int = 1
    statement: str
    author: Actor
    scope: Scope
    rationale: str
    status: Literal[
        "proposed", "contested", "accepted_for_scenario", "refuted", "superseded"
    ] = "proposed"
    evidence_ids: list[str] = Field(default_factory=list)
    opposing_evidence_ids: list[str] = Field(default_factory=list)
    affected_claim_ids: list[str] = Field(default_factory=list)
    affected_alternative_ids: list[str] = Field(default_factory=list)
    validation_needed: str
    material: bool = True


class Calculation(Model):
    operation: Literal["share", "growth", "sum", "mean"]
    values: list[float] = Field(min_length=1, max_length=1000)
    result: float
    unit: str
    denominator: float | None = None
    evidence_ids: list[str] = Field(min_length=1)
    method: str
    filters: list[str] = Field(default_factory=list)
    period: str


class Claim(Model):
    id: str
    actor: Role
    statement: str = Field(min_length=1, max_length=6000)
    kind: Literal[
        "observation",
        "forecast",
        "target",
        "inference",
        "hypothesis",
        "preference",
        "limitation",
        "unknown",
    ]
    evidence_ids: list[str] = Field(default_factory=list)
    assumption_ids: list[str] = Field(default_factory=list)
    calculation: Calculation | None = None
    consequential: bool = True
    validation: Literal["unchecked", "supported", "unsupported", "unverified"] = (
        "unchecked"
    )
    issues: list[str] = Field(default_factory=list)
    semantic_check: str = "not_run"


class Alternative(Model):
    id: str
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    tradeoff: str = Field(min_length=1)
    assumption_ids: list[str] = Field(default_factory=list)


class AgentPosition(Model):
    actor: Role
    summary: str
    claims: list[Claim] = Field(default_factory=list, max_length=12)
    alternatives: list[Alternative] = Field(default_factory=list, max_length=6)
    counterevidence_ids: list[str] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    change_conditions: list[str] = Field(default_factory=list)
    assumptions: list[Assumption] = Field(default_factory=list, max_length=6)
    abstention_reason: str | None = None


class Challenge(Model):
    id: str
    actor: Role
    target_actor: Role
    target_claim_id: str
    kind: Literal[
        "fact", "scope", "interpretation", "preference", "assumption", "tradeoff"
    ]
    question: str
    consequence: str
    evidence_ids: list[str] = Field(default_factory=list)
    status: Literal["open", "resolved", "narrowed", "unresolved"] = "open"
    response: str | None = None
    response_evidence_ids: list[str] = Field(default_factory=list)
    requested_status: Literal["resolved", "narrowed", "unresolved"] | None = None


class ChallengeResponse(Model):
    challenge: Challenge | None = None
    abstention_reason: str | None = None

    @model_validator(mode="after")
    def explicit(self):
        if self.challenge is None and not self.abstention_reason:
            raise ValueError("Supply a challenge or explicit abstention")
        return self


class RebuttalItem(Model):
    challenge_id: str
    status: Literal["resolved", "narrowed", "unresolved"]
    statement: str
    evidence_ids: list[str] = Field(default_factory=list)


class Rebuttal(Model):
    actor: Role
    responses: list[RebuttalItem]


class Clarification(Model):
    actor: Role
    question: str = Field(min_length=5)
    rationale: str
    material: bool
    answerable: bool
    evidence_ids: list[str] = Field(min_length=1)
    claim_ids: list[str] = Field(default_factory=list)
    requires_scope_change: bool = False


class ClarificationResponse(Model):
    actor: Role
    statement: str
    evidence_ids: list[str]
    claim_ids: list[str] = Field(default_factory=list)


class ScoringInput(Model):
    kind: Literal["sourced", "inferred", "assumed", "unknown"]
    label: str = Field(min_length=1)
    rationale: str = Field(min_length=1)
    value: float | str | None = None
    evidence_ids: list[str] = Field(default_factory=list)
    claim_ids: list[str] = Field(default_factory=list)
    assumption_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def unknown_has_no_value(self):
        if self.kind == "unknown" and self.value is not None:
            raise ValueError("An unknown scoring input cannot carry an invented value")
        return self


class JudgeProposal(Model):
    id: str
    version: int = Field(default=1, ge=1)
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    evidence_ids: list[str] = Field(default_factory=list)
    claim_ids: list[str] = Field(default_factory=list)
    assumption_ids: list[str] = Field(default_factory=list)


class JudgeAssessment(Model):
    summary: str
    unresolved_issues: list[str] = Field(default_factory=list)
    clarification: Clarification | None = None
    evidence_ids: list[str] = Field(default_factory=list)
    scoring_inputs: list[ScoringInput] = Field(default_factory=list)
    proposals: list[JudgeProposal] = Field(default_factory=list)


class TopicBrief(Model):
    topic_id: str
    question: str
    scope: Scope
    objective: str
    equipment_baseline: list[str]
    coverage: dict[str, int]
    limitations: list[str]
    change_question: str = (
        "Which supplied evidence would change the preferred alternative?"
    )


class DiscussionEvent(Model):
    id: str
    session_id: str
    run_id: str
    topic_id: str | None
    sequence: int
    timestamp: str = Field(default_factory=now)
    stage: str
    actor: Actor
    statement: str
    evidence_ids: list[str] = Field(default_factory=list)
    assumption_versions: dict[str, int] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)


class JudgePacket(Model):
    id: str
    version: int = 1
    brief: TopicBrief
    source_snapshot: str
    source_inventory: list[Source]
    evidence_index: list[dict[str, Any]]
    positions: list[AgentPosition]
    claims: list[Claim]
    challenges: list[Challenge]
    alternatives: list[Alternative]
    assumptions: list[Assumption]
    unresolved_issues: list[str]
    coverage_limitations: list[str]
    transcript: list[DiscussionEvent]
    clarification: ClarificationResponse | None = None
    closure_reason: Closure | None = None
    pm_challenges: list[str] = Field(default_factory=list)
    counterevidence_ids: list[str] = Field(default_factory=list)
    usage: dict[str, float] = Field(default_factory=dict)


class Decision(Model):
    version: int
    status: Literal[
        "Pending review",
        "Approved",
        "Rejected",
        "Deferred",
        "Evidence requested",
        "Challenged",
    ]
    rationale: str
    at: str = Field(default_factory=now)


class ProposalDecision(Decision):
    proposal_id: str
    proposal_version: int
    outcome_version: int


class ProposalReviewInput(Model):
    expected_version: int
    expected_outcome_version: int
    status: Literal["Approved", "Rejected", "Deferred", "Challenged", "Pending review"]
    rationale: str = Field(min_length=1, max_length=4000)


class TopicOutcome(Model):
    topic_id: str
    version: int = 1
    closure_reason: Closure
    packet: JudgePacket
    assessment: JudgeAssessment | None = None
    assessment_valid: bool = True
    review_status: str = "Pending review"
    decisions: list[Decision] = Field(default_factory=list)
    history: list[dict[str, Any]] = Field(default_factory=list)
    proposal_decisions: list[ProposalDecision] = Field(default_factory=list)


class Limits(Model):
    call_seconds: float = Field(default=45, gt=0, le=120)
    topic_seconds: float = Field(default=300, gt=0, le=1800)
    topic_tokens: int = Field(default=60000, ge=1, le=1000000)
    session_tokens: int = Field(default=360000, ge=1, le=6000000)
    session_seconds: float = Field(default=1800, gt=0, le=10800)
    reserve_fraction: float = Field(default=0.2, ge=0.2, le=0.5)


class Work(Model):
    brief: TopicBrief
    stage: str = "perspectives"
    positions: list[AgentPosition] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)
    challenges: list[Challenge] = Field(default_factory=list)
    alternatives: list[Alternative] = Field(default_factory=list)
    assessment: JudgeAssessment | None = None
    clarification: ClarificationResponse | None = None
    clarification_used: bool = False
    tokens: int = 0
    active_seconds: float = 0
    errors: list[str] = Field(default_factory=list)
    pm_challenges: list[str] = Field(default_factory=list)
    attempts: dict[str, int] = Field(default_factory=dict)
    blocked_preference: bool = False
    stage_started_at: str | None = None
    budget_exhausted: bool = False


class Session(Model):
    id: str = Field(default_factory=lambda: uid("session"))
    run_id: str = Field(default_factory=lambda: uid("run"))
    parent_session_id: str | None = None
    agenda: Agenda
    status: Literal[
        "awaiting_confirmation",
        "ready",
        "running",
        "paused",
        "interrupted",
        "complete",
        "unavailable",
    ] = "awaiting_confirmation"
    mode: Literal["deterministic", "http"]
    cursor: int = 0
    sequence: int = 0
    revision: int = 0
    generation: int = 0
    work: Work | None = None
    outcomes: list[TopicOutcome] = Field(default_factory=list)
    assumptions: list[Assumption] = Field(default_factory=list)
    assumption_history: list[Assumption] = Field(default_factory=list)
    limits: Limits = Field(default_factory=Limits)
    tokens: int = 0
    active_seconds: float = 0
    created_at: str = Field(default_factory=now)
    availability: list[str] = Field(default_factory=list)


class SeveritySubstantiation(Model):
    topic_id: str
    evidence_ids: list[str] = Field(min_length=1)
    rationale: str = Field(min_length=5, max_length=2000)


class ConfirmAgenda(Model):
    expected_version: int
    selected_ids: list[str] = Field(min_length=1, max_length=50)
    pinned_ids: list[str] = Field(default_factory=list)
    severity_substantiations: list[SeveritySubstantiation] = Field(default_factory=list)


class Control(Model):
    action: Literal[
        "start",
        "pause",
        "resume",
        "interrupt",
        "challenge",
        "skip",
        "reorder",
        "finish",
    ]
    expected_revision: int
    idempotency_key: str = Field(min_length=1, max_length=100)
    rationale: str = Field(default="", max_length=4000)
    topic_ids: list[str] = Field(default_factory=list)
    expected_topic_id: str | None = None


class AssumptionChange(Model):
    expected_version: int
    statement: str = Field(min_length=1, max_length=4000)
    status: Literal[
        "proposed", "contested", "accepted_for_scenario", "refuted", "superseded"
    ]
    rationale: str = Field(min_length=1, max_length=4000)


class ReviewInput(Model):
    expected_version: int
    status: Literal[
        "Pending review",
        "Approved",
        "Rejected",
        "Deferred",
        "Evidence requested",
        "Challenged",
    ]
    rationale: str = Field(min_length=1, max_length=4000)


class SemanticReview(Model):
    supported_ids: list[str]
    unsupported: dict[str, str] = Field(default_factory=dict)


class TopicGroup(Model):
    topic_ids: list[str] = Field(min_length=1)
    label: str = Field(min_length=1, max_length=150)
    question: str = Field(min_length=5, max_length=500)


class AgendaRefinement(Model):
    groups: list[TopicGroup] = Field(default_factory=list, max_length=60)
