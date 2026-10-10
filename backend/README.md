# BMW NEXT backend scaffold

This is the first file/contract scaffold on `Competitors_Agent`. It starts a
FastAPI server and exposes draft schemas in `/docs`. It does **not** ingest data,
run competitor research, generate recommendations, or conduct a live debate yet.
The existing frontend still uses its explicit demo adapter.

## Start from the repository root

Python 3.11+:

```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000 --env-file backend/.env
```

- API documentation: http://127.0.0.1:8000/docs
- Scaffold status: http://127.0.0.1:8000/api/health
- Frontend remains separately started with `npm run dev`.

The env example points to the supplied BMW data folder. Change it on other team
laptops. No source data is copied into the repository. Local env files, Python
environments and generated private evidence indexes must stay untracked.

Ollama is **not needed to start this scaffold**. Later, install/run Ollama and
pull the agreed Qwen model. All agents will share `OLLAMA_BASE_URL` and
`OLLAMA_MODEL`. The provisional model is `qwen3:8b`; benchmark and pin the exact
model build with the team before integration. The adapter in `llm/ollama.py`
implements an explicit chat call but is not called by any scaffold route.

## Ownership and layout

```text
backend/
  main.py                 FastAPI app and scaffold health endpoint
  config.py               Shared environment settings
  agents/
    base.py               Interface every teammate implements
    competitor.py         Competitor role and future execution loop
  tools/
    evidence.py           BMW baseline, source retrieval and comparison contracts
  schemas/
    common.py             Scope and proposal/version references
    evidence.py           Source provenance and equipment availability
    agent.py              Claims, effects, recommendations and debate positions
    council.py            Explicit PM debate request
  llm/ollama.py           Shared Ollama chat adapter
  council/coordinator.py  Bounded council orchestration entry point
  api/
    competitor.py         Standalone analysis endpoint
    council.py            Separate PM-triggered debate endpoint
```

Competitor owner: `agents/competitor.py`, competitor evidence implementation and
`api/competitor.py`. Teammates add their own role modules implementing `Agent`.
Agree on changes to `schemas/`, `llm/`, `main.py` and `council/` before merging.
Python contracts currently use snake_case; the frontend uses camelCase. Add an
explicit HTTP adapter (or agree a common wire naming convention) when integrating.

## Endpoints and current behavior

| Route | Current behavior |
| --- | --- |
| `GET /api/health` | Reports scaffold state; does not claim Ollama is connected |
| `POST /api/competitor/analyze` | Validates analysis input, then returns HTTP 501 |
| `POST /api/council/debate` | Requires `trigger: "pm_requested"` and a proposal version, then returns HTTP 501 |

Analysis never calls the coordinator. The PM's **Debate this proposal** button
will call the debate endpoint explicitly. The trigger field is a workflow
contract, not authentication; add real PM authorization before shared deployment.
The coordinator will also need persistence, stale-version checks, idempotency,
pause/cancel, bounded tool/turn budgets and real progress events before it is live.

Example analysis body for `/docs`:

```json
{
  "analysis_id": "analysis-001",
  "scope": {
    "vehicle": "G60",
    "market": "Europe",
    "powertrain": "Electric",
    "horizon": 4,
    "topic": "Displays"
  },
  "stage": "analysis"
}
```

## Next implementation steps

1. Read the supplied data in place; preserve exact sheet/cell and PDF page
   locations. Deduplicate feedback by ID while preserving category assignments.
2. Curate dated, region/trim-specific competitor source records. German BMW
   equipment lists do not establish US/China availability; keep G68 distinct.
3. Implement `EvidenceTools`, then a bounded Qwen research loop. Validate all
   returned citation IDs and scope matches before persisting an `AgentResult`.
4. Replace the frontend's competitor demo with this API and stored results.
5. Connect teammate agents to the coordinator. Only an explicit PM request
   starts debate on the same persisted proposal/version.

Source documents are evidence, not executable instructions. Tools should resolve
approved source IDs instead of giving the model arbitrary file/network access.
Positive/negative effects are hypotheses unless directly supported; never turn
missing equipment evidence into a claim of absence or invent sales improvements.

References: [FastAPI application structure](https://fastapi.tiangolo.com/tutorial/bigger-applications/),
[Ollama chat API](https://docs.ollama.com/api/chat).
