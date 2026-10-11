from __future__ import annotations

from .models import (
    ApprovedDecision,
    ApprovedDecisionSnapshot,
    FinancialInput,
    FinancialPlan,
    PresentationBrief,
    SourcePassage,
    fingerprint,
)


def dashboard_snapshot(data: dict) -> ApprovedDecisionSnapshot:
    requirements = data.get("requirements", [])
    approved = [
        r
        for r in requirements
        if r.get("status") == "Approved"
        and r.get("approvedVersion") == r.get("version")
        and isinstance(r.get("version"), int)
        and r["version"] >= 1
    ]
    ids = {eid for r in approved for eid in r.get("evidenceIds", [])}
    evidence = [
        SourcePassage(
            id=e["id"],
            source=e["source"],
            location=e["location"],
            passage=e["passage"],
            provenance="synthetic",
            quantitative=e.get("quantitative"),
        )
        for e in data.get("evidence", [])
        if e["id"] in ids and not e.get("exclusionReason")
    ]
    active = {e.id for e in evidence}
    decisions = [
        ApprovedDecision(
            id=r["id"],
            version=r["version"],
            title=r["title"],
            description=r["description"],
            pm_rationale=r.get("decisionRationale")
            or "PM approval rationale not supplied",
            rationale=r.get("rationale", ""),
            evidence_ids=[x for x in r.get("evidenceIds", []) if x in active],
            findings=[
                f
                for f in data.get("findings", [])
                if f["id"] in r.get("findingIds", [])
            ],
            history=r.get("history", []),
            assumptions=r.get("assumptions", []),
            uncertainties=r.get("uncertainties", [])
            + ["No linked canonical debate was supplied."],
            alternatives=r.get("alternatives", []),
            criteria=r.get("criteria", {}),
            effort=r.get("effort", "Unknown"),
            risk=r.get("risk"),
        )
        for r in approved
    ]
    payload = dict(
        kind="dashboard_demo",
        source_id=data.get("workspace_id", "dashboard-demo"),
        scope=data.get("scope", {}),
        decisions=[d.model_dump() for d in decisions],
        evidence=[e.model_dump() for e in evidence],
        weights=data.get("weights", {}),
    )
    return ApprovedDecisionSnapshot(
        **payload,
        source_hash=fingerprint(payload),
        synthetic=True,
        limitations=[
            "Browser dashboard requirements and evidence are synthetic demo records, not canonical council approvals.",
            "Priority is a weighted mean of known rubric values. Missing coverage remains disclosed.",
        ],
    )


def council_snapshot(engine, sid: str) -> ApprovedDecisionSnapshot:
    session = engine.get(sid)
    decisions, evidence_ids, snapshots = [], set(), set()
    for outcome in session.outcomes:
        if (
            not outcome.assessment_valid
            or not outcome.assessment
            or outcome.closure_reason in {"pm_stopped", "budget_exhausted"}
            or outcome.review_status in {"Rejected", "Challenged"}
        ):
            continue
        for proposal in outcome.assessment.proposals:
            approval = next(
                (
                    d
                    for d in reversed(outcome.proposal_decisions)
                    if d.proposal_id == proposal.id
                ),
                None,
            )
            if (
                not approval
                or approval.status != "Approved"
                or approval.proposal_version != proposal.version
                or approval.outcome_version != outcome.version
            ):
                continue
            packet = outcome.packet
            linked_claims = [c for c in packet.claims if c.id in proposal.claim_ids]
            refs = list(
                dict.fromkeys(
                    [
                        *proposal.evidence_ids,
                        *[eid for c in linked_claims for eid in c.evidence_ids],
                    ]
                )
            )
            evidence_ids.update(refs)
            snapshots.add(packet.source_snapshot)
            decisions.append(
                ApprovedDecision(
                    id=proposal.id,
                    version=proposal.version,
                    title=proposal.title,
                    description=proposal.description,
                    pm_rationale=approval.rationale,
                    rationale=outcome.assessment.summary,
                    evidence_ids=refs,
                    history=[
                        d.model_dump()
                        for d in outcome.proposal_decisions
                        if d.proposal_id == proposal.id
                    ],
                    assumptions=[
                        f"{a.id} v{a.version}: {a.statement} ({a.status}); validation: {a.validation_needed}"
                        for a in packet.assumptions
                    ],
                    uncertainties=list(
                        dict.fromkeys(
                            [
                                *packet.coverage_limitations,
                                *packet.unresolved_issues,
                                *outcome.assessment.unresolved_issues,
                            ]
                        )
                    ),
                    alternatives=[a.model_dump() for a in packet.alternatives],
                    debate=[
                        {"kind": "complete_packet", **packet.model_dump()},
                        {"kind": "judge_assessment", **outcome.assessment.model_dump()},
                    ],
                )
            )
    catalogs = [engine.catalogs[s] for s in snapshots if s in engine.catalogs]
    evidence = []
    seen = set()
    source_records = {s.id: s for c in catalogs for s in c.sources}
    for catalog in catalogs:
        for e in catalog.evidence:
            if e.id in evidence_ids and e.id not in seen:
                source = source_records[e.source_id]
                evidence.append(
                    SourcePassage(
                        id=e.id,
                        source=source.name,
                        location=e.location,
                        passage=e.passage,
                        provenance=source.provenance,
                        limitations=e.limitations,
                        quantitative=e.quantitative,
                    )
                )
                seen.add(e.id)
    payload = dict(
        kind="council",
        source_id=sid,
        scope=session.agenda.scope.model_dump(),
        decisions=[d.model_dump() for d in decisions],
        evidence=[e.model_dump() for e in evidence],
        weights={"need": 40, "severity": 35, "future": 20, "gap": 5},
    )
    synthetic = (
        any(e.provenance == "synthetic" for e in evidence)
        or session.mode == "deterministic"
    )
    return ApprovedDecisionSnapshot(
        **payload,
        source_hash=fingerprint(payload),
        synthetic=synthetic,
        limitations=[
            "Agenda weights are separate from requirement scoring and financial value.",
            "Engineering effort, ownership and financial returns remain unknown until supplied.",
        ],
    )


def demo_snapshot() -> ApprovedDecisionSnapshot:
    rows = [
        (
            "REQ-001",
            "Everyday controls, one step away",
            "Give drivers persistent, quickly accessible climate and essential controls with clear feedback, minimizing visual search during normal use.",
            "I have to look away from the road to find the temperature control.",
            "Low",
            2,
        ),
        (
            "REQ-002",
            "Confidence at every charging stop",
            "Make journey planning communicate charging availability, arrival charge uncertainty, and an understandable fallback stop.",
            "A stop looked available in the route planner, but the chargers were occupied.",
            "High",
            4,
        ),
        (
            "REQ-006",
            "Assistance that feels intuitive",
            "Make assistance status, settings and transitions easy to understand and control with minimal distraction.",
            "The assistance settings take too many steps to change.",
            "Unknown",
            4,
        ),
    ]
    data = {
        "workspace_id": "presentation-demo-v1",
        "scope": {
            "vehicle": "G60",
            "market": "Europe",
            "powertrain": "Electric",
            "horizon": 4,
        },
        "weights": {
            "need": 30,
            "severity": 25,
            "gap": 15,
            "future": 20,
            "feasibility": 10,
        },
        "requirements": [],
        "evidence": [],
    }
    for rid, title, description, passage, effort, risk in rows:
        eid = f"DEMO-{rid}"
        data["evidence"].append(
            dict(
                id=eid,
                source="Synthetic customer feedback collection",
                location=f"Presentation fixture / {rid}",
                passage=passage,
            )
        )
        data["requirements"].append(
            dict(
                id=rid,
                title=title,
                description=description,
                version=1,
                approvedVersion=1,
                status="Approved",
                decisionRationale="Synthetic PM approval: investigate this customer need through a bounded pilot before committing to rollout.",
                rationale="Illustrative need and severity assessment. This is not measured prevalence or verified financial value.",
                history=[
                    {
                        "version": 1,
                        "status": "Approved",
                        "actor": "Synthetic PM",
                        "rationale": "Pilot this need; budget approval is separate.",
                    }
                ],
                evidenceIds=[eid],
                effort=effort,
                risk=risk,
                criteria={
                    "need": 5,
                    "severity": 4,
                    "gap": None,
                    "future": 4,
                    "feasibility": None if effort == "Unknown" else 3,
                },
                assumptions=[
                    "Synthetic assumption: a unified improvement program can address this need."
                ],
                uncertainties=[
                    "No validated customer sample or implementation estimate."
                ],
                alternatives=[
                    {
                        "title": "Retain and monitor",
                        "uncertainty": "Reported friction may persist.",
                    },
                    {
                        "title": "Pilot the current experience",
                        "uncertainty": "Usability and technical viability require testing.",
                    },
                ],
            )
        )
    # These records deliberately fail the approval filter.
    data["requirements"] += [
        dict(data["requirements"][0], id="DEMO-PENDING", status="Pending review"),
        dict(data["requirements"][0], id="DEMO-REJECTED", status="Rejected"),
    ]
    snapshot = dashboard_snapshot(data)
    snapshot.kind = "isolated_demo"
    snapshot.limitations = [
        "All approvals, discussion, ownership, milestones and financial assumptions in this isolated workspace are synthetic."
    ]
    for d in snapshot.decisions:
        d.uncertainties = [
            "Synthetic fixture. Customer prevalence and technical feasibility remain unvalidated."
        ]
        d.debate = [
            {
                "actor": "customer",
                "statement": "The supplied illustrative quote identifies a customer friction, not its prevalence.",
                "evidence_ids": d.evidence_ids,
            },
            {
                "actor": "competitor",
                "statement": "No verified equivalent competitor configuration was provided. Competitive superiority is unknown.",
            },
            {
                "actor": "market",
                "statement": "Future demand remains an assumption and needs scoped research.",
            },
            {
                "actor": "engineering",
                "statement": "Validate integration cost, data reliability and driver interaction before scaling.",
            },
            {
                "actor": "customer",
                "statement": "Rebuttal: test a reversible prototype against the existing experience and retain effective current features.",
            },
            {
                "actor": "judge",
                "statement": "A bounded pilot can test the need while preserving positive qualities of the current experience.",
            },
        ]
    snapshot.source_hash = fingerprint(
        snapshot.model_dump(exclude={"source_hash", "captured_at"})
    )
    return snapshot


def demo_brief() -> PresentationBrief:
    def estimate(value):
        return FinancialInput(
            value=value,
            origin="synthetic",
            reference="Presentation demo financial fixture v1; not a BMW estimate",
        )

    return PresentationBrief(
        title="Pilot a clearer BMW experience",
        emphasis="Prove customer benefit and technical feasibility before scaling",
        financials=FinancialPlan(
            pilot=estimate(600000),
            development=estimate(2400000),
            rollout=estimate(3000000),
            annual_opex=estimate(800000),
            eligible_volume=estimate(100000),
            contribution=estimate(100),
            adoption=[estimate(0.2), estimate(0.35), estimate(0.5)],
            discount_rate=estimate(0.1),
        ),
    )
