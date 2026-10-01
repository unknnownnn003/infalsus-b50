# Architecture

## Maintenance-time metadata flow

Read-only In Falsus installation
  -> `scripts/extract-game-catalog.py` reads Addressables metadata and referenced jacket Materials
  -> `scripts/game-catalog.mjs` validates and normalizes the compact source contract
  -> `src/catalog/songlist.json`, `src/catalog/generated-manifest.json`, and `public/assets/jackets/*.webp`
  -> static GitHub Pages build

The extractor reads the current `SongData`, `DynamicStringMapping`, and jacket `Material -> _MainTex -> Texture2D` chain. It decodes only the selected bundles. Texture pixels stay in memory; only 320×320 WebP derivatives are written to marked run directories under ignored `.local/game-catalog/`. `catalog:check` generates two independent runs, compares their canonical songlist, manifest, file set, and jacket bytes, then compares the result with committed outputs. It does not write formal generated files. `catalog:update` stages and validates all outputs before replacing the snapshot, and restores the prior files if a replacement fails. The scratch directory is cleaned after success or failure. The extractor performs no application-initiated writes to the game installation. Windows may update filesystem metadata such as access time as a consequence of normal reads; that behavior is outside this guarantee. Chart `.spc` files in `StreamingAssets/sam` are not extracted or decrypted.

The generated snapshot has no timestamp or machine path. Its source fingerprint is computed from stable logical input names and content hashes for `catalog.bin`, the consumed `m_AddressablesVersion` value, metadata bundles, and jacket bundles. It excludes absolute paths, user names, temporary paths, and filesystem timestamps, so identical input bytes at another install location keep the same fingerprint. Songs are sorted by `songId`; charts are sorted by `difficultyIndex` and `chartId`. JSON uses UTF-8, stable property/array order, two-space indentation, and LF line endings. Jacket encoding pins UnityPy 1.25.0 and Pillow 12.1.1 and fixes Lanczos center-fit, 320×320 dimensions, lossy quality 90, method 6, exact RGBA handling, and metadata stripping. The generated manifest records the source fingerprint, exact songlist digest/size, each jacket digest/size, and UnityPy/Pillow/WebP encoder provenance without a timestamp. When a product version string is unavailable, the data commit and Steam build identifiers remain separate source fields.

Rhythm Archive is read only by the diagnostic comparison command. It can validate the shared identity and metadata, but it does not supply B50 runtime data and is not required to generate, build, or run the site.

## Browser data flow

Local `.sav` file
  -> browser `ArrayBuffer`
  -> fail-closed score parser
  -> `ScoreRecord[]`
  -> generated game songlist resolver using `songId + difficultyIndex`
  -> available chart metadata, including `chartId`, `Rating`, title, and jacket
  -> frozen Rating calculation and B50 ranking
  -> B50 render model and detail table
  -> DOM cards, JSON export, and independent Canvas renderer -> PNG Blob

The resolver does not index charts whose source `available` field is false. It does not fabricate absent difficulty rows. A missing jacket affects only the image and uses the existing visual fallback.

The parser, catalog schema/resolver, Rating functions, render-model transformation, Canvas renderer, and UI remain separate modules. Core parsing, calculation, normalization, layout, and text-fit decisions do not depend on browser DOM APIs. Canvas image decoding uses same-origin files under this site's static asset directory; no third-party image host is required.

## Ranking regression scope

Ranking regression expectations bind both the save fixture identity and the catalog/source fingerprint. With the same fixture and catalog snapshot, an algorithm change must not alter B50 ranking without a justified behavior change. A catalog update, chart addition, or recalibration may legitimately change the ranking.

## Identity and related projects

- Save data identifies a result by `songId` and zero-based `difficultyIndex`.
- The generated songlist resolves that pair to `chartId` and chart metadata.
- Chart Preview continues to identify chart content with `chartId`.
- Rhythm Archive remains a cross-check and related web-ecosystem project.

Titles and artists are display metadata, never identity keys. The deployed page requires no game installation, Rhythm Archive service, or backend.

## Trust boundaries

The save parser validates boundaries, record count, key repetition, difficulty flags, and fixed payload length before returning scores. Unsupported or ambiguous data fails closed. The generated songlist validates IDs, chart identities, difficulty mapping, availability, ratings, and local jacket paths before lookup. Missing charts remain unmatched and never receive an invented constant.
