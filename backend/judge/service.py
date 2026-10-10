import asyncio
import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4
from .adapters import AIAdapter
from .models import JudgeAssessment, JudgeRequest
from .scoring import CRITERIA, influence, score


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(request: JudgeRequest) -> str:
    return hashlib.sha256(json.dumps(request.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()


class JudgeService:
    def __init__(self, ai: AIAdapter):
        self.ai = ai

    async def assess(self, request: JudgeRequest) -> JudgeAssessment:
        draft = await asyncio.wait_for(self.ai.evaluate(request), timeout=getattr(self.ai, "call_timeout_seconds", 65))
        args = {a.id: a for a in request.arguments}
        evidence = {e.id: e for e in request.evidence}
        features = {f.id: f for f in request.features}
        if len(draft.arguments) != len(args) or {a.argument_id for a in draft.arguments} != set(args):
            raise ValueError("Model must assess every argument exactly once")
        if len(draft.features) != len(features) or {f.feature_id for f in draft.features} != set(features):
            raise ValueError("Model must assess every feature exactly once")
        assessed = {a.argument_id: a for a in draft.arguments}
        for result in draft.arguments:
            original = args[result.argument_id]
            active = []
            for citation in result.citations:
                source = evidence.get(citation.evidence_id)
                if not source or source.id not in original.evidence_ids:
                    raise ValueError("Citation must reference evidence attached to its argument")
                if source.exclusion_reason or citation.quote not in source.passage:
                    raise ValueError("Citation passage is invalid or excluded")
                active.append(source)
            missing = [eid for eid in original.evidence_ids if eid not in evidence]
            result.issues.extend(f"Missing evidence: {eid}" for eid in missing)
            if result.support and not active:
                raise ValueError("Positive support requires a validated passage citation")
            if result.verdict in ("unsupported", "contradicted"):
                result.support = 0
            if active and all(e.provenance == "synthetic" for e in active):
                result.support = min(result.support, 1) if result.support is not None else None
            result.influence = influence(result.support, result.relevance)
            # Shared observations remain explicit, never extra independent votes.
            for other in request.arguments:
                if other.id == original.id:
                    continue
                source_keys = {evidence[e].observation_id or
                               f"{evidence[e].source}:{evidence[e].location}:{evidence[e].passage}"
                               for e in original.evidence_ids if e in evidence}
                other_keys = {evidence[e].observation_id or
                              f"{evidence[e].source}:{evidence[e].location}:{evidence[e].passage}"
                              for e in other.evidence_ids if e in evidence}
                if original.statement.casefold() == other.statement.casefold() or source_keys & other_keys:
                    result.issues.append(f"Shared/repeated support with {other.id}; not independent corroboration")
        for result in draft.features:
            feature = features[result.feature_id]
            if result.feature_version != feature.version or set(result.criteria) != set(CRITERIA):
                raise ValueError("Feature version or criterion keys do not match")
            for criterion in result.criteria.values():
                for aid in criterion.argument_ids:
                    if aid not in args or feature.id not in args[aid].feature_ids:
                        raise ValueError("Criterion arguments must belong to this feature")
                if criterion.value is not None and not any(
                    assessed[aid].support is not None and assessed[aid].support > 0
                    for aid in criterion.argument_ids
                ):
                    raise ValueError("Known criterion requires a supported argument")
            relevant = [evidence[c.evidence_id] for a in draft.arguments
                        if feature.id in args[a.argument_id].feature_ids for c in a.citations]
            if not relevant:
                result.evidence_strength = "Unknown"
            elif all(e.provenance == "synthetic" for e in relevant):
                result.evidence_strength = "Illustrative"
            if result.evidence_strength in ("Unknown", "Illustrative"):
                result.consequential_uncertainty = True
            if result.consequential_uncertainty and result.recommendation == "recommend":
                result.recommendation = "defer"
                result.uncertainties.append("Recommendation deferred pending consequential evidence validation.")
            result.priority, result.coverage = score({k: c.value for k, c in result.criteria.items()}, request.weights)
        consequential = any(f.consequential_uncertainty for f in draft.features)
        action = "continue"
        if consequential:
            action = "pause_for_pm" if request.clarification_used else "request_clarification"
            if not draft.clarification_requests:
                draft.clarification_requests = ["Resolve the consequential uncertainties identified in the feature assessments."]
        draft.clarification_requests = draft.clarification_requests[:1]
        return JudgeAssessment(
            **draft.model_dump(), id=str(uuid4()), created_at=timestamp(),
            weights=request.weights, constraints=request.constraints,
            ranked_feature_ids=[f.feature_id for f in sorted(draft.features,
                key=lambda f: (-(f.priority if f.priority is not None else -1), f.feature_id))],
            next_action=action, execution=self.ai.execution, input_digest=digest(request),
            model=getattr(self.ai, "model", None), provider=getattr(self.ai, "provider", None),
        )
