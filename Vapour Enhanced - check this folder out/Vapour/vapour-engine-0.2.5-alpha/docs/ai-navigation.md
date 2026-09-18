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

## NavMesh baking

`bakeNavMesh` voxelizes triangles into a heightfield of walkable spans (the
same shape of algorithm Recast uses), connects spans a step apart, and erodes
by agent radius. `NavMesh` then answers `findPath`, `nearestSpan`,
`isWalkable`, and holds dynamic obstacles (`setObstacle`/`removeObstacle`) and
off-mesh links (`addOffMeshLink`) for doors, ladders, and jumps. Assets
round-trip through `serializeNavMesh`/`deserializeNavMesh`.

### Localized rebaking

`NavMesh.rebakeRegion(input, region)` rebakes only the spans touching a
world-space AABB and splices them back in, instead of rebaking the whole
mesh — the operation a streaming world needs when a chunk loads in or a
player edits terrain far from everything else.

```ts
const report = navmesh.rebakeRegion(updatedChunkGeometry, {
  minX: 17, maxX: 23, minZ: 17, maxZ: 23,
});
report.navmesh;             // the spliced-in result
report.spansAdded;          // new geometry inside the region
report.spansRemoved;        // geometry that disappeared
report.spansModified;       // area/cost changes at an unchanged position
report.spansRebaked;        // total spans reprocessed (region + halo)
report.offMeshLinksInvalidated; // off-mesh links whose endpoint vanished
```

`input` must describe the region's *current* geometry, not a delta — an
edited-out area with no covering triangle bakes to empty space, which is how
removed geometry is represented. Two rings sized from the agent radius keep
the splice correct: a halo of `ceil(agentRadius / cellSize) + 1` columns
where span *existence* is recomputed (erosion cannot be affected further out
than that from a change), and one further ring where only *links* are
recomputed against the halo's new spans. Everything outside is mechanically
unreachable by the edit and carries over unchanged in content; only its
numeric index can shift, because the span array has no gaps.

**A localized rebake of the final geometry is required to match a full
rebake of the same geometry, span for span and link for link** (compared by
position rather than raw index, since index is an array-position artifact,
not semantic identity) — that equivalence is the feature's entire point, and
it's what `navmesh.test.ts`'s `rebakeRegion` suite asserts directly.

## 2D navigation

`Nav2D` (in `tilemap/nav-2d.ts`) is grid pathfinding over a `Tilemap`,
reusing the same `findPath` and the navmesh module's `smoothPath` rather than
a second pathfinder or a second string-puller:

```ts
const nav = new Nav2D(tilemap, { agentRadius: 1 });
nav.setBlocked(4, 4); // a crate, another agent, a closed door
const result = nav.findPath([1, 1], [8, 8]);
result.status;  // "complete" | "unreachable" | "budget-exceeded"
result.cells;   // the raw grid corridor
result.points;  // string-pulled: the route to actually walk
```

Walkability comes from the tilemap's own collision (`Tilemap.tileAt`), so a
level's navigation data can never drift out of sync with what actually
blocks movement — only `solid` tiles block by default; a `platform` or
`slope` tile is left walkable, since a top-down/side-view grid agent can
still occupy that cell. `agentRadius` (in whole tiles) inflates every check
to the agent's full footprint rather than testing clearance only at its
centre. `drawNav2D` in `ai/nav-debug.ts` renders a `Nav2D`'s grid and a path
alongside the existing 3D navmesh debug draw.

## Current boundary

Voxel walk-surface extraction, behavior-tree editor tooling, and crowd
simulation are not implemented yet. CubeGame's zombie/animal/boss choices
remain game content; its generic state execution, rate limiting, path
searches, and movement targets can now migrate to these engine APIs.

## Vapour Script

The same API from Vapour Script — VS compiles to ESM and receives the same
engine objects as TypeScript, so nothing below is a binding layer.

```py
from "@vapour/engine" import bakeNavMesh, Crowd

export func patrol(mesh, start, goal):
    var navmesh = bakeNavMesh({ positions: mesh.positions, indices: mesh.indices }, { cellSize: 1, agentRadius: 0.5 })
    var crowd = new Crowd(navmesh)
    var agent = crowd.addAgent({ position: start, maxSpeed: 4 })
    crowd.setDestination(agent, goal)
    for step in range(600):
        crowd.update(1 / 60)
    return agent.state
```
