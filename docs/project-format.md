# Project and scene format

A Vapour project root contains `.vapourproject`, source `Assets`, gameplay
`Scripts`, and `Settings`. Generated files belong in `.vapour` or `dist` and
are ignored by Git.

`scriptEntry` may point to `.ts`, `.js`, or `.vs`. Vapour Script and TypeScript
can import one another in a single project and receive the same engine APIs.

Scenes use UTF-8 JSON and `formatVersion: 1`. Entities and assets have UUIDs;
references use UUIDs, not paths. The serializer sorts entities, component
types, dependencies, and asset records before writing to keep diffs stable.

The asset database rejects duplicate IDs and paths, missing dependencies,
self-dependencies, unsafe relative paths, and removal of referenced assets.
Moving an asset updates its path while preserving its stable ID.

Use the CLI to validate or build a project:

```sh
pnpm vapour validate templates/empty-3d
pnpm vapour build templates/empty-3d --out /tmp/vapour-game
```
