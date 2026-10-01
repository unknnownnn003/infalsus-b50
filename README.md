# In Falsus B50

In Falsus B50 reads a save file in your browser, calculates the Best 50 chart results, and lets you review or export them.

[Open In Falsus B50](https://unknnownnn003.github.io/infalsus-b50/)

## Use it

1. Open the site and select or drop your `savestate_V3.sav` file.
2. Review the ranked B50 cards, average and total Rating, and detailed score diagnostics.
3. Export the result as a PNG image or JSON file.

The page also shows where the save lives and copies that path for you. It is usually located at:

```text
%USERPROFILE%\AppData\LocalLow\lowiro\infalsus\<SteamID64>\release\savestate_V3.sav
```

Replace `<SteamID64>` with the account folder on your computer. The path above is a template and contains no real account ID.

## Privacy

The save is parsed locally in your browser and is never uploaded or sent to a server or remote API. The site has no backend, account system, analytics, or telemetry. The optional display name for exports remains in the current page and is not saved or uploaded.

## Rating

The calculation follows the shape of Arcaea's single-chart Play Rating formula, adapted to In Falsus's score scale (10×) and with the final Rating displayed at a 10× scale. This is the project's calculation convention, not a claim about a Rating shown by the game. The chart's source `Rating` supplies the formula constant; its display level is kept separate.

For chart constant `C` and In Falsus score `S`:

- `S ≥ 100,000,000`: `10 × (C + 2)`
- `98,000,000 ≤ S < 100,000,000`: `10 × (C + 1 + (S − 98,000,000) / 2,000,000)`
- `S < 98,000,000`: `10 × max(C + (S − 95,000,000) / 3,000,000, 0)`

Scores of 100,000,000 or higher are capped at `10 × (C + 2)`.

## Catalog and artwork

The repository includes a compact song and chart catalog plus 320×320 WebP jacket thumbnails. A maintenance-time extractor generates these files from a locally installed copy of In Falsus. The browser app uses only the committed static snapshot; it does not access the game installation.

Game names and artwork remain the property of their respective rights holders. The snapshot and thumbnails are provided for identifying charts in this tool; this project does not claim ownership of, or grant a license to reuse, the game artwork. This is an unofficial community tool and is not affiliated with or endorsed by the rights holders.

Third-party software notices and required MIT attributions are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Maintainers

The static GitHub Pages build uses the committed catalog and does not need a game installation, secrets, or a backend. Local catalog updates and reproducibility checks use the maintenance-only extractor:

```text
npm ci
npm test
npm run test:extractor
npm run catalog:snapshot:check
npm run catalog:check -- --game-root <path-to-In-Falsus-installation>
npm run typecheck
npm run build
```

`catalog:check` reads the local installation twice and compares deterministic outputs with the committed snapshot. It does not update generated files. See [docs/architecture.md](docs/architecture.md) and [docs/data-contract.md](docs/data-contract.md) for implementation details.
