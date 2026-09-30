import type { CatalogIndex } from "../catalog/types";
import type { ScoreRecord } from "../save/types";
import { calculateRating } from "./rating";
import type { B50Result, RatedScore, UnmatchedScoreDiagnostic } from "./types";

export function buildB50(records: readonly ScoreRecord[], catalog: CatalogIndex): B50Result {
  const rated: RatedScore[] = [];
  const diagnostics: UnmatchedScoreDiagnostic[] = [];

  for (const record of records) {
    const chart = catalog.resolveBySaveRecord(record.songId, record.difficultyIndex);
    if (chart === null) {
      diagnostics.push({ songId: record.songId, difficultyIndex: record.difficultyIndex });
      continue;
    }

    rated.push({
      ...record,
      rank: 0,
      chartId: chart.chartId,
      constant: chart.constant,
      rating: calculateRating(chart.constant, record.score),
      title: chart.title,
      difficulty: chart.difficulty,
    });
  }

  rated.sort((left, right) => {
    if (left.rating !== right.rating) return right.rating - left.rating;
    if (left.score !== right.score) return left.score > right.score ? -1 : 1;
    if (left.constant !== right.constant) return right.constant - left.constant;
    if (left.songId !== right.songId) return left.songId - right.songId;
    return left.difficultyIndex - right.difficultyIndex;
  });

  const entries = rated.slice(0, 50).map((entry, index) => ({ ...entry, rank: index + 1 }));
  const totalRating = entries.reduce((sum, entry) => sum + entry.rating, 0);

  return {
    entries,
    totalRating,
    averageRating: entries.length === 0 ? 0 : totalRating / entries.length,
    totalParsedScores: records.length,
    matchedScores: rated.length,
    unmatchedScores: diagnostics.length,
    diagnostics,
  };
}
