"""Same-opening baseline comparison. Human quality judgments stay pending."""

import argparse
import asyncio
import json
import socket
from pathlib import Path

import uvicorn

from .adapters import DeterministicAdapters, HttpAdapters
from .app import create_app
from .engine import Engine
from .models import ConfirmAgenda, Control, Scope, Session, Work
from .sources import load_catalog
from .storage import Store


def measures(outcome, catalog, independent=None):
    baseline = (
        independent.packet.claims
        if independent
        else [c for p in outcome.packet.positions for c in p.claims]
    )
    moderated = outcome.packet.claims
    known = {e.id for e in catalog.evidence}
    labelled = {c.id for c in outcome.packet.challenges if c.consequence.strip()}
    retained = {c.id for c in outcome.packet.challenges if c.status != "open"}
    return {
        "independent_claim_count": len(baseline),
        "moderated_claim_count": len(moderated),
        "independent_evidence_coverage": len(
            {i for c in baseline for i in c.evidence_ids if i in known}
        ),
        "moderated_evidence_coverage": len(
            {i for c in moderated for i in c.evidence_ids if i in known}
        ),
        "accepted_fabricated_reference_count": sum(
            i not in known
            for c in moderated
            if c.validation == "supported"
            for i in c.evidence_ids
        ),
        "labelled_consequential_disagreements_retained": labelled.issubset(retained),
        "original_positions_retained": all(
            any(
                c.id == original.id and c.statement == original.statement
                for c in moderated
            )
            for original in baseline
        ),
        "issue_coverage_review": "pending PM judgment against case checklist",
        "review_effort_measurement": None,
    }


async def assess_independent(engine, moderated):
    """Reuse the exact openings/evidence with no challenges or clarification.

    This is a separate bounded run: baseline assessment cannot consume or alter
    the moderated run's token budget, transcript or source snapshot.
    """
    outcome = moderated.outcomes[0]
    packet = outcome.packet
    positions = [p.model_copy(deep=True) for p in packet.positions]
    baseline = Session(
        agenda=moderated.agenda.model_copy(deep=True),
        mode=moderated.mode,
        parent_session_id=moderated.id,
        limits=moderated.limits.model_copy(deep=True),
        status="ready",
        assumptions=[a.model_copy(deep=True) for a in packet.assumptions],
        work=Work(
            brief=packet.brief.model_copy(deep=True),
            stage="assessment",
            positions=positions,
            claims=[c for p in positions for c in p.claims],
            alternatives=[a for p in positions for a in p.alternatives],
            clarification_used=True,
        ),
    )
    baseline.agenda.selected_ids = [outcome.topic_id]
    engine.sessions[baseline.id] = baseline
    engine.emit(
        baseline,
        "evaluation_baseline",
        "System",
        "Independent openings only: same frozen evidence; no challenges or clarification.",
        data={"moderated_session_id": moderated.id},
    )
    await engine.control(
        baseline.id,
        Control(
            action="start", expected_revision=0, idempotency_key="evaluate-baseline"
        ),
    )
    await engine.tasks[baseline.id]
    return baseline.outcomes[0] if baseline.outcomes else None


async def evaluate(args):
    catalog = load_catalog(args.data / "inputs", args.data / "catalogs")
    adapters = HttpAdapters() if args.adapter == "http" else DeterministicAdapters()
    if adapters.missing():
        raise SystemExit(
            "Live evaluation unavailable: " + ", ".join(adapters.missing())
        )
    args.output.mkdir(parents=True, exist_ok=True)
    engine = Engine(catalog, Store(args.output / "evaluation.sqlite3"), adapters)
    # Live services need working exact-evidence and packet URLs during both runs.
    server, serving, listener = None, None, None
    if args.adapter == "http":
        listener = socket.socket()
        try:
            listener.bind((args.host, args.port))
            listener.listen(128)
            listener.setblocking(False)
        except BaseException:
            listener.close()
            await engine.shutdown()
            engine.store.close()
            raise
        engine.controller_url = (
            args.controller_url or f"http://{args.host}:{args.port}"
        ).rstrip("/")
        server = uvicorn.Server(
            uvicorn.Config(create_app(engine), log_level="warning", lifespan="on")
        )
        serving = asyncio.create_task(server.serve(sockets=[listener]))
    report = []
    try:
        if server:
            for _ in range(100):
                if server.started:
                    break
                if serving.done():
                    await serving
                    raise RuntimeError("Evaluation evidence server failed to start")
                await asyncio.sleep(0.05)
            else:
                raise RuntimeError("Evaluation evidence server did not start")
        for case in json.loads(args.cases.read_text()):
            s = await engine.create(Scope.model_validate(case["scope"]))
            valid = [t.id for t in s.agenda.topics if t.eligible]
            topic = (
                case["topic"]
                if case["topic"] in valid
                else next(iter(s.agenda.selected_ids), None)
            )
            if topic is None:
                report.append(
                    {**case, "status": "no eligible topic", "human_review": "pending"}
                )
                continue
            await engine.confirm(
                s.id,
                ConfirmAgenda(expected_version=s.agenda.version, selected_ids=[topic]),
            )
            await engine.control(
                s.id,
                Control(
                    action="start",
                    expected_revision=s.revision,
                    idempotency_key="evaluate",
                ),
            )
            await engine.tasks[s.id]
            if not s.outcomes:
                report.append({**case, "status": s.status, "human_review": "pending"})
                continue
            outcome = s.outcomes[0]
            independent = await assess_independent(engine, s)
            artifact = {
                "independent_positions": [
                    p.model_dump() for p in outcome.packet.positions
                ],
                "independent_baseline": independent.model_dump()
                if independent
                else None,
                "moderated": outcome.model_dump(),
                "source_snapshot": s.agenda.source_snapshot,
            }
            (args.output / f"{case['id']}.json").write_text(
                json.dumps(artifact, indent=2)
            )
            report.append(
                {
                    **case,
                    "selected_topic": topic,
                    "closure": outcome.closure_reason,
                    "independent_closure": independent.closure_reason
                    if independent
                    else "incomplete",
                    "metrics": measures(outcome, engine.snapshot(s), independent),
                    "human_review": "pending",
                }
            )
        (args.output / "summary.json").write_text(
            json.dumps(
                {
                    "mode": args.adapter,
                    "quality_claim": "No AI quality improvement established until PM review; deterministic mode validates integration only.",
                    "cases": report,
                },
                indent=2,
            )
        )
        print(
            f"Wrote {len(report)} baseline/moderated cases to {args.output}; PM quality review pending."
        )
    finally:
        if server:
            server.should_exit = True
            await serving
            listener.close()
        await engine.shutdown()
        engine.store.close()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", type=Path, default=Path("../private-data"))
    p.add_argument(
        "--cases",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "evaluation/cases.json",
    )
    p.add_argument("--output", type=Path, default=Path("../private-data/evaluation"))
    p.add_argument(
        "--adapter", choices=["deterministic", "http"], default="deterministic"
    )
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8002)
    p.add_argument(
        "--controller-url", help="Evidence-server URL reachable by remote live services"
    )
    asyncio.run(evaluate(p.parse_args()))


if __name__ == "__main__":
    main()
