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
Stage = Literal["perspectives", "challenge", "revision"]


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


class PerspectiveRequest(BaseModel):
    scope: Scope
    topic: str  # theme or frontend Topic
    stage: Stage = "perspectives"
    question: str = ""
    challenge: str = ""


class CouncilEvent(BaseModel):
    id: str
    stage: Stage
    actor: Literal["customer"] = "customer"
    statement: str
    evidenceIds: list[str]
    assumption: str | None = None
    recommendation: str = ""
    uncertainties: list[str] = Field(default_factory=list)
    quantitative: list[QuantitativeClaim] = Field(default_factory=list)
    model: str = ""


ThemeStat.model_rebuild()
