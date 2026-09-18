# Capability status

The primary release forcing function is the executable
[CubeGame port benchmark](cubegame-port.md). It records working engine paths,
remaining parity gates, and the rule that port features must use tested public
APIs rather than sample-only hooks.

Vapour uses these labels consistently:

- **Working**: implemented, integrated, and tested.
- **Experimental**: usable API that may change and has documented limits.
- **Planned**: not implemented; never represented by a fake editor control.

| Capability                                                                                        | Status       |
| ------------------------------------------------------------------------------------------------- | ------------ |
| Generational entities and transform hierarchy                                                     | Working      |
| Deterministic JSON scene model                                                                    | Working      |
| Browser capability diagnostics                                                                    | Working      |
| Action-based keyboard, pointer, touch, and gamepad input                                          | Working      |
| Rust WebGPU surface, standard PBR shader, and render graph                                        | Working      |
| Batched scene-to-WASM extraction and per-mesh GPU instancing                                      | Working      |
| Seven generated built-in meshes with mesh-aware picking and framing                               | Working      |
| Per-instance metallic, roughness, emission, and alpha cutoff                                      | Working      |
| Stable runtime RGBA8 textures and standard material assets                                        | Working      |
| Per-vertex texture layers and configurable grid-atlas sampling                                    | Working      |
| Opaque/cutout/blended materials, double-sided state, and transparent ordering                     | Working      |
| Ambient, hemisphere, directional, point, and spot light rigs                                      | Working      |
| Atomic multi-camera layers with colour/depth load policy                                          | Working      |
| Perspective and true orthographic WebGPU camera projections                                       | Working      |
| Batched atlas sprites, nine-slicing, sorting layers, and pixel-perfect camera calculations        | Experimental |
| Unicode-aware font-atlas text meshes with kerning, wrapping, alignment, and tint                  | Experimental |
| Browser font measurement, atlas packing, rasterization, and signed-distance-field generation      | Experimental |
| Retained responsive UI layout, hit testing, focus, buttons, toggles, and sliders                  | Experimental |
| Web Audio mixer buses, clips, streaming, spatial voices, listener, and autoplay diagnostics       | Working      |
| Moving-emitter/listener Doppler with authored pitch preservation and bounded playback rates       | Working      |
| Data-driven branching narrative runtime, localization, rollback, saves, and grapheme typewriter   | Experimental |
| Executable engine-only narrative proof with SDF text, UI, choices, audio, rollback, and saves     | Experimental |
| Per-layer clear colour plus linear/exponential distance fog                                       | Working      |
| Scene-view camera navigation, ray-cast selection, and transform gizmos                            | Working      |
| Schema-driven component inspectors and the Add Component menu                                     | Working      |
| Scene-serialized SpriteRenderer, material references, tint, and deterministic sort depth          | Experimental |
| Undo/redo with gesture coalescing across every scene mutation                                     | Working      |
| Shared project templates used by the Hub, the CLI, and `templates/`                               | Working      |
| Hub project creation, disk/browser workspaces, recents, and version pins                          | Experimental |
| CLI validation, static builds, dev hosting, and structured automation output                      | Experimental |
| TypeScript script lifecycle                                                                       | Experimental |
| Vapour Script compiler, diagnostics, mixed TS/VS modules, CLI validation, and production builds   | Experimental |
| Ordered VS/TS runtime modules, contact events, contextual errors, and hot-reload rollback         | Experimental |
| Stable-ID asset database                                                                          | Experimental |
| Game view (authored camera preview; scripts and physics do not run yet)                           | Experimental |
| glTF/GLB geometry, material, node, scene, and external-buffer import                              | Experimental |
| Image decode and compressed texture transcoding pipeline                                          | Planned      |
| Batched TypeScript/WASM runtime bridge                                                            | Working      |
| Runtime-generated meshes, `u32` indices, and per-vertex colour                                    | Working      |
| Binary game-frame submission and fixed-step `GameRuntime`                                         | Working      |
| Renderer-independent `RuntimeLoop` lifecycle and deterministic stepping                           | Working      |
| Weighted, nested, observable, cancellable loading sessions with error propagation                 | Working      |
| Generic slot inventories with policies, metadata stacking, atomic removal, and revisions          | Working      |
| Generic shaped/shapeless crafting with tags, exact consumption, and count planning                | Working      |
| Health/damage lifecycle, ordered mitigation, invulnerability, and simulation-clock status effects | Working      |
| Deterministic state machines, resumable behavior trees, cooldowns, and allocation-free steering   | Working      |
| Vision/hearing perception, target selection, typed blackboards, and AI controllers                | Working      |
| Budgeted deterministic A* over voxel, tile, waypoint, or navmesh-style caller graphs              | Experimental |
| Versioned IndexedDB saves with typed stores, prefix deletion, diagnostics, and memory fallback    | Working      |
| Shared WebGPU/headless `RenderHost` presentation contract                                         | Working      |
| Deterministic seeded random plus coherent 2D/3D fractal noise                                     | Working      |
| Reusable 3D interest planning, async streaming, cancellation, retry, and unload lifecycle         | Working      |
| Reference-counted resource handles, dependency graphs, caching, and bundles                       | Working      |
| Async/additive scene loading, persistent layers, transitions, and world composition               | Working      |
| Prefabs with nesting, per-instance overrides, and deterministic instantiation                     | Working      |
| Typed signals, event bus, deterministic timers, coroutines, and tweens                            | Working      |
| Object pooling, layer masks, tag index, and entity groups                                         | Working      |
| Namespaced browser storage, schema-validated settings, and versioned migrating saves              | Working      |
| CLDR-aware localization with fallback chains, interpolation, and gap reporting                    | Working      |
| Application lifecycle, pause on hide, clipboard, and canvas screenshots                           | Working      |
| Counter registry, timing regions, percentile sampling, and JSON performance reports               | Working      |
| Categorized logging with per-category levels and pluggable sinks                                  | Working      |
| Immediate-mode debug drawing with categories, timed primitives, and a budget                      | Working      |
| Diagnostics overlay model, budget flagging, and text/DOM rendering                                | Working      |
| Incremental render-world extraction with dirty tracking and document observation                  | Working      |
| Frustum and distance culling, instance bounds, and shadow-cascade slice frustums                  | Working      |
| Screen-height level of detail with bias, per-mesh chains, and small-object culling                | Working      |
| Four-cascade directional shadow depth rendering, stable fitting, and filtered PBR sampling        | Experimental |
| RGBA16F scene rendering with exposure and selectable fullscreen tone mapping                      | Experimental |
| HDR bloom, saturation, contrast, vignette, and chromatic-aberration presentation stack            | Experimental |
| Tangent-space normal mapping with glTF tangents, normal scale, and procedural tangent generation  | Working      |
| Per-layer camera-correct HDR procedural skies with configurable gradients and aligned sun discs   | Experimental |
| Rapier compound, convex-hull, triangle-mesh, plane, and heightfield 3D collider runtime           | Working      |
| Generated-geometry kernel: mesh builder, welding, normals, and T-junction repair                  | Working      |
| Parametric primitives, placement operators, and profile extrude/revolve/sweep/loft                | Working      |
| Constructive solid geometry with closed-operand validation and chainable results                  | Working      |
| Architecture generation: walls, openings, stairs, roofs, rooms, and aperture metadata             | Working      |
| Convex hulls, vertex-clustering LOD, triplanar UVs, and derived collision shapes                  | Working      |
| Navigation surfaces and doorway links derived from generated buildings                            | Working      |
| Standard humanoid skeletons with inverse bind matrices and rig validation                         | Working      |
| Procedural characters: proportions, skinning weights, attachments, ragdoll capsules, and crowds   | Working      |
| Seeded vegetation, rocks, grass, heightfield terrain, and slope-aware scattering                  | Working      |
| Executable AI-generated environment showcase with derived collision and navigation                | Working      |
| Heightfield navmesh baking with slope rejection, radius erosion, and overlapping floors           | Working      |
| Versioned deterministic NavMesh assets with validated spans, areas, and off-mesh links            | Working      |
| NavMesh pathfinding, area costs, off-mesh links, and corridor smoothing                           | Working      |
| Navigation agents, deterministic velocity-sampling crowd avoidance, and moving destinations       | Working      |
| Reference-counted runtime NavMesh obstacle carving and path rerouting                             | Working      |
| Shared debug-draw visualization for NavMesh spans, links, obstacles, labels, and routes           | Working      |
| Serializable eased UI animation with reduced-motion behavior                                      | Working      |
| Name-targeted animation clips, pose sampling, blending, and masking                               | Working      |
| Animator layers, crossfades, parameter-driven state machines, and events                          | Working      |
| Parameter-driven 1D and 2D animation blend trees                                                  | Working      |
| Skinning matrices, root motion extraction, two-bone IK, and clamped look-at                       | Working      |
| Runtime pose retargeting with explicit mappings, proportion scaling, and coverage diagnostics     | Working      |
| Input action maps, context stacks, vector composites, and dead-zone rescaling                     | Working      |
| Serializable input rebinding, device detection, and local-multiplayer player slots                | Working      |
| Authoritative server, tick-based replication, ownership, spawning, and RPCs                       | Working      |
| Listen-server host mode using the standard authoritative protocol                                 | Working      |
| Delta compression, quantization, and radius interest management                                   | Working      |
| Client prediction, input reconciliation, and snapshot interpolation                               | Working      |
| Deterministic simulated latency, jitter, packet loss, and reordering                              | Working      |
| Bounded Web Worker task scheduling, readiness, transfer lists, and failure isolation              | Working      |
| Chunked voxel storage, seam-aware meshing, DDA raycasts, and swept AABB collision                 | Experimental |
| Executable CubeGame clean-room port milestone                                                     | Experimental |
| Authorized real CubeGame local-world boot, generation, atlas, and chunk streaming through Vapour  | Experimental |
| Three scene-graph migration bridge                                                                | Experimental |
| Namespaced plugin registry and deterministic schedules                                            | Experimental |
| WebSocket transport, backpressure, RPC, snapshot buffering, and entity authority                  | Experimental |
| WebXR session/reference spaces plus stereo-view, controller, and hand tracking snapshots          | Experimental |
| XR WebGPU presentation, multiview, interactions, locomotion, and hardware verification            | Planned      |
| Rust/WASM 3D rigid bodies, primitive/world colliders, sensors, layers, CCD, events, and raycasts  | Experimental |
| Rust/WASM 2D rigid bodies, native shapes, events, layers, sensors, CCD, and raycasts              | Experimental |
| Serialized 2D/3D physics components, fixed-step synchronization, teardown, and script contacts    | Experimental |
| Exact 2D/3D overlaps, swept-shape queries, and Rust-backed scene character controllers            | Experimental |
| Torque, force-at-point, angular velocity, exact queries, and native character controllers         | Experimental |
| Rust/WASM physics joints: fixed, hinge, slider, ball, spring, limits, and motors                  | Working      |
| Ragdoll joint construction from generated skeletons                                               | Experimental |
| Velocity-driven grabbing, carrying, throwing, and motorised physics doors                         | Working      |
| Layout-derived directional focus navigation with repeat, wrapping, and re-entry                   | Working      |
| HTTP client with timeouts, backoff retries, progress, typed errors, and injected fetch            | Working      |
| Reconnecting WebSocket with exponential backoff and bounded send queueing                         | Working      |
| Standard bus layout, perceptual volume mapping, and equal-power music crossfading                 | Working      |
| Priority and distance voice limiting with per-bus and per-clip caps                               | Working      |
| Blended positional audio zones with reverb, filtering, and gain                                   | Working      |
| Allocation-free particle simulation with shapes, curves, gradients, bounded trails, and collision | Working      |
| Particle system pooling with active limits                                                        | Working      |
| Floating-origin large-world coordinates with snapping and buffer rebasing                         | Working      |
| World partitioning with unload hysteresis and ring-based terrain LOD seam detection               | Working      |
| Flat-array tilemaps with layers, parallax, and view-culled render instances                       | Working      |
| Swept tilemap collision with separated axes, slopes, and one-way platforms                        | Working      |
| Executable physics sandbox showcase: joints, grabbing, throwing, doors, and input actions         | Working      |
| Executable multiplayer arena showcase: prediction, projectiles, health, and respawning            | Working      |
| Scroll views, virtual lists, code-point text fields, tooltips, and drag and drop                  | Working      |
| Inheriting theme registry with design tokens and a high-contrast variant                          | Working      |
| XR cone raycasting, direct and ray grabbing, and two-handed manipulation                          | Working      |
| XR locomotion with snap and smooth turning, comfort fades, and ballistic teleport arcs            | Working      |
| Physics materials, friction/restitution combine rules, mass properties, and centre of mass         | Working      |
| Runtime pose/ragdoll blending with activation and recovery ramps                                  | Experimental |
| Raycast vehicles: wheel suspension, steering, and engine/brake torque                              | Experimental |
| Worker-side physics stepping over SharedArrayBuffer with a same-thread fallback and interpolation | Experimental |
| Physics debug rendering and a body/contact/step-time statistics block                              | Working      |
| Point and spot shadows sharing the directional shadow atlas, with light-priority eviction           | Experimental |
| Skinned mesh rendering: per-vertex bone weights through the WASM bridge to the PBR shader          | Experimental |
| Versioned asset-description language: schema, validation, shape-grammar evaluator, and libraries   | Working      |
| Procedural material graphs baking runtime PBR textures                                             | Working      |
| Vegetation, prop, vehicle, and weapon generators alongside architecture and characters              | Working      |
| 2D sprite, icon, and atlas generators sharing the material graph's texture nodes                    | Working      |
| Chunked terrain with materials, splat maps, LOD mesher integration, and seam stitching               | Working      |
| Terrain sculpt/paint brushes with undo and procedural heightfield generation                        | Working      |
| Seeded vegetation scattering with mesh/impostor LOD switching                                       | Working      |
| Voxel block/skylight propagation with bounded incremental relight                                   | Working      |
| Versioned voxel chunk save format and pure chunk-sync message application                           | Working      |
| Localized NavMesh rebaking matching a full rebake field-for-field                                    | Working      |
| 2D grid navigation, string-pulled corridors, and dynamic obstacle rerouting                          | Working      |
| 2D lights, a general parallax layer, sprite atlases, and a 2D particle adapter                       | Working      |
| Anchor, flex, grid, and responsive-breakpoint UI layout                                             | Working      |
| Full UI widget set: panels, images, dropdowns, and progress bars alongside existing controls         | Working      |
| World-space and XR UI canvases with ray-based hit testing                                            | Working      |
| Font assets, fallback chains, and outlined/shadowed rich text                                        | Working      |
| Cached, batched text layout in world and screen space                                                | Working      |
| XR controllers and hands as first-class input devices, with rebinding                                | Working      |
| XR rig: reference-space height, floor calibration, and seated/standing per-eye cameras               | Working      |
| XR haptics queueing, hysteresis-based hand-pose recognition, and capability detection                | Working      |
| AudioWorklet DSP path with a documented main-thread fallback                                         | Experimental |
| Networked transforms and server-authoritative rigid-body sync with ownership transfer                | Working      |
| Server-side lag compensation with bounded snapshot rewind                                            | Working      |
| Networked scene synchronization with held replication for loading clients                            | Working      |
| Rooms, matchmaking, authentication hooks, reconnection, and host migration                           | Working      |
| Environment cubemaps, prefiltered specular mips, irradiance, and a BRDF LUT for image-based lighting | Experimental |
| Depth-projected decals with atlas regions, tint, fade, and angle falloff                              | Experimental |
| Render-to-texture targets with per-layer viewports, resize policy, and read/write cycle detection     | Experimental |
| Integration: networked characters reconciling root motion against server rigid-body authority        | Working      |
| Integration: XR grabs requesting network ownership with a documented contention policy               | Working      |
| Integration: nav agents driving the physics character motor; AI state driving animator parameters    | Working      |
| Integration: generated assets producing colliders and a baked, linked NavMesh automatically           | Working      |
| Integration: streamed chunks rebaking navigation locally; spatial audio following entity transforms  | Working      |
| Executable open-world showcase: terrain, vegetation, streaming, origin shifts, crowd nav, local rebake | Working      |
| Executable XR playground showcase: rig, hands, haptics, grabbing, locomotion, world-space UI          | Working      |
| Vapour Script binding coverage test driving every Mirage subsystem from real VS source               | Working      |

This table is a release gate, not marketing copy. A feature becomes Working
only after runtime/editor integration, serialization, errors, automated tests,
documentation, and use by a sample project.
