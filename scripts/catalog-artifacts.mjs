import { createHash } from "node:crypto";

const SHA256 = /^[a-f0-9]{64}$/u;
const JACKET_NAME = /^[A-Za-z0-9._-]+\.webp$/u;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function serializeJson(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function createOutputManifest({ catalogBytes, sourceFingerprint, jackets, toolchain }) {
  if (!Buffer.isBuffer(catalogBytes)) throw new Error("Catalog bytes must be a Buffer.");
  if (typeof sourceFingerprint !== "string" || !SHA256.test(sourceFingerprint)) {
    throw new Error("The output manifest requires a lowercase source fingerprint.");
  }
  if (!toolchain || typeof toolchain.unityPy !== "string" || typeof toolchain.pillow !== "string" || typeof toolchain.webp !== "string") {
    throw new Error("The output manifest requires UnityPy, Pillow, and WebP encoder provenance.");
  }
  const jacketRows = [...jackets].sort((left, right) => left.targetFilename < right.targetFilename ? -1 : left.targetFilename > right.targetFilename ? 1 : 0);
  const jacketManifest = {};
  for (const jacket of jacketRows) {
    if (!JACKET_NAME.test(jacket.targetFilename) || !Buffer.isBuffer(jacket.bytes)) {
      throw new Error("The output manifest received an invalid jacket artifact.");
    }
    jacketManifest[jacket.targetFilename] = {
      sha256: sha256(jacket.bytes),
      bytes: jacket.bytes.length,
    };
  }
  return {
    schemaVersion: 1,
    sourceFingerprint,
    catalogSha256: sha256(catalogBytes),
    catalogBytes: catalogBytes.length,
    toolchain: { unityPy: toolchain.unityPy, pillow: toolchain.pillow, webp: toolchain.webp },
    jackets: jacketManifest,
  };
}

export function verifyManifestIntegrity(manifest, catalogBytes, jacketFiles) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || manifest.schemaVersion !== 1) {
    return ["Generated output manifest has an unsupported schema."];
  }
  if (typeof manifest.sourceFingerprint !== "string" || !SHA256.test(manifest.sourceFingerprint)) {
    errors.push("Generated output manifest has an invalid sourceFingerprint.");
  }
  if (!Buffer.isBuffer(catalogBytes)) {
    errors.push("Generated songlist is missing or is not a regular file.");
  } else {
    if (manifest.catalogBytes !== catalogBytes.length) errors.push("Generated songlist byte count does not match the manifest.");
    if (manifest.catalogSha256 !== sha256(catalogBytes)) errors.push("Generated songlist SHA-256 does not match the manifest.");
    try {
      const catalog = JSON.parse(catalogBytes.toString("utf8"));
      if (catalog?.source?.fingerprint !== manifest.sourceFingerprint) {
        errors.push("Generated output manifest sourceFingerprint does not match songlist.json.");
      }
    } catch {
      errors.push("Generated songlist is not valid JSON.");
    }
  }
  if (!manifest.toolchain || typeof manifest.toolchain.unityPy !== "string"
    || typeof manifest.toolchain.pillow !== "string" || typeof manifest.toolchain.webp !== "string") {
    errors.push("Generated output manifest has invalid toolchain provenance.");
  }
  if (!manifest.jackets || typeof manifest.jackets !== "object" || Array.isArray(manifest.jackets)) {
    errors.push("Generated output manifest jackets must be an object.");
    return errors;
  }
  const expectedNames = new Set(Object.keys(manifest.jackets));
  for (const name of expectedNames) {
    const entry = manifest.jackets[name];
    if (!JACKET_NAME.test(name) || !entry || typeof entry !== "object" || Array.isArray(entry)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) {
      errors.push("Invalid jacket entry in generated output manifest: " + name + ".");
    }
  }
  const actualNames = new Set(jacketFiles.keys());
  for (const name of [...expectedNames].sort()) {
    if (!actualNames.has(name)) {
      errors.push("Missing generated jacket " + name + ".");
      continue;
    }
    const entry = manifest.jackets[name];
    const bytes = jacketFiles.get(name);
    if (!Buffer.isBuffer(bytes)) {
      errors.push("Generated jacket is not a regular file: " + name + ".");
      continue;
    }
    if (bytes.length !== entry.bytes) errors.push("Generated jacket byte count does not match the manifest: " + name + ".");
    if (sha256(bytes) !== entry.sha256) errors.push("Generated jacket SHA-256 does not match the manifest: " + name + ".");
  }
  for (const name of [...actualNames].filter((item) => !expectedNames.has(item)).sort()) {
    errors.push("Unexpected generated jacket " + name + ".");
  }
  return errors;
}
