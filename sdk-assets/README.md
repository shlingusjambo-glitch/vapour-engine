# Vapour Engine SDK 0.2.0 Alpha

This is the first self-contained Vapour Engine SDK build intended for humans
and shell-capable coding agents. It contains the CLI, WebGPU editor, Rust/WASM
runtime, TypeScript/VS SDK, templates, examples, and documentation.

This build targets 64-bit Linux and includes its own Node.js runtime. Installing
Node, pnpm, Rust, or npm packages is not required to create and build games with
the packaged CLI. Rust is required only when rebuilding the engine itself.

## Give this directory to an AI

Tell the agent:

> Read `AGENTS.md`, `docs/automation.md`, and `docs/agent-game-building.md`. Create a Vapour project with the
> local `./vapour` CLI, implement the game using engine APIs, validate it, then
> produce a deployable static build.

The agent does not need a Vapour-specific plugin or account.

## Commands

```sh
./vapour create ./MyGame --name "My Game" --template empty-3d --json
./vapour create ./MyVsGame --name "My VS Game" --template empty-2d --language vs --json
./vapour validate ./MyGame --json
./vapour build ./MyGame --out ./MyGame-release --json
./vapour dev ./MyGame --port 4173 --json
./vapour-editor 5174
```

The game output is ordinary static-hosting content. Do not open `index.html`
with a `file:` URL: WebAssembly, modules, WebGPU, and SharedArrayBuffer require
HTTP response semantics. Use `./vapour dev` locally or upload the build folder.

## Layout

- `vapour`: portable CLI launcher.
- `vapour-editor`: local editor launcher with required isolation headers.
- `cli/`: bundled coding-agent-friendly CLI and native esbuild executable.
- `editor/`: production editor/Hub web build.
- `runtime/`: optimized Rust/WASM runtime and browser bindings.
- `sdk/engine/`: compiled TypeScript SDK declarations and JavaScript.
- `sdk/engine-src/`: browser-bundling source consumed by the CLI.
- `templates/`: 2D, 3D, and WebXR project templates.
- `examples/`: engine-native projects.
- `docs/`: architecture, APIs, workflows, deployment, and capability status.
- `SHA256SUMS`: integrity manifest.

Vapour 0.2 remains an alpha release. Read `docs/status.md`; unsupported systems are not
represented as finished.
