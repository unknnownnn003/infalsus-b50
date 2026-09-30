import { describe, expect, it } from "vitest";
import { diffGameCatalogAgainstRa, normalizeGameSongList } from "../scripts/game-catalog.mjs";

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const digestC = "c".repeat(64);

function chart(difficultyIndex: number, chartId: string, overrides: Record<string, unknown> = {}) {
  return {
    difficultyIndex,
    difficulty: ["MIN", "EVO", "ULT", "FBD"][difficultyIndex],
    chartId,
    available: true,
    rating: difficultyIndex + 1,
    ...overrides,
  };
}

function song(songId: number, baseName: string, charts = [chart(0, baseName + "0")], overrides: Record<string, unknown> = {}) {
  return { songId, baseName, title: baseName, charts, ...overrides };
}

function sourceList(songs: unknown[], keys: string[] = []) {
  return {
    schemaVersion: 1,
    source: { fingerprint: digestC },
    songs,
    jacketSources: keys.map((key, index) => ({ key, sha256: key, width: 320, height: 320, sizeBytes: 100 + index })),
  };
}

function raSong(songId: number, title: string, artist: string, charts: unknown[]) {
  return {
    game: "infalsus",
    resourceType: "jacket",
    title,
    metadata: { songId: String(songId), baseName: "song-" + songId, artist, charts },
  };
}

describe("game songlist normalization", () => {
  it("validates the versioned song schema", () => {
    expect(() => normalizeGameSongList({ schemaVersion: 1, songs: "bad" })).toThrowError(/songs array/u);
  });

  it("rejects duplicate songId", () => {
    expect(() => normalizeGameSongList(sourceList([song(1, "one"), song(1, "two")]))).toThrowError(/Duplicate songId/u);
  });

  it("rejects duplicate chartId", () => {
    expect(() => normalizeGameSongList(sourceList([
      song(1, "one", [chart(0, "same")]), song(2, "two", [chart(0, "same")]),
    ]))).toThrowError(/Duplicate chartId/u);
  });

  it("rejects duplicate songId:difficultyIndex", () => {
    expect(() => normalizeGameSongList(sourceList([song(1, "one", [chart(0, "first"), chart(0, "second")])])) )
      .toThrowError(/Duplicate chart identity 1:0/u);
  });

  it("rejects malformed difficulty and invalid rating", () => {
    expect(() => normalizeGameSongList(sourceList([song(1, "one", [chart(1, "bad", { difficulty: "HARD" })])]))).toThrowError(/difficulty does not match/u);
    expect(() => normalizeGameSongList(sourceList([song(1, "one", [chart(0, "bad", { rating: Number.NaN })])]))).toThrowError(/finite non-negative/u);
  });

  it("uses baseName when the source title is missing", () => {
    const normalized = normalizeGameSongList(sourceList([song(1, "fallback", [chart(0, "fallback0")], { title: "" })]));
    expect(normalized.songList.songs[0]?.title).toBe("fallback");
  });

  it("sorts and normalizes deterministically", () => {
    const first = song(2, "zeta", [chart(2, "zeta2"), chart(0, "zeta0")], { artist: " Artist " });
    const second = song(1, "alpha", [chart(1, "alpha1"), chart(0, "alpha0")]);
    const left = normalizeGameSongList(sourceList([first, second])).songList;
    const right = normalizeGameSongList(sourceList([
      { ...second, charts: [...second.charts].reverse() },
      { ...first, charts: [...first.charts].reverse() },
    ])).songList;
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
    expect(left.songs.map((row) => row.songId)).toEqual([1, 2]);
    expect(left.songs[1]?.artist).toBe("Artist");
  });

  it("uses baseName names and assigns chart-level paths to jacket variants", () => {
    const normalized = normalizeGameSongList(sourceList([
      song(4, "single", [chart(0, "single0", { jacketSourceKey: digestA })], { jacketSourceKey: digestA }),
      song(67, "variant", [
        chart(0, "variant0", { jacketSourceKey: digestA }),
        chart(1, "variant1", { jacketSourceKey: digestA }),
        chart(2, "variant2", { jacketSourceKey: digestB }),
      ]),
      song(8, "single", [chart(0, "single-other", { jacketSourceKey: digestB })], { jacketSourceKey: digestB }),
    ], [digestA, digestB]));
    const single = normalized.songList.songs.find((row) => row.songId === 4);
    const duplicateBase = normalized.songList.songs.find((row) => row.songId === 8);
    const variant = normalized.songList.songs.find((row) => row.songId === 67);
    expect(single?.jacket).toBe("assets/jackets/single--4.webp");
    expect(duplicateBase?.jacket).toBe("assets/jackets/single--8.webp");
    expect(variant?.jacket).toBeUndefined();
    expect(variant?.charts.map((row) => row.jacket)).toEqual([
      "assets/jackets/variant--variant0.webp",
      "assets/jackets/variant--variant0.webp",
      "assets/jackets/variant--variant2.webp",
    ]);
    expect(normalized.assets).toHaveLength(4);
  });

  it("omits a missing jacket and leaves the song metadata available", () => {
    const normalized = normalizeGameSongList(sourceList([song(1, "plain")]));
    expect(normalized.songList.songs[0]?.jacket).toBeUndefined();
    expect(normalized.songList.songs[0]?.charts).toHaveLength(1);
    expect(normalized.assets).toEqual([]);
  });
});

describe("Rhythm Archive comparison", () => {
  it("reports song, chartId, rating, title, and artist differences", () => {
    const game = sourceList([
      song(1, "song-1", [chart(0, "game0", { rating: 2 }), chart(1, "game1", { rating: 5 })], { title: "Game Title", artist: "Game Artist" }),
      song(2, "only-game", [chart(0, "only-game0", { available: false })]),
    ]);
    const ra = { resources: [
      raSong(1, "RA Title", "RA Artist", [
        { chartId: "ra0", available: true, difficulty: 1, rating: 1 },
        { chartId: "game1", available: true, difficulty: 2, rating: 4 },
      ]),
      raSong(3, "RA Only", "Other", [{ chartId: "ra-only0", available: true, difficulty: 1, rating: 1 }]),
    ] };
    const diff = diffGameCatalogAgainstRa(game, ra);
    expect(diff.gameOnlySongs.map((row) => row.songId)).toEqual([2]);
    expect(diff.raOnlySongs.map((row) => row.songId)).toEqual([3]);
    expect(diff.gameOnlyCharts.map((row) => row.chartId)).toEqual(["only-game0"]);
    expect(diff.raOnlyCharts.map((row) => row.chartId)).toEqual(["ra-only0"]);
    expect(diff.chartIdMismatch).toEqual([{ identity: "1:0", gameChartId: "game0", raChartId: "ra0" }]);
    expect(diff.ratingMismatch).toEqual([
      { identity: "1:0", gameRating: 2, raRating: 1 },
      { identity: "1:1", gameRating: 5, raRating: 4 },
    ]);
    expect(diff.titleMismatch).toEqual([{ songId: 1, gameTitle: "Game Title", raTitle: "RA Title" }]);
    expect(diff.artistMismatch).toEqual([{ songId: 1, gameArtist: "Game Artist", raArtist: "RA Artist" }]);
  });
});
