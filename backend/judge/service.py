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
        self._assessment_lock = asyncio.Lock()

    async def assess(self, request: JudgeRequest) -> JudgeAssessment:
        # Standalone Judge endpoints share one provider. Keep its repair prompt
        # and usage counters isolated when two PM requests arrive together.
        async with self._assessment_lock:
            return await self._assess_bounded(request)

    async def _assess_bounded(self, request: JudgeRequest) -> JudgeAssessment:
        if hasattr(self.ai, "last_usage"):
            # One assessment may include a repair; both calls consume the same
            # moderator budget, while a subsequent assessment starts afresh.
            self.ai.last_usage = {"input_tokens": 0, "output_tokens": 0}
        try:
            return await self._assess(request)
        except ValueError as exc:
            if not hasattr(self.ai, "validation_error"):
                raise
            self.ai.validation_error = str(exc)[:700]
            try:
                return await self._assess(request)
            finally:
                self.ai.validation_error = ""

    async def _assess(self, request: JudgeRequest) -> JudgeAssessment:
        draft = await asyncio.wait_for(self.ai.evaluate(request), timeout=getattr(self.ai, "call_timeout_seconds", 65))
        args = {a.id: a for a in request.arguments}
        evidence = {e.id: e for e in request.evidence}
        features = {f.id: f for f in request.features}
        if len(draft.arguments) != len(args) or {a.argument_id for a in draft.arguments} != set(args):
            raise ValueError("Model must assess every argument exactly once")
        if len(draft.features) != len(features) or {f.feature_id for f in draft.features} != set(features):
            raise ValueError("Model must assess every feature exactly once")
        assessed = {a.argument_id: a for a in draft.arguments}
        ungrounded = set()
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
                # An uncited perspective may be a useful hypothesis. Its lack of
                # factual support is an assessment outcome, not a service error.
                # Fabricated quotations still fail the strict checks above.
                result.support = None
                result.verdict = "unknown"
                result.issues.append("No validated passage citation; factual support remains unknown.")
                ungrounded.add(result.argument_id)
            if result.verdict in ("unsupported", "contradicted"):
                result.support = 0
            elif result.verdict == "unknown":
                result.support = None
                ungrounded.add(result.argument_id)
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
                    if set(criterion.argument_ids) & ungrounded:
                        criterion.value = None
                        criterion.rationale = "Unknown: the proposed supporting argument has no validated citation. " + criterion.rationale
                        result.consequential_uncertainty = True
                        result.uncertainties.append("A proposed criterion rating was left unknown because its supporting argument had no validated citation.")
                    else:
                        raise ValueError("Known criterion requires a supported argument")
            feasibility = result.criteria["feasibility"]
            if feasibility.value is not None:
                engineering_sources = [evidence[c.evidence_id] for aid in feasibility.argument_ids
                    if (assessed[aid].support or 0) > 0
                    for c in assessed[aid].citations if "feasibility" in evidence[c.evidence_id].supports_criteria]
                if not engineering_sources:
                    feasibility.value = None
                    feasibility.rationale = "Unknown: the attached evidence does not establish engineering effort, cost or implementation feasibility."
                    result.uncertainties.append("Engineering feasibility requires a technical assessment; market signals and customer feedback cannot establish it.")
                    result.consequential_uncertainty = True
            relevant = [evidence[c.evidence_id] for a in draft.arguments
                        if feature.id in args[a.argument_id].feature_ids and (a.support or 0) > 0
                        for c in a.citations]
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
