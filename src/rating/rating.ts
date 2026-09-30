const SCORE_95M = 95_000_000n;
const SCORE_98M = 98_000_000n;
const SCORE_100M = 100_000_000n;

export function calculateRating(constant: number, score: bigint): number {
  if (!Number.isFinite(constant) || constant < 0) {
    throw new RangeError("Chart constant must be a finite non-negative number.");
  }
  if (score < 0n) {
    throw new RangeError("Score must be non-negative.");
  }

  if (score >= SCORE_100M) {
    return 10 * (constant + 2);
  }
  if (score >= SCORE_98M) {
    return 10 * (constant + 1 + Number(score - SCORE_98M) / 2_000_000);
  }
  const adjusted = constant + Number(score - SCORE_95M) / 3_000_000;
  return 10 * Math.max(adjusted, 0);
}
