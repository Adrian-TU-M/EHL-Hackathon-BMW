from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import time
from collections import defaultdict
from contextlib import contextmanager
from datetime import UTC, datetime

from pydantic import ValidationError
from backend.judge.adapters import Unavailable as JudgeUnavailable

from .agenda import brief, prepare, rank, refine
from .external import extend_catalog
from .models import (
    ROLES,
    AgendaRefinement,
    AgentPosition,
    AssumptionChange,
    ChallengeResponse,
    Claim,
    ClarificationResponse,
    ConfirmAgenda,
    Control,
    Decision,
    DiscussionEvent,
    JudgeAssessment,
    JudgePacket,
    Limits,
    Rebuttal,
    ReviewInput,
    Scope,
    SemanticReview,
    Session,
    TopicOutcome,
    Work,
    now,
    uid,
)
from .sources import applicable, role_evidence
from .validation import semantic_result, validate_claim


class Conflict(ValueError):
    pass


class Budget(ValueError):
    pass


async def batch(*calls):
    tasks = [asyncio.create_task(c) for c in calls]
    try:
        return await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


class Engine:
    def __init__(self, catalog, store, adapters):
        self.catalog, self.store, self.adapters = catalog, store, adapters
        self.controller_url = os.getenv("MODERATOR_CONTROLLER_URL", "").rstrip("/")
        self.evidence = {e.id: e for e in catalog.evidence} if catalog else {}
        self.tasks = {}
        self.locks = defaultdict(asyncio.Lock)
        self.sessions = {s.id: s for s in store.sessions()}
        self.capabilities = {}
        self.deadlines = {}
        self.pending = {}
        if hasattr(adapters, "bind_native"):
            adapters.bind_native(self.resolve_native)
        saved = store.catalogs()
        self.catalogs = {c.snapshot_hash: c for c in saved}
        if catalog:
            self.catalogs[catalog.snapshot_hash] = catalog
            store.save_catalog(catalog)
        # Carry external intake forward onto the current supplied extraction,
        # preserving every historical catalog for already-confirmed sessions.
        latest_external = next(
            (
                c
                for c in reversed(saved)
                if any(x.provenance == "external" for x in c.sources)
            ),
            None,
        )
        if latest_external:
            if not catalog:
                self.catalog = latest_external
            else:
                for source in latest_external.sources:
                    # Reviewed specialist catalogs are rebuilt from their current
                    # source indexes; never resurrect expired records at restart.
                    if source.provenance == "external" and not source.id.startswith("specialist-source:"):
                        self.catalog = extend_catalog(
                            self.catalog,
                            source,
                            [
                                e
                                for e in latest_external.evidence
                                if e.source_id == source.id
                            ],
                        )
                self.catalogs[self.catalog.snapshot_hash] = self.catalog
                store.save_catalog(self.catalog)
        self.evidence = {e.id: e for c in self.catalogs.values() for e in c.evidence}
        for s in self.sessions.values():
            existing_events = self.store.events(s.id)
            event_sequence = existing_events[-1].sequence if existing_events else 0
            if event_sequence > s.sequence:
                s.sequence = event_sequence
                s.status = "paused"
                s.generation += 1
                self.emit(s, "recovery", "System", "Recovered an older snapshot behind the event log after concurrent backend access. Session paused; existing events retained.")
            if s.status == "running":
                if s.work and s.work.stage_started_at:
                    elapsed = min(
                        s.limits.topic_seconds,
                        max(
                            0,
                            (
                                datetime.now(UTC)
                                - datetime.fromisoformat(s.work.stage_started_at)
                            ).total_seconds(),
                        ),
                    )
                    s.work.active_seconds += elapsed
                    s.active_seconds += elapsed
                    s.work.stage_started_at = None
                s.status = "paused"
                s.generation += 1
                self.emit(
                    s,
                    "recovery",
                    "System",
                    "Server restarted. Recoverable session paused; in-flight reservations remain charged.",
                )

    def install_catalog(self, catalog):
        self.store.save_catalog(catalog)
        self.catalogs[catalog.snapshot_hash] = catalog
        self.evidence.update({e.id: e for e in catalog.evidence})
        self.catalog = catalog

    def index(self, s):
        return {e.id: e for e in self.snapshot(s).evidence}

    def get(self, sid):
        if sid not in self.sessions:
            raise KeyError(sid)
        return self.sessions[sid]

    @contextmanager
    def atomic(self, s):
        if s.id in self.pending:
            yield
            return
        before = s.model_copy(deep=True)
        self.pending[s.id] = {"events": [], "command": None}
        try:
            yield
            pending = self.pending[s.id]
            self.store.save(s, pending["events"], command=pending["command"])
        except BaseException:
            s.__dict__.update(before.__dict__)
            raise
        finally:
            self.pending.pop(s.id, None)

    def snapshot(self, s):
        catalog = self.catalogs.get(s.agenda.source_snapshot)
        if not catalog:
            raise Conflict("Frozen source snapshot unavailable")
        return catalog

    def emit(
        self, s, stage, actor, statement, evidence_ids=None, data=None, command=None
    ):
        if s.id not in self.pending:
            with self.atomic(s):
                return self.emit(
                    s, stage, actor, statement, evidence_ids, data, command
                )
        s.sequence += 1
        event = DiscussionEvent(
            id=f"{s.id}:{s.sequence}",
            session_id=s.id,
            run_id=s.run_id,
            topic_id=s.work.brief.topic_id if s.work else None,
            sequence=s.sequence,
            stage=stage,
            actor=actor,
            statement=statement,
            evidence_ids=evidence_ids or [],
            assumption_versions={a.id: a.version for a in s.assumptions},
            data=data or {},
        )
        self.pending[s.id]["events"].append(event)
        if command:
            self.pending[s.id]["command"] = command
        return event

    def check_snapshot(self, s):
        if s.agenda.source_snapshot not in self.catalogs:
            raise Conflict(
                "Frozen source snapshot unavailable. Restore that catalog or create a linked new session."
            )

    async def create(self, scope: Scope, parent=None, limits: Limits | None = None, *, refine_agenda=True):
        if not self.catalog:
            raise Conflict(
                "Supplied source collection unavailable; run ingestion first"
            )
        if parent:
            self.get(parent)
        agenda = prepare(self.catalog, scope)
        # Agenda refinement is bounded separately from topic budgets and never changes ratings.
        if refine_agenda and not self.adapters.missing():
            data = {
                "scope": scope.model_dump(),
                "candidates": [
                    {
                        "id": t.id,
                        "label": t.label,
                        "question": t.question,
                        "area": t.area,
                    }
                    for t in agenda.topics
                ],
            }
            schema = AgendaRefinement.model_json_schema()
            reservation = (
                len(json.dumps({"data": data, "schema": schema}).encode()) + 2500
            )
            data["token_allowance"] = reservation
            agenda_usage = reservation
            try:
                reply = await asyncio.wait_for(
                    self.adapters.call(
                        "moderator",
                        "agenda",
                        data,
                        schema,
                        2000,
                        agenda.id,
                    ),
                    240 if self.adapters.mode == "ollama" else 45,
                )
                agenda_usage = reply.tokens
                if reply.tokens > reservation:
                    raise Budget("Agenda service exceeded its allowance")
                agenda = refine(agenda, AgendaRefinement.model_validate(reply.data))
            except (Exception,):
                agenda.semantic_refinement = (
                    "unavailable_or_invalid; deterministic candidates retained"
                )
        else:
            agenda_usage = 0
        s = Session(
            agenda=agenda,
            mode=self.adapters.mode,
            participant_runtime="native" if getattr(self.adapters, "native_implementations", False) else "legacy",
            parent_session_id=parent,
            limits=limits or Limits(),
            tokens=agenda_usage,
            availability=self.adapters.missing(),
        )
        self.sessions[s.id] = s
        self.emit(
            s,
            "agenda",
            "moderator",
            "Proposed agenda prepared from the frozen source collection. Review selection and order before confirming.",
            data={"agenda_id": agenda.id},
        )
        return s

    async def confirm(self, sid, request: ConfirmAgenda):
        async with self.locks[sid]:
            s = self.get(sid)
            if (
                s.status != "awaiting_confirmation"
                or s.agenda.version != request.expected_version
            ):
                raise Conflict("Agenda is already confirmed or its version changed")
            valid = {t.id for t in s.agenda.topics if t.eligible}
            selected = request.selected_ids
            if (
                len(set(selected)) != len(selected)
                or not set(selected).issubset(valid)
                or not set(request.pinned_ids).issubset(selected)
            ):
                raise ValueError("Choose unique eligible topics; pins must be selected")
            substantiated = []
            for review in request.severity_substantiations:
                topic = next(
                    (
                        t
                        for t in s.agenda.topics
                        if t.id == review.topic_id and t.id in selected
                    ),
                    None,
                )
                if not topic or not set(review.evidence_ids).issubset(
                    topic.evidence_ids
                ):
                    raise ValueError(
                        "Severe-issue substantiation requires selected, scoped topic evidence"
                    )
                substantiated.append((topic, review))
            with self.atomic(s):
                for t in s.agenda.topics:
                    t.pinned = t.id in request.pinned_ids
                for topic, review in substantiated:
                    topic.severe = True
                    topic.rationale += f" PM-substantiated reported consequence: {review.rationale}; sources {', '.join(review.evidence_ids)}."
                s.agenda.selected_ids = [
                    t.id for t in rank([t for t in s.agenda.topics if t.id in selected])
                ]
                s.agenda.confirmed_at = now()
                s.agenda.version += 1
                s.revision += 1
                s.status = "ready"
                self.emit(
                    s,
                    "confirmation",
                    "PM",
                    "Agenda and source snapshot confirmed; subsequent topics advance automatically.",
                    data={"selected_ids": s.agenda.selected_ids},
                )
            return s

    async def cancel(self, sid):
        task = self.tasks.pop(sid, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    def launch(self, s):
        self.tasks[s.id] = asyncio.create_task(self.run(s, s.generation))

    async def control(self, sid, c: Control):
        async with self.locks[sid]:
            previous = self.store.command(sid, c.idempotency_key)
            if previous:
                if previous != c.model_dump():
                    raise Conflict("Idempotency key reused for a different command")
                return self.get(sid)
            s = self.get(sid)
            if c.expected_revision != s.revision:
                raise Conflict("Session changed; refresh before applying this control")
            if c.expected_topic_id and (
                not s.work or s.work.brief.topic_id != c.expected_topic_id
            ):
                raise Conflict(
                    "Active topic changed; refresh before applying this control"
                )
            if s.status in {"complete", "awaiting_confirmation"}:
                raise Conflict(
                    "Confirm the agenda first, or create a linked run after completion"
                )
            if (
                c.action in {"challenge", "skip", "finish", "reorder"}
                and not c.rationale.strip()
            ):
                raise ValueError("This override needs a rationale")
            if c.action == "challenge" and not s.work:
                raise Conflict("Start a topic before challenging it")
            if c.action == "reorder":
                offset = s.cursor + (1 if s.work else 0)
                remaining = s.agenda.selected_ids[offset:]
                if len(c.topic_ids) != len(set(c.topic_ids)) or set(c.topic_ids) != set(
                    remaining
                ):
                    raise ValueError(
                        "Reorder must contain exactly the unstarted topics"
                    )
            if c.action not in {"start", "resume"}:
                await self.cancel(sid)
            with self.atomic(s):
                if s.status in {"complete", "awaiting_confirmation"}:
                    raise Conflict(
                        "Confirm the agenda first, or create a new linked run after completion"
                    )
                if (
                    c.action in {"challenge", "skip", "finish", "reorder"}
                    and not c.rationale.strip()
                ):
                    raise ValueError("This override needs a rationale")
                if c.action in {"start", "resume"}:
                    self.check_snapshot(s)
                    if s.status not in {
                        "ready",
                        "paused",
                        "interrupted",
                        "unavailable",
                    }:
                        raise Conflict("Session is already running")
                    if s.work and s.work.blocked_preference:
                        raise Conflict(
                            "Scope/preference change requires a newly confirmed linked agenda"
                        )
                    s.availability = self.adapters.missing()
                    if s.mode != self.adapters.mode:
                        s.availability.append(
                            "Adapter mode changed; create a linked run"
                        )
                    if s.availability:
                        s.status = "unavailable"
                    else:
                        s.status = "running"
                else:
                    if c.action == "challenge" and not s.work:
                        raise Conflict("Start a topic before challenging it")
                    if c.action == "reorder":
                        offset = s.cursor + (1 if s.work else 0)
                        remaining = s.agenda.selected_ids[offset:]
                        if len(c.topic_ids) != len(set(c.topic_ids)) or set(
                            c.topic_ids
                        ) != set(remaining):
                            raise ValueError(
                                "Reorder must contain exactly the remaining, unstarted topics"
                            )
                    # Cancellation completes before any superseding mutation; late output is discarded.
                    if c.action == "pause":
                        s.status = "paused"
                    elif c.action == "interrupt":
                        s.status = "interrupted"
                    elif c.action == "challenge":
                        if not s.work:
                            raise Conflict("Start a topic before challenging it")
                        s.work.pm_challenges.append(c.rationale.strip())
                        # Reassess only after completed debate; no extra challenge/clarification round.
                        if s.work.stage == "close":
                            s.work.stage = "assessment"
                        s.status = "paused"
                    elif c.action == "reorder":
                        offset = s.cursor + (1 if s.work else 0)
                        remaining = s.agenda.selected_ids[offset:]
                        if len(c.topic_ids) != len(set(c.topic_ids)) or set(
                            c.topic_ids
                        ) != set(remaining):
                            raise ValueError(
                                "Reorder must contain exactly the remaining, unstarted topics"
                            )
                        s.agenda.selected_ids = (
                            s.agenda.selected_ids[:offset] + c.topic_ids
                        )
                        s.status = "paused"
                    elif c.action in {"skip", "finish"}:
                        if not s.work and s.cursor < len(s.agenda.selected_ids):
                            s.work = Work(
                                brief=brief(
                                    s.agenda,
                                    s.agenda.selected_ids[s.cursor],
                                    self.snapshot(s),
                                )
                            )
                        if s.work:
                            self.close_topic(s, "pm_stopped")
                        s.status = (
                            "complete"
                            if c.action == "finish"
                            or s.cursor >= len(s.agenda.selected_ids)
                            else "running"
                        )
                s.generation += 1
                s.revision += 1
                self.emit(
                    s,
                    "control",
                    "PM",
                    f"{c.action}: {c.rationale or 'PM workflow control'}",
                    data={"action": c.action},
                    command=(c.idempotency_key, c.model_dump()),
                )
            if s.status == "running":
                self.launch(s)
            return s

    def allowed(self, s, actor):
        topic = next(t for t in s.agenda.topics if t.id == s.work.brief.topic_id)
        if s.participant_runtime == "native" and actor == "customer":
            # Native Customer retrieval computes full-scope statistics before
            # choosing theme quotes. It still sees only the frozen Customer data.
            return [e for e in self.snapshot(s).evidence if e.domain == "customer" and applicable(e, s.agenda.scope, True)]
        if actor in ROLES:
            return role_evidence(
                self.snapshot(s), s.agenda.scope, actor, topic.evidence_ids
            )
        cited = {i for c in s.work.claims for i in c.evidence_ids} if s.participant_runtime == "native" else set()
        return [
            e
            for e in self.snapshot(s).evidence
            if e.id in set(topic.evidence_ids) | cited and applicable(e, s.agenda.scope, True)
        ]

    def resolve_native(self, token):
        """In-process equivalent of the Moderator's scoped retrieval capability."""
        key = token.rsplit("/", 1)[-1]
        self.retrieve(key, [])  # Check generation/stage; stale native calls cannot retrieve.
        sid, _, actor, _, _ = self.capabilities[key].split(":")
        session = self.get(sid)
        return self.snapshot(session), self.allowed(session, actor)

    def access(self, s, actor):
        key = f"{s.id}:{s.generation}:{actor}:{s.work.brief.topic_id}:{s.work.stage}"
        existing = next((k for k, v in self.capabilities.items() if v == key), None)
        token = existing or uid("access") + uid("")
        self.capabilities[token] = key
        return f"{self.controller_url}/api/moderator/retrieval/{token}"

    def retrieve(self, token, ids=None, offset=0):
        value = self.capabilities.get(token)
        if not value:
            raise KeyError("Expired or invalid evidence capability")
        sid, generation, actor, topic, stage = value.split(":")
        s = self.get(sid)
        if (
            s.generation != int(generation)
            or not s.work
            or s.work.brief.topic_id != topic
            or s.work.stage != stage
        ):
            raise Conflict("Retrieval capability belongs to a superseded stage")
        ev = self.allowed(s, actor)
        if ids is not None:
            by_id = {e.id: e for e in ev}
            if len(ids) > 100 or any(i not in by_id for i in ids):
                raise ValueError(
                    "Evidence IDs exceed this actor's authorized domain/scope"
                )
            return [by_id[i].model_dump() for i in ids]
        return {
            "total": len(ev),
            "offset": offset,
            "evidence": [
                {
                    "id": e.id,
                    "source_id": e.source_id,
                    "location": e.location,
                    "kind": e.kind,
                }
                for e in ev[offset : offset + 100]
            ],
        }

    def payload(self, s, actor, **kwargs):
        ev = self.allowed(s, actor)
        # Excerpts are a starting window; all eligible evidence remains retrievable.
        own_domain = [e for e in ev if e.domain == actor]
        if self.adapters.mode == "ollama":
            from .local import evidence_relevance
            own_domain.sort(key=lambda e: -evidence_relevance(e.model_dump(), s.work.brief.model_dump()))
        if actor in {"market", "competitor"}:
            # Feature announcements must not disappear behind the same baseline
            # sales rows that every topic includes.
            own_domain.sort(key=lambda e: not e.id.startswith("specialist:"))
        selected = own_domain[:4]
        # Raw equipment matrices are available in the frozen source explorer but
        # cannot establish trim fitment. Avoid feeding their undecoded columns as
        # apparent facts into a short local specialist opening.
        if self.adapters.mode != "ollama" or actor not in ROLES:
            selected += [e for e in ev if e.domain != actor][:2]
        positive = [e for e in own_domain if "Likes" in e.feedback_types]
        # Preserve clear positive observations ahead of mixed long comments,
        # whose overall Likes tag may refer to an unrelated part of the car.
        positive.sort(key=lambda e: bool(set(e.feedback_types) & {"Defect", "Difficult to Use", "Wants"}))
        selected += positive[:2]
        selected += [e for e in ev if not e.classifications and e.kind == "feedback"][
            :1
        ]
        selected += [
            e
            for e in ev
            if e.kind in {"study_mean", "study_distribution", "provided_forecast"}
        ][:2]
        if s.participant_runtime == "native":
            # Native Customer retrieval may select another authorized quote.
            # Review that exact citation rather than the initial excerpt window.
            cited = {i for c in s.work.claims for i in c.evidence_ids}
            cited.update(i for c in s.work.challenges for i in c.response_evidence_ids)
            selected += [e for e in ev if e.id in cited]
        seen, excerpts = set(), []
        for e in selected:
            if e.id in seen:
                continue
            seen.add(e.id)
            item = e.model_dump()
            start = 0
            if self.adapters.mode == "ollama" and len(e.passage) > 1600:
                from .local import source_excerpt
                excerpt = source_excerpt(item, s.work.brief.model_dump())
                start = max(0, e.passage.find(excerpt) - 240)
            item["passage"] = e.passage[start:start + 1600]
            item["excerpt_truncated"] = len(e.passage) > 1600
            excerpts.append(item)
        return {
            "participant_runtime": s.participant_runtime,
            "brief": s.work.brief.model_dump(),
            "evidence": excerpts,
            "available_evidence_count": len(ev),
            "evidence_access": self.access(s, actor),
            "assumptions": [a.model_dump() for a in s.assumptions],
            **kwargs,
        }

    async def call(
        self, s, actor, operation, payload, model, generation, assessment=False
    ):
        w = s.work
        context = hashlib.sha256(
            json.dumps(
                {
                    "assumptions": [(a.id, a.version) for a in s.assumptions],
                    "pm_challenges": w.pm_challenges,
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()[:12]
        slot = f"{w.stage}:{actor}:{operation}:{context}"
        while w.attempts.get(slot, 0) < 2:
            if s.generation != generation or s.status != "running":
                raise asyncio.CancelledError
            if (
                w.active_seconds >= s.limits.topic_seconds
                or s.active_seconds >= s.limits.session_seconds
            ):
                raise Budget("Active time exhausted")
            cap = (
                s.limits.topic_tokens
                if assessment
                else math.floor(s.limits.topic_tokens * (1 - s.limits.reserve_fraction))
            )
            schema = model.model_json_schema()
            output_allowance = 10000 if assessment and self.adapters.mode == "ollama" else 1500
            # UTF-8 byte reservation bounds common byte-tokenized input conservatively.
            # Unreturned/late calls keep the reservation; successful calls charge reported usage.
            reserve = (
                len(
                    json.dumps(
                        {"data": payload, "schema": schema}, ensure_ascii=False
                    ).encode()
                )
                + output_allowance + 2000
            )
            if s.participant_runtime == "native" and actor in ROLES and operation != "semantic_check":
                # Native handlers include retrieval, synthesis and citation review.
                # Charge their actual Ollama usage, with a bounded reservation.
                reserve = max(reserve, 48000)
            if w.tokens + reserve > cap or s.tokens + reserve > s.limits.session_tokens:
                raise Budget("Token reservation exhausted")
            w.attempts[slot] = w.attempts.get(slot, 0) + 1
            attempt = w.attempts[slot]
            w.tokens += reserve
            s.tokens += reserve
            self.store.save(s)
            try:
                remaining = (
                    self.deadlines.get(s.id, time.monotonic() + s.limits.call_seconds)
                    - time.monotonic()
                )
                if remaining <= 0:
                    raise Budget("Active time exhausted")
                timeout = min(max(s.limits.call_seconds, 900) if assessment and self.adapters.mode == "ollama" else s.limits.call_seconds, remaining)
                reply = await asyncio.wait_for(
                    self.adapters.call(
                        actor,
                        operation,
                        {**payload, "token_allowance": reserve},
                        schema,
                        output_allowance,
                        f"{s.run_id}:{w.brief.topic_id}:{slot}:{attempt}",
                    ),
                    timeout,
                )
                if s.generation != generation:
                    raise asyncio.CancelledError
                if reply.tokens > reserve:
                    w.tokens += reply.tokens - reserve
                    s.tokens += reply.tokens - reserve
                    raise Budget("Service reported usage above its reservation")
                w.tokens -= reserve - reply.tokens
                s.tokens -= reserve - reply.tokens
                result = model.model_validate(reply.data)
                return result
            except (ValidationError, ValueError) as error:
                if isinstance(error, Budget):
                    raise
                detail = (json.dumps(error.errors(include_input=False, include_url=False), default=str)
                          if isinstance(error, ValidationError) else str(error))
                logging.getLogger("uvicorn.error").warning(
                    "Moderator %s/%s validation attempt %s: %s", actor, operation, attempt, detail[:800]
                )
                if attempt == 2:
                    w.errors.append(
                        f"{actor}/{operation}: invalid structured output after one repair"
                    )
                    return None
                payload = {
                    **payload,
                    "repair": "Previous output failed the provided schema. Return a corrected object; no new evidence or stage.",
                    "validation_error": str(error)[:1200],
                }
            except JudgeUnavailable as error:
                # This exception is already sanitized by the Judge provider;
                # retain its actionable timeout/connection/authentication message.
                # Arbitrary provider exceptions remain redacted below.
                w.errors.append(f"{actor}/{operation}: {str(error)[:600]}")
                return None
            except (TimeoutError, RuntimeError, OSError) as error:
                w.errors.append(
                    f"{actor}/{operation}: {type(error).__name__}; no completed response"
                )
                return None
            except asyncio.CancelledError:
                raise
            except Exception as error:
                w.errors.append(
                    f"{actor}/{operation}: service unavailable ({type(error).__name__})"
                )
                return None
            finally:
                # Parallel calls share one wall-clock stage timer in run(), not a sum.
                self.store.save(s)
        w.errors.append(
            f"{actor}/{operation}: attempt limit reached after interruption/restart"
        )
        return None

    def valid_assessment(self, s, assessment, allowed):
        claims = {c.id: c for c in s.work.claims}
        assumptions = {a.id for a in s.assumptions}
        if not set(assessment.evidence_ids).issubset(allowed):
            return False
        for item in [*assessment.scoring_inputs, *assessment.proposals]:
            if (
                not set(item.evidence_ids).issubset(allowed)
                or not set(item.claim_ids).issubset(claims)
                or not set(item.assumption_ids).issubset(assumptions)
            ):
                return False
            kind = getattr(item, "kind", "inferred")
            if kind == "sourced" and not item.evidence_ids:
                return False
            if kind == "inferred" and not (item.evidence_ids or item.claim_ids):
                return False
            if kind == "assumed" and not item.assumption_ids:
                return False
            if kind in {"sourced", "inferred"} and any(
                claims[i].validation != "supported" for i in item.claim_ids
            ):
                return False
            if kind == "sourced" and any(
                claims[i].kind in {"hypothesis", "preference", "unknown"}
                or claims[i].assumption_ids
                for i in item.claim_ids
            ):
                return False
            required_assumptions = {
                aid for i in item.claim_ids for aid in claims[i].assumption_ids
            }
            if not required_assumptions.issubset(item.assumption_ids):
                return False
        return True

    def packet(self, s, reason=None):
        w = s.work
        ev = self.allowed(s, "judge")
        unresolved = [
            c.question for c in w.challenges if c.status != "resolved"
        ] + w.errors
        unresolved += [
            f"{c.id}: {c.validation}; {'; '.join(c.issues)}"
            for c in w.claims
            if c.consequential and c.validation != "supported"
        ]
        if w.assessment:
            unresolved += w.assessment.unresolved_issues
        return JudgePacket(
            id=f"{s.run_id}:{w.brief.topic_id}",
            brief=w.brief,
            source_snapshot=s.agenda.source_snapshot,
            source_inventory=self.snapshot(s).sources,
            evidence_index=[
                {
                    "id": e.id,
                    "source_id": e.source_id,
                    "location": e.location,
                    "kind": e.kind,
                    "vehicle": e.vehicle,
                    "region": e.region,
                    "country": e.country,
                    "powertrain": e.powertrain,
                    "period": e.period,
                    "limitations": e.limitations,
                }
                for e in ev
            ],
            positions=w.positions,
            claims=w.claims,
            challenges=w.challenges,
            alternatives=w.alternatives,
            assumptions=s.assumptions,
            unresolved_issues=list(dict.fromkeys(unresolved)),
            coverage_limitations=w.brief.limitations,
            transcript=[
                e
                for e in (
                    self.store.events(s.id)
                    + self.pending.get(s.id, {}).get("events", [])
                )
                if e.topic_id == w.brief.topic_id
            ],
            clarification=w.clarification,
            closure_reason=reason,
            pm_challenges=w.pm_challenges,
            counterevidence_ids=sorted(
                set(
                    next(
                        t for t in s.agenda.topics if t.id == w.brief.topic_id
                    ).counterevidence_ids
                    + [i for p in w.positions for i in p.counterevidence_ids]
                )
            ),
            usage={"model_tokens": w.tokens, "active_seconds": w.active_seconds},
        )

    def close_topic(self, s, reason=None):
        with self.atomic(s):
            w = s.work
            for c in w.challenges:
                if c.status == "open":
                    c.status = "unresolved"
                    c.response = "No completed rebuttal; incomplete evidence record."
            if reason is None:
                if w.budget_exhausted:
                    reason = "budget_exhausted"
                elif (
                    w.errors
                    or not w.assessment
                    or not w.alternatives
                    or any(
                        c.consequential and c.validation != "supported"
                        for c in w.claims
                    )
                    or not w.claims
                ):
                    reason = "insufficient_evidence"
                elif (
                    any(c.status != "resolved" for c in w.challenges)
                    or w.assessment.unresolved_issues
                ):
                    reason = "unresolved_disagreement"
                else:
                    reason = "completed"
            self.emit(
                s,
                "closure",
                "moderator",
                f"Topic closed: {reason}. Queued for version-specific human review; no automatic approval.",
                data={"closure_reason": reason},
            )
            packet = self.packet(s, reason).model_copy(deep=True)
            s.outcomes.append(
                TopicOutcome(
                    topic_id=w.brief.topic_id,
                    closure_reason=reason,
                    packet=packet,
                    assessment=w.assessment,
                )
            )
            s.cursor += 1
            s.work = None

    def accept_position(self, s, role, position):
        w = s.work
        if (
            not position
            or position.actor != role
            or (not position.claims and not position.abstention_reason)
        ):
            position = AgentPosition(
                actor=role,
                summary="No valid opening position was returned.",
                abstention_reason="Unavailable, timed out, or invalid output; not consensus.",
            )
            w.errors.append(f"Missing valid {role} opening")
        # IDs are namespaced per role/topic so foreign references cannot collide.
        prefix = f"{w.brief.topic_id}:{role}:"
        ids = {c.id: prefix + c.id for c in position.claims}
        aids = {a.id: prefix + a.id for a in position.assumptions}
        alternatives = {a.id: prefix + a.id for a in position.alternatives}
        if len(ids) != len(position.claims) or len(aids) != len(position.assumptions):
            w.errors.append(f"Duplicate {role} claim/assumption IDs")
            position.claims, position.assumptions = [], []
            position.abstention_reason = "Duplicate output IDs rejected"
        allowed_ids = {e.id for e in self.allowed(s, role)}
        for a in position.assumptions:
            if (
                a.author != role
                or a.scope != s.agenda.scope
                or any(
                    i not in allowed_ids
                    for i in a.evidence_ids + a.opposing_evidence_ids
                )
            ):
                w.errors.append(f"Invalid {role} assumption {a.id}")
                continue
            a.id = aids[a.id]
            a.affected_claim_ids = [ids.get(i, i) for i in a.affected_claim_ids]
            a.affected_alternative_ids = [
                alternatives.get(i, i) for i in a.affected_alternative_ids
            ]
            s.assumptions.append(a)
            self.emit(
                s,
                "assumption",
                role,
                a.statement,
                a.evidence_ids,
                {"assumption": a.model_dump()},
            )
        for c in position.claims:
            c.id = ids[c.id]
            c.assumption_ids = [aids.get(i, i) for i in c.assumption_ids]
            # A hypothesis cannot turn an unsupported factual assertion into sourced truth.
            if c.kind == "hypothesis":
                c.issues.append("Hypothesis is conditional, not a validated fact")
            validate_claim(
                c,
                self.index(s),
                s.agenda.scope,
                allowed_ids,
                {a.id for a in s.assumptions},
            )
            if self.adapters.mode == "ollama" and c.validation == "unverified":
                from .local import is_exact_source_claim
                if is_exact_source_claim(c, self.index(s), w.brief.model_dump()):
                    c.validation = "supported"
                    c.semantic_check = "exact_source_quote"
        for a in position.alternatives:
            a.id = prefix + a.id
            a.assumption_ids = [aids.get(i, i) for i in a.assumption_ids]
            if not set(a.assumption_ids).issubset({x.id for x in s.assumptions}):
                w.errors.append(f"Alternative {a.id} references an unknown assumption")
        if any(i not in allowed_ids for i in position.counterevidence_ids):
            position.counterevidence_ids = [
                i for i in position.counterevidence_ids if i in allowed_ids
            ]
            w.errors.append(f"Unauthorized counterevidence rejected from {role}")
        w.positions.append(position)
        w.claims.extend(position.claims)
        w.alternatives.extend(position.alternatives)
        self.emit(
            s,
            "perspectives",
            role,
            position.summary,
            [i for c in position.claims for i in c.evidence_ids],
            {"position": position.model_dump()},
        )

    async def run(self, s, generation):
        stage_start = None
        try:
            while s.status == "running" and s.generation == generation:
                if (
                    s.cursor >= len(s.agenda.selected_ids)
                    or s.tokens >= s.limits.session_tokens
                    or s.active_seconds >= s.limits.session_seconds
                ):
                    with self.atomic(s):
                        if s.work:
                            self.close_topic(s, "budget_exhausted")
                        s.status = "complete"
                        self.emit(
                            s,
                            "session_closed",
                            "moderator",
                            "Session ended: agenda exhausted or session budget exhausted.",
                            data={"remaining_ids": s.agenda.selected_ids[s.cursor :]},
                        )
                    return
                if not s.work:
                    with self.atomic(s):
                        s.work = Work(
                            brief=brief(
                                s.agenda,
                                s.agenda.selected_ids[s.cursor],
                                self.snapshot(s),
                            )
                        )
                        self.emit(
                            s,
                            "topic",
                            "moderator",
                            s.work.brief.question,
                            data={"brief": s.work.brief.model_dump()},
                        )
                w = s.work
                if w.active_seconds >= s.limits.topic_seconds:
                    self.close_topic(s, "budget_exhausted")
                    continue
                stage_start = time.monotonic()
                w.stage_started_at = now()
                self.deadlines[s.id] = stage_start + min(
                    s.limits.topic_seconds - w.active_seconds,
                    s.limits.session_seconds - s.active_seconds,
                )
                self.store.save(s)
                if w.stage == "perspectives":
                    positions = await batch(
                        *(
                            self.call(
                                s,
                                r,
                                "perspective",
                                self.payload(s, r),
                                AgentPosition,
                                generation,
                            )
                            for r in ROLES
                        )
                    )
                    with self.atomic(s):
                        for r, p in zip(ROLES, positions):
                            self.accept_position(s, r, p)
                        w.stage = "validation"
                elif w.stage in {
                    "validation",
                    "rebuttal_validation",
                    "clarification_validation",
                }:
                    pending = [c for c in w.claims if c.semantic_check == "pending"]
                    data = self.payload(
                        s, "moderator", claims=[c.model_dump() for c in pending]
                    )
                    # Semantic checking receives exact cited passages, not just initial excerpts.
                    data["evidence"] = [
                        self.index(s)[i].model_dump()
                        for i in dict.fromkeys(
                            i for c in pending for i in c.evidence_ids
                        )
                        if i in self.index(s)
                    ]
                    checked = (
                        await self.call(
                            s,
                            "moderator",
                            "semantic_check",
                            data,
                            SemanticReview,
                            generation,
                            w.stage == "clarification_validation",
                        )
                        if pending
                        else None
                    )
                    with self.atomic(s):
                        for c in pending:
                            semantic_result(
                                c,
                                set(checked.supported_ids) if checked else set(),
                                checked.unsupported if checked else {},
                            )
                        for challenge in w.challenges:
                            reply_claim = next(
                                (
                                    c
                                    for c in w.claims
                                    if c.id == f"response:{challenge.id}"
                                ),
                                None,
                            )
                            if reply_claim and challenge.requested_status:
                                challenge.status = (
                                    challenge.requested_status
                                    if reply_claim.validation == "supported"
                                    else "unresolved"
                                )
                        self.emit(
                            s,
                            "validation",
                            "moderator",
                            "Claim checks complete. Passage support, scope and arithmetic results remain inspectable.",
                            data={"claims": [c.model_dump() for c in w.claims]},
                        )
                        w.stage = {
                            "validation": "challenges",
                            "rebuttal_validation": "assessment",
                            "clarification_validation": "reassessment",
                        }[w.stage]
                elif w.stage == "challenges":
                    responses = await batch(
                        *(
                            self.call(
                                s,
                                r,
                                "challenge",
                                self.payload(
                                    s,
                                    r,
                                    positions=[p.model_dump() for p in w.positions],
                                    pm_challenges=w.pm_challenges,
                                    priorities=[
                                        c.id
                                        for c in w.claims
                                        if c.consequential
                                        and c.validation != "supported"
                                    ],
                                ),
                                ChallengeResponse,
                                generation,
                            )
                            for r in ROLES
                        )
                    )
                    with self.atomic(s):
                        claims = {c.id: c for c in w.claims}
                        for role, result in zip(ROLES, responses):
                            c = result.challenge if result else None
                            if c and (
                                c.actor != role
                                or c.target_actor == role
                                or c.target_claim_id not in claims
                                or claims[c.target_claim_id].actor != c.target_actor
                                or any(
                                    i not in {e.id for e in self.allowed(s, role)}
                                    for i in c.evidence_ids
                                )
                            ):
                                w.errors.append(f"Invalid {role} challenge rejected")
                                c = None
                            if c:
                                c.id = f"{w.brief.topic_id}:{role}:challenge"
                                c.status, c.response, c.response_evidence_ids = (
                                    "open",
                                    None,
                                    [],
                                )
                                w.challenges.append(c)
                            elif not result:
                                w.errors.append(
                                    f"{role} challenge opportunity incomplete"
                                )
                            self.emit(
                                s,
                                "challenge",
                                role,
                                c.question
                                if c
                                else (
                                    result.abstention_reason
                                    if result
                                    else "No completed challenge response; not agreement."
                                )
                                or "Invalid challenge rejected",
                                c.evidence_ids if c else [],
                                {"challenge": c.model_dump() if c else None},
                            )
                        w.stage = "rebuttals"
                elif w.stage == "rebuttals":
                    targets = [
                        r
                        for r in ROLES
                        if any(c.target_actor == r for c in w.challenges)
                    ]
                    results = await batch(
                        *(
                            self.call(
                                s,
                                r,
                                "rebuttal",
                                self.payload(
                                    s,
                                    r,
                                    challenges=[
                                        c.model_dump()
                                        for c in w.challenges
                                        if c.target_actor == r
                                    ],
                                    positions=[p.model_dump() for p in w.positions],
                                ),
                                Rebuttal,
                                generation,
                            )
                            for r in targets
                        )
                    )
                    with self.atomic(s):
                        for role, result in zip(targets, results):
                            allowed = {e.id for e in self.allowed(s, role)}
                            for c in [
                                c for c in w.challenges if c.target_actor == role
                            ]:
                                items = (
                                    [
                                        i
                                        for i in result.responses
                                        if i.challenge_id == c.id
                                    ]
                                    if result and result.actor == role
                                    else []
                                )
                                item = items[0] if len(items) == 1 else None
                                if item and all(
                                    i in allowed for i in item.evidence_ids
                                ):
                                    # Self-declared resolution remains explicitly labelled; judge can dispute it.
                                    (
                                        c.status,
                                        c.requested_status,
                                        c.response,
                                        c.response_evidence_ids,
                                    ) = (
                                        "unresolved",
                                        item.status,
                                        item.statement,
                                        item.evidence_ids,
                                    )
                                    response_claim = Claim(
                                        id=f"response:{c.id}",
                                        actor=role,
                                        statement=item.statement,
                                        kind="inference"
                                        if item.evidence_ids
                                        else "limitation",
                                        evidence_ids=item.evidence_ids,
                                        consequential=item.status != "unresolved",
                                    )
                                    validate_claim(
                                        response_claim,
                                        self.index(s),
                                        s.agenda.scope,
                                        allowed,
                                        {a.id for a in s.assumptions},
                                    )
                                    w.claims.append(response_claim)
                                else:
                                    c.status, c.response = (
                                        "unresolved",
                                        "No valid addressed rebuttal; incomplete record.",
                                    )
                                    w.errors.append(f"Missing rebuttal for {c.id}")
                                self.emit(
                                    s,
                                    "rebuttal",
                                    role,
                                    c.response,
                                    c.response_evidence_ids,
                                    {
                                        "challenge": c.model_dump(),
                                        "disposition_author": role,
                                        "implementation": result.implementation if result else None,
                                        "native_output": result.native_output if result else None,
                                    },
                                )
                        w.stage = "rebuttal_validation"
                elif w.stage in {"assessment", "reassessment"}:
                    packet = self.packet(s)
                    compact = packet.model_dump(
                        exclude={"evidence_index", "source_inventory", "transcript"}
                    )
                    data = self.payload(
                        s,
                        "judge",
                        packet=compact,
                        packet_access=f"{self.controller_url}/api/moderator/sessions/{s.id}/packet",
                        source_inventory=[
                            x.model_dump() for x in self.snapshot(s).sources
                        ],
                    )
                    # Judge receives every exact passage cited by this discussion,
                    # not merely the generic first window of topic evidence.
                    cited = {eid for claim in w.claims for eid in claim.evidence_ids}
                    cited.update(eid for challenge in w.challenges for eid in challenge.response_evidence_ids)
                    allowed_evidence = {e.id: e for e in self.allowed(s, "judge")}
                    data["evidence"] = [allowed_evidence[eid].model_dump() for eid in sorted(cited) if eid in allowed_evidence]
                    assessment = await self.call(
                        s,
                        "judge",
                        "assessment",
                        data,
                        JudgeAssessment,
                        generation,
                        True,
                    )
                    with self.atomic(s):
                        if assessment:
                            allowed = {e.id for e in self.allowed(s, "judge")}
                            if not self.valid_assessment(s, assessment, allowed):
                                w.errors.append(
                                    "Judge assessment contains invalid scoring labels or references"
                                )
                                assessment = None
                        w.assessment = assessment
                        self.emit(
                            s,
                            "assessment",
                            "judge",
                            assessment.summary
                            if assessment
                            else "Judge unavailable or invalid; no score or proposal is implied.",
                            assessment.evidence_ids if assessment else [],
                            {
                                "assessment": assessment.model_dump()
                                if assessment
                                else None
                            },
                        )
                        q = assessment.clarification if assessment else None
                        if q and q.requires_scope_change:
                            w.blocked_preference = True
                            s.status = "paused"
                            self.emit(
                                s,
                                "scope_gate",
                                "moderator",
                                "Judge requests a scope/preference change. Create a linked session with a newly confirmed agenda.",
                            )
                        elif (
                            q
                            and not w.clarification_used
                            and q.material
                            and q.answerable
                            and (
                                q.actor != "competitor"
                                or any(
                                    e.domain == "competitor"
                                    for e in self.allowed(s, q.actor)
                                )
                            )
                            and all(
                                i in {e.id for e in self.allowed(s, q.actor)}
                                for i in q.evidence_ids
                            )
                            and all(i in {c.id for c in w.claims} for i in q.claim_ids)
                        ):
                            w.stage = "clarification"
                        else:
                            if q:
                                self.emit(
                                    s,
                                    "clarification_declined",
                                    "moderator",
                                    "No further clarification: not material/answerable within supplied scoped evidence, or one already used.",
                                )
                            w.stage = "close"
                elif w.stage == "clarification":
                    q = w.assessment.clarification
                    if not w.clarification_used:
                        with self.atomic(s):
                            w.clarification_used = True
                            self.emit(
                                s, "clarification", "judge", q.question, q.evidence_ids
                            )
                    result = await self.call(
                        s,
                        q.actor,
                        "clarification",
                        self.payload(s, q.actor, question=q.model_dump()),
                        ClarificationResponse,
                        generation,
                        True,
                    )
                    with self.atomic(s):
                        allowed = {e.id for e in self.allowed(s, q.actor)}
                        if (
                            result
                            and result.actor == q.actor
                            and all(i in allowed for i in result.evidence_ids)
                        ):
                            w.clarification = result
                            self.emit(
                                s,
                                "clarification",
                                q.actor,
                                result.statement,
                                result.evidence_ids,
                            )
                            claim = Claim(
                                id=f"clarification:{w.brief.topic_id}",
                                actor=q.actor,
                                statement=result.statement,
                                kind="inference",
                                evidence_ids=result.evidence_ids,
                            )
                            validate_claim(
                                claim,
                                self.index(s),
                                s.agenda.scope,
                                allowed,
                                {a.id for a in s.assumptions},
                            )
                            w.claims.append(claim)
                        else:
                            w.errors.append("No valid clarification answer")
                        w.stage = "clarification_validation"
                elif w.stage == "close":
                    self.close_topic(s)
                else:
                    raise ValueError("Unknown persisted stage")
                elapsed = time.monotonic() - stage_start
                s.active_seconds += elapsed
                if s.work is w:
                    w.active_seconds += elapsed
                    w.stage_started_at = None
                stage_start = None
                self.store.save(s)
                await asyncio.sleep(0)
        except Budget as error:
            if stage_start is not None:
                elapsed = time.monotonic() - stage_start
                s.active_seconds += elapsed
                if s.work:
                    s.work.active_seconds += elapsed
                    s.work.stage_started_at = None
                stage_start = None
            if s.work:
                s.work.errors.append(str(error))
                s.work.budget_exhausted = True
                if (
                    s.work.stage
                    not in {
                        "assessment",
                        "reassessment",
                        "clarification",
                        "clarification_validation",
                    }
                    and s.work.active_seconds < s.limits.topic_seconds
                    and s.tokens < s.limits.session_tokens
                    and s.active_seconds < s.limits.session_seconds
                ):
                    s.work.stage = "assessment"
                    self.emit(
                        s,
                        "budget",
                        "moderator",
                        "Debate allocation exhausted. Using reserved budget for assessment and honest closure.",
                    )
                else:
                    self.close_topic(s, "budget_exhausted")
            await self.run(s, generation)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            s.status = "paused"
            self.emit(
                s,
                "error",
                "System",
                f"Workflow paused after {type(error).__name__}; checkpoint retained.",
            )
        finally:
            if stage_start is not None:
                elapsed = time.monotonic() - stage_start
                s.active_seconds += elapsed
                if s.work:
                    s.work.active_seconds += elapsed
                    s.work.stage_started_at = None
            self.store.save(s)

    @staticmethod
    def depends_on(aid, claims, alternatives, assessment):
        inputs = (
            [*assessment.scoring_inputs, *assessment.proposals] if assessment else []
        )
        return any(
            aid in item.assumption_ids for item in [*claims, *alternatives, *inputs]
        )

    async def change_assumption(self, sid, aid, request: AssumptionChange):
        async with self.locks[sid]:
            s = self.get(sid)
            a = next((a for a in s.assumptions if a.id == aid), None)
            if not a:
                raise KeyError(aid)
            if a.version != request.expected_version:
                raise Conflict("Assumption version changed")
            await self.cancel(sid)
            with self.atomic(s):
                s.assumption_history.append(a.model_copy(deep=True))
                a.version += 1
                a.statement, a.status, a.rationale = (
                    request.statement,
                    request.status,
                    request.rationale,
                )
                for outcome in s.outcomes:
                    dependent = self.depends_on(
                        aid,
                        outcome.packet.claims,
                        outcome.packet.alternatives,
                        outcome.assessment,
                    )
                    if dependent:
                        outcome.history.append(
                            {
                                "version": outcome.version,
                                "assessment": outcome.assessment.model_dump()
                                if outcome.assessment
                                else None,
                                "assumptions": [
                                    x.model_dump() for x in outcome.packet.assumptions
                                ],
                                "reason": request.rationale,
                            }
                        )
                        outcome.version += 1
                        outcome.assessment_valid = False
                        outcome.review_status = "Pending review"
                        outcome.packet.version += 1
                        outcome.packet.assumptions = [
                            a.model_copy(deep=True) if x.id == aid else x
                            for x in outcome.packet.assumptions
                        ]
                if s.work and self.depends_on(
                    aid, s.work.claims, s.work.alternatives, s.work.assessment
                ):
                    s.work.assessment = None
                    if s.work.stage in {
                        "assessment",
                        "reassessment",
                        "clarification",
                        "close",
                    }:
                        s.work.stage = "assessment"
                s.generation += 1
                s.revision += 1
                if s.status != "complete":
                    s.status = "paused"
                self.emit(
                    s,
                    "assumption_changed",
                    "PM",
                    request.rationale,
                    data={"assumption": a.model_dump()},
                )
            return s

    async def review(self, sid, tid, request: ReviewInput):
        async with self.locks[sid]:
            s = self.get(sid)
            outcome = next((o for o in s.outcomes if o.topic_id == tid), None)
            if not outcome:
                raise KeyError(tid)
            if outcome.version != request.expected_version:
                raise Conflict("Outcome changed; review its current version")
            if request.status == "Approved" and (
                not outcome.assessment_valid
                or outcome.closure_reason in {"budget_exhausted", "pm_stopped"}
            ):
                raise Conflict(
                    "Incomplete or invalidated outcome needs a new assessment before approval"
                )
            with self.atomic(s):
                outcome.decisions.append(
                    Decision(
                        version=outcome.version,
                        status=request.status,
                        rationale=request.rationale,
                    )
                )
                outcome.review_status = request.status
                s.revision += 1
                self.emit(
                    s,
                    "human_review",
                    "PM",
                    request.rationale,
                    data={
                        "topic_id": tid,
                        "version": outcome.version,
                        "status": request.status,
                    },
                )
            return s

    async def shutdown(self):
        for sid in list(self.tasks):
            await self.cancel(sid)
            s = self.get(sid)
            if s.status == "running":
                s.status = "paused"
                s.generation += 1
                self.emit(
                    s,
                    "recovery",
                    "System",
                    "Server stopped safely; resume this persisted checkpoint explicitly.",
                )
        await self.adapters.close()
