# In Falsus B50

A browser-only tool for reading an In Falsus save, calculating Best 50, reviewing matched charts, and exporting a shareable PNG or diagnostic JSON.

## What it does

- Reads `savestate_V3.sav` in the current browser and shows ranked B50 cards.
- Reports B50 Average Rating, B50 Total Rating, parsed charts, and matched charts.
- Exports an 1800-pixel-wide PNG. A full 50-chart result uses a deterministic 5-column × 10-row layout and is 1800 × 2670 pixels. Shorter results use only the rows they contain; no entries are fabricated.
- Keeps a detailed score table and unmatched-chart diagnostics available under “详细成绩与诊断”.
- Exports schemaVersion 2 JSON with score results, diagnostics, and resolved presentation metadata.
- Allows an optional display name for the current PNG and JSON export. It is held only in page state and is not saved or uploaded.

## Privacy

The selected save is parsed locally in the browser. Save bytes are never uploaded or sent to a remote API. The app has no backend, account system, analytics, or telemetry. Jacket images are same-origin static files, so PNG rendering does not depend on a third-party image host or cross-origin canvas access.

## Rating rule

For constant C and In Falsus score S, the current project convention adapts the Arcaea single-chart Play Rating formula to the In Falsus score scale ×10, then multiplies the result by 10:

- S ≥ 100,000,000: 10 × (C + 2)
- 98,000,000 ≤ S < 100,000,000: 10 × (C + 1 + (S − 98,000,000) / 2,000,000)
- S < 98,000,000: 10 × max(C + (S − 95,000,000) / 3,000,000, 0)

This is the project's calculation convention, not a claim that the game itself displays this Rating. The save parser and Rating/B50 calculation were established in Phase 1 and remain separate from the rendering layer.

## Game metadata and jackets

The primary maintenance-time metadata source is the current local In Falsus installation, opened read-only. A maintenance extractor generates `src/catalog/songlist.json` and 320×320 WebP jacket thumbnails in `public/assets/jackets/`. The current generated snapshot contains 78 songs and 303 chart rows, of which 300 are available. Unavailable tutorial metadata remains marked as such and is not used for B50 lookup.

The generated contract keeps `songId + difficultyIndex` for save lookup and `chartId` for cross-project identity. Game `Rating` feeds the B50 formula; `LevelSectionIndicator` remains an independent display field. Rhythm Archive is used for read-only comparison and web-ecosystem linking, not as a runtime or correctness dependency. The app and GitHub Pages build do not fetch the game installation or Rhythm Archive.

To verify or refresh local generated data, install the maintenance-only Python dependencies, then run:

```text
python -m pip install -r scripts/requirements-game-catalog.txt
npm run catalog:check -- --game-root <path-to-In-Falsus-installation>
npm run catalog:update -- --game-root <path-to-In-Falsus-installation>
```

`catalog:check` reads the current installation twice into separate marked directories under `.local/game-catalog/`, compares deterministic songlist/manifest/WebP outputs, then checks the committed snapshot. It does not write generated repository files. `catalog:update` stages and validates the songlist, manifest, and jacket set before replacing the generated outputs; a failed update rolls back the prior snapshot. `catalog:generate` remains an alias for this explicit update operation.

To compare against a local Rhythm Archive Catalog export:

```text
npm run catalog:diff -- --rhythm-archive-catalog <path-to-rhythm-assets-gallery-v2/catalog/index.json>
```

The game installation is a maintenance-time read-only input. The extractor performs no application-initiated writes to it. Windows may update filesystem metadata such as access time as a consequence of normal reads; that operating-system behavior is outside this guarantee. No output, cache, or temporary file is created in the game directory. Generated-output writes resolve under this project, and unsafe or ambiguous targets fail closed. The browser build does not need Python, UnityPy, Pillow, a game installation, or a Rhythm Archive checkout.

`src/catalog/generated-manifest.json` binds the source fingerprint to the exact `songlist.json` bytes and each generated jacket's SHA-256 and byte count. It contains no timestamp or machine path. Jacket output is 320×320 WebP using the pinned UnityPy/Pillow dependencies, Lanczos center-fit, lossy quality 90, method 6, exact RGBA handling, and stripped EXIF/ICC/XMP metadata. The manifest records UnityPy/Pillow/WebP versions as provenance; `catalog:check` verifies them and byte-for-byte repeatability in the installed environment.

## Local development

```text
npm install
npm run dev
npm test
npm run test:extractor
npm run typecheck
npm run build
```

`npm run test:extractor` runs focused Python checks for source validation, write-path safety, content-only fingerprints, deterministic ordering, WebP output, and Addressables path resolution. The maintenance-only dependencies are pinned in `scripts/requirements-game-catalog.txt`.

The production base path is `/infalsus-b50/`. The GitHub Pages workflow builds a static artifact; it does not need secrets or a backend.

## Attribution and rights

The public SaveData Parser and InFalsus-Resource repositories provide MIT-licensed structural and metadata references; their notices are preserved in `THIRD_PARTY_NOTICES.md`. The maintenance extractor uses UnityPy and Pillow as non-vendored Python dependencies. Game names and jacket artwork remain the property of their respective rights holders. The small jacket thumbnails identify charts in the B50 interface and export; this project does not claim or grant rights to reuse the artwork elsewhere. This is an unofficial community tool and is not affiliated with the rights holders.
