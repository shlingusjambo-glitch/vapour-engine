# Loading sessions

`LoadingSession` is the engine-owned progress model for project boot, scenes,
world streaming, asset groups, matchmaking, and other asynchronous work. It is
independent of DOM, canvas, and editor UI: presentation subscribes to immutable
snapshots while loaders report completed work.

```ts
import { LoadingSession } from "@vapour/engine";

const loading = new LoadingSession([
  { id: "metadata", label: "Reading scene", weight: 1 },
  { id: "assets", label: "Loading assets", weight: 4 },
  { id: "spawn", label: "Streaming spawn", weight: 5 },
]);

const unsubscribe = loading.subscribe(({ progress, activeTask, state }) => {
  loadingBar.value = progress;
  loadingLabel.textContent = activeTask?.detail ?? activeTask?.label ?? state;
});

await loading.run("metadata", async ({ signal }) => loadSceneMetadata(signal));
loading.start("assets");
loading.report("assets", decodedAssets / requiredAssets, "Decoding textures");
loading.complete("assets");
```

Progress is normalized to `0..1`, weighted, monotonic per leaf task, and reaches
one only when all root tasks complete. Tasks can be nested with `parent`; group
progress is calculated from its children and cannot be manually reported.

`run()` forwards the session's `AbortSignal`, marks successful work complete,
and records failures before rethrowing them. `cancel()` aborts outstanding work
and marks pending/running tasks cancelled. Error objects remain available on the
session and affected task snapshots instead of being silently discarded.

CubeGame's survival, multiplayer-room, sandbox, TF2, and Call of Block loaders
consume this API. Metadata, world reset, terrain initialization, gameplay
restoration, and spawn streaming are distinct weighted tasks. Spawn progress is
based on generated and GPU-uploaded vertical sections at the player position;
unrelated chunks do not inflate its progress. Gameplay gating is derived from
the session itself, so there is no parallel game-owned loading boolean that can
drift out of sync.
