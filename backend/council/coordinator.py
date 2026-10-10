from backend.agents.base import AgentNotReadyError
from backend.schemas.council import DebateRequest

STAGES = ("topic", "perspectives", "challenge", "assessment", "revision", "proposal", "review")


async def start_debate(request: DebateRequest) -> None:
    """Only the explicit PM debate route may call this entry point.

    Next: load the persisted proposal/version, reject stale requests, acquire a
    run lock, collect independent positions, share claims, bound challenge and
    revision rounds, emit events, then stop for PM review. Pause/cancel and
    idempotency belong here. Do not use timers to fabricate agent statements.
    """
    raise AgentNotReadyError("Council coordinator is scaffolded; live debate is not implemented.")
