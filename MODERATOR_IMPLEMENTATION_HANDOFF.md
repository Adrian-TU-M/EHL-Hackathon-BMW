# Moderator implementation status

Historical branch handoff: the unified integration now uses local Ollama adapters for all five agents. Use the current [backend quickstart](backend/README.md) for startup; the remote-service setup and unconnected-agent limitations below describe the original branch. `backend/requirements.lock` is now a compatibility redirect to the unified `requirements.txt`, not a frozen lock.

Updated 10 October 2026 after the user resumed implementation. The implementation was committed and pushed to `Moderator_Agent` as `15da8dd`. The user subsequently explicitly requested committing and pushing all nine initial source documents as well. Nothing has been deployed or sent as a message to other people.

## Current scope

The moderator is a Python/FastAPI workflow controller, integrated with the existing council UI. The latest user clarification **allows sources outside Drive**. The eight supplied Drive artifacts and Discord-supplied BMW annual report form the initial private collection; captured public HTTPS HTML/text/PDF imports can extend it. Imported text is untrusted evidence, never executable instructions. Confirmed agendas retain their original source snapshot.

Specialist reasoning, the judge's final requirement-scoring rubric, production deployment and unrelated dashboard redesign remain outside this implementation. The other dashboard pages continue to use labelled synthetic fixtures.

## Implemented

- Pydantic contracts for sources, evidence, agenda, positions, claims, challenges/rebuttals, assumptions, judge inputs/packets and outcomes.
- Private workbook/PDF ingestion, source hashes, row/page/column lineage, scoped evidence, deduplication and original-text retention. Selected German standard-equipment matrices retain derivative columns and explicit standard markers. Optional/package tables remain unverified context.
- Source-derived questions and explained backlog, eligibility first, six default topics, PM pins and source-supported severity substantiation. Ranking uses 40/35/20/5 weights with unknown-weight intervals, independently of judge requirement scores.
- Independent concurrent openings, deterministic checks plus separate semantic review, three simultaneous challenge opportunities, consolidated checked rebuttals, one conditional clarification and explicit abstention/dissent.
- Assumption versions/history/dependencies; changes invalidate dependent claims, alternatives or direct judge inputs without changing unrelated outcomes.
- Code-enforced workflow and budgets; explicit closure reasons; automatic next-topic advancement with human review queued separately.
- Typed HTTP adapters for five team services and explicit deterministic integration adapters. Missing live configuration is unavailable, never a silent fixture fallback.
- SQLite atomic checkpoints, events and command receipts; restart pauses recoverable sessions; cancellation, bounded repairs, expired stage capabilities and idempotent controls.
- Incremental SSE council UI, agenda/source/claim/assumption/disagreement cards, controls, version-specific human review, ordered audit detail, canonical JSON and workspace PDF summaries.
- External intake records publisher, declared quality, date/scope limitations and immutable locators. Identical reimports reuse snapshots; restart carries imports onto the latest supplied extraction while preserving historical snapshots.
- Seven-case evaluation harness: exact independent openings assessed in a separate judge-only baseline, compared with moderated packets using the same evidence. PM quality judgments remain pending.

## Validation

Run from the repository root:

```sh
npm test
npm run test:moderator
npm run build
npm run test:e2e
npm run eval:moderator
backend/.venv/bin/ruff check backend
```

Latest backend/domain checks: **52 backend tests and 10 frontend tests passed**; TypeScript/Vite build passed. The dedicated browser suite covers five flows using synthetic FastAPI fixtures, including confirmation, pause/challenge, reload/replay, sources, review and export. All five browser tests passed; the two council/mobile tests were rerun after the final contrast and source-form fixes and also passed. Existing Three.js chunk-size and Python/PyMuPDF SWIG deprecation warnings remain.

Private ingestion reproduces F70 **4,076 classification rows / 2,128 distinct feedback IDs**, G60 **5,005 / 4,000**, G70 **4,690 / 4,000**. All 206 US study distributions are normalized and keep unknown respondent counts. IDs are feedback observations, not unique customers. No China feedback was supplied; G60/G70 feedback is predominantly US. G60/G68 sales remain aggregated and 2030 figures remain future data.

Seven deterministic evaluation cases completed with separate baseline and moderated assessments. No accepted fabricated reference was recorded; original positions and consequential labelled disagreements were retained. These results validate fixture integration, **not AI decision quality**. PM issue-coverage/effort reviews and live-service evaluation are still required before claiming an improvement.

## Run and integrate

See `README.md`, `backend/README.md`, `backend/.env.example` and the authoritative moderator contract at the top of `PROJECT_SPEC.md`.

```sh
npm run dev:moderator:demo
npm run dev
```

Use one backend worker. For live mode set the five `*_AGENT_URL` values and optional matching bearer credentials, then run `npm run dev:moderator`. Set `MODERATOR_CONTROLLER_URL` if services need absolute evidence/packet URLs. Live evaluation starts a temporary evidence server on port 8002; remote services need a reachable `--controller-url`.

`backend/requirements.lock` pins the tested Python environment. The user explicitly authorized committing all nine initial documents under `private-data/inputs/`, including the annual report. `.gitignore` allows exactly those filenames; `backend/.venv/`, additional imports, extracted catalogs, SQLite and evaluation exports remain ignored. The annual report original is `/Users/jivitheshanagani/Downloads/BMW-Group-Report-2025-en.pdf`. Do not add further source documents or customer passages to fixtures/assets/Git without authorization.

## Honest limitations

- No live specialist/moderator/judge endpoints were configured or quality-tested. Deterministic adapters supply no final requirement score.
- Publisher quality is declared metadata. A peer page alone does not establish a verified competitive gap; agenda gap ratings remain unknown without a reviewed equivalent comparison.
- Equipment extraction verifies selected standard tables only. Scans, dynamic pages, optional/package matrices and mixed annual-report strategy passages need further verified interpretation.
- Annual-report strategy is alignment evidence, not independent proof of feature demand, engineering feasibility or sales uplift. The 2026 outlook is not a 2029–2031 forecast.
- Trusted local PM endpoints are not production authorization. Distributed workers and immutable enterprise auditing remain outside scope.
- PM-reviewed quality cases are pending actual PM review. No claim that this architecture is optimal has been made.

No subagents were spawned during continuation. Do not commit, push or deploy unless the user requests it.
