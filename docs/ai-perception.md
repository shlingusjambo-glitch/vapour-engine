# AI perception and blackboards

Vapour supplies reusable sensing and decision infrastructure, not hardcoded
enemy behavior. `perceiveVision` applies range, field-of-view, tag, and optional
line-of-sight tests. `perceiveHearing` applies distance attenuation and an
optional obstruction factor. Both return deterministic, ranked observations.

```ts
import { blackboardKey, AiController, perceiveVision, selectTarget } from "@vapour/engine";

const currentTarget = blackboardKey<string>("combat.target");
const controller = new AiController<Game>({
  sensingInterval: 0.1,
  sense(game, memory) {
    const seen = perceiveVision(game.enemies, {
      eye: game.guard.position,
      forward: game.guard.forward,
      range: 25,
      fieldOfView: 100,
      occluded: (from, to) => game.physics.raycast(from, to) !== undefined,
    }, "player");
    const target = selectTarget(seen, "highest-threat");
    if (target) memory.set(currentTarget, target.id);
    else memory.delete(currentTarget);
  },
  decide(game, memory, dt) {
    const target = memory.get(currentTarget);
    if (target) game.behaviors.combat.tick({ game, target }, dt);
    else game.behaviors.patrol.tick(game, dt);
  },
});
```

`Blackboard` uses typed keys, supports defaults and change observation, and can
produce a deterministically ordered diagnostic snapshot. `AiController` keeps
expensive sensing on a configurable cadence while decisions continue every
update. Disable a controller to stop both without losing its memory.

Hearing inputs are transient `SoundStimulus` values. Feed them from gameplay
events or the audio-source layer; do not inspect the browser audio graph. The
optional obstruction callback returns `0` for clear and `1` for fully blocked.

## Performance

The query functions are linear in candidates and intentionally do not own a
spatial index. Supply candidates from the world partition, physics broad phase,
or network-interest grid. Run sensors at 5–10 Hz for most characters and stagger
controllers across frames. Line-of-sight callbacks are normally the expensive
part, so range/cone filtering happens before them.

## API

- `perceiveVision`, `VisionSensorOptions`, `PerceptionTarget`, `PerceivedTarget`
- `perceiveHearing`, `SoundStimulus`, `HeardStimulus`
- `selectTarget` and `TargetPolicy`
- `blackboardKey`, `Blackboard`, `BlackboardKey`
- `AiController`

## Navigation debugging

`drawNavMesh(debug, navmesh)` queues walkable cells in green and dynamically
blocked cells in red through the shared `navigation` debug category. Optional
adjacency edges, span/area labels, and off-mesh-link arrows expose why a route
did or did not connect. `drawNavigationPath` draws a yellow route with distinct
start and destination markers. Disable all of it with
`debug.setCategoryEnabled("navigation", false)`.
