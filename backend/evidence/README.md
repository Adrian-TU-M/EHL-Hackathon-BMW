# Competitor source audit

Reviewed **10 October 2026**. `competitors.json` contains 24 short, manually
curated evidence records from eleven official pages (initial set below plus additions later in this file). Twenty-three are
current source references; the 2024 E-Class reference is retained as historical.
These are traceable source summaries, not complete source snapshots or a census
of competitor features. The agent does not refresh the internet automatically.

| Official source | Scope | What is covered | Limitation |
| --- | --- | --- | --- |
| [BYD SEAL MY2026 launch](https://bydukmedia.com/en/news-articles/byd-launches-new-model-year-2026-seal-saloon-more-practicality,-increased-customisation-and-greater-specification.html) | UK, 2026, Design / Excellence AWD | Display, HUD, seats/audio, access/monitoring, charging | Dated launch specification; confirm later production/configurator changes |
| [Tesla Model 3 touchscreen manual](https://www.tesla.com/ownersmanual/model3/en_gb/GUID-518C51C1-E9AC-4A68-AE12-07F4FF8C881E.html) | UK-localized manual | Rear screen, controls, shortcuts, front control of rear screen | Equipment- and software-dependent; not a trim availability list |
| [Mercedes-Benz EQS](https://www.mercedes-benz.co.uk/passengercars/models/saloon/eqs/overview.html) | UK electric flagship | Displays, entertainment, parking, dashcam | Marketing highlights; check order configuration and model year |
| [Mercedes-Benz A-Class](https://www.mercedes-benz.co.uk/passengercars/models/hatchback/a-class/overview.html?abtest-new_extint=target) | UK hatchback range | MBUX, display/connectivity, AR navigation | Several variants on one page; no universal standard-fitment claim |
| [BYD SEAL 6 DM-i](https://www.byd.com/uk/hybrid-cars/seal-6-dm-i) | UK plug-in hybrid | Display and seats | Range-level reference; do not confuse with battery-electric SEAL |
| [Tesla Model 3 US manual](https://www.tesla.com/ownersmanual/model3/en_us/GUID-518C51C1-E9AC-4A68-AE12-07F4FF8C881E.html) | US-localized manual | Rear-screen functions | Conditional on equipment; no universal fitment claim |
| [Mercedes 2024 E-Class guide](https://media.mbusa.com/news/2024-e-class-sedan-quick-reference-guide) | US, model year 2024 | Superscreen | **Historical: excluded from current searches** |

The UK MY2026 SEAL launch explicitly describes a fixed screen. Older descriptions
of a rotating SEAL screen must not be applied to this version. The
[official MY2026 UK leaflet](https://www.byd.com/material/byd-site/byd-uk/specifications/SEAL%20MY26%20UK%20Leaflet.pdf)
was also consulted as a cross-check; it is not a separate indexed source.

## Updating a record

1. Open the original regional manufacturer page or dated brochure. Confirm the
   feature, country, model year, trim, optional/standard status and caveats. An
   accessible link alone is not verification of a current specification.
2. Edit the short summary, exact source section/page, and source metadata. Leave
   unknown dates, model years and trims unknown. Avoid converting marketing copy
   into a universal equipment assertion.
3. Set `verified_on` to the actual review date and `review_due_on` to the next
   editorial deadline. A 30-day interval is used here. Keep obsolete references
   historical rather than merely advancing their verification dates.
4. Rebuild the private index with `python -m backend.ingest --data-dir <BMW-Data>`.
   The API reloads it when its modification time changes. Check `/api/competitor/sources`.

Current search excludes overdue, historical and unreviewed competitor references.
Historical sources can still be resolved by ID for a supplied debate citation,
with their status and date attached. Broad Europe scope can contain UK references;
that does not establish German or other countries' fitment. No current China
sources are indexed yet. Exact peer equivalence, price, production availability
and future effects remain separate questions requiring evidence.

## Added competitors — reviewed 10 October 2026

Six additional records cover four brands (24 total records, 23 currently reviewed):

- Audi A6 Sportback e-tron, UK: Vorsprung passenger display and switchable roof. Current [UK specification page](https://www.audi.co.uk/en/models/a6-e-tron/a6-sportback-e-tron/design-and-specification/) was checked; the older German launch article was not substituted for current UK fitment.
- Volkswagen ID.7 Tourer, UK: optional Smart Glass roof and Pro Match Plus display/HUD equipment, from the [current UK model page](https://www.volkswagen.co.uk/en/electric-and-hybrid/electric-cars/id7-tourer.html/__layer/layers/id-family/id_7_tourer/panoramadach--smart-glas-/master.layer).
- XPENG G6, France: 800V/5C and manufacturer-claimed 12-minute 10–80% charging, from [XPENG France](https://www.xpeng.com/fr/model/G6). Footnote requires a 451 kW charger and describes internal tests. No matched real-world BMW charging comparison or sales effect is inferred.
- NIO ET5 Touring, Germany: Power Swap with Parking Assist, from the [German manual](https://cdn-udp-public.eu.nio.com/www-nio/de_DE/user-instructions/ET5-Touring/index.html). Station compatibility, service access and driver supervision are required. No current network size or wait time is asserted.

New records use the same 9 November 2026 review deadline. This adds Chinese **brands in European markets**, not verified China-market configurations. No source measures a feature-attributable success percentage. The UI reports this as unavailable rather than fabricating a score.
