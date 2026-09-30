# In Falsus B50

Browser-only In Falsus save reader and Best 50 calculator. **Stage 1 data-pipeline tests, typecheck, production build, and one local real-save comparison pass.** It parses score records, resolves chart metadata, calculates per-chart Rating, and presents a ranked B50 table. The final shareable image is not implemented.

## Privacy

Your save is parsed in the current browser and is never uploaded to any server. The application makes no save-related network requests and does not include analytics.

## Run locally

```bash
npm install
npm run dev
npm run build
npm test
```

## Save location

On Windows, the game's save is commonly found at:

```text
%USERPROFILE%\AppData\LocalLow\lowiro\infalsus\<SteamID64>\release\savestate_V3.sav
```

Select that file in the browser. The file picker keeps the path local to the browser and this application does not upload its contents.

## Rating rule

The current project convention adapts Arcaea single-chart Play Rating to In Falsus score scale ×10, then multiplies the result by 10. For constant `C` and In Falsus score `S`:

- `S >= 100,000,000`: `10 × (C + 2)`
- `98,000,000 <= S < 100,000,000`: `10 × (C + 1 + (S - 98,000,000) / 2,000,000)`
- `S < 98,000,000`: `10 × max(C + (S - 95,000,000) / 3,000,000, 0)`

This is a project convention, not a claim that the game itself displays this Rating.

## Metadata and project boundaries

The runtime uses a versioned, compact snapshot of 283 charts keyed by `songId:difficultyIndex`, with `chartId` as the cross-project chart identity. Its metadata comes from the public SaveData Parser `songs.json` snapshot, which is generated from InFalsus-Resource `SongData.ChartInfos`; the display-title fallback is the source `baseName`. Rhythm Archive is the planned canonical metadata source; a future build/export step can generate this snapshot so GitHub Pages does not depend on Rhythm Archive at runtime. `infalsus-chart-preview-generate` consumes the shared `chartId` for chart parsing and previews. B50 owns player score parsing and Rating only; it does not extract game resources. See [architecture](docs/architecture.md), [data contract](docs/data-contract.md), and [upstream notes](docs/upstream-notes.md).

## Upstream references and attribution

- [InFalsus-SaveData-Parser](https://github.com/REDDRAGON-HL/InFalsus-SaveData-Parser): reference for the minimal score-record structure. Its repository declares the MIT License. This implementation is a focused TypeScript reimplementation and does not copy the Python parser.
- [InFalsus-Resource](https://github.com/REDDRAGON-HL/InFalsus-Resource): reference for the `constant_table.json` and `songs.json` generated metadata, including chart constants in `chart.rating`. No original game assets are included.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for license and attribution details.
