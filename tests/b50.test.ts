import { describe, expect, it } from "vitest";
import { createCatalog } from "../src/catalog/loader";
import type { ChartMetadata } from "../src/catalog/types";
import { buildB50 } from "../src/rating/b50";
import { scoreRecord } from "./helpers/synthetic-save";

function chart(songId: number, difficultyIndex = 0, constant = 12): ChartMetadata {
  return {
    songId,
    difficultyIndex,
    chartId: `song-${songId}-${difficultyIndex}`,
    baseName: `song-${songId}`,
    title: `Song ${songId}`,
    difficulty: ["Hard", "Expert", "Extreme", "Special"][difficultyIndex]!,
    constant,
  };
}

function catalog(charts: ChartMetadata[]) {
  return createCatalog({ schemaVersion: 1, catalogVersion: "test", charts });
}

describe("buildB50", () => {
  it("returns fewer than 50 real entries without padding", () => {
    const charts = [chart(1), chart(2), chart(3)];
    const records = charts.map((entry) => scoreRecord(entry.songId, entry.difficultyIndex, 95_000_000n));
    const result = buildB50(records, catalog(charts));

    expect(result.entries).toHaveLength(3);
    expect(result.entries.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(result.entries.map((entry) => entry.songId)).toEqual([1, 2, 3]);
    expect(result.totalParsedScores).toBe(3);
    expect(result.matchedScores).toBe(3);
    expect(result.unmatchedScores).toBe(0);
  });

  it("returns exactly 50 when there are exactly 50 matched scores", () => {
    const charts = Array.from({ length: 50 }, (_, index) => chart(index + 1, 0, (index % 15) + 1));
    const records = charts.map((entry) => scoreRecord(entry.songId, 0, 95_000_000n));
    expect(buildB50(records, catalog(charts)).entries).toHaveLength(50);
  });

  it("sorts ties by score, constant, songId, then difficultyIndex and truncates to 50", () => {
    const tied = [chart(9, 1, 12), chart(9, 0, 12), chart(4, 0, 10), chart(5, 0, 12)];
    const records = [
      scoreRecord(9, 1, 98_000_000n),
      scoreRecord(9, 0, 98_000_000n),
      scoreRecord(4, 0, 100_000_000n),
      scoreRecord(5, 0, 95_000_000n),
    ];
    const result = buildB50(records, catalog(tied));
    expect(result.entries.slice(0, 3).map((entry) => [entry.songId, entry.difficultyIndex])).toEqual([
      [9, 0], // equal Rating/score/constant/songId: difficultyIndex ascending
      [9, 1],
      [4, 0], // same Rating as song 5, but higher score sorts first
    ]);

    const manyCharts = Array.from({ length: 55 }, (_, index) => chart(index + 1, 0, index + 1));
    const manyRecords = manyCharts.map((entry) => scoreRecord(entry.songId, 0, 95_000_000n));
    const limited = buildB50(manyRecords, catalog(manyCharts));
    expect(limited.entries).toHaveLength(50);
    expect(limited.entries[0]?.constant).toBe(55);
    expect(limited.entries[49]?.constant).toBe(6);
  });

  it("uses constant descending when zero-score Rating ties", () => {
    const charts = [chart(3, 0, 1), chart(2, 0, 2)];
    const result = buildB50([
      scoreRecord(3, 0, 0n),
      scoreRecord(2, 0, 0n),
    ], catalog(charts));
    expect(result.entries.map((entry) => [entry.songId, entry.constant])).toEqual([[2, 2], [3, 1]]);
  });

  it("reports metadata misses and never assigns a guessed constant", () => {
    const result = buildB50(
      [scoreRecord(999, 2, 100_000_000n)],
      catalog([]),
    );
    expect(result.entries).toEqual([]);
    expect(result.totalParsedScores).toBe(1);
    expect(result.matchedScores).toBe(0);
    expect(result.unmatchedScores).toBe(1);
    expect(result.diagnostics).toEqual([{ songId: 999, difficultyIndex: 2 }]);
  });

  it("caps scores above 100M and keeps low-score Rating at zero", () => {
    const charts = [chart(1, 0, 12), chart(2, 0, 0)];
    const result = buildB50([
      scoreRecord(1, 0, 140_000_000n),
      scoreRecord(2, 0, 0n),
    ], catalog(charts));
    expect(result.entries.map((entry) => entry.rating)).toEqual([140, 0]);
    expect(result.averageRating).toBe(70);
  });
});
