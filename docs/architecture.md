# Architecture

## Runtime data flow

```text
local .sav File
  -> browser ArrayBuffer
  -> fail-closed score parser
  -> ScoreRecord[]
  -> versioned static catalog resolver
  -> rating calculation
  -> deterministic B50 ranking
  -> DOM table and JSON export
```

The save parser, catalog schema/validation, rating functions, and UI are separate modules. Core parsing and calculation code does not depend on the DOM. No save bytes are sent over the network.

## Related projects

- **Rhythm Archive** owns canonical In Falsus chart metadata. A future build or export workflow should generate the compact snapshot consumed by this project.
- **infalsus-b50** owns local player score parsing, chart lookup, Rating, ranking, and eventual shareable B50 output.
- **infalsus-chart-preview-generate** owns chart parsing and preview generation. It identifies charts with `chartId`.

The shared identity is `songId + difficultyIndex ↔ chartId`. Runtime pages remain self-contained and do not require Rhythm Archive to be online.

## Trust boundaries

The parser validates boundaries, record count, key repetition, difficulty flags, and fixed payload length before returning scores. Unsupported or ambiguous data fails closed. Catalog versions and identities are validated before lookup. Missing charts are diagnosed and never assigned an invented constant.
