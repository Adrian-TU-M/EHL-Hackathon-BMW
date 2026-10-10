from typing import Literal

from backend.schemas.common import Contract, NonEmpty, ProposalReference, Scope


class DebateRequest(Contract):
    analysis_id: NonEmpty
    proposal: ProposalReference
    scope: Scope
    # Required (no default): automatic analysis is not a debate trigger.
    # This is a workflow assertion, NOT authentication or permission enforcement.
    trigger: Literal["pm_requested"]
    question: NonEmpty
