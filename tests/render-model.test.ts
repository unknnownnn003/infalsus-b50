import { describe, expect, it } from "vitest";
import type { ChartMetadata } from "../src/catalog/types";
import { buildB50 } from "../src/rating/b50";
import { buildB50RenderModel } from "../src/render/model";
import { scoreRecord } from "./helpers/synthetic-save";
import { createTestCatalog } from "./helpers/catalog";

function chart(songId: number, options: Partial<ChartMetadata> = {}): ChartMetadata {
  return {
    songId,
    difficultyIndex: 0,
    chartId: "song-" + songId,
    baseName: "song-" + songId,
    title: "Song " + songId,
    difficulty: "MIN",
    constant: 10,
    ...options,
  };
}

function buildModel(charts: ChartMetadata[], options: { playerName?: string } = {}) {
  const catalog = createTestCatalog(charts);
  const result = buildB50(charts.map((entry) => scoreRecord(entry.songId, 0, 100_000_000n)), catalog);
  return buildB50RenderModel(result, catalog, options);
}

describe("B50 render model", () => {
  it("resolves 50 ranked results back to canonical catalog metadata", () => {
    const charts = Array.from({ length: 50 }, (_, index) => chart(index + 1, {
      jacket: { thumbnail: "assets/jackets/song-" + (index + 1) + ".webp" },
    }));
    const model = buildModel(charts);
    expect(model.entries).toHaveLength(50);
    expect(model.entries[0]).toMatchObject({
      rank: 1,
      title: "Song 1",
      chartId: "song-1",
      jacket: { thumbnail: "assets/jackets/song-1.webp" },
    });
    expect(model.matchedCharts).toBe(50);
    expect(model.parsedCharts).toBe(50);
  });

  it("keeps short B50 results short and supports absent jacket, artist, and designer", () => {
    const model = buildModel([chart(1), chart(2, { title: "A Long Canonical Song Title" })]);
    expect(model.entries).toHaveLength(2);
    expect(model.entries[1]?.title).toBe("A Long Canonical Song Title");
    expect(model.entries[0]?.jacket).toBeUndefined();
    expect(model.entries[0]).not.toHaveProperty("artist");
    expect(model.entries[0]).not.toHaveProperty("designer");
  });

  it("normalizes an optional local player display name without persisting it", () => {
    const model = buildModel([chart(1)], { playerName: "  Riff   07  " });
    expect(model.playerName).toBe("Riff 07");
  });

  it("carries the game display level separately from the B50 constant", () => {
    const model = buildModel([chart(1, { constant: 12, levelIndicator: "15" })]);
    expect(model.entries[0]).toMatchObject({ constant: 12, levelIndicator: "15" });
  });

  it("rejects a result whose chart identity no longer matches the catalog", () => {
    const metadata = chart(1);
    const catalog = createTestCatalog([metadata]);
    const result = buildB50([scoreRecord(1, 0, 100_000_000n)], catalog);
    result.entries[0]!.chartId = "changed";
    expect(() => buildB50RenderModel(result, catalog)).toThrowError(/no longer in the catalog/u);
  });
});
