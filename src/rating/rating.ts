const SCORE_98M = 98_000_000n;
const SCORE_100M = 100_000_000n;
const ARCAEA_SCORE_9_5M = 9_500_000;
const ARCAEA_SCORE_9_8M = 9_800_000;
const CLEAR_BONUS = 0.2;

export function calculateRating(
  constant: number,
  score: bigint,
  clearStatus?: "failed" | "cleared",
): number {
  if (!Number.isFinite(constant) || constant < 0) {
    throw new RangeError("Chart constant must be a finite non-negative number.");
  }
  if (score < 0n) {
    throw new RangeError("Score must be non-negative.");
  }
  if (clearStatus !== undefined && clearStatus !== "failed" && clearStatus !== "cleared") {
    throw new RangeError("Clear status must be failed or cleared.");
  }

  const clearBonus = clearStatus === "cleared" ? CLEAR_BONUS : 0;
  const arcaeaScore = Number(score) / 10;
  if (score >= SCORE_100M) {
    return constant + 2 + clearBonus;
  }
  if (score >= SCORE_98M) {
    return constant + 1 + (arcaeaScore - ARCAEA_SCORE_9_8M) / 200_000 + clearBonus;
  }
  const adjusted = constant + (arcaeaScore - ARCAEA_SCORE_9_5M) / 300_000 + clearBonus;
  return Math.max(adjusted, 0);
}
