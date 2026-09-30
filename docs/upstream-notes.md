# Upstream and local-game notes

## References

- [InFalsus-SaveData-Parser](https://github.com/REDDRAGON-HL/InFalsus-SaveData-Parser), especially `savefile.py`, `memorypack.py`, and its `LICENSE`.
- [InFalsus-Resource](https://github.com/REDDRAGON-HL/InFalsus-Resource), especially `info_tables.py`, generated `songs.json` / `constant_table.json`, AssetBundle and SAM handling, and its `LICENSE`.
- The existing Rhythm Archive tooling extractor was used as a local implementation reference for resolving Addressables locations, localized strings, and the jacket Material -> `_MainTex` -> Texture2D chain. B50 keeps only the small maintenance-time logic needed for its own generated contract.

Both REDDRAGON-HL repositories declare MIT. Their notices remain in `THIRD_PARTY_NOTICES.md`. No upstream resource extractor or save parser is vendored into the runtime. The B50 save parser remains a focused TypeScript implementation that was previously validated record-by-record against the upstream parser.

## Current local installation findings

The current installation uses Unity Addressables under `StreamingAssets/aa`, with a binary v2 catalog, Addressables package 2.9.1, and 1,810 local `.bundle` files. The game executable reports Unity 6000.3.9f1; that is the engine version, not a reliable game product version. The installed Steam manifest provides build ID 25594228, and `SongData.CommitId` is `007d2f885f0fd931ce7621030ff08311fb74f13b`. The generated snapshot records those identifiers and a content-derived fingerprint; it does not invent a semantic `gameVersion`.

`SongData` contains 90 slots. Twelve have empty `songId=0` placeholder data and are skipped. The remaining 78 song IDs yield 303 non-empty chart rows: 300 available and 3 unavailable tutorial rows. Available counts are 75 at each of the four difficulty indexes. The extractor supports arbitrary source chart counts and preserves unavailable rows; the runtime catalog indexes only available rows.

- `songId` comes from `SongData.allSongInfo[].Id.Value`.
- `baseName` comes from `allSongInfo[].BaseName`.
- Title and artist come from `DynamicStringMapping.songIdTitleTypeMapping` and `songIdArtistTypeMapping`; English values are preferred, with `IdStr` and then `baseName` as title fallbacks.
- `chartId`, availability, raw difficulty flag, Rating, level display, and chart designer come from each `ChartInfos` row. Difficulty flags 1, 2, 4, 8 map to indexes 0, 1, 2, 3 and labels MIN, EVO, ULT, FBD.
- `SongData.songIdJacketMaterials` and `chartIdJacketMaterials` map song/chart identity to the large jacket Material. Its `_MainTex` references the actual Texture2D. Small-jacket materials are not used by B50.
- `StreamingAssetsMapping` maps chart `.spc` names to extensionless payloads in `StreamingAssets/sam`. B50 does not extract or decrypt those payloads; they are unrelated to the metadata and jacket snapshot.

For this installation, 78 320×320 WebP jacket files were generated and verified. No original PNG, Texture2D, AssetBundle, `.spc`, or SAM file is part of the repository.

## The six previously missing identities

| chartId | songId:index | Game availability | Rating / level |
| --- | --- | --- | --- |
| `cryogenic3` | `11:3` | Available FBD | 12 / `12` |
| `hyalouyne3` | `23:3` | Available FBD | 12 / `12` |
| `deepintothevibe3` | `67:3` | Available FBD | 12 / `12` |
| `tutorialevolong1` | `74:1` | Unavailable tutorial chart | 0 / `?` |
| `tutorialevoshort1` | `75:1` | Unavailable tutorial chart | 0 / `?` |
| `tutorialmin0` | `76:0` | Unavailable tutorial chart | 0 / `?` |

The three tutorial rows are kept in generated metadata with `available: false`, Rating 0, and the source level marker; they cannot enter B50 lookup. No player-save contents or per-chart progress are stored in this repository.

## Rhythm Archive comparison

The current local game snapshot was compared read-only with the current Rhythm Archive `catalog/index.json`. The diagnostic found:

- 3 game-only songs: the unavailable tutorial song entries.
- 6 game-only charts: the three valid FBD charts above and the three unavailable tutorial charts.
- 0 RA-only songs or charts.
- 0 chartId, Rating, title, or artist mismatches among shared identities.

This comparison did not modify the extracted game metadata. Rhythm Archive remains a useful cross-check and web-ecosystem partner, not the B50 source of truth.
