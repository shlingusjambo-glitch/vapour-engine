# Real CubeGame port status

This is the authoritative status for booting the actual CubeGame source on
Vapour Engine. “Working” means the original subsystem executes against Vapour
in a browser build; compiling an interface alone does not count.

| Boundary | Status |
| --- | --- |
| Source and assets pinned in-tree | Working |
| Original TypeScript baseline build | Working: 115-module production build |
| Reusable Three scene graph → Vapour frame bridge | Working and tested |
| Real WorldManager uses Vapour's reusable 3D interest planner | Working in build |
| Vapour WebGPU renderer owns presentation | Working in build; real-adapter visual test pending |
| Original boot reaches account UI on explicit headless host | Working |
| Original chunk worker generates and meshes real chunks | Pending |
| Original world/player/inventory/UI boot sequence | Pending |
| Storage, audio, entities, particles, redstone and liquids | Pending |
| Real WebSocket multiplayer and server | Pending |
| TF2, COB, CBGO, CrownForge and other modes | Pending |
| Web, desktop and mobile production packages | Pending |

## Migration rule

Three.js may temporarily remain as a math and scene-description dependency so
the actual game can boot incrementally. It must not create a WebGL context or
present frames. The primary renderer, GPU resources, materials, frame
submission and post-processing must be Vapour’s Rust/WASM WebGPU runtime.
