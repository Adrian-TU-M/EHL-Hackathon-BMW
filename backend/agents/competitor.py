"""Competitor agent entry point; research and debate execution are next steps."""

from backend.agents.base import AgentNotReadyError
from backend.schemas.agent import AgentRequest, AgentResult
from backend.schemas.common import AgentId

COMPETITOR_INSTRUCTIONS = """
Advocate for BMW's competitive advantage, not for a rival's commercial success.
Check BMW's existing equipment before claiming a gap. Compare equivalent markets,
model years, trims and powertrains. Treat feedback as reported perception, not
verified rival specifications. Missing evidence means unknown, not unavailable.
Distinguish sourced facts, interpretations and future-effect hypotheses.
For debate, address the supplied claim IDs and evidence. Concede or revise when
better evidence contradicts your position. Never invent specifications, citations,
sales uplift or certainty. Produce a concise rationale, not private deliberation.
Do not start a council, approve a requirement, or execute arbitrary commands.
""".strip()


class CompetitorAgent:
    agent_id: AgentId = "competitor"

    async def run(self, request: AgentRequest) -> AgentResult:
        # Next: retrieve baseline -> research peers -> bounded tool loop ->
        # validate citations/scope -> persist AgentResult. Analysis ends here;
        # it must never invoke the council coordinator automatically.
        raise AgentNotReadyError(
            "Competitor agent is scaffolded; evidence retrieval and Qwen execution are not connected."
        )
