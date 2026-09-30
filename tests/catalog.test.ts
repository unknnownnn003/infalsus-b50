import { describe, expect, it } from "vitest";
import { createCatalog, loadCatalog } from "../src/catalog/loader";
import { CatalogError } from "../src/catalog/errors";
import type { ChartMetadata } from "../src/catalog/types";

const firstChart: ChartMetadata = {
  songId: 2,
  difficultyIndex: 0,
  chartId: "alamode0",
  baseName: "alamode",
  title: "alamode",
  difficulty: "Hard",
  constant: 1,
};

function snapshot(charts: ChartMetadata[], schemaVersion = 1): unknown {
  return { schemaVersion, catalogVersion: "test", charts };
}

describe("catalog", () => {
  it("resolves by save identity and by chartId", () => {
    const catalog = createCatalog(snapshot([firstChart]));
    expect(catalog.resolveBySaveRecord(2, 0)).toEqual(firstChart);
    expect(catalog.resolveByChartId("alamode0")).toEqual(firstChart);
    expect(catalog.resolveBySaveRecord(2, 3)).toBeNull();
    expect(catalog.resolveByChartId("missing")).toBeNull();
  });

  it("loads the bundled, attributed 283-chart snapshot", () => {
    const bundled = loadCatalog();
    expect(bundled.charts).toHaveLength(283);
    expect(bundled.catalogVersion).toBe("infalsus-resource-dd2ae9621321");
    expect(bundled.resolveBySaveRecord(2, 0)?.chartId).toBe("alamode0");
  });

  it("rejects unsupported schema versions", () => {
    expect(() => createCatalog(snapshot([firstChart], 2))).toThrowError(CatalogError);
  });

  it("rejects duplicate identities", () => {
    const second = { ...firstChart, chartId: "different-chart", title: "other" };
    expect(() => createCatalog(snapshot([firstChart, second]))).toThrowError(/Duplicate chart identity/);
  });

  it("rejects duplicate chart IDs", () => {
    const second = { ...firstChart, songId: 3, chartId: firstChart.chartId };
    expect(() => createCatalog(snapshot([firstChart, second]))).toThrowError(/Duplicate chartId/);
  });
});
