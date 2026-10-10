# BMW NEXT local agent backend

The competitor agent runs **real Ollama inference** over a private local evidence
index. The Competitors page and PM-triggered council use this backend. Other
platform modules still use their separate demo adapter. Competitor analysis
never starts a council automatically.

## Start (repository root, Python 3.11+)

```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
```

Install Ollama from https://ollama.com/download or `brew install ollama` on macOS.
In one terminal:

```bash
ollama serve
```

In another terminal, download the team's model once and build the evidence index:

```bash
ollama pull qwen3:8b
python -m backend.ingest --data-dir /Users/shaur/TUM/BMWHack/BMW-Data
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
on a laptop; it has a 360-second total budget and a 120-second per-model-call
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
- Sales and customer-study workbooks are not ingested by this first version.
  G68 remains distinct from G60; no G68 data is silently merged.
- `backend/data/` holds private indexes and runs and is gitignored. Raw source
  data, local `.env`, model files and Python environments must stay untracked.

## Team integration

Standalone specialists use `run(AgentRequest) -> AgentResult`. The live council
uses bounded `turn(stage, context, sources, prior) -> CouncilTurn` adapters in
`council/participants.py`; detailed integration instructions are below.
Competitor research and council reuse one persisted source run, scope, model and
immutable proposal version. These local endpoints are not production auth.

## Checks and errors

```bash
python -m unittest discover -s backend/tests -v
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

## Live page and council integration (10 October 2026)

The Competitors page now calls the real backend. Choose a brand, model and feature,
then **Analyze this feature**. The page uses `/api/competitor/sources` and
`/api/competitor/status`, submits `POST /api/competitor/jobs`, and polls
`GET /api/jobs/{id}`. It never silently substitutes demo output on failure.
The browser stores job UUIDs and brand/model/feature selection; results and private excerpts remain in the
ignored local `backend/data/runs` directory (and in the active page's memory).

Run the single backend worker from the repository root:

```sh
ollama serve
backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001
npm run dev -- --port 5173
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
The council reuses the original competitor position, collects independent
Customer and Market positions, asks a targeted Customer challenge, generates the
Competitor revision, and obtains the Judge assessment. Factual council claims select exact sourced statements; explicit uncertainty options
are defined by the backend. Claim IDs, citations and response targets are checked;
a separate Qwen pass checks the generated arguments/questions with one repair maximum. All are fallible AI outputs requiring PM review.

All participants use the same `OLLAMA_MODEL` (default `qwen3:8b`). Customer and
Market are **local starter role adapters**, not the teammates' future agents.
Market has no sales/adoption/causal outcome data and must abstain from success
percentages. BMW raw equipment tables do not yet establish exact trim absence.
A zero or unknown gap must not become an invented competitive weakness.

The source run, request and finished debate are persisted through the job
snapshot. Client-generated job UUIDs are saved before submission and duplicate requests are
idempotent. Refresh resumes polling; leaving the page does not cancel inference.
A backend restart marks an unfinished job interrupted, requiring an explicit
new run. A failed validation is visible as failed, never completed. Only one
analysis/debate runs at a time. The synchronous analysis route remains available
for scripts. No council is started by page mount or standalone analysis.
Council calls allow at least 240 seconds per model response, with a 15-minute
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
only at `/council?demo=1`. Other platform pages/exports still use their demo
adapter and do not automatically include live council decisions.

Tests:

```sh
backend/.venv/bin/python -m unittest discover -s backend/tests -v
npm test
# Backend and Ollama must already be running; invokes real inference:
LIVE_OLLAMA=1 npx playwright test tests/e2e/live-agent.spec.ts
```
