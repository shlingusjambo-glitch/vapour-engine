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
- GPU: rasterization, material evaluation, lighting, compute frustum culling
  (see below), skinning, post-processing, and future compute particles.

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

## Environment maps and image-based lighting

One environment cubemap lights every layer of a frame. It arrives in one of
two ways:

```ts
// Six RGBA8 faces (+X, -X, +Y, -Y, +Z, -Z), each faceSize² texels.
renderHost.uploadEnvironment({ faceSize: 256, faces, colorSpace: "srgb", intensity: 1 });

// Or capture the submitted frame's procedural sky and light rig.
renderHost.deriveEnvironmentFromSky(1);

renderHost.clearEnvironment(); // back to the analytic gradient
```

Both paths end in `EnvironmentGpu::convolve`
(`crates/vapour-render/src/surface/environment.rs`), which runs
`ibl_prefilter.wgsl` once per face per mip: a GGX importance-sampled specular
chain (`prefiltered_mip_count` levels from the full face down to 4×4, mip `i`
standing for roughness `i / (count - 1)`, so a 128-face map has six levels at
roughness 0, 0.2, …, 1) and a 32×32 cosine-weighted irradiance cube. Samples
read the source at a mip chosen by their solid angle, which keeps a bright
sun disc from turning into fireflies. The split-sum BRDF lookup
(`ibl_brdf_lut.wgsl`, 128×128) is rendered once at startup. All three are
`rgba16float`.

The material pass (`standard_pbr.wgsl`) samples them through frame bindings
5–8 when `ibl_params.x` is set: specular is the prefiltered radiance at
`roughness * highestMip` times `F0 * lut.x + lut.y`; diffuse is albedo times
irradiance, scaled by `(1 - F) * (1 - metallic)`; both are multiplied by the
material's occlusion. Ambient and hemisphere lights in the rig still add on
top, so a scene can tint its environment. With no environment live, the
ambient term is the analytic sky gradient it always was, so nothing changes
for a game that never uploads one.

Uploaded faces are mipmapped on the CPU in linear light (the same
`mip_chain` textures use). Sky capture renders `procedural_sky.wgsl` into a
128-face cubemap through `cube_face_ray_basis`, a per-face matrix whose
rotation maps clip space straight onto the sampling parameterisation, so no
mirrored-face fixups exist. `cube_face_direction` and `cube_face_uv` are the
Rust reference for that parameterisation; a test round-trips them against
the GPU's face-selection rules, and a real-device test convolves a uniform
grey cubemap and asserts every specular mip and the irradiance read back as
that grey (the cosine-weighted mean of a constant is the constant), plus the
BRDF lookup's smooth/rough and head-on/grazing corners.

Capture is an explicit call, not automatic: it costs the six sky faces plus
`6 × (specularMips + 1)` small passes, so a day/night cycle should recapture
at a cadence it chooses (every second or two is invisible) rather than every
frame. The uploaded map is replayed when the device is rebuilt; a sky-derived
one is not, since it came from a frame the host no longer holds — call
`deriveEnvironmentFromSky` again after `initialize()` resolves.

The environment is renderer-global rather than per layer today; a view model
layer shares the world's map. WebGPU device limits are requested at the
specification's guaranteed defaults (`wgpu::Limits::default()` resolved to
the adapter's resolution), which every conforming browser provides and which
include the storage buffers and compute workgroups the skinning, culling, and
particle paths need.

## Render textures and viewports

A camera layer can render into a texture instead of the surface, and any
material can sample that texture under the same identifier
(`crates/vapour-render/src/surface/render_target.rs`).

```ts
renderHost.createRenderTarget("rt:monitor", { scale: 0.5 });      // follows the surface
renderHost.createRenderTarget("rt:map", { width: 256, height: 256 }); // fixed
renderHost.defineMaterial("screen", { textures: { baseColor: "rt:monitor" } });

renderHost.submitLayers([
  { frame: securityCamera.pack(), target: "rt:monitor" },
  { frame: world.pack() }, // draws the "screen" material showing the feed
  {
    frame: rearView.pack(),
    clearColor: false,
    clearDepth: true,
    viewport: { x: 0.7, y: 0.05, width: 0.25, height: 0.25 },
  },
]);
```

A target is an `rgba16float` colour texture plus its own depth, so a layer
renders into it with the same HDR pipeline as the surface; materials sample
it in scene-linear light, which is exactly right for a glowing screen and
means tone mapping happens once, at presentation. Layers render in
submission order, so a target drawn by an earlier layer is complete before a
later layer samples it; a target drawn later shows last frame's image.

**Sizing policy.** `{ scale }` targets follow the presentation surface at
that fraction and reallocate whenever a resize changes their texel extent
(rounding up, so 0.5 of an odd width never drops a row); `{ width, height }`
targets never reallocate. Reallocation rebuilds every material bound to the
target atomically — the same path a replaced texture takes — so no bind
group is left holding a freed texture. A real-device test resizes a
0.5-scale target from 640×480 to 800×600 and checks it became 400×300, and
that a fixed target keeps the very same texture object.

**Viewports.** `viewport` is a normalized `x, y, width, height` rectangle on
the layer's destination. It is applied as both viewport and scissor, so a
clear or a sky stays inside the rectangle, and the layer's projection uses
the rectangle's aspect, not the surface's. Side-by-side stereo is two layers
at `{ x: 0, width: 0.5 }` and `{ x: 0.5, width: 0.5 }`.

**Cycles.** A layer cannot sample the target it renders into, directly or
through other targets rendered the same frame; that would read a texture
while writing it. Both sides reject it before any GPU work with the chain
named: `render target 'monitor' is sampled by a layer that renders into it
(monitor -> monitor); a camera cannot read the texture it writes`. Rust runs
`detect_render_target_cycle` inside `set_render_layers`; the headless host
runs the identical `detectRenderTargetCycle` in TypeScript so CI without a
GPU sees the same error. Shadows and decals belong to the surface: shadow
maps are rendered from the first layer regardless of destination, and decals
apply only when the first layer presents to the surface.

## Decals

Decals are box projections onto the depth buffer, drawn in their own pass
between the material pass and tone mapping (`decal.wgsl`,
`crates/vapour-render/src/surface/decal.rs`). Each decal is the built-in
unit cube placed by a world matrix: scale x/y sets the projected size, scale
z the depth reach. The pass rasterises that box's back faces (so a camera
inside the volume still covers it), reads the scene depth under each pixel,
reconstructs the world position through the inverse view-projection, and
keeps pixels whose position falls inside the box. The atlas region is
projected along the box's local -Z with +X right and +Y up, and alpha-blended
onto the HDR target; depth is read, never written, so decals never disturb
the geometry they sit on.

```ts
renderHost.uploadTexture("decals:atlas", atlas);
renderHost.submitDecals(
  packDecals([
    {
      matrix: bulletHoleWorldMatrix, // unit box, scaled 0.2 × 0.2 × 0.1
      region: [0, 0, 0.5, 0.5],       // atlas cell
      tint: [1, 1, 1, 1],
      opacity: 1,
      angleCutoff: 0.35,              // cosine; fades off glancing surfaces
      angleSoftness: 0.2,
      zFade: 0.25,                    // fade at the front/back faces
    },
  ]),
  "decals:atlas",
);
```

Per decal, the 28-float record carries the matrix, the atlas region, a
linear RGBA tint, and `[opacity, angleCutoff, angleSoftness, zFade]`. The
surface normal for the angle fade is reconstructed from the screen-space
derivatives of the depth-derived position, so a wall decal does not smear
down the floor it meets. Omitting the atlas draws tint-only decals. The set
persists until replaced, applies to the first (world) layer's depth only, and
is capped at 4096 per frame; every record is validated on both sides of the
boundary (singular matrices, regions outside [0, 1], opacity outside [0, 1],
non-finite values). `decalLocalUv` in TypeScript and `decal_local_uv` in
Rust are the same projection on the CPU — both are tested against the same
known points — for tools that need to know what a decal covers.

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
Compressed GPU texture formats, weighted/order-independent transparency, and
deferred paths are still release-gated work.

## Point and spot shadows

Point and spot lights share one atlas — 12 `depth32float` slots at 512×512,
rendered with the same shadow pipeline the directional cascades use (it is a
depth-only pass, indifferent to which view matrix it is fed). A point light
claims 6 consecutive slots, one per cube face in the order +X, -X, +Y, -Y, +Z,
-Z (`cube_face_view_matrices` in `crates/vapour-render/src/surface/shadow.rs`);
a spot light claims 1, projected with its own outer cone angle and range
(`spot_shadow_matrix`).

Twelve slots is not enough for every light in a busy scene to cast a shadow at
once, so `assign_shadow_slots` runs every frame and decides who gets one:
every candidate is scored `intensity / distance_to_camera²`, sorted highest
first, and packed greedily into the remaining budget. A light that no longer
fits — not enough consecutive slots left, most often a point light behind a
wall of spot lights — is skipped entirely for that frame: it still lights the
scene, just without a shadow, rather than fragmenting slots or evicting a
light already placed. The assignment is recomputed from scratch every frame,
so it holds no state and cannot desync from the light rig.

A light's assigned base slot travels with it in an otherwise-unused lane of
its own GPU record (`GpuLight.cone.z`, see `lighting.rs`) rather than as a
separate mapping table, so the shader needs no extra indirection: a negative
value means "no slot, no shadow", and a point light's fragment shader picks
its face by which axis of the light-to-fragment direction dominates. Only the
first presentation layer's lights compete for slots, matching the directional
shadow's existing scope.

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

### GPU-driven frustum culling

After batching, every instance also gets a culling record
(`surface/culling.rs`, `CullInput`): its world bounding sphere — the mesh's
origin-centred bounding radius (`MeshGpu::bounding_radius`, farthest AABB
corner) scaled by the model matrix's largest axis — plus its batch index and
flags. `render` then culls each layer against the frustum planes of the same
view-projection its uniforms use, before any render pass:

- **GPU path** (`shaders/cull_instances.wgsl`, one thread per instance): a
  compute pass tests the sphere against the six planes and, on survival,
  claims a slot in its batch's run of a *compacted* instance buffer with an
  atomic on the batch's indirect `instance_count`. The material pass draws
  each batch with `draw_indexed_indirect` from that args buffer, so nothing
  about visibility crosses back to the CPU.
- **CPU fallback** (`cull_cpu`): the same test in Rust, writing the same
  compacted buffer and the same per-batch counts, drawn with explicit
  instance ranges. The survivor *set* per batch is identical on both paths;
  only the order inside a batch can differ (atomics on the GPU, submission
  order on the CPU), which is invisible for opaque geometry.

Blended batches are drawn back-to-front, so they pass through uncompacted in
their sorted slots with their count preset to the full run. Shadow passes see
the scene from the light, not the camera, so they keep drawing from the
uncompacted source buffer.

The compute path needs a non-zero `first_instance` in indirect args, which is
WebGPU's `indirect-first-instance` feature; `RenderCapabilities::gpu_culling`
(`gpuCulling` in `capabilities_json`) reports it. `set_gpu_culling(false)`
forces the fallback, and every frame's statistics say which path ran:
`FrameStats::gpu_culling` / `RustFrameStats.gpuCulling`, surfaced as
`RenderStats.culling: "gpu" | "cpu"`. The CPU path also reports
`culledInstances`; the GPU path compacts on-device without a readback, so it
reports `null`. `triangles` is the submitted count on both paths.

Verification: `culling::tests::gpu_and_cpu_culling_agree_on_every_batch` and
`..._on_a_random_scene` (1000 spheres, three seeds, ~32% survive) run the
compute pass on a real device, read the args and compacted buffers back, and
assert they match the CPU fallback record for record. They skip with a
notice only when the machine has no adapter.

The editor keeps a mirrored catalogue in `packages/engine/src/mesh-library.ts`
for the facts it needs synchronously — dropdown entries, hit-test extents,
triangle budgets — without a WASM round trip per pointer move. The Rust test
`catalogue_matches_the_editor_mesh_library` fails if the two tables disagree on
extents or triangle counts.

## Skinned meshes

A mesh's per-vertex skinning data (up to 4 bone indices and weights) lives in
`MeshData.skin` — parallel to `vertices`, not fields on `MeshVertex` itself, so
the overwhelming majority of meshes that are never skinned pay nothing for a
wider vertex. `crates/vapour-wasm`'s `upload_skinned_mesh` is the entry point;
it validates one index/weight quartet per vertex and is otherwise identical to
`upload_mesh`. Every uploaded mesh gets a skin buffer either way — a real
one, or a zero-filled `SkinVertex::UNSKINNED` one generated at upload time —
so the pipeline's vertex layout never has to branch between a skinned and a
static variant; it is bound as a third vertex buffer at locations 13
(`bone_indices`) and 14 (`bone_weights`), past `MeshVertex` (0-5) and
`InstanceData` (6-12: the model matrix, base colour, material parameters, and
the per-instance skin lane). WebGPU guarantees only 16 vertex attributes, and
all three buffers must fit inside them, which is why the normal matrix is not
an instance attribute: `normal_matrix_of` in `standard_pbr.wgsl` derives the
inverse-transpose from the model matrix per vertex instead. A test asserts
the three layouts stay disjoint and under the limit.

Posed bone matrices are supplied per frame, not per mesh: `set_render_layers`
takes `bone_offsets` (one float per instance — its base index into the shared
palette, or negative if it is not skinned) and `bone_matrices` (every skinned
instance's bones this frame, concatenated, 16 column-major floats each — see
`pack_bone_palette`). They upload into one fixed-size storage buffer
(`MAX_BONE_MATRICES` = 4096 bones) bound alongside the frame uniforms, so the
frame bind group never needs rebuilding as the skinned-instance count
changes; a submission that would overflow it is rejected rather than
truncated. On the TypeScript side, `packRenderLayers` concatenates each
layer's bone palette and rebases its instances' offsets into the shared
buffer automatically — a game only ever supplies offsets local to its own
layer. `@vapour/engine`'s `skinningMatrices` (in `src/animation/skinning.ts`)
already produces the flat, column-major matrix array this expects.

The vertex shader blends up to 4 bone matrices by normalised weight in local
space, before the instance's model matrix — `skin_vertex_position` in
`crates/vapour-render/src/mesh.rs` is the exact CPU-side reference for that
blend, kept in step with `standard_pbr.wgsl`'s `vertex_main` by a matching
test. A vertex with total weight at or near zero, or an instance with no
granted bone offset, renders in its authored rest pose. Skinning is applied
only in the material pass today: shadow casters render skinned meshes in
their rest pose, a documented limitation until the shadow pipeline's bind
groups also carry the bone buffer.

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

## Vapour Script

The same API from Vapour Script — VS compiles to ESM and receives the same
engine objects as TypeScript, so nothing below is a binding layer.

```py
from "@vapour/engine" import cameraFrustum, cullInstances

export func visible(view_projection, instances):
    var frustum = cameraFrustum(view_projection)
    return cullInstances(instances, frustum)
```
