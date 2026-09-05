# AI-generated environment

The Mirage showcase for [`@vapour/assetgen`](../../docs/asset-generation.md): a
village generated entirely from a structured description, with no vertex, no
matrix, and no editor interaction anywhere in the input.

```sh
pnpm --filter @vapour/example-ai-environment generate
```

```
Ashcombe — generated from a structured description

  description      795 bytes of JSON
  terrain          4608 triangles, 2401 height samples
  buildings        7, 27 openings
  vegetation       70 trees, 31 rocks
  NPCs             12, 22 bones each
  unique geometry  39,172 triangles
  with instancing  112,308 triangles drawn
  navigation       10 surfaces, 7 doorway links
  preview mesh     85,428 triangles merged
  generated in     404 ms
  expansion        141.3 triangles per byte of description
```

## What the description contains

The whole input is [`VILLAGE`](src/environment.ts) — terrain size and relief, a
street length, seven houses given as `{ name, along, side, width, depth,
storeys, roof }`, vegetation counts, and a population. That is the complete
authored content.

Everything else is derived:

- **Geometry** — terrain heightfield, house shells with walls, doors, windows,
  stairs and roofs, four tree variants, three rock variants, twelve NPC bodies.
- **Materials** — per-element slots (wall, floor, roof, stairs, bark, foliage,
  rock, ground) ready to bind.
- **Collision** — a triangle collider per building, budgeted and simplified.
- **Navigation** — ten room surfaces and seven doorway links. Windows are
  excluded, so an NPC cannot route through a first-floor window.
- **Rigging** — a standard 22-bone humanoid skeleton per NPC with skinning
  weights and inverse bind matrices.
- **LODs** — a three-level chain per building.

## Why it is instanced

`generateVillage` returns tree and rock **placements**, not one merged mesh.
Ninety trees merged into a single buffer is how a scene stops being renderable;
four unique meshes drawn ninety times is how it stays cheap. `previewMesh`
merges everything for a quick single-draw look, and is explicitly not what a
real renderer should do.

## Why it is seeded

Generation is driven by an explicit seeded PRNG rather than `Math.random`, so
the same description produces byte-identical output on every machine. That is
what lets a multiplayer game replicate the *description* — 795 bytes — instead
of the 112,000 triangles it becomes.

`environment.test.ts` asserts that reproducibility directly, along with the
navigation, collision, and placement invariants.
