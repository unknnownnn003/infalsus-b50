import { BinaryReader } from "./binary-reader";
import { SaveParseError } from "./errors";
import type { ScoreRecord } from "./types";

const RECORD_PAYLOAD_BYTES = 99;
const PLAYER_SCORE_OFFSET = 0x53;
const MAX_RECORDS = 10_000;
const MIN_RECORDS_FOR_VALIDATION = 3;
const MAX_BASENAME_BYTES = 256;
const MIN_ELEMENT_BYTES = 1 + 8 + 1 + RECORD_PAYLOAD_BYTES;
export const MAX_SAVE_FILE_BYTES = 64 * 1024 * 1024;
const VALID_DIFFICULTY_FLAGS = new Set([1, 2, 4, 8]);

interface Candidate {
  arrayOffset: number;
  records: ScoreRecord[];
}

function readAsciiBaseName(reader: BinaryReader, stringOffset: number): string | null {
  if (!reader.hasRange(stringOffset, 8)) return null;

  const encodedLength = reader.readInt32LE(stringOffset);
  const byteLength = reader.readInt32LE(stringOffset + 4);
  if (
    byteLength < 1
    || byteLength > MAX_BASENAME_BYTES
    || encodedLength !== -(byteLength + 1)
    || !reader.hasRange(stringOffset + 8, byteLength)
  ) {
    return null;
  }

  const bytes = reader.readBytes(stringOffset + 8, byteLength);
  let name = "";
  for (const byte of bytes) {
    // Upstream identifies song names as printable ASCII basenames.
    if (byte < 0x20 || byte > 0x7e) return null;
    name += String.fromCharCode(byte);
  }
  return name;
}

function parseElement(reader: BinaryReader, elementOffset: number): ScoreRecord | null {
  if (!reader.hasRange(elementOffset, 1)) return null;

  const baseName = readAsciiBaseName(reader, elementOffset + 1);
  if (baseName === null) return null;

  const payloadOffset = elementOffset + 1 + 8 + baseName.length;
  if (!reader.hasRange(payloadOffset, RECORD_PAYLOAD_BYTES)) return null;

  const songId = reader.readUint16LE(payloadOffset);
  const difficultyFlag = reader.readUint8(payloadOffset + 2);
  const repeatedSongId = reader.readUint16LE(payloadOffset + 3);
  const repeatedDifficultyFlag = reader.readUint8(payloadOffset + 5);
  if (
    songId !== repeatedSongId
    || difficultyFlag !== repeatedDifficultyFlag
    || !VALID_DIFFICULTY_FLAGS.has(difficultyFlag)
  ) {
    return null;
  }

  const score = reader.readBigInt64LE(payloadOffset + PLAYER_SCORE_OFFSET);
  if (score < 0n) return null;

  return {
    songId,
    difficultyIndex: Math.log2(difficultyFlag),
    score,
  };
}

function parseCandidate(reader: BinaryReader, firstElementOffset: number, expectedCount: number): Candidate | null {
  if (
    expectedCount < MIN_RECORDS_FOR_VALIDATION
    || expectedCount > MAX_RECORDS
    || expectedCount * MIN_ELEMENT_BYTES > reader.length - firstElementOffset
  ) {
    return null;
  }

  const records: ScoreRecord[] = [];
  const seenIdentities = new Set<string>();
  let elementOffset = firstElementOffset;

  for (let i = 0; i < expectedCount; i += 1) {
    const record = parseElement(reader, elementOffset);
    if (record === null) return null;

    const identity = `${record.songId}:${record.difficultyIndex}`;
    if (seenIdentities.has(identity)) return null;
    seenIdentities.add(identity);
    records.push(record);

    const baseNameLength = reader.readInt32LE(elementOffset + 1 + 4);
    elementOffset += 1 + 8 + baseNameLength + RECORD_PAYLOAD_BYTES;
  }

  return { arrayOffset: firstElementOffset - 4, records };
}

export function parseSaveFile(input: ArrayBuffer | Uint8Array): ScoreRecord[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_SAVE_FILE_BYTES) {
    throw new SaveParseError("file-too-large", "存档超过支持的大小上限。请确认选择的是游戏存档文件。");
  }
  if (bytes.byteLength < 4 + MIN_RECORDS_FOR_VALIDATION * MIN_ELEMENT_BYTES) {
    throw new SaveParseError("file-too-small", "文件太小，无法包含有效的成绩记录数组。");
  }

  const reader = new BinaryReader(bytes);
  const candidates: Candidate[] = [];

  // The array header is a signed i32 immediately before the first serialized item.
  // Every accepted candidate must then contain exactly that many contiguous, valid records.
  for (let firstElementOffset = 4; firstElementOffset <= reader.length - MIN_ELEMENT_BYTES; firstElementOffset += 1) {
    const declaredCount = reader.readInt32LE(firstElementOffset - 4);
    if (
      declaredCount < MIN_RECORDS_FOR_VALIDATION
      || declaredCount > MAX_RECORDS
      || declaredCount * MIN_ELEMENT_BYTES > reader.length - firstElementOffset
    ) {
      continue;
    }

    const candidate = parseCandidate(reader, firstElementOffset, declaredCount);
    if (candidate !== null) candidates.push(candidate);
  }

  if (candidates.length === 0) {
    throw new SaveParseError(
      "unsupported-format",
      "未能验证成绩记录数组。存档可能已损坏或使用了尚不支持的格式；没有生成成绩结果。",
    );
  }
  if (candidates.length !== 1) {
    throw new SaveParseError(
      "ambiguous-record-array",
      "文件中发现多个符合条件的成绩数组，已停止解析以避免输出不确定结果。",
    );
  }

  return candidates[0]!.records;
}
