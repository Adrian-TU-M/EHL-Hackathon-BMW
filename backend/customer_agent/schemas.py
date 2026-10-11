"""API models. Field names mirror src/lib/types/index.ts (camelCase) so the frontend
adapter can consume them directly. Vehicles, markets and powertrains are plain strings
because they come from the data, not a fixed enum."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Polarity = Literal["Complaint", "Request", "Positive", "Unclassified"]
FindingKind = Literal[
    "recurring_complaint",
    "requested_feature",
    "unmet_need",
    "retain_positive",
    "friction",
    "segment_difference",
]
# "discussion" = a turn in an open conversation (reply to the latest message / question).
Stage = Literal["perspectives", "challenge", "revision", "discussion"]


class Scope(BaseModel):
    vehicle: str
    market: str
    powertrain: str | None = None  # None = all powertrains
    horizon: int | None = None
    prompt: str = ""


class QuantitativeClaim(BaseModel):
    """Spec §7: every number exposes source, sample, denominator, filters, market,
    time frame, method and limitations."""

    numerator: int | float
    denominator: int | float | None
    unit: str
    sourceId: str
    filters: list[str]
    market: str
    period: str
    method: str
    limitations: str


class Evidence(BaseModel):
    id: str
    domain: Literal["customer"] = "customer"
    source: str
    location: str
    publishedAt: str
    provenance: Literal["bmw-supplied"] = "bmw-supplied"
    vehicle: str
    market: str
    country: str = ""
    powertrain: str
    category: str  # frontend Topic when one fits, else the theme
    theme: str
    topic: str | None
    subcategories: list[str]
    type: Polarity
    feedbackTypes: list[str]
    passage: str
    classificationRows: int
    channel: str = ""
    severity: str | None = None
    quantitative: QuantitativeClaim | None = None


class ThemeStat(BaseModel):
    theme: str
    topic: str | None
    records: int
    classificationRows: int
    complaints: int
    requests: int
    positives: int
    shareOfRecords: QuantitativeClaim
    complaintShare: QuantitativeClaim
    topSubcategories: list[tuple[str, int]]
    segments: dict[str, dict[str, int]]  # dimension -> value -> records
    studyRefs: list["StudyRef"]


class StudyRef(BaseModel):
    id: str
    source: str
    market: str
    vehicle: str
    attribute: str
    metric: str
    value: float | None
    bottomBox: float | None = None  # distribution studies only
    comparison: dict[str, float]  # other vehicles in the same study & market
    quantitative: QuantitativeClaim


class Coverage(BaseModel):
    scope: Scope
    feedbackRows: int
    uniqueRecords: int
    uniqueCustomers: int | None
    customersIdentifiable: bool
    byPolarity: dict[str, int]
    byPowertrain: dict[str, int]
    byChannel: dict[str, int]
    studies: list[dict]
    available: list[dict]  # vehicle x market x powertrain combinations with records
    warnings: list[str]


class Finding(BaseModel):
    id: str
    title: str
    detail: str
    kind: FindingKind
    theme: str
    topic: str | None
    evidenceIds: list[str]
    studyRefIds: list[str] = Field(default_factory=list)
    uncertainty: str
    quantitative: list[QuantitativeClaim]
    records: int
    classificationRows: int
    customersIdentifiable: bool
    generatedBy: str


class AnalysisResult(BaseModel):
    scope: Scope
    coverage: Coverage
    themes: list[ThemeStat]
    findings: list[Finding]
    evidence: list[Evidence]
    droppedCitations: int
    model: str
    warnings: list[str]


class DiscussionMessage(BaseModel):
    """A previous turn by another participant. Context for the reply, never evidence."""
    actor: str = Field(max_length=40)
    statement: str = Field(max_length=2000)


class PerspectiveRequest(BaseModel):
    focus_record_ids: list[str] | None = Field(default=None, max_length=500)
    scope: Scope
    # Theme or frontend Topic. Empty / "overall" / "all" = open discussion: topics are taken from
    # the question, or the agent covers the scope's top customer themes.
    topic: str = ""
    stage: Stage = "perspectives"
    question: str = ""
    challenge: str = ""
    context: list[DiscussionMessage] = Field(default_factory=list, max_length=20)


class CouncilEvent(BaseModel):
    id: str
    stage: Stage
    actor: Literal["customer"] = "customer"
    statement: str
    evidenceIds: list[str]
    assumption: str | None = None
    recommendation: str = ""
    evidenceBase: str = ""  # deterministic: records on the topic, of total in scope; thin flag
    focus: Literal["topic", "question", "overall", "none"] = "topic"  # how themes were chosen
    themes: list[str] = Field(default_factory=list)  # customer themes this turn draws on
    # Debate: whom this turn answers, the stance taken, and a question put back to them.
    respondingTo: str = ""
    stance: Literal["agree", "partly_agree", "disagree", "outside_evidence", "none"] = "none"
    counterQuestion: str = ""
    uncertainties: list[str] = Field(default_factory=list)
    quantitative: list[QuantitativeClaim] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)  # the cited feedback records, resolved
    model: str = ""


ThemeStat.model_rebuild()


# ---------- Customer Intelligence dashboard (deterministic, no LLM) ----------


class DashboardFilters(BaseModel):
    vehicle: str
    market: str = "All"
    powertrain: str = "All"
    source: str = "All"
    category: str = "All"  # source category label (e.g. VFC level 2)


class RankItem(BaseModel):
    category: str
    theme: str
    records: int
    severity: dict[str, int] = Field(default_factory=dict)  # level -> records (when derivable)


class Ranking(BaseModel):
    type: str  # raw feedback type label, e.g. "Likes", "Defect"
    polarity: Polarity
    records: int
    claim: QuantitativeClaim
    items: list[RankItem]


class TreeLeaf(BaseModel):
    name: str
    records: int


class TreeNode(BaseModel):
    category: str
    theme: str
    records: int
    positive: int
    negative: int
    request: int
    children: list[TreeLeaf]


class SegmentValue(BaseModel):
    value: str
    negative: int
    total: int
    share: float | None


class SegmentSplit(BaseModel):
    dimension: str
    category: str
    values: list[SegmentValue]
    hidden: list[str]  # segment values below the minimum sample size


class StudyRow(BaseModel):
    id: str
    source: str
    sheet: str
    kind: str
    market: str
    vehicle: str
    attribute: str
    theme: str
    metric: str
    value: float | None
    bottomBox: float | None
    distribution: dict[str, float] | None
    year: str
    levelsNote: str


class DashboardOptions(BaseModel):
    sources: list[tuple[str, int]]
    categories: list[tuple[str, int]]
    types: list[str]
    severityLevels: list[str]
    available: list[dict]  # vehicle x market x powertrain combinations with feedback
    studyAvailable: list[dict]  # vehicle x market combinations with study data


class DashboardKpis(BaseModel):
    records: QuantitativeClaim
    improvement: QuantitativeClaim
    likes: QuantitativeClaim
    satisfaction: StudyRef | None


class Dashboard(BaseModel):
    filters: DashboardFilters
    dataSource: Literal["live"] = "live"
    records: int
    rows: int
    byType: dict[str, int]
    kpis: DashboardKpis
    rankings: list[Ranking]
    tree: list[TreeNode]
    segments: list[SegmentSplit]
    themes: list[ThemeStat]
    studies: list[StudyRow]
    coverage: Coverage
    options: DashboardOptions
    minSegment: int


class QuotePage(BaseModel):
    total: int
    offset: int
    items: list[Evidence]


class Drilldown(BaseModel):
    filters: DashboardFilters
    category: str | None
    theme: str | None
    type: str | None
    claim: QuantitativeClaim
    subcategories: list[tuple[str, int]]
    studyRefs: list[StudyRef]
    quotes: QuotePage


class FeatureRow(BaseModel):
    """One source category (e.g. VFC level 2) with unique-record counts per feedback type."""

    category: str
    theme: str
    records: int  # records in this table's side (negative or positive)
    byType: dict[str, int]


class FeatureRanking(BaseModel):
    filters: DashboardFilters
    records: int  # all unique feedback records in scope (denominator)
    dislikes: list[FeatureRow]  # Defect + Difficult to Use, most mentioned first
    likes: list[FeatureRow]  # Likes + Wants, most mentioned first
    coverage: Coverage
