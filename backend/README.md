# Python Judge Agent

The Judge evaluates moderator-supplied statements and evidence. It does not own
retrieval or the three specialists. Python computes influence and priority;
the configured model supplies structured, validated assessments.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e './backend[test]'
JUDGE_DEMO_MODE=1 .venv/bin/python -m uvicorn judge.api:app --host 127.0.0.1 --port 8000
```

In a second terminal run `npm run dev`. Vite proxies `/api` to port 8000.
On Debian/Ubuntu, install `python3-venv` if creating the environment reports that
`ensurepip` is missing; the isolated environment needs its own pip installation.
Open Agent Council or Decisions & Scenarios and use the **Judge Agent** panel.
The existing scripted council remains separately labelled. Backend demo mode is
an explicit fixture: it conservatively defers features and reports unknown scores.

```bash
.venv/bin/python -m pytest backend/tests
```

FastAPI exposes its interactive contract at `http://127.0.0.1:8000/docs`.
Production frontend hosting needs the same `/api` reverse proxy; the Vite proxy
is development-only.

## Plug in your teammates' implementations

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
round is bounded to 120 seconds of active processing, each AI call to 65 seconds, and HTTP calls to
60 seconds. No unrestricted autonomous debate loop exists. PM waiting time does
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

This package provides real HTTP/AI-adapter execution, but no chosen provider or
teammate moderator is bundled. Unconfigured live adapters return 503 and never
fall back to fixtures. Real inference and retrieval must be tested with the team.

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
