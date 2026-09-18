# Procedural worlds and streaming

Vapour separates **what a cell contains** from **when that cell should exist**.
This is intentional: voxel blocks, terrain tiles, additive scene cells,
navmeshes, audio regions, and network-interest regions need different data but
the same prioritization, cancellation, and lifetime rules.

The public APIs live in `@vapour/engine`:

- `SeededRandom` creates deterministic gameplay streams and named substreams.
- `GradientNoise` provides coherent 2D/3D noise and normalized fractal noise.
- `planChunkInterest` creates a stable nearest-first 3D load plan.
- `ChunkStreamManager<T>` owns asynchronous load, retry, cancellation, and
  unloading for any cell payload `T`.

## Deterministic generation

```ts
import { GradientNoise, SeededRandom } from "@vapour/engine";

const terrain = new GradientNoise(project.worldSeed);
const loot = new SeededRandom(project.worldSeed).fork("loot");

function heightAt(worldX: number, worldZ: number): number {
  const elevation = terrain.fbm2D(worldX, worldZ, {
    frequency: 1 / 256,
    octaves: 6,
    lacunarity: 2,
    gain: 0.5,
  });
  return Math.floor(48 + elevation * 30);
}
```

Noise is stateless and samples global coordinates. A worker generating chunk
`(4, 0, -2)` therefore returns the same boundary samples as a worker generating
its neighbour, regardless of order. Do not seed each chunk with a new noise
object unless deliberately creating discontinuous regions.

Named random substreams prevent unrelated changes from perturbing a world. For
example, adding a weather roll must not change structure placement:

```ts
const root = new SeededRandom(seed);
const structures = root.fork("structures");
const weather = root.fork("weather");
```

## Streaming cells

```ts
import { ChunkStreamManager } from "@vapour/engine";

const cells = new ChunkStreamManager({
  async load(coordinate, { signal }) {
    const data = await generator.generate(coordinate, { signal });
    return renderer.uploadTerrainCell(coordinate, data);
  },
  dispose(cell) {
    renderer.releaseTerrainCell(cell);
  },
}, {
  shape: "cylinder",
  maxConcurrentLoads: 4,
  maxStartsPerUpdate: 2,
  unloadDelayUpdates: 8,
  retryDelayUpdates: 60,
});

function update(playerChunk: { x: number; y: number; z: number }): void {
  cells.update([{
    coordinate: playerChunk,
    radius: 8,
    verticalRadius: 2,
  }]);
}
```

`update` is non-blocking. It starts only the configured number of jobs and
never exceeds the concurrency limit. Moving away aborts stale jobs; a source
that cannot cancel may still finish, but its stale result is disposed rather
than entering the world. Ready cells use unloading hysteresis to avoid rapid
load/unload churn at a boundary. Failed desired cells retry after a deterministic
number of updates and emit a `failed` event with the original error.

Multiple observers are supported for local multiplayer, portals, cameras, or
server interest regions. Overlap is deduplicated. Observer `priority` controls
relative importance, and an optional priority function can favor movement
direction, visible cells, or gameplay-critical areas.

## Existing worker pipelines

`planChunkInterest` exposes the exact planning layer without taking ownership
of loading. It exists for mature games that already have worker protocols,
persistence, or GPU upload queues:

```ts
const plan = planChunkInterest(observers, "cylinder", (cell, observer) => {
  const dx = cell.x - observer.coordinate.x;
  const dz = cell.z - observer.coordinate.z;
  return dx * dx + dz * dz + Math.abs(cell.y - observer.coordinate.y) * 0.2;
});
```

The real CubeGame port uses this planner plus `WorkerTaskPool`. The pool owns
bounded concurrency, worker readiness, FIFO backpressure, transfer lists,
failure isolation, and async response completion; CubeGame now supplies only
the generation/meshing protocol and applies the returned world data.

```ts
const jobs = new WorkerTaskPool({
  size: Math.max(2, Math.floor(navigator.hardwareConcurrency / 2)),
  createWorker: () => new TerrainWorker(),
  onResponse: (result) => world.apply(result),
  transfer: (job) => job.voxels ? [job.voxels.buffer] : undefined,
});
jobs.submit({ type: "mesh", voxels });
```

`onResponse` may return a promise. Vapour will not assign that worker another
job until persistence or other asynchronous result handling finishes. Failed
workers are removed; non-transferred interrupted jobs are safely requeued, and
owners are told about transferred jobs whose detached buffers must be rebuilt.
New projects should normally combine this with `ChunkStreamManager`.

## Execution and data ownership

- Planning is small deterministic CPU work and runs on the simulation thread.
- Generation and meshing belong in workers or WASM worker threads.
- Transfer typed-array buffers instead of cloning large cell payloads.
- GPU upload remains on the browser thread through the render host.
- Persistent edits are diffs keyed by stable world/cell identity, not raw GPU
  meshes. Flush dirty diffs before disposing a cell.
- A world seed and generator version are serialized. Noise objects and active
  queues are reconstructed, never serialized.

Plugins can provide generators or `ChunkStreamSource` implementations without
replacing the scheduler. Tests should cover deterministic output, cross-cell
seams, cancellation, stale completion, retry, and disposal. Vapour's own suite
covers those contracts without requiring a browser GPU.

## Dimensions, columns, and structures

`VoxelGenerationPipeline` owns section allocation, local/global coordinate
traversal, dimension lookup, fallback behavior, and ordered decorator passes.
Dimension plugins provide column recipes and optional structure, foliage, ore,
or authored-overlay decorators. Generated IDs are validated as `u16` before
they enter storage or the mesher.

CubeGame's overworld, Nether, End, survival, sandbox, and CrownForge dimension
routes now execute through this pipeline. Its terrain recipes remain game
content; chunk-loop and structure-pass orchestration are Vapour runtime code.

`VoxelBlockRegistry<T>` stores stable block IDs with deterministic enumeration,
explicit conflict/replacement behavior, fallback resolution, and versioned
merge-friendly JSON. The generic payload preserves game- or plugin-specific
mining, crafting, audio, and interaction metadata without forking the database.

---

# Large worlds (Alpha 0.2.5)

## Why floating origin is not optional

A 32-bit float has about seven significant decimal digits. Near the origin that
is nanometre precision; **ten kilometres out it is roughly a millimetre, and a
hundred kilometres out roughly a centimetre**.

Vertices, matrices, and physics all run in `f32` on the GPU and across the WASM
boundary. So a world larger than a few kilometres develops visible jitter:
geometry shimmers, physics contacts chatter, and a camera rotating in place
appears to vibrate.

The fix is not more precision — it is keeping the numbers small.

```ts
import { FloatingOrigin } from "@vapour/engine";

const origin = new FloatingOrigin({ threshold: 1000, snap: 64 });

origin.shifted.on((shift) => {
  physics.shiftWorld(shift.delta);
  particles.shift(shift.delta);
  navmesh.shift(shift.delta);
});

// each frame, with the camera's local position
origin.update(camera.position);
```

`FloatingOrigin.precisionAt(distance)` reports the worst-case `f32` gap at a
distance, so a threshold can be justified rather than guessed.

### This cannot be retrofitted cheaply

Every system that caches a world position has to learn about rebasing — physics
bodies, particles, navmesh spans, audio sources, streamed chunks. That is why
the shift is published as an event with the delta, and why `applyToBuffer`
handles interleaved vertex data by stride.

### Snapping matters

An unsnapped shift changes the fractional part of every coordinate, which makes
noise-based terrain visibly crawl and destabilizes shadow cascades and texture
sampling. Snapping the shift to a multiple keeps those stable across a rebase.

## World partitioning

```ts
import { WorldPartition } from "@vapour/engine";

const partition = new WorldPartition({ cellSize: 256, loadRadius: 3, unloadPadding: 1 });

const { toLoad, toUnload } = partition.update(player.position);
for (const cell of toLoad) streamer.request(cell);      // nearest first
for (const cell of toUnload) streamer.release(cell);
```

**Hysteresis is the whole point of `unloadPadding`.** Without it, a viewer
standing on a cell boundary loads and unloads the same cell every frame — the
single most common streaming bug, and one that looks like a performance problem
rather than a logic error.

`toLoad` is sorted nearest-first: the cell the player is about to enter matters
more than one at the edge of the radius.

`WorldPartition` owns *what should be resident*; `ChunkStreamManager` owns the
asynchronous loading. Separating them means the residency policy is testable
with no I/O at all.

## Terrain LOD and seams

```ts
const levels = [
  { resolution: 64, ringRadius: 1 },
  { resolution: 32, ringRadius: 3 },
  { resolution: 16, ringRadius: 6 },
];

const level = selectTerrainLod(levels, cell.ring);
const seams = terrainSeams(levels, cell, viewerCell);   // { north, south, east, west }
```

**Terrain LOD is by ring, not by screen size.** Neighbouring chunks must agree:
two adjacent chunks at different resolutions leave a crack along their shared
edge, and a screen-size rule makes *which* pairs differ unpredictable. Rings make
adjacency predictable, so `terrainSeams` can report exactly which edges border a
coarser neighbour and need their vertices collapsed to match.

## API reference

| Export | Purpose |
| ------ | ------- |
| `FloatingOrigin` | `update`, `toLocal`, `toWorld`, `reset`, `shifted`, plus static `apply`, `applyToBuffer`, `precisionAt` |
| `WorldPartition` | `update`, `cellOf`, `centerOf`, `applyOriginShift`, `residentCells` |
| `selectTerrainLod`, `terrainSeams` | Ring-based terrain LOD and seam detection |

## Multiplayer considerations

The origin is **per client**. Two players in different parts of the world will
have different origins, so anything on the wire must be in absolute world space
— replicating a local coordinate produces objects in wildly wrong places. Convert
with `toWorld` on send and `toLocal` on receive.

## Terrain chunks, sculpting, and vegetation (Mirage)

`TerrainChunkGrid`, `TerrainMaterial`, `TerrainSplatMap`, `TerrainSculptor`,
`TerrainPaintbrush`, `TerrainEditHistory`, and the vegetation scatter/LOD
helpers (`scatterVegetation`, `vegetationInstances`, `vegetationLodRegistry`)
are documented in [`terrain.md`](terrain.md); they build on `selectTerrainLod`
and `terrainSeams` above.

## Voxel lighting (Mirage)

`VoxelLightField` computes block light (a BFS flood from emissive blocks,
attenuating one level per step through non-opaque blocks) and skylight (the
same flood, seeded top-down from every column open to the sky) for a
`VoxelWorld`, nibble-packed per chunk (`sky << 4 | block`, one byte per voxel):

```ts
import { VoxelLightField } from "@vapour/engine";

const light = new VoxelLightField(world, palette);
light.recomputeAll(); // once, after bulk-loading or generating a region

world.setBlock(x, y, z, blockId);
light.relight(x, y, z); // cheap, confined to a padded box after one edit
```

`relight` only touches a box of radius `MAX_LIGHT_LEVEL` (light cannot travel
further than that from any source), reusing the box's own shell as a fixed
boundary condition — correct because nothing outside the box could have been
affected by an edit at its centre. A change right at the edge of one chunk can
still want a second `relight` call centred further out, or a `recomputeAll`,
to fully converge; see the `ponytail:` note on `relight` for the exact
trade-off.

`meshVoxelChunk` accepts a `light` field and folds `max(block, sky) / 15` into
both its existing `colors` output and a new `light` per-vertex channel; omit it
and every vertex reads fully lit, unchanged from before this existed.

## Voxel save format and chunk sync (Mirage)

`encodeChunk`/`decodeChunk` (`voxel-save.ts`) run-length encode a chunk's
`Uint16Array` blocks into a small, versioned, byte-identical-round-trip
buffer — real terrain is long runs of one repeated block, so this is
typically under 1% of the raw array's size with no dependency and no loss.
`encodeWorld`/`decodeWorld` add a small index (chunk coordinate + byte range)
over multiple chunks, and accept `only` to save just the coordinates from
`world.takeDirtyChunks()` for an incremental save.

```ts
import { encodeWorld, decodeWorld } from "@vapour/engine";

const save = encodeWorld(world, { only: world.takeDirtyChunks() });
persistToDisk(save); // save.data plus save.index is everything needed

decodeWorld(freshWorld, loadedSave);
```

Multiplayer chunk sync is defined as message *shapes* and a pure reducer, not
a transport — `packages/net` (owned separately) is the integration point for
actually carrying these over a socket:

```ts
import { respondToChunkRequest, applyVoxelSyncMessage, type VoxelSyncMessage } from "@vapour/engine";

// Server, on receiving a client's request:
const response = respondToChunkRequest(serverWorld, request); // VoxelChunkResponse | undefined

// Either side, applying any message from the wire:
applyVoxelSyncMessage(world, message satisfies VoxelSyncMessage);
```

`applyVoxelSyncMessage` is pure with respect to (world, message): the same
inputs always produce the same result, which is what lets a server apply an
edit and a client apply its broadcast with the exact same function and no
special-casing.

## Vapour Script

The same API from Vapour Script — VS compiles to ESM and receives the same
engine objects as TypeScript, so nothing below is a binding layer.

```py
from "@vapour/engine" import WorldPartition, FloatingOrigin, encodeChunk

var partition = new WorldPartition({ cellSize: 64, loadRadius: 2, unloadPadding: 1 })
var origin = new FloatingOrigin({ threshold: 128 })

export func stream(viewer):
    var shift = origin.update(origin.toLocal(viewer))
    if shift != None:
        partition.applyOriginShift(shift)
    return partition.update(origin.toLocal(viewer))

export func save_chunk(chunk):
    return encodeChunk(chunk)
```
