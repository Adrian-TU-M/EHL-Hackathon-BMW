"""Adapter for the teammate's Customer Agent, preserving its evidence and debate logic."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from backend.config import Settings
from backend.customer_agent.config import load_settings
from backend.customer_agent.runtime import get_agent
from backend.customer_agent.schemas import PerspectiveRequest, Scope as CustomerScope
from backend.customer_agent.stats import study_refs
from backend.schemas.agent import AgentPosition, Challenge, Claim
from backend.schemas.council import CouncilTurn
from backend.schemas.evidence import EvidenceRecord


def resolve_customer_evidence(event, agent, scope: CustomerScope, data_dir: Path) -> list[EvidenceRecord]:
    """Resolve citations from the native dataset, including study-only citations.

    Filesystem timestamps give stable snapshots: opening another debate does not
    rewrite evidence freshness, and modified data gets a different timestamp.
    """
    evidence = []
    for quote in event.evidence:
        if quote.id not in event.evidenceIds:
            continue
        filename = quote.source.split(" · ", 1)[0]
        path = data_dir / filename
        stamp = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) if path.is_file() else datetime(1970, 1, 1, tzinfo=timezone.utc)
        evidence.append(EvidenceRecord(
            id=quote.id, source_type="customer_feedback", source_title=quote.source,
            source_uri=filename, locator=quote.location, passage=quote.passage,
            retrieved_at=stamp, brand="BMW", model=quote.vehicle, market=quote.market,
            feedback_id=quote.id, country=quote.country or None,
            powertrain=quote.powertrain or None, categories=[quote.theme, quote.type],
            caveats=["Self-selected feedback; one record is not necessarily one customer.",
                     "The feedback source does not supply a reporting date or representative sample."],
        ))
    refs = {r.id: r for r in study_refs(agent.data, agent.maps, scope, None)}
    for citation in event.evidenceIds:
        ref = refs.get(citation)
        if ref is None:
            continue
        filename = ref.source.split(" / ", 1)[0]
        path = data_dir / filename
        stamp = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) if path.is_file() else datetime(1970, 1, 1, tzinfo=timezone.utc)
        peers = "; ".join(f"{model}: {value}" for model, value in ref.comparison.items())
        passage = (f"{ref.vehicle}, {ref.market}, {ref.quantitative.period}: {ref.attribute}. "
                   f"{ref.quantitative.unit}: {ref.value}."
                   + (f" Same-study model values: {peers}." if peers else ""))
        evidence.append(EvidenceRecord(
            id=ref.id, source_type="customer_study", source_title=ref.source,
            source_uri=filename, locator=ref.quantitative.sourceId,
            passage=passage, retrieved_at=stamp, brand="BMW", model=ref.vehicle,
            market=ref.market, categories=[ref.attribute], content_kind="curated_summary",
            caveats=[ref.quantitative.limitations,
                     "A study snapshot is not a demand trend or a feature-attributable sales measurement."],
        ))
    return evidence


class CustomerParticipant:
    def __init__(self, settings: Settings, agent=None):
        self.settings = settings
        self.agent = agent
        self.evidence: list[EvidenceRecord] = []

    async def turn(self, stage, context, sources, prior):
        agent = self.agent or await asyncio.to_thread(get_agent, self.settings)
        scope = CustomerScope.model_validate({k: v for k, v in context["scope"].items() if k != "topic"})
        lead = context.get("lead_agent", "market")
        targets = [t for t in prior if t.agent_id == lead and t.position.claims]
        target = targets[-1] if targets else next((t for t in reversed(prior) if t.agent_id != "customer" and t.position.claims), None)
        incoming = [c for t in prior for c in t.challenges if c.target_agent_id == "customer"]
        history = [{"actor": t.agent_id, "statement": t.position.rationale[:2000]} for t in prior]
        # The native agent answers the latest other speaker. Put the selected
        # target last so its generated question refers to the actual claim.
        if stage == "challenge" and target:
            history.append({"actor": target.agent_id, "statement": target.position.rationale[:2000]})
        proposal = " ".join(r.get("proposed_change", "") for r in context.get("recommendations", []))
        question = (f"{context.get('question', '')} Proposed investigation: {proposal}. "
                    f"Moderator framing: {context.get('moderator_framing', '')}")[:2000]
        request = PerspectiveRequest(
            scope=scope, topic="", stage="discussion" if stage == "challenge" else stage,
            question=question,
            challenge=" ".join(c.question for c in incoming)[:2000] if stage == "revision" else "",
            context=history[-20:],
        )
        from backend.runtime import inference_lock
        async with inference_lock:
            event = await asyncio.to_thread(agent.perspective, request)
        self.evidence = resolve_customer_evidence(event, agent, scope, load_settings(self.settings).data_dir)
        known = {r.id for r in sources}
        sources.extend(r for r in self.evidence if r.id not in known)
        claims = [Claim(id=f"customer-{stage}-{i+1}", text=("One customer reported: " if record.source_type == "customer_feedback" else "") + record.passage,
                        kind="fact", evidence_ids=[record.id]) for i, record in enumerate(self.evidence[:3])]
        if not claims:
            claims = [Claim(id=f"customer-{stage}-1", text="Customer evidence is insufficient to substantiate this proposal.", kind="inference")]
        stance = {"agree": "support", "partly_agree": "revise", "disagree": "oppose", "outside_evidence": "insufficient_evidence", "none": "revise"}[event.stance]
        if not self.evidence:
            stance = "insufficient_evidence"
        rationale = " ".join(x for x in [event.statement, event.recommendation, event.evidenceBase, event.assumption] if x)
        challenges = []
        if stage == "challenge" and target:
            challenges = [Challenge(target_agent_id=target.agent_id, target_claim_id=target.position.claims[0].id,
                                    question=event.counterQuestion or "What validation would establish that this proposal addresses the documented customer needs?",
                                    evidence_ids=[r.id for r in self.evidence[:3]])]
        answered = list(dict.fromkeys(c.target_claim_id for c in incoming)) if stage == "revision" else []
        return CouncilTurn(agent_id="customer", stage=stage,
                           position=AgentPosition(agent_id="customer", claims=claims, stance=stance, rationale=rationale),
                           challenges=challenges, answered_claim_ids=answered)
