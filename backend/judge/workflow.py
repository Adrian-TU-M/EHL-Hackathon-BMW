"""Checkpoint wrapper for a teammate-owned moderator, not specialist agent logic.

In-memory single-process repository for local integration. Replace at the team
backend boundary with transactional durable storage before shared deployment.
"""
import asyncio
from copy import deepcopy
from time import monotonic
from uuid import uuid4
from .adapters import ModeratorAdapter
from .models import (
    CouncilCreate, CouncilView, CouncilEvent, ReviewCheckpoint, PMMessage,
    CouncilControl, DecisionInput, ConfirmPriorities,
)
from .service import JudgeService, timestamp

STAGES = ("topic", "perspectives", "challenge", "assessment", "revision", "proposal", "review")


class Conflict(Exception):
    pass


class CouncilRepository:
    def __init__(self):
        self.views: dict[str, CouncilView] = {}
        self.locks: dict[str, asyncio.Lock] = {}
        self.receipts: dict[tuple[str, str], tuple[str, CouncilView]] = {}
        self.audit: dict[str, list[dict]] = {}

    def get(self, cid: str) -> CouncilView:
        if cid not in self.views:
            raise KeyError(cid)
        return deepcopy(self.views[cid])

    def save(self, view: CouncilView, action: str, rationale: str):
        self.views[view.id] = deepcopy(view)
        self.audit.setdefault(view.id, []).append({
            "timestamp": timestamp(), "action": action, "rationale": rationale,
            "revision": view.revision, "round": view.round,
            "assessment_id": view.assessment.id if view.assessment else None,
            "snapshot": view.model_dump(mode="json"),
        })


class CouncilService:
    def __init__(self, judge: JudgeService, moderator: ModeratorAdapter, repository: CouncilRepository):
        self.judge, self.moderator, self.repository = judge, moderator, repository
        self.active: dict[str, asyncio.Task] = {}

    def event(self, view, actor, statement, evidence_ids=None):
        sequence = len(view.events) + 1
        view.events.append(CouncilEvent(
            id=f"{view.id}:{sequence}", sequence=sequence, stage=view.stage,
            actor=actor, statement=statement, evidence_ids=evidence_ids or [], timestamp=timestamp(),
        ))

    async def perform(self, view):
        if view.stage == "assessment":
            view.assessment = await self.judge.assess(view.request)
            self.event(view, "judge", "Judge assessment available: " + view.assessment.next_action)
        elif view.stage == "revision":
            if not view.assessment or view.assessment.next_action != "request_clarification":
                return
            view.request.clarification_used = True
            original_message = view.request.pm_message
            view.request.pm_message = "\n".join(view.assessment.clarification_requests)
            await self.moderate(view)
            view.request.pm_message = original_message
            view.assessment = await self.judge.assess(view.request)
            self.event(view, "judge", "Clarification assessed: " + view.assessment.next_action)
        elif view.stage in ("topic", "perspectives", "challenge"):
            await self.moderate(view)
        elif view.stage == "proposal":
            self.event(view, "judge", "Provisional feature recommendations ready; PM approval is required.")
        else:
            self.event(view, "moderator", "Final PM review. No feature has been approved automatically.")

    async def moderate(self, view):
        response = await self.moderator.respond(view.stage, view.request)
        if view.stage == "perspectives" and {a.agent for a in response.statements} != {"customer", "market", "competitor"}:
            raise ValueError("Moderator must return all three specialist perspectives")
        if view.stage == "revision" and len(response.statements) > 1:
            raise ValueError("Clarification allows only one targeted specialist response")
        existing = {a.id for a in view.request.arguments}
        if any(a.id in existing for a in response.statements):
            raise ValueError("Moderator reused an argument ID")
        evidence = {e.id: e for e in view.request.evidence}
        for item in response.evidence:
            if item.id in evidence and evidence[item.id] != item:
                raise ValueError("Moderator cannot change an existing evidence passage or exclusion")
            evidence[item.id] = item
        view.request.evidence = list(evidence.values())
        if response.features:
            original = {f.id: f for f in view.request.features}
            for feature in response.features:
                if feature.id not in original or feature != original[feature.id]:
                    raise ValueError("Moderator must keep the submitted feature snapshot; propose edits through the Judge")
        view.request.arguments.extend(response.statements)
        # Revalidate cross-references after external moderator output.
        view.request = type(view.request).model_validate(view.request.model_dump())
        for argument in response.statements:
            self.event(view, argument.agent, argument.statement, argument.evidence_ids)
        self.event(view, "moderator", response.summary)

    async def advance(self, view, initial=False):
        task = asyncio.current_task()
        self.active[view.id] = task
        start = monotonic()
        try:
            await self._advance(view, initial)
        except asyncio.CancelledError as exc:
            raise Conflict("Council processing was interrupted; refresh the checkpoint") from exc
        finally:
            view.processing_seconds += monotonic() - start
            if self.active.get(view.id) is task:
                self.active.pop(view.id, None)

    async def _advance(self, view, initial=False):
        start = monotonic()
        while True:
            if not initial:
                index = STAGES.index(view.stage) + 1
                if index >= len(STAGES):
                    view.status = "complete"
                    view.checkpoint = None
                    return
                view.stage = STAGES[index]
            initial = False
            if view.stage == "revision" and (not view.assessment or view.assessment.next_action != "request_clarification"):
                continue
            remaining = 120 - view.processing_seconds - (monotonic() - start)
            if remaining <= 0:
                raise TimeoutError("Round duration exceeded")
            await asyncio.wait_for(self.perform(view), timeout=remaining)
            if view.stage in ("assessment", "revision") and view.assessment and view.assessment.next_action == "pause_for_pm":
                view.status = "paused"
                view.checkpoint = ReviewCheckpoint(stage=view.stage, reason="Consequential uncertainty remains; PM review required.")
                return
            if view.stage == "review":
                view.status = "complete"
                view.checkpoint = ReviewCheckpoint(stage="review", reason="Final version-specific PM decision required.")
                return
            # Skip unused optional clarification; do not create a meaningless gate.
            if view.stage == "assessment" and view.assessment.next_action != "request_clarification" and view.mode == "auto":
                view.stage = "revision"
            if view.mode == "manual":
                view.status = "paused"
                view.checkpoint = ReviewCheckpoint(stage=view.stage, reason="Review this stage and continue explicitly.")
                return

    async def create(self, analysis_id: str, body: CouncilCreate):
        cid = str(uuid4())
        view = CouncilView(
            id=cid, analysis_id=analysis_id, mode=body.mode, status="running", stage="topic",
            revision=1, round=1, checkpoint=None, request=body.request,
            assessment=None, events=[], execution=self.judge.ai.execution,
        )
        await self.advance(view, initial=True)
        self.repository.locks[cid] = asyncio.Lock()
        self.repository.save(view, "Council created", f"{body.mode} mode")
        return view

    async def control(self, cid: str, body: CouncilControl):
        current = self.repository.get(cid)
        if body.expected_revision != current.revision:
            raise Conflict("Stale council revision; refresh before continuing")
        # Cancel processing before waiting on its lock. Its uncommitted snapshot
        # is discarded, so resume cannot duplicate partially emitted stages.
        if body.action in ("pause", "interrupt") and (task := self.active.get(cid)):
            task.cancel()
        async with self.repository.locks[cid]:
            view = self.repository.get(cid)
            if view.revision != body.expected_revision:
                raise Conflict("Stale council revision; refresh before continuing")
            if view.status == "complete":
                raise Conflict("Council completed; submit a PM message for a new round")
            if body.action in ("pause", "interrupt"):
                view.status = "paused" if body.action == "pause" else "interrupted"
            else:
                if view.status not in ("paused", "interrupted"):
                    raise Conflict("Council is not waiting for continuation")
                self.event(view, "PM", body.rationale)
                view.checkpoint = None
                view.status = "running"
                await self.advance(view)
            view.revision += 1
            self.repository.save(view, body.action, body.rationale)
            return view

    async def message(self, cid: str, body: PMMessage):
        self.repository.get(cid)
        async with self.repository.locks[cid]:
            key = (cid, "message:" + body.id)
            fingerprint = body.model_dump_json(exclude={"expected_revision"})
            if key in self.repository.receipts:
                previous, view = self.repository.receipts[key]
                if previous != fingerprint:
                    raise Conflict("Message ID reused with a different payload")
                return deepcopy(view)
            view = self.repository.get(cid)
            if body.expected_revision != view.revision:
                raise Conflict("Stale council revision")
            if view.status not in ("complete", "paused", "interrupted"):
                raise Conflict("Wait for the current round before submitting a message")
            self.event(view, "PM", body.content)
            view.request.pm_message = body.content
            view.request.clarification_used = False
            view.round += 1
            view.processing_seconds = 0
            view.stage = "perspectives"
            view.status = "running"
            view.checkpoint = None
            await self.advance(view, initial=True)
            view.revision += 1
            self.repository.save(view, "PM follow-up round", body.content)
            self.repository.receipts[key] = (fingerprint, deepcopy(view))
            return view

    async def confirm_priorities(self, cid: str, body: ConfirmPriorities):
        self.repository.get(cid)
        async with self.repository.locks[cid]:
            view = self.repository.get(cid)
            if body.expected_revision != view.revision or not view.assessment or view.assessment.id != body.assessment_id:
                raise Conflict("Priority proposal is stale")
            proposal = view.assessment.proposed_priorities
            if not proposal:
                raise Conflict("No proposed priorities to confirm")
            view.request.weights = proposal.weights
            view.request.constraints = proposal.constraints
            # Priority changes never rewrite factual argument support. Recalculate
            # scores deterministically using the already validated assessment.
            from .scoring import score
            from .service import digest
            assessment = view.assessment.model_copy(deep=True)
            assessment.id = str(uuid4())
            assessment.created_at = timestamp()
            assessment.weights = view.request.weights
            assessment.constraints = view.request.constraints
            assessment.input_digest = digest(view.request)
            assessment.proposed_priorities = None
            for feature in assessment.features:
                feature.priority, feature.coverage = score({k: c.value for k, c in feature.criteria.items()}, view.request.weights)
            assessment.ranked_feature_ids = [f.feature_id for f in sorted(assessment.features,
                key=lambda f: (-(f.priority if f.priority is not None else -1), f.feature_id))]
            view.assessment = assessment
            self.event(view, "PM", "Confirmed priorities: " + body.rationale)
            view.revision += 1
            self.repository.save(view, "Priorities confirmed", body.rationale)
            return view

    async def decide(self, cid: str, body: DecisionInput):
        self.repository.get(cid)
        async with self.repository.locks[cid]:
            key = (cid, "decision:" + body.id)
            fingerprint = body.model_dump_json()
            if key in self.repository.receipts:
                previous, result = self.repository.receipts[key]
                if previous != fingerprint:
                    raise Conflict("Decision ID reused with a different payload")
                return deepcopy(result)
            view = self.repository.get(cid)
            if view.status != "complete" or not view.assessment or view.assessment.id != body.assessment_id:
                raise Conflict("Complete the council and review its latest assessment first")
            feature = next((f for f in view.request.features if f.id == body.feature_id), None)
            if not feature or feature.version != body.expected_version:
                raise Conflict("Feature version is stale")
            if body.action == "edit":
                if not body.description or not body.description.strip():
                    raise ValueError("Feature edit needs a non-empty description")
                feature.description = body.description.strip()
                feature.version += 1
                view.round += 1
                view.processing_seconds = 0
                view.request.clarification_used = False
                view.assessment = None
                view.status = "paused"
                view.stage = "challenge"
                view.checkpoint = ReviewCheckpoint(stage="challenge", reason="Edited feature requires a fresh Judge assessment.")
            view.decisions.append({
                "feature_id": feature.id, "version": feature.version,
                "action": body.action, "rationale": body.rationale,
                "assessment_id": body.assessment_id, "timestamp": timestamp(),
            })
            self.event(view, "PM", f"{body.action} {feature.id} v{feature.version}: {body.rationale}")
            view.revision += 1
            self.repository.save(view, "Feature " + body.action, body.rationale)
            self.repository.receipts[key] = (fingerprint, deepcopy(view))
            return view
