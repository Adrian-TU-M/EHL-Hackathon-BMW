# Market Trends agent

The Market page uses a real local `qwen3:8b` agent and dated evidence, with no
successful-result fallback. Industry trends include technology adoption, charging,
digital experiences and regional demand. They do not imply that every announced
feature is popular, or that copying it will increase BMW sales.

## Run on the team laptop

From the repository root, follow the Python/Ollama setup in [README](README.md), then:

```sh
# Start Ollama only if it is not already running; download the model only once.
ollama serve
ollama pull qwen3:8b
# Use your own location for the supplied private BMW-Data directory.
backend/.venv/bin/python -m backend.ingest --data-dir /Users/shaur/TUM/BMWHack/BMW-Data
backend/.venv/bin/python -m backend.market.ingest --data-dir /Users/shaur/TUM/BMWHack/BMW-Data
backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001
# In another terminal:
npm run dev -- --port 5173
```

Open **http://127.0.0.1:5173/market**. Use this address in Edge too. On this laptop,
`localhost:5173` can resolve to a different project listening on IPv6.
`/api/market/status` reports model name, digest, Ollama address, readiness and
busy state. All roles share `OLLAMA_MODEL` and one inference lock. Run one backend
worker. A branch contains agent code; it does not run its own model server.

## Evidence and screen

The screen is one blue-and-white workspace: the selected industry signal beside
the agent recommendation. Benefit, Trade-off and Validate tabs keep the response
compact; BMW regional context, model-volume inputs and provenance are expandable. Select Europe, China or the United States and a topic.
A single chart switches between Group history and supplied model inputs; 2030
is displayed separately as an assumption, never as observed history. Expanded
source sections include original links, periods, workbook cells and caveats.
Animations respect reduced-motion preferences; the layout supports mobile.

The checked-in `evidence/market.json` contains 23 curated records, nine macro signals and seven feature themes,
reviewed on 10 October 2026. The importer adds nine model/region records from
`sales_volumes.xlsx` to the private, ignored `backend/data/market.json` index.
The study importer adds 34 scoped study items when the supplied customer-study workbook is present. There are 66 records and 12 series after a complete import. Source material:

- BMW Group Report 2025, supplied PDF: page 78 regional Group deliveries for
  2021–2025; page 77 global BEV/PHEV deliveries. Group includes BMW, MINI and
  Rolls-Royce. The regional table is rounded; calculated growth can differ from
  reported growth. Public entry: https://www.bmwgroup.com/en/report/2025/index.html
- `sales_volumes.xlsx`: F70, G60_G68 and G70, 2024/2025 inputs plus 2030 assumptions.
  G60/G68 stays combined. There is no powertrain breakdown. Zero is not proof of
  absent demand. These supplied inputs are not independently verified sales.
- ACEA, published 24 September 2026: EU January–August registrations. EU is narrower
  than Europe, and this is all-market data, not the BMW premium segment.
  https://www.acea.auto/pc-registrations/new-car-registrations-5-3-in-august-2026-year-to-date-battery-electric-21-7-market-share/
- IEA Global EV Outlook 2026, published 20 May 2026: 2025 electric-car shares,
  charging infrastructure and battery context. Electric-car share includes BEV
  and PHEV; it is not interchangeable with a BEV-only measure.
  https://www.iea.org/reports/global-ev-outlook-2026
- BMW's January 2026 Alexa+ announcement: a planned digital experience, not measured
  rollout, uptake or satisfaction. The source URL and country limits are in the catalog.

Customer feedback is optional counterevidence from the existing private index.
Individual comments have no representative prevalence or market-share denominator.
The supplied customer studies are now ingested as model/region-specific context:
30 CN/EU means across controls, infotainment, navigation, efficiency and connected
services; four US navigation/screen-interface response distributions. Cell references
and file hashes preserve provenance. G68 is never relabelled G60. CN/EU rating scales
and sample sizes are unknown: raw means cannot establish high/low satisfaction.
US ordinal shares are not comparable with those means. Neither is a time series.

The default Feature trends tab covers AI assistants, cockpit usability,
bidirectional energy, software updates, charging journeys, driver assistance and
battery swapping. Sources include BMW, Volkswagen, Volvo, Mercedes-Benz, NIO and
Euro NCAP. Their rollout/announcement/rating/usage labels are not popularity scores.
International examples retain their actual geography; they do not imply availability
in the selected BMW market. April 2026 Volvo rollout starts do not prove completion.

**Check online sources** in the expanded evidence panel fetches approved publisher
pages, obeys robots policies, bounds response sizes/time, refuses redirects, and
checks expected text anchors. HTML and short PDFs are supported. Results, hashes
and retrieval dates live in ignored `backend/data/market-source-checks.json`.
A successful fetch never renews a review date or constitutes factual verification.
Missing anchors withhold the source from new agent retrieval pending review;
blocked/unavailable fetches leave the last reviewed snapshot and report the error.
There is no open-ended crawler or automatic claim approval.

```sh
backend/.venv/bin/python -m backend.market.refresh bmw-panoramic ncap-hmi-2026
```

API: `POST /api/market/sources/check?feature_id=cockpit` checks sources for an approved
feature only. Requests accept catalog IDs, not arbitrary URLs.

Sources are curated snapshots, not an autonomous news feed. To refresh, inspect
primary sources, update the catalog's exact measure, geography, period, limitations,
verification/review dates and signal fields, then rerun the importer. Industry
signals become ineligible after their review date (initially 9 November 2026).
Rebuilding an index alone does not renew source verification. Historical Group
series remain historical. Missing topic/region coverage is shown explicitly.

## Agent workflow

1. Read scoped, dated market evidence, the selected `feature_id`, matching studies and feedback. Python calculates growth, not Qwen.
2. Qwen may search and read the catalog through two bounded research rounds, at most
   four calls. Tools cannot access arbitrary paths or URLs. Include available
   customer counterevidence and source limitations.
3. Produce one proposed investigation, possible benefit, risk, opposing argument
   and validation step. Facts select source IDs and are hydrated from source text.
   Generated interpretations are separate; benefits are hypotheses, not success rates.
4. Validate citation IDs and numeric assertions. A separate Qwen grounding review
   checks populations, periods and causality. Allow one repair, then fail visibly.
   Model interpretation and model review can still be wrong; PM review matters.
5. Save the immutable result and evidence snapshot. The browser retains the job
   UUID and selected filters. Reloading resumes the same job, without starting
   duplicate inference. Backend restarts mark unfinished jobs interrupted.

API: `GET /api/market/dashboard`, `GET /api/market/status`,
`POST /api/market/jobs`, `GET /api/market/runs/{run_id}`. Jobs use shared
`GET /api/jobs/{job_id}`. Feature analysis must cite a source from its selected theme. Its `feature_id` persists
into council context and result matching; switching features hides unrelated results.
The standalone request adds `market_topic` and optional `feature_id` to
`AgentRequest`; see `/docs` for the full schema.

## Council and team integration

**Bring to council** opens the saved proposal. Only the PM's **Start live debate**
button invokes the coordinator. It checks the saved scope, model, proposal version
and evidence freshness before inference. A Market-led debate has six turns:

1. Saved Market position.
2. Independent Customer position.
3. Independent Competitor position.
4. Customer challenges an actual Market claim by ID.
5. Market answers the challenged claim(s), conceding or defending with evidence.
6. Judge assesses the disagreement; the outcome awaits PM review.

For Competitor-led proposals the Market agent supplies an independent position
and the challenge. Market uses the same evidence agent in both paths. Stage-specific
JSON constraints prevent revisions from opening new challenges. Referenced claims
must exist, and revisions must answer all claims challenged against Market.
No automatic council run, feature approval, forecast uplift or commercial-success
probability is produced.

Customer, Competitor and Judge council adapters perform real local Qwen inference,
but teammates' separate implementations have not been merged into this branch.
Replace their factories in `backend/council/participants.py` with adapters exposing
`turn(stage, context, sources, prior) -> CouncilTurn`. Preserve source validation,
actual peer references, shared `Settings`/model and the PM trigger. Missing peer
coverage must yield an explicit limitation, not invented evidence. Both private
indexes are needed for the full council; standalone Market can run without the
customer/competitor index. Other platform pages still have demo data.

## Verification

```sh
backend/.venv/bin/python -m unittest discover -s backend/tests -v
npm test
npm run build
# Running backend + indexes + Ollama required. Exercises real model calls:
LIVE_OLLAMA=1 npx playwright test tests/e2e/market-live.spec.ts
# Omit LIVE_OLLAMA for the data/UI portion without model inference.
```

The browser check covers source/region switching, missing coverage, separating
2030 assumptions, mobile overflow, reduced motion, analysis reload recovery,
explicit PM-triggered debate, six actual turns and reopening a saved debate.
Private inputs, generated indexes/runs, `.env` and model weights stay untracked.


## Failed-run recovery

`POST /api/market/jobs/{job_id}/retry` retries a failed Market analysis with its
original scope and feature. The old job retains its error and links to a fresh
attempt via `retry_job_id`; page reloads follow that link. Repeated requests to
retry the same job return its linked attempt instead of starting duplicate work.
The UI offers Retry analysis and keeps diagnostic text in a disclosure.

Numerical validation excludes exact cited source identifiers (including their
numeric hash fragments), accepts source publication dates and normalizes numeric
formatting. Unsupported measurements still fail validation. Negated study
limitations are distinguished from positive satisfaction claims. Regression tests
cover citation IDs containing digits, publication dates, numeric formatting,
unsupported percentages, negation and preservation of failed-run history.
