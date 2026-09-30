import { describe, expect, it } from "vitest";
import { SaveParseError } from "../src/save/errors";
import { parseSaveFile } from "../src/save/parser";
import { makeSyntheticSave, scoreRecord } from "./helpers/synthetic-save";

describe("parseSaveFile", () => {
  it("reads the three required fields from a synthetic structurally valid record array", () => {
    const expected = [
      scoreRecord(2, 0, 95_000_000n),
      scoreRecord(5, 1, 99_000_000n),
      scoreRecord(12, 3, 100_000_001n),
    ];

    expect(parseSaveFile(makeSyntheticSave(expected))).toEqual(expected);
  });

  it("reads PlayerScore as a signed little-endian 64-bit integer", () => {
    const expected = [
      scoreRecord(1, 0, 5_000_000_123n),
      scoreRecord(2, 1, 5_000_000_124n),
      scoreRecord(3, 2, 5_000_000_125n),
    ];

    expect(parseSaveFile(makeSyntheticSave(expected))).toEqual(expected);
  });

  it("rejects arrays with fewer than three records rather than trusting a weak match", () => {
    const bytes = makeSyntheticSave([
      scoreRecord(1, 0, 10n),
      scoreRecord(2, 0, 20n),
    ]);
    expect(() => parseSaveFile(bytes)).toThrow(SaveParseError);
  });

  it("fails closed when the record array count is truncated or inconsistent", () => {
    const bytes = makeSyntheticSave([
      scoreRecord(1, 0, 10n),
      scoreRecord(2, 0, 20n),
      scoreRecord(3, 0, 30n),
    ]);
    expect(() => parseSaveFile(bytes.subarray(0, bytes.length - 1))).toThrow(SaveParseError);

    const wrongCount = bytes.slice();
    new DataView(wrongCount.buffer).setInt32(0, 4, true);
    expect(() => parseSaveFile(wrongCount)).toThrow(SaveParseError);
  });

  it("rejects invalid difficulty flags and mismatched repeated identities", () => {
    const records = [
      scoreRecord(1, 0, 10n),
      scoreRecord(2, 1, 20n),
      scoreRecord(3, 2, 30n),
    ];
    const invalidFlag = makeSyntheticSave(records);
    const firstPayload = 4 + 1 + 8 + "fixture0".length;
    new DataView(invalidFlag.buffer).setUint8(firstPayload + 2, 3);
    expect(() => parseSaveFile(invalidFlag)).toThrow(SaveParseError);

    const mismatchedKey = makeSyntheticSave(records);
    new DataView(mismatchedKey.buffer).setUint16(firstPayload + 3, 99, true);
    expect(() => parseSaveFile(mismatchedKey)).toThrow(SaveParseError);
  });

  it("rejects multiple plausible score arrays as ambiguous", () => {
    const records = [
      scoreRecord(1, 0, 10n),
      scoreRecord(2, 0, 20n),
      scoreRecord(3, 0, 30n),
    ];
    const first = makeSyntheticSave(records);
    const second = makeSyntheticSave(records.map((record) => ({ ...record, songId: record.songId + 10 })));
    const combined = new Uint8Array(first.length + second.length);
    combined.set(first);
    combined.set(second, first.length);

    expect(() => parseSaveFile(combined)).toThrowError(/multiple|多个/i);
  });
});
