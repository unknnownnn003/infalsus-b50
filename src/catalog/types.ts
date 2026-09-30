export interface ChartIdentity {
  songId: number;
  difficultyIndex: number;
}

export interface ChartMetadata extends ChartIdentity {
  chartId: string;
  baseName: string;
  title: string;
  artist?: string;
  difficulty: string;
  constant: number;
  designer?: string;
  jacket?: string;
}

export interface CatalogSnapshot {
  schemaVersion: number;
  catalogVersion: string;
  charts: ChartMetadata[];
}

export interface CatalogIndex {
  readonly schemaVersion: number;
  readonly catalogVersion: string;
  readonly charts: readonly ChartMetadata[];
  resolveBySaveRecord(songId: number, difficultyIndex: number): ChartMetadata | null;
  resolveByChartId(chartId: string): ChartMetadata | null;
}
