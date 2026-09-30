# Architecture

## Maintenance-time metadata flow

Read-only In Falsus installation
  -> `scripts/extract-game-catalog.py` reads Addressables metadata and referenced jacket Materials
  -> `scripts/game-catalog.mjs` validates and normalizes the compact source contract
  -> `src/catalog/songlist.json` and `public/assets/jackets/*.webp`
  -> static GitHub Pages build

The extractor reads the current `SongData`, `DynamicStringMapping`, and jacket `Material -> _MainTex -> Texture2D` chain. It decodes only the selected bundles. Texture pixels stay in memory; only 320×320 WebP derivatives are written to the ignored `.local/game-catalog/` scratch directory, then copied to the public asset directory. The scratch directory is cleaned after success or failure. No file is written into the game installation. Chart `.spc` files in `StreamingAssets/sam` are not extracted or decrypted. On Windows, extraction first verifies that automatic NTFS Last Access Time updates are disabled and that the setting has been in force since boot; it refuses if access-time changes are possible or the active state cannot be established. Microsoft documents this as NTFS Last Access Time behavior in [fsutil behavior](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/fsutil-behavior).

The generated snapshot has no timestamp or machine path. Its fingerprint is computed from the content hashes of the local catalog, settings, metadata bundles, and jacket bundles used by the extractor. When a product version string is unavailable, the data commit and Steam build identifiers remain separate source fields.

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

## Identity and related projects

- Save data identifies a result by `songId` and zero-based `difficultyIndex`.
- The generated songlist resolves that pair to `chartId` and chart metadata.
- Chart Preview continues to identify chart content with `chartId`.
- Rhythm Archive remains a cross-check and related web-ecosystem project.

Titles and artists are display metadata, never identity keys. The deployed page requires no game installation, Rhythm Archive service, or backend.

## Trust boundaries

The save parser validates boundaries, record count, key repetition, difficulty flags, and fixed payload length before returning scores. Unsupported or ambiguous data fails closed. The generated songlist validates IDs, chart identities, difficulty mapping, availability, ratings, and local jacket paths before lookup. Missing charts remain unmatched and never receive an invented constant.
