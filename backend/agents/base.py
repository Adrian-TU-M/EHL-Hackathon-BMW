from typing import Protocol

from backend.schemas.agent import AgentRequest, AgentResult
from backend.schemas.common import AgentId


class AgentNotReadyError(RuntimeError):
    """The scaffold must not return fabricated success before implementation."""


class Agent(Protocol):
    agent_id: AgentId

    async def run(self, request: AgentRequest) -> AgentResult:
        """Produce an evidence-grounded position for analysis or a council turn."""
        ...
