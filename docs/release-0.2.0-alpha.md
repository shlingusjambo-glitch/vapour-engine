# Vapour Engine 0.2.0 Alpha

This release is the first standalone SDK deliberately tested as something that
can be handed to a human or coding agent without the source repository's Node,
pnpm, Rust, or package installation.

## Release artifact

The Linux x64 SDK contains bundled launchers, Node, esbuild, the optimized
Rust/WebAssembly runtime, editor/Hub, TypeScript declarations and source,
Vapour Script compiler, templates, examples, documentation, licenses, and a
SHA-256 manifest. A portability test creates, validates, and builds a fresh VS
project under `/tmp` using only files inside the SDK.

## 0.2 engine additions

- native torque, force-at-point, torque impulses, and angular velocity;
- plane, convex-mesh, triangle-mesh, and heightfield 3D colliders;
- one-source render/physics `TerrainHeightfield` with generation and sampling;
- glTF 2.0 and GLB geometry/material/node/scene importing;
- `GameContext.overlay` for atomic world plus screen-space UI rendering;
- child-measured content UI layout and corrected top-left font atlas UVs;
- mouse-wheel action bindings and live audio voice pitch;
- TypeScript semantic validation in both `validate` and `build`;
- packaged WebGPU declarations so standalone validation retains engine types;
- an executable Alpha 0.2 acceptance project using TS and VS together.

## Known limits

This is an alpha, not a claim of Unity/Godot parity. Consult `status.md` before
planning a game. Major outstanding systems include joints and compound
colliders, full animation graphs, complete navmesh baking, texture transcoding,
terrain authoring/LOD/vegetation, XR presentation and interactions, and a fully
integrated editor play mode.

