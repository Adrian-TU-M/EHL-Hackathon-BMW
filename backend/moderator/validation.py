"""Deterministic checks are separate from model entailment checks."""

from __future__ import annotations

import math
import re

from .models import Claim, Evidence, Scope
from .sources import applicable


def validate_claim(
    claim: Claim,
    evidence: dict[str, Evidence],
    scope: Scope,
    allowed_ids: set[str],
    assumptions: set[str],
) -> Claim:
    issues = []
    refs = []
    for eid in claim.evidence_ids:
        e = evidence.get(eid)
        if e is None:
            issues.append(f"Unknown reference: {eid}")
        elif eid not in allowed_ids or e.excluded_reason:
            issues.append(f"Excluded or unauthorized reference: {eid}")
        elif not applicable(e, scope, True):
            issues.append(f"Scope mismatch: {eid}")
        else:
            refs.append(e)
    if any(i not in assumptions for i in claim.assumption_ids):
        issues.append("Unknown assumption dependency")
    if claim.kind in {"observation", "forecast", "target", "inference"} and not refs:
        issues.append("Factual/inferred assertion requires supplied evidence")
    if claim.kind == "observation" and any(e.kind == "provided_forecast" for e in refs):
        issues.append("Future values cannot be reported as observed results")
    for e in refs:
        if e.vehicle == "G60_G68" and not re.search(
            r"G60[/_]G68|grouped|combined|aggregat", claim.statement, re.I
        ):
            issues.append("G60/G68 aggregation must remain explicit")
        if e.kind in {"study_mean", "study_distribution"} and re.search(
            r"\b(?:n\s*=\s*\d+|one respondent|\d[\d,]*\s+(?:respondents|participants)|sample size\s*(?:of|=|:)?\s*\d+)",
            claim.statement,
            re.I,
        ):
            issues.append("Study means/proportions have no documented respondent count")
        if e.kind == "study_mean" and re.search(
            r"out of (?:\d+|five|ten)|\d+[ -]point(?:\s+(?:rating|response))?\s+scale|[01]\s*[-–]\s*\d+\s+scale",
            claim.statement,
            re.I,
        ):
            issues.append("Mean rating scale is undocumented")
        if e.region == "Germany" and not re.search(
            r"german|germany|deutsch", claim.statement, re.I
        ):
            issues.append("German equipment applicability must remain explicit")
        if (
            e.context_type
            in {"management_expectation", "corporate_target", "model_announcement"}
            and claim.kind == "observation"
        ):
            issues.append(
                "Expectations, targets and announcements cannot become reported results"
            )
    if (
        any(e.kind == "equipment" and not e.equipment_verified for e in refs)
        and claim.kind == "observation"
    ):
        issues.append(
            "Equipment availability/status is not verified from PDF table columns"
        )
    calc = claim.calculation
    if calc:
        calc_refs = [
            evidence[i] for i in calc.evidence_ids if i in evidence and i in allowed_ids
        ]
        if len(calc_refs) != len(calc.evidence_ids) or not set(
            calc.evidence_ids
        ).issubset(claim.evidence_ids):
            issues.append("Calculation references must be valid claim references")
        if any(not applicable(e, scope, True) or e.excluded_reason for e in calc_refs):
            issues.append("Calculation includes excluded or out-of-scope evidence")
        source_values = [
            e.quantitative.get("value")
            for e in calc_refs
            if e.quantitative and isinstance(e.quantitative.get("value"), (int, float))
        ]
        if len(source_values) != len(calc.values) or sorted(source_values) != sorted(
            calc.values
        ):
            issues.append(
                "Calculation operands must match cited scalar values; distributions/feedback need an explicit derived dataset"
            )
        if any(
            e.quantitative and e.quantitative.get("unit") != calc.unit
            for e in calc_refs
        ):
            issues.append("Calculation units differ from source units")
        if any(e.kind in {"study_mean", "study_distribution"} for e in calc_refs):
            issues.append(
                "Undocumented scales and unknown sample counts cannot be pooled or used as respondent denominators"
            )
        if len({e.kind for e in calc_refs}) > 1:
            issues.append("Actual and future populations must not be pooled")
        if (
            len({e.region for e in calc_refs}) > 1
            or len({e.vehicle for e in calc_refs}) > 1
        ):
            issues.append(
                "Mixed populations require a separately reviewed derived dataset"
            )
        if any(e.period and e.period not in calc.period for e in calc_refs):
            issues.append("Calculation must identify every source period")
        expected = None
        if calc.operation == "sum":
            expected = sum(calc.values)
        elif calc.operation == "mean":
            expected = sum(calc.values) / len(calc.values)
        elif (
            calc.operation == "growth" and len(calc.values) == 2 and calc.values[0] != 0
        ):
            expected = (calc.values[1] - calc.values[0]) / calc.values[0]
        elif calc.operation == "share" and calc.denominator and calc.denominator > 0:
            # Denominators must themselves be a cited operand; no invented n.
            if calc.denominator not in source_values:
                issues.append("Unsupported denominator")
            expected = calc.values[0] / calc.denominator
        if (
            expected is None
            or not math.isfinite(calc.result)
            or not math.isclose(expected, calc.result, rel_tol=1e-6, abs_tol=1e-9)
        ):
            issues.append("Invalid arithmetic or zero/unknown denominator")
    claim.issues = issues
    claim.validation = "unsupported" if issues else "unverified"
    claim.semantic_check = "pending" if not issues else "deterministic_rejection"
    return claim


def semantic_result(claim: Claim, supported: set[str], unsupported: dict[str, str]):
    if claim.validation == "unsupported":
        return
    if claim.id in unsupported:
        claim.validation = "unsupported"
        claim.issues.append(unsupported[claim.id])
        claim.semantic_check = "passage_does_not_support_claim"
    elif claim.id in supported:
        claim.validation = "supported"
        claim.semantic_check = "model_checked"  # A fallible check, never a guarantee.
    else:
        claim.semantic_check = "unavailable_or_unverified"
