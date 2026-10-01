import { describe, expect, it } from "vitest";
import { calculateRating } from "../src/rating/rating";

describe("calculateRating", () => {
  it.each([
    { score: 95_000_000n, expected: 12 },
    { score: 98_000_000n, expected: 13 },
    { score: 99_000_000n, expected: 13.5 },
    { score: 100_000_000n, expected: 14 },
    { score: 120_000_000n, expected: 14 },
  ])("maps score $score with constant 12 to $expected", ({ score, expected }) => {
    expect(calculateRating(12, score)).toBe(expected);
  });

  it("does not let low scores produce a negative Rating", () => {
    expect(calculateRating(12, 0n)).toBe(0);
    expect(calculateRating(0, 94_000_000n)).toBe(0);
  });

  it("preserves fractional constants and does not round during calculation", () => {
    expect(calculateRating(12.5, 99_000_000n)).toBe(14);
    expect(calculateRating(12.5, 98_500_000n)).toBe(13.75);
  });

  it("rejects negative scores and invalid constants", () => {
    expect(() => calculateRating(12, -1n)).toThrow(RangeError);
    expect(() => calculateRating(Number.NaN, 100_000_000n)).toThrow(RangeError);
  });
});
