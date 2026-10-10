# Customer Agent (BMW NEXT)

Represents the customer perspective (spec §4.1) using **only** customer feedback and customer studies. It runs locally with **Ollama + `qwen3:8b`**, so confidential data never leaves the machine.

**Principle: the LLM interprets, code counts.** Qwen writes findings and council statements. Every number comes from deterministic code, and every citation is checked before it is returned.

## Setup

```bash
brew install ollama && brew services start ollama && ollama pull qwen3:8b
cd backend
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
```

Datasets stay outside the repo. Point `BMW_DATA_DIR` at them (default `~/DataSetsfromBMW`), either as an environment variable or in the repo-root `.env` (see `.env.example`).

## Run

```bash
.venv/bin/uvicorn customer_agent.api:app --host 127.0.0.1 --port 8001
curl http://127.0.0.1:8001/health
```

| Endpoint | LLM | Returns |
|---|---|---|
| `GET /health` | – | Ollama/model status, ingested sources, unmatched files, warnings |
| `GET /customer/coverage?vehicle&market&powertrain` | – | Rows vs unique records, polarity/powertrain/channel splits, study availability, available scopes, warnings |
| `GET /customer/themes?…&limit` | – | Ranked themes with `QuantitativeClaim`s, top subcategories, segments, linked study results |
| `GET /customer/evidence?…&theme&type&q&limit` | – | `Evidence[]` (original passages with file, row and ID) |
| `POST /customer/analysis` `{vehicle, market, powertrain?, horizon?, prompt?}` | yes (~40–70 s, cached) | Findings + cited evidence + coverage + themes |
| `POST /customer/perspective` `{scope, topic, stage, question?, challenge?}` | yes (~7–15 s) | One `CouncilEvent` (actor `customer`) for stage `perspectives`, `challenge` or `revision` |
| `POST /customer/reload` | – | Re-ingests after adding data or editing mappings |
| `GET /customer/dashboard?vehicle&market&powertrain&source&category` | – | Everything the Customer Intelligence page needs: KPIs with claims, rankings per raw feedback type (with Source C severity), category tree, segment splits, theme cross-check, full study table, filter options |
| `GET /customer/features?vehicle&market&powertrain` | – | Every feature (source category) ranked by unique records: `dislikes` (Defect, Difficult to Use) and `likes` (Likes, Wants), most mentioned first. Used by the Customer Intelligence page |
| `GET /customer/quotes?…&type&theme&q&offset&limit` | – | Paginated original feedback (`{total, offset, items}`) |
| `GET /customer/drilldown?…&type&theme` | – | Evidence drawer: claim, subcategories, linked study results, quotes |

`market`, `powertrain`, `source` and `category` accept `All`. The frontend reaches the API through the Vite proxy at `/customer-api` (override with `VITE_CUSTOMER_API_URL`, or the proxy target with `CUSTOMER_API_TARGET`).

`topic` may be a frontend `Topic` (`Displays`, `Charging`, …), a theme name (`Charging & range`), or a keyword. Response field names mirror `src/lib/types` (`Evidence`, `Finding`, `CouncilEvent`, `QuantitativeClaim`). Vehicles and markets are plain strings, because they come from the data. Errors: `422` invalid request, `503` Ollama unavailable, `502` unparseable model output.

### Integrating with the council (moderator/judge)
`perspective` is a single bounded call with no internal loops. The moderator's state machine decides when to call it: once in `perspectives`, once per `challenge`, and at most once in `revision`. `evidenceIds` contains feedback IDs (e.g. `G60-0148`) and study references (`STUDY:<sheet>:<row>:<vehicle>`). Resolve a feedback ID with `/customer/evidence?q=<id>` or from `analysis.evidence`.

## How it works

1. **Ingest** (`ingest.py`, `manifest.py`): files in `BMW_DATA_DIR` are matched against `datasets.yaml`. Only the kinds `feedback`, `study_means` and `study_distribution` are accepted, so sales and competitor files cannot be loaded (spec §4.6). Feedback is deduplicated on `ID`: one comment repeated across classification rows is **one record**.
2. **Normalize** (`mappings/*.yaml`): country → market, powertrain codes, feedback type → Complaint / Request / Positive, and category → theme.
3. **Stats** (`stats.py`): every count is a `QuantitativeClaim` with numerator, denominator, unit, source file, filters, market, period, method and limitations (spec §7).
4. **Synthesis** (`agent.py`): Qwen sees theme stats, study results and representative quotes, each labelled with its ID. Output is constrained by a JSON schema.
5. **Validation, in code:**
   - Citations must come from the quotes shown for that theme.
   - The record's source classification must fit the finding kind; a "Likes" record cannot support a complaint.
   - A second, temperature-0 Qwen pass checks that each quote actually says what the finding claims.
   - Numeric or frequency claims in model text are removed, and counts are attached from `stats`.
   - Findings left without a supporting quote are dropped. `droppedCitations` reports how many citations were removed.

## Adding new data (any vehicle, region or column layout)

- **New file, same layout:** drop it into `BMW_DATA_DIR`, then `POST /customer/reload`.
- **Different column names:** add an entry to `datasets.yaml` with a `columns:` mapping. Optional `customer_id` and `date` columns enable unique-customer counts and time frames.
- **No manifest entry:** a feedback CSV/XLSX with recognizable headers (`Comment`, `Feedback ID`, `Country`, …) is auto-detected. Anything else is listed under `unmatchedFiles`, never silently used.
- **New country or market:** add the code to `mappings/markets.yaml`. Unknown codes show up as `Unmapped:<code>` in warnings.
- **New categories:** add keywords to `mappings/themes.yaml`. Unmatched labels become their own theme and are never dropped.

## Tests

```bash
.venv/bin/pytest -q            # synthetic fixtures + checks on the supplied data (skipped if absent)
.venv/bin/pytest -q -m ollama  # live qwen3:8b call
```

The test fixtures are generated at test time; no BMW data is committed.

## Known limitations of the supplied data

- **No customer identifier:** unique customers cannot be counted. The agent reports unique feedback records and states this.
- **No feedback dates:** time frames are reported as unknown.
- **No China feedback:** China scopes use the CN study only, and the agent says so. F70 feedback is combustion-only.
- **No study sample sizes**, and studies are not split by powertrain.
- **Small scopes:** some scopes are small (G60 / Europe / Electric has 53 records), so findings there are few and flagged as thin.
- **Shares are not prevalence:** feedback is self-selected, so shares describe the supplied feedback, not all customers.
- **Fallible verification:** the verification pass is itself an LLM and can err. Findings remain subject to judge and PM review.
