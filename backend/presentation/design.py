"""Application-owned structure for the BMW executive layout library."""

from .models import SlideContent, SlideContentItem, SlideSpec

KINDS = {
    "problem": "problem",
    "evidence": "evidence",
    "portfolio": "portfolio",
    "experience": "journey",
    "alternatives": "comparison",
    "dependencies": "responsibilities",
    "pilot": "roadmap",
    "risks": "risks",
}

COPY_BUDGETS = {
    "problem": {"label": 50, "detail": 125},
    "portfolio": {"label": 50, "detail": 125},
    "evidence": {"detail": 130, "condition": 90},
    "journey": {"label": 28, "detail": 95},
    "comparison": {"label": 40, "detail": 75, "condition": 65},
    "responsibilities": {"label": 24, "detail": 70, "dependency": 22},
    "roadmap": {"label": 24, "detail": 52, "condition": 40},
    "risks": {"detail": 75, "dependency": 42, "condition": 35},
}


def fit(value, length):
    return value if len(value) <= length else value[: length - 3].rstrip() + "..."


def structure_slide(p, slide: SlideSpec) -> SlideSpec:
    """Structure new templates only. Theme upgrades never infer new PM content."""
    slide.layout_id = slide.role
    kind = KINDS.get(slide.role)
    if not kind:
        return slide
    slide.notes += "\n\nSupporting detail:\n" + "\n".join(slide.points)
    items = []
    for i, point in enumerate(slide.points):
        label, sep, detail = point.partition(": ")
        item = SlideContentItem(
            label=fit(label, 60) if sep else "",
            detail=fit(detail if sep else point, 130),
        )
        if kind == "evidence":
            records = p.snapshot.evidence[:2]
            if i >= len(records):
                continue
            record = records[i]
            # Exact quotations stay application-owned; notes carry the complete passage.
            item.label = "Customer evidence"
            item.detail = fit(record.passage, 130)
            item.source_id = record.id
            item.condition = "Identifies a reported need; prevalence and business effects remain unmeasured."
        elif kind == "problem":
            decision = p.snapshot.decisions[min(i, len(p.snapshot.decisions) - 1)]
            item.label = decision.title[:60]
            item.detail = fit(decision.description, 130)
        elif kind == "portfolio":
            decision = p.snapshot.decisions[min(i, len(p.snapshot.decisions) - 1)]
            item.label = decision.title[:60]
            item.detail = fit(decision.description, 130)
        elif kind == "journey":
            item.label = [
                "Everyday controls",
                "Charging journey",
                "Driving assistance",
                "Existing strengths",
            ][i]
            item.detail = fit(item.detail, 100)
        elif kind == "comparison":
            item.label = fit(item.label, 40)
            item.detail = fit(item.detail, 75)
            item.condition = [
                "Customer friction may remain",
                "Scope and effectiveness need testing",
                "Further spending depends on pilot evidence",
            ][min(i, 2)]
        elif kind == "responsibilities":
            item.label = [
                "Engineering",
                "Finance",
                "Customer research",
                "Sales / Marketing",
            ][i]
            # Keep the actual department attached when audience ordering differs.
            low = point.lower()
            if low.startswith("finance"):
                item.label = "Finance"
            elif low.startswith("sales"):
                item.label = "Sales / Marketing"
            elif low.startswith("customer"):
                item.label = "Customer research"
            else:
                item.label = "Engineering"
            item.owner = "To confirm"
            item.dependency = "Criteria to confirm"
            item.detail = fit(item.detail, 75)
        elif kind == "roadmap":
            item.label = ["Discovery", "Prototype", "Validation", "Release decision"][i]
            item.owner = "To confirm"
            item.timing = (
                ["Weeks 1–4", "Weeks 5–8", "Weeks 9–12", "After validation"][i]
                if p.snapshot.kind == "isolated_demo"
                else "To confirm"
            )
            item.condition = (
                "Hold if evidence is insufficient"
                if i == 3
                else "Review evidence before proceeding"
            )
            item.detail = [
                "Establish customer and usability baselines",
                "Test integration and failure recovery",
                "Target 20% less task time"
                if p.snapshot.kind == "isolated_demo"
                else "Validate benefit, feasibility and value",
                "Review customer benefit, feasibility and return",
            ][i]
            if i == 2 and p.snapshot.kind == "isolated_demo":
                item.condition = "No increase in critical errors"
        elif kind == "risks":
            item.label = "Open objection"
            item.dependency = "Validate with the responsible department"
            item.condition = "Hold commitment if unresolved"
            item.detail = fit(item.detail, 78)
        for field, budget in COPY_BUDGETS[kind].items():
            setattr(item, field, fit(getattr(item, field), budget))
        items.append(item)
    if p.snapshot.kind == "isolated_demo" and kind in {
        "problem",
        "portfolio",
        "journey",
    }:
        demo_copy = {
            "REQ-001": "Keep climate and essential controls easy to reach, with clear feedback.",
            "REQ-002": "Show charger availability and arrival-charge uncertainty, with a clear fallback stop.",
            "REQ-006": "Make assistance status and transitions easy to understand and control.",
        }
        for item, decision in zip(items, p.snapshot.decisions):
            if decision.id in demo_copy:
                item.detail = demo_copy[decision.id]
        if kind == "journey" and len(items) == 4:
            items[
                3
            ].detail = (
                "Preserve existing strengths and compare the change with a baseline."
            )
    if p.snapshot.kind == "isolated_demo" and kind == "risks":
        for item in items:
            lower = item.detail.lower()
            item.detail = (
                "Competitive advantage is unknown without equivalent comparisons."
                if "competitive" in lower
                else "Integration and failure recovery need technical validation."
                if "delivery" in lower
                else "Customer prevalence and technical feasibility remain unvalidated."
            )
    if items:
        slide.content = SlideContent(kind=kind, items=items)
        slide.points = [item.detail for item in items]
    return slide


def validate_written_copy(slide):
    """Catch local-model character-limit chopping separately from PM-authored text."""
    import re

    if not slide.content:
        return
    for item in slide.content.items:
        for field, limit in COPY_BUDGETS[slide.content.kind].items():
            value = getattr(item, field)
            if field == "detail" and item.source_id:
                continue
            if (
                value.endswith(("...", "…"))
                or len(value) >= limit
                or re.search(
                    r"\b(and|or|an|the|with|before|after|to|of|for|by|is|are)\s*$",
                    value,
                    re.I,
                )
            ):
                raise ValueError(
                    f"Rewrite {field} as a complete concise phrase under {max(20, limit - 12)} characters. Do not cut words or end with ellipses."
                )
