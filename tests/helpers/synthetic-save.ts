import type { ScoreRecord } from "../../src/save/types";

const PAYLOAD_BYTES = 99;
const PAYLOAD_SCORE_OFFSET = 0x53;

export function makeSyntheticSave(records: ScoreRecord[], names?: string[]): Uint8Array {
  const basenames = names ?? records.map((_, index) => `fixture${index}`);
  const totalBytes = 4 + records.reduce((sum, _record, index) => sum + 1 + 8 + basenames[index]!.length + PAYLOAD_BYTES, 0);
  const bytes = new Uint8Array(totalBytes);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, records.length, true);

  let elementOffset = 4;
  records.forEach((record, index) => {
    const basename = basenames[index]!;
    const nameBytes = Array.from(basename, (char) => char.charCodeAt(0));
    if (nameBytes.some((byte) => byte < 0x20 || byte > 0x7e)) {
      throw new Error("Synthetic save basenames must be printable ASCII.");
    }

    bytes[elementOffset] = 1; // Synthetic element marker; test construct, not an extracted game file.
    view.setInt32(elementOffset + 1, -(nameBytes.length + 1), true);
    view.setInt32(elementOffset + 5, nameBytes.length, true);
    bytes.set(nameBytes, elementOffset + 9);

    const payloadOffset = elementOffset + 9 + nameBytes.length;
    const difficultyFlag = 1 << record.difficultyIndex;
    view.setUint16(payloadOffset, record.songId, true);
    view.setUint8(payloadOffset + 2, difficultyFlag);
    view.setUint16(payloadOffset + 3, record.songId, true);
    view.setUint8(payloadOffset + 5, difficultyFlag);
    view.setBigInt64(payloadOffset + PAYLOAD_SCORE_OFFSET, record.score, true);

    elementOffset = payloadOffset + PAYLOAD_BYTES;
  });

  return bytes;
}

export function scoreRecord(
  songId: number,
  difficultyIndex: number,
  score: bigint,
): ScoreRecord {
  return { songId, difficultyIndex, score };
}
