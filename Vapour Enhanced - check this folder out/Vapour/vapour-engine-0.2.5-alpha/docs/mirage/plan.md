# Alpha 0.2.5 "Mirage" — implementation plan

Derived from [`audit.md`](audit.md). Ordered by *what unblocks the most other
work*, not by the order of the brief.

## Sequencing principle

Mirage's own rule — "prefer fewer systems implemented deeply and correctly over
dozens of fake systems" — means the phases below are gates, not a wish list. A
phase is done when it is integrated, serialized, tested, documented with both a
TypeScript and a Vapour Script example, used by an example project, and
reflected in `docs/status.md`.

## Phase 0 — Structural pass (prerequisite for everything else)

Nothing new ships until the engine can hold it.

- Split `packages/engine/src` from flat into subsystem directories with explicit
  per-subsystem `index.ts` public surfaces and an internal/private convention.
- Keep the existing top-level barrel re-exporting every current symbol so no
  existing project breaks (brief §24). Deprecations are annotated, not removed.
- Extract `@vapour/math` (vec2/3/4, quat, mat3/4, curves, gradients, easing,
  random, noise) shared by engine, editor, and the asset system.
- Move gameplay-framework modules (combat, crafting, inventory, narrative,
  status-effects) into `@vapour/gameplay`, re-exported for compatibility.
- Split `surface_renderer.rs` into pass modules behind `graph.rs`.
- Add a machine-readable capability manifest (`docs/mirage/manifest.json`) that
  an AI agent can read to discover subsystems, entry points, and status.

## Phase 1 — Core runtime foundations

These are depended on by every later phase.

1. **Resource manager** — typed asset handles, refcounting, dependency graph,
   async load, preload, unload, bundles. Ownership must be explicit so long
   sessions do not leak.
2. **Scene manager** — async/additive load and unload, transitions, persistent
   objects, scene lifecycle events, scene references.
3. **Prefabs** — including nested prefabs and instance overrides, serialized in
   the existing deterministic JSON scene model.
4. **Framework utilities** — timers, coroutines/tasks, tweening, object pooling,
   typed events/signals, tags/groups, settings, localization, save/serialization
   built on the existing `save-database.ts`, clipboard, screenshots, app
   lifecycle.
5. **Diagnostics core** — frame/CPU/GPU timings, counters registry, logging
   categories, and a debug-draw API that every later subsystem reports into.

## Phase 2 — Rendering

6. Incremental render-world extraction with dirty tracking (removes the largest
   scaling bottleneck), frustum culling, and an LOD system.
7. Shadows: directional cascades, point/spot shadows.
8. HDR pipeline, tone mapping, post-processing stack, bloom, improved fog.
9. Environment maps and image-based lighting.
10. Skinned mesh rendering (bone weights through `mesh.rs` and the WASM bridge).
11. GPU-driven culling and instancing via WebGPU compute.
12. Decals, render textures, viewport improvements.

## Phase 3 — Animation

13. Clips, skeletons, skinning, bones, playback, blending, crossfades, layers,
    masks, state machines, blend trees, parameters, root motion, events.
14. Procedural hooks: IK, look-at, runtime retargeting.

Depends on Phase 2 item 10. Consumed by the asset system and multiplayer.

## Phase 4 — Physics overhaul

15. Joints (fixed, hinge, slider, spring, motor), compound colliders, convex and
    mesh colliders, physics materials, ragdolls.
16. Interaction layer: grabbing, carrying, stacking, throwing, doors, vehicles —
    the things a sandbox actually needs.
17. Worker-side stepping with `SharedArrayBuffer`, interpolation, determinism
    where practical, and physics debug rendering.

## Phase 5 — AI-native asset creation system (brief §2)

The flagship. Designed as its own package, `@vapour/assetgen`.

- A declarative, versioned, JSON-schema'd **asset description language**: shape
  grammars, CSG, profiles/extrusions, parametric surfaces, modular architecture
  descriptions, hierarchical procedural nodes, and material graphs.
- Domain generators layered on that core: architecture (floors/walls/openings/
  stairs/roofs/rooms), characters (proportions, skeletons, faces, clothing),
  vegetation, vehicles, props, terrain, 2D sprites and UI art.
- Compilation to efficient runtime geometry with automatic **LOD, collision, UV,
  and navigation** generation, plus rigging and animation metadata that plugs
  directly into Phase 3.
- Documented, example-driven, and reliably drivable with no editor interaction.

## Phase 6 — Navigation and game AI

18. NavMesh generation and baking (fed automatically by Phase 5 geometry),
    runtime nav data, agents, off-mesh/jump links, areas and costs, path
    smoothing, crowd and local avoidance, localized rebaking, nav debug draw.
19. Gameplay AI primitives layered on the existing `ai.ts`: perception, vision
    and hearing checks, target selection, AI controllers, blackboards.

## Phase 7 — Multiplayer package (`@vapour/net`)

20. Server/client/host modes, connections and lifecycle, network identities,
    ownership and authority, spawning/despawning, scene sync, player spawning.
21. Replication: variable sync, RPCs, snapshots, delta compression, networked
    transforms and physics, interpolation, prediction, reconciliation, lag
    compensation, tick rates.
22. Scale and operations: interest management, bandwidth budgets, matchmaking
    and lobby abstractions, authentication hooks, reconnection, host migration,
    network diagnostics, simulated latency and loss.

Built on the existing `WebSocketTransport`, which stays the lower-level API.

## Phase 8 — Input, UI, text

23. Input actions/action maps, composites, dead zones, rebinding, contexts,
    multiple players, persistent bindings, device detection — unifying keyboard,
    mouse, gamepad, touch, XR controllers and hands.
24. UI framework: flex/grid layout, the full widget set, scroll views, text
    input, focus and controller navigation, drag and drop, themes, animation,
    world-space and XR UI.
25. Text: promote the existing SDF/atlas work to Working — font assets,
    fallback, rich text, full shaping, measurement, batching, caching.

## Phase 9 — Worlds

26. Terrain sculpt/paint, splatting, chunked terrain, LOD, streaming.
27. Vegetation: trees, grass, rocks with instanced/impostor rendering.
28. World partitioning, scene streaming, origin shifting for large worlds.
29. Voxel completion: lighting, world save format, multiplayer chunk sync.

## Phase 10 — XR, audio, particles, 2D, web requests

30. XR: stereo WebGPU presentation (currently Planned), interaction toolkit
    (rays, direct and two-handed grab, physics grab), locomotion, spatial UI,
    haptics, foveation, capability detection, XR debugging.
31. Audio: mixer buses and groups, zones, reverb and filters, doppler,
    crossfading, pooling, AudioWorklet DSP.
32. Particles/VFX: emitters, curves over lifetime, trails, collision, GPU
    particles, pooling.
33. 2D: tilemaps and tilemap collision, 2D lights, 2D particles, parallax,
    pixel-perfect camera, atlases, 2D navigation.
34. `@vapour/http`: verbs, headers, JSON/binary/form, uploads and downloads,
    timeouts, cancellation, progress, retry, typed errors, WebSockets,
    streaming.

## Phase 11 — Proof

35. Stress tests: 10k+ visible objects, thousands of physics bodies, hundreds of
    networked entities, large terrain, many NPCs, large UI trees, many audio
    voices, XR workloads, voxel chunks.
36. Showcase projects (brief §26): physics sandbox, multiplayer arena,
    open-world test, XR playground, and an AI-generated environment produced
    entirely from a structured description.
37. Documentation pass: every system gets concept, setup, basic, typical,
    advanced, API reference, performance, multiplayer and XR notes, plus both a
    TypeScript and a Vapour Script example.
38. `docs/status.md` updated; nothing claims Working without integration,
    serialization, errors, tests, docs, and sample use.

## Reality check

This is a multi-month programme, not a single change. Phases 0 and 1 are the
gate: attempting Phase 5 or 7 before the engine has resource ownership, scene
management, and subsystem boundaries would produce exactly the shallow
placeholder APIs the brief forbids.
