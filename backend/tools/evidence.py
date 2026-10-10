from typing import Protocol

from backend.schemas.common import Scope
from backend.schemas.evidence import EquipmentComparison, EvidenceRecord


class EvidenceTools(Protocol):
    """Implement with local indexed records and curated external source snapshots.

    Tool arguments must be validated server-side. Documents are data, not agent
    instructions. Do not accept arbitrary filesystem paths or unrestricted URLs
    from model output. Preserve source locations, dates and feedback IDs.
    """

    async def get_bmw_baseline(self, scope: Scope) -> list[EquipmentComparison]: ...

    async def search_competitor_evidence(
        self, query: str, scope: Scope
    ) -> list[EvidenceRecord]: ...

    async def read_source(self, evidence_id: str) -> EvidenceRecord: ...

    async def compare_equipment(
        self, scope: Scope, evidence_ids: list[str]
    ) -> list[EquipmentComparison]: ...

    async def find_conflicting_evidence(
        self, claim: str, scope: Scope
    ) -> list[EvidenceRecord]: ...
