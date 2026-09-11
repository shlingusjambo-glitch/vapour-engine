# Coastal development audit — 5 September 2026

Baseline: `7dc8078` (the repository has one historical commit). Private Git
access verified; no open issues returned by the authenticated issue query.
598 tracked files reviewed by subsystem, alongside README, build/CI scripts,
current status, Mirage backlog, source and adjacent tests. Older Mirage audit
predates many implemented systems; it is not the current capability inventory.

## Existing architecture

| Area | Actual foundation and remaining integration gaps |
| --- | --- |
| Toolchain | Rust 1.98 / wasm-bindgen 0.2.127; Node 22+, pnpm 11, TypeScript/Vite |
| Runtime/entity/scene | Rust generational sparse-set ECS, hierarchy and batched WASM commands; JSON scenes, TS prefabs/additive scene manager, fixed-step GameRuntime |
| Renderer | Rust wgpu 30 / WebGPU only; forward GGX PBR, normal maps, instancing, RGBA16F HDR, ACES, bloom, fog, procedural sky, four cascades |
| Rendering gaps | Shadow uniform ABI mismatch; single-level texture uploads; no GPU skinning, real IBL, AA, SSAO, SSR or local-light shadows; culling/LOD helpers need runtime composition |
| Assets | Static glTF/GLB geometry + hierarchy + material metadata; images, skin and animation import absent; no Blender export pipeline |
| Animation | CPU pose clips, layers, blend trees, state machines, retargeting, IK, inverse-bind math; not connected to GPU skinning |
| Physics | Rust Rapier 2D/3D, collision masks, CCD, ray/shape queries, character solver, joints; kinematic scene reconciliation recreates bodies; no vehicle controller |
| World | Async load/cancel/retry/unload scheduler, partition hysteresis, floating origin, resource cache; needs a non-voxel playable forcing example |
| AI | A*, navmesh, crowd avoidance, perception, state machines; no integrated pedestrian/traffic district |
| Audio | Web Audio clips/streams, spatial voices, Doppler, buses/zones; no licensed sound library for this game |
| Gameplay/tools | TS/VS scripting, input, combat, inventory, saves, diagnostics; editor hierarchy/inspector/undo; no complete character/vehicle game loop |
| Network | Separate TS authoritative replication, transport/RPC, prediction/interpolation; no networking planned for this local slice |

## Dependency-ordered implementation

1. Repair clean-checkout setup, compile and launch the engine; fix shader ABI
   and kinematic body lifetime defects with regression tests.
2. Complete static Blender → GLB → textured Vapour runtime: image decode,
   material binding, validated hierarchy, owned resource lifetime; add mips
   and anisotropic filtering without changing voxel atlas defaults.
3. Add reusable swept character/driving controllers, safe vehicle exit and
   tests; integrate in a playable coastal scene using the existing runtime.
4. Build original bevelled architecture, curved vehicle, vegetation/street
   furniture kit in Blender, with UVs, material regions, LOD and colliders.
5. Compose a dense small district with asynchronous world-cell activation,
   distance LOD/culling, day/dusk/night, traffic, interactions and diagnostics.
6. Visually evaluate and profile on real WebGPU; fix regressions and record
   measured results. Advance animated characters and licensed audio as usable
   assets become available. Keep unfulfilled art/system gates explicit.

This is an engineering and art development slice. AAA presentation is the target,
not a claim based on API count or automated tests. No Rockstar assets or code
are used; reference research is limited to public official material.

## Baseline validation findings

- Rust workspace tests pass before feature work.
- `pnpm install --frozen-lockfile` originally fails: unresolved string under
  `allowBuilds.esbuild`. Replaced with the explicit expected boolean.
- Clean `pnpm check` and example tests fail because referenced library output
  declarations do not exist. A topological TypeScript reference build is now
  required before both entry points.
- Full browser bundles require newly compiled engine WASM, as documented.
