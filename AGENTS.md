# AGENTS.md

## Project scope

- This is a pure-front-end In Falsus B50 tool intended for GitHub Pages.
- Save files are processed only in the user's browser. Never upload save files or send them to any server or remote API.
- Do not create a backend.
- The current local In Falsus installation is the primary maintenance-time source for song/chart metadata and jacket thumbnails. The extractor performs no application-initiated writes to the installation.
- B50 owns player score data, catalog normalization, and Rating/B50 calculation. It does not extract chart payloads or game resources beyond the metadata and jacket thumbnail inputs needed by B50.
- Rhythm Archive is a cross-check and a related-project contract, not a runtime or correctness dependency.
- Keep runtime independent of both the game installation and Rhythm Archive. Commit a compact generated snapshot and static thumbnails.

## Data boundaries

- Cross-project chart identity is `songId + difficultyIndex ↔ chartId`; `chartId` is used by chart-preview tooling.
- Save parsing reads only the fields needed by current features. Do not copy or port a full save parser without demonstrated need.
- Keep source `Rating` and `LevelSectionIndicator` as separate fields. The B50 adapter maps `Rating` to the existing formula constant; the display level never changes calculation.
- Preserve `available` from game data. The runtime B50 resolver indexes available charts only; unavailable/tutorial metadata can remain in the generated snapshot for diagnostics.
- Treat upstream findings as confirmed facts, inference, or project conventions; never present inference as verified game behavior.
- Fail closed on malformed, unsupported, or ambiguous save/catalog formats. Do not emit guessed scores or metadata.

## Read-only game extraction

- Default source: the user's installed In Falsus game directory. Open files for reading only; never initiate writes, content or attribute changes, ACL/owner changes, renames, deletions, or timestamp changes in the installation. Never restore access times with `utime` or a similar API.
- Windows may update filesystem metadata such as access time as a consequence of normal reads. That operating-system behavior is outside the extractor's no-application-writes guarantee. Do not inspect or change the NTFS Last Access Time policy as a prerequisite for extraction.
- Never create files, caches, unpacked output, or temporary images inside the game directory.
- Use only `.local/game-catalog/` as temporary extractor output and remove it when a run finishes. `catalog:check` generates two marked runs there and compares them without writing formal outputs. `catalog:update` stages, validates, and replaces the committed outputs with rollback on failure. The committed outputs are `src/catalog/songlist.json`, `src/catalog/generated-manifest.json`, and 320×320 WebP jackets under `public/assets/jackets/`.
- Resolve every write target and fail closed unless it is inside the project root and outside the resolved game installation. Keep game source paths separate from project temporary and generated-output paths.
- Do not extract or commit `.spc`, audio/video, original textures/images, AssetBundles, fonts, UI assets, character artwork, or other game resources.
- Do not add a semantic game version from guesswork. Record only identifiers read from the installation, such as `SongData.CommitId`, an installed Steam build ID, and a content-derived fingerprint.
- Generated song and chart arrays, JSON encoding, WebP dimensions/resize/encoding settings, and metadata stripping must remain deterministic. Never include absolute paths or filesystem timestamps in the content fingerprint or generated snapshot.

## Repository hygiene

- Never commit real user `.sav` files, Steam IDs, usernames, personal data, original game files, large unprocessed game assets, temporary extraction directories, build/test caches, secrets, tokens, or unrelated large files.
- Use ignored local directories such as `.local/`, `fixtures-private/`, and `tmp/` for private fixtures and temporary artifacts; clean temporary outputs when finished.
- Do not add analytics, accounts, server upload, or remote save parsing.

## Engineering practices

- Keep parser, generated catalog source/loader, rating/B50 logic, and UI in separate modules.
- Core algorithms must not depend on browser DOM APIs.
- Keep TypeScript strict and preserve explicit, testable data contracts.
- Phase acceptance relies on relevant automated tests, typecheck, production build, necessary real-data validation, durable README/docs updates, and a milestone Git commit with a clean working tree. Do not require a separate process log.
- Avoid full test/build runs after tiny edits. Run relevant checks during module work and the complete project gate at the end of a phase.
- Keep the Save parser, Rating formula, and B50 sort semantics frozen unless new evidence proves a bug.
- Do not commit original game assets or large jackets; use generated 320×320 WebP thumbnails only.
