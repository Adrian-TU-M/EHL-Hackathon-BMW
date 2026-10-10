# Python Judge Agent

The Judge evaluates current supplied context or moderator-supplied statements and evidence. It does not own
retrieval or the three specialists. Python computes influence and priority;
the configured model supplies structured, validated assessments.

## Run locally

From the repository root (Node 22.12+ and Python 3.11+), run:

```bash
ollama pull qwen3:4b-instruct
npm ci
npm run dev
```

Install [Ollama](https://ollama.com/download) first. Open its desktop app, or run
`ollama serve` in another terminal, before pulling the model. The Judge uses local
Qwen by default; it does not require an OpenAI key. The model download is separate
from installing Python dependencies.

`dev` creates `backend/.venv` and installs missing Python
dependencies on first run. You can perform just that step with
`npm run setup:backend`. It starts FastAPI with real model inference, waits for
its health endpoint, and starts Vite at http://127.0.0.1:5173. Ctrl+C stops both.
Use `npm run dev:demo` only for explicit fixtures. Use `npm run dev:full` with
your teammates' moderator gateway for the full debate. Set `JUDGE_PYTHON` if your
installed Python environment is elsewhere. The launcher loads server variables
from `backend/.env` and `.env` without overriding exported environment variables.
To use a backend you already started, run
`npm run dev:frontend` instead. Do not run two backends on port 8000.

You can also start the services separately:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -e './backend[test]'
JUDGE_DEMO_MODE=1 backend/.venv/bin/python -m uvicorn judge.api:app --host 127.0.0.1 --port 8000
```

In a second terminal run `npm run dev:frontend`. Vite proxies `/api` to port 8000.
On Debian/Ubuntu, install `python3-venv` if creating the environment reports that
`ensurepip` is missing; the isolated environment needs its own pip installation.
Open Agent Council or Decisions & Scenarios and use the **Judge Agent** panel.
The existing scripted council remains separately labelled. Backend demo mode is
an explicit fixture: it conservatively defers features and reports unknown scores.

```bash
backend/.venv/bin/python -m pytest backend/tests
```

FastAPI exposes its interactive contract at `http://127.0.0.1:8000/docs`.
Production frontend hosting needs the same `/api` reverse proxy; the Vite proxy
is development-only.

## Qwen configuration

`npm run dev` uses `qwen3:4b-instruct` through Ollama's native structured-output API
at `http://127.0.0.1:11434`. FastAPI sends the current background, linked evidence,
features, priorities and PM messages to that local model. Python validates the
response and computes the scores. It never falls back to OpenAI or fixtures.

Copy `backend/.env.example` to an ignored `backend/.env` to customize:

```dotenv
JUDGE_INPUT_MODE=context
JUDGE_BASE_URL=http://127.0.0.1:11434
JUDGE_MODEL=qwen3:4b-instruct
JUDGE_API_FORMAT=ollama
JUDGE_MODEL_TIMEOUT_SECONDS=300
```

Pull whichever model you configure with `ollama pull <model-name>`. The launcher
and Judge panel report a missing Ollama server or model with setup instructions.
`/health` exposes the configured model, provider and `model_ready`; it checks model
installation, not inference quality. No project content is sent by this check.
Reload the panel after starting Ollama or pulling a model, and restart `npm run dev`
after changing configuration. Exported environment variables override `.env`.

Until teammate agents are connected, `JUDGE_INPUT_MODE=context` evaluates the app's
current evidence statements directly. It does not impersonate debate agents or
retrieve evidence. Each argument is linked to the feature and source that supplied
it. The PM can add project background and original source passages in the Judge
panel. Source changes increment the feature version, clear its approval and require
a new assessment. Background changes invalidate the whole council. Excluded sources
remain excluded. Approve/reject buttons open a rationale dialog and save a decision
for the reviewed assessment and feature version through FastAPI.

The seeded dataset remains synthetic. PM-supplied records are labelled `provided`,
not independently verified. A real external data endpoint must be specified by
the data team; no unknown endpoint is queried automatically.

For an existing vLLM or other Qwen server implementing the OpenAI-compatible chat protocol:

```dotenv
JUDGE_BASE_URL=http://127.0.0.1:9000/v1
JUDGE_MODEL=your-served-model-name
JUDGE_API_FORMAT=chat
# Only if the server requires JSON mode instead of strict JSON Schema:
# JUDGE_RESPONSE_FORMAT=json_object
```

This changes the backend adapter without frontend changes. Loopback inference needs
no external-processing approval. Set `JUDGE_API_KEY` only if that server requires it;
the OpenAI account credential is never forwarded to a different server. Non-loopback
inference requires PM approval per new council before any project payload is sent.
Run the model server on a different port from FastAPI (8000). Mocked integration tests
cover Qwen request/response handling, validation and PM decisions; a live model
installation is required for an actual inference test.

## Team adapters

Prefer importing `create_app(ai=team_ai, moderator=team_moderator,
repository=team_repository)` into the shared FastAPI backend. Implement the
`AIAdapter` and `ModeratorAdapter` protocols in `judge/adapters.py`. The model
returns `DraftAssessment`; the moderator returns `StageResult`. Models are in
`judge/models.py`, and the full Judge instruction is `SYSTEM_PROMPT`.

Alternatively set these server environment variables (leave demo mode unset):

- `JUDGE_MODEL_URL`: team AI gateway URL. It receives POST JSON with `system`,
  `input` (JudgeRequest), and `response_schema`; it returns a DraftAssessment
  JSON object directly. This is a team gateway contract, not a provider-specific API.
- `JUDGE_MODERATOR_URL`: team moderator URL. It receives POST JSON with `stage`
  and `request`; it returns a StageResult directly. Perspectives must contain
  customer, market, and competitor responses. The request includes the PM message
  or a targeted clarification, so responses must address it.
  A clarification stage permits at most one targeted specialist response.
- Optional `JUDGE_MODEL_TOKEN` and `JUDGE_MODERATOR_TOKEN`: server-side bearer
  tokens. Never put these in Vite variables or browser code.

The moderator owns specialist calls and evidence attachment/retrieval. It must
return unique argument IDs, immutable existing passages, and explicit provenance.
The wrapper freezes the feature snapshot; edits are proposals reviewed by the PM.
Missing sources remain evaluable as missing evidence, not fabricated citations.
Do not include private model chain-of-thought in published explanations.

## HTTP contracts

- `POST /analyses/{id}/judge-assessments`: evaluate a supplied debate snapshot.
- `POST /analyses/{id}/councils`: start manual or auto mode.
- `GET /councils/{id}`: retrieve the authoritative local backend snapshot.
- `POST /councils/{id}/control`: continue, pause, resume, or interrupt with an
  expected revision and PM rationale.
- `POST /councils/{id}/messages`: start a new bounded whole-council round with
  an idempotent message ID, expected revision, and content.
- `POST /councils/{id}/priorities/confirm`: apply the current proposed priorities
  with assessment ID, expected revision, and rationale.
- `POST /councils/{id}/decisions`: approve/reject/defer/edit a specific feature
  version after completion, with assessment ID, idempotent ID, and rationale.
- `GET /councils/{id}/events`: finite SSE replay plus latest snapshot; accepts
  `after` or `Last-Event-ID`. Reading/reconnecting never repeats a command.
- `GET /councils/{id}/audit`: local command and assessment audit.

Manual mode checkpoints follow the specified stages. Auto mode uses one
clarification, then pauses on unresolved consequential uncertainty. Each advancing
round is bounded to 120 seconds of active processing with the team gateways. Local
model HTTP calls default to 300 seconds, configurable with
`JUDGE_MODEL_TIMEOUT_SECONDS` (1–3600). Its call limit includes five seconds for
setup, and its round budget allows two calls plus ten seconds for stages (620 seconds
with the default). No unrestricted autonomous debate loop exists. PM waiting time does
not consume the processing budget. Whole-council follow-ups get a new bounded
round and remain serialized per council.

Support and relevance use anchored 0–5 ratings. Influence is support × relevance
÷ 5, never a probability. Feature priority uses the existing frontend rubric and
unknown-aware formula. Model-supplied calculated scores are overwritten. Exact
citations, attached-source membership, exclusions, feature versions, and argument
lineage are checked. Synthetic-only support is capped at 1 and cannot establish
a verified recommendation. Evidence support does not authenticate an original
source; source verification remains the moderator/data team's responsibility.

## Integration limits

This package defaults to local Qwen and also supports explicit OpenAI-compatible
model endpoints. The teammate moderator and retrieval are separate. Missing
servers/models/configuration return 503, absent external-processing approval for
remote models returns 403, and live failures never
fall back to fixtures. Real data ingestion still needs the team's data contract.

The repository is in-memory, single-process, and loses councils on restart. It is
for local integration, not durable or immutable audit storage. The team backend
must replace it with authenticated, transactional persistence, version-specific
decision records, and durable idempotency before a shared deployment. Run one
worker locally. Browser storage is a convenience snapshot; refresh retrieves the
backend's state, and a restarted backend requires a new council.

HTTP commands return a checkpoint snapshot when processing completes. SSE currently
replays committed events incrementally; it does not expose token streams or
uncommitted stage work. Cancelling the browser request stops waiting, but the
backend may finish it: refresh before issuing a subsequent command. **Stop council
processing** sends a backend interrupt, cancels the active adapter await, and
retains the last committed checkpoint. Moderator adapters should propagate
cancellation to their own specialist calls. A council creation has no committed ID
until its initial processing returns, so cancellation during creation stops the
browser wait; creating another run does not approve or mutate existing features.

The frontend's seeded evidence remains synthetic even when the Judge backend is
live. Real data ingestion is still a teammate responsibility. Changing local
priority sliders, excluding evidence, or starting a new analysis requires a new
Judge council. Proposed priorities confirmed in the Judge panel stay linked to
the existing run. Final review records approve/reject/defer/edit through FastAPI;
use council chat for challenges or additional evidence requests.
