import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

const emitCatalogSnapshots: Plugin = {
  name: "infalsus-b50-catalog-snapshots",
  apply: "build",
  generateBundle() {
    for (const name of ["songlist.json", "generated-manifest.json"]) {
      const sourcePath = new URL("./src/catalog/" + name, import.meta.url);
      this.emitFile({
        type: "asset",
        fileName: "catalog/" + name,
        source: readFileSync(sourcePath),
      });
    }
  },
};

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/infalsus-b50/" : "/",
  plugins: command === "build" ? [emitCatalogSnapshots] : [],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
  },
}));
