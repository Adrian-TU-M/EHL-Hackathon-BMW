"""Stable slide semantics, independent of each department's narrative order."""

from .models import AudienceOutline, OutlineItem

ROLES = (
    "cover",
    "problem",
    "evidence",
    "portfolio",
    "experience",
    "alternatives",
    "investment",
    "scenarios",
    "dependencies",
    "pilot",
    "risks",
    "decision",
)
ORDERS = {
    "executive": ROLES,
    "finance": (
        "cover",
        "investment",
        "alternatives",
        "portfolio",
        "scenarios",
        "risks",
        "evidence",
        "problem",
        "dependencies",
        "experience",
        "pilot",
        "decision",
    ),
    "engineering": (
        "cover",
        "portfolio",
        "problem",
        "experience",
        "evidence",
        "dependencies",
        "alternatives",
        "risks",
        "investment",
        "scenarios",
        "pilot",
        "decision",
    ),
    "sales": (
        "cover",
        "problem",
        "experience",
        "portfolio",
        "evidence",
        "alternatives",
        "scenarios",
        "investment",
        "dependencies",
        "risks",
        "pilot",
        "decision",
    ),
}
SECTIONS = {
    "executive": (
        "Customer opportunity",
        "Investment case",
        "Decision and staged commitment",
    ),
    "finance": ("Spending and assumptions", "Returns and downside", "Funding controls"),
    "engineering": (
        "Customer requirements",
        "Dependencies and validation",
        "Delivery commitments",
    ),
    "sales": (
        "Customer problem",
        "Proposition and supporting proof",
        "Launch readiness",
    ),
}
TITLES = {
    "cover": "A bounded investment in the customer experience",
    "problem": "Everyday friction defines the problem to solve",
    "evidence": "Customer evidence supports a pilot, with limits",
    "portfolio": "Focus the portfolio on the selected customer needs",
    "experience": "Make the intended customer experience testable",
    "alternatives": "Test simpler changes before committing to redesign",
    "investment": "Separate program spending from return assumptions",
    "scenarios": "Adoption drives the range of financial outcomes",
    "dependencies": "Assign ownership before committing delivery dates",
    "pilot": "Release further funding only after the pilot gates",
    "risks": "Resolve the objections that could stop the program",
    "decision": "Commit to the next stage, with clear conditions",
}
AUDIENCE_TITLES = {
    "finance": {
        "investment": "Control capital exposure through staged releases",
        "scenarios": "Test the return against lower adoption",
        "decision": "Authorize the initial release and its controls",
    },
    "engineering": {
        "portfolio": "Translate customer needs into a testable scope",
        "dependencies": "Confirm integration owners and failure recovery",
        "decision": "Agree the pilot scope and technical release gates",
    },
    "sales": {
        "experience": "Describe the benefit customers should experience",
        "evidence": "Separate supported proof from claims still to test",
        "decision": "Agree the customer proof required before launch",
    },
}
PURPOSES = {
    "cover": "The recommendation and the decision needed from this audience",
    "problem": "The customer need and its business significance; prevalence remains unmeasured",
    "evidence": "The strongest source passages, their scope and the limits of what they establish",
    "portfolio": "The selected requirements, grouped into a focused customer proposition",
    "experience": "Intended customer outcomes and the existing strengths to preserve",
    "alternatives": "Compare retention, simpler improvements and a bounded redesign pilot",
    "investment": "Capital, operating costs and the assumptions behind the return model",
    "scenarios": "Three-year adoption sensitivity; other financial assumptions are held constant",
    "dependencies": "Responsibilities and unresolved technical, financial and commercial dependencies",
    "pilot": "Baseline, prototype and evidence gates before further commitment",
    "risks": "Consequential objections, uncertainties and conditions for stopping or revising",
    "decision": "The audience commitment, initial funding ask and conditional subsequent releases",
}


def role_of(item):
    if item.role:
        return item.role
    try:
        return (
            ROLES[int(item.id.removeprefix("slide-")) - 1]
            if item.id.startswith("slide-")
            else "appendix"
        )
    except (ValueError, IndexError):
        return "appendix"


def outline(p, audience=None):
    audience = audience or p.brief.audience
    ids = [d.id for d in p.snapshot.decisions]
    return [
        OutlineItem(
            id=f"slide-{ROLES.index(role) + 1}",
            role=role,
            section=SECTIONS[audience][min(i // 4, 2)],
            title=AUDIENCE_TITLES.get(audience, {}).get(role, TITLES[role]),
            purpose=PURPOSES[role],
            decision_ids=ids,
        )
        for i, role in enumerate(ORDERS[audience])
    ]


def audience_outline(p, audience):
    if audience in p.audience_outlines:
        return p.audience_outlines[audience]
    # Legacy records retain their own outline and approval; another audience needs review.
    if audience == p.brief.audience:
        return AudienceOutline(items=p.outline, approved=p.outline_approved)
    if audience in p.decks:
        existing = p.decks[audience]
        purposes = {item.id: item.purpose for item in p.outline}
        items = [
            OutlineItem(
                id=slide.id,
                role=role_of(slide),
                section=slide.section,
                title=slide.title,
                purpose=purposes.get(slide.id)
                or slide.takeaway
                or "Review the argument and supporting evidence",
                decision_ids=slide.decision_ids,
            )
            for slide in existing.slides
            if role_of(slide) in ROLES
        ]
        if len(items) == 12:
            return AudienceOutline(items=items)
    return AudienceOutline(items=outline(p, audience))


def reset_outlines(p):
    p.audience_outlines = {a: AudienceOutline(items=outline(p, a)) for a in ORDERS}
    p.outline = p.audience_outlines[p.brief.audience].items
    p.outline_approved = False
