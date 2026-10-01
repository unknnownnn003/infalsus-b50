import { describe, expect, it } from "vitest";
import songList from "../src/catalog/songlist.json";

const fixtureFingerprint = "a2a13cea6bb887ea2bc262b610530d7c22e574bf341fd8c29fee4d77192a12d4";

describe("known chart catalog regression fixture", () => {
  const applies = songList.source?.fingerprint === fixtureFingerprint;

  (applies ? it : it.skip)("keeps the six reviewed RA difference identities bound to this source snapshot", () => {
    const charts = new Map(songList.songs.flatMap((song) => song.charts.map((chart) => [chart.chartId, chart] as const)));
    for (const chartId of ["cryogenic3", "hyalouyne3", "deepintothevibe3"]) {
      const chart = charts.get(chartId);
      expect(chart, chartId).toBeDefined();
      expect(chart?.available, chartId).toBe(true);
      expect(chart?.difficultyIndex, chartId).toBe(3);
    }
    for (const chartId of ["tutorialevolong1", "tutorialevoshort1", "tutorialmin0"]) {
      const chart = charts.get(chartId);
      expect(chart, chartId).toBeDefined();
      expect(chart?.available, chartId).toBe(false);
    }
  });
});
