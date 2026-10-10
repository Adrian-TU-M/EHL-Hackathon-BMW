from math import floor
from .models import Weights

CRITERIA = ("need", "severity", "gap", "future", "feasibility")


def score(criteria: dict[str, float | None], weights: Weights) -> tuple[int | None, int]:
    values = weights.model_dump()
    total = sum(values.values())
    known = sum(values[k] for k in CRITERIA if criteria[k] is not None)
    if not known:
        return None, 0
    weighted = sum(values[k] * criteria[k] / 5 for k in CRITERIA if criteria[k] is not None)
    return floor(100 * weighted / known + 0.5), floor(100 * known / total + 0.5) if total else 0


def influence(support: float | None, relevance: float | None) -> float | None:
    return None if support is None or relevance is None else round(support * relevance / 5, 2)
