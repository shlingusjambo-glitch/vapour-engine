# Open world

A Mirage showcase. Its job is to prove the large-world systems **compose**, not
to be a game — every part is public engine API with no sample-only hooks.

```sh
pnpm --filter @vapour/example-open-world run
```

```
Open world — composed from Mirage systems

  terrain      16 chunks, 8192 triangles
  vegetation   1311 instances
  navmesh      15638 spans
  streaming    34 resident cells, 3 origin shift(s)
  agent        arrived, 359.0 m travelled
  rebake       491 of 15638 spans (+14 -252 ~0)
  step time    0.000 ms mean, 0.001 ms p95
  wall clock   77 ms
```

## What it exercises together

| System | Used for |
| ------ | -------- |
| [Terrain](../../docs/terrain.md) | A seeded procedural heightfield, chunked with a three-layer splat material |
| [Terrain sculpting](../../docs/terrain.md) | A hill raised mid-run with a smooth brush |
| [Vegetation](../../docs/terrain.md) | Slope-aware tree and rock scattering with impostor LOD prototypes |
| [World streaming](../../docs/world-streaming.md) | A partition with hysteresis following the walking agent |
| [Floating origin](../../docs/world-streaming.md) | Origin shifts as the agent crosses the 128 m threshold |
| [NavMesh](../../docs/ai-navigation.md) | Baked from the terrain mesh; a crowd agent walks the diagonal |
| [Localized rebaking](../../docs/ai-navigation.md) | Only the spans under the new hill are rebaked |
| [Diagnostics](../../docs/diagnostics.md) | Counters and a timing region for the step |

`world.test.ts` asserts the composition: the agent arrives, cells stream, the
origin shifts, the rebake touches a strict subset of spans, and two worlds
from one seed are identical.
