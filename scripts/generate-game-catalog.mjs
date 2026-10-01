import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOutputManifest, serializeJson, sha256, verifyManifestIntegrity } from "./catalog-artifacts.mjs";
import { normalizeGameSongList } from "./game-catalog.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMP_ROOT = path.join(PROJECT_ROOT, ".local", "game-catalog");
const OUTPUT_ROOT = {
  catalog: path.join(PROJECT_ROOT, "src", "catalog"),
  jackets: path.join(PROJECT_ROOT, "public", "assets", "jackets"),
};
const scratchMarkerName = ".b50-game-extractor-owned";
const scratchMarkerValue = "infalsus-b50-game-extraction-v1\n";
const transactionJournalName = ".update-transaction.json";
const transactionCommittedName = ".update-committed";
const transactionCommittedValue = "game-catalog-update-committed-v1\n";
const defaultGameRoot = String.raw`D:\Program Files (x86)\Steam\steamapps\common\In Falsus`;
const generatedManifestName = "generated-manifest.json";

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasOption(name) {
  return process.argv.includes(name);
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

function isInsideOrEqual(child, parent) {
  return child === parent || isInside(child, parent);
}

function isMissing(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function resolveForWrite(target) {
  let cursor = path.resolve(target);
  const missingParts = [];
  for (;;) {
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) throw new Error("Write paths cannot pass through symbolic links: " + cursor + ".");
      if (missingParts.length > 0 && !stat.isDirectory()) throw new Error("A write path parent is not a directory: " + cursor + ".");
      const actual = await realpath(cursor);
      return path.join(actual, ...missingParts.reverse());
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new Error("Cannot resolve a write path safely: " + target + ".");
      missingParts.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function assertProjectWriteTarget(target, gameRoot) {
  const project = await realpath(PROJECT_ROOT);
  const resolved = await resolveForWrite(target);
  if (resolved === project || !isInside(resolved, project)) {
    throw new Error("Refusing a write target outside the project root: " + target + ".");
  }
  if (typeof gameRoot === "string" && gameRoot.length > 0) {
    let game = path.resolve(gameRoot);
    try {
      game = await realpath(gameRoot);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (isInsideOrEqual(resolved, game)) throw new Error("Refusing a write target inside the read-only game installation.");
  }
  return resolved;
}

async function assertRegularDirectory(target, label) {
  try {
    const stat = await lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(label + " must be a regular directory.");
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  return true;
}

async function assertRegularFile(target, label) {
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(label + " must be a regular file.");
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  return true;
}

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function transactionFileTargets(scratch) {
  return [
    { key: "catalog", target: path.join(OUTPUT_ROOT.catalog, "songlist.json"), staged: path.join(scratch, "stage", "songlist.json"), backup: path.join(scratch, "backup", "songlist.json"), kind: "file" },
    { key: "manifest", target: path.join(OUTPUT_ROOT.catalog, generatedManifestName), staged: path.join(scratch, "stage", generatedManifestName), backup: path.join(scratch, "backup", generatedManifestName), kind: "file" },
  ];
}

function validJacketName(name) {
  return typeof name === "string" && /^[A-Za-z0-9._-]+\.webp$/u.test(name);
}

async function assertTargetKind(target, kind, label) {
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error("Refusing to replace a non-regular " + label + ".");
    }
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function assertOwnedMarker(directory, markerName = scratchMarkerName, markerValue = scratchMarkerValue) {
  const marker = path.join(directory, markerName);
  if (!(await assertRegularFile(marker, "extractor ownership marker")) || (await readFile(marker, "utf8")) !== markerValue) {
    throw new Error("Temporary catalog data is missing a recognized ownership marker.");
  }
}

async function removeTarget(target, kind, gameRoot) {
  const safe = await assertProjectWriteTarget(target, gameRoot);
  if (kind === "directory") {
    if (!(await assertTargetKind(safe, "directory", "generated jacket directory"))) return;
  } else if (!(await assertTargetKind(safe, "file", "generated file"))) {
    return;
  }
  await rm(safe, { recursive: kind === "directory", force: false });
}

async function recoverInterruptedUpdate(scratch, gameRoot) {
  await assertOwnedMarker(scratch);
  const committedPath = path.join(scratch, transactionCommittedName);
  if (await assertRegularFile(committedPath, "catalog update commit marker")) {
    if ((await readFile(committedPath, "utf8")) !== transactionCommittedValue) throw new Error("Catalog update commit marker is invalid; preserving scratch for inspection.");
    return;
  }
  const journalPath = path.join(scratch, transactionJournalName);
  if (!(await assertRegularFile(journalPath, "catalog update transaction journal"))) return;
  let journal;
  try {
    journal = JSON.parse(await readFile(journalPath, "utf8"));
  } catch (error) {
    throw new Error("Catalog update transaction journal is unreadable; preserving backups and scratch data.", { cause: error });
  }
  if (!journal || journal.schemaVersion !== 1 || !journal.existed
    || ["catalog", "manifest", "jackets"].some((key) => typeof journal.existed[key] !== "boolean")
    || Object.keys(journal.existed).length !== 3
    || !Array.isArray(journal.oldJackets) || !Array.isArray(journal.newJackets)
    || [...journal.oldJackets, ...journal.newJackets].some((name) => !validJacketName(name))
    || new Set(journal.oldJackets).size !== journal.oldJackets.length
    || new Set(journal.newJackets).size !== journal.newJackets.length
    || (!journal.existed.jackets && journal.oldJackets.length !== 0)) {
    throw new Error("Catalog update transaction journal has an unsupported shape; preserving backups and scratch data.");
  }

  const fileTargets = transactionFileTargets(scratch);
  for (const item of [...fileTargets].reverse()) {
    const target = await assertProjectWriteTarget(item.target, gameRoot);
    const backup = await assertProjectWriteTarget(item.backup, gameRoot);
    const backupExists = await assertTargetKind(backup, item.kind, item.key + " backup");
    const targetExists = await assertTargetKind(target, item.kind, item.key + " output");
    if (journal.existed[item.key]) {
      if (!backupExists) {
        throw new Error("Cannot recover the previous " + item.key + " output; preserving backups and scratch data.");
      }
      if (targetExists) await removeTarget(target, item.kind, gameRoot);
      const backupBytes = await readFile(backup);
      await writeNewFile(target, backupBytes, gameRoot);
    } else if (targetExists) {
      await removeTarget(target, item.kind, gameRoot);
    }
  }

  const jacketDirectory = OUTPUT_ROOT.jackets;
  let jacketDirectoryExists = await assertRegularDirectory(jacketDirectory, "generated jacket directory");
  if ((journal.existed.jackets || journal.oldJackets.length > 0) && !jacketDirectoryExists) {
    await mkdir(await assertProjectWriteTarget(jacketDirectory, gameRoot));
    jacketDirectoryExists = true;
  }
  if (jacketDirectoryExists) {
    const oldNames = new Set(journal.oldJackets);
    const backupJackets = path.join(scratch, "backup", "jackets");
    for (const name of journal.oldJackets) {
      const backup = path.join(backupJackets, name);
      if (!(await assertRegularFile(backup, "jacket backup " + name))) {
        throw new Error("Cannot recover previous jacket " + name + "; preserving backups and scratch data.");
      }
      const target = path.join(jacketDirectory, name);
      if (await assertTargetKind(target, "file", "jacket output " + name)) await removeTarget(target, "file", gameRoot);
      await writeNewFile(target, await readFile(backup), gameRoot);
    }
    for (const name of journal.newJackets) {
      if (oldNames.has(name)) continue;
      const target = path.join(jacketDirectory, name);
      if (await assertTargetKind(target, "file", "jacket output " + name)) await removeTarget(target, "file", gameRoot);
    }
    if (!journal.existed.jackets) {
      const remaining = await readdir(jacketDirectory);
      if (remaining.length > 0) throw new Error("Cannot remove the newly created jacket directory because it contains unexpected files.");
      await rm(await assertProjectWriteTarget(jacketDirectory, gameRoot), { recursive: false, force: false });
    }
  }
}

async function prepareScratch(gameRoot) {
  const project = await realpath(PROJECT_ROOT);
  const local = path.join(project, ".local");
  if (!(await assertRegularDirectory(local, ".local"))) {
    await mkdir(await assertProjectWriteTarget(local, gameRoot));
  }
  const scratch = path.join(local, "game-catalog");
  if (await assertRegularDirectory(scratch, "game-catalog scratch directory")) {
    await assertOwnedMarker(scratch);
    await recoverInterruptedUpdate(scratch, gameRoot);
    const actual = await realpath(scratch);
    if (!isInside(actual, project) || !isInside(actual, local)) throw new Error("Scratch directory resolves outside the project.");
    await rm(await assertProjectWriteTarget(actual, gameRoot), { recursive: true, force: false });
  }
  const safeScratch = await assertProjectWriteTarget(scratch, gameRoot);
  await mkdir(safeScratch);
  await writeFile(await assertProjectWriteTarget(path.join(safeScratch, scratchMarkerName), gameRoot), scratchMarkerValue, { encoding: "utf8", flag: "wx" });
  return safeScratch;
}

async function makeRunDirectory(scratch, runName, gameRoot) {
  if (!["run-a", "run-b", "update"].includes(runName)) throw new Error("Unknown temporary extraction run name.");
  const runRoot = path.join(scratch, runName);
  await mkdir(await assertProjectWriteTarget(runRoot, gameRoot));
  await writeFile(await assertProjectWriteTarget(path.join(runRoot, scratchMarkerName), gameRoot), scratchMarkerValue, { encoding: "utf8", flag: "wx" });
  return runRoot;
}

async function cleanScratch(scratch, gameRoot) {
  if (scratch === undefined) return;
  const project = await realpath(PROJECT_ROOT);
  const expected = path.resolve(project, ".local", "game-catalog");
  if (path.resolve(scratch) !== expected) throw new Error("Refusing to clean an unexpected scratch path.");
  const actual = await realpath(scratch);
  if (!isInside(actual, project) || !isInside(actual, path.join(project, ".local"))) {
    throw new Error("Refusing to clean scratch data outside the project.");
  }
  await assertOwnedMarker(actual);
  await rm(await assertProjectWriteTarget(actual, gameRoot), { recursive: true, force: false });
}

function pythonCommand() {
  const configured = process.env.INFALSUS_PYTHON;
  return typeof configured === "string" && configured.trim() ? configured.trim() : "python";
}

function assertCompleteJackets(songList) {
  const missing = songList.songs.filter((song) => song.charts.some((chart) => chart.available)
    && !song.jacket
    && !song.charts.some((chart) => chart.available && chart.jacket));
  if (missing.length > 0) {
    throw new Error("Available songs are missing jackets: " + missing.map((song) => song.songId + ":" + song.baseName).join(", ") + ".");
  }
}

async function runExtractor(gameRoot, outputRoot) {
  const extractionScript = path.join(PROJECT_ROOT, "scripts", "extract-game-catalog.py");
  const child = spawnSync(pythonCommand(), [extractionScript, "--game-root", gameRoot, "--output", outputRoot], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error("Game data extraction failed with exit code " + String(child.status) + ".");
}

async function readRegularDirectoryFiles(directory, label) {
  if (!(await assertRegularDirectory(directory, label))) throw new Error(label + " is missing.");
  const files = new Map();
  for (const name of await readdir(directory)) {
    const filePath = path.join(directory, name);
    if (!(await assertRegularFile(filePath, label + "/" + name))) throw new Error(label + " contains a non-file entry: " + name + ".");
    files.set(name, await readFile(filePath));
  }
  return files;
}

async function loadRun(runRoot) {
  await assertOwnedMarker(runRoot);
  const extractedPath = path.join(runRoot, "extracted.json");
  if (!(await assertRegularFile(extractedPath, "temporary extracted.json"))) throw new Error("Extractor did not create extracted.json.");
  const extractedBytes = await readFile(extractedPath);
  const extracted = JSON.parse(extractedBytes.toString("utf8"));
  if (!Array.isArray(extracted.jacketSources)) throw new Error("Extractor output has no jacketSources array.");
  const extractedJackets = await readRegularDirectoryFiles(path.join(runRoot, "jackets"), "temporary jacket directory");
  const sourceByKey = new Map(extracted.jacketSources.map((item) => [item.key, item]));
  const expectedSourceNames = new Set(extracted.jacketSources.map((item) => item.key + ".webp"));
  for (const name of expectedSourceNames) if (!extractedJackets.has(name)) throw new Error("Extractor did not create temporary jacket " + name + ".");
  for (const name of extractedJackets.keys()) if (!expectedSourceNames.has(name)) throw new Error("Extractor created an unexpected temporary file: jackets/" + name + ".");
  const normalized = normalizeGameSongList(extracted);
  const preparedAssets = [];
  for (const plan of normalized.assets) {
    const source = sourceByKey.get(plan.sourceKey);
    const sourceBytes = extractedJackets.get(plan.sourceKey + ".webp");
    if (!source || !sourceBytes || source.width !== 320 || source.height !== 320) throw new Error("Jacket plan references a missing 320×320 source.");
    if (sourceBytes.length !== plan.sizeBytes || sha256(sourceBytes) !== plan.sha256) {
      throw new Error("Temporary WebP integrity check failed for " + plan.sourceKey + ".");
    }
    if (sourceBytes.toString("ascii", 0, 4) !== "RIFF" || sourceBytes.toString("ascii", 8, 12) !== "WEBP") {
      throw new Error("Temporary jacket is not a WebP: " + plan.sourceKey + ".");
    }
    preparedAssets.push({ ...plan, bytes: sourceBytes });
  }
  const catalogBytes = serializeJson(normalized.songList);
  const manifest = createOutputManifest({
    catalogBytes,
    sourceFingerprint: normalized.songList.source?.fingerprint,
    jackets: preparedAssets,
    toolchain: extracted.toolchain,
  });
  const manifestBytes = serializeJson(manifest);
  const errors = verifyManifestIntegrity(manifest, catalogBytes, new Map(preparedAssets.map((asset) => [asset.targetFilename, asset.bytes])));
  if (errors.length > 0) throw new Error("Generated output failed its manifest integrity check: " + errors.join(" "));

  const runEntries = new Set([scratchMarkerName, "extracted.json", "jackets"]);
  for (const name of await readdir(runRoot)) if (!runEntries.has(name)) throw new Error("Extractor created an unexpected output: " + name + ".");
  return { extracted, extractedBytes, extractedJackets, normalized, preparedAssets, catalogBytes, manifest, manifestBytes };
}

function assertReproducible(first, second) {
  const differences = [];
  if (!first.extractedBytes.equals(second.extractedBytes)) differences.push("extracted.json bytes differ");
  if (!first.catalogBytes.equals(second.catalogBytes)) differences.push("normalized songlist bytes differ");
  if (!first.manifestBytes.equals(second.manifestBytes)) differences.push("generated manifest semantic content differs");
  const firstNames = [...first.extractedJackets.keys()].sort();
  const secondNames = [...second.extractedJackets.keys()].sort();
  if (JSON.stringify(firstNames) !== JSON.stringify(secondNames)) differences.push("temporary jacket file sets differ");
  for (const name of new Set([...firstNames, ...secondNames])) {
    const left = first.extractedJackets.get(name);
    const right = second.extractedJackets.get(name);
    if (left === undefined || right === undefined) continue;
    if (left.length !== right.length) differences.push("temporary jacket byte count differs: " + name);
    if (sha256(left) !== sha256(right)) differences.push("temporary jacket SHA-256 differs: " + name);
  }
  const firstOutput = new Map(first.preparedAssets.map((asset) => [asset.targetFilename, asset.bytes]));
  const secondOutput = new Map(second.preparedAssets.map((asset) => [asset.targetFilename, asset.bytes]));
  const firstOutputNames = [...firstOutput.keys()].sort();
  const secondOutputNames = [...secondOutput.keys()].sort();
  if (JSON.stringify(firstOutputNames) !== JSON.stringify(secondOutputNames)) differences.push("normalized jacket output file sets differ");
  for (const name of new Set([...firstOutputNames, ...secondOutputNames])) {
    const left = firstOutput.get(name);
    const right = secondOutput.get(name);
    if (left === undefined || right === undefined) continue;
    if (left.length !== right.length) differences.push("normalized jacket byte count differs: " + name);
    if (sha256(left) !== sha256(right)) differences.push("normalized jacket SHA-256 differs: " + name);
  }
  if (differences.length > 0) throw new Error("Deterministic regeneration failed: " + differences.join("; ") + ".");
}

async function readInstalledOutputs() {
  const catalogPath = path.join(OUTPUT_ROOT.catalog, "songlist.json");
  const manifestPath = path.join(OUTPUT_ROOT.catalog, generatedManifestName);
  if (!(await assertRegularFile(catalogPath, "generated songlist.json"))) throw new Error("Generated songlist.json is missing.");
  if (!(await assertRegularFile(manifestPath, "generated output manifest"))) throw new Error("Generated output manifest is missing.");
  const catalogBytes = await readFile(catalogPath);
  const manifestBytes = await readFile(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    throw new Error("Generated output manifest is not valid JSON.", { cause: error });
  }
  const jackets = await readRegularDirectoryFiles(OUTPUT_ROOT.jackets, "generated jacket directory");
  return { catalogBytes, manifestBytes, manifest, jackets };
}

function compareInstalledOutputs(expected, actual) {
  const errors = [
    ...verifyManifestIntegrity(actual.manifest, actual.catalogBytes, actual.jackets),
    ...verifyManifestIntegrity(expected.manifest, actual.catalogBytes, actual.jackets),
  ];
  if (!actual.catalogBytes.equals(expected.catalogBytes)) errors.push("Generated songlist.json is out of date.");
  if (!actual.manifestBytes.equals(expected.manifestBytes)) errors.push("Generated output manifest is out of date.");
  if (errors.length > 0) throw new Error([...new Set(errors)].join(" "));
}

async function assertJacketDirectoryIsManaged(directory) {
  const files = await readRegularDirectoryFiles(directory, "existing generated jacket directory");
  for (const name of files.keys()) {
    if (!validJacketName(name)) throw new Error("Refusing to replace jacket directory containing an unmanaged file: " + name + ".");
  }
  return [...files.keys()].sort();
}

async function writeNewFile(target, bytes, gameRoot) {
  const safe = await assertProjectWriteTarget(target, gameRoot);
  await writeFile(safe, bytes, { flag: "wx" });
}

async function stageOutputs(scratch, artifact, gameRoot) {
  const stageRoot = path.join(scratch, "stage");
  const stageJackets = path.join(stageRoot, "jackets");
  await mkdir(await assertProjectWriteTarget(stageRoot, gameRoot));
  await mkdir(await assertProjectWriteTarget(stageJackets, gameRoot));
  await writeNewFile(path.join(stageRoot, "songlist.json"), artifact.catalogBytes, gameRoot);
  await writeNewFile(path.join(stageRoot, generatedManifestName), artifact.manifestBytes, gameRoot);
  for (const asset of artifact.preparedAssets) await writeNewFile(path.join(stageJackets, asset.targetFilename), asset.bytes, gameRoot);
  const stagedJackets = await readRegularDirectoryFiles(stageJackets, "staged jacket directory");
  const errors = verifyManifestIntegrity(artifact.manifest, await readFile(path.join(stageRoot, "songlist.json")), stagedJackets);
  if (errors.length > 0) throw new Error("Staged outputs failed integrity validation: " + errors.join(" "));
  if (!(await readFile(path.join(stageRoot, generatedManifestName))).equals(artifact.manifestBytes)) throw new Error("Staged manifest bytes changed unexpectedly.");
  return stageRoot;
}

async function installStagedOutputs(scratch, stageRoot, artifact, gameRoot) {
  const files = transactionFileTargets(scratch);
  const existed = { jackets: await assertRegularDirectory(OUTPUT_ROOT.jackets, "generated jacket directory") };
  for (const item of files) {
    await assertProjectWriteTarget(item.target, gameRoot);
    await assertProjectWriteTarget(item.staged, gameRoot);
    await assertProjectWriteTarget(item.backup, gameRoot);
    existed[item.key] = await assertTargetKind(item.target, item.kind, item.key + " output");
  }
  const oldJackets = existed.jackets ? await assertJacketDirectoryIsManaged(OUTPUT_ROOT.jackets) : [];
  const newJackets = artifact.preparedAssets.map((asset) => asset.targetFilename).sort();
  const backupRoot = path.join(scratch, "backup");
  await mkdir(await assertProjectWriteTarget(backupRoot, gameRoot));
  const backupJackets = path.join(backupRoot, "jackets");
  await mkdir(await assertProjectWriteTarget(backupJackets, gameRoot));
  for (const item of files) {
    if (existed[item.key]) await writeNewFile(item.backup, await readFile(item.target), gameRoot);
  }
  for (const name of oldJackets) {
    await writeNewFile(path.join(backupJackets, name), await readFile(path.join(OUTPUT_ROOT.jackets, name)), gameRoot);
  }
  const journal = { schemaVersion: 1, existed, oldJackets, newJackets };
  await writeNewFile(path.join(scratch, transactionJournalName), Buffer.from(JSON.stringify(journal) + "\n", "utf8"), gameRoot);

  try {
    for (const item of files) {
      if (existed[item.key]) await removeTarget(item.target, "file", gameRoot);
    }
    if (!existed.jackets) await mkdir(await assertProjectWriteTarget(OUTPUT_ROOT.jackets, gameRoot));
    const expectedJackets = new Set(newJackets);
    for (const name of oldJackets) {
      if (!expectedJackets.has(name)) await removeTarget(path.join(OUTPUT_ROOT.jackets, name), "file", gameRoot);
    }
    for (const asset of artifact.preparedAssets) {
      const target = path.join(OUTPUT_ROOT.jackets, asset.targetFilename);
      if (await assertTargetKind(target, "file", "generated jacket")) await removeTarget(target, "file", gameRoot);
      await rename(await assertProjectWriteTarget(path.join(stageRoot, "jackets", asset.targetFilename), gameRoot), await assertProjectWriteTarget(target, gameRoot));
    }
    for (const item of files) {
      await rename(await assertProjectWriteTarget(item.staged, gameRoot), await assertProjectWriteTarget(item.target, gameRoot));
    }
    const installed = await readInstalledOutputs();
    compareInstalledOutputs(artifact, installed);
    const committed = path.join(scratch, transactionCommittedName);
    await writeNewFile(committed, Buffer.from(transactionCommittedValue, "utf8"), gameRoot);
  } catch (error) {
    try {
      await recoverInterruptedUpdate(scratch, gameRoot);
    } catch (recoveryError) {
      const failure = new Error("Catalog update failed and automatic rollback could not finish; the owned scratch directory and backups were preserved. " + (recoveryError instanceof Error ? recoveryError.message : ""), { cause: error });
      failure.preserveScratch = true;
      throw failure;
    }
    throw error;
  }
}

function summarize(artifact) {
  const songs = artifact.normalized.songList.songs;
  const charts = songs.flatMap((song) => song.charts);
  const availableCharts = charts.filter((chart) => chart.available);
  const difficultyCounts = [0, 1, 2, 3].map((index) => charts.filter((chart) => chart.difficultyIndex === index).length);
  const availableDifficultyCounts = [0, 1, 2, 3].map((index) => availableCharts.filter((chart) => chart.difficultyIndex === index).length);
  return { songs: songs.length, charts: charts.length, availableCharts: availableCharts.length, difficultyCounts, availableDifficultyCounts, jackets: artifact.preparedAssets.length };
}

function logSummary(verb, artifact) {
  const summary = summarize(artifact);
  console.log(`${verb} game songlist: ${summary.songs} songs, ${summary.charts} charts (${summary.availableCharts} available), difficulties ${summary.difficultyCounts.join("/")} total and ${summary.availableDifficultyCounts.join("/")} available, ${summary.jackets} verified 320×320 WebP jackets.`);
  console.log("Source fingerprint: " + artifact.normalized.songList.source.fingerprint);
}

async function run() {
  const gameRoot = readOption("--game-root") ?? defaultGameRoot;
  const checkOnly = hasOption("--check");
  if (checkOnly && hasOption("--update")) throw new Error("Choose either --check or --update, not both.");
  if (!checkOnly && !hasOption("--update")) throw new Error("Use --check to verify or --update to replace generated outputs.");

  let scratch;
  let preserveScratch = false;
  try {
    scratch = await prepareScratch(gameRoot);
    if (checkOnly) {
      const runA = await makeRunDirectory(scratch, "run-a", gameRoot);
      await runExtractor(gameRoot, runA);
      const first = await loadRun(runA);
      const runB = await makeRunDirectory(scratch, "run-b", gameRoot);
      await runExtractor(gameRoot, runB);
      const second = await loadRun(runB);
      assertReproducible(first, second);
      compareInstalledOutputs(first, await readInstalledOutputs());
      logSummary("Verified", first);
      console.log(`Deterministic regeneration passed: songlist bytes, output manifest, ${first.preparedAssets.length} jackets, and file sets match across both runs.`);
      console.log("Committed generated snapshot matches the current game installation and its output manifest.");
      return;
    }

    const runRoot = await makeRunDirectory(scratch, "update", gameRoot);
    await runExtractor(gameRoot, runRoot);
    const artifact = await loadRun(runRoot);
    if (hasOption("--require-complete-jackets")) assertCompleteJackets(artifact.normalized.songList);
    const stageRoot = await stageOutputs(scratch, artifact, gameRoot);
    await installStagedOutputs(scratch, stageRoot, artifact, gameRoot);
    compareInstalledOutputs(artifact, await readInstalledOutputs());
    logSummary("Updated", artifact);
    console.log("Generated songlist, output manifest, and jackets were validated and installed.");
  } catch (error) {
    if (error && typeof error === "object" && "preserveScratch" in error && error.preserveScratch === true) preserveScratch = true;
    throw error;
  } finally {
    if (scratch !== undefined && !preserveScratch) await cleanScratch(scratch, gameRoot);
    else if (preserveScratch) console.error("Temporary catalog backup retained at .local/game-catalog for safe recovery.");
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Game catalog generation failed.");
  process.exitCode = 1;
});
