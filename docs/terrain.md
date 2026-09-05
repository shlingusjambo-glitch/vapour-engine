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

