# AI and navigation

Vapour keeps reusable decision execution and path search in the engine while a
game owns its characters, goals, balance, senses, and authored behavior. Import
the APIs from `@vapour/engine`; none depend on the editor, DOM, Three.js, or a
particular world representation.

## State machines

`StateMachine<TContext>` runs named states with `enter`, `update`, and `exit`
hooks. An update may return the next state name. The machine applies that
transition only after the callback returns, so state mutation cannot leave a
half-exited agent. Unknown states and invalid delta times throw errors that name
the offending state and available choices.

```ts
const brain = new StateMachine<Mob>("idle", {
  idle: { update: mob => mob.targetVisible ? "chase" : undefined },
  chase: {
    enter: mob => { mob.animation = "run"; },
    update: (mob, dt) => mob.targetVisible ? (moveMob(mob, dt), undefined) : "idle",
  },
});
brain.update(mob, fixedDeltaSeconds);
```

## Behavior trees

`BehaviorTree<TContext>` supports action, condition, sequence, selector,
inverter, repeat, and cooldown nodes. Actions return `running`, `success`, or
`failure`. Sequence and selector cursors resume on the next tick rather than
replaying completed work. Tree definitions are immutable and shareable; each
runner owns its agent's cursors, counters, and cooldown clocks.

Use one runner per agent. Tick it from `GameRuntime.fixedUpdate` for deterministic
simulation. `reset()` clears all execution memory when despawning or reusing a
pooled agent. Duplicate/empty IDs, empty composites, invalid repeats, invalid
statuses, and invalid timing values fail immediately with node-specific errors.

## Pathfinding

`findPath` is deterministic A* over a caller-supplied graph. A node is any
object with finite `x`, `y`, and `z`; `neighbours` decides whether that graph is
a tilemap, voxel walk surface, waypoint network, or navmesh. Optional callbacks
provide traversal rules, edge costs, heuristics, and stable keys.

```ts
const result = findPath(start, goal, {
  neighbours: gridNeighbours4,
  traversable: cell => world.isWalkable(cell.x, cell.y, cell.z),
  heuristic: manhattanDistance,
  maxVisited: 2_000,
});
if (result.status === "complete") agent.path = result.path;
```

The result distinguishes `complete`, `unreachable`, and `budget-exceeded`.
Always set a search budget for player-authored or unbounded worlds. Large games
should dispatch searches through `WorkerTaskPool`; graph/world snapshots sent
to a worker must be immutable for the duration of a query.

## Steering

`steerSeek`, `steerArrive`, and `steerSeparation` write into a caller-owned
vector. They allocate no temporary vectors and accept plain structural vector
objects, so gameplay code is not coupled to a math library. Compose their
outputs, clamp acceleration, then pass movement through the appropriate physics
controller—steering does not bypass collision detection.

## Current boundary

These APIs provide reusable AI execution, graph search, and local steering.
Voxel walk-surface extraction, navmesh baking, dynamic navmesh obstacles,
behavior-tree editor tooling, and crowd simulation are not implemented yet.
CubeGame's zombie/animal/boss choices remain game content; its generic state
execution, rate limiting, path searches, and movement targets can now migrate
to these engine APIs.
