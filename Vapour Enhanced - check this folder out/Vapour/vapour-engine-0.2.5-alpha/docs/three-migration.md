# Migrating a Three.js game

`@vapour/three-bridge` is an incremental migration tool for substantial games
that already describe scenes with Three.js. It is not a WebGL compatibility
renderer. Three may supply its object graph, transforms, geometry generators,
and math while Vapour owns the canvas, WebGPU device, shaders, resources, frame
submission, and presentation.

```ts
import { ThreeSceneBridge } from "@vapour/three-bridge";

const bridge = new ThreeSceneBridge(canvas, {
  wasmModuleUrl: new URL("vapour_runtime.js", document.baseURI).href,
  onDiagnostic(message) {
    console.warn(message);
  },
});

await bridge.initialize();
bridge.render(scene, camera);
```

The bridge currently translates `Mesh`, `InstancedMesh`,
`PerspectiveCamera`, and ambient, hemisphere, directional, point, and spot
lights. Geometry uploads use typed arrays,
`u32` indices, vertex color, per-vertex texture layers, and stable geometry
versions. Standard base-color, normal, packed metallic/roughness, occlusion,
and emission maps become stable Vapour texture/material assets. Frames use Vapour's
packed binary path rather than per-instance JSON. Stale geometry is released.

First-person view models and other composed views use one atomic presentation:

```ts
bridge.renderLayers([
  { scene: world, camera: worldCamera },
  {
    scene: handsAndTool,
    camera: viewModelCamera,
    clearColor: false,
    clearDepth: true,
  },
]);
```

Resources are tracked across the entire layer set, so geometry and materials
shared by layers are not re-uploaded. Each layer retains its own camera and
light rig.

`Scene.background` colours, `Fog`, and `FogExp2` become Vapour frame
environments. They are read every frame, so a day/night system can animate sky
and fog colours without rebuilding materials or GPU pipelines.

For grid atlases, set migration metadata on the Three material and provide a
`textureLayer` geometry attribute. The adapter also recognizes the common
legacy voxel attribute `aTile`:

```ts
material.userData.vapourAtlas = {
  columns: 16,
  rows: 96,
  inset: 0.006,
  origin: "top-left",
};
geometry.setAttribute("textureLayer", new THREE.BufferAttribute(tileIds, 1));
```

Normalized `vertexOcclusion` attributes multiply into Vapour vertex colour.
The migration adapter also translates the common legacy `aAO` range of 0–3,
so voxel ambient occlusion does not require a CubeGame-specific shader path.

Tests and dedicated servers can inject the explicit `HeadlessRenderHost`. It
validates the same mesh/frame contract and gathers workload statistics without
claiming to render an image. Vapour never silently selects it when WebGPU fails.

## Current fidelity limits

- `ShaderMaterial` and custom vertex attributes need Vapour material/shader
  assets; only the standard material subset is translated today.
- Standard transparency, alpha cutout, double-sided raster state, and depth
  write policy are translated. Explicit Three `renderOrder`, custom blending,
  and transmission/refraction are not yet preserved.
- `Line` and `Points` produce diagnostics and are omitted.
- Texture and cube-texture backgrounds still need skybox assets; colour
  backgrounds are translated.
- `SkinnedMesh` currently submits bind-pose geometry; GPU skinning is pending.
- Material arrays use their first material.
- Post-processing still requires additional Vapour render-graph passes.

These are explicit port gates, not silent fallbacks. The real CubeGame port is
used to close them as general renderer features. A migration is finished only
when the game no longer needs Three for scene ownership and the bridge can be
removed.

## Boundary ownership

Keep gameplay, save data, world generation, and worker protocols independent
of the bridge. Convert one presentation boundary at a time. New reusable
systems belong in `@vapour/engine`; game-specific rules remain in the game or a
plugin. This lets other projects consume cameras, streaming, materials, and
controllers without inheriting CubeGame behavior.
