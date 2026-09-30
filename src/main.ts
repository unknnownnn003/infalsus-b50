import "./style.css";
import { loadCatalog } from "./catalog/loader";
import { buildB50 } from "./rating/b50";
import type { B50Result, RatedScore } from "./rating/types";
import { jacketAssetUrl } from "./render/assets";
import { getDifficultyTheme } from "./render/difficulty-theme";
import { buildB50RenderModel } from "./render/model";
import { renderB50Png } from "./render/b50-renderer";
import { MAX_SAVE_FILE_BYTES, parseSaveFile } from "./save/parser";

const catalog = loadCatalog();
const fileInput = getElement<HTMLInputElement>("file-input");
const dropZone = getElement<HTMLDivElement>("drop-zone");
const browseButton = getElement<HTMLButtonElement>("browse-button");
const status = getElement<HTMLParagraphElement>("status");
const resultsSection = getElement<HTMLElement>("results");
const pngButton = getElement<HTMLButtonElement>("export-png-button");
const jsonButton = getElement<HTMLButtonElement>("export-json-button");
const pngDownloadLink = getElement<HTMLAnchorElement>("png-download-link");
const playerNameInput = getElement<HTMLInputElement>("player-name");
const exportStatus = getElement<HTMLParagraphElement>("export-status");
const cardGrid = getElement<HTMLDivElement>("b50-cards");
const tableBody = getElement<HTMLTableSectionElement>("table-body");
const diagnosticsSection = getElement<HTMLDivElement>("diagnostics");
const diagnosticList = getElement<HTMLUListElement>("diagnostic-list");

let currentResult: B50Result | null = null;
let fileRequestSequence = 0;
let pngRenderSequence = 0;
let activePngRenderSequence: number | null = null;
let pngObjectUrl: string | null = null;

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error("Missing required page element #" + id + ".");
  return element as T;
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

function makeCard(entry: ReturnType<typeof buildB50RenderModel>["entries"][number], index: number): HTMLElement {
  const theme = getDifficultyTheme(entry.difficultyIndex);
  const card = document.createElement("article");
  card.className = "b50-card";
  card.dataset["difficulty"] = theme.className;
  card.setAttribute("role", "listitem");
  card.style.setProperty("--difficulty-accent", theme.accent);
  card.style.setProperty("--difficulty-wash", theme.wash);

  const top = document.createElement("div");
  top.className = "card-topline";
  const rank = document.createElement("span");
  rank.className = "card-rank";
  rank.textContent = "#" + String(entry.rank).padStart(2, "0");
  const difficulty = document.createElement("span");
  difficulty.className = "difficulty-badge";
  difficulty.textContent = theme.label;
  top.append(rank, difficulty);

  const song = document.createElement("div");
  song.className = "card-song";
  const jacket = document.createElement("div");
  jacket.className = "card-jacket";
  const placeholder = document.createElement("span");
  placeholder.className = "cover-placeholder";
  placeholder.setAttribute("aria-hidden", "true");
  placeholder.textContent = "IF";
  jacket.append(placeholder);
  if (entry.jacket !== undefined) {
    const image = document.createElement("img");
    image.src = jacketAssetUrl(entry.jacket.thumbnail, import.meta.env.BASE_URL);
    image.alt = entry.title + " jacket";
    image.decoding = "async";
    image.loading = index < 10 ? "eager" : "lazy";
    image.addEventListener("load", () => jacket.classList.add("cover-loaded"), { once: true });
    image.addEventListener("error", () => jacket.classList.add("cover-failed"), { once: true });
    jacket.append(image);
  } else {
    jacket.classList.add("cover-failed");
  }

  const songText = document.createElement("div");
  songText.className = "card-song-copy";
  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = entry.title;
  const artist = document.createElement("p");
  artist.className = "card-artist";
  artist.textContent = entry.artist ?? " ";
  const constant = document.createElement("p");
  constant.className = "card-constant";
  constant.textContent = "CONST " + (Number.isInteger(entry.constant) ? String(entry.constant) : entry.constant.toFixed(1));
  songText.append(title, artist, constant);
  song.append(jacket, songText);

  const score = document.createElement("div");
  score.className = "card-scoreline";
  const scoreValue = document.createElement("div");
  scoreValue.className = "card-score";
  const scoreLabel = document.createElement("span");
  scoreLabel.textContent = "SCORE";
  const scoreNumber = document.createElement("strong");
  scoreNumber.textContent = formatInteger(entry.score);
  scoreValue.append(scoreLabel, scoreNumber);
  const rating = document.createElement("div");
  rating.className = "card-rating";
  const ratingLabel = document.createElement("span");
  ratingLabel.textContent = "RATING";
  const ratingNumber = document.createElement("strong");
  ratingNumber.textContent = formatRating(entry.rating);
  rating.append(ratingLabel, ratingNumber);
  score.append(scoreValue, rating);

  card.append(top, song, score);
  return card;
}

function renderCards(result: B50Result): void {
  cardGrid.replaceChildren();
  const model = buildB50RenderModel(result, catalog);
  if (model.entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-b50";
    const mark = document.createElement("span");
    mark.className = "empty-mark";
    mark.textContent = "—";
    const title = document.createElement("h3");
    title.textContent = "还没有可排名的成绩";
    const message = document.createElement("p");
    message.textContent = "已读取存档；请展开详细成绩与诊断，查看未匹配的谱面身份。";
    empty.append(mark, title, message);
    cardGrid.append(empty);
    return;
  }
  model.entries.forEach((entry, index) => cardGrid.append(makeCard(entry, index)));
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
  for (const diagnostic of result.diagnostics.slice(0, 50)) {
    const item = document.createElement("li");
    item.textContent = "songId " + diagnostic.songId + " · difficultyIndex " + diagnostic.difficultyIndex;
    diagnosticList.append(item);
  }
  if (result.diagnostics.length > 50) {
    const more = document.createElement("li");
    more.textContent = "另有 " + formatInteger(result.diagnostics.length - 50) + " 条未显示。";
    diagnosticList.append(more);
  }
}

function renderResult(result: B50Result): void {
  clearPngDownload();
  const model = buildB50RenderModel(result, catalog);
  getElement<HTMLElement>("parsed-count").textContent = formatInteger(model.parsedCharts);
  getElement<HTMLElement>("matched-count").textContent = formatInteger(model.matchedCharts);
  getElement<HTMLElement>("unmatched-count").textContent = formatInteger(result.unmatchedScores);
  getElement<HTMLElement>("b50-count").textContent = formatInteger(model.entries.length);
  getElement<HTMLElement>("average-rating").textContent = formatRating(model.averageRating);
  getElement<HTMLElement>("total-rating").textContent = formatRating(model.totalRating);
  renderDiagnostics(result);
  renderTable(result.entries);
  renderCards(result);
  resultsSection.hidden = false;
  pngButton.disabled = result.entries.length === 0;
  jsonButton.disabled = false;
  exportStatus.textContent = "";
}

function showError(message: string): void {
  clearPngDownload();
  currentResult = null;
  resultsSection.hidden = true;
  status.textContent = message;
  status.className = "status status-error";
  pngButton.disabled = true;
  jsonButton.disabled = true;
}

async function processFile(file: File | undefined): Promise<void> {
  if (file === undefined) return;
  const requestSequence = ++fileRequestSequence;
  pngRenderSequence += 1;
  activePngRenderSequence = null;
  clearPngDownload();
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
  exportStatus.textContent = "";
  pngButton.disabled = true;
  jsonButton.disabled = true;
  resultsSection.hidden = true;
  dropZone.setAttribute("aria-busy", "true");

  try {
    const bytes = await file.arrayBuffer();
    if (requestSequence !== fileRequestSequence) return;
    const records = parseSaveFile(bytes);
    const result = buildB50(records, catalog);
    currentResult = result;
    renderResult(result);
    status.textContent = "解析完成。存档内容未离开当前浏览器。";
    status.className = "status status-success";
  } catch (error) {
    if (requestSequence !== fileRequestSequence) return;
    const message = error instanceof Error ? error.message : "解析失败。没有生成成绩结果。";
    showError(message);
  } finally {
    if (requestSequence === fileRequestSequence) {
      dropZone.removeAttribute("aria-busy");
      fileInput.value = "";
    }
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function currentRenderModel() {
  if (currentResult === null) return null;
  return buildB50RenderModel(currentResult, catalog, { playerName: playerNameInput.value });
}

async function exportPng(): Promise<void> {
  const sourceResult = currentResult;
  if (sourceResult === null || sourceResult.entries.length === 0) return;
  const sourceFileSequence = fileRequestSequence;
  const sourcePlayerName = playerNameInput.value;
  const model = buildB50RenderModel(sourceResult, catalog, { playerName: sourcePlayerName });
  const exportSequence = ++pngRenderSequence;
  activePngRenderSequence = exportSequence;
  clearPngDownload();
  pngButton.disabled = true;
  exportStatus.textContent = "正在准备曲绘并绘制 B50…";
  try {
    const rendered = await renderB50Png(model, { baseUrl: import.meta.env.BASE_URL });
    if (
      exportSequence !== pngRenderSequence
      || activePngRenderSequence !== exportSequence
      || sourceFileSequence !== fileRequestSequence
      || currentResult !== sourceResult
      || playerNameInput.value !== sourcePlayerName
    ) return;
    pngObjectUrl = URL.createObjectURL(rendered.blob);
    pngDownloadLink.href = pngObjectUrl;
    pngDownloadLink.hidden = false;
    exportStatus.textContent = "PNG 已生成，尺寸 " + rendered.width + " × " + rendered.height + "；点击“保存 PNG”下载。";
  } catch (error) {
    if (
      exportSequence !== pngRenderSequence
      || activePngRenderSequence !== exportSequence
      || sourceFileSequence !== fileRequestSequence
      || currentResult !== sourceResult
      || playerNameInput.value !== sourcePlayerName
    ) return;
    exportStatus.textContent = error instanceof Error ? error.message : "PNG 导出失败，请稍后重试。";
  } finally {
    if (activePngRenderSequence === exportSequence) {
      activePngRenderSequence = null;
      pngButton.disabled = resultsSection.hidden || currentResult?.entries.length === 0 || currentResult === null;
    }
  }
}

function clearPngDownload(): void {
  if (pngObjectUrl !== null) URL.revokeObjectURL(pngObjectUrl);
  pngObjectUrl = null;
  pngDownloadLink.removeAttribute("href");
  pngDownloadLink.hidden = true;
}

function exportJson(): void {
  if (currentResult === null) return;
  const model = currentRenderModel();
  if (model === null) return;
  const exportData = {
    schemaVersion: 2,
    catalogVersion: catalog.catalogVersion,
    ratingRule: "In Falsus B50 v1: Arcaea single-play formula on score / 10, then rating * 10; 100M score is capped.",
    ...currentResult,
    presentation: {
      ...(model.playerName === undefined ? {} : { playerName: model.playerName }),
      entries: model.entries.map((entry) => ({ ...entry, score: entry.score.toString() })),
    },
  };
  const json = JSON.stringify(exportData, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value, 2);
  downloadBlob(new Blob([json], { type: "application/json" }), "in-falsus-b50.json");
  exportStatus.textContent = "JSON 已生成，包含成绩诊断和 B50 展示 metadata。";
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
  if (!(event.relatedTarget instanceof Node) || !dropZone.contains(event.relatedTarget)) {
    dropZone.classList.remove("drop-zone-active");
  }
});
dropZone.addEventListener("drop", (event: DragEvent) => {
  event.preventDefault();
  dropZone.classList.remove("drop-zone-active");
  void processFile(event.dataTransfer?.files[0]);
});
pngButton.addEventListener("click", () => void exportPng());
jsonButton.addEventListener("click", exportJson);
playerNameInput.addEventListener("input", () => {
  if (activePngRenderSequence !== null) {
    pngRenderSequence += 1;
    activePngRenderSequence = null;
    exportStatus.textContent = "名称已更改；请重新生成 PNG。";
    pngButton.disabled = resultsSection.hidden || currentResult?.entries.length === 0 || currentResult === null;
  }
  if (pngObjectUrl !== null) {
    clearPngDownload();
    exportStatus.textContent = "名称已更改；请重新生成 PNG。";
  }
});
