# Building games with a coding agent

Give the whole SDK directory to the agent. The engine is intentionally not an
AI product and requires no model account; it provides a deterministic tool and
file contract that Codex, Claude Code, and other shell-capable agents can use.

## First commands

```sh
./vapour create ./Game --name "Game" --template empty-3d --json
./vapour inspect ./Game --json
./vapour schema --json
```

Use `empty-2d`, `empty-3d`, or `webxr`. Add `--language vs` for a VS-first
project. TypeScript and VS may coexist. TypeScript is best for typed systems,
larger modules, and integration work; VS is best for concise gameplay behavior,
rapid iteration, and Python/GDScript-style code.

## Machine-readable manifest

[`docs/mirage/manifest.json`](mirage/manifest.json) describes the engine in a
form an agent can parse before writing any code: the workspace packages and
their entry points, every engine subsystem and the modules inside it, the
capability matrix with each entry's `working`/`experimental`/`planned` status,
the documentation index, and the engine-wide conventions (coordinate system,
matrix layout, rotation format, colour space, error policy).

It is generated from the repository, not hand-maintained, so it cannot drift:

```sh
pnpm manifest          # regenerate
node scripts/generate-manifest.mjs --check   # fail if stale
```

Read the manifest first, then the documentation for the subsystems it names.

## Engine-first rule

Before writing a subsystem, search `sdk/engine/index.d.ts` and the relevant
documentation. Use engine facilities for runtime lifecycle, rendering, input,
physics, UI, audio, saving, networking, AI, terrain, voxel worlds, loading, and
streaming. If `status.md` says a requirement is missing, report the gap instead
of disguising a game-side workaround as an engine feature.

## Completion loop

```sh
./vapour validate ./Game --json
./vapour build ./Game --out ./Game-release --json
./vapour dev ./Game --port 4173 --json
```

Validation performs scene, project, VS, and semantic TypeScript checks. Build
produces an ordinary static-hosting directory with hashed JavaScript, source
maps, the separate WASM engine, a service worker, hosting-header guidance, and
license notices. Always hand off the build directory as well as project source.

The `examples/alpha-0.2-acceptance` project is the compact reference for native
terrain/physics, glTF, audio, input, TS+VS, and world+overlay rendering. The
CubeGame and narrative examples cover larger voxel and visual-novel workloads.
