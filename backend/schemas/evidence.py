from datetime import date, datetime
from typing import Literal

from pydantic import Field, model_validator

from backend.schemas.common import Contract, NonEmpty


class EvidenceRecord(Contract):
    id: NonEmpty
    source_type: Literal["bmw_equipment", "customer_feedback", "competitor_official", "review", "market_metric", "industry_signal", "planning_volume", "customer_study"]
    source_title: NonEmpty
    source_uri: NonEmpty  # Local document identifier or external URL; never model-invented.
    locator: NonEmpty  # e.g. "Feedback_Explorer!I151" or "page 6, infotainment row".
    passage: NonEmpty
    retrieved_at: datetime
    published_on: date | None = None
    brand: NonEmpty
    model: NonEmpty
    market: NonEmpty
    model_year: int | None = None
    trim: str | None = None
    feedback_id: str | None = None  # Deduplicate comments by ID, not classification row.
    country: str | None = None
    powertrain: str | None = None
    categories: list[str] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    reference_status: Literal["current_reference", "historical_reference", "unreviewed"] = "unreviewed"
    verified_on: date | None = None
    review_due_on: date | None = None
    content_kind: Literal["excerpt", "curated_summary"] = "excerpt"

    @model_validator(mode="after")
    def current_references_need_review_dates(self) -> "EvidenceRecord":
        if self.reference_status == "current_reference":
            if not self.verified_on or not self.review_due_on or self.review_due_on < self.verified_on:
                raise ValueError("Current references require a verification date and a valid review deadline")
        return self


class EquipmentComparison(Contract):
    feature: NonEmpty
    brand: NonEmpty
    model: NonEmpty
    market: NonEmpty
    model_year: int | None = None
    trim: str | None = None
    availability: Literal["standard", "optional", "unavailable", "announced", "unknown"]
    evidence_ids: list[NonEmpty] = Field(default_factory=list)
    caveats: list[NonEmpty] = Field(default_factory=list)
