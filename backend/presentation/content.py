from __future__ import annotations

import math
import re

from .models import BusinessArgument, DeckDocument, Presentation, SlideSpec
from .stories import ROLES, audience_outline, role_of


def money(value: float | None, currency: str) -> str:
    if value is None:
        return "not yet estimated"
    symbol = "$" if currency == "USD" else "EUR "
    return f"{symbol}{value / 1e6:,.2f}M" if value >= 1e6 else f"{symbol}{value:,.0f}"


def short(value: str, length=175):
    return value if len(value) <= length else value[: length - 3].rstrip() + "..."


def business_argument(p: Presentation) -> BusinessArgument:
    isolated = p.snapshot.kind == "isolated_demo"
    return BusinessArgument(
        recommendation="Fund a bounded pilot of the selected customer needs, with further investment conditional on evidence and feasibility.",
        customer_outcomes=[short(d.description) for d in p.snapshot.decisions[:3]]
        + [
            "Preserve effective qualities of the existing experience; validate the change against a baseline."
        ],
        alternatives=[
            "Retain and monitor: limited spending, with continued customer friction",
            "Improve the current experience: test simpler changes before redesign",
            "Pilot a broader redesign: learn about value and feasibility before rollout",
        ],
        dependencies=[
            "Synthetic owners: HMI, Connected Services and Driver Assistance leads"
            if isolated
            else "Engineering must confirm owners, integration dependencies and delivery estimates",
            "Finance validates incremental contribution, cost and cash timing",
            "Customer research tests usability and preserves positive qualities",
            "Sales and marketing validate messaging with evidence before launch",
        ],
        validation_gates=[
            "Synthetic discovery: weeks 1-4; establish customer and usability baselines"
            if isolated
            else "Discovery: establish the customer baseline and agree success measures with the PM",
            "Synthetic prototype: weeks 5-8; test integration and failure recovery"
            if isolated
            else "Prototype: test usability, integration and failure recovery",
            "Synthetic gate: weeks 9-12; target 20% less task time and no increase in critical errors"
            if isolated
            else "Gate: require evidence of customer benefit, technical feasibility and incremental value",
            "Stop or revise if the benefit, feasibility or finance-reviewed return case is unsupported",
        ],
        objections=[
            short(u, 145)
            for u in dict.fromkeys(
                u for d in p.snapshot.decisions for u in d.uncertainties
            )
        ][:2]
        + [
            "Delivery dependencies and failure recovery require technical validation before scaling",
            "Competitive advantage remains unknown without equivalent, verified comparisons",
        ],
    )


def scenario_note(p: Presentation, criteria: dict) -> str:
    if p.snapshot.kind == "council" or not criteria:
        return "Requirement priority/coverage is unknown. Agenda weights do not represent requirement scores."
    weights = p.snapshot.weights
    total = sum(max(0, w) for w in weights.values())
    known = [
        (min(5, max(0, criteria[k])), max(0, w))
        for k, w in weights.items()
        if isinstance(criteria.get(k), (int, float))
        and not isinstance(criteria[k], bool)
    ]
    denominator = sum(w for _, w in known)
    if not denominator or not total:
        return "Scenario priority and rubric coverage are unknown."
    score = math.floor(
        sum(value * weight for value, weight in known) / denominator * 20 + 0.5
    )
    coverage = math.floor(denominator / total * 100 + 0.5)
    return f"Frozen scenario priority: {score}/100; known rubric coverage: {coverage}%. Weighted mean of known 0-5 ratings x 20; unknown criteria are omitted, not scored zero. Priority is not monetary value."


def templates(p: Presentation, audience: str) -> list[SlideSpec]:
    ds, case, brief = p.snapshot.decisions, p.business_case, p.brief
    refs = list(dict.fromkeys(eid for d in ds for eid in d.evidence_ids))
    ask = money(case.initial_ask, brief.currency)
    total = money(case.investment, brief.currency)
    uncertainties = list(dict.fromkeys(u for d in ds for u in d.uncertainties))
    argument = case.argument or business_argument(p)
    points = [
        [
            f"Initial request: {ask}",
            f"Potential program investment: {total}",
            "Further funding depends on customer, engineering and financial validation",
        ],
        [short(d.title + ": " + d.description) for d in ds[:3]],
        [short(e.passage, 155) for e in p.snapshot.evidence[:2]]
        + [
            "These passages identify needs. They do not establish prevalence or measured financial returns."
        ],
        [short(d.title, 120) for d in ds[:4]],
        argument.customer_outcomes,
        argument.alternatives,
        [
            f"Program capital: {total}",
            f"Annual operating cost: {money(brief.financials.annual_opex.value, brief.currency)}",
            "Benefits count incremental contribution once across the entire portfolio",
            "Missing inputs: "
            + short(
                ", ".join(case.missing)
                or "none; every assumption still needs validation",
                135,
            ),
        ],
        [
            f"{s.name}: {money(s.net_value, brief.currency)} net over three years"
            for s in case.scenarios
        ]
        or [
            "A numerical return case needs sourced or PM-entered assumptions",
            "Customer priority and qualitative impact are not monetary returns",
        ],
        argument.dependencies,
        argument.validation_gates,
        argument.objections,
        [
            f"Decision requested today: {ask}",
            f"{'Conditional development' if brief.funding_structure == 'staged' else 'Development allocation'}: {money(brief.financials.development.value, brief.currency)}",
            f"{'Conditional rollout' if brief.funding_structure == 'staged' else 'Rollout allocation'}: {money(brief.financials.rollout.value, brief.currency)}",
            "Further spending requires leadership authorization at each release gate",
        ],
    ]
    focus = {
        "finance": {
            2: "Evidence supports the need; adoption and incremental contribution still require validation",
            5: "Limit initial exposure and compare lower-cost ways to test value",
            8: "Finance owns cost, contribution and release-gate validation",
            9: "Agree measurable release conditions before committing further capital",
            10: "Protect the downside: unvalidated adoption and delivery cost can erode returns",
        },
        "engineering": {
            1: "Translate customer needs into testable behavior",
            4: "Preserve clear feedback and effective features while testing the change",
            8: "Confirm technical owners, integration dependencies and failure recovery",
            9: "Prove feasibility and safe interaction before scaling",
            10: "Resolve consequential technical objections before committing delivery dates",
        },
        "sales": {
            1: "Explain the friction in the customer's own terms",
            2: "Separate substantiated proof points from claims the pilot must test",
            4: "Make the intended customer benefit tangible without promising unproven outcomes",
            8: "Validate customer language and launch claims with research",
            10: "Preserve caveats; superiority and adoption claims need stronger evidence",
        },
    }.get(audience, {})
    if audience == "finance":
        points[8] = (
            [
                argument.dependencies[1],
                argument.dependencies[0],
                *argument.dependencies[2:],
            ]
            if len(argument.dependencies) > 1
            else argument.dependencies
        )
    elif audience == "sales" and len(argument.dependencies) > 3:
        points[8] = [argument.dependencies[3], *argument.dependencies[:3]]
    layouts = [
        "cover",
        "evidence",
        "evidence",
        "portfolio",
        "portfolio",
        "comparison",
        "financial",
        "financial",
        "roadmap",
        "roadmap",
        "risk",
        "closing",
    ]
    slides = []
    for item in audience_outline(p, audience).items:
        role = role_of(item)
        i = ROLES.index(role)
        # Speaking guidance stays separate from source/audit material.
        notes = f"{item.purpose}.\n{argument.recommendation}\n"
        notes += f"Emphasize {brief.emphasis}.\nOpen questions: {brief.constraints}.\n"
        if role in {"problem", "portfolio", "experience", "evidence"}:
            notes += "\n".join(
                f"{d.title}: {clean_rationale(d.pm_rationale)}"
                for d in ds
                if d.id in item.decision_ids
            )
        if role in {"investment", "scenarios", "decision"}:
            notes += "\n" + "\n".join(case.limitations)
            notes += "\nDownside adoption = base x 0.7; upside = base x 1.2, capped at 100%. Other inputs are held constant."
        if role == "pilot":
            notes += "\n" + "\n".join(argument.validation_gates)
        if role == "risks":
            notes += "\nQuestions to resolve:\n" + "\n".join(uncertainties)
        audience_points = list(points[i])
        if role == "decision" and audience == "engineering":
            audience_points = [
                "Agree technical owners, pilot scope and failure-recovery tests",
                *points[i][:3],
            ]
        elif role == "decision" and audience == "sales":
            audience_points = [
                "Agree research ownership and evidence required for launch claims",
                *points[i][:3],
            ]
        slides.append(
            SlideSpec(
                id=item.id,
                role=role,
                section=item.section,
                title=brief.title if role == "cover" else item.title,
                takeaway=short(brief.emphasis, 215)
                if role == "cover"
                else short(focus.get(i, item.purpose), 215),
                layout=layouts[i],
                points=audience_points,
                notes=short(notes, 9500),
                decision_ids=item.decision_ids,
                evidence_ids=refs,
                synthetic=p.snapshot.synthetic,
            )
        )
    for d in ds:
        score = scenario_note(p, d.criteria)
        notes = f"{d.description}\n{clean_rationale(d.pm_rationale)}\n{d.rationale}\n"
        notes += "\nAssumptions: " + "\n".join(d.assumptions)
        notes += "\nUncertainties: " + "\n".join(d.uncertainties) + "\n" + score
        slides.append(
            SlideSpec(
                id=f"appendix-{d.id}",
                role="appendix",
                section="Evidence appendix",
                title=short(d.title, 90),
                takeaway=d.id,
                layout="appendix",
                points=[
                    short(d.description),
                    short(clean_rationale(d.pm_rationale)),
                    short(
                        "Known limits: "
                        + (" ".join(d.uncertainties) or "Further validation required")
                    ),
                    short(
                        score.split(". ")[0] + ". Priority is not monetary value.", 130
                    ),
                ],
                notes=short(notes, 9500),
                decision_ids=[d.id],
                evidence_ids=d.evidence_ids,
                synthetic=p.snapshot.synthetic,
            )
        )

    return slides


def clean_rationale(value: str) -> str:
    cleaned = re.sub(
        r"^(?:Synthetic PM approval|PM rationale|PM approval):\s*",
        "",
        value,
        flags=re.I,
    ).strip()
    return cleaned[:1].upper() + cleaned[1:]


def source_notes(p: Presentation, slide: SlideSpec) -> str:
    records = [e for e in p.snapshot.evidence if e.id in slide.evidence_ids]
    return (
        (
            "SYNTHETIC DEMO. All synthetic records and estimates are illustrative.\n\n"
            if slide.synthetic
            else ""
        )
        + re.sub(
            r"(?im)^(?:PM rationale|Synthetic PM approval|PM approval):\s*",
            "",
            slide.notes,
        )
        + "\n\nSOURCE REFERENCES\n"
        + (
            (
                "Financial assumptions and provenance:\n"
                + p.brief.financials.model_dump_json(indent=2)
                + "\n\n"
            )
            if role_of(slide) in {"investment", "scenarios", "decision"}
            else ""
        )
        + "\n\n".join(
            f"{e.id}: {e.source} / {e.location}\nProvenance: {e.provenance}\n{e.passage}\nLimitations: {' '.join(e.limitations)}"
            for e in records
        )
    )


def validate_slide(
    p: Presentation, slide: SlideSpec, original: SlideSpec | None = None
):
    known_decisions = {d.id for d in p.snapshot.decisions}
    known_evidence = {e.id for e in p.snapshot.evidence}
    if (
        not set(slide.decision_ids) <= known_decisions
        or not set(slide.evidence_ids) <= known_evidence
    ):
        raise ValueError(
            "Slide references a decision or evidence outside the frozen snapshot"
        )
    if slide.synthetic != p.snapshot.synthetic:
        raise ValueError("Synthetic disclosure cannot be removed")
    if original and original.locked and slide != original:
        # Explicit unlock is the only permitted change to a locked slide.
        if slide != original.model_copy(update={"locked": False}):
            raise ValueError("Unlock this slide before editing it")
    if original and (
        slide.id != original.id
        or slide.layout != original.layout
        or slide.role != original.role
        or slide.section != original.section
        or slide.layout_id != original.layout_id
        or slide.decision_ids != original.decision_ids
        or slide.evidence_ids != original.evidence_ids
    ):
        raise ValueError(
            "Edits cannot change slide identity, layout or approved source references"
        )
    # Finance figures come only from the deterministic business case, including manual edits.
    if slide.layout in {"financial", "closing", "cover"}:
        expected = next(
            (
                s
                for a in ("executive", "finance", "engineering", "sales")
                for s in templates(p, a)
                if s.id == slide.id and s.points == slide.points
            ),
            None,
        )
        if not expected:
            # Existing legacy deck content remains protected exactly as stored.
            expected = next(
                (
                    s
                    for deck in p.decks.values()
                    for s in deck.slides
                    if s.id == slide.id and s.points == slide.points
                ),
                None,
            )
        if expected is None:
            raise ValueError(
                "Change financial assumptions in the brief; calculated financial slide content is protected"
            )
    if slide.content:
        from .design import KINDS, fit

        if slide.content.kind != KINDS.get(role_of(slide)):
            raise ValueError("Structured content must match the semantic slide role")
        for item in slide.content.items:
            if item.source_id and item.source_id not in slide.evidence_ids:
                raise ValueError(
                    "Structured evidence must use the slide's frozen sources"
                )
            if item.source_id:
                record = next(e for e in p.snapshot.evidence if e.id == item.source_id)
                if item.detail != fit(record.passage, 130):
                    raise ValueError(
                        "Source quotations cannot be rewritten; edit the interpretation instead"
                    )
        if (
            original
            and original.content
            and (
                slide.content.kind != original.content.kind
                or [i.source_id for i in slide.content.items]
                != [i.source_id for i in original.content.items]
            )
        ):
            raise ValueError(
                "Edits must preserve structured source references and item count"
            )
    elif original and original.content:
        raise ValueError("Edits cannot remove structured slide content")
    if slide.content and slide.layout in {"financial", "closing", "cover"}:
        raise ValueError(
            "Calculated financial slides cannot accept narrative chart data"
        )
    text = " ".join(
        [
            slide.title,
            slide.takeaway,
            *slide.points,
            slide.notes,
            slide.content.model_dump_json() if slide.content else "",
        ]
    )
    text = re.sub(r"(?:REQ|DEMO|F|slide|appendix)-[\w-]+|\bv\d+\b", "", text)
    allowed = " ".join(
        [
            p.snapshot.model_dump_json(),
            p.brief.model_dump_json(),
            *(
                d.description + " " + d.title + " " + d.pm_rationale + " " + d.rationale
                for d in p.snapshot.decisions
            ),
            *(e.passage for e in p.snapshot.evidence),
            *[
                s.notes + " " + " ".join(s.points)
                for s in templates(p, p.brief.audience)
            ],
        ]
    )
    for token in re.findall(r"(?<![\w-])\d+(?:[,.]\d+)*(?:%|M)?", text):
        if token not in allowed:
            raise ValueError(
                f"Unreferenced numerical assertion: {token}. Use a sourced value or a financial input."
            )


def validate_deck(p: Presentation, deck: DeckDocument):
    if not deck.complete or not deck.slides:
        raise ValueError("Finish slide generation before finalizing")
    ids = [s.id for s in deck.slides]
    if len(set(ids)) != len(ids):
        raise ValueError("Slide IDs must be unique")
    covered = {did for s in deck.slides for did in s.decision_ids}
    if covered != {d.id for d in p.snapshot.decisions}:
        raise ValueError("Every selected approved decision needs presentation coverage")
    for s in deck.slides:
        validate_slide(p, s)
