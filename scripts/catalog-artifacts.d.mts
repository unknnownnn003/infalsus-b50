export interface JacketArtifact {
  targetFilename: string;
  bytes: Buffer;
}

export interface GeneratedOutputManifest {
  schemaVersion: 1;
  sourceFingerprint: string;
  catalogSha256: string;
  catalogBytes: number;
  toolchain: { unityPy: string; pillow: string; webp: string };
  jackets: Record<string, { sha256: string; bytes: number }>;
}

export function sha256(bytes: Buffer): string;
export function serializeJson(value: unknown): Buffer;
export function createOutputManifest(args: {
  catalogBytes: Buffer;
  sourceFingerprint: string | undefined;
  jackets: JacketArtifact[];
  toolchain: { unityPy?: string; pillow?: string; webp?: string } | undefined;
}): GeneratedOutputManifest;
export function verifyManifestIntegrity(manifest: unknown, catalogBytes: Buffer | undefined, jacketFiles: Map<string, Buffer>): string[];
