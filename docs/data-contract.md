# Data contract

## Chart identity

The stable cross-project mapping is:

```text
songId + difficultyIndex ↔ chartId
```

Save data identifies a result by `songId` and zero-based `difficultyIndex`. The catalog resolves that identity to `chartId`, which is the identifier used by chart-preview tooling.

## Core types

```ts
interface ScoreRecord {
  songId: number;
  difficultyIndex: number;
  score: bigint;
}

interface ChartMetadata {
  songId: number;
  difficultyIndex: number;
  chartId: string;
  baseName: string;
  title: string;
  artist?: string;
  difficulty: string;
  constant: number;
  designer?: string;
  jacket?: string;
}

interface RatedScore {
  rank: number;
  songId: number;
  difficultyIndex: number;
  chartId: string;
  score: bigint;
  constant: number;
  rating: number;
  title: string;
  difficulty: string;
}
```

Catalog snapshots use `schemaVersion` and `catalogVersion`, and store chart rows in an array so duplicate identities can be detected. Catalog identity lookup uses the key `songId:difficultyIndex`; `chartId` must also be unique. Missing metadata is reported as an unmatched-score diagnostic.

JSON exports encode BigInt scores as base-10 strings so no score precision is lost.

## B50 output

Matched scores sort by Rating descending, score descending, constant descending, `songId` ascending, then `difficultyIndex` ascending. The result contains at most 50 entries and never pads missing slots. `totalRating` is the sum of the returned entries; `averageRating` is that total divided by the returned entry count (or 0 when empty). Match and unmatched counts describe all parsed records, including entries outside the top 50. Unmatched identities appear in diagnostics and do not receive a guessed constant.
