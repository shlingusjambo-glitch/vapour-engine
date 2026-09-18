# CubeGame port benchmark

Vapour uses [KiwiOnGit/CubeGame](https://github.com/KiwiOnGit/CubeGame) as a
real-world completion benchmark. The audit is pinned to upstream commit
`125b70ef6a48e84678e46ef583986429daa4be93`: 91 source files and roughly 46,000
lines of TypeScript spanning voxel survival, multiplayer, mobs, redstone,
inventory/crafting, and several additional game modes.

The upstream repository has no public software licence at the audited commit.
Its owner explicitly authorized this Vapour port and the in-tree use of the real
source and assets. The provenance-pinned copy lives at
[`examples/cubegame-real`](../examples/cubegame-real/) with its source record in
`UPSTREAM.md`. [`examples/cubegame-port`](../examples/cubegame-port/) remains a
smaller engine-native harness for testing public APIs without the full game's
account and server flow.

## Why this is the release benchmark

A static model or small arcade sample does not stress the systems a substantial
browser game needs. CubeGame does: mutable streamed geometry, large worlds,
first-person collision, pointer lock, fast input, multiple render layers,
generated textures, spatial audio, persistence, WebSocket state, AI, particles,
and a large UI surface. A feature counts here only when the port consumes a
public Vapour API and that API has automated coverage.

## Audited system map

| Upstream responsibility                   | Vapour-native target                                   | Current state                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorldManager`, `Chunk`                   | `VoxelWorld`, stable chunk IDs, dirty seam tracking    | Core storage working; real manager uses Vapour scheduling while full storage replacement remains                                                               |
| `BlockRegistry`                           | `VoxelBlockRegistry<T>`                               | Stable-ID database, conflict policy, fallback, deterministic enumeration, and JSON ownership integrated                                                        |
| chunk worker + `Mesher`                   | `WorkerTaskPool` + `meshVoxelChunk`/greedy atlas mesher | Generic worker scheduling/backpressure/transfer/failure ownership integrated; CubeGame generation algorithm migration remains                                  |
| chunk interest scheduling                 | `planChunkInterest` / `ChunkStreamManager`             | Generic 3D planner integrated into real WorldManager; full lifecycle manager tested                                                                            |
| seeded world generation                   | `VoxelGenerationPipeline` + noise APIs                 | Dimension/chunk/decorator pipeline and compatible engine noise integrated; individual Cube terrain recipes remain game content                                  |
| seeded noise compatibility                | `SinePermutationNoise` / `GradientNoise`               | Cube duplicate removed; version-one terrain samples locked by golden tests so existing seeds and saved diffs stay aligned                                        |
| IndexedDB/save plumbing                   | `SaveDatabase<Store>`                                  | Integrated for worlds, settings, chunk diffs, inventory, chests, and machine data; Cube facade now owns only game namespaces/validation                          |
| Three.js `BufferGeometry`                 | typed-array `uploadMesh` through WASM                  | Working, including `u32` indices and vertex colour                                                                                                             |
| per-frame scene traversal                 | `FrameBuilder` binary submission                       | Working; no per-instance JSON                                                                                                                                  |
| `VoxelPhysics`, `AABB`                    | swept `moveVoxelBody` + reusable character controller  | Swept collision working; slope/stair controller remains                                                                                                        |
| camera controller + pointer lock          | `InputSystem` + `PointerLockController`                | Integrated: keyboard, pointer delta/buttons, gamepad, mobile virtual actions, live rebinding, and lock-loss reset                                               |
| main loop + `Time` singleton              | `RuntimeLoop`                                          | Integrated: Vapour owns animation scheduling, clamped deltas, fixed-step accumulation, catch-up limits, and frame error shutdown                                |
| loading state + progress screens           | `LoadingSession`                                       | Integrated across survival, multiplayer rooms, sandbox, TF2, and COB; weighted stages use actual spawn-section readiness and session-derived gameplay gating    |
| player inventory                           | `InventoryContainer<TStack>`                          | Integrated: stacking, overflow, atomic removal, range queries, batching, snapshots, and revisions are engine-owned; Cube retains item metadata and slot layout |
| shaped/shapeless crafting                  | `CraftingRegistry<TId, TOutput>`                      | Integrated for 2×2 and 3×3 grids: tag-aware matching, exact consumption, availability planning, and atomic copied-grid results are engine-owned                |
| player/mob health, damage, armor, effects   | `Combatant` + `StatusEffectSet`                       | Integrated: player and mob vitality plus modifier pipeline, armor equation, timed effects, ticks, and expiration are engine-owned; Cube retains balance/UI     |
| block selection                           | `raycastVoxels` DDA query                              | Working and tested                                                                                                                                             |
| shader materials, atlas, AO               | WebGPU material assets and atlas addressing            | Generated atlas, stable textures/materials, vertex colour/AO, `aTile` migration, cutout, double-sided, depth policy, blending, and back-to-front ordering work |
| world + first-person view model           | atomic layered camera submission                       | Working through the public layer API; world colour is preserved and depth is cleared before hands/tools                                                        |
| sun, sky fill, torches, view-model lights | per-frame `LightRig`                                   | Ambient, hemisphere, directional, point, and spot translation works independently per layer                                                                    |
| scene background and distance fog         | packed frame environment                               | Dynamic sky/fog colours and linear fog ranges translate through the public frame API                                                                           |
| sun/moon/cloud sprites and cubemaps       | sky/environment render passes                          | Not implemented                                                                                                                                                |
| animated water surface                    | reusable material/shader extension                     | Static alpha material works; deformation/reflection remains                                                                                                    |
| inventory/crafting screens                | Vapour UI layout, focus, and input navigation          | Not implemented                                                                                                                                                |
| audio manager                             | clips, streaming, buses, spatial nodes                 | Browser integration only; engine mixer remains                                                                                                                 |
| storage manager                           | versioned IndexedDB save API                           | Project storage exists; game-save API remains                                                                                                                  |
| entity manager + mobs                     | runtime ECS, behavior trees, pathfinding, steering     | Generic state machines, resumable trees, cooldowns, budgeted A*, and steering work; Cube mob recipes, bindings, animation, and migration remain                                                                              |
| particles                                 | WebGPU compute particles                               | Not implemented                                                                                                                                                |
| `NetworkManager`, binary protocol         | transport, snapshots, RPC, authority, game codec       | Generic WebSocket lifecycle/backpressure, ordered snapshot buffers, RPC, and ownership rules work; Cube binary codec migration, reconnection, prediction, and WebTransport remain                                            |
| server rooms/auth/world relay             | optional TypeScript server package                     | Not implemented                                                                                                                                                |
| redstone/liquids                          | fixed-step simulation jobs                             | Infrastructure exists; domain systems remain port work                                                                                                         |
| additional game modes                     | plugins/modules over shared gameplay services          | Plugin registry exists; runtime extension surface remains                                                                                                      |

## Executable milestone 1

The port currently builds and runs through the normal project and CLI path. It
generates a 7×7 chunk field, meshes every loaded chunk, uploads geometry through
the Rust/WASM renderer, submits one packed frame, and provides first-person
movement, gravity, collision, jumping, block raycasting, breaking, and placing.

```sh
pnpm vapour validate examples/cubegame-port --json
pnpm vapour build examples/cubegame-port --json
pnpm vapour dev examples/cubegame-port --port 4174
```

The browser must expose WebGPU and a real graphics adapter. Vapour deliberately
does not hide an unavailable adapter behind a WebGL renderer.

## Real-source milestone

The original application builds inside the pnpm workspace and its primary
renderer uses `@vapour/three-bridge`, not `THREE.WebGLRenderer`. Automated
headless tests initialize the original storage, UI, scene, input, and game
loop, complete local account/signup and world-selection flows, create a real
world, run worker generation, and stream hundreds of original chunk meshes. A
normal production build uses the real Rust/WASM WebGPU renderer.
The generated CanvasTexture atlas is uploaded as a Vapour texture, chunk
`aTile` attributes become the engine's reusable per-vertex texture layers, and
materials declare a generic 16×96 atlas layout. The real
`WorldManager` now consumes Vapour's public 3D chunk-interest planner while
retaining the original generation output and save-diff format. The original
world and first-person arm/tool scene render as two atomic Vapour layers, and
the bridge carries each scene's supported light rig instead of discarding all
but one directional light.

```sh
pnpm --filter cubegame build
pnpm --filter cubegame preview --host 127.0.0.1 --port 5174
# Open http://127.0.0.1:5174/ to run the built dist/index.html artifact.
```

`examples/cubegame-real/dist/` is the deployable product. Its `index.html`,
hashed JavaScript chunks, `vapour_runtime.js`, and
`vapour_runtime_bg.wasm` can be copied to ordinary static hosting. Browsers
that restrict ES modules or WASM under `file://` should receive the directory
through a local/static server; no development transform is required after the
build.

This does not yet claim visual or gameplay parity: water deformation/reflection,
sun/moon/cloud rendering, particles, skinning, networking/server authority,
and the remaining modes are still explicit gates. Browser QA requires a real
WebGPU adapter. `?vapour-headless=1` is reserved for extraction and simulation
tests and deliberately presents no pixels; it is not the normal launch path.

## Acceptance ladder

1. **Core survival loop:** radius-based worker chunk streaming, texture atlas,
   player controller, break/place, inventory, save/load, audio, sky and fog.
2. **World parity:** biomes, structures, transparent/cutout blocks, fluids,
   lighting/AO, item drops, particles, crafting workstations and redstone.
3. **Living world:** runtime ECS bindings, mobs, navigation, animation,
   combat, status effects and spawn management.
4. **Multiplayer:** upstream binary messages over a real WebSocket transport,
   rooms, ownership, interpolation, prediction, server authority and voice.
5. **Mode parity:** port game modes as plugins using the same runtime services,
   with no mode-specific behaviour hidden in the engine.

Each rung requires a production build, engine tests for newly introduced APIs,
an in-browser smoke test, and benchmark budgets for generation, meshing, upload,
simulation and frame submission. Interfaces or editor buttons alone do not
satisfy a rung.
