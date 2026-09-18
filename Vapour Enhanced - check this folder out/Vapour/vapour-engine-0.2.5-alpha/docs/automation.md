# CLI and coding-agent automation

Vapour does not embed an AI service in the editor or in shipped games. Instead,
it exposes ordinary files, stable commands, deterministic output, and local
documentation so any shell-capable coding agent can work on a game without a
proprietary integration.

## Stable commands

```sh
pnpm vapour create ./MyGame --name "My Game" --json
pnpm vapour create ./MyVsGame --name "My VS Game" --language vs --json
pnpm vapour inspect ./MyGame --json
pnpm vapour validate ./MyGame --json
pnpm vapour build ./MyGame --out ./release --json
pnpm vapour dev ./MyGame --port 4173 --json
pnpm vapour schema --json
pnpm vapour compile-vs ./MyVsGame/Scripts/main.vs --out /tmp/main.js --json
```

`--json` writes one JSON object per completed command. Success objects contain
`ok: true`, the command name, and a `data` value. Failures use a non-zero exit
status and write an object with `ok: false` and a stable error code to stderr.
The development server emits a `ready` event after the build is hostable.

## Agent-readable project contract

- `.vapourproject` declares the format version, stable project ID, pinned editor
  version, startup scene, script entry point, and renderer policy.
- `Assets/` contains source assets and source-control-friendly scene JSON.
- `Scripts/` contains Vapour Script and/or TypeScript gameplay code.
- `Settings/` contains deterministic project and input configuration.
- `Plugins/` contains project-scoped extensions.
- `.vapour/` and `dist/` are generated and must not be edited.

New CLI projects include an `AGENTS.md` with these rules and required verification
commands. Codex, Claude Code, and similar tools discover that file through their
normal repository workflows; Vapour does not ship their SDKs or credentials.

## Safe automation workflow

1. Run `inspect --json` and read `.vapourproject` before changing a project.
2. Preserve stable project, entity, scene, and asset IDs.
3. Use the documented engine package APIs from TypeScript scripts.
4. Make small source-file changes; never modify caches or generated bindings.
5. Run `validate --json` after scene, settings, or manifest edits.
6. Run `build --json` before completion and inspect any structured failure.

The JSON contracts will be versioned before the first stable release. New fields
will be additive within a format version; breaking changes require an explicit
format migration command.
