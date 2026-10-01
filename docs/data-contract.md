# Data contract

## Chart identity

The stable cross-project mapping is `songId + difficultyIndex ↔ chartId`.

Save data identifies a result by `songId` and zero-based `difficultyIndex`. The generated game songlist resolves that identity to `chartId`, which is the identifier used by chart-preview tooling. Titles and artists are display metadata and are never identity keys. The parser also retains the per-result clear lamp when it is failed or cleared.

## Generated game songlist

`src/catalog/songlist.json` is schema version 1 and is generated from the current local game installation. UI code consumes this compact contract rather than Unity objects or AssetBundle structures.

```ts
interface InFalsusSongList {
  schemaVersion: 1;
  source?: {
    gameVersion?: string;
    gameDataCommitId?: string;
    steamBuildId?: string;
    addressablesVersion?: string;
    fingerprint?: string;
  };
  songs: InFalsusSong[];
}

interface InFalsusSong {
  songId: number;
  baseName: string;
  title: string;
  artist?: string;
  jacket?: string;
  charts: InFalsusChart[];
}

interface InFalsusChart {
  difficultyIndex: number;
  difficulty: string;
  chartId: string;
  available: boolean;
  rating: number;
  levelIndicator?: string;
  designer?: string;
  jacket?: string; // only needed when a song has chart-specific jacket variants
}
```

The extractor maps game difficulty flags 1, 2, 4, and 8 to indexes 0–3 and the current labels MIN, EVO, ULT, and FBD. It iterates the game-provided chart rows; it does not require four charts or synthesize missing rows. Duplicate song IDs, chart IDs, and `songId:difficultyIndex` identities are rejected.

`rating` comes from `ChartInfos.Rating` and feeds the existing B50 constant field. `levelIndicator` comes independently from `ChartInfos.LevelSectionIndicator` and is retained for display and JSON presentation. Their current values can match; the schema does not equate them.

`available` preserves the source status. Unavailable tutorial charts remain in the generated songlist for diagnosis but are excluded from the runtime lookup index. A chart without valid identity metadata is not guessed into existence.

Jacket references come from the game's jacket Material mapping. Each selected `_MainTex` is decoded in memory, resized to 320×320, and written as WebP. Filenames use `baseName.webp` when unambiguous. Duplicate basenames receive a song ID suffix; chart-specific variants receive explicit chart-level paths. Missing jacket metadata remains optional and invokes the existing renderer fallback.

If no semantic game version is present in the installed data, `gameVersion` stays absent. `gameDataCommitId`, `steamBuildId`, `addressablesVersion`, and `fingerprint` identify the observed input without storing an absolute path, timestamp, or machine identifier.

`src/catalog/generated-manifest.json` is the generated-output integrity record. Schema version 1 stores `sourceFingerprint`, the SHA-256 and byte count of `songlist.json`, UnityPy/Pillow/WebP encoder provenance, and a sorted filename map of each jacket's SHA-256 and byte count. It contains no generated time or machine path. `catalog:check` verifies the manifest against the committed files and against two fresh runs from the same game installation; `catalog:update` is the explicit operation that replaces the snapshot.

## Runtime catalog adapter

The catalog loader indexes only charts with `available: true`. It maps game `rating` to the existing internal `constant` property consumed by the potential formula. The loader carries `levelIndicator` separately. Chart identity indexes remain `songId:difficultyIndex` and `chartId`.

The app JSON export is schema version 3. It encodes `BigInt` scores as decimal strings and includes the resolved chart metadata, clear status, and B50/B30/B10/overall potential summary in its presentation section.

## Potential and B50 outputs

The single-chart potential applies the Arcaea formula to `score / 10`. The upstream `GameResultLamp` values are None `0`, Fail `1`, and Clear `2`; only Clear contributes `0.200`. The parser validates this field and keeps the status tied to the same score record. See the [upstream save decoder](https://github.com/REDDRAGON-HL/InFalsus-SaveData-Parser/blob/main/savefile.py).

Matched scores sort by potential descending, score descending, constant descending, songId ascending, then difficultyIndex ascending. The result contains at most 50 entries and never pads missing slots. `totalRating` is the sum of returned B50 potentials; `averageRating` divides that total by the returned entry count, or is 0 when empty. B30 and B10 totals and averages use the first 30 and 10 returned entries. `overallPotential` is `(totalRating + b10TotalRating) / 60`. Match and unmatched counts describe every parsed record. Unmatched identities remain diagnostics and receive no guessed metadata.

`B50RenderModel` contains at most 50 ranked entries with score, single-play potential, clear status, chart metadata, and an optional same-origin jacket path. Canvas layout and text fitting are deterministic pure calculations. The Canvas renderer accepts the model and preloaded local images; it does not read DOM content, save bytes, or remote URLs.
