import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diffGameCatalogAgainstRa } from "./game-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gameCatalogPath = path.join(root, "src", "catalog", "songlist.json");
const raPathIndex = process.argv.indexOf("--rhythm-archive-catalog");
const raCatalogPath = raPathIndex >= 0 ? process.argv[raPathIndex + 1] : undefined;

async function run() {
  if (!raCatalogPath) {
    throw new Error("Usage: npm run catalog:diff -- --rhythm-archive-catalog <Rhythm-Archive>/catalog/index.json");
  }
  const gameCatalog = JSON.parse(await readFile(gameCatalogPath, "utf8"));
  const raCatalog = JSON.parse(await readFile(path.resolve(raCatalogPath), "utf8"));
  const diff = diffGameCatalogAgainstRa(gameCatalog, raCatalog);
  const counts = Object.fromEntries(Object.entries(diff).map(([key, rows]) => [key, rows.length]));
  console.log(JSON.stringify({ counts, diff }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Catalog comparison failed.");
  process.exitCode = 1;
});
