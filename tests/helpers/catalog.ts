import { createCatalog } from "../../src/catalog/loader";
import type { ChartMetadata } from "../../src/catalog/types";

export function createTestCatalog(charts: readonly ChartMetadata[]) {
  const bySong = new Map<number, ChartMetadata[]>();
  for (const chart of charts) {
    const rows = bySong.get(chart.songId) ?? [];
    rows.push(chart);
    bySong.set(chart.songId, rows);
  }
  const songs = [...bySong.entries()].map(([songId, rows]) => {
    const first = rows[0]!;
    const jacketPaths = new Set(rows.flatMap((chart) => chart.jacket ? [chart.jacket.thumbnail] : []));
    const sharedJacket = jacketPaths.size === 1 && rows.every((chart) => chart.jacket !== undefined)
      ? [...jacketPaths][0]
      : undefined;
    return {
      songId,
      baseName: first.baseName,
      title: first.title,
      ...(first.artist === undefined ? {} : { artist: first.artist }),
      ...(sharedJacket === undefined ? {} : { jacket: sharedJacket }),
      charts: rows.map((chart) => ({
        difficultyIndex: chart.difficultyIndex,
        difficulty: chart.difficulty,
        chartId: chart.chartId,
        available: true,
        rating: chart.constant,
        ...(chart.levelIndicator === undefined ? {} : { levelIndicator: chart.levelIndicator }),
        ...(chart.designer === undefined ? {} : { designer: chart.designer }),
        ...(sharedJacket === undefined && chart.jacket !== undefined ? { jacket: chart.jacket.thumbnail } : {}),
      })),
    };
  });
  return createCatalog({ schemaVersion: 1, songs });
}
