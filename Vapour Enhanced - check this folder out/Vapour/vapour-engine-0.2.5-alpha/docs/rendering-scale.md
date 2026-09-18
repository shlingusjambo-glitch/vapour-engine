# Rendering at scale

Three changes turn Vapour's submission path from something that works for a
demo into something that works for an open world: incremental extraction,
frustum culling, and level of detail. This page covers all three; see
[`rendering.md`](rendering.md) for the renderer itself.

## The problem

Before Mirage, every frame rebuilt everything. `extractRenderWorld` revalidated
the whole scene, resolved every world matrix through a fresh chain of matrix
multiplies, and allocated a new snapshot object per instance — then submitted
all of it, including the majority of the world that was behind the camera or
beyond the far plane.

Measured on a 10,000-object scene:

| | Cost per frame |
| --- | --- |
| Full extraction | ~21 ms |
| Incremental, comparison-based | ~8 ms (2.6×) |
| Incremental, observed document | ~2 ms (**10×**) |
| Frustum cull | ~4 ms |
| Instances submitted after culling | 1,156 of 10,000 (**11.6%**) |

Those numbers come from [`render-scale.perf.test.ts`](../packages/engine/src/render/render-scale.perf.test.ts),
which asserts the *work avoided* rather than wall-clock, so it stays meaningful
on any machine.

## Incremental extraction

```ts
import { IncrementalRenderWorld } from "@vapour/engine";

const extractor = new IncrementalRenderWorld();

// Each frame:
const world = extractor.extract(scene);
console.log(extractor.stats);   // { entities, recomputed, reused, fullRebuild, observed }
```

`IncrementalRenderWorld` keeps the previous frame's results and recomputes only
what changed. It calls the same `extractEntityContribution` the full extractor
does, so its output is identical — the tests assert that equivalence directly
rather than trusting it.

**Change detection is by content, not identity.** `SceneDocument` mutates entity
objects in place, so comparing object references would silently miss edits. Each
entity's render-relevant fields are captured in a compact numeric signature and
compared in place, allocating nothing on the common path.

A changed transform dirties every descendant, because a parent moving moves its
whole subtree. Adding or removing entities triggers a full rebuild.

### The observed fast path

```ts
const stop = extractor.observe(sceneDocument);
```

Comparing every entity every frame is the general solution, and it still costs
time proportional to the scene. A `SceneDocument` already knows exactly which
entities changed, so observing it removes the comparison walk entirely: an
untouched frame recomputes **nothing**. That is the case a static open world is
in for most of its frames, and it is where the 10× comes from.

Use the comparison path when the scene comes from somewhere else — notably
`SceneManager.compose()`, which merges several documents into fresh data.

## Frustum culling

```ts
import { cullRenderWorld } from "@vapour/engine";

const { world: visible, stats } = cullRenderWorld(world, canvas.width / canvas.height, {
  maxDistance: 500,
  boundsMargin: 0.25,
});
```

Culling runs on the extracted snapshot rather than inside the renderer, so it is
testable without a GPU, reusable for shadow cascades and secondary cameras, and
cheap to reason about.

- Bounds come from the mesh library's picking half-extents — the same source the
  editor uses to select and frame objects — so what culling believes about an
  object's size always matches what clicking it believes.
- `maxDistance` is applied *before* the frustum test, because a squared-distance
  compare is cheaper than six plane tests and it is the big win in an open world.
- `boundsMargin` grows every box, which keeps vertex-animated or outlined
  geometry from popping at the screen edge.
- A world with **no camera** is returned untouched. There is nothing to cull
  against, and silently dropping every instance would look like a renderer bug.

`cameraSliceFrustum(camera, aspect, near, far)` builds the frustum for a depth
slice, which is what cascaded shadow maps and distance-partitioned systems need.

## Level of detail

```ts
import { LodRegistry } from "@vapour/engine";

const lods = new LodRegistry();
lods.define("tree", {
  levels: [
    { mesh: "tree.high", minScreenHeight: 0.30 },
    { mesh: "tree.mid",  minScreenHeight: 0.10 },
    { mesh: "tree.low",  minScreenHeight: 0.02 },
  ],
  cullScreenHeight: 0.005,
});

const { instances, stats } = lods.apply(visible.instances, world.camera!, { bias: qualitySetting });
```

**Selection is by projected screen height, not raw distance.** Distance
thresholds are the obvious approach and the wrong one: they must be retuned for
every field of view and every resolution, and an object that looks fine on a
phone is a smear on a monitor. Screen height is the quantity that actually
determines whether detail is visible, so thresholds authored once hold
everywhere. Under an orthographic camera, screen height is independent of
distance — which is the correct behaviour for an orthographic view.

`bias` multiplies every threshold at once: above 1 keeps detail longer (a
quality setting), below 1 drops it sooner (a performance setting). It is the one
knob to expose to players.

Meshes with no chain pass through untouched, so LOD is opt-in per asset and
adding it to one asset cannot change how another renders. An instance's radius
scales with its transform, so a scaled-up object keeps detail longer.

## Ordering

Run the three in this order:

```ts
const world = extractor.extract(scene);                      // 1. extract
const { world: visible } = cullRenderWorld(world, aspect);   // 2. cull
const { instances } = lods.apply(visible.instances, world.camera!);  // 3. LOD
renderHost.submitFrame(instances);
```

Culling before LOD means the LOD pass only examines what will actually be drawn.

## Vapour Script

```vapour
use render

fn setup() {
  render.observe_scene(self.scene)
  render.set_lod_bias(settings.get("quality") == "low" ? 0.6 : 1.0)
}
```

## Performance considerations

- The observed path is ~10× faster than full extraction on a static scene and
  costs nothing when nothing changed. Prefer it whenever a `SceneDocument` is
  available.
- `stats` on all three is free to read and designed to be fed into
  [diagnostics](diagnostics.md) counters (`render.instances`, `render.culled`).
- Culling allocates one AABB per instance tested. For scenes far larger than
  10,000 objects, a spatial index in front of the per-instance test is the next
  step; the API is shaped to accept one without changing callers.
- `IncrementalRenderWorld` holds one cache entry per entity. Call `invalidate()`
  when discarding a world so the cache is not kept alive by the extractor.

## Multiplayer considerations

A dedicated server does not extract render worlds at all. Culling and LOD are
presentation concerns and must never affect simulation — an object culled on one
client still exists, still moves, and still collides.

## XR considerations

Stereo rendering needs a frustum per eye. Build them with `cameraFrustum` from
each eye's camera snapshot and union the results, or cull once against a
widened frustum; culling per eye twice is usually the wrong trade, since the
two views overlap almost entirely.

## Vegetation instancing and impostors (Mirage)

Scattered vegetation (`scatterVegetation`, `vegetationInstances` — see
[`terrain.md`](terrain.md)) is not a separate draw path: it produces ordinary
`RenderInstanceSnapshot`s, one per placed tree/rock, so culling and LOD above
apply to it unchanged. `vegetationLodRegistry` builds an `LodRegistry` chain
per prototype that has an impostor mesh, switching to it below a screen-height
threshold exactly the way any other mesh's LOD chain would — a billboard
impostor is just another mesh id as far as this pipeline is concerned. A
prototype with no `impostorMeshId` is left out of the registry and stays at
full detail at any distance (or gets its own `cullScreenHeight` if it should
disappear instead).
