import { describe, expect, it } from "vitest";
import { renderB50Png } from "../src/render/b50-renderer";
import type { B50RenderModel } from "../src/render/types";

function modelWithFiftyEntries(): B50RenderModel {
  return {
    entries: Array.from({ length: 50 }, (_, index) => ({
      rank: index + 1,
      songId: index + 1,
      difficultyIndex: index % 4,
      chartId: "chart-" + index,
      baseName: "song-" + index,
      title: "Long Song Title " + index,
      artist: "Artist",
      difficulty: ["MIN", "EVO", "ULT", "FBD"][index % 4]!,
      constant: 10,
      score: 99_000_000n,
      rating: 100,
      jacket: { thumbnail: "assets/jackets/song-" + index + ".webp" },
    })),
    averageRating: 100,
    totalRating: 5000,
    b30AverageRating: 100,
    b30TotalRating: 3000,
    b10AverageRating: 100,
    b10TotalRating: 1000,
    overallPotential: 100,
    parsedCharts: 82,
    matchedCharts: 80,
  };
}

describe("PNG renderer", () => {
  it("renders 50 cards and produces a PNG Blob at the expected dimensions", async () => {
    const context = new Proxy({
      measureText: (text: string) => ({ width: text.length * 8 }),
    } as unknown as CanvasRenderingContext2D, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        return value ?? (() => undefined);
      },
      set(target, property, value) {
        Reflect.set(target, property, value);
        return true;
      },
    });
    let width = 0;
    let height = 0;
    const canvas = {
      get width() { return width; },
      set width(value: number) { width = value; },
      get height() { return height; },
      set height(value: number) { height = value; },
      getContext: () => context,
      toBlob: (callback: BlobCallback, type?: string) => callback(new Blob([
        Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      ], { type: type ?? "" })),
    } as unknown as HTMLCanvasElement;

    const result = await renderB50Png(modelWithFiftyEntries(), {
      baseUrl: "/infalsus-b50/",
      createCanvas: () => canvas,
      loadImage: async () => null,
    });

    expect(result).toMatchObject({ width: 1800, height: 2670 });
    expect(result.blob.type).toBe("image/png");
    expect(result.blob.size).toBeGreaterThan(0);
  });
});
