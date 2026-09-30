import { describe, expect, it } from "vitest";
import { createCatalog, loadCatalog } from "../src/catalog/loader";
import { CatalogError } from "../src/catalog/errors";

function songList(songs: unknown[]): unknown {
  return { schemaVersion: 1, songs };
}

function chart(overrides: Record<string, unknown> = {}) {
  return { difficultyIndex: 0, difficulty: "MIN", chartId: "alamode0", available: true, rating: 1, ...overrides };
}

function song(overrides: Record<string, unknown> = {}) {
  return { songId: 2, baseName: "alamode", title: "à la mode", charts: [chart()], ...overrides };
}

describe("catalog", () => {
  it("resolves by save identity and chartId", () => {
    const catalog = createCatalog(songList([song()]));
    expect(catalog.resolveBySaveRecord(2, 0)).toMatchObject({ chartId: "alamode0", constant: 1 });
    expect(catalog.resolveByChartId("alamode0")?.difficultyIndex).toBe(0);
    expect(catalog.resolveBySaveRecord(2, 3)).toBeNull();
  });

  it("loads all available game charts and excludes unavailable tutorials", () => {
    const catalog = loadCatalog();
    expect(catalog.charts).toHaveLength(300);
    expect(catalog.catalogVersion).toMatch(/^game-[a-f0-9]{12}$/u);
    expect(catalog.resolveBySaveRecord(11, 3)?.chartId).toBe("cryogenic3");
    expect(catalog.resolveBySaveRecord(67, 3)?.chartId).toBe("deepintothevibe3");
    expect(catalog.resolveByChartId("tutorialmin0")).toBeNull();
  });

  it("keeps Rating and display level separate", () => {
    const catalog = createCatalog(songList([song({ charts: [chart({ rating: 12, levelIndicator: "15" })] })]));
    expect(catalog.resolveBySaveRecord(2, 0)).toMatchObject({ constant: 12, levelIndicator: "15" });
  });

  it("rejects an unsupported schema", () => {
    expect(() => createCatalog({ schemaVersion: 2, songs: [] })).toThrowError(CatalogError);
  });

  it("allows missing jackets for renderer fallback", () => {
    expect(createCatalog(songList([song()])).resolveBySaveRecord(2, 0)?.jacket).toBeUndefined();
  });

  it("rejects unsafe jacket paths", () => {
    for (const jacket of ["https://example.invalid/a.webp", "../a.webp", "/assets/jackets/a.webp", "assets/jackets/a.png"]) {
      expect(() => createCatalog(songList([song({ jacket })]))).toThrowError(/assets\/jackets\/\*\.webp/u);
    }
  });

  it("rejects duplicate identity even when unavailable", () => {
    expect(() => createCatalog(songList([song({ charts: [chart({ available: false }), chart({ chartId: "x", available: false })] })])))
      .toThrowError(/Duplicate chart identity/u);
  });
});
