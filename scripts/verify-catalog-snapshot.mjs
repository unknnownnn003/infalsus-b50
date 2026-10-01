import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyManifestIntegrity } from "./catalog-artifacts.mjs";
import { normalizeGameSongList } from "./game-catalog.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = path.join(PROJECT_ROOT, "src", "catalog", "songlist.json");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "src", "catalog", "generated-manifest.json");
const JACKET_DIRECTORY = path.join(PROJECT_ROOT, "public", "assets", "jackets");
const JACKET_NAME = /^[A-Za-z0-9._-]+\.webp$/u;

async function readRegularFile(filePath, label) {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(label + " must be a regular file.");
  return readFile(filePath);
}

async function readJackets() {
  const stat = await lstat(JACKET_DIRECTORY);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Generated jacket path must be a regular directory.");
  const jackets = new Map();
  for (const name of await readdir(JACKET_DIRECTORY)) {
    if (!JACKET_NAME.test(name)) throw new Error("Unexpected file in generated jacket directory: " + name + ".");
    const bytes = await readRegularFile(path.join(JACKET_DIRECTORY, name), "Generated jacket " + name);
    if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
      throw new Error("Generated jacket is not a WebP: " + name + ".");
    }
    jackets.set(name, bytes);
  }
  return jackets;
}

async function main() {
  const catalogBytes = await readRegularFile(CATALOG_PATH, "Generated songlist");
  const manifestBytes = await readRegularFile(MANIFEST_PATH, "Generated manifest");
  const catalogInput = JSON.parse(catalogBytes.toString("utf8"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const catalog = normalizeGameSongList(catalogInput).songList;
  const jackets = await readJackets();
  const errors = verifyManifestIntegrity(manifest, catalogBytes, jackets);
  const referenced = new Set();

  for (const song of catalog.songs) {
    const availableCharts = song.charts.filter((chart) => chart.available);
    if (availableCharts.length > 0 && !song.jacket && !availableCharts.some((chart) => chart.jacket)) {
      errors.push("Available charts for song " + song.songId + " have no jacket.");
    }
    for (const reference of [
      song.jacket,
      ...song.charts.map((chart) => chart.jacket),
    ]) {
      if (reference === undefined) continue;
      const filename = reference.slice("assets/jackets/".length);
      referenced.add(filename);
      if (!Object.hasOwn(manifest?.jackets ?? {}, filename)) {
        errors.push("Catalog jacket reference is missing from the manifest: " + reference + ".");
      }
      if (!jackets.has(filename)) errors.push("Catalog jacket reference is missing a file: " + reference + ".");
    }
  }

  if (errors.length > 0) throw new Error([...new Set(errors)].join("\n"));
  const chartCount = catalog.songs.reduce((sum, song) => sum + song.charts.length, 0);
  const availableCount = catalog.songs.reduce((sum, song) => sum + song.charts.filter((chart) => chart.available).length, 0);
  console.log(
    "Verified committed catalog snapshot: "
    + catalog.songs.length + " songs, " + chartCount + " charts (" + availableCount
    + " available), " + jackets.size + " manifest-verified WebP jackets and "
    + referenced.size + " referenced jacket files.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Committed catalog snapshot verification failed.");
  process.exitCode = 1;
});
