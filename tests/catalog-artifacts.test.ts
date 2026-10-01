import { describe, expect, it } from "vitest";
import { createOutputManifest, serializeJson, verifyManifestIntegrity } from "../scripts/catalog-artifacts.mjs";

const fingerprint = "a".repeat(64);
const catalogBytes = Buffer.from(`{"schemaVersion":1,"source":{"fingerprint":"${fingerprint}"}}\n`, "utf8");
const jacketBytes = Buffer.from("RIFF0000WEBPdeterministic-bytes", "ascii");

function manifest() {
  return createOutputManifest({
    catalogBytes,
    sourceFingerprint: fingerprint,
    jackets: [
      { targetFilename: "zeta.webp", bytes: Buffer.from("zeta") },
      { targetFilename: "alpha.webp", bytes: jacketBytes },
    ],
    toolchain: { unityPy: "1.25.0", pillow: "12.1.1", webp: "1.6.0" },
  });
}

describe("generated catalog output manifest", () => {
  it("serializes a stable semantic manifest with sorted jacket entries", () => {
    const first = manifest();
    const second = manifest();
    expect(serializeJson(first).equals(serializeJson(second))).toBe(true);
    expect(Object.keys(first.jackets)).toEqual(["alpha.webp", "zeta.webp"]);
    expect(JSON.stringify(first)).not.toMatch(/time|path|date/iu);
  });

  it("accepts a complete matching generated file set", () => {
    const expected = manifest();
    const actual = new Map([
      ["alpha.webp", jacketBytes],
      ["zeta.webp", Buffer.from("zeta")],
    ]);
    expect(verifyManifestIntegrity(expected, catalogBytes, actual)).toEqual([]);
  });

  it("requires the manifest source fingerprint to match songlist.json", () => {
    const wrongFingerprint = { ...manifest(), sourceFingerprint: "b".repeat(64) };
    const actual = new Map([["alpha.webp", jacketBytes], ["zeta.webp", Buffer.from("zeta")]]);
    expect(verifyManifestIntegrity(wrongFingerprint, catalogBytes, actual)).toContain(
      "Generated output manifest sourceFingerprint does not match songlist.json.",
    );
  });

  it("reports a missing generated file", () => {
    expect(verifyManifestIntegrity(manifest(), catalogBytes, new Map())).toContain("Missing generated jacket alpha.webp.");
  });

  it("reports an extra generated file", () => {
    const actual = new Map([
      ["alpha.webp", jacketBytes],
      ["zeta.webp", Buffer.from("zeta")],
      ["extra.webp", Buffer.from("extra")],
    ]);
    expect(verifyManifestIntegrity(manifest(), catalogBytes, actual)).toContain("Unexpected generated jacket extra.webp.");
  });

  it("reports a wrong jacket hash", () => {
    const actual = new Map([["alpha.webp", Buffer.from("RIFF0000WEBPcorrupt", "ascii")], ["zeta.webp", Buffer.from("zeta")]]);
    expect(verifyManifestIntegrity(manifest(), catalogBytes, actual)).toContain("Generated jacket SHA-256 does not match the manifest: alpha.webp.");
  });

  it("reports a wrong jacket byte count", () => {
    const wrongSize = manifest();
    wrongSize.jackets["alpha.webp"]!.bytes += 1;
    const actual = new Map([["alpha.webp", jacketBytes], ["zeta.webp", Buffer.from("zeta")]]);
    expect(verifyManifestIntegrity(wrongSize, catalogBytes, actual)).toContain("Generated jacket byte count does not match the manifest: alpha.webp.");
  });
});
