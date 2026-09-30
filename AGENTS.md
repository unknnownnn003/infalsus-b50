# AGENTS.md

## Project scope

- This is a pure-front-end In Falsus B50 tool intended for GitHub Pages.
- Save files are processed only in the user's browser. Never upload save files or send them to any server or remote API.
- Do not create a backend.
- Do not maintain a second independent source of In Falsus song/chart facts. Rhythm Archive is the future canonical metadata source.
- This project owns player score data and Rating/B50 calculation only; it does not extract game resources.
- Keep runtime independent of Rhythm Archive availability. Share catalog data at development/build time, not through a required runtime fetch.

## Data boundaries

- Cross-project chart identity is `songId + difficultyIndex ↔ chartId`, with `chartId` used by chart-preview tooling.
- Save parsing must read only the fields needed by current features. Do not copy or port a full save parser without demonstrated need.
- Treat upstream findings as confirmed facts, inference, or project conventions; never present inference as verified game behavior.
- Fail closed on malformed, unsupported, or ambiguous save formats. Do not emit guessed scores.

## Repository hygiene

- Never commit real user `.sav` files, Steam IDs, usernames, personal data, original game files, large unprocessed game assets, temporary extraction directories, build/test caches, secrets, tokens, or unrelated large files.
- Use ignored local directories such as `.local/`, `fixtures-private/`, and `tmp/` for private fixtures and temporary artifacts; clean temporary outputs when finished.
- Do not add analytics, accounts, server upload, or remote save parsing.

## Engineering practices

- Keep parser, catalog source/loader, rating/B50 logic, and UI in separate modules.
- Core algorithms must not depend on browser DOM APIs.
- Keep TypeScript strict and preserve explicit, testable data contracts.
- Phase acceptance relies on relevant automated tests, typecheck, production build, necessary real-data validation, durable README/docs updates where needed, and a milestone Git commit with a clean working tree. Do not require a separate process log.
- Avoid full test/build runs after tiny edits. Run relevant checks during module work and the complete project gate at the end of a phase.
- Commit only at a clear milestone, not after every small change.
- Do not commit original game assets or large jackets; future thumbnails should come from Rhythm Archive.
