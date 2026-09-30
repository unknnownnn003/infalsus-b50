import "./style.css";
import { loadCatalog } from "./catalog/loader";
import { buildB50 } from "./rating/b50";
import type { B50Result, RatedScore } from "./rating/types";
import { MAX_SAVE_FILE_BYTES, parseSaveFile } from "./save/parser";

const catalog = loadCatalog();
const fileInput = getElement<HTMLInputElement>("file-input");
const dropZone = getElement<HTMLDivElement>("drop-zone");
const browseButton = getElement<HTMLButtonElement>("browse-button");
const status = getElement<HTMLParagraphElement>("status");
const resultsSection = getElement<HTMLElement>("results");
const exportButton = getElement<HTMLButtonElement>("export-button");
const tableBody = getElement<HTMLTableSectionElement>("table-body");
const diagnosticsSection = getElement<HTMLDivElement>("diagnostics");
const diagnosticList = getElement<HTMLUListElement>("diagnostic-list");

let currentResult: B50Result | null = null;
let fileRequestSequence = 0;

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing required page element #${id}.`);
  return element as T;
}

function setText(id: string, value: string): void {
  getElement<HTMLElement>(id).textContent = value;
}

function formatInteger(value: number | bigint): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatRating(value: number): string {
  return value.toFixed(2);
}

function addCell(row: HTMLTableRowElement, value: string, className?: string): void {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (className !== undefined) cell.className = className;
  row.append(cell);
}

function renderTable(entries: RatedScore[]): void {
  tableBody.replaceChildren();
  if (entries.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "empty-cell";
    cell.textContent = "没有成功匹配的谱面。";
    row.append(cell);
    tableBody.append(row);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement("tr");
    addCell(row, String(entry.rank), "rank-cell");
    addCell(row, entry.title);
    addCell(row, entry.difficulty);
    addCell(row, String(entry.constant));
    addCell(row, formatInteger(entry.score), "number-cell");
    addCell(row, formatRating(entry.rating), "number-cell");
    addCell(row, entry.chartId, "chart-id-cell");
    tableBody.append(row);
  }
}

function renderDiagnostics(result: B50Result): void {
  diagnosticList.replaceChildren();
  diagnosticsSection.hidden = result.diagnostics.length === 0;
  for (const diagnostic of result.diagnostics.slice(0, 20)) {
    const item = document.createElement("li");
    item.textContent = `songId ${diagnostic.songId} · difficultyIndex ${diagnostic.difficultyIndex}`;
    diagnosticList.append(item);
  }
  if (result.diagnostics.length > 20) {
    const more = document.createElement("li");
    more.textContent = `另有 ${formatInteger(result.diagnostics.length - 20)} 条未显示。`;
    diagnosticList.append(more);
  }
}

function renderResult(result: B50Result): void {
  setText("parsed-count", formatInteger(result.totalParsedScores));
  setText("matched-count", formatInteger(result.matchedScores));
  setText("unmatched-count", formatInteger(result.unmatchedScores));
  setText("b50-count", formatInteger(result.entries.length));
  setText("average-rating", formatRating(result.averageRating));
  setText("total-rating", formatRating(result.totalRating));
  renderDiagnostics(result);
  renderTable(result.entries);
  resultsSection.hidden = false;
  exportButton.disabled = result.entries.length === 0;
}

function showError(message: string): void {
  currentResult = null;
  resultsSection.hidden = true;
  status.textContent = message;
  status.className = "status status-error";
}

async function processFile(file: File | undefined): Promise<void> {
  if (file === undefined) return;
  const requestSequence = ++fileRequestSequence;
  if (!file.name.toLowerCase().endsWith(".sav")) {
    showError("请选择扩展名为 .sav 的存档文件。");
    fileInput.value = "";
    return;
  }
  if (file.size > MAX_SAVE_FILE_BYTES) {
    showError("文件超过 64 MiB 支持上限；没有读取或生成成绩结果。");
    fileInput.value = "";
    return;
  }

  status.textContent = "正在当前浏览器中解析存档…";
  status.className = "status";
  exportButton.disabled = true;
  resultsSection.hidden = true;

  try {
    const bytes = await file.arrayBuffer();
    if (requestSequence !== fileRequestSequence) return;
    const records = parseSaveFile(bytes);
    const result = buildB50(records, catalog);
    currentResult = result;
    renderResult(result);
    status.textContent = `解析完成。catalog ${catalog.catalogVersion}；存档内容未离开当前浏览器。`;
    status.className = "status status-success";
  } catch (error) {
    if (requestSequence !== fileRequestSequence) return;
    const message = error instanceof Error ? error.message : "解析失败。没有生成成绩结果。";
    showError(message);
  } finally {
    // Let the same file be selected again after an error or catalog update.
    if (requestSequence === fileRequestSequence) fileInput.value = "";
  }
}

function exportResult(): void {
  if (currentResult === null || currentResult.entries.length === 0) return;

  const exportData = {
    schemaVersion: 1,
    catalogVersion: catalog.catalogVersion,
    ratingRule: "In Falsus B50 v1: Arcaea single-play formula on score / 10, then rating * 10; 100M score is capped.",
    ...currentResult,
  };
  const json = JSON.stringify(exportData, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "infalsus-b50.json";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

fileInput.addEventListener("change", () => {
  void processFile(fileInput.files?.[0]);
});
browseButton.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("drop-zone-active");
});
dropZone.addEventListener("dragleave", (event) => {
  if (!dropZone.contains(event.relatedTarget as Node | null)) dropZone.classList.remove("drop-zone-active");
});
dropZone.addEventListener("drop", (event: DragEvent) => {
  event.preventDefault();
  dropZone.classList.remove("drop-zone-active");
  void processFile(event.dataTransfer?.files[0]);
});
exportButton.addEventListener("click", exportResult);
