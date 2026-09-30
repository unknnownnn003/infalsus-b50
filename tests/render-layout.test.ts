import { describe, expect, it } from "vitest";
import { calculateB50Layout } from "../src/render/layout";
import { fitText } from "../src/render/text-fit";

describe("B50 layout", () => {
  it("places 50 cards in a deterministic five-column, ten-row grid", () => {
    const layout = calculateB50Layout(50);
    expect(layout).toMatchObject({ width: 1800, height: 2670, columns: 5, rows: 10 });
    expect(layout.cardPosition(0)).toEqual({ x: 48, y: 300 });
    expect(layout.cardPosition(4)).toEqual({ x: 1424, y: 300 });
    expect(layout.cardPosition(5)).toEqual({ x: 48, y: 534 });
    expect(layout.cardPosition(49)).toEqual({ x: 1424, y: 2406 });
    expect(calculateB50Layout(50).cardPosition(49)).toEqual(layout.cardPosition(49));
  });

  it("uses only the rows needed for fewer than 50 entries", () => {
    expect(calculateB50Layout(7)).toMatchObject({ rows: 2, height: 798 });
    expect(calculateB50Layout(1)).toMatchObject({ rows: 1, height: 564 });
    expect(calculateB50Layout(0)).toMatchObject({ rows: 0, height: 348 });
  });

  it("rejects an invalid result count", () => {
    expect(() => calculateB50Layout(51)).toThrowError(/0 through 50/u);
    expect(() => calculateB50Layout(-1)).toThrowError(/0 through 50/u);
  });
});

describe("title text fitting", () => {
  const measure = (text: string, fontSize: number): number => Array.from(text).length * fontSize * 0.5;

  it("wraps a long title without exceeding the allowed width", () => {
    const result = fitText("A Long Song Title With Several Words", 110, measure, {
      maxFontSize: 20,
      minFontSize: 14,
      maxLines: 2,
    });
    expect(result.lines.length).toBeLessThanOrEqual(2);
    expect(result.lines.every((line) => measure(line, result.fontSize) <= 110)).toBe(true);
  });

  it("breaks and truncates a long unspaced title deterministically", () => {
    const input = "東京交差点とても長い曲名Supercalifragilisticexpialidocious";
    const first = fitText(input, 92, measure, { maxFontSize: 18, minFontSize: 12, maxLines: 2 });
    const second = fitText(input, 92, measure, { maxFontSize: 18, minFontSize: 12, maxLines: 2 });
    expect(first).toEqual(second);
    expect(first.lines).toHaveLength(2);
    expect(first.truncated).toBe(true);
    expect(first.lines.every((line) => measure(line, first.fontSize) <= 92)).toBe(true);
  });
});
