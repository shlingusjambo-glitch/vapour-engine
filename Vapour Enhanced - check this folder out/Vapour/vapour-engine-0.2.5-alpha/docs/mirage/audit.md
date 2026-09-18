# Alpha 0.2.5 "Mirage" — engine audit

Baseline measured at the start of Mirage:

| Area | Size |
| ---- | ---- |
| Rust crates (`vapour-core`, `vapour-render`, `vapour-wasm`) | ~9,100 lines |
| TypeScript packages (`engine`, `editor`, `cli`, `three-bridge`) | ~23,800 lines |
| Examples (incl. authorized CubeGame source) | ~52,800 lines |
| `@vapour/engine` non-test source | ~11,200 lines across 55 flat modules |

The repository is honest about itself: `docs/status.md` is a real release gate,
most systems have adjacent `.test.ts` files, and the Rust boundary is batched
rather than chatty. The problems below are therefore about *coverage and
architecture*, not code quality.

## A. Missing foundational systems

These have no module at all in `packages/engine/src`. Each is a system a
developer currently has to write themselves before shipping any real game.

| Missing | Blocks |
| ------- | ------ |
| **Animation** (clips, skeletons, skinning, state machines, blend trees, IK, root motion) | Every character-driven game. `docs/status.md` lists it Planned. |
| **Particles / VFX** | Explosions, weather, impacts, magic — all archetypes. |
| **Skinned mesh rendering** | The GPU side of animation; `mesh.rs` has no bone weights. |
| **NavMesh generation & baking** | `navigation.ts` is A* over a *caller-supplied* graph. The developer must build the graph. |
| **Crowd / local avoidance** | Any scene with more than a handful of NPCs. |
| **Prefabs & nested prefabs** | Scene reuse; `scene-document.ts` has no instancing concept. |
| **Scene manager** (async/additive load, unload, transitions, persistent objects) | Anything larger than one scene. |
| **Resource manager** (handles, refcounting, unload, dependencies, bundles) | Long sessions leak; no ownership model exists. |
| **HTTP / web request API** | Games talk to raw `fetch`. No retry, cancel, progress, or typing. |
| **High-level multiplayer** | `networking.ts` is a *transport* only (WebSocket + backpressure). No identities, replication, RPC, prediction, or interest management. |
| **Shadows** (any kind, incl. cascades) | Every 3D scene. Renderer has lights but no shadow pass. |
| **Post-processing / HDR / tone mapping / bloom** | Visual credibility of any 3D game. |
| **Decals** | Bullet holes, blood, road markings. |
| **Environment maps / IBL** | PBR without IBL is flat; materials exist but have no ambient specular. |
| **LOD system** | Open worlds. |
| **Occlusion / frustum culling** | `render-world.ts` extracts everything, every frame. |
| **Physics joints, compound & mesh colliders, ragdolls** | Vehicles, doors, grabbing, sandboxes. Listed Planned. |
| **Tweening, timers, coroutines, object pooling, events/signals, curves, gradients, localization, settings, clipboard, screenshots** | Reimplemented by every game. |
| **Vegetation / grass / tree rendering** | Outdoor worlds. |
| **Terrain sculpt/paint/LOD/streaming** | Listed Planned; only heightfield mesh + collider exist. |
| **Profiler & diagnostics HUD** (frame time, draw calls, GPU timings, memory, physics/net/audio stats) | Nobody can tell why a Vapour game is slow. |
| **AI-native asset creation system** | The flagship Mirage feature. Nothing exists; `mesh-library.ts` is 7 hard-coded primitives. |

## B. Architectural problems

1. **`packages/engine/src` is flat.** 55 modules, one barrel `index.ts` with 55
   `export *`. Every consumer imports the whole engine; there is no subsystem
   boundary, no internal/public split, and no way to tree-shake or to reason
   about dependency direction. Mirage roughly triples this file count — the flat
   layout will not survive it.
2. **No package boundaries for large new systems.** Multiplayer, XR, and the
   asset system are each big enough to be their own workspace package with an
   explicit public API, as `pnpm-workspace.yaml` already supports.
3. **No shared math package.** Vec/Quat/Mat/Curve helpers are scattered across
   `rotation.ts`, `projection.ts`, `editor-camera.ts`, and Rust `transform.rs`.
4. **Renderer extraction is not incremental.** `render-world.ts` (263 lines)
   rebuilds instance data per frame with no dirty tracking, no culling, and no
   persistent GPU-side scene. This is the single largest scaling bottleneck.
5. **`surface_renderer.rs` is 2,832 lines** — one file owning pipelines,
   bindings, passes, and presentation. Adding shadows, post-processing, and
   skinning to it will make it unmaintainable. It needs to be split behind the
   existing `graph.rs` abstraction.
6. **`render-host.ts` is 843 lines** and mixes presentation, resource upload,
   and scene translation.
7. **Gameplay-specific modules sit in the core engine.** `combat.ts`,
   `crafting.ts`, `inventory.ts`, `narrative.ts`, `status-effects.ts` are game
   *framework* concerns, not engine core. They inflate the core surface and the
   import graph.
8. **Physics lives in Rust but joints/compound shapes are absent**, so the WASM
   boundary will need a designed extension rather than ad-hoc calls.
9. **No worker-side simulation.** `worker-task-pool.ts` exists but physics,
   navigation baking, voxel meshing, and asset generation all run on the main
   thread. No `SharedArrayBuffer` use.
10. **No integration layer.** Nothing connects navigation to physics, animation
    to networking, or generated assets to collision/nav. Section 23 of the
    Mirage brief is currently unserved by design, not by omission.

## C. Performance bottlenecks (measured by inspection)

- Per-frame full scene extraction and re-upload (`render-world.ts`).
- No frustum culling: draw submission is O(all objects).
- No batching across meshes; instancing is per-mesh only.
- Physics stepping is single-threaded on the main thread.
- No GC discipline: extraction allocates fresh arrays every frame.
- No stress tests anywhere in the repo. There is one Rust bench
  (`benches/render_graph.rs`) and no TS performance suite.

## D. Developer / AI-agent experience gaps

- Documentation is broad (34 files) but has **no machine-readable API index**,
  no per-system "concept → basic → advanced" shape, and no Vapour Script example
  alongside each TypeScript example.
- No capability manifest an agent can read to discover what exists.
- Errors are good in places (`browser-capabilities.ts`) but inconsistent.
- No high-level convenience layer: creating a lit, physical, controllable scene
  requires composing ~8 subsystems by hand.

## E. Archetype capability test (brief §27)

| Archetype | Verdict |
| --------- | ------- |
| **GTA-like** | Blocked on: streaming world (partial), vehicles (no joints), animation, navmesh, LOD, audio zones, traffic/crowd AI. |
| **Fortnite-like** | Blocked on: replication/prediction (transport only), animation, destruction, character controller networking, large-map streaming. |
| **Minecraft-like** | **Closest to viable.** Voxel storage, meshing, DDA raycast, swept AABB, worker pool, and streaming all exist. Missing: voxel lighting, multiplayer chunk sync, save format for worlds, entity scaling. |
| **Roblox-like** | Blocked on: runtime asset loading/creation, sandboxed scripting isolation, avatars (animation + asset system), replication, scalable scene graph. |

The voxel path is the one place Vapour already has a credible end-to-end story.
That is a useful signal: it got there because one real workload forced it.

## F. Browser capabilities not yet exploited

- **WebGPU compute**: unused. Culling, particles, skinning, and voxel meshing
  are all natural compute workloads.
- **SharedArrayBuffer / Atomics**: unused. Required for worker-side physics and
  lock-free render-command buffers.
- **AudioWorklet**: `audio.ts` uses Web Audio graph nodes only.
- **WebCodecs**: unused; relevant to streaming video textures and audio.
- **OffscreenCanvas**: unused; would allow render-thread isolation.
- **WebXR layers / foveation**: `xr.ts` reads sessions but XR presentation is
  listed Planned — there is no stereo WebGPU path yet.
- **Compressed textures (KTX2/Basis)**: listed Planned; large asset libraries
  need it.
