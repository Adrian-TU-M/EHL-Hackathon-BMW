# Assets and design provenance

## Vehicle asset

- **Asset:** Graphite four-door sedan, original unbranded Innerscene model.
- **Source and license:** https://www.innerscene.com/tools/library/3d-parts/graphite-four-door-sedan-eed96d12
- **Download:** https://www.innerscene.com/api/library/graphite-four-door-sedan-eed96d12/download
- **License:** CC0 1.0 public-domain dedication, explicitly allowing use, modification and redistribution. https://creativecommons.org/publicdomain/zero/1.0/
- **Verified:** 10 October 2026. Source describes an original unbranded model; it is not a BMW 5 Series, G60, or any accurate BMW model.
- **Local file:** `public/models/concept-sedan.glb` (approximately 4.8 MB, textures embedded).
- **Treatment:** Centered and normalized in the viewer, rendered with studio lighting. The UI identifies it as a concept placeholder on every use. Vehicle selection changes the analysis context, not the placeholder model.
- **Replacement:** Supply an approved self-contained Y-up GLB through `VehicleViewer`'s `modelUrl` prop. Record its redistribution license here and configure the correct orientation and hotspot positions before claiming vehicle accuracy.

## Brand and illustrations

BMW is text identification of the challenge. No official BMW logo was supplied, and no BMW roundel has been copied or generated. This is an unofficial hackathon concept. The app favicon is an original letter N. Agent sculptures, static fallback silhouette and decorative graphics are original procedural geometry / SVG / CSS created for this prototype.

## 21st.dev exploration

The requested catalog and MCP documentation were inspected:

- https://21st.dev
- https://21st.dev/mcp
- https://21st.dev/@bariluis75/components/liquid (Bari Luis; page lists MIT; described as a zero-dependency WebGL shader component)
- https://preview.21st.dev/blog/react-shader-background-components

The liquid shader and restrained hero compositions informed the visual direction. No catalog source code was copied or installed. This avoids imposing a paid membership, API key, or extra full-screen WebGL dependency. All component implementations are original. Only the existing Three.js scene supplies the 3D effects; pixel ratio is capped at 1.5, heavy postprocessing is omitted, and reduced motion is respected.

## Fonts and icons

- DM Sans and Manrope: SIL Open Font License, distributed through Google Fonts; CSS requests these from Google Fonts, with local system fallbacks when offline. Font files are not bundled in this version.
- Lucide icons: ISC license, installed through `lucide-react`; license retained in the dependency package.
- React, Three.js / React Three Fiber / Drei, Recharts, Zustand, jsPDF and the build/test tools retain their own package licenses in `node_modules`. Exact versions are pinned by `package-lock.json`.

## Data

Every fixture is hand-authored synthetic data. Provided challenge dataset filenames in PROJECT_SPEC.md are team-supplied descriptions, not evidence of access to those files. No confidential BMW customer data, personal information, paid assets, credentials or private source documents are included.
