from fastapi import APIRouter, HTTPException

from backend.agents.base import AgentNotReadyError
from backend.council.coordinator import start_debate
from backend.schemas.council import DebateRequest

router = APIRouter(prefix="/api/council", tags=["Council"])


@router.post("/debate", status_code=501, responses={501: {"description": "Scaffold only"}})
async def debate(request: DebateRequest) -> None:
    # A future authenticated session must establish who is PM. The request field
    # alone is NOT authorization. This scaffold is for loopback development.
    try:
        await start_debate(request)
    except AgentNotReadyError as exc:
        raise HTTPException(501, str(exc)) from exc
