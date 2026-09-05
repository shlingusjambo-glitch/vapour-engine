# Architecture

Vapour is split into replaceable subsystems. The Rust runtime owns compact,
frame-critical state. TypeScript owns the editor, project orchestration,
browser policy, developer scripts, and asset tooling. WGSL owns programmable
GPU work. A small command protocol is the only required JS/WASM boundary.

## Runtime layers

| Layer | Owns | Extension surface |
| --- | --- | --- |
| `vapour-core` | entity identities, hierarchy, transforms, scene data, time | typed component registries and schedules |
| `vapour-render` | WebGPU device policy, typed GPU resources, WGSL validation, render graph, pipelines | render passes, shader assets, material layouts |
| `vapour-wasm` | browser-safe runtime facade, batched commands, canvas renderer exports | versioned command/event protocol |
| `@vapour/engine` | browser capabilities, input actions, presentation loop, script lifecycle | TypeScript components and systems |
| `@vapour/editor` | authoring shell, viewport, hierarchy, inspector, persistence | panels, importers, inspectors, tools |
| `@vapour/cli` | project creation, development headers, validation, builds | build steps and templates |

## Boundary policy

Gameplay does not call tiny Rust methods for every entity each frame. The host
encodes editor and script mutations into a command buffer, applies that buffer
once, advances the runtime, and consumes one event/snapshot batch. SharedArrayBuffer
is an optional transport selected only when cross-origin isolation is active.

## Scheduling policy

- Main thread: DOM, WebXR session, presentation, editor interaction.
- WASM runtime: ECS mutation, hierarchy propagation, deterministic simulation.
- Workers: import, decompression, navigation baking, non-DOM script workloads.
- GPU: rendering, particles, culling and other data-parallel workloads.

Each subsystem documents serialization, dependencies, errors, tests, and its
plugin hooks before being promoted from experimental status.

The renderer's detailed ownership and boundary decisions are documented in
[`../rendering.md`](../rendering.md).
