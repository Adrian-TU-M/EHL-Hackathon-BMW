"""Translate the teammates' real debate handlers into the Moderator protocol.

This module does not generate substitute specialist answers. It invokes the native
CustomerAgent, MarketParticipant and Competitor council handler, then translates
IDs/contracts. Original outputs and implementation names travel in the audit.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import hashlib

from backend.agents.market import MarketParticipant
from backend.council.participants import GroundedParticipant
from backend.customer_agent.runtime import get_agent
from backend.customer_agent.schemas import PerspectiveRequest, Scope as CustomerScope
from backend.llm.usage import measured_usage
from backend.runtime import inference_lock
from backend.schemas.agent import AgentPosition as NativePosition, Claim as NativeClaim, Challenge as NativeChallenge
from backend.schemas.council import CouncilTurn
from backend.schemas.evidence import EvidenceRecord
from .adapters import Reply
from .models import AgentPosition, Claim, Challenge, ChallengeResponse, Rebuttal, RebuttalItem, ClarificationResponse

IMPLEMENTATIONS = {
    "customer": "backend.customer_agent.agent.CustomerAgent.perspective",
    "market": "backend.agents.market.MarketParticipant.turn",
    "competitor": "backend.council.participants.GroundedParticipant.turn[competitor]",
}


def prior_turns(data):
    turns = []
    for p in data.get("positions", []):
        turns.append(CouncilTurn(agent_id=p["actor"], stage="perspectives", position=NativePosition(
            agent_id=p["actor"], stance="revise", rationale=p["summary"] or "No completed opening.",
            claims=[NativeClaim(id=c["id"], text=c["statement"], kind="fact" if c.get("evidence_ids") else "inference", evidence_ids=c.get("evidence_ids", [])) for c in p.get("claims", [])],
        )))
    for c in data.get("challenges", []):
        turns.append(CouncilTurn(agent_id=c["actor"], stage="challenge", position=NativePosition(
            agent_id=c["actor"], stance="revise", rationale=c["question"], claims=[]),
            challenges=[NativeChallenge(target_agent_id=c["target_actor"], target_claim_id=c["target_claim_id"], question=c["question"], evidence_ids=c.get("evidence_ids", []))]))
    return turns


def source_record(e, inventory):
    source = inventory.get(e.source_id)
    kind = ("customer_feedback" if e.kind == "feedback" else "customer_study" if e.kind.startswith("study_")
            else "planning_volume" if e.kind == "provided_forecast" else "competitor_official" if e.domain == "competitor"
            else "industry_signal" if e.kind == "external_context" else "market_metric")
    return EvidenceRecord(id=e.id, source_type=kind, source_title=source.name if source else e.source_id,
        source_uri=(source.source_url or source.name) if source else e.source_id, locator=e.location or e.id,
        passage=e.passage, retrieved_at=datetime.fromisoformat(source.retrieved_at) if source and source.retrieved_at else datetime(1970, 1, 1, tzinfo=timezone.utc),
        brand=source.publisher or "BMW" if source else "BMW", model=e.vehicle or (source.coverage.get("model") if source else None) or "Industry context",
        market=e.region or "Global", country=e.country, powertrain=e.powertrain, caveats=e.limitations)


def customer_citation(citation, scope, evidence):
    if not citation.startswith("STUDY:"):
        key = f"{scope['vehicle']}_feedback:{citation}"
    else:
        _, sheet, row, vehicle = citation.split(":")
        if sheet == "CN_EU_2025":
            column = {("China", "G68"): 2, ("China", "G70"): 3, ("Europe", "F70"): 4, ("Europe", "G60"): 5, ("Europe", "G70"): 6}.get((scope["market"], vehicle))
            key = f"studies:mean:{column}:{row}"
        elif sheet == "US_2025":
            key = f"studies:us:{ {'G60': 3, 'G70': 4}.get(vehicle)}:{row}"
        else:
            raise ValueError("Unknown native Customer study sheet")
    if key not in evidence:
        raise ValueError(f"Native Customer citation is outside the frozen scope: {citation}")
    return key


class NativeSpecialists:
    def __init__(self, settings, resolve):
        self.settings, self.resolve = settings, resolve
        self.checked = set()

    async def customer(self, operation, data, evidence, inventory):
        agent = await asyncio.to_thread(get_agent, self.settings)
        # Native retrieval must see the exact files that produced this session,
        # never silently read newer data after the PM froze the source snapshot.
        for sid in (f"{data['brief']['scope']['vehicle']}_feedback", "studies"):
            source = inventory.get(sid)
            if source is None:
                continue
            path = self.settings.data_dir / source.name
            if not path.is_file(): path = self.settings.data_dir / "BMW-Data" / source.name
            stat = path.stat(); key = (str(path), stat.st_mtime_ns, stat.st_size, source.sha256)
            if key not in self.checked:
                actual = await asyncio.to_thread(lambda: hashlib.sha256(path.read_bytes()).hexdigest())
                if actual != source.sha256:
                    raise ValueError("Customer data changed after this council froze its evidence; create a new council.")
                self.checked.add(key)
        scope = data["brief"]["scope"]
        history = [{"actor": p["actor"], "statement": p["summary"][:2000]} for p in data.get("positions", [])]
        foreign = [p for p in data.get("positions", []) if p["actor"] != "customer" and p.get("claims")]
        target = foreign[-1] if foreign else None
        if operation == "challenge" and target:
            history.append({"actor": target["actor"], "statement": target["summary"][:2000]})
        if operation == "rebuttal":
            history.extend({"actor": c["actor"], "statement": c["question"][:2000]} for c in data.get("challenges", []))
        request = PerspectiveRequest(scope=CustomerScope.model_validate(scope), topic="",
            stage={"perspective": "perspectives", "challenge": "discussion", "rebuttal": "challenge", "clarification": "revision"}[operation],
            question=data["brief"]["question"], context=history[-20:],
            challenge="\n".join(f"{c['actor']}: {c['question']}" for c in data.get("challenges", [])) if operation == "rebuttal" else data.get("question", {}).get("question", ""))
        async with inference_lock:
            event = await asyncio.to_thread(agent.perspective, request)
        citations = list(dict.fromkeys(customer_citation(c, scope, evidence) for c in event.evidenceIds))
        # Resolve every citation, and verify native feedback text against the frozen excerpt.
        for quote in event.evidence:
            eid = customer_citation(quote.id, scope, evidence)
            # The teammate's ingestion collapses whitespace (including NBSP).
            # Compare with the same normalization; do not alter any wording.
            if " ".join(quote.passage.split()) != " ".join(evidence[eid].passage.split()):
                raise ValueError("Native Customer quote differs from the frozen source")
        rationale = " ".join(x for x in (event.statement, event.recommendation, event.assumption) if x)
        return rationale, citations, event.model_dump(), target, event

    async def call(self, actor, operation, data):
        catalog, allowed = self.resolve(data["evidence_access"])
        inventory = {s.id: s for s in catalog.sources}
        evidence = {e.id: e for e in allowed}
        implementation = IMPLEMENTATIONS[actor]
        with measured_usage() as calls:
            if actor == "customer":
                rationale, ids, raw, target, event = await self.customer(operation, data, evidence, inventory)
                uncertainties = event.uncertainties + ([event.assumption] if event.assumption else [])
                question = event.counterQuestion
                target_claim = next((c["id"] for c in target["claims"] if c["id"].endswith("native-position")), target["claims"][0]["id"]) if target else None
                target_actor = target["actor"] if target else None
                answered = {c["target_claim_id"] for c in data.get("challenges", [])}
            else:
                # Use the original branch's council handler and grounding review.
                selected = [evidence[e["id"]] for e in data.get("evidence", []) if e["id"] in evidence and e["domain"] == actor]
                sources = [source_record(e, inventory) for e in selected]
                if not sources:
                    reason = "No frozen own-domain evidence resolves this question."
                    if operation == "perspective":
                        empty = AgentPosition(actor=actor, summary=reason, abstention_reason=reason, implementation=implementation)
                    elif operation == "challenge":
                        empty = ChallengeResponse(abstention_reason=reason)
                    elif operation == "clarification":
                        empty = ClarificationResponse(actor=actor, statement=reason, evidence_ids=[], implementation=implementation)
                    else:
                        empty = Rebuttal(actor=actor, responses=[RebuttalItem(challenge_id=c["id"], status="unresolved", statement=reason) for c in data.get("challenges", [])], implementation=implementation)
                    return Reply(empty.model_dump(), 0)
                participant = MarketParticipant(self.settings) if actor == "market" else GroundedParticipant("competitor", self.settings)
                stage = {"perspective": "perspectives", "challenge": "challenge", "rebuttal": "revision", "clarification": "perspectives"}[operation]
                context = {"scope": data["brief"]["scope"], "question": data.get("question", {}).get("question") or data["brief"]["question"], "moderator_framing": data["brief"]["objective"], "limitations": data["brief"]["limitations"]}
                result = await participant.turn(stage, context, sources, prior_turns(data))
                rationale = result.position.rationale
                ids = list(dict.fromkeys(e for c in result.position.claims for e in c.evidence_ids))
                if any(i not in evidence for i in ids): raise ValueError("Native specialist cited a source outside its frozen scope")
                raw = result.model_dump(mode="json")
                uncertainties = []
                challenge = result.challenges[0] if result.challenges else None
                question = challenge.question if challenge else ""
                target_actor = challenge.target_agent_id if challenge else None
                target_claim = challenge.target_claim_id if challenge else None
                answered = set(result.answered_claim_ids)
            metadata = {"implementation": implementation, "native_output": raw}
            if operation == "perspective":
                # Literal evidence is kept distinct from the native specialist's interpretation.
                from .local import source_facts
                facts = {i: source_facts(actor, {"brief": data["brief"], "evidence": [evidence[i].model_dump()]})[i] for i in ids}
                for index, fact in enumerate(facts.values()): fact["id"] = f"native-source-{index + 1}"
                claims = [Claim.model_validate(facts[i]) for i in ids[:6]]
                if ids:
                    claims.append(Claim(id="native-position", actor=actor, statement=rationale, kind="inference", evidence_ids=ids))
                output = AgentPosition(actor=actor, summary=rationale, claims=claims, uncertainties=uncertainties,
                    abstention_reason=None if ids else rationale, **metadata)
            elif operation == "challenge":
                output = ChallengeResponse(challenge=Challenge(id="native-challenge", actor=actor, target_actor=target_actor,
                    target_claim_id=target_claim, kind="interpretation", question=question,
                    consequence="Clarify the evidence and trade-off before the Judge assesses this proposal.", evidence_ids=ids, **metadata)
                    if question and target_actor and target_claim else None,
                    abstention_reason=None if question and target_claim else "The native agent raised no further counter-question.")
            elif operation == "rebuttal":
                output = Rebuttal(actor=actor, responses=[RebuttalItem(challenge_id=c["id"], status="unresolved",
                    statement=rationale, evidence_ids=ids) for c in data.get("challenges", []) if c["target_claim_id"] in answered], **metadata)
            else:
                output = ClarificationResponse(actor=actor, statement=rationale, evidence_ids=ids,
                    claim_ids=data.get("question", {}).get("claim_ids", []), **metadata)
            return Reply(output.model_dump(), sum(calls))
