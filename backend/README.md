# Moderator service contract

Local FastAPI controller, Pydantic contracts and SQLite persistence. Run one process/worker. The controller owns transitions, eligibility, calculations, budgets, source snapshots and closure gates. The team's services own specialist reasoning, semantic checking and judge scoring.

## HTTP agent adapters

Each configured `*_AGENT_URL` receives POST requests. Bearer tokens are optional per role. The controller supplies an idempotent request ID, operation, actor, trusted instructions, untrusted data, response JSON schema, output-token cap and total-token allowance. Services must bound **all** internal model calls/retrieval-assisted reasoning within that allowance and include their total usage in the response.

```json
{
  "operation": "perspective",
  "actor": "customer",
  "instructions": "Controller policy, separate from document content",
  "data": {
    "brief": {},
    "evidence": [],
    "evidence_access": "/api/moderator/retrieval/<capability>"
  },
  "response_schema": {},
  "request_id": "run:topic:stage:actor:operation:attempt",
  "max_output_tokens": 1500,
  "max_total_tokens": 12000
}
```

Return the schema-conforming object in `data`, with usage even when the reasoning abstains:

```json
{
  "data": {
    "actor": "customer",
    "summary": "No applicable source",
    "abstention_reason": "Evidence unavailable"
  },
  "usage": { "input_tokens": 250, "output_tokens": 60 }
}
```

Operations: moderator `agenda` → AgendaRefinement; specialists `perspective` → AgentPosition, `challenge` → ChallengeResponse, `rebuttal` → Rebuttal, `clarification` → ClarificationResponse; moderator `semantic_check` → SemanticReview; judge `assessment` → JudgeAssessment. See [models.py](moderator/models.py) for exact generated schemas. Claim/assumption/alternative IDs are namespaced by the controller after openings; subsequent requests carry those canonical IDs.

Each opening omits other positions. All challenge responses are collected before any rebuttal request. A challenge targets one foreign claim and states its consequence and answerable question. Explicit abstention is valid; timeout/malformed output is recorded as incomplete, not agreement. Rebuttal resolution requests are checked as claims before the final disposition.

Every judge scoring input is typed `sourced`, `inferred`, `assumed` or `unknown` with identifiable references/dependencies. Proposals have their own ID/version and references. The controller validates traceability but does not supply the judge rubric. Human review of an outcome is distinct from approval of a separately versioned requirement proposal.

Excerpts are a starting window. GET `evidence_access?offset=0` returns a paginated authorized index; POST the same capability with `{"ids":["..."]}` returns up to 100 exact records. Set `MODERATOR_CONTROLLER_URL` to an address reachable by agent services to receive absolute URLs; otherwise resolve relative URLs against the controller's address. Capabilities expire when the topic, stage or control generation changes. The judge can GET its `packet_access` for the complete original transcript/inventory; no summary replaces that packet. These are trusted local services, not a production authentication boundary.

## API

All routes are under `/api/moderator`; `/docs` exposes OpenAPI.

| Operation                   | Route                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Availability / provenance   | GET `/health`, GET `/inventory`                                                                                                              |
| Import outside-Drive source | POST `/sources/external`                                                                                                                     |
| Prepare agenda              | POST `/agendas` with `scope`, optional `parent_session_id`, optional `limits`                                                                |
| Confirm selection           | POST `/sessions/{id}/confirm` with `expected_version`, `selected_ids`, `pinned_ids`                                                          |
| Run/control                 | POST `/sessions/{id}/controls` with `action`, `expected_revision`, `idempotency_key`, optional `expected_topic_id`, `rationale`, `topic_ids` |
| Inspect state / outcomes    | GET `/sessions/{id}`, GET `/sessions/{id}/outcomes`                                                                                          |
| Ordered incremental events  | GET `/sessions/{id}/events?after=N`; SSE `id` / `Last-Event-ID` replay                                                                       |
| Human review                | POST `/sessions/{id}/outcomes/{topic}/review` with `expected_version`, `status`, `rationale`                                                 |
| Version assumption          | PATCH `/sessions/{id}/assumptions/{id}` with `expected_version`, `statement`, `status`, `rationale`                                          |
| Complete export             | GET `/sessions/{id}/export`                                                                                                                  |
| Exact frozen evidence       | GET `/evidence/{id}?source_snapshot=HASH`                                                                                                    |

Confirmation can also include `severity_substantiations`: each has `topic_id`, scoped `evidence_ids`, and a concrete rationale. Keyword severity screening alone never receives the severe-issue ordering override. Unknown competitive-gap ratings stay unknown until a properly verified equivalent comparison is available.

Start/resume never renews an exhausted topic. Limits default to 45 seconds/call, 300 active seconds/topic, 60,000 topic tokens and 20% reserved for assessment/closure. Session defaults are 1,800 active seconds and 360,000 tokens. Parallel calls share the stage wall clock. Input plus output capacity is reserved before calls; successful calls charge reported actual usage, cancelled/unreturned calls retain their conservative reservation. One malformed-output repair fits inside the same limits. Services exceeding their allowance terminate the bounded run path and are recorded explicitly.

The controller atomically commits agenda confirmation, stage publication, closure, human changes and modifying controls with their snapshots/events/command receipts. A crash retains the earlier checkpoint; restart pauses recoverable sessions and conservatively charges unfinished stage time. Late output cannot publish into a superseded stage. A scope/substantive preference change requires a newly confirmed linked agenda. Agenda refinement has a separate 45-second/output-capped call with a passed total-token allowance; unfinished calls retain their reservation in session usage.

## Source intake and limitations

Private Drive ingestion checks expected counts and preserves all original row classifications. Source text never executes instructions. External HTTPS HTML/text/PDF intake rejects redirects and local/private destinations, bounds retrieval size/time, hashes bytes, stores exact extracted locators, and leaves unspecified dates/populations unknown. Publisher quality is declared metadata, not proof of accuracy. Source additions do not change an existing confirmed snapshot; all historical catalogs persist privately.

Selected standard-equipment matrices use native PDF glyph/header coordinates. Blank cells never establish unavailability. Optional/package tables and scanned/image-only text remain unverified context. Annual-report pages preserve grouped families and tag broad result/outlook/mixed context; semantic validation must still distinguish individual targets/announcements on mixed pages. The checker is fallible and the UI exposes unsupported/unverified claims.

Use the evaluation harness from the repository root through `npm run eval:moderator`. It reuses exactly the same independent openings and frozen evidence in a separate judge-only baseline run, with no challenges or clarification, and saves both assessments and packets. Each baseline has its own budget and cannot modify the moderated run.

For live evaluation, from `backend/` run `.venv/bin/python -m moderator.evaluate --adapter http`. The harness serves evidence/packets on `127.0.0.1:8002` while it runs (`--host`/`--port` override). Remote services need `--controller-url` pointing to a reachable forwarding address. All case artifacts and baseline positions stay private. PM checklists and review-effort measurements are intentionally pending until actually reviewed; fixture results establish integration behavior only.
