# Instructions for coding agents using Vapour Engine

You are working with the local Vapour Engine SDK. Read `README.md`,
`docs/automation.md`, `docs/agent-game-building.md`, `docs/project-format.md`, `docs/status.md`, and the
subsystem documentation relevant to the requested game before editing.

## Required workflow

1. Use `./vapour create` to create a project unless one already exists.
2. Run `./vapour inspect <project> --json` before modifying an existing project.
3. Put gameplay in `Scripts/` using TypeScript and/or Vapour Script (`.vs`).
4. Use `@vapour/engine` APIs. Do not recreate rendering, input, physics, audio,
   UI, saving, networking, navigation, or world streaming inside the game when
   the SDK already supplies the capability.
5. Preserve stable scene, entity, project, and asset IDs.
6. Never edit generated `.vapour/`, `dist/`, hashed bundles, or WASM bindings.
7. Run `./vapour validate <project> --json` after source-data changes.
8. Run `./vapour build <project> --out <release-directory> --json` before handoff.
9. Treat a successful build—not editor preview—as the deployable artifact.

WebGPU is the primary renderer. Do not introduce a WebGL primary path. Report
unsupported engine requirements explicitly and consult `docs/status.md`; do
not hide missing behavior inside game-specific hacks.
