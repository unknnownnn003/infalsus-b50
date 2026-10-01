# In Falsus B50

In Falsus B50 reads a save file in your browser, calculates the Best 50 chart results, and lets you review or export them.

[Open In Falsus B50](https://unknnownnn003.github.io/infalsus-b50/)

## Use it

1. Open the site and select or drop your `savestate_V3.sav` file.
2. Review the ranked B50 cards, B50/B30/B10 averages, overall potential value, and detailed score diagnostics.
3. Export the result as a PNG image or JSON file.

The page also shows where the save lives and copies that path for you. It is usually located at:

```text
%USERPROFILE%\AppData\LocalLow\lowiro\infalsus\<SteamID64>\release\savestate_V3.sav
```

Replace `<SteamID64>` with the account folder on your computer. The path above is a template and contains no real account ID.

## Privacy

The save is parsed locally in your browser and is never uploaded or sent to a server or remote API. The site has no backend, account system, analytics, or telemetry. The optional display name for exports remains in the current page and is not saved or uploaded.

## 潜力值

Each chart's potential uses Arcaea's single-play formula. In Falsus scores use a 10× scale, so the formula first divides the score by 10. The source `Rating` supplies the chart constant; its display level remains separate. A cleared play adds `0.200`; a failed or missing clear status adds `0.000`.

For chart constant `C`, In Falsus score `S`, and normalized score `A = S / 10`:

- `A ≥ 10,000,000`: `C + 2 + clearBonus`
- `9,800,000 ≤ A < 10,000,000`: `C + 1 + (A − 9,800,000) / 200,000 + clearBonus`
- `A < 9,800,000`: `max(C + (A − 9,500,000) / 300,000 + clearBonus, 0)`

The B30 and B10 values are averages of the top 30 and top 10 available chart potentials. The overall potential is `(Best 50 total + Best 10 total) / 60`.

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
