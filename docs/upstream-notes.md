# Upstream notes

Sources reviewed:

- [InFalsus-SaveData-Parser](https://github.com/REDDRAGON-HL/InFalsus-SaveData-Parser), especially [`savefile.py`](https://github.com/REDDRAGON-HL/InFalsus-SaveData-Parser/blob/main/savefile.py), [`memorypack.py`](https://github.com/REDDRAGON-HL/InFalsus-SaveData-Parser/blob/main/memorypack.py), [`songs.json`](https://github.com/REDDRAGON-HL/InFalsus-SaveData-Parser/blob/main/songs.json), and [`LICENSE`](https://github.com/REDDRAGON-HL/InFalsus-SaveData-Parser/blob/main/LICENSE).
- [InFalsus-Resource](https://github.com/REDDRAGON-HL/InFalsus-Resource), especially [`info_tables.py`](https://github.com/REDDRAGON-HL/InFalsus-Resource/blob/main/info_tables.py), its documented generated `output/info/constant_table.json` and `output/info/songs.json`, and [`LICENSE`](https://github.com/REDDRAGON-HL/InFalsus-Resource/blob/main/LICENSE).
- The committed `songs.json` in InFalsus-SaveData-Parser (blob SHA `dd2ae96213215aecbf7ea6ca59bcc902ce94dc47`), which contains the generated song/chart table. Its snapshot metadata is pinned in `src/catalog/catalog.json`.

## Confirmed by the current SaveData Parser source

- A score payload is 99 bytes.
- The payload begins with `u16 songId` and `u8 difficultyFlag`.
- Valid difficulty flags are `1`, `2`, `4`, and `8`; the zero-based index is `log2(flag)`.
- Candidate records are not accepted from a single matching number: the upstream parser checks repeated song/difficulty values in the payload and validates the declared array count against sequential records.
- The upstream parser's MemoryPack string locator validates the negative length marker, byte length, and printable ASCII song basename before accepting a candidate.

## Current score-width discrepancy

The project request specifies a signed little-endian 64-bit `PlayerScore` at payload offset `+0x53`. The currently reviewed public `savefile.py` reads an unsigned 32-bit value at that same offset. This project follows its explicit `i64` contract for now. The difference is unresolved until compared with a real local save and the upstream Python parser; no real save has been included in this repository.

## Confirmed from InFalsus-Resource documentation

- `constant_table.json` and `songs.json` are generated beneath `output/info/`; they are not committed in the Resource repository.
- Chart constants are sourced from `chart.rating`.
- The currently observed values are integer ratings from 0 through 15, but this project's schema accepts any finite number to preserve forward compatibility.
- `info_tables.py` builds chart rows from `SongData.ChartInfos`, retaining chart `Id`, `Difficulty`, `Rating`, and designer. It emits `constant_table.json` with `constant = chart.rating`.
- The parser repository's committed `songs.json` contains 83 song records and 292 chart rows. Nine rows have empty `chartId` and `Normal` difficulty placeholders; the runtime snapshot excludes those unsupported placeholders and contains the 283 charts with stable IDs and supported difficulty indices. Their observed ratings range from 0 through 15 and are all integers in this snapshot; the TypeScript schema still accepts finite fractional constants.
- The compact snapshot uses `baseName` as its display-title fallback because the public table has no localized title field. A Rhythm Archive export should provide canonical titles when this handoff is implemented.
- Both upstream repositories declare MIT License, copyright (c) 2026 RedDragon. See `THIRD_PARTY_NOTICES.md` for the full notice.

## Project conventions and limits

- `songId + difficultyIndex` maps to `chartId`.
- The compact runtime catalog is a snapshot, not an independently curated long-term database. Rhythm Archive is planned to generate it.
- Save parsing is limited to score identity and score. The rest of the upstream save parser is out of scope.
- Upstream structural observations are references, not a guarantee of format compatibility. Real-save differential verification remains necessary.
