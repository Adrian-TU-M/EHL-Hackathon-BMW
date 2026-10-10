from datetime import date, datetime
from typing import Literal

from pydantic import Field

from backend.schemas.common import Contract, NonEmpty


class EvidenceRecord(Contract):
    id: NonEmpty
    source_type: Literal["bmw_equipment", "customer_feedback", "competitor_official", "review"]
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
