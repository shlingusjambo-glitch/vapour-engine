# Rendering architecture

Vapour's primary and only renderer is WebGPU. The browser host never creates a
WebGL context. `vapour-render` owns GPU state in Rust and `vapour-wasm` exposes
one canvas-level renderer to TypeScript.

## Responsibilities and public APIs

`GpuContext` selects an adapter, requests a device, records the adapter's
capabilities, and enables only optional features that the adapter reports.
Conservative WebGPU limit buckets are used on the web so the engine does not
request native-only limits or expose more identifying information than needed.

`SurfaceRenderer` owns the surface configuration, depth target, PBR render
pipeline, bind groups, buffers, textures, frame graph, encoding, submission,
and presentation. Resizing recreates only size-dependent targets. Zero-sized
canvases are retained but are not configured or rendered until they become
visible again.

`RenderGraph` describes texture and buffer reads and writes. Compilation adds
read-after-write, write-after-read, and write-after-write dependencies, rejects
uninitialized reads and cycles, and produces a stable execution order.

`ShaderLibrary` parses and validates WGSL with Naga before the shader reaches a
GPU device. This provides deterministic diagnostics in tests and asset-import
workflows in addition to WebGPU's device validation.

`Arena<T>` and `Handle<T>` provide typed, generational resource identities so
stale handles cannot silently address a newly allocated GPU resource.

## JS/WASM boundary

TypeScript supplies the `HTMLCanvasElement`, CSS-derived pixel dimensions, and
animation timestamp. It calls `resize` only when the backing size changes and
calls `render` once per animation frame. GPU adapters, devices, resources,
shaders, command encoders, and queue submission remain in Rust/WASM. The only
per-frame return value is a small statistics record.

Authored scenes are extracted into one versioned `RenderWorld` snapshot whenever
scene state changes. The snapshot contains stable entity IDs, resolved world
matrices, the active camera, the first active directional light, mesh primitive
IDs, and per-instance base colors. One serialized snapshot crosses into WASM;
there are no per-entity boundary calls in the animation loop. Rust validates the
entire snapshot before replacing live render state.

Running games use the parallel `FrameBuilder` path: mesh and material IDs are
interned once per frame while matrices and instance parameters cross as typed
arrays. Runtime geometry, RGBA8 textures, and standard materials are uploaded
as versioned resources outside the frame loop. This keeps chunk streaming and
procedural content off JSON and avoids fine-grained JavaScript/WASM calls.

`RenderHost.submitLayers` extends the binary path to several cameras without
several surface presentations. Mesh and material tables are interned across the
whole submission, instance arrays are concatenated, and compact count/flag
arrays divide the layers. Rust acquires the surface once, encodes a pass per
layer with explicit colour/depth load operations, and presents once. A
first-person game can render its world with colour and depth clears, then its
hands/tool with colour preserved and depth cleared. The same public API serves
editor overlays, minimaps, and portals. The first layer must clear both targets
so undefined presentation contents can never leak into a frame.

## CPU, workers, and GPU

- Main thread: canvas presentation, resize observation, editor interaction, and
  WebXR session ownership.
- Rust/WASM CPU: capability policy, frame extraction, render-graph compilation,
  culling orchestration, resource lifetime, and command encoding.
- Workers: mesh processing, texture transcoding, and future parallel visibility
  extraction when cross-origin isolation is available.
- GPU: rasterization, material evaluation, lighting, and future compute culling,
  particles, skinning, and post-processing.

## Standard material

The current standard WGSL material supports base color, metallic, roughness,
normal mapping, emission, ambient occlusion, alpha cutoff, UV scale, and UV
offset. It uses a GGX normal distribution, Smith visibility, Schlick Fresnel,
and linear lighting. The first integrated pass
renders indexed, depth-tested scene meshes through the compiled frame graph.
Instances of the built-in cube share one vertex/index mesh and are submitted in
one instanced draw. Camera transforms come from authored components;
documented preview defaults apply when a scene omits a camera or light rig.

Normal maps use a complete tangent-space path. Mesh uploads may provide one
`vec4` tangent per vertex (`xyz` direction and `w` bitangent handedness), and
the glTF/GLB importer preserves authored `TANGENT` accessors plus
`normalTexture.scale`. When a procedural or legacy mesh supplies UVs but no
tangents, Rust generates a shared per-vertex tangent frame from triangle UV
gradients, orthogonalizes it against the normal, and derives the bitangent
sign. Degenerate UV triangles receive a deterministic perpendicular fallback
instead of NaNs. The PBR shader reconstructs the TBN frame after transforming
the normal and tangent and applies the material's normal scale before lighting.

```ts
renderHost.uploadMesh("terrain:chunk-12", {
  positions,
  normals,
  uvs,
  tangents, // optional Float32Array: x, y, z, handedness per vertex
  indices,
});
```

The upload boundary rejects a tangent count other than four values per vertex,
and the Rust mesh validator rejects non-finite or non-unit generated data. A
normal-mapped mesh still needs meaningful UVs; without them the stable fallback
frame prevents corruption but cannot infer an artist-authored surface direction.

Game frames carry a reusable `LightRig` of up to 64 ambient, hemisphere,
directional, point, and spot lights. Records use four aligned `vec4` lanes, so
the typed array maps directly to WGSL uniforms. Point and spot lights support
range attenuation, and spot cones cross the boundary as cosines. Every render
layer owns an independent rig, allowing a first-person view model to use its
own fill/key lights while the world keeps its sun, sky, and local lights. The
legacy seven-float directional-light form remains accepted and is widened at
the boundary.

Each frame can also carry three aligned environment lanes: linear clear RGBA,
fog RGB/mode, and fog parameters. Linear distance fog and exponential-squared
fog is evaluated from world-space camera distance in scene-linear light, so
they work consistently for streamed chunks and ordinary meshes. Layered views
have independent environments; a view model can omit fog while the world keeps
its authored atmosphere. Invalid modes, ranges, densities, lengths, and
non-finite values are rejected before GPU submission.

## HDR and tone mapping

All scene layers render into one `rgba16float` scene-referred target. This
preserves values above display white for emission, intense lights, and the
post-processing chain instead of clipping each material directly into the
swapchain. A fullscreen presentation pass applies exposure once and maps the
result into the surface's sRGB format.

```ts
renderHost.setPostProcess({ exposure: 1.25, toneMapping: "aces" });
```

Available operators are `aces` (the default, with cinematic highlight rolloff),
`reinhard` (simple and predictable), and `none` (diagnostics or an external
presentation pipeline). Exposure is a linear multiplier in `[0, 64]`; invalid
or non-finite settings fail before reaching the GPU. The selected configuration
is retained across initialization and can be read with `postProcess()`.

The HDR target is recreated with depth on canvas resize. PBR, transparent
layers, and fog finish before presentation, leaving the HDR texture available
for bloom and later render-graph effects.

The presentation stack also provides thresholded wide-kernel bloom, saturation,
contrast, vignette, and chromatic-aberration controls. Effects operate in a
stable order: lens sampling, HDR bloom, exposure/tone mapping, colour controls,
then vignette. Defaults are neutral and therefore cost only the final
presentation pass; bloom sampling is skipped when intensity is zero.

```ts
renderHost.setPostProcess({
  exposure: 1.1,
  toneMapping: "aces",
  bloom: { intensity: 0.7, threshold: 1.0, scatter: 0.65 },
  saturation: 1.05,
  contrast: 1.08,
  vignette: 0.18,
  chromaticAberration: 0,
});
```

Bloom intensity is limited to `[0, 10]`, threshold to `[0, 64]`, scatter and
lens effects to `[0, 1]`, and saturation/contrast to `[0, 4]`. TypeScript and
Rust independently validate the boundary, producing the setting name and valid
range when authored data is invalid.

## Procedural skies

A render layer can opt into an engine-native HDR procedural sky. It is drawn by
a fullscreen WebGPU pass before scene geometry and reconstructs world-space
view rays from the inverse view-projection matrix. The sky therefore rotates
with the camera but remains at infinite distance when the camera moves. This is
the same path for editor views, ordinary game cameras, split views, and XR eye
cameras; no sky dome geometry or game-owned follow script is required.

```ts
world.setEnvironment({
  clearColor: [0.02, 0.04, 0.1, 1],
  sky: {
    mode: "procedural",
    zenithColor: [0.04, 0.16, 0.9],
    horizonColor: [1.1, 0.42, 0.12],
    groundColor: [0.025, 0.02, 0.018],
    horizonCurve: 0.7,
    sunAngularRadius: 0.00465,
  },
});
```

Sky colours are linear HDR values, so values above one deliberately bloom and
tone-map. The first directional light supplies the sun direction, colour, and
intensity. Consequently the visible sun, direct lighting, and cascaded shadows
cannot drift apart during a day/night cycle. The renderer rejects negative or
non-finite colours, non-positive gradient curves, and invalid angular radii
with the precise setting named in the error.

Skies are per-layer and only draw when that layer clears colour. Overlay and
view-model cameras which preserve prior colour never overwrite the world sky.
Environment-map backgrounds, stars/cloud layers, and atmospheric scattering
remain separate capabilities from this procedural gradient implementation.

## Directional shadows

The first world layer renders four cascades into a 2048×2048 `depth32float`
texture array before standard PBR shading. Practical logarithmic splits keep
resolution near the camera, sphere fitting and whole-texel light-space
snapping prevent camera shimmer, and the depth pipeline applies front-face
culling plus slope bias. The material pass selects cascades with camera-space
depth and performs a 3×3 comparison-filtered sample. Transparent materials do
not cast shadows; opaque and alpha-masked geometry currently share the opaque
depth path, so texture-driven cutout silhouettes are a documented limitation.

Only the first presentation layer owns the world shadow map. Later layers such
as first-person hands and editor overlays deliberately sample no shadows,
avoiding stale matrices when they use independent cameras. Directional lights
with zero intensity and rigs without a directional light disable sampling.

Textures and materials are real stable-ID resources. A material can bind base
color, normal, packed metallic/roughness, occlusion, and emission textures with
independent sampler filtering and wrap policy. Replacing a texture atomically
rebuilds dependent bind groups; releasing a referenced texture is rejected with
the material ID that still owns it.

Grid texture atlases are first-class rather than voxel-game shader glue. A mesh
may carry one `textureLayers` float per vertex. A standard material can declare
`atlas: { columns, rows, inset, origin }`; the shader repeats local UVs within
the selected cell and applies a border inset to prevent filtered bleeding. The
same API serves voxel chunks, tile-like procedural 3D meshes, and migrated
custom geometry. Non-atlas materials ignore the layer attribute.

Standard materials declare `opaque`, `mask`, or `blend` alpha mode, whether
faces are double-sided, and whether the depth buffer is written. Six cached
pipeline variants cover those raster states without compiling pipelines during
gameplay. Opaque and cutout instances sort for maximum batching; blended
instances draw afterward from far to near and only instance consecutive equal
mesh/material runs. Sorting is object-origin based today, so intersecting
transparent meshes remain a documented order-independent-transparency limit.

This is an experimental foundation, not the completed production renderer.
Compressed GPU texture formats, point/spot shadows, image-based lighting,
weighted/order-independent transparency, deferred paths, GPU-driven visibility,
and XR multiview are still release-gated work.

## Capability tiers and failures

Adapters are classified as baseline, enhanced, or high-end from optional
features such as timestamp queries, indirect drawing, shader `f16`, and texture
compression. Baseline adapters remain valid; optional paths must not become
unconditional requirements.

Missing WebGPU, adapter selection failures, adapter/device requests that never
settle, surface creation failures, shader
validation failures, surface acquisition failures, and device loss are surfaced
to the editor. Adapter/device creation has a bounded timeout with driver and
hardware-acceleration guidance. Failures are never converted into a blank
viewport or an infinite loading screen.

## Serialization and extension

Materials and shader references will serialize as stable asset IDs; runtime GPU
handles are transient and are never written into project files. Plugins will
extend rendering by registering shader assets, material schemas, and named
render-graph passes. A plugin pass must declare every resource access so the
graph can order it and diagnose hazards.

## Verification

- Unit tests cover generational handles, shader validation, graph ordering,
  hazards, cycles, execution errors, render-world validation, hierarchy
  extraction, component filtering, packed light rigs, layer-table remapping,
  independent layer cameras, and unsupported mesh diagnostics.
- `cargo bench -p vapour-render --bench render_graph` measures graph compilation
  at 16, 64, and 256 sequential passes.
- `cargo check -p vapour-wasm --target wasm32-unknown-unknown` verifies the web
  target.
- The editor production build copies the generated JavaScript and WASM modules.
- Browser smoke testing verifies both renderer startup and actionable adapter
  failure behavior.

## Meshes and batching

Seven meshes are generated in Rust at startup (`crates/vapour-render/src/mesh.rs`)
rather than loaded from files: cube, sphere, capsule, cylinder, cone, plane, and
quad. Each is uploaded once into a mesh table indexed by a stable slot.

Two invariants are enforced by tests:

- **Every mesh fits inside the unit cube centred on the origin**, so a Transform
  scale of 1 is one world unit regardless of which primitive an entity uses.
- **Triangles wind counter-clockwise seen from outside**, matching the
  pipeline's `FrontFace::Ccw` with back-face culling. The winding test caught
  four inverted primitives during development that would have rendered
  invisible.

On submission, instances are sorted by material and mesh slot and collapsed
into contiguous `DrawBatch` runs. A thousand cubes sharing one material are one
draw; the same mesh with two materials is two draws. Sorting is stable, so
entities keep a deterministic order within a batch and frames stay reproducible.

The editor keeps a mirrored catalogue in `packages/engine/src/mesh-library.ts`
for the facts it needs synchronously — dropdown entries, hit-test extents,
triangle budgets — without a WASM round trip per pointer move. The Rust test
`catalogue_matches_the_editor_mesh_library` fails if the two tables disagree on
extents or triangle counts.

## Material assets and per-instance parameters

Each instance carries
`[metallic, roughness, emissive strength, alpha cutoff]` as a single vertex
attribute alongside its base colour, so many instances can vary surface response
without cloning a material. Emission tints by the instance's own base colour,
which keeps a glowing object to one number rather than a second colour to hold
in sync.

The shared material asset supplies texture bindings, base/emission factors, UV
transform, normal and occlusion strength, sampler policy, and optional atlas
layout. Material and texture definitions are replayed before meshes when a
device is rebuilt, preserving dependency order.
