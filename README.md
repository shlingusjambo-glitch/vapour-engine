# Vapour Engine

Vapour is a WebGPU-first game engine for shipping 2D, 3D, and WebXR games to
modern browsers. Its runtime is written in Rust and compiled to WebAssembly;
its editor, gameplay scripting SDK, and tooling use TypeScript.

> **Development status:** pre-alpha. The repository is being built as a real
> engine, but it is not yet a production release. The capability matrix in
> [`docs/status.md`](docs/status.md) distinguishes working systems from planned
> ones.

## Principles

- WebGPU is the renderer, not an optional upgrade from WebGL.
- TypeScript is the default gameplay language.
- Engine state crosses the JavaScript/WASM boundary in batches.
- Scenes and project settings are deterministic, reviewable JSON.
- Stable UUID asset references survive moves and renames.
- Unsupported browser capabilities fail with actionable diagnostics.

The renderer is a Rust-owned WebGPU surface with a validated standard PBR WGSL
shader, typed generational GPU resources, and a dependency-checked render graph.
It draws authored scenes — cameras, lights, and instanced meshes — extracted
from the scene document in a single batched call across the WASM boundary. See
[`docs/rendering.md`](docs/rendering.md) for its exact scope and limitations.

The editor is a Unity-style authoring workspace: hierarchy, viewport navigation,
ray-cast selection, translate/rotate/scale gizmos, schema-driven component
inspectors, and undo across every mutation. See [`docs/editor.md`](docs/editor.md).

The engine is being forced against a real 46,000-line voxel-survival workload.
The authorized, provenance-pinned source is integrated at
[`examples/cubegame-real`](examples/cubegame-real/), builds as part of the
workspace, and boots through Vapour's render boundary into the original account
and local-world flow. Its original worker generation now streams hundreds of
dynamic chunk meshes through Vapour's stable texture/material and grid-atlas
APIs. The smaller [`examples/cubegame-port`](examples/cubegame-port/) project is
an engine-native executable harness for public runtime chunk-mesh, binary-frame,
input, collision, raycast, and block-edit APIs. The [port benchmark](docs/cubegame-port.md)
is the release acceptance ladder, not a decorative sample.

## Quick start

Prerequisites: Node.js 22+, pnpm 11+, Rust 1.89+, and a current WebGPU browser.

```sh
pnpm install
pnpm check
pnpm dev
```

Build the browser WASM package after installing the matching `wasm-bindgen`
CLI (`cargo install wasm-bindgen-cli --version 0.2.127`):

```sh
pnpm build:wasm
```

Rust checks:

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

## Licence

Vapour Engine is licensed under the **GNU LGPL v3.0 or later**
([`COPYING.LESSER`](COPYING.LESSER)).

**Games you build with Vapour are yours.** Using the engine places no licence
requirement on your game — it can be proprietary, commercial, and closed source.
Only changes to the engine's own source have to be shared, and only if you
distribute them. [`LICENSING.md`](LICENSING.md) explains where the line falls
and why shipping the runtime as a separate WebAssembly module keeps compliance
automatic.

## Documentation

See [`docs/architecture/overview.md`](docs/architecture/overview.md) for the
system boundaries, [`docs/development.md`](docs/development.md) for setup, and
[`docs/automation.md`](docs/automation.md) for CLI and coding-agent workflows.
The browser project lifecycle is documented in [`docs/hub.md`](docs/hub.md),
and day-to-day editor use in [`docs/editor.md`](docs/editor.md).
CubeGame port progress and the audited remaining engine gaps are tracked in
[`docs/cubegame-port.md`](docs/cubegame-port.md).
Procedural generation and reusable large-world scheduling are documented in
[`docs/world-streaming.md`](docs/world-streaming.md), and the incremental Three
migration boundary in [`docs/three-migration.md`](docs/three-migration.md).
Action maps, rebinding, virtual controls, and pointer lock are covered in
[`docs/input.md`](docs/input.md), and renderer-independent game lifecycle in
[`docs/runtime-loop.md`](docs/runtime-loop.md). Versioned browser saves and
fallback behavior are documented in [`docs/persistence.md`](docs/persistence.md).
The current 2D sprite/orthographic pipeline is documented in
[`docs/2d-rendering.md`](docs/2d-rendering.md), and branching dialogue plus
visual-novel state in [`docs/narrative.md`](docs/narrative.md).
Game UI layout and interaction are covered in [`docs/ui.md`](docs/ui.md), and
decoded, streamed, and spatial audio in [`docs/audio.md`](docs/audio.md).
The engine-only visual-novel forcing function is documented in
[`docs/narrative-sample.md`](docs/narrative-sample.md).
Reusable state machines, behavior trees, pathfinding, and steering are covered
in [`docs/ai-navigation.md`](docs/ai-navigation.md).
The VS language, mixed TypeScript interoperability, compiler diagnostics, and
CLI workflow are documented in [`docs/vapour-script.md`](docs/vapour-script.md).
Transport lifecycle, RPC, snapshot interpolation, and authority are documented
in [`docs/networking.md`](docs/networking.md).
WebXR session lifecycle, stereo tracking, controllers, hands, and remaining
presentation gates are documented in [`docs/xr.md`](docs/xr.md).
Rust/WASM rigid bodies, colliders, events, queries, and remaining 2D/3D gates
are documented in [`docs/physics.md`](docs/physics.md).
