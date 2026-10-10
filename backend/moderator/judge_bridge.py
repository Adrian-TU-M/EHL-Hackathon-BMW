"""Apply the teammate Judge's complete rubric to a frozen moderator packet."""
from __future__ import annotations
import json
from types import SimpleNamespace

from backend.council.judge import assess_request, assessment_text
from backend.judge.models import JudgeRequest

from .adapters import Reply
from .models import JudgeAssessment, JudgeProposal, ScoringInput
from .sources import applicable


def judge_request(data) -> JudgeRequest:
    packet = data["packet"]
    brief = packet["brief"]
    feature_id = brief["topic_id"]
    inventory = {s["id"]: s for s in data.get("source_inventory", [])}
    evidence = []
    source_constraints = []
    for record in data.get("evidence", []):
        source = inventory.get(record["source_id"], {})
        domain = record["domain"] if record["domain"] in {"customer", "market", "competitor"} else "market"
        scoped = SimpleNamespace(**{key: record.get(key) for key in ("excluded_reason", "vehicle", "powertrain", "country", "region")})
        exclusion = record.get("excluded_reason")
        if not applicable(scoped, SimpleNamespace(**brief["scope"]), True):
            exclusion = exclusion or "This source is outside the frozen vehicle, market or powertrain scope."
        evidence.append({
            "id": record["id"], "domain": domain,
            "source": source.get("name", record["source_id"]), "location": record["location"],
            "published_at": record.get("published_at") or source.get("edition") or "Publication date not supplied",
            "passage": record["passage"][:20000],
            "provenance": {"supplied": "provided", "external": "external", "synthetic": "synthetic"}.get(source.get("provenance"), "provided"),
            "source_url": source.get("source_url"), "observation_id": record.get("observation_id"),
            "exclusion_reason": exclusion, "quantitative": record.get("quantitative"),
        })
        source_constraints.append("Preserve source scope and limitations: " + json.dumps({
            "evidence_id": record["id"], **{key: record.get(key) for key in
                ("vehicle", "region", "country", "powertrain", "period", "kind", "context_type", "limitations", "equipment_verified")},
            "source_coverage": source.get("coverage", {}), "source_limitations": source.get("limitations", []),
        }, ensure_ascii=False))
    claims = packet.get("claims", [])
    assumptions = {a["id"]: a["statement"] for a in packet.get("assumptions", [])}
    eligible = {item["id"] for item in evidence if not item["exclusion_reason"]}
    arguments = [{
        "id": claim["id"], "agent": claim["actor"], "feature_ids": [feature_id],
        "statement": claim["statement"],
        # Validation status cannot disappear at the Judge boundary. Rejected and
        # unverified claims remain visible for critique, but receive no support
        # citations that a later model could use to promote them back into facts.
        "evidence_ids": [eid for eid in claim.get("evidence_ids", []) if eid in eligible]
            if claim.get("validation") == "supported" else [],
        "assumptions": [assumptions[i] for i in claim.get("assumption_ids", []) if i in assumptions] +
            (["Moderator validation is " + claim.get("validation", "unverified") + "; do not assign factual support. " +
              " ".join(claim.get("issues", []))] if claim.get("validation") != "supported" else []),
        "challenges": [c["question"] + (" Response: " + c["response"] if c.get("response") else "")
                       for c in packet.get("challenges", []) if c["target_claim_id"] == claim["id"]],
    } for claim in claims]
    scope = {k: v for k, v in brief["scope"].items() if k != "confirmedAt"}
    proposal_descriptions = [a["title"] + ": " + a["description"] + " Trade-off: " + a["tradeoff"] for a in packet.get("alternatives", [])]
    description = brief["question"] + ("\nAlternatives raised:\n" + "\n".join(proposal_descriptions) if proposal_descriptions else "")
    return JudgeRequest.model_validate({
        "scope": scope, "background": brief["objective"],
        "features": [{"id": feature_id, "version": packet["version"], "title": brief["question"],
                      "description": description, "topic": brief["question"]}],
        "arguments": arguments, "evidence": evidence,
        "constraints": list(dict.fromkeys([*packet.get("coverage_limitations", []), *packet.get("unresolved_issues", []), *source_constraints])),
        "clarification_used": packet.get("clarification") is not None,
        "pm_message": "\n".join(packet.get("pm_challenges", [])) or None,
    })


async def assess_packet(data, settings):
    request = judge_request(data)
    usage = {}
    assessment = await assess_request(request, settings, usage=usage,
                                      validation_error=data.get("validation_error"))
    claims = {c["id"]: c for c in data["packet"].get("claims", [])}
    if any((a.support or 0) > 0 and claims[a.argument_id].get("validation") != "supported"
           for a in assessment.arguments):
        raise ValueError("Judge cannot restore factual credit to an unsupported or unverified moderator claim")
    credited = {a.argument_id: a for a in assessment.arguments if (a.support or 0) > 0
                and claims[a.argument_id].get("validation") == "supported"}
    evidence_ids = list(dict.fromkeys(c.evidence_id for a in credited.values() for c in a.citations))
    inputs = []
    for feature in assessment.features:
        for criterion, rating in feature.criteria.items():
            supported = [aid for aid in rating.argument_ids if aid in credited]
            if rating.value is None or not supported:
                inputs.append(ScoringInput(kind="unknown", label=criterion, rationale=rating.rationale))
            else:
                dependencies = list(dict.fromkeys(aid for cid in supported for aid in claims[cid].get("assumption_ids", [])))
                refs = list(dict.fromkeys(eid for cid in supported for eid in claims[cid].get("evidence_ids", [])))
                inputs.append(ScoringInput(kind="inferred", label=criterion, value=rating.value,
                    rationale=rating.rationale + " Judge rubric rating, not a probability.",
                    evidence_ids=refs, claim_ids=supported, assumption_ids=dependencies))
    proposals = [JudgeProposal(id=f.feature_id, version=f.feature_version,
        title=request.features[index].title,
        description=f.proposed_description or request.features[index].description,
        evidence_ids=evidence_ids,
        claim_ids=list(credited),
        assumption_ids=list(dict.fromkeys(aid for cid in credited for aid in claims[cid].get("assumption_ids", []))),
    ) for index, f in enumerate(assessment.features) if credited]
    mapped = JudgeAssessment(
        summary=assessment_text(assessment),
        unresolved_issues=list(dict.fromkeys([*assessment.clarification_requests,
            *(item for f in assessment.features for item in f.uncertainties)])),
        evidence_ids=evidence_ids, scoring_inputs=inputs, proposals=proposals,
        native_assessment=assessment.model_dump(mode="json"),
        native_request=request.model_dump(mode="json"),
    )
    # The full validated assessment is preserved for PM review and ElevenLabs.
    # Clarification requests remain explicit unresolved issues rather than inventing
    # an actor/citation target the judge service did not supply.
    return Reply(mapped.model_dump(), usage.get("input_tokens", 0) + usage.get("output_tokens", 0))
