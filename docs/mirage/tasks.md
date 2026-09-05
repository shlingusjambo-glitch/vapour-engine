# Mirage task list

Numbered, checkable tasks derived from [`plan.md`](plan.md). A task is done only
when it is implemented, integrated, tested, and documented.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

## Phase 0 — Structure

- [x] **M1** Subsystem directory layout for `packages/engine/src` with per-subsystem `index.ts`
- [x] **M2** Compatibility barrel: every existing export still reachable from `@vapour/engine`
- [x] **M3** `@vapour/math` package: vec2/3/4, quat, mat3/4, easing, curves, gradients
- [x] **M4** Move gameplay modules (combat, crafting, inventory, narrative, status-effects) to `@vapour/gameplay`
- [x] **M5** Split `crates/vapour-render/src/surface_renderer.rs` into pass modules behind `graph.rs`
- [x] **M6** Machine-readable capability manifest `docs/mirage/manifest.json`
- [x] **M7** Split `packages/engine/src/render-host.ts` (presentation / upload / translation)

## Phase 1 — Core runtime

- [x] **M8** Resource manager: typed handles, refcounting, dependency graph
- [x] **M9** Async loading, preloading, streaming, unload, asset bundles
- [x] **M10** Scene manager: async/additive load, unload, transitions, persistent objects
- [x] **M11** Scene lifecycle events and scene references
- [x] **M12** Prefabs and nested prefabs with instance overrides
- [x] **M13** Timers, coroutines/tasks, tweening
- [x] **M14** Object pooling, tags, layers, groups
- [x] **M15** Typed events/signals/messaging bus
- [x] **M16** Settings, localization, save/serialization façade
- [x] **M17** Clipboard, screenshots, application lifecycle, persistent storage
- [x] **M18** Diagnostics core: counters, frame/CPU/GPU timings, logging categories
- [x] **M19** Debug draw API consumed by all later subsystems
- [x] **M20** Diagnostics HUD/overlay (FPS, draw calls, triangles, memory, subsystem stats)

## Phase 2 — Rendering

- [x] **M21** Incremental render-world extraction with dirty tracking
- [x] **M22** Frustum culling
- [x] **M23** LOD system
- [x] **M24** Directional cascaded shadow maps
- [ ] **M25** Point and spot shadows
- [x] **M26** RGBA16F scene pipeline, exposure, and selectable ACES/Reinhard/none tone mapping
- [x] **M27** HDR post-processing stack with threshold bloom, saturation, contrast, vignette, and chromatic aberration
- [ ] **M28** Environment maps and image-based lighting
- [x] **M29** Camera-correct HDR procedural sky rendering with directional-light sun discs
- [x] **M30** Tangent-space normal mapping with authored/imported tangents and generated fallback frames
- [ ] **M31** Skinned mesh rendering (bone weights through mesh + WASM bridge)
- [ ] **M32** GPU-driven culling/instancing via WebGPU compute
- [ ] **M33** Decals
- [ ] **M34** Render textures and viewport improvements
- [x] **M35** Renderer stress test: 10,000+ visible objects

## Phase 3 — Animation

- [x] **M36** Clips, skeletons, bones, skinning data model
- [x] **M37** Playback, blending, crossfades, layers, masks
- [x] **M38** Animation state machines, parameters, and 1D/2D blend trees
- [x] **M39** Root motion and animation events
- [x] **M40** Two-bone IK, look-at, and runtime skeleton retargeting

## Phase 4 — Physics

- [x] **M41** Joints: fixed, hinge, slider, ball, spring, motors
- [x] **M42** Compound colliders, convex hulls, triangle meshes, and heightfields
- [ ] **M43** Physics materials, friction, restitution, center of mass
- [~] **M44** Ragdoll joint construction from skeletons done; runtime blend from animation outstanding
- [~] **M45** Grab, carry, throw, and motorised doors done; vehicles outstanding
- [ ] **M46** Worker-side stepping with SharedArrayBuffer + interpolation
- [ ] **M47** Physics debug rendering and statistics
- [ ] **M48** Physics stress test: thousands of dynamic bodies

## Phase 5 — AI-native asset creation (`@vapour/assetgen`)

- [ ] **M49** Core asset description language: schema, versioning, validation, errors
- [x] **M50** Geometry kernel: CSG, profiles/extrusion, parametric surfaces, subdivision
- [ ] **M51** Hierarchical procedural graph / shape grammar evaluator
- [ ] **M52** Material graph and material generation
- [x] **M53** Compiler to runtime geometry: buffers, LOD, UV, collision, nav geometry
- [x] **M54** Architecture generator: floors, walls, openings, stairs, roofs, rooms
- [x] **M55** Character generator: proportions, skeleton, skinning, rig metadata, ragdoll capsules, crowds
- [ ] **M56** Vegetation, terrain, prop, vehicle, weapon generators
- [ ] **M57** 2D generators: sprites, characters, UI artwork
- [ ] **M58** Reusable asset components and library format
- [ ] **M59** Agent-facing documentation and worked examples

## Phase 6 — Navigation and game AI

- [x] **M60** NavMesh generation from scene/asset geometry
- [x] **M61** NavMesh baking, versioned serialization, validation, and runtime loading
- [x] **M62** Navigation agents, agent sizes, areas, and area costs
- [x] **M63** Off-mesh links, jump links, doors, and dynamic obstacle carving
- [x] **M64** Path smoothing, crowd and local avoidance, moving destinations
- [ ] **M65** Localized rebaking for streaming worlds
- [x] **M66** Navigation debug visualization for spans, blocked cells, adjacency, off-mesh links, labels, and paths
- [x] **M67** Perception (vision, hearing), target selection, typed blackboards, and cadence-controlled AI controllers

## Phase 7 — Multiplayer (`@vapour/net`)

- [x] **M68** Server, client, and host modes with connection lifecycle
- [x] **M69** Network identities, ownership, authority
- [x] **M70** Network spawning/despawning and player spawning
- [x] **M71** Variable synchronization and state replication
- [x] **M72** RPCs (server and client)
- [x] **M73** Snapshots, delta compression, tick rates
- [ ] **M74** Networked transforms and networked physics
- [~] **M75** Interpolation, prediction, and reconciliation done; lag compensation outstanding
- [x] **M76** Interest management, relevancy, bandwidth management
- [ ] **M77** Scene synchronization and networked scene loading
- [ ] **M78** Matchmaking, rooms/lobbies, authentication hooks, reconnection, host migration
- [x] **M79** Network diagnostics plus simulated latency, jitter, loss, and reordering
- [~] **M80** Six-client arena under adverse conditions done; hundreds-of-entities stress test outstanding

## Phase 8 — Input, UI, text

- [x] **M81** Input actions, action maps, composites, axes, buttons
- [x] **M82** Dead zones, sensitivity, device detection, multiple players
- [x] **M83** Rebinding, runtime remapping, persistent bindings, input contexts
- [ ] **M84** XR controller and hand devices in the input system
- [ ] **M85** UI layout: anchors, flex, horizontal/vertical, grids, responsive
- [ ] **M86** UI widgets: panels, images, buttons, sliders, checkboxes, dropdowns, progress bars
- [x] **M87** Scroll views, virtual lists, text input, tooltips, and drag and drop
- [x] **M88** Focus and controller navigation, UI driven by input actions
- [ ] **M89** World-space UI and XR UI
- [x] **M90** Inheriting theme registry, design tokens, and renderer-independent UI animation
- [ ] **M91** Text: font assets, fallback, rich text, outlines, shadows
- [ ] **M92** Text measurement, batching, caching, world/screen space
- [ ] **M93** UI stress test: large UI trees

## Phase 9 — Worlds

- [ ] **M94** Terrain chunks, materials, texture splatting
- [ ] **M95** Terrain sculpt/paint tooling and procedural terrain
- [~] **M96** Ring-based terrain LOD selection and seam detection done; mesher integration outstanding
- [ ] **M97** Vegetation: trees, grass, rocks with instancing/impostors
- [x] **M98** World partitioning with hysteresis and nearest-first loading
- [x] **M99** Floating origin with snapping, buffer rebasing, and precision reporting
- [ ] **M100** Voxel lighting
- [ ] **M101** Voxel world save format and multiplayer chunk synchronization
- [ ] **M102** Large-world stress test: terrain, vegetation, streaming

## Phase 10 — XR, audio, particles, 2D, web

- [ ] **M103** XR stereo WebGPU presentation and multiview
- [ ] **M104** XR cameras, player height, floor calibration, seated/standing
- [x] **M105** XR interaction: cone rays, direct and ray grab, two-handed manipulation
- [x] **M106** XR locomotion: teleport arcs, smooth and snap turning, comfort fades
- [ ] **M107** XR haptics, hand poses, foveation, capability detection, debugging
- [x] **M108** Audio mixer buses, groups, master/music/sfx/voice volumes
- [x] **M109** Audio zones, filters/reverb settings, crossfading, voice limiting, and Doppler
- [ ] **M110** AudioWorklet DSP path
- [x] **M111** Particles: emitters, burst/continuous, lifetime, velocity, gravity, shapes, drag
- [x] **M112** Size/colour over lifetime, texture-sheet ages, bounded trails, and query-driven collision
- [~] **M113** Particle pooling done; GPU particles outstanding
- [x] **M114** Tilemaps, layers, parallax, and swept tilemap collision with slopes and one-way platforms
- [ ] **M115** 2D: lights, particles, parallax, pixel-perfect camera, atlases
- [ ] **M116** 2D navigation
- [x] **M117** HTTP verbs, headers, JSON/binary/form, uploads/downloads
- [x] **M118** Timeouts, cancellation, progress, retry with backoff, typed errors
- [x] **M119** Reconnecting WebSockets with bounded send queueing

## Phase 11 — Integration, proof, release

- [ ] **M120** Integration: networked physics and networked animated characters
- [ ] **M121** Integration: XR grabbing networked objects
- [ ] **M122** Integration: nav agents using physics; AI characters using animation
- [ ] **M123** Integration: generated assets producing collision + navigation automatically
- [ ] **M124** Integration: streaming worlds updating navigation; audio attached to entities
- [x] **M125** Showcase: physics sandbox
- [x] **M126** Showcase: multiplayer arena
- [ ] **M127** Showcase: open-world test
- [ ] **M128** Showcase: XR playground
- [x] **M129** Showcase: AI-generated environment
- [ ] **M130** Vapour Script bindings for every new subsystem
- [ ] **M131** Per-system documentation (concept, basic, typical, advanced, API, perf, TS + VS examples)
- [ ] **M132** Backward-compatibility review, migration guide, deprecation notes
- [ ] **M133** `docs/status.md` and README updated for Alpha 0.2.5
