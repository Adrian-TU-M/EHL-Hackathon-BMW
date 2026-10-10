# Assets and design provenance

## BMW vehicle photography

The three BMW references are genuine BMW product images, downloaded on 10 October 2026. They are BMW copyrighted media used as references in this **unofficial local hackathon concept**. No open redistribution or commercial reuse license has been established; this document does not claim clearance for a public commercial release. The team must obtain appropriate rights before that release.

| Local asset                  | Vehicle shown      | BMW source                                                                                             |
| ---------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `public/images/bmw-f70.webp` | BMW 1 Series F70   | [BMW Macau product page](https://www.bmw.com.mo/en/all-models/1-series/bmw-1-series/bmw-1-series.html) |
| `public/images/bmw-g60.webp` | BMW i5, G60 family | [BMW UK i5 product page](https://www.bmw.co.uk/en/all-models/bmw-i/i5/bmw-i5-overview.html)            |
| `public/images/bmw-g70.webp` | BMW i7, G70 family | [BMW Singapore i7 product page](https://www.bmw.com.sg/en/all-models/bmw-i/i7/bmw-i7-sedan.html)       |

Exact image downloads:

- F70: https://bmw.scene7.com/is/image/BMW/f70_ice_stage_dsk_fb?qlt=85&wid=1920&fmt=webp
- G60: https://bmw.scene7.com/is/image/BMW/g60_bev_stage_ext-loop_dsk_fb_de?qlt=85&wid=1920&fmt=webp
- G70: https://bmw.scene7.com/is/image/BMW/g70-bev_stage:16to7?fmt=webp-alpha&wid=1920&fit=constrain%2C1

Photography identifies the selected **series**, not the exact chosen powertrain, trim or a future vehicle. The images are labelled references; images and community models may show different derivatives. The displayed images are resized BMW media, not generated BMW lookalikes.

## BMW roundel

- Local file: `public/images/bmw-logo.svg`.
- Genuine BMW 2020 white logo, author BMW, via [Wikimedia Commons](<https://commons.wikimedia.org/wiki/File:BMW_logo_(white).svg>).
- [Exact SVG](https://upload.wikimedia.org/wikipedia/commons/5/53/BMW_logo_%28white%29.svg).
- Commons describes the simple geometric/text logo as **PD-textlogo**. BMW trademark restrictions still apply. Its inclusion identifies the hackathon challenge and does not imply affiliation or endorsement.
- The favicon remains an original letter N.

## Real BMW 3D references

Each series opens its corresponding **public Sketchfab embed** on demand. Meshes from non-downloadable models have not been extracted or redistributed. Sketchfab's own renderer, navigation and attribution remain intact. The external viewer needs internet access; the locally stored BMW photograph remains available when it is closed. A source link also allows opening the model directly if embedding is unavailable.

| Series | Model                                                                                            | Creator                           | Availability                                   |
| ------ | ------------------------------------------------------------------------------------------------ | --------------------------------- | ---------------------------------------------- |
| F70    | [BMW F70 PayoDesings](https://sketchfab.com/models/5e5371e856ef4496b0185704b325704a)             | payodesings14                     | Public embed; no download/license grant listed |
| G60    | [BMW G60 5 Series Hybrid Sedan](https://sketchfab.com/models/49efd92ced9640fda8ad2edacfba09fb)   | Charles Smith (Blitz Mobile Apps) | Public embed; no download/license grant listed |
| G70    | [BMW 7 Series MK7 (G70/G73) 2022](https://sketchfab.com/models/dc7cb373178a4572a506f8d4886a5d3c) | Merc_TV / szymonpasterczyk        | CC BY 4.0; public embed used                   |

Public metadata and model thumbnails were checked on 10 October 2026. The i5 model was chosen after visual comparison with BMW imagery; an earlier speculative-looking model was rejected. The F70 model shows a modified hatchback and is not represented as a stock production trim. These are community-created representations of real BMW cars, **not BMW engineering CAD, verified exact trim replicas, driving physics or validated performance simulations**. Analysis scope is independent of the derivative visible in a viewer. No range, handling or acceleration prediction is inferred from the visual.

The previous unbranded concept sedan is removed from the interface and repository.

## Actual 21st.dev shader

`src/components/ui/IntelligenceShader.tsx` adapts the **Paper Shaders Mesh Gradient**, indexed at [21st.dev / Paper Design / Mesh Gradient](https://21st.dev/@paper-design/components/mesh-gradient). This is adopted shader code, not just visual inspiration.

- Upstream: [paper-design/shaders](https://github.com/paper-design/shaders), pinned research revision `43cd68db79fa0b1759f72ffc941b3238e2a3954c`.
- License: **Apache-2.0**, retained in `public/licenses/paper-shaders-LICENSE.txt` with modification/source notice in `public/licenses/paper-shaders-NOTICE.txt`.
- Adaptation: a BMW-inspired blue palette, four-color shader, raw WebGL2 renderer without a new dependency, capped resolution, reduced-motion support, visibility/offscreen pause and deterministic cleanup.
- The 21st.dev shader-builder paywall was not bypassed and no gated source was copied.

## Original agent sculptures and motion

The five agent identities are original procedural geometry: fluid chrome knot, helical ribbon, radial turbine, interlocking network and crystalline evaluator. Their GLSL surface animation and state reactions are original. The council uses a single React Three Fiber scene, local Lightformer lighting, capped pixel ratio, attached agent labels, and offscreen/hidden pause. Reduced motion keeps geometry static. No external HDR or character model is required.

## Fonts, icons and dependencies

- DM Sans and Manrope: SIL Open Font License, requested through Google Fonts with system fallbacks. These are not proprietary BMW fonts.
- Lucide icons: ISC license retained in the dependency package.
- React, Three.js / React Three Fiber / Drei, Recharts, Zustand, jsPDF and build/test tools retain their package licenses. Versions are pinned by `package-lock.json`.

## Data

All feedback, study samples, trend curves, competitor comparisons and council statements remain synthetic. Vehicle imagery is real; product intelligence is a clearly identified demo. No confidential BMW datasets, private source documents, credentials or personal information are included.
