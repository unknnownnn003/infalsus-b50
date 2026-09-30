import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeGameSongList } from "./game-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratchRelative = path.join(".local", "game-catalog");
const scratchMarkerName = ".b50-game-extractor-owned";
const scratchMarkerValue = "infalsus-b50-game-extraction-v1\n";
const jacketsRelative = path.join("public", "assets", "jackets");
const catalogRelative = path.join("src", "catalog", "songlist.json");
const defaultGameRoot = String.raw`D:\Program Files (x86)\Steam\steamapps\common\In Falsus`;

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasOption(name) {
  return process.argv.includes(name);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

async function assertRegularDirectory(target, label) {
  try {
    const stat = await lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(label + " must be a regular directory.");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  return true;
}

async function assertRegularFile(target, label) {
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(label + " must be a regular file.");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  return true;
}

async function prepareScratch() {
  const project = await realpath(root);
  const local = path.join(project, ".local");
  if (!(await assertRegularDirectory(local, ".local"))) await mkdir(local);
  const scratch = path.join(local, "game-catalog");
  const resolvedScratch = path.resolve(scratch);
  if (!isInside(resolvedScratch, local)) throw new Error("Scratch directory escaped the project-local boundary.");
  if (await assertRegularDirectory(scratch, "game-catalog scratch directory")) {
    const marker = path.join(scratch, scratchMarkerName);
    if (!(await assertRegularFile(marker, "scratch ownership marker"))) {
      throw new Error("The .local/game-catalog directory already exists and is not owned by this extractor.");
    }
    if ((await readFile(marker, "utf8")) !== scratchMarkerValue) {
      throw new Error("The .local/game-catalog ownership marker is not recognized.");
    }
    const actual = await realpath(scratch);
    if (!isInside(actual, project) || !isInside(actual, local)) throw new Error("Scratch directory resolves outside the project.");
    await rm(actual, { recursive: true, force: false });
  }
  await mkdir(scratch);
  await writeFile(path.join(scratch, scratchMarkerName), scratchMarkerValue, "utf8");
  return scratch;
}

async function cleanScratch(scratch) {
  if (scratch === undefined) return;
  const project = await realpath(root);
  const expected = path.resolve(project, scratchRelative);
  if (path.resolve(scratch) !== expected) throw new Error("Refusing to clean an unexpected scratch path.");
  const actual = await realpath(scratch);
  if (!isInside(actual, project) || !isInside(actual, path.join(project, ".local"))) {
    throw new Error("Refusing to clean scratch data outside the project.");
  }
  const marker = path.join(actual, scratchMarkerName);
  if (!(await assertRegularFile(marker, "scratch ownership marker")) || (await readFile(marker, "utf8")) !== scratchMarkerValue) {
    throw new Error("Refusing to clean a scratch directory without the ownership marker.");
  }
  await rm(actual, { recursive: true, force: false });
}

function pythonCommand() {
  const configured = process.env.INFALSUS_PYTHON;
  return typeof configured === "string" && configured.trim() ? configured.trim() : "python";
}

function collectJacketPaths(snapshot) {
  const result = new Set();
  if (!snapshot || typeof snapshot !== "object") return result;
  const add = (value) => {
    if (typeof value === "string" && /^assets\/jackets\/[A-Za-z0-9._-]+\.webp$/u.test(value)) result.add(value);
  };
  if (Array.isArray(snapshot.songs)) {
    for (const song of snapshot.songs) {
      if (!song || typeof song !== "object") continue;
      add(song.jacket);
      if (Array.isArray(song.charts)) for (const chart of song.charts) if (chart && typeof chart === "object") add(chart.jacket);
    }
  }
  if (Array.isArray(snapshot.charts)) {
    for (const chart of snapshot.charts) {
      if (!chart || typeof chart !== "object") continue;
      if (chart.jacket && typeof chart.jacket === "object") add(chart.jacket.thumbnail);
    }
  }
  return result;
}

async function previousJacketPaths(catalogDirectory) {
  const paths = new Set();
  const currentSonglist = path.join(catalogDirectory, path.basename(catalogRelative));
  const relativeFiles = await assertRegularFile(currentSonglist, catalogRelative)
    ? [currentSonglist]
    : [path.join(catalogDirectory, "catalog.json")];
  for (const sourcePath of relativeFiles) {
    if (!(await assertRegularFile(sourcePath, sourcePath))) continue;
    try {
      const snapshot = JSON.parse(await readFile(sourcePath, "utf8"));
      for (const jacket of collectJacketPaths(snapshot)) paths.add(jacket);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return paths;
}

function currentJacketPaths(songList) {
  return collectJacketPaths(songList);
}

function jacketPathToFilename(jacketPath) {
  return jacketPath.slice("assets/jackets/".length);
}

async function resolveProjectDirectoryChain(components, label, createMissing) {
  const project = await realpath(root);
  let target = project;
  const traversed = [];
  for (const component of components) {
    traversed.push(component);
    target = path.join(target, component);
    if (!(await assertRegularDirectory(target, label))) {
      if (!createMissing) throw new Error(label + " is missing.");
      await mkdir(target);
    }
    const actual = await realpath(target);
    if (!isInside(actual, project)) throw new Error(label + " resolves outside the project.");
    const expected = path.resolve(project, ...traversed);
    if (path.relative(expected, actual) !== "") throw new Error(label + " resolves through an unexpected directory link.");
    target = actual;
  }
  return target;
}

async function assertJacketDirectory(createMissing = true) {
  return resolveProjectDirectoryChain(jacketsRelative.split(path.sep), "jacket output directory", createMissing);
}

async function loadExpectedAssets(scratch, plans, extracted) {
  const sourceByKey = new Map(extracted.jacketSources.map((item) => [item.key, item]));
  const prepared = [];
  for (const plan of plans) {
    const source = sourceByKey.get(plan.sourceKey);
    if (!source || source.width !== 320 || source.height !== 320) throw new Error("Jacket plan references a missing 320×320 source.");
    const sourcePath = path.join(scratch, "jackets", plan.sourceKey + ".webp");
    const bytes = await readFile(sourcePath);
    if (bytes.length !== plan.sizeBytes || sha256(bytes) !== plan.sha256) {
      throw new Error("Temporary WebP integrity check failed for " + plan.sourceKey + ".");
    }
    if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
      throw new Error("Temporary jacket is not a WebP: " + plan.sourceKey + ".");
    }
    prepared.push({ ...plan, bytes });
  }
  return prepared;
}

function assertCompleteJackets(songList) {
  const missing = songList.songs.filter((song) => song.charts.some((chart) => chart.available)
    && !song.jacket
    && !song.charts.some((chart) => chart.available && chart.jacket));
  if (missing.length > 0) {
    throw new Error("Available songs are missing jackets: " + missing.map((song) => song.songId + ":" + song.baseName).join(", ") + ".");
  }
}

async function verifyOrWriteOutputs(songList, preparedAssets, checkOnly) {
  const catalogDirectory = await resolveProjectDirectoryChain(["src", "catalog"], "catalog output directory", false);
  const catalogPath = path.join(catalogDirectory, path.basename(catalogRelative));
  const jacketRoot = await assertJacketDirectory(!checkOnly);
  const expectedCatalog = JSON.stringify(songList, null, 2) + "\n";
  const oldPaths = await previousJacketPaths(catalogDirectory);
  const nextPaths = currentJacketPaths(songList);
  const staleNames = [...oldPaths].filter((item) => !nextPaths.has(item)).map(jacketPathToFilename).sort();

  if (checkOnly) {
    await assertRegularFile(catalogPath, catalogRelative);
    if ((await readFile(catalogPath, "utf8")) !== expectedCatalog) throw new Error("Generated songlist.json is out of date; run npm run catalog:generate.");
    for (const asset of preparedAssets) {
      const target = path.join(jacketRoot, asset.targetFilename);
      if (!(await assertRegularFile(target, asset.targetFilename))) throw new Error("Missing generated jacket " + asset.targetFilename + ".");
      const bytes = await readFile(target);
      if (bytes.length !== asset.sizeBytes || sha256(bytes) !== asset.sha256) throw new Error("Generated jacket is out of date: " + asset.targetFilename + ".");
    }
    for (const filename of staleNames) {
      if (await assertRegularFile(path.join(jacketRoot, filename), filename)) throw new Error("Stale generated jacket remains: " + filename + ".");
    }
    return;
  }

  try {
    const stat = await lstat(catalogPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Refusing to replace non-regular songlist output.");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  for (const asset of preparedAssets) {
    const target = path.join(jacketRoot, asset.targetFilename);
    const actualParent = await realpath(path.dirname(target));
    if (actualParent !== await realpath(jacketRoot)) throw new Error("Jacket target escaped the generated output directory.");
    try {
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Refusing to replace non-regular jacket output " + asset.targetFilename + ".");
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    await writeFile(target, asset.bytes);
  }
  await writeFile(catalogPath, expectedCatalog, "utf8");
  for (const filename of staleNames) {
    const target = path.join(jacketRoot, filename);
    if (await assertRegularFile(target, filename)) await rm(target, { force: false });
  }
  const expectedNames = new Set(preparedAssets.map((asset) => asset.targetFilename.toLowerCase()));
  for (const name of await readdir(jacketRoot)) {
    if (name.toLowerCase().endsWith(".webp") && !expectedNames.has(name.toLowerCase())) {
      throw new Error("Unreferenced jacket WebP remains in the generated directory: " + name + ".");
    }
  }
}

async function run() {
  const gameRoot = readOption("--game-root") ?? defaultGameRoot;
  const scratch = await prepareScratch();
  try {
    const extractionScript = path.join(root, "scripts", "extract-game-catalog.py");
    const child = spawnSync(pythonCommand(), [extractionScript, "--game-root", gameRoot, "--output", scratch], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error("Game data extraction failed with exit code " + String(child.status) + ".");

    const extracted = JSON.parse(await readFile(path.join(scratch, "extracted.json"), "utf8"));
    const normalized = normalizeGameSongList(extracted);
    const preparedAssets = await loadExpectedAssets(scratch, normalized.assets, extracted);
    if (hasOption("--require-complete-jackets")) assertCompleteJackets(normalized.songList);
    await verifyOrWriteOutputs(normalized.songList, preparedAssets, hasOption("--check"));
    const charts = normalized.songList.songs.flatMap((song) => song.charts);
    const availableCharts = charts.filter((chart) => chart.available);
    const difficultyCounts = [0, 1, 2, 3].map((index) => charts.filter((chart) => chart.difficultyIndex === index).length);
    const availableDifficultyCounts = [0, 1, 2, 3].map((index) => availableCharts.filter((chart) => chart.difficultyIndex === index).length);
    const verb = hasOption("--check") ? "Verified" : "Generated";
    console.log(`${verb} game songlist: ${normalized.songList.songs.length} songs, ${charts.length} charts (${availableCharts.length} available), difficulties ${difficultyCounts.join("/")} total and ${availableDifficultyCounts.join("/")} available, ${preparedAssets.length} verified 320×320 WebP jackets.`);
    console.log("Source fingerprint: " + (normalized.songList.source?.fingerprint ?? "not recorded"));
  } finally {
    await cleanScratch(scratch);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Game catalog generation failed.");
  process.exitCode = 1;
});
