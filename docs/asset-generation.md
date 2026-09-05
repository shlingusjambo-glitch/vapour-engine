# AI-native asset generation

`@vapour/assetgen` exists to solve one problem: **an AI agent building a game
cannot open Blender.** It can write text. So Vapour needs a representation in
which a building is described as floors, walls, openings, and a roof — tens of
numbers — rather than as the hundreds of thousands of triangles those things
become.

This page covers the geometry kernel, which is the foundation the domain
generators (architecture, characters, vegetation) are built on.

## Concept

The design is a small set of composable layers, not a catalogue of shape
functions. That distinction matters: a catalogue can only make what someone
anticipated, while four composable layers make things nobody enumerated.

| Layer | What it provides |
| ----- | ---------------- |
| **Mesh** | Flat typed arrays — the one representation everything speaks |
| **Primitives** | Parametric solids: box, sphere, cylinder, cone, capsule, torus, plane |
| **Transform** | Placement, mirroring, fitting, repetition, grids |
| **Profile** | 2D outlines with extrude, revolve, sweep, and loft |
| **CSG** | Union, subtraction, intersection |

Everything is **deterministic and pure**: the same description always produces
the same geometry, which is what makes generated assets reviewable in version
control and reproducible across a network.

Every primitive is a **closed, correctly wound solid**, so it works directly as
a CSG operand and as a physics collider without a repair step.

## Basic example

```ts
import { box, subtract, translateMesh } from "@vapour/assetgen";

// A wall with a window: two boxes and one subtraction.
const wall = box({ width: 4, height: 3, depth: 0.2 });
const opening = translateMesh(box({ width: 1, height: 1.2, depth: 1 }), [0, 0.3, 0]);
const result = subtract(wall, opening);
```

## Profiles: why this layer matters most

A wall is a rectangle extruded. A column is a profile revolved. A moulding, a
railing, a road, a river, a pipe, a roof edge, and a sword blade are all a small
2D outline swept along a path.

```ts
import { profile, rectangleProfile, circleProfile, extrudeProfile, revolveProfile, sweepProfile } from "@vapour/assetgen";

// A wall with a window opening, in one extrusion.
const facade = profile(rectangleProfile(6, 3).outline, [rectangleProfile(1, 1.2).outline]);
const wall = extrudeProfile(facade, { depth: 0.25 });

// A turned column: an outline revolved about Y.
const column = revolveProfile([[0, 0], [0.3, 0], [0.25, 2], [0.35, 2.2], [0, 2.2]], { segments: 32 });

// A handrail following a path.
const rail = sweepProfile(circleProfile(0.04, 8), {
  path: [[0, 1, 0], [0, 1, -3], [1, 1.5, -4], [4, 1.5, -4]],
});
```

Profiles are closed polygons in the XY plane. Outer boundaries wind
counter-clockwise, holes clockwise — the same convention SVG, fonts, and every
polygon library use, so imported outlines need no conversion. Winding is
normalized on construction, so callers never have to think about it.

`sweepProfile` uses a **rotation-minimizing frame**: each frame is carried
forward from the last rather than derived from a fixed up vector. Without that,
a railing following a curve visibly twists — the classic naive-sweep artefact.

## CSG

Booleans are what turn a library of shapes into a modelling language. A doorway,
an arch, a bevel, a bullet hole, and a cave mouth are all one solid minus
another, and none is expressible by placing primitives alone.

```ts
import { subtractAll, unionAll, intersect } from "@vapour/assetgen";

const facade = box({ width: 10, height: 4, depth: 0.3 });
const windows = [-3, -1, 1, 3].map((x) => translateMesh(box({ width: 1, height: 1.5, depth: 1 }), [x, 0.5, 0]));
const result = subtractAll(facade, windows);
```

**Operands must be closed solids.** An open surface has no inside, so "inside A
but outside B" is undefined; the check runs up front and the error says how to
fix it, rather than letting the mistake surface as holes in the result.

### T-junction repair

Boolean output is geometrically watertight but topologically leaves
**T-junctions**: a vertex sitting in the middle of a neighbouring triangle's
edge. The volume is exactly right, but the mesh reports as open, which means it
cannot be cut again, a mesh collider built from it can leak, and smooth normals
break across the junction as a visible crack.

`subtract`, `union`, and `intersect` therefore run `repairTJunctions` on their
output by default, which is what makes results chainable:

```ts
const once = subtract(wall, window);
const twice = subtract(once, doorway);   // works because `once` is closed
```

## Mesh utilities

| Function | Purpose |
| -------- | ------- |
| `weldVertices` | Merges coincident vertices; fixes seams, shading, and closure |
| `computeNormals` | Area-weighted smooth normals, or flat via `{ smooth: false }` |
| `repairTJunctions` | Makes boolean output manifold again |
| `isClosed` | Every edge shared by exactly two triangles |
| `signedVolume` | Positive for an outward-wound solid — a fast correctness check |
| `surfaceArea` | Budgeting texel density and LOD thresholds |
| `validateMesh` | Catches out-of-range indices and mismatched attribute counts |

`validateMesh` matters more than it looks: generated geometry is produced by
code an AI agent wrote, and an index pointing past the end of the vertex array
is silent corruption on the GPU but an obvious message here.

## Vapour Script

```vapour
use assetgen

fn build_shed() -> Mesh {
  let shell = assetgen.box({ width: 3, height: 2.4, depth: 4 })
  let cavity = assetgen.box({ width: 2.8, height: 2.2, depth: 3.8 })
  let door = assetgen.translate(assetgen.box({ width: 0.9, height: 2, depth: 1 }), [0, -0.2, 2])
  return assetgen.subtract_all(shell, [cavity, door])
}
```

## Performance considerations

- CSG cost grows with the product of the two operands' triangle counts. Cut with
  the **simplest possible cutter**: a box, not a cylinder with 64 sides.
- `subtractAll` repairs between cuts so each intermediate stays a valid operand.
  For many cuts against one base this is still far cheaper than nesting calls.
- `weldVertices` and `repairTJunctions` both use a spatial hash sized from the
  mesh's own extent, so they stay usable on the hundreds of thousands of
  vertices a city block produces.
- Choose weld tolerances carefully. Too coarse and genuinely distinct vertices
  merge, which breaks manifoldness rather than fixing it; the default of `1e-5`
  suits assets authored in metres.
- Generation is pure and deterministic, so it parallelizes across workers with
  no shared state.

## Multiplayer considerations

Because generation is deterministic, a server and its clients running the same
description produce byte-identical geometry. Replicate the **description**, not
the mesh: a building is a few hundred bytes of parameters and megabytes of
triangles.

## XR considerations

Generated geometry has no inherent triangle budget, and an XR target is the
least forgiving place to discover that. Check `meshStats` against a budget as
part of generation rather than after profiling on device.

## Architecture

The layer the whole system exists to enable. A building is described the way a
person would describe one, and becomes geometry with materials, collision, and
the metadata navigation needs.

```ts
import { generateBuilding, rectangularWalls, compileBuilding } from "@vapour/assetgen";

const building = generateBuilding({
  name: "Cottage",
  wallThickness: 0.25,
  floors: [
    {
      level: 0,
      height: 2.7,
      walls: rectangularWalls(-4, -3, 4, 3, {
        openings: {
          north: [{ kind: "door", offset: 4, width: 1, height: 2.1 }],
          east: [{ offset: 3, width: 1.2, height: 1.1, sill: 1 }],
        },
      }),
      rooms: [{ name: "Living room", footprint: [[-3.8, -2.8], [3.8, -2.8], [3.8, 2.8], [-3.8, 2.8]] }],
      stairs: [{ position: [3, 2], rotation: 180, steps: 15, rise: 2.7 }],
    },
    { level: 2.7, height: 2.4, walls: rectangularWalls(-4, -3, 4, 3) },
  ],
  roof: { kind: "gable", pitchHeight: 1.8, overhang: 0.4 },
});

const asset = compileBuilding(building);
```

That description is **901 bytes of JSON**. It produces 580 triangles and ~49 KB
of geometry — a 54× expansion — in about 70 ms, plus:

- **4 apertures** with world positions, one of them walkable,
- **2 room footprints** with their floor levels,
- **material slots** per element kind (wall, floor, roof, stairs, trim).

Nothing in the description mentions a vertex.

A wall is two points, a height, and a thickness. An opening is an offset along
that wall and a size — not a world coordinate, because resolving offsets into
world space is exactly the arithmetic an author should not be doing. Openings
that do not fit are reported (`does not fit in a wall 2 long`) instead of
producing broken geometry.

## Compiling to a runtime asset

Generation produces triangles. A game needs more, and producing it *from the
description* is the point — an agent that had to hand-author a collider for
every generated building would be back where it started.

```ts
import { compileAsset } from "@vapour/assetgen";

const asset = compileAsset(mesh, { lodLevels: 3, collision: { kind: "convex" } });
// asset.mesh        — with triplanar UVs
// asset.lods        — successively coarser levels
// asset.collision   — box, convex hull, or budgeted triangle mesh
// asset.navigation  — walkable surfaces and doorway links (buildings only)
```

| Stage | What it does |
| ----- | ------------ |
| `generateTriplanarUvs` | Projects each face along its dominant axis |
| `simplifyMesh` | Vertex clustering to a triangle budget |
| `generateLodChain` | Successively coarser levels, stopping when it stops helping |
| `generateCollision` | `box`, `convex` (hull), or budgeted `mesh` |
| `extractWalkableSurface` | Triangles within a slope limit |
| `generateNavGeometry` | Room surfaces plus doorway links |

**Simplification uses vertex clustering, not edge collapse.** Clustering is
O(n), never fails on the non-manifold output that generation and CSG produce,
and its error is bounded by the cell size — so an LOD budget translates directly
into a visual tolerance. Edge collapse gives better silhouettes but needs clean
manifold input, which generated geometry frequently is not.

**Convex hulls** use incremental construction, and reject degenerate input —
fewer than four points, collinear, or coplanar — rather than returning a "hull"
with no inside that nothing could collide with.

### Navigation falls out of the description

```ts
const nav = generateNavGeometry(building);
// nav.surfaces — room footprints with their floor levels
// nav.links    — one per *walkable* aperture
// nav.walkable — triangles within the slope limit
```

Windows are excluded from links. An agent that routes through a first-floor
window is a bug that is much cheaper to prevent here than to debug later, so
`walkable` is decided at generation time from the opening's kind and sill
height.

## Vapour Script

```vapour
use assetgen

fn build_shed() -> Mesh {
  let shell = assetgen.box({ width: 3, height: 2.4, depth: 4 })
  let cavity = assetgen.box({ width: 2.8, height: 2.2, depth: 3.8 })
  let door = assetgen.translate(assetgen.box({ width: 0.9, height: 2, depth: 1 }), [0, -0.2, 2])
  return assetgen.subtract_all(shell, [cavity, door])
}
```

## Characters

A character is the hardest asset to describe in text, because "a person" is not
a shape — it is a set of proportions, a skeleton, a skinned surface, and a set
of expectations about what animations will play on it. Getting any one wrong
makes the other three useless.

```ts
import { generateCharacter, generateCrowd, characterColliders } from "@vapour/assetgen";

const npc = generateCharacter({ height: 1.8, build: "heavy", style: "realistic" });
// npc.mesh        — 2,920 triangles, feet exactly on y = 0
// npc.skeleton    — 22 bones, standard humanoid names
// npc.skin        — joints, weights, and inverse bind matrices
// npc.attachments — RightHand, LeftHand, Back, Hip, Head

const ragdoll = characterColliders(npc);   // 10 capsules from the same rest pose
const crowd = generateCrowd(50, { limbSegments: 6 }, 42);   // 84 ms
```

Three decisions make this usable rather than a curiosity:

**The skeleton is standard, not arbitrary.** Every generated character has a
bone called `LeftUpperArm` in the same place in the hierarchy, following the
same convention most engines and motion-capture pipelines use. One clip plays on
all of them, a retargeter can map to and from other rigs, and an IK solver finds
its chain without being told. An arbitrary per-character skeleton would make
each one an island.

**Proportions are fractions of height, not measurements.** Changing one number
produces a consistent character rather than a broken one, so a child, an adult,
and a stylized figure with an oversized head are the same call with different
numbers. The spine length is *derived* from the others so that hips + spine +
neck + skull equals the stated height — choosing it independently is how a
generator ends up producing a 1.8 m character that measures 2.01 m.

**Geometry is built from the rest pose.** Each limb is a capsule spanning its
bone, so the mesh and skeleton cannot drift apart, every vertex knows its bone
without a proximity-guessing skinning pass, and the same construction yields the
ragdoll capsules — which is what stops shots passing through a visible body.

`generateCrowd` is seeded, so a populated street is reproducible: a multiplayer
game replicates "spawn crowd 7" rather than fifty character descriptions.
