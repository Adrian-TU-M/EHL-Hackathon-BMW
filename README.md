# BMW NEXT — AI Product Intelligence

Unofficial EHL × BMW hackathon prototype. The moderator prepares evidence-grounded agendas and orchestrates Customer, Market Trends and Competitor specialists, then gives a judge traceable evidence, dissent and unknowns. The PM confirms the agenda once and reviews versioned outcomes while subsequent topics advance automatically.

[PROJECT_SPEC.md](PROJECT_SPEC.md) contains the product specification. [backend/README.md](backend/README.md) defines moderator APIs and team service contracts.

## Run locally

Use Node.js 22.12+ and Python 3.11+. From the repository root:

```sh
npm ci
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.lock
```

The source collection lives in ignored `private-data/inputs/`. Supply these exact filenames:

```text
F70_feedback_hackathon.xlsx
G60_feedback_hackathon.xlsx
G70_feedback_hackathon.xlsx
F70_G60_G68_G70_customer_studies.xlsx
sales_volumes.xlsx
F70_OptionList.PDF
G60_OptionList.PDF
G70_OptionList.PDF
BMW-Group-Report-2025-en.pdf
```

Ingest privately, then start the backend and frontend in separate terminals:

```sh
npm run ingest:moderator
npm run dev:moderator:demo
npm run dev
```

Vite normally serves http://127.0.0.1:5173 and proxies `/api/moderator` to localhost:8000. `MODERATOR_API_URL` overrides the development proxy. Run one backend worker. The default backend data directory is `private-data`; `MODERATOR_DATA_DIR` overrides it. Neither raw source text nor extracted catalogs should enter Git or public assets.

`dev:moderator:demo` explicitly uses deterministic integration adapters: they quote sources and exercise workflow gates but do not generate final requirement scores. To use the team's live services, configure the five `*_AGENT_URL` variables in [backend/.env.example](backend/.env.example), then run `npm run dev:moderator`. Missing live configuration is shown as unavailable, with no silent scripted fallback. The specialist reasoning and final judge rubric are outside this implementation.

The other dashboard pages retain their synthetic analysis and versioned demo requirements. The council's source-backed outcomes are clearly separate. The frontend can still explore those dashboard pages without confidential data or a backend.

## Council workflow

1. Prepare an agenda from scoped feedback, studies, equipment and strategic evidence. Review the six proposed questions and complete explained backlog; select or pin topics and confirm once.
2. The moderator opens a neutral brief and gathers the three positions concurrently, without sharing openings beforehand. Specialists receive their own evidence domain plus permitted product/corporate context.
3. Deterministic source/scope/calculation checks and a separate semantic checker assess claims. All three specialists get one challenge opportunity; challenges are collected before consolidated rebuttals. Unsupported replies cannot declare a verified resolution.
4. The judge assesses the complete packet. One specific, material clarification is allowed only when the identified specialist can answer from authorized evidence. Missing peer research is disclosed rather than filled with speculation.
5. Topics close as completed, insufficient evidence, unresolved disagreement, budget exhausted or PM stopped. Agreement does not decide closure. Outcomes queue for human review; the moderator advances automatically without approving requirements.

Pause/resume, interrupt, challenge, skip, reorder remaining topics and finish are available. Reconnection replays ordered events and deduplicates IDs. Server restart pauses recoverable work; completed records and frozen catalogs persist in SQLite. An exhausted topic requires a linked new run rather than a renewed budget.

Agenda weights are need 40%, severity 35%, future relevance 20%, verified competitive gap 5%. Each assessment carries rationale and source IDs; unknown factors retain their possible score range. This is separate from the judge's final requirement scoring. Keyword severity screening is provisional; PM substantiation or a pin is needed to place an issue ahead of ordinary score order.

Assumptions are versioned conditional scenarios with dependencies and validation needs. Changing one invalidates only dependent assessments, retains history and reopens human review. Unknown information, methodological limitations, PM preferences and source forecasts stay distinct from assumptions.

## Sources outside Drive

External sources are allowed following the organizer clarification. Use **Import external source** in the council to capture a public HTTPS HTML, plain-text or PDF document with publisher, domain, scope, declared quality and publication date when known. Source hashes, immutable extracted passages, retrieval time and exact locators are retained privately. Imported content is evidence, never an instruction.

New imports become available to new agendas. Confirmed discussions keep their original source snapshot. Official OEM documentation, official statistics and original research provide stronger provenance than unsupported comparisons; declaring a page primary does not independently verify its claims. A peer page alone cannot establish a verified competitive gap without an equivalent BMW/peer configuration comparison.

The initial feedback collection has no China observations. G60/G70 feedback is predominantly US. EU studies and geographic Europe remain distinct; G68 is not G60. US study totals of one are normalized proportions, not respondent counts. The rating scale and respondent counts remain unknown. G60/G68 sales remain grouped; 2030 values are supplied future figures. Zero sales do not prove model unavailability.

Selected standard-equipment PDF matrices retain native row/column/glyph references and German derivatives. Optional/package tables remain unverified page context. Annual-report retrieval focuses on pages 42–46, 53–57, 77–81 and 262–265; strategy investment establishes alignment rather than feature demand or engineering feasibility.

## Validation and evaluation

```sh
npm test                       # Frontend domain/state/export tests
npm run test:moderator          # Workflow, source, boundary and private lineage tests
npm run build                  # TypeScript and production bundle
npm run test:e2e                # Dedicated synthetic FastAPI fixture + Chrome UI tests
npm run eval:moderator          # Same-opening baseline vs moderated artifacts
```

Browser tests require installed Google Chrome and the Python environment above. They use ports 8001/5175 and synthetic fixtures; no private collection or live models are needed. Private-data tests skip when the collection is absent. Screenshots, traces and downloads go to ignored `test-results/`.

The evaluation harness has seven cases spanning vehicles/markets, sparse evidence, mixed signals and material transfer risks. It assesses the exact same independent openings in a separate judge-only baseline run, records both packets/assessments, and measures traceability and disagreement retention. PM issue-coverage and review-effort judgments remain pending. Deterministic integration success does not establish improved AI decision quality. Live evaluation setup is in [backend/README.md](backend/README.md).

## Export and boundaries

**Export versioned records** downloads canonical JSON: frozen agenda, original positions, claims, challenges/rebuttals, assumptions/history, outcomes, human decisions and ordered events. The workspace PDF adds moderator summaries and review history to the synthetic dashboard report. JSON is the complete reconstructable record; source IDs resolve to the private frozen catalog.

Production authentication, deployment, distributed workers and immutable enterprise audit infrastructure remain outside scope. Local services and the browser are trusted development participants; capability-scoped retrieval restricts the evidence offered to specialist adapters, while local PM endpoints expose the authorized inventory. Scanned PDFs, JavaScript-only pages and optional-equipment matrices need additional verified extraction.

BMW reference images and optional Sketchfab embeds are documented in [ASSETS.md](ASSETS.md). They are reference media, not verified CAD or a driving simulation. The large Three.js build chunk remains lazy-loaded.
