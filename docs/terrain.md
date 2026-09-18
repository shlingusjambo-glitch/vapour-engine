# Terrain and static-world collision

`TerrainHeightfield` keeps visual terrain, native Rapier collision, grounding
queries, and procedural generation on one source of truth. Heights are row-major
(`z * columns + x`), the surface is centered on its entity, and `scale` is the
total world width, height multiplier, and depth.

```ts
import { GradientNoise, TerrainHeightfield } from "@vapour/engine";

const noise = new GradientNoise("world-seed");
const terrain = TerrainHeightfield.generate(129, 129, [512, 48, 512], (x, z) =>
  noise.fbm2D(x * 4, z * 4, { octaves: 6 }),
  [32, 32],
);

renderer.uploadMesh("terrain:main", terrain.mesh());
physics.insert({
  id: 100,
  bodyType: "static",
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  shape: terrain.collider(),
});
```

`sampleHeight(x, z)` performs a bilinear local-space query against the same
samples. It returns `undefined` outside the surface.

The lower-level 3D physics API also accepts `plane`, `convexMesh`,
`triangleMesh`, and `heightfield` collider shapes. Prefer heightfields for
regular terrain and convex meshes for moving bodies. Triangle meshes are meant
for detailed static world geometry.

## Chunked terrain, materials, and splatting (Mirage)

A single `TerrainHeightfield` mesh cannot be culled, streamed, or dropped in
resolution with distance — `TerrainChunkGrid` splits the *same* authoritative
height samples into independently meshable tiles with their own bounds, while
keeping one source of truth for collision, sampling, and rendering.

```ts
import { TerrainChunkGrid, TerrainMaterial, TerrainHeightfield } from "@vapour/engine";

const field = TerrainHeightfield.generate(257, 257, [2048, 96, 2048], sampler);
const material = new TerrainMaterial({
  layers: [{ name: "grass" }, { name: "rock" }, { name: "sand" }],
  baseColorTexture: "textures/terrain-atlas",
});
const grid = new TerrainChunkGrid({ heightfield: field, chunkCells: 32, material });

for (const chunk of grid.chunks()) {
  renderer.uploadMesh(`terrain:${String(chunk.x)}:${String(chunk.z)}`, chunk.mesh());
}
renderer.uploadMaterial("terrain:main", material.upload());
```

A material is an ordered stack of layers; a layer's *index* is what a splat
weight addresses, and its atlas cell derives from that index by default, so
painting and drawing can never disagree about which layer means what.
`TerrainSplatMap` stores `layerCount` weights per heightfield vertex and keeps
every vertex normalised to sum to one after any edit — the invariant a splat
shader (or, until one exists, the per-vertex tint/atlas-cell fallback baked
into `chunk.mesh()`) depends on.

### LOD meshing and seam stitching

`TerrainChunkGrid.chunkMesh` combines `selectTerrainLod`/`terrainSeams`
(`large-world.ts`) with the actual mesh build: it picks each chunk's sample
step from its ring, then collapses exactly the edges bordering a coarser
neighbour onto that neighbour's sample stride, so two adjacent chunks at
different LOD levels share their boundary geometry exactly — no crack.

```ts
const levels = [
  { resolution: 33, ringRadius: 2 },
  { resolution: 17, ringRadius: 5 },
  { resolution: 9, ringRadius: 100 },
];
const mesh = grid.chunkMesh(chunk, levels, viewerChunk, { skirtDepth: 1 });
```

`skirtDepth` additionally drops a small vertical apron around every border,
which hides a crack of any size — useful as a second line of defence against
LOD schemes this grid did not choose, or floating-point edge cases.

## Sculpting, painting, and undo (Mirage)

`TerrainSculptor` mutates a heightfield's samples in place with brush-shaped,
deterministic operations — `raise`, `lower`, `smooth`, and `flatten`
(`setHeight` is an alias) — sharing one falloff function (`brushWeight`, with
`"constant"`, `"linear"`, or `"smooth"` shapes) with `TerrainPaintbrush`, so a
"raise and paint rock" tool stays visually consistent between its two effects:

```ts
import { TerrainSculptor, TerrainPaintbrush, TerrainEditHistory } from "@vapour/engine";

const sculptor = new TerrainSculptor(field);
const paint = new TerrainPaintbrush(grid.splat);
const history = new TerrainEditHistory();

history.record(sculptor.raise(column, row, { radius: 6, falloff: "smooth" }, 4));
history.record(paint.paint(column, row, { radius: 6 }, material.indexOf("rock")));

history.undo({ heightfield: field, splat: grid.splat }); // exact prior values
history.redo({ heightfield: field, splat: grid.splat });
```

`TerrainEditHistory` is a command log of before/after patches rather than
snapshots: a patch stores only the vertices its stroke actually touched, so
undoing a small brush stroke on a large terrain is cheap. `applyPatch` is the
primitive both `undo`/`redo` and a network edit log can share.

`generateProceduralHeights` wraps `GradientNoise` in the shape
`TerrainHeightfield.generate` expects, for the common "a plausible terrain
from a seed" case, without a second noise implementation:

```ts
import { generateProceduralHeights, TerrainHeightfield } from "@vapour/engine";

const sampler = generateProceduralHeights({ seed: "island-1", rows: 257, columns: 257, scale: [2048, 96, 2048], noise: { octaves: 5 } });
const field = TerrainHeightfield.generate(257, 257, [2048, 96, 2048], sampler);
```

## Vegetation scatter (Mirage)

`scatterVegetation` deterministically places trees, grass, and rocks over a
heightfield from density/slope/height rules and a seed — each prototype gets
its own named `SeededRandom` substream, so adding a prototype never reshuffles
another's placement. `vegetationInstances` converts placements into
`RenderInstanceSnapshot`s that drop straight into the renderer's existing
instancing path, and `vegetationLodRegistry` builds an `LodRegistry` (see
[`rendering-scale.md`](rendering-scale.md)) that switches a prototype to a
billboard impostor mesh past a screen-height threshold:

```ts
import { scatterVegetation, vegetationInstances, vegetationLodRegistry } from "@vapour/engine";

const placements = scatterVegetation(field, {
  seed: worldSeed,
  rules: [
    { prototype: pineTree, density: 0.002, maxSlopeDegrees: 35 },
    { prototype: boulder, density: 0.0005, minHeight: -10 },
  ],
});
const instances = vegetationInstances(placements, [pineTree, boulder]);
const lodRegistry = vegetationLodRegistry([pineTree, boulder]);
const { instances: drawn } = lodRegistry.apply(instances, camera);
```

The mesh and impostor ids referenced by a `VegetationPrototype` are ordinary
mesh-library ids (e.g. from `@vapour/assetgen`'s `nature.ts` generators,
uploaded once); this module only places and batches instances.

## Vapour Script

The same API from Vapour Script — VS compiles to ESM and receives the same
engine objects as TypeScript, so nothing below is a binding layer.

```py
from "@vapour/engine" import TerrainHeightfield, TerrainMaterial, TerrainChunkGrid, TerrainSculptor, generateProceduralHeights

export func island(seed):
    var sample = generateProceduralHeights({ seed: seed, rows: 65, columns: 65, scale: [512, 6, 512] })
    var field = TerrainHeightfield.generate(65, 65, [512, 6, 512], (x, z) => sample(x, z))
    var material = new TerrainMaterial({ layers: [{ name: "grass" }, { name: "rock" }] })
    var grid = new TerrainChunkGrid({ heightfield: field, material: material, chunkCells: 16 })
    var sculptor = new TerrainSculptor(field)
    sculptor.raise(32, 32, { radius: 4, strength: 1, falloff: "smooth" }, 8)
    return grid.chunks().map((chunk) => chunk.mesh())
```
