from __future__ import annotations

import re
from collections import defaultdict

from .models import (
    Agenda,
    AgendaRefinement,
    AgendaTopic,
    Catalog,
    Rating,
    Scope,
    TopicBrief,
)
from .sources import RULES, applicable

WEIGHTS = {"need": 40, "severity": 35, "future": 20, "gap": 5}


def rank(topics: list[AgendaTopic]) -> list[AgendaTopic]:
    return sorted(
        topics,
        key=lambda t: (
            not t.pinned,
            not t.severe,
            -t.lower_score,
            -t.goal_relevance,
            -t.coverage,
            t.id,
        ),
    )


def scores(ratings: dict[str, Rating]):
    known = sum(WEIGHTS[k] for k, r in ratings.items() if r.value is not None)
    lower = sum(
        WEIGHTS[k] * r.value / 5 for k, r in ratings.items() if r.value is not None
    )
    return round(lower, 3), round(lower + 100 - known, 3), known


def prepare(catalog: Catalog, scope: Scope) -> Agenda:
    eligible = [e for e in catalog.evidence if applicable(e, scope, True)]
    observations = [e for e in eligible if e.kind == "feedback"]
    groups = defaultdict(list)
    for e in eligible:
        if e.kind in {"equipment", "sales_actual", "provided_forecast"}:
            continue
        for key in e.topics:
            groups[key].append(e)
    topics = []
    for key, signals in groups.items():
        label, area, question, *_ = RULES.get(
            key,
            (
                key.removeprefix("category-").replace("-", " ").capitalize(),
                "Interior",
                f"How should the {key.removeprefix('category-').replace('-', ' ')} experience meet customer needs?",
            ),
        )
        feedback = [e for e in signals if e.kind == "feedback"]
        customer = [e for e in signals if e.domain == "customer"]
        negative = [
            e
            for e in feedback
            if any(
                t in {"Difficult to Use", "Defect", "Wants"} for t in e.feedback_types
            )
            or re.search(
                r"\b(fail|problem|difficult|broken|unable|cannot|can't|not work)\b",
                e.passage,
                re.I,
            )
        ]
        positive = [e.id for e in feedback if "Likes" in e.feedback_types]
        # Severity is a provisional, source-linked lexical screening assessment.
        # A defect label alone is not a substantiated severe safety issue.
        severe = [
            e
            for e in negative
            if re.search(
                r"\b(crash|collision|injur|trapped|brake failure|fire hazard)\w*",
                e.passage,
                re.I,
            )
        ]
        refs = [e.id for e in negative or customer]
        count = len(feedback)
        future_signals = [
            e
            for e in signals
            if e.domain == "corporate"
            and e.context_type != "reported_result"
            and re.search(
                r"strategy|strategic|invest|R&D|research|development|Neue Klasse|future",
                e.passage,
                re.I,
            )
        ]
        need = (
            round(5 * len(negative) / len(observations), 3)
            if observations and negative
            else None
        )
        ratings = {
            "need": Rating(
                value=need,
                evidence_ids=refs,
                rationale=f"Provisional screening: 5 × {len(negative)} problem observations / {len(observations)} scoped feedback observations. All numerator references retained. Not customer prevalence."
                if negative
                else "Study/positive signal only; need magnitude unknown.",
            ),
            "severity": Rating(
                value=4 if severe else 2 if negative else None,
                evidence_ids=[e.id for e in severe or negative][:30],
                rationale="4 = explicit safety/consequence language requiring verification; 2 = reported friction. Lexical screening, not measured harm.",
            ),
            "future": Rating(
                value=3 if future_signals else None,
                evidence_ids=[e.id for e in future_signals],
                rationale="3 = authorized corporate strategy/research mentions this area; alignment only, no future demand forecast. Reported sales results alone do not establish future feature relevance.",
            ),
            "gap": Rating(
                value=None,
                rationale="No verified competitor feature comparison in supplied collection.",
            ),
        }
        lower, upper, coverage = scores(ratings)
        baseline = [e.id for e in eligible if e.kind == "equipment" and key in e.topics]
        sales = [e.id for e in eligible if e.source_id == "sales"]
        limits = sorted({limit for e in signals for limit in e.limitations})
        topics.append(
            AgendaTopic(
                id=f"topic-{key}",
                label=label,
                area=area,
                question=question,
                evidence_ids=[e.id for e in signals] + baseline + sales,
                counterevidence_ids=positive,
                ratings=ratings,
                lower_score=lower,
                upper_score=upper,
                coverage=coverage,
                observation_count=count,
                denominator=len(observations),
                exploratory=not customer,
                severe=False,
                eligible=not (key == "charging" and scope.powertrain == "Combustion"),
                goal_relevance=sum(w in (scope.prompt.lower()) for w in key.split("-")),
                rationale=f"{count} distinct scoped observations; {len(customer) - count} study signals. Supported contribution {lower}/100, possible {lower}–{upper}; known-weight coverage {coverage}%. "
                + (
                    "Strategy-only hypothesis."
                    if not customer
                    else "Customer-facing evidence available."
                )
                + (
                    " Potential severe wording flagged for verification; no automatic safety classification."
                    if severe
                    else ""
                ),
                limitations=limits,
            )
        )
    seen = {t.id for t in topics}
    for key in sorted({k for e in catalog.evidence for k in e.topics}):
        if f"topic-{key}" in seen:
            continue
        label, area, question, *_ = RULES.get(
            key,
            (
                key.replace("-", " "),
                "Interior",
                f"What customer need is associated with {key.replace('-', ' ')}?",
            ),
        )
        unknown = {
            k: Rating(
                value=None,
                rationale="No eligible finding for confirmed scope/powertrain",
            )
            for k in WEIGHTS
        }
        topics.append(
            AgendaTopic(
                id=f"topic-{key}",
                label=label,
                area=area,
                question=question,
                evidence_ids=[],
                ratings=unknown,
                lower_score=0,
                upper_score=100,
                coverage=0,
                observation_count=0,
                denominator=len(observations),
                eligible=False,
                rationale="Excluded: source findings do not match vehicle, market or powertrain. Cross-market/model transfer requires explicit scenario evidence.",
            )
        )
    for t in topics:
        if not t.eligible:
            t.rationale = "Excluded by scope/powertrain eligibility. " + t.rationale
    ordered = rank(topics)
    return Agenda(
        scope=scope,
        source_snapshot=catalog.snapshot_hash,
        topics=ordered,
        selected_ids=[t.id for t in ordered if t.eligible][:6],
        warnings=catalog.warnings
        + [
            "Agenda scores are screening assessments, separate from judge requirement scores.",
            "Europe scope includes EU studies as a documented subset; no population pooling.",
        ],
    )


def refine(agenda: Agenda, refinement: AgendaRefinement) -> Agenda:
    """Only accept grouping of existing candidates; all source references survive."""
    by_id = {t.id: t for t in agenda.topics}
    used = set()
    result = []
    for g in refinement.groups:
        if any(i not in by_id or i in used for i in g.topic_ids) or len(
            set(g.topic_ids)
        ) != len(g.topic_ids):
            raise ValueError("Refinement references duplicate or unknown candidates")
        items = [by_id[i] for i in g.topic_ids]
        if len({t.area for t in items}) != 1:
            raise ValueError("Different decision areas must stay separate")
        if any(not t.eligible for t in items):
            raise ValueError("Refinement cannot promote excluded topics")
        if len(items) > 1 and len({tuple(sorted(t.evidence_ids)) for t in items}) > 1:
            raise ValueError(
                "Merging distinct scored populations requires a recomputed agenda; preserve candidates instead"
            )
        # Never combine different scored populations or recalculate a sum as prevalence.
        base = items[0].model_copy(deep=True)
        base.label, base.question = g.label, g.question
        base.evidence_ids = sorted({i for t in items for i in t.evidence_ids})
        base.counterevidence_ids = sorted(
            {i for t in items for i in t.counterevidence_ids}
        )
        base.rationale += " Model-refined wording/grouping; score retains the leading candidate assessment."
        result.append(base)
        used.update(g.topic_ids)
    result.extend(t for t in agenda.topics if t.id not in used)
    agenda.topics = rank(result)
    agenda.selected_ids = [t.id for t in agenda.topics if t.eligible][:6]
    agenda.semantic_refinement = "applied"
    return agenda


def brief(agenda: Agenda, topic_id: str, catalog: Catalog) -> TopicBrief:
    t = next(t for t in agenda.topics if t.id == topic_id)
    ev = [e for e in catalog.evidence if e.id in t.evidence_ids]
    return TopicBrief(
        topic_id=t.id,
        question=t.question,
        scope=agenda.scope,
        objective=agenda.scope.prompt,
        equipment_baseline=[e.id for e in ev if e.kind == "equipment"],
        coverage={
            d: sum(e.domain == d for e in ev)
            for d in ["customer", "market", "competitor", "product", "corporate"]
        },
        limitations=list(
            dict.fromkeys(
                t.limitations
                + agenda.warnings
                + [
                    "Preserve positive qualities alongside proposed changes.",
                    "German equipment snippets are unverified baseline context.",
                ]
            )
        ),
    )
