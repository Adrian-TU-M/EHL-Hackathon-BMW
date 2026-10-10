# ehlhackathonbmw

Our project for the EHL x BMW hackathon.

---

# BMW NEXT — AI Product Intelligence

## Python Judge Agent integration

The Judge now has a Python/FastAPI package with evidence-linked argument ratings,
deterministic feature scoring, manual stage checkpoints, auto clarification,
whole-council PM follow-ups, and version-specific review endpoints. Agent Council
and Decisions & Scenarios include a Judge panel that connects through `/api`.

See [backend/README.md](backend/README.md) for setup, adapter contracts, and testing.
Your teammates supply the actual AI provider and moderator implementations.
Explicit backend demo mode is available for local integration; live failures never
fall back to scripts. Backend persistence currently uses single-process memory.
The existing frontend evidence and scripted council remain synthetic demos.

To run the two real FastAPI/browser integration scenarios, start the backend in
explicit demo mode on port 8000, then run
`JUDGE_E2E=1 npx playwright test tests/e2e/judge.spec.ts`.

An unofficial BMW challenge prototype: choose a vehicle and market, inspect source-linked evidence, watch a bounded AI council discussion, compare priorities, record version-specific human decisions, and export a real PDF.

Read [PROJECT_SPEC.md](PROJECT_SPEC.md) for the complete product specification, system architecture, user journey, team contracts and open questions. The original project introduction above is retained from the teammate's Entire README commit.

## Run locally

Use Node.js 22.12+ (tested with Node 25.7) and npm.

```bash
npm ci
npm run dev
```

Open the Local URL printed by Vite (normally http://127.0.0.1:5173). No API keys, paid services, database, login, or confidential dataset is needed. The dev server binds to loopback. To share a demo across devices, deliberately configure an appropriate host and access policy.

```bash
npm run build       # TypeScript checks and production bundle in dist/
npm run preview     # Serve that production build locally
npm test            # Domain logic, state machine, review/version and PDF tests
npm run test:e2e    # Five end-to-end browser workflows, desktop and mobile
npm run format      # Format source, tests and configuration
```

Browser tests use an installed Google Chrome via Playwright's `chrome` channel. Install Chrome, or change the channel and install Playwright Chromium with `npx playwright install chromium`. The tests use an isolated browser profile and enable software WebGL for machines without a GPU. The Playwright configuration starts or reuses the local development server. Screenshots, traces and downloaded PDFs go to ignored `test-results/`.

For static hosting, serve `dist/` and rewrite non-file routes to `index.html`. No production deployment is configured.

## Demo walkthrough

1. Select F70 / G60 / G70, market, available demo powertrain, a 3–5-year horizon and an optional goal. Confirm the scope. F70 currently offers combustion in the demo; other derivative/market availability is an integration question.
2. Explore genuine BMW reference photography for each series. Choose “Explore in 3D” to open its corresponding community-created BMW model on Sketchfab, with drag-to-orbit and scroll-to-zoom. Close the viewer to return to photography. Use Overview's category controls to connect requirements with sources. These visual references are not engineering or driving simulations.
3. Explore customer feedback search and filters, synthetic satisfaction samples, market sensitivity controls and hypothetical competitor comparisons. Click sources for passages, dates, source location, calculation inputs and limitations.
4. Start the council. Its fixed sequence has three perspectives, one challenge round, one clarification, an assessment, proposal and PM review. Pause, resume, interrupt, challenge or expand the discussion. The Avatars studio previews the shared visual states.
5. Compare scenario presets and adjust weights. Review a requirement with a rationale: approve, reject, edit, challenge, defer, request evidence or reopen. Editing creates a new version and clears prior approval. Excluding evidence reopens linked requirements.
6. Inspect Audit Trail, then use Export report on any workspace page to download a multi-page PDF with the current scope, requirements, scoring, scenarios, sources, assumptions, council statements and audit history.

The demo initializes provisional requirements so all pages can be explored immediately. Council proposals revisit those seeded requirements rather than inventing new runtime content. Free-text goals and challenges are recorded, but do not invoke actual AI inference.

## Structure and integration points

```text
src/
  components/
    vehicle/        BMW photography and on-demand series-specific Sketchfab viewers
    agents/         Five procedural sculptures and typed animation states
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
    council/        Bounded deterministic state machine and visible scripted statements
    audit/          Structured event construction
    export/         Snapshot-based PDF generation
  store/            Zustand state, browser persistence and domain mutations
```

- **Data/retrieval teammates:** replace synthetic ingestion in `lib/api/service.ts`. Keep source IDs, locations, dates, deduplication units and quantitative denominators intact. Original feedback repeated across classification rows must not become additional observations.
- **Agent teammates:** implement the `IntelligenceService` streaming contract. `CouncilEvent` represents publishable discussion output, not private chain-of-thought. Backend orchestration must enforce the stage sequence, limits, cancellation and retrieval-domain authorization. The mock currently buffers its finite event list before timed playback; production SSE must be consumed incrementally with reconnect/idempotency handling.
- **Backend teammates:** implement authenticated analysis/requirement/evidence persistence with optimistic version checks and transactional append-only audit writes. The extended production service contract documents the required operations. Do not rely on client-side role filters to restrict agent retrieval.
- **Frontend teammates:** use `useAppStore` selectors and the shared domain types. Keep calculations in `lib/scoring`, workflow transitions in `lib/council`, and components focused on rendering/interactions.
- **3D teammates:** `lib/vehicles.ts` maps each series to its reference photograph and public Sketchfab model. Replace the embed with approved local GLBs when exact model assets are available. Accurate spatial hotspots and engineering simulation require separately validated geometry and models. Asset provenance and rights limits are in [ASSETS.md](ASSETS.md).

Suggested HTTP/SSE routes are documented in PROJECT_SPEC.md. Keep the backend technology interchangeable; FastAPI, a relational store and domain-specific retrieval are planned interfaces, not installed services.

## What is real and what is simulated

| Working now                                                   | Current limit / next integration                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Responsive routes, accessible dialogs and keyboard controls   | No authentication or server deployment                                                          |
| Genuine BMW series imagery and distinct F70/G60/G70 3D embeds | Community model reference views; internet required; no validated engineering/driving simulation |
| Five animated procedural agent entities                       | No voice or live model inference; hidden/offscreen council animation is paused                  |
| Deterministic bounded council with pause/resume and audit     | Scripted statements; challenges are retained but do not produce dynamic responses               |
| Feedback drilldowns and explicit study sample calculations    | All passages, study ratings, market curves and competitor patterns are synthetic                |
| Deterministic scoring and scenario comparison                 | Rubric ratings, impact, risk and effort need real validation; no ROI or sales uplift is claimed |
| Human decisions, requirement versions and local audit         | Versioned browser localStorage only; not shared or tamper-proof backend persistence             |
| Actual downloadable PDF with pagination                       | Uses built-in Helvetica; extended writing systems need an embedded Unicode font in production   |

Evidence strength is separate from priority. Unknown scores remain unknown; known-input weight coverage is visible. Approval is attached to one version. Browser reload pauses any active council for deliberate resumption. Starting a new analysis replaces the previous locally saved demo; export first if you want its report.

BMW photography is bundled locally. Google Fonts uses system fallbacks when offline; optional Sketchfab 3D embeds require internet access and use the provider's own navigation. Close the 3D viewer to return to the reference photograph. The council uses local lighting without an external HDR dependency. The production bundle lazy-loads 3D, analytics and PDF modules; Three.js remains the largest chunk (about 1.2 MB before gzip).

The midnight studio redesign includes the genuine BMW roundel, cinematic series selection, a 21st.dev-listed Paper Mesh Gradient shader (Apache-2.0), five new procedural agent sculptures, numbered navigation in the brief's seven-page order, and next-step links on every stage. Motion honors the system's reduced-motion preference. Photography remains BMW copyrighted reference media; see ASSETS.md before any public commercial release.

## Verification

The automated suite covers:

- Unknown-aware scoring, deterministic weighted means and zero-weight handling.
- Powertrain-appropriate topics and source/finding lineage.
- Bounded stage order, duration cap and pause/interruption behavior.
- Required rationales, stale-version rejection, edit invalidation and evidence exclusions.
- A valid multi-page PDF generated from the same application snapshot.
- BMW series selection and embed switching, scope confirmation, source filters, specialist routes, all council controls, review/version/exclusion, scenario weights, reload persistence, audit, PDF download, mobile navigation and deep links.

The exported PDF is additionally rendered for visual inspection. Dependency installation after the security updates reports zero known advisories. `npm run build` reports a large Three.js chunk warning; it is documented rather than hidden. There are no configured live AI/backend environment variables to verify.

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

Do not commit confidential BMW datasets or personal information. Place private ingestion inputs in ignored `private-data/` and keep credentials in ignored environment files. This repository includes synthetic fixtures only.
