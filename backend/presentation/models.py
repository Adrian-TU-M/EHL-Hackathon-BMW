from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator


def now() -> str:
    return datetime.now(UTC).isoformat()


def uid(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:16]}"


def fingerprint(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()
    ).hexdigest()


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


Audience = Literal["executive", "finance", "engineering", "sales"]
Origin = Literal["sourced", "pm_estimate", "synthetic", "unknown"]


class SourcePassage(Model):
    id: str
    source: str
    location: str
    passage: str
    provenance: str
    limitations: list[str] = Field(default_factory=list)
    quantitative: dict[str, Any] | None = None


class ApprovedDecision(Model):
    id: str
    version: int = Field(ge=1)
    title: str
    description: str
    pm_rationale: str
    rationale: str = ""
    evidence_ids: list[str] = Field(default_factory=list)
    findings: list[dict[str, Any]] = Field(default_factory=list)
    history: list[dict[str, Any]] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    alternatives: list[dict[str, Any]] = Field(default_factory=list)
    debate: list[dict[str, Any]] = Field(default_factory=list)
    criteria: dict[str, Any] = Field(default_factory=dict)
    effort: str = "Unknown"
    risk: float | None = None


class ApprovedDecisionSnapshot(Model):
    schema_version: int = 1
    kind: Literal["isolated_demo", "dashboard_demo", "council"]
    source_id: str
    source_hash: str
    captured_at: str = Field(default_factory=now)
    scope: dict[str, Any]
    decisions: list[ApprovedDecision]
    evidence: list[SourcePassage]
    weights: dict[str, float] = Field(default_factory=dict)
    synthetic: bool = False
    limitations: list[str] = Field(default_factory=list)


class FinancialInput(Model):
    value: float | None = Field(default=None, ge=0)
    origin: Origin = "unknown"
    reference: str = ""

    @model_validator(mode="after")
    def provenance_required(self):
        if self.origin == "unknown" and self.value is not None:
            raise ValueError("Unknown inputs cannot carry a value")
        if self.origin != "unknown" and (
            self.value is None or not self.reference.strip()
        ):
            raise ValueError("Every estimate needs a value and a source or rationale")
        return self


class FinancialPlan(Model):
    pilot: FinancialInput = Field(default_factory=FinancialInput)
    development: FinancialInput = Field(default_factory=FinancialInput)
    rollout: FinancialInput = Field(default_factory=FinancialInput)
    annual_opex: FinancialInput = Field(default_factory=FinancialInput)
    eligible_volume: FinancialInput = Field(default_factory=FinancialInput)
    contribution: FinancialInput = Field(default_factory=FinancialInput)
    adoption: list[FinancialInput] = Field(
        default_factory=lambda: [FinancialInput() for _ in range(3)],
        min_length=3,
        max_length=3,
    )
    discount_rate: FinancialInput = Field(default_factory=FinancialInput)

    @model_validator(mode="after")
    def rates(self):
        for item in [*self.adoption, self.discount_rate]:
            if item.value is not None and item.value > 1:
                raise ValueError("Rates must be fractions between zero and one")
        return self


class PresentationBrief(Model):
    presenter_name: str = Field(default="", max_length=80)
    presenter_role: str = Field(default="", max_length=100)
    meeting_date: str = Field(
        default="", max_length=10, pattern=r"^(?:\d{4}-\d{2}-\d{2})?$"
    )
    title: str = Field(
        default="A clearer customer experience", min_length=1, max_length=100
    )
    audience: Audience = "executive"
    minutes: int = Field(default=12, ge=5, le=60)
    currency: Literal["USD", "EUR"] = "USD"
    emphasis: str = Field(
        default="Customer value, disciplined investment and measurable validation",
        max_length=2000,
    )
    constraints: str = Field(
        default="Engineering feasibility and financial assumptions require validation",
        max_length=2000,
    )
    funding_structure: Literal["staged", "upfront"] = "staged"
    financials: FinancialPlan = Field(default_factory=FinancialPlan)


class ScenarioResult(Model):
    name: str
    benefits: list[float]
    cash_flows: list[float]
    total_benefit: float
    total_cost: float
    net_value: float
    roi: float | None
    npv: float
    break_even_year: int | None


class BusinessArgument(Model):
    """Shared, source-grounded argument; money always comes from FinancialPlan."""

    recommendation: str = Field(max_length=220)
    customer_outcomes: list[str] = Field(min_length=1, max_length=4)
    alternatives: list[str] = Field(min_length=1, max_length=4)
    dependencies: list[str] = Field(min_length=1, max_length=4)
    validation_gates: list[str] = Field(min_length=1, max_length=4)
    objections: list[str] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def fit(self):
        for name in (
            "customer_outcomes",
            "alternatives",
            "dependencies",
            "validation_gates",
            "objections",
        ):
            if any(len(value) > 175 for value in getattr(self, name)):
                raise ValueError(
                    "Business argument points must fit a slide (175 characters)"
                )
        return self


class BusinessCase(Model):
    currency: str
    investment: float | None = None
    initial_ask: float | None = None
    scenarios: list[ScenarioResult] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    assumptions: dict[str, Any] = Field(default_factory=dict)
    argument: BusinessArgument | None = None
    limitations: list[str] = Field(
        default_factory=lambda: [
            "Three-year incremental contribution model. Tax, financing, terminal value and wider strategic benefits are excluded.",
            "Portfolio benefits are counted once. Priority scores do not establish financial returns.",
        ]
    )


class OutlineItem(Model):
    id: str
    role: str = ""
    section: str = ""
    title: str = Field(min_length=1, max_length=100)
    purpose: str = Field(min_length=1, max_length=500)
    decision_ids: list[str] = Field(default_factory=list)


class SlideContentItem(Model):
    label: str = Field(default="", max_length=60)
    detail: str = Field(default="", max_length=130)
    owner: str = Field(default="", max_length=45)
    timing: str = Field(default="", max_length=40)
    dependency: str = Field(default="", max_length=100)
    condition: str = Field(default="", max_length=100)
    source_id: str = Field(default="", max_length=100)


class SlideContent(Model):
    """Bounded editable fields; geometry and numerical charts stay application-owned."""

    kind: Literal[
        "problem",
        "evidence",
        "portfolio",
        "journey",
        "comparison",
        "responsibilities",
        "roadmap",
        "risks",
    ]
    items: list[SlideContentItem] = Field(min_length=1, max_length=4)


ThemeId = Literal[
    "legacy-v1",
    "premium-v1",
    "bmw-executive-v1",
    "bmw-executive-v2",
    "bmw-cinematic-v1",
]


class SlideSpec(Model):
    id: str
    role: str = ""
    section: str = ""
    title: str = Field(min_length=1, max_length=100)
    takeaway: str = Field(default="", max_length=220)
    layout: Literal[
        "cover",
        "evidence",
        "portfolio",
        "comparison",
        "financial",
        "roadmap",
        "risk",
        "closing",
        "appendix",
    ] = "evidence"
    points: list[str] = Field(default_factory=list, max_length=4)
    layout_id: str | None = Field(default=None, max_length=50)
    content: SlideContent | None = None
    notes: str = Field(default="", max_length=10000)
    decision_ids: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    locked: bool = False
    synthetic: bool = False

    @model_validator(mode="after")
    def content_limits(self):
        if any(len(p) > 180 for p in self.points):
            raise ValueError(
                "Slide points must fit the presentation layout (180 characters each)"
            )
        return self


class DeckDocument(Model):
    audience: Audience
    theme_id: ThemeId = "legacy-v1"
    slides: list[SlideSpec] = Field(default_factory=list, max_length=100)
    complete: bool = False


class RevisionProposal(Model):
    id: str = Field(default_factory=lambda: uid("change"))
    expected_revision: int
    audience: Audience
    instruction: str
    before: SlideSpec
    after: SlideSpec
    status: Literal["pending", "applied", "discarded"] = "pending"


class AudienceOutline(Model):
    items: list[OutlineItem] = Field(default_factory=list)
    approved: bool = False


class DeckRevision(Model):
    revision: int
    at: str = Field(default_factory=now)
    reason: str
    snapshot: ApprovedDecisionSnapshot
    brief: PresentationBrief
    business_case: BusinessCase
    outline: list[OutlineItem]
    decks: dict[str, DeckDocument]
    audience_outlines: dict[str, AudienceOutline] = Field(default_factory=dict)


class GenerationJob(Model):
    id: str = Field(default_factory=lambda: uid("job"))
    key: str
    operation: Literal["outline", "slides", "variant", "revision"]
    audience: Audience
    expected_revision: int
    status: Literal["queued", "running", "complete", "failed", "cancelled"] = "queued"
    progress: int = 0
    message: str = "Queued"
    error: str | None = None
    started_at: str = Field(default_factory=now)
    finished_at: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class RehearsalSession(Model):
    id: str = Field(default_factory=lambda: uid("rehearsal"))
    persona: Literal["cfo", "engineering", "executive", "sales"]
    audience: Audience
    deck_revision: int
    messages: list[dict[str, str]] = Field(default_factory=list)
    feedback: list[str] = Field(default_factory=list)
    complete: bool = False


class Presentation(Model):
    id: str = Field(default_factory=lambda: uid("presentation"))
    revision: int = 1
    created_at: str = Field(default_factory=now)
    updated_at: str = Field(default_factory=now)
    mode: Literal["demo", "ollama"]
    snapshot: ApprovedDecisionSnapshot
    brief: PresentationBrief
    business_case: BusinessCase
    outline: list[OutlineItem] = Field(default_factory=list)
    outline_approved: bool = False
    audience_outlines: dict[str, AudienceOutline] = Field(default_factory=dict)
    decks: dict[str, DeckDocument] = Field(default_factory=dict)
    dossiers: list[dict[str, Any]] = Field(default_factory=list)
    proposals: list[RevisionProposal] = Field(default_factory=list)
    jobs: list[GenerationJob] = Field(default_factory=list)
    history: list[DeckRevision] = Field(default_factory=list)
    rehearsals: list[RehearsalSession] = Field(default_factory=list)
    voice_messages: list[dict[str, str]] = Field(default_factory=list)
    events: list[dict[str, Any]] = Field(default_factory=list)
    finalized_revision: int | None = None
    stale: bool = False
    update_available: bool = False
    review_findings: list[str] = Field(default_factory=list)
