# Paper Hearts narrative proof

`examples/narrative-real` is Vapour's executable 2D narrative forcing function.
It is an ordinary browser game, not editor-only UI and not a DOM dialogue demo.
Its production build uses the Rust/WebAssembly WebGPU renderer for every visible
background, portrait, panel, choice, and glyph.

The sample exercises these public engine APIs together:

- `GameRuntime`, `FrameBuilder`, and a true orthographic WebGPU camera;
- browser font import, atlas packing, SDF generation, and SDF standard material;
- `UiDocument` layout/focus/hit testing and `composeUi2D` mesh batching;
- `NarrativeRunner` lines, choices, variables, branches, multiple endings,
  rollback, and snapshot restoration;
- action-based keyboard and pointer input, including absolute UI coordinates;
- `AudioEngine` buses, direct-gesture autoplay recovery, decoded UI audio;
- `SaveDatabase` IndexedDB quick-save/load with memory fallback; and
- runtime-generated RGBA8 assets and stable material/mesh IDs.

Build it after the engine WASM package exists:

```sh
pnpm build:wasm
pnpm --filter @vapour/narrative-real build
pnpm --filter @vapour/narrative-real preview --host 127.0.0.1 --port 5175
```

The deployable directory is `examples/narrative-real/dist`. It contains the
hashed game JavaScript/CSS, source map, `index.html`, replaceable
`vapour_runtime.js`, and `vapour_runtime_bg.wasm`; no backend is required.

## Verification boundary

TypeScript compilation and the production/static artifact are automated. The
shared engine tests cover each state and geometry subsystem plus UI depth
ordering. Live WebGPU verification requires a browser session with a usable GPU
adapter. Vapour deliberately reports an adapter-selection failure when run in a
sandbox that exposes `navigator.gpu` but no hardware adapter; it does not fall
back to WebGL or silently display a blank canvas.

This sample proves a coherent visual-novel pipeline, but it is not yet the final
DDLC-class release gate. Remaining work includes scene-serialized sprite/UI/audio
components, richer animation/transitions, editor authoring/import panels,
accessibility metadata, comprehensive localization, and a longer polished game.
