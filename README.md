# ehlhackathonbmw

Our project for the EHL x BMW hackathon.

---

# BMW NEXT — AI Product Intelligence

An unofficial BMW challenge prototype: choose a vehicle and market, inspect source-linked evidence, watch a bounded AI council discussion, compare priorities, record version-specific human decisions, and export a real PDF.

Read [PROJECT_SPEC.md](PROJECT_SPEC.md) for the complete product specification, system architecture, user journey, team contracts and open questions. The original project introduction above is retained from the teammate's Entire README commit.

## Unified local agents

Customer, Market Trends, Competitor, Moderator and Judge now share **Ollama `qwen3:8b`** on one laptop. The Customer page uses supplied feedback and studies; Market and Competitor pages offer cited investigations. The council runs only when the PM requests it. The Judge applies its assessment rubric to the actual debate, and the PM retains the final decision.

Presentation generation is excluded. Decisions & Scenarios now shows the actual saved council verdicts, PM reviews, and what-if rankings of the same assessed criteria. The legacy demo portfolio is explicit at `/decisions?demo=1`; its PDF export remains separate. See [backend/README.md](backend/README.md) for routes and runtime details, and [backend/MARKET.md](backend/MARKET.md) for Market sources and limitations.

Open `/council` and choose **Start car debate**. One PM action freezes the selected vehicle scope and starts every evidence-supported Moderator topic automatically, without selecting an individual feature. The large interactive council table sits above a chronological transcript. **Talk to Jury** opens the original ElevenLabs conversation about the completed Qwen verdict; direct local-Qwen text discussion is also available; **Review decisions** opens those same results in Decisions & Scenarios. Saved councils reopen without starting inference. Advanced controls remain at `/council?advanced=1`. The latest native Controls debate completed all three specialist challenges, their replies and the real Judge assessment in **7 minutes** on this laptop. Timing varies with evidence, repairs and other Qwen work; full-car agendas run sequentially and can take much longer. This is local inference, not an instant scripted demo.

The original `JudgeConversationSession` from commits `627539b` / `54c0b73` is shared by the live council, Decisions and the explicit demo. It preserves the ElevenLabs React SDK, continuous voice/text sessions, animated orb, actual audio meters, transcript and pause/resume. Configure the teammate's public `ELEVENLABS_AGENT_ID` in ignored `backend/.env` (or `VITE_ELEVENLABS_AGENT_ID` in `.env.local`). This is separate from the server-side narration API key. The ElevenLabs conversation receives the actual saved Qwen assessment and proposed requirements; it does not rescore or approve them. No raw source files are uploaded. Transcripts persist against the exact assessment ID. The voice agent's hosted conversation model is configured by its owner; it must not be described as local Qwen. **Ask local Qwen directly in text** uses the local model against the saved evidence-backed verdict. An optional `ask_jury` client tool is implemented for an owner-configured ElevenLabs agent; enable `ELEVENLABS_JURY_TOOL_ENABLED=1` only after configuring that blocking tool in ElevenLabs.

The manual integration retains these branch implementations:

| Participant | Original implementation used in new live councils | Preserved work |
| --- | --- | --- |
| Customer | `Customer_Agent`: `CustomerAgent.perspective` | Native theme retrieval, deduplicated statistics, citation verification, study references, stance and counter-question |
| Market | `Market_Trends_Agent`: `MarketParticipant.turn` | Native market draft, source/numeric validation and grounding review; standalone `MarketAgent` and page unchanged |
| Competitor | `Competitors_Agent`: competitor `GroundedParticipant.turn` | Original branch's debate handler; standalone tool-using `CompetitorAgent` and page unchanged |
| Moderator | `Moderator_Agent`: `Engine` | Frozen agenda, real claim-targeted rounds, budgets, pause/resume, source validation and audit |
| Judge | `Judge_Agent`: `JudgeService` | Native argument evaluation, weighted criteria, uncertainty and versioned PM review |

Native outputs and implementation identifiers are retained in new council audit events. Existing saved councils retain their original protocol and evidence; they are not relabelled as native executions. Presentation generation remains excluded.

## Run locally

Each teammate needs their own checkout, Node.js 22.12+, Python 3.11+, and Ollama. The Moderator branch includes the authorized BMW inputs in `private-data/inputs`; set `BMW_DATA_DIR` only to use a different supplied folder. Generated indexes, model weights and credentials remain local.

```bash
npm ci
# First setup only; preserve an existing backend/.env and its key.
[ -f backend/.env ] || cp backend/.env.example backend/.env
# The default BMW_DATA_DIR already points to private-data/inputs.
ollama pull qwen3:8b
npm run dev
```

Ollama must be running first; use `ollama serve` in another terminal if it is not already running. Download the model once. `npm run dev` prepares `backend/.venv`, builds missing private indexes from the supplied files and checked-in reviewed catalogs, then starts **one backend on 8001 and Vite on 5173**. Existing indexes are retained; no online claims are reverified during setup.

Open **http://127.0.0.1:5173** in Edge or another browser. To use an already-running backend, run `npm run dev:frontend`; do not start a separate Customer, Judge or Moderator server. For manual startup, run `npm run setup:backend` then `npm run dev:backend`. An optional `BMW_PYTHON` environment variable selects an existing Python environment.

Judge narration uses ElevenLabs only for speech. Add `ELEVENLABS_API_KEY` to the ignored `backend/.env` to enable it; `ELEVENLABS_VOICE_ID` is optional. The Qwen debate and text review work without this key. Never put a secret in a `VITE_` variable. These are local single-worker services, not a deployed multi-user application.

```bash
npm run build       # TypeScript checks and production bundle in dist/
npm run preview     # Serve that production build locally
npm test            # Domain logic, state machine, review/version and PDF tests
npm run test:backend # All Python agents, contracts and orchestration tests
npm run test:e2e    # Browser workflows; Market test needs the running backend/indexes
npm run format      # Format source, tests and configuration
```

Browser tests use an installed Google Chrome via Playwright's `chrome` channel. Install Chrome, or change the channel and install Playwright Chromium with `npx playwright install chromium`. The tests use an isolated browser profile and enable software WebGL for machines without a GPU. The Playwright configuration starts or reuses the local development server. Screenshots, traces and downloaded PDFs go to ignored `test-results/`.

For static hosting, serve `dist/` and rewrite non-file routes to `index.html`. No production deployment is configured.

## Demo walkthrough

1. Select F70 / G60 / G70, market, available demo powertrain, a 3–5-year horizon and an optional goal. Confirm the scope. F70 currently offers combustion in the demo; other derivative/market availability is an integration question.
2. Explore genuine BMW reference photography for each series. Choose “Explore in 3D” to open its corresponding community-created BMW model on Sketchfab, with drag-to-orbit and scroll-to-zoom. Close the viewer to return to photography. Use Overview's category controls to connect requirements with sources. These visual references are not engineering or driving simulations.
3. Explore the live Customer rankings and original comments, reviewed Competitor references, and the Market feature watchlist. Click sources for passages, dates, locations and limitations. A feature announcement does not establish customer demand or causal sales impact.
4. Open `/council?demo=1` for the scripted council. Its fixed sequence has three perspectives, one challenge round, one clarification, an assessment, proposal and PM review. Pause, resume, interrupt, challenge or expand the discussion. The Avatars studio previews the shared visual states.
5. Compare scenario presets and adjust weights. Review a requirement with a rationale: approve, reject, edit, challenge, defer, request evidence or reopen. Editing creates a new version and clears prior approval. Excluding evidence reopens linked requirements.
6. Inspect Audit Trail, then use Export report on a demo workspace page to download a multi-page PDF with the current scope, requirements, scoring, scenarios, sources, assumptions, council statements and audit history.

The separate scripted demo initializes provisional requirements so all pages can be explored immediately. Council proposals revisit those seeded requirements rather than inventing new runtime content. In that scripted demo, free-text goals and challenges are recorded without inference. The default live council invokes Qwen only on the explicit PM action.

## Structure and integration points

```text
src/
  components/
    vehicle/        BMW photography and on-demand series-specific Sketchfab viewers
    agents/         Five animated 3D role icons and typed animation states
    council/        One scene containing all five entities
    dashboard/      Navigation and source explorer
    charts/         Risk/impact visualization
    requirements/   Human review and editing
    ui/             Shared controls, dialogs, motion and error boundary
  pages/            Home and seven workspace views
  lib/
    types/          Scope, evidence, findings, requirement, decision and audit contracts
    api/            IntelligenceService, demo adapter and production extension contract
    mock-data/      Explicitly synthetic fixtures; no private data
    scoring/        Deterministic priorities, coverage and scenario weights
    council/        Live moderator API contracts and explicit scripted-demo state machine
    audit/          Structured event construction
    export/         Snapshot-based PDF generation
  store/            Zustand state, browser persistence and domain mutations
```

- **Data/retrieval teammates:** replace synthetic ingestion in `lib/api/service.ts`. Keep source IDs, locations, dates, deduplication units and quantitative denominators intact. Original feedback repeated across classification rows must not become additional observations.
- **Agent teammates:** implement the `IntelligenceService` streaming contract. `CouncilEvent` represents publishable discussion output, not private chain-of-thought. Backend orchestration must enforce the stage sequence, limits, cancellation and retrieval-domain authorization. The mock currently buffers its finite event list before timed playback; production SSE must be consumed incrementally with reconnect/idempotency handling.
- **Backend teammates:** implement authenticated analysis/requirement/evidence persistence with optimistic version checks and transactional append-only audit writes. The extended production service contract documents the required operations. Do not rely on client-side role filters to restrict agent retrieval.
- **Frontend teammates:** use `useAppStore` selectors and the shared domain types. Keep calculations in `lib/scoring`, workflow transitions in `lib/council`, and components focused on rendering/interactions.
- **3D teammates:** `lib/vehicles.ts` maps each series to its reference photograph and public Sketchfab model. Replace the embed with approved local GLBs when exact model assets are available. Accurate spatial hotspots and engineering simulation require separately validated geometry and models. Asset provenance and rights limits are in [ASSETS.md](ASSETS.md).

Suggested HTTP/SSE routes are documented in PROJECT_SPEC.md. Keep the backend technology interchangeable; FastAPI, local evidence retrieval and persisted agent jobs are implemented in `backend/`. Live debates connect to persisted PM review. Shared authentication and a deployed multi-user service remain future work.

## What is real and what is simulated

| Working now                                                   | Current limit / next integration                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Responsive routes, accessible dialogs and keyboard controls   | No authentication or server deployment                                                          |
| Genuine BMW series imagery and distinct F70/G60/G70 3D embeds | Community model reference views; internet required; no validated engineering/driving simulation |
| Integrated Customer, Market, Competitor, Moderator and Judge | Shared local Qwen3 8B; evidence checks and interpretations remain fallible |
| Five animated 3D role icons and Judge narration | ElevenLabs playback needs a backend API key; explicit scripted demo remains at `/council?demo=1` |
| Live bounded council with pause/resume and audit              | A separate scripted demo is available explicitly at `/council?demo=1`                          |
| Live feedback drilldowns, study snapshots and cited industry data | Feedback is self-selected; study sample sizes/mean scale are unspecified; no feature-success percentage is inferred |
| Deterministic scoring and scenario comparison                 | Rubric ratings, impact, risk and effort need real validation; no ROI or sales uplift is claimed |
| Persisted live PM reviews plus versioned demo decisions       | Live reviews use local backend storage; demo decisions use browser localStorage; neither is a shared authenticated service |
| Actual downloadable PDF with pagination                       | Uses built-in Helvetica; extended writing systems need an embedded Unicode font in production   |

Evidence strength is separate from priority. Unknown scores remain unknown; known-input weight coverage is visible. Approval is attached to one version. Browser reload pauses the scripted demo council. Live jobs continue in the backend and the browser resumes polling. Starting a new analysis replaces the previous locally saved demo; export first if you want its report.

BMW photography is bundled locally. Google Fonts uses system fallbacks when offline; optional Sketchfab 3D embeds require internet access and use the provider's own navigation. Close the 3D viewer to return to the reference photograph. The council uses local lighting without an external HDR dependency. The production bundle lazy-loads 3D, analytics and PDF modules; Three.js remains the largest chunk (about 1.2 MB before gzip).

The midnight studio redesign includes the genuine BMW roundel, cinematic series selection, a 21st.dev-listed Paper Mesh Gradient shader (Apache-2.0), and five BMW-blue/silver 3D role icons: customer with feedback, trend chart, rival cars, moderator microphone and Judge scales. Navigation follows the brief's seven-page order. Motion honors the system's reduced-motion preference and pauses offscreen. Photography remains BMW copyrighted reference media; see ASSETS.md before any public commercial release.

## Verification

The automated suite covers:

- Unknown-aware scoring, deterministic weighted means and zero-weight handling.
- Powertrain-appropriate topics and source/finding lineage.
- Bounded stage order, duration cap and pause/interruption behavior.
- Required rationales, stale-version rejection, edit invalidation and evidence exclusions.
- A valid multi-page PDF generated from the same application snapshot.
- BMW series selection and embed switching, scope confirmation, source filters, specialist routes, all council controls, review/version/exclusion, scenario weights, reload persistence, audit, PDF download, mobile navigation and deep links.

The exported demo PDF was additionally rendered for visual inspection. `npm run build` may report a large Three.js chunk warning. Live inference tests are explicit because they use the local model and can take several minutes; normal Python tests exclude the `ollama` marker.

## Entire collaboration

This repository uses the Entire remote transport:

```text
entire://aws-eu-central-1.entire.io/et/bmw-hack/ehlhackathonbmw
```

Normal Git commands work. The teammate's README commit `97a27e8` was verified and fetched successfully. Entire's checked-in setup currently lists Claude Code for agent tracking; Git synchronization is separate from agent session hooks.

```bash
git pull --ff-only              # Start with a clean working tree
# Edit files and run the relevant checks
git add .
git commit -m "Describe the change"
git pull --rebase origin main    # Integrate teammates' latest commits
git push origin main
```

Pull before starting work and before pushing; pulling before every local commit is unnecessary. With unfinished edits, either commit them locally first or temporarily use `git stash push -u`, pull, and `git stash pop`. Resolve conflicts deliberately. Do not force-push shared `main`. Feature branches are preferable for larger parallel changes.

The Moderator branch already versioned the BMW input files authorized for this team repository. Do not add other confidential datasets or personal information. Keep generated evidence indexes, local sessions and credentials ignored; `BMW_DATA_DIR` can point to a separate local input folder.
