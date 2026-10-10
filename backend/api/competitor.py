from fastapi import APIRouter, HTTPException

from backend.agents.base import AgentNotReadyError
from backend.agents.competitor import CompetitorAgent
from backend.schemas.agent import AgentRequest, AgentResult

router = APIRouter(prefix="/api/competitor", tags=["Competitor"])


@router.post("/analyze", response_model=AgentResult, responses={501: {"description": "Scaffold only"}})
async def analyze(request: AgentRequest) -> AgentResult:
    # Debate turns are dispatched internally by the coordinator, never here.
    if request.stage != "analysis" or request.prior_positions or request.challenge:
        raise HTTPException(422, "Use the PM-triggered council endpoint for debate.")
    try:
        return await CompetitorAgent().run(request)
    except AgentNotReadyError as exc:
        raise HTTPException(501, str(exc)) from exc
