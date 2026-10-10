from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

NonEmpty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
AgentId = Literal["customer", "market", "competitor", "moderator", "judge"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Scope(Contract):
    # Matches the frontend's current values. G68 stays a distinct source model.
    vehicle: Literal["F70", "G60", "G70"]
    market: Literal["Europe", "United States", "China"]
    powertrain: Literal["Electric", "Plug-in hybrid", "Combustion"]
    horizon: int = Field(ge=3, le=5)
    topic: NonEmpty = Field(max_length=200)


class ProposalReference(Contract):
    proposal_id: NonEmpty
    version: int = Field(ge=1)
