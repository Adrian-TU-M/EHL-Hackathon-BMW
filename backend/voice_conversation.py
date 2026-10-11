"""Context for the original ElevenLabs agent, bound to a saved local assessment."""
import os
from pydantic import BaseModel, ConfigDict, Field


class ConversationMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assessment_id: str
    id: str = Field(min_length=1, max_length=160)
    actor: str = Field(pattern=r"^(PM|judge)$")
    text: str = Field(min_length=1, max_length=10000)


def configuration(assessment, packet, messages, status="Pending PM review", *, tool_supported=False):
    tool_bridge = tool_supported and os.getenv("ELEVENLABS_JURY_TOOL_ENABLED", "0") == "1"
    return {
        "assessment_id": assessment.id,
        "agent_id": os.getenv("ELEVENLABS_AGENT_ID", ""),
        "bridge": "ask_jury" if tool_bridge else "saved_verdict_context",
        "context": {
            "vehicle": packet.scope.vehicle, "market": packet.scope.market, "powertrain": packet.scope.powertrain,
            "assessment_id": assessment.id,
            "features": [f.model_dump(mode="json") for f in assessment.features],
            "requirements": [{"id": f.id, "title": f.title, "description": f.description} for f in packet.features],
            "clarification_requests": assessment.clarification_requests, "pm_decision": status,
            "instruction": ("For every substantive PM question call ask_jury with the exact question. Read the local Qwen Judge's answer faithfully. " if tool_bridge else "Explain only this actual saved local Qwen assessment. You are its voice discussion interface, not a new scoring or approval agent. ") + "Preserve uncertainties, objections and proposed-versus-approved status. Discussion never changes a decision. Do not invent evidence or claim a new debate happened. If more evidence or reassessment is required, say so. Do not add numerical success predictions. No raw source files are sent to this voice session.",
        },
        "messages": messages,
    }
