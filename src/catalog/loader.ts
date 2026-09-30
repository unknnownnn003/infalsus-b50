import bundledSnapshot from "./catalog.json";
import { CatalogError } from "./errors";
import { createCatalogIndex } from "./resolver";
import type { CatalogIndex, ChartMetadata } from "./types";

const SUPPORTED_SCHEMA_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CatalogError("invalid-catalog", `charts[${index}].${field} must be a non-empty string.`);
  }
  return value;
}

function optionalString(chart: Record<string, unknown>, field: string, index: number): string | undefined {
  const value = chart[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new CatalogError("invalid-catalog", `charts[${index}].${field} must be a string when provided.`);
  }
  return value;
}

function parseChart(value: unknown, index: number): ChartMetadata {
  if (!isRecord(value)) {
    throw new CatalogError("invalid-catalog", `charts[${index}] must be an object.`);
  }

  const songId = value["songId"];
  const difficultyIndex = value["difficultyIndex"];
  const constant = value["constant"];
  if (!Number.isInteger(songId) || (songId as number) < 0 || (songId as number) > 0xffff) {
    throw new CatalogError("invalid-catalog", `charts[${index}].songId must be a u16 integer.`);
  }
  if (!Number.isInteger(difficultyIndex) || (difficultyIndex as number) < 0 || (difficultyIndex as number) > 3) {
    throw new CatalogError("invalid-catalog", `charts[${index}].difficultyIndex must be an integer from 0 through 3.`);
  }
  if (typeof constant !== "number" || !Number.isFinite(constant) || constant < 0) {
    throw new CatalogError("invalid-catalog", `charts[${index}].constant must be a finite non-negative number.`);
  }

  const artist = optionalString(value, "artist", index);
  const designer = optionalString(value, "designer", index);
  const jacket = optionalString(value, "jacket", index);

  return {
    songId: songId as number,
    difficultyIndex: difficultyIndex as number,
    chartId: requiredString(value["chartId"], "chartId", index),
    baseName: requiredString(value["baseName"], "baseName", index),
    title: requiredString(value["title"], "title", index),
    difficulty: requiredString(value["difficulty"], "difficulty", index),
    constant,
    ...(artist === undefined ? {} : { artist }),
    ...(designer === undefined ? {} : { designer }),
    ...(jacket === undefined ? {} : { jacket }),
  };
}

export function createCatalog(snapshot: unknown): CatalogIndex {
  if (!isRecord(snapshot)) {
    throw new CatalogError("invalid-catalog", "Catalog root must be an object.");
  }

  const schemaVersion = snapshot["schemaVersion"];
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new CatalogError(
      "unsupported-schema",
      `Unsupported catalog schemaVersion: ${String(schemaVersion)}.`,
    );
  }
  const catalogVersion = snapshot["catalogVersion"];
  if (typeof catalogVersion !== "string" || catalogVersion.trim().length === 0) {
    throw new CatalogError("invalid-catalog", "catalogVersion must be a non-empty string.");
  }
  const chartRows = snapshot["charts"];
  if (!Array.isArray(chartRows)) {
    throw new CatalogError("invalid-catalog", "charts must be an array.");
  }

  const charts = chartRows.map(parseChart);
  const identities = new Set<string>();
  const chartIds = new Set<string>();
  for (const chart of charts) {
    const key = `${chart.songId}:${chart.difficultyIndex}`;
    if (identities.has(key)) {
      throw new CatalogError("duplicate-identity", `Duplicate chart identity ${key}.`);
    }
    if (chartIds.has(chart.chartId)) {
      throw new CatalogError("duplicate-chart-id", `Duplicate chartId ${chart.chartId}.`);
    }
    identities.add(key);
    chartIds.add(chart.chartId);
  }

  return createCatalogIndex(SUPPORTED_SCHEMA_VERSION, catalogVersion, charts);
}

let bundledCatalog: CatalogIndex | undefined;

export function loadCatalog(): CatalogIndex {
  bundledCatalog ??= createCatalog(bundledSnapshot);
  return bundledCatalog;
}
