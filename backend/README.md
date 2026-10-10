# BMW NEXT local agent backend

One FastAPI process now hosts Customer, Market Trends, Competitor, Moderator and Judge. All inference uses the shared `OLLAMA_BASE_URL` and `OLLAMA_MODEL` (default `http://127.0.0.1:11434`, `qwen3:8b`). Standalone analysis never starts a council automatically. Presentation generation remains excluded.

## Unified teammate quickstart

From your own repository checkout, with Node 22.12+, Python 3.11+ and Ollama installed:

```bash
npm ci
# First setup only: preserve an existing backend/.env and its key.
[ -f backend/.env ] || cp backend/.env.example backend/.env
# Default BMW_DATA_DIR uses the authorized files in private-data/inputs.
ollama pull qwen3:8b
npm run dev
```

Run `ollama serve` separately first if Ollama is not already running. `npm run dev` prepares the Python environment, builds **missing** `backend/data/evidence.json` and `backend/data/market.json`, and starts the unified backend on **127.0.0.1:8001** plus frontend on **127.0.0.1:5173**. Private inputs must include the three feedback workbooks, three option-list PDFs, sales workbook, customer studies and BMW Group 2025 annual report (the report may be in the parent directory). Setup reads these files without modifying them and preserves public-source verification dates; it does not scrape or call Qwen.

Existing private indexes are kept so saved proposals remain reproducible. After intentionally updating inputs or a reviewed catalog, run `npm run setup:backend -- --rebuild-indexes`, then restart the backend and create fresh analyses. Rebuilding can invalidate the evidence snapshots in earlier proposals. Missing inputs produce a setup error with the files required; no fabricated index is substituted.

Use `npm run dev:frontend` with an existing backend, or `npm run setup:backend` followed by `npm run dev:backend` for manual service management. Do not start the older specialist servers on competing ports. `BMW_PYTHON` can select a preconfigured interpreter; `JUDGE_PYTHON` remains a compatibility alias. Shell environment values take precedence over `backend/.env`, then root `.env`.

The legacy `dev:moderator` command now aliases the same unified backend on 8001. Only the explicitly named `dev:moderator:demo` command switches Judge/Moderator to deterministic fixtures; it also uses 8001. Never run these alongside an existing backend.

Optional Judge speech needs `ELEVENLABS_API_KEY` in `backend/.env`; `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL_ID` may also be set. Only the saved Judge text is sent for speech. Local inference and PM review do not require an ElevenLabs key. Keep secrets server-side and never use a `VITE_` API-key variable.

| Shared route prefix | Purpose |
| --- | --- |
| `/api/health` | Unified process health |
| `/customer-api/customer/*` | Customer aggregates, evidence, analysis and perspectives |
| `/customer-api/health` | Customer dataset and Ollama readiness |
| `/api/market/*` | Market dashboard, source checks and analysis jobs |
| `/api/competitor/*` | Competitor sources, readiness and analysis jobs |
| `/api/jobs/*`, `/api/council/debate` | Persisted jobs and PM-triggered saved-proposal debates |
| `/api/moderator/*` | Full-scope agenda, bounded live council and session review |
| `/api/judge/*` | Standalone Judge rubric API |
| `/api/review/*` | Persisted proposal-council assessment, PM decisions and discussion |
| `/api/voice/*` | ElevenLabs readiness and saved Judge narration |

Run all Python checks with `npm run test:backend`. The pytest configuration covers all backend modules; live-model tests are explicitly marked. Each laptop keeps its own private datasets, SQLite sessions, indexes, model files and API keys. Start one backend worker, not a worker pool.

`requirements.txt` is the unified dependency manifest used by `pyproject.toml` and setup. The old `requirements.lock` is now a compatibility redirect to that manifest, not a frozen lock; its former Moderator-only pins were incomplete for the merged agents.

## Start (repository root, Python 3.11+)

```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
[ -f backend/.env ] || cp backend/.env.example backend/.env
```

Install Ollama from https://ollama.com/download or `brew install ollama` on macOS.
In one terminal:

```bash
ollama serve
```

In another terminal, download the team's model once and build the evidence index:

```bash
ollama pull qwen3:8b
python -m backend.bootstrap
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001 --env-file backend/.env
```

Use your own data directory on another laptop. Rebuild the index after changing
source data or the curated catalog. No inference happens at server startup.
The Qwen download is about 5.2 GB. The adapter requests a 16,384-token context,
temperature 0.2, and disables thinking output. Use the same model and settings for
all agents. `/api/competitor/status` exposes the installed model digest so the
team can confirm the actual model build as well as its tag.

## Where Ollama runs and how to check it

On this laptop the Homebrew CLI is `/opt/homebrew/bin/ollama` (version 0.33.3
at installation). Model files are stored under `~/.ollama/models`, outside this
repository. We run `ollama serve` bound to `127.0.0.1:11434`; the backend on port
8001 calls that local service. No Ollama desktop app or login-start service was
installed. A Git branch contains agent code, not another Ollama instance.

```bash
command -v ollama            # where the CLI is installed
ollama list                 # downloaded models; qwen3:8b should appear
ollama ps                   # models currently loaded in memory
ollama run qwen3:8b          # optional direct chat with the model
ollama stop qwen3:8b         # unload the model when no agent is running
```

An empty `ollama ps` does not mean the model was deleted. Models can unload while
idle and load again for a request. If the CLI cannot connect, start `ollama serve`
in a terminal and leave it running; Ctrl+C there stops that server. Do not launch
a second server if port 11434 is already listening. No repeat download is needed.

The browser-friendly status JSON at `/api/competitor/status` distinguishes server
running, model installed, model loaded, backend busy, and evidence counts. It also
shows the configured Ollama address. Runtime readiness is not a guarantee of
evidence coverage for your topic. See [Ollama's CLI reference](https://docs.ollama.com/cli).

Open **http://127.0.0.1:8001/docs** to run the agent, or:

```bash
curl http://127.0.0.1:8001/api/competitor/status
curl -X POST http://127.0.0.1:8001/api/competitor/analyze \
  -H 'Content-Type: application/json' \
  -d '{"analysis_id":"display-demo","scope":{"vehicle":"G60","market":"Europe","powertrain":"Electric","horizon":4,"topic":"Displays"}}'
```

A successful response contains claims, recommendations, positive/negative
hypothetical effects, alternatives, uncertainties, cited evidence records and a
research activity log. Read it again at `/api/competitor/runs/{run_id}`. The log
records retrieval actions, not private reasoning. A run may take several minutes
on a laptop; it has a 360-second total budget and a 180-second default per-model-call
timeout, configurable in `.env`. A failed run is never replaced with fake results.

## How it works

1. Search equipment, feedback and official competitor records for the topic.
2. Qwen chooses additional searches or source reads (three rounds, six tool calls
   maximum). Retrieval is restricted to the request's BMW model, market and known
   powertrain. It can search for counterexamples as well as supporting evidence.
3. Request schema-constrained JSON. Check citation IDs against evidence actually
   retrieved, role identity, unique claim IDs, hypothetical effects, and debate
   target IDs. Each recommendation must cite both a currently reviewed competitor
   reference and BMW evidence. Factual claim text must be an exact quotation from
   a cited passage (allowing whitespace normalization). A separate skeptical Qwen
   pass checks the draft against only its cited sources for unsupported comparisons,
   fitment claims and redundant recommendations. Permit one repair; reject output
   that still fails, without saving it as a valid result.
4. Mark missing official competitor/BMW baseline coverage as insufficient evidence.
   Raw equipment-table excerpts also leave trim fitment unverified, so this first
   version returns conditional research proposals, not confirmed BMW feature gaps.
   Coverage/confidence statements, uncited-effect limitations and the conservative
   keep-current-equipment alternative are backend-derived while fitment is unknown.
   Persist the result and its evidence snapshot locally for consistent reuse.

Quotation/citation validation checks provenance and scope; the additional AI
grounding review can also make mistakes. Neither proves semantic truth. Review
interpretations and original documents before product decisions. Results are
conditional recommendations, not approved requirements or proven forecasts.

## Evidence and limitations

- `ingest.py` reads the three feedback workbooks and option-list PDFs in place.
  Classification duplicates are merged by feedback ID, exact comment, country and
  powertrain; categories and original cell locators are retained. It does not
  compute representative frequency estimates from this selected feedback.
- PDF excerpts retain page/character locations. Table symbols/trim columns and
  rotated text are not reliably decoded. The German July 2026 lists do not
  establish US/China fitment, and equipment availability still needs visual review.
- `evidence/competitors.json` contains **24 curated records from eleven official
  source pages**, checked on 10 October 2026: 23 current references and one
  explicitly historical 2024 Mercedes reference. See [the source audit](evidence/README.md).
  Country/year/trim caveats are retained. This remains limited coverage, especially
  for China, US brands beyond Tesla, and exact country/trim combinations.
- Each current reference has `verified_on` and `review_due_on` (a 30-day editorial
  review window). Search excludes historical, unreviewed, future-dated and overdue
  competitor records. Re-reading an old specification does not make it current.
  `/api/competitor/sources` exposes the source records, current eligibility and
  missing markets. The review deadline is a maintenance policy, not a claim that
  equipment stays unchanged until that date.
- Runtime research searches this catalog; it does not crawl the internet. Extend
  the catalog using `EvidenceRecord` fields and original official links, then
  rebuild. Do not label customer speculation as official competitor equipment.
- The separate Market importer reads sales_volumes.xlsx and preserves its combined
  G60_G68 grouping explicitly. The Market importer also reads 34 scoped items from the supplied 2025 customer-study workbook; means and ordinal shares stay separate. See [MARKET.md](MARKET.md) for feature sources and refresh checks.
- `backend/data/` holds private indexes and runs and is gitignored. The Moderator branch includes the team-authorized input files; additional raw data, local `.env`, model files and Python environments stay untracked.

## Team integration

Standalone specialists use `run(AgentRequest) -> AgentResult`. The live council
uses bounded `turn(stage, context, sources, prior) -> CouncilTurn` adapters in
`council/participants.py`; detailed integration instructions are below.
Competitor research and council reuse one persisted source run, scope, model and
immutable proposal version. These local endpoints are not production auth.

## Checks and errors

```bash
python -m pytest -q backend/tests
# Explicit real-model/API check after starting the server:
python -m backend.smoke --api-url http://127.0.0.1:8001
```

- 422: invalid input, scope/citation ID or debate sent to analysis.
- 409: a competitor run is already active.
- 503: evidence index or Ollama/model unavailable.
- 504: inference/run timed out.
- 502: invalid model output after a bounded repair.
- 202: asynchronous job accepted; poll its ID for running/succeeded/failed.
- 404: saved analysis or job does not exist.
- Job failures are persisted with an error; they are never rendered as successful output.

References: [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling),
[Ollama structured output](https://docs.ollama.com/capabilities/structured-outputs),
[Qwen3 8B](https://ollama.com/library/qwen3:8b).

## Live page and council integration

The integrated Competitor page calls this backend. Choose a brand, model and feature,
then **Analyze this feature**. The page uses `/api/competitor/sources` and
`/api/competitor/status`, submits `POST /api/competitor/jobs`, and polls
`GET /api/jobs/{id}`. It never silently substitutes demo output on failure.
The browser stores job UUIDs and brand/model/feature selection; results and private excerpts remain in the
ignored local `backend/data/runs` directory (and in the active page's memory).

Run the single backend worker from the repository root:

```sh
ollama serve
backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001
npm run dev:frontend
```

Vite proxies `/api` to loopback port 8001. For a separately hosted frontend,
configure `VITE_AGENT_API_URL` and the backend's explicit `FRONTEND_ORIGIN`;
loopback on a visitor's computer will not reach the team laptop. This is a local
single-worker hackathon deployment, not an authenticated shared production API.
Do not launch multiple workers: job ownership and inference locking are local.

**Bring to council** opens the exact saved analysis. Only **Start live debate**
posts `/api/council/debate` with `trigger: pm_requested`. A proposal is the
immutable analysis run UUID, version 1; the backend verifies analysis ID, scope,
model and source snapshot/freshness before generating debate statements.
The council reuses the saved Market or Competitor position, collects independent
peer positions, asks a targeted challenge (Customer challenges Market; Market
challenges Competitor), generates the lead agent revision, and obtains a Judge assessment. Factual council claims select exact sourced statements; explicit uncertainty options
are defined by the backend. Claim IDs, citations and response targets are checked;
a separate Qwen pass checks the generated arguments/questions with one repair maximum. All are fallible AI outputs requiring PM review.

All participants use the same `OLLAMA_MODEL` (default `qwen3:8b`). Customer uses its native scoped-feedback implementation, Market its evidence agent, Competitor its research and council contracts, Moderator the local orchestration adapter, and Judge the teammate scoring rubric. Customer citations are carried into the Judge input. The exact Judge request and assessment are saved for later PM review and narration. Market has dated sales/adoption evidence, but no causal feature-success measurement. BMW raw equipment tables do not yet establish exact trim absence.
A zero or unknown gap must not become an invented competitive weakness.

The source run, request and finished debate are persisted through the job
snapshot. Client-generated job UUIDs are saved before submission and duplicate requests are
idempotent. Refresh resumes polling; leaving the page does not cancel inference.
A backend restart marks an unfinished job interrupted, requiring an explicit
new run. A failed validation is visible as failed, never completed. Only one
analysis/debate runs at a time. The synchronous analysis route remains available
for scripts. No council is started by page mount or standalone analysis.
Council calls have bounded per-response timeouts, with a 30-minute
total debate bound. Drafts and grounding reviews have separate output limits.
Failed jobs retain the stage and error; timeouts never produce a completed debate.
Completed debates expose a saved link containing both the analysis and job UUIDs.

### Teammate integration

Replace the corresponding factory in `backend/council/participants.py`'s
`PARTICIPANTS` registry. Constructor receives shared `Settings`; implement:

```python
async def turn(stage, context, sources, prior) -> CouncilTurn:
    ...
```

Return the requested role/stage; claims have stable IDs, source IDs must resolve
against the provided scope, challenge targets must exist in prior turns, and
revision/judge turns identify answered claim IDs. Keep the grounding validator
or equivalent when replacing an adapter. Use the shared model configuration.
Never call the coordinator from an individual agent or make automatic PM decisions.
Frontend `/council` is live by default; the old scripted visualization exists
only at `/council?demo=1`. Decisions includes an inbox for persisted live reviews.
Scenario scoring and the existing PDF export still use their demo adapter and
do not automatically include live council decisions.

Tests:

```sh
backend/.venv/bin/python -m pytest -q backend/tests
npm test
# Backend and Ollama must already be running; invokes real inference:
LIVE_OLLAMA=1 npx playwright test tests/e2e/market-live.spec.ts
```
