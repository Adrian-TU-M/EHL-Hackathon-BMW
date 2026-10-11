from .models import BusinessCase, PresentationBrief, ScenarioResult


def calculate(brief: PresentationBrief) -> BusinessCase:
    plan = brief.financials
    raw = plan.model_dump()
    missing = [
        name
        for name, item in raw.items()
        if name != "adoption" and item["value"] is None
    ]
    missing += [
        f"adoption_year_{i + 1}"
        for i, item in enumerate(plan.adoption)
        if item.value is None
    ]
    capital = [plan.pilot.value, plan.development.value, plan.rollout.value]
    investment = sum(capital) if all(v is not None for v in capital) else None
    case = BusinessCase(
        currency=brief.currency,
        investment=investment,
        initial_ask=plan.pilot.value
        if brief.funding_structure == "staged"
        else investment,
        missing=missing,
        assumptions=raw,
    )
    case.limitations.append(
        "Pilot is paid at year zero; development in year one and rollout in year two. Operating costs occur in years one to three."
        if brief.funding_structure == "staged"
        else "All program capital is paid at year zero. Operating costs occur in years one to three."
    )
    case.limitations.append(
        "Adoption is a fraction of the same annual eligible volume; contribution is per adopting vehicle per year. Cash flows are year-end, except initial capital. Break-even requires cumulative cash flow to remain non-negative thereafter."
    )
    if missing:
        return case
    pilot, development, rollout = capital
    volume, contribution, opex, rate = (
        plan.eligible_volume.value,
        plan.contribution.value,
        plan.annual_opex.value,
        plan.discount_rate.value,
    )
    cost = investment + 3 * opex
    for name, multiplier in [("Downside", 0.7), ("Base", 1), ("Upside", 1.2)]:
        benefits = [
            volume * min(1, a.value * multiplier) * contribution for a in plan.adoption
        ]
        if brief.funding_structure == "staged":
            flows = [
                -pilot,
                benefits[0] - development - opex,
                benefits[1] - rollout - opex,
                benefits[2] - opex,
            ]
        else:
            flows = [-investment, *[b - opex for b in benefits]]
        cumulative, totals = 0, []
        for flow in flows:
            cumulative += flow
            totals.append(cumulative)
        break_even = next(
            (
                year
                for year in range(len(totals))
                if cost > 0 and min(totals[year:]) >= 0
            ),
            None,
        )
        case.scenarios.append(
            ScenarioResult(
                name=name,
                benefits=benefits,
                cash_flows=flows,
                total_benefit=sum(benefits),
                total_cost=cost,
                net_value=sum(flows),
                roi=(sum(benefits) - cost) / cost if cost else None,
                npv=sum(flow / (1 + rate) ** year for year, flow in enumerate(flows)),
                break_even_year=break_even,
            )
        )
    return case
