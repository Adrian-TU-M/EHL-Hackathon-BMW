"""Separate fixture validation from actual local Qwen output and human review."""

import argparse
import asyncio
import json
from pathlib import Path
from uuid import uuid4

from .content import source_notes, validate_deck
from .service import PresentationService
from .storage import PresentationStore


async def evaluate(live: bool, output: Path) -> int:
    directory = output / (("live-" if live else "fixture-") + uuid4().hex[:12])
    directory.mkdir(parents=True, exist_ok=True)
    service = PresentationService(
        PresentationStore(directory / "evaluation.sqlite3"), None
    )
    report = {
        "mode": "live_ollama" if live else "deterministic_fixture",
        "input_provenance": "Isolated synthetic demo, never BMW financial forecasts",
        "model": service.writer.model if live else None,
        "automatic_checks": {},
        "manual_review": {
            "argument_quality": "PENDING: Does the argument connect customer needs, evidence, alternatives and the funding decision?",
            "evidence_fidelity": "PENDING: Check every assertion against the frozen sources; does it preserve scope, synthetic labels and unknowns?",
            "objections": "PENDING: Are consequential engineering/finance objections and stop conditions clearly addressed?",
            "audience_fit": "PENDING: Can an executive understand the decision within the meeting duration?",
            "persuasive_restraint": "PENDING: No invented prevalence, competitive superiority, revenue or budget authorization.",
        },
    }
    try:
        if live and not (await service.writer.health())["available"]:
            report["status"] = "unavailable"
            report["reason"] = (
                "Configured Ollama model unavailable. Start ollama serve and install the configured model. No fixture fallback used."
            )
            return 2
        p = service.create("isolated_demo", "evaluation")
        if live:
            # Evaluation deliberately uses synthetic inputs with a real provider.
            # It never relabels these sources as live BMW records.
            p.mode = "ollama"
            service.store.save(p)
        for operation in ("outline", "slides"):
            if operation == "slides":
                p = service.approve_outline(p.id, p.revision, p.outline)
            p = service.start_job(p.id, p.revision, operation, "executive", operation)
            await asyncio.gather(*list(service.tasks.values()))
            p = service.store.get(p.id)
            if p.jobs[-1].status != "complete":
                report["status"], report["error"] = "failed", p.jobs[-1].error
                (directory / "checkpoints.json").write_text(p.model_dump_json(indent=2))
                return 1
        deck = p.decks["executive"]
        validate_deck(p, deck)
        report["automatic_checks"] = {
            "approved_only": {d.id for d in p.snapshot.decisions}
            == {"REQ-001", "REQ-002", "REQ-006"},
            "all_decisions_covered": {i for s in deck.slides for i in s.decision_ids}
            == {d.id for d in p.snapshot.decisions},
            "synthetic_disclosed": all(
                s.synthetic and "SYNTHETIC DEMO" in source_notes(p, s)
                for s in deck.slides
            ),
            "financial_case_consistent": p.business_case.scenarios[1].net_value
            == 2_100_000,
            "slide_count": len(deck.slides),
        }
        report["review_findings"] = p.review_findings
        report["status"] = (
            "generated_for_human_review" if live else "fixture_checks_passed"
        )
        (directory / "presentation.json").write_text(p.model_dump_json(indent=2))
        (directory / "speaker-notes.txt").write_text(
            "\n\n".join(source_notes(p, s) for s in deck.slides)
        )
        return 0
    finally:
        (directory / "report.json").write_text(json.dumps(report, indent=2))
        print(f"{report.get('status', 'interrupted')}: {directory / 'report.json'}")
        await service.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--live",
        action="store_true",
        help="Use actual Ollama; never silently use fixtures",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[2]
        / "private-data"
        / "presentation-evaluations",
    )
    args = parser.parse_args()
    raise SystemExit(asyncio.run(evaluate(args.live, args.output)))


if __name__ == "__main__":
    main()
