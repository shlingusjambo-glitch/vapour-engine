# Navigation

Before Mirage, `findPath` searched a graph the **caller** supplied. That is the
right low-level primitive and the wrong thing to ask a game for: building the
graph is the hard part, and it is the part that has to agree with the geometry
the renderer and physics already use. `bakeNavMesh` builds it from triangles.

## Concept

Baking is a **heightfield voxelization** — the same shape of algorithm Recast
uses, for the same reasons:

- it makes no assumptions about the input being clean, which matters because
  generated and CSG geometry frequently is not;
- it handles overlapping floors naturally — a bridge over a road, a second
  storey — by keeping several spans per column;
- its parameters are quantities a designer can reason about (agent radius, step
  height, slope) rather than tuning constants.

Baking is deliberately **per agent size**. A navmesh eroded for a 0.3 m radius
is wrong for a 1.2 m vehicle, and the alternative — one mesh with runtime radius
checks — is both slower and subtly wrong at corners.

## Basic example

```ts
import { bakeNavMesh, smoothPath, navMeshLineOfSight } from "@vapour/engine";

const navmesh = bakeNavMesh(
  { positions: level.positions, indices: level.indices },
  { cellSize: 0.3, agentRadius: 0.35, agentHeight: 1.8, agentMaxClimb: 0.4, maxSlopeDegrees: 45 },
);

const path = navmesh.findPath(npc.position, destination);
if (path.status === "complete") {
  const route = smoothPath(path.points, (from, to) => navMeshLineOfSight(navmesh, from, to));
  npc.follow(route);
}
```

`findPath` returns `complete`, `unreachable`, or `budget-exceeded` — an
expensive or impossible query becomes an explicit result rather than a frame
hang.

**Always smooth the result.** A raw corridor follows cell centres, so an agent
walking it moves in visible staircase steps. `smoothPath` removes every waypoint
that can be skipped without leaving the corridor.

## What baking does

1. **Rasterize** each triangle into the columns its footprint covers, recording
   a surface height, and reject anything steeper than the slope limit.
2. **Merge** near-coincident surfaces in a column, so a floor of many triangles
   becomes one span rather than dozens stacked up.
3. **Connect** spans in neighbouring columns whose height difference an agent
   can step over.
4. **Erode** by the agent radius, removing spans too close to an edge. This is
   what stops agents clipping walls, and doing it on the grid is far cheaper
   than testing radius per query. A corridor narrower than the agent erodes away
   entirely, which is the correct answer.

## Off-mesh links

Adjacency cannot express a door, a ladder, or a jump. Those are links:

```ts
navmesh.addOffMeshLink({ from: [x0, y, z0], to: [x1, y, z1], kind: "door" });
navmesh.addOffMeshLink({ from: ledgeTop, to: ground, bidirectional: false });   // a drop
```

Endpoints snap to the nearest span, so an approximately placed link still
connects. `addOffMeshLink` returns `false` when it cannot attach, rather than
silently doing nothing.

### Dynamic obstacles

`setObstacle({ id, position, radius, height })` carves a cylindrical runtime
volume from path queries. Setting the same stable id moves it atomically;
`removeObstacle(id)` restores its spans. Obstacles expand by the baked agent
radius, so a path does not scrape an agent's body along a crate or closed door.
Overlapping volumes are reference-counted: removing one cannot accidentally
open spans still occupied by another. `stats().dynamicObstacles` exposes the
live count to diagnostics. Obstacles are transient simulation state and are
intentionally excluded from the baked NavMesh asset.

### Generated buildings connect themselves

This is the integration the Mirage brief asks for. The architecture generator
reports every opening as an **aperture** with a world position and a `walkable`
flag, so a doorway becomes a route with no extra authoring:

```ts
for (const aperture of building.apertures) {
  if (!aperture.walkable) continue;                       // windows are not routes
  const across = [-aperture.along[2], 0, aperture.along[0]];
  navmesh.addOffMeshLink({
    from: [aperture.position[0] - across[0], level, aperture.position[2] - across[2]],
    to:   [aperture.position[0] + across[0], level, aperture.position[2] + across[2]],
    kind: "door",
  });
}
```

`generateNavGeometry` in `@vapour/assetgen` does this derivation for a whole
building. See [`examples/ai-environment`](../examples/ai-environment/), whose
`navigation.test.ts` walks the full chain: description → building → walkable
surface → navmesh → path through a doorway.

## Areas and costs

```ts
const navmesh = bakeNavMesh(input, settings, [
  { id: 0, name: "walkable", cost: 1 },
  { id: 1, name: "mud", cost: 4 },
  { id: 2, name: "lava", cost: Infinity },
]);
```

Per-triangle area ids come in through `input.areas`. Cost multiplies traversal,
so agents route around expensive ground when a cheaper way exists and pay the
price when it does not.

## API reference

| Export | Purpose |
| ------ | ------- |
| `bakeNavMesh` | Builds a `NavMesh` from triangles |
| `NavMesh` | Path queries, off-mesh links, dynamic obstacle carving, spans, positions, and statistics |
| `smoothPath` | Straightens a corridor into a walkable route |
| `navMeshLineOfSight` | Straight-line walkability test, for `smoothPath` |
| `findPath` | The lower-level A* over a caller-supplied graph |
| `serializeNavMesh`, `deserializeNavMesh` | Round-trip a versioned baked navigation asset |
| Types | `NavMeshSettings`, `NavMeshInput`, `NavSpan`, `NavArea`, `OffMeshLink`, `NavMeshStats` |

`DEFAULT_NAVMESH_SETTINGS` holds the defaults: 0.3 m cells, 0.35 m radius, 1.8 m
height, 0.4 m climb, 45° slope.

## Baked asset serialization

Use `serializeNavMesh(navmesh)` to save a deterministic, versioned JSON asset
and `deserializeNavMesh(json)` to load it without voxelizing source geometry
again. The asset includes settings, origin, spans, adjacency, area costs, and
directed off-mesh links. Runtime column indexes are rebuilt during loading.
Impassable `Infinity` area costs encode as JSON `null` and restore losslessly.

Loading validates the format version, settings, canonical span indices, every
adjacency target, unique areas, and off-mesh endpoints. Corrupt assets fail
with the offending span or link instead of producing partially connected AI
navigation. `NavMesh.serialize()` returns the structured form for asset-pipeline
plugins that do not want a JSON string.

## Performance considerations

- Bake cost scales with **surface area / cellSize²**. Halving the cell size
  quadruples the work and the memory. 0.3 m is a good default for human-scale
  agents; use 1 m for vehicles and open terrain.
- Bake offline or in a worker for a large level. Bake per *tile* for a streaming
  world so a region can be rebuilt without redoing the map.
- `nearestSpan` searches outward ring by ring and stops as soon as no closer
  span is possible, so it is safe to call per agent per destination change — but
  not per agent per frame.
- `smoothPath` costs one line-of-sight test per candidate skip. Smooth once when
  the path is produced, not every frame.
- `findPath`'s `maxVisited` budget defaults to 10,000 nodes. Lower it for
  background agents so a pathological query cannot spike a frame.

## Multiplayer considerations

Baking is deterministic: the same triangles and settings produce the same spans
in the same order on every machine. A server and its clients can therefore agree
on paths without replicating the navmesh, and a client can predict an NPC's
route rather than waiting for waypoints.

## XR considerations

Teleport locomotion is a navmesh query: `isWalkable` at the pointer's landing
point is exactly the test a teleport arc needs, and using the navmesh rather
than a raycast means the player cannot teleport onto a ledge an agent could not
stand on.

## Agents and crowds

A path is not movement. An NPC handed waypoints still has to follow them at a
sensible speed, stop when it arrives, notice when its destination moves, and —
the part every game underestimates — not walk through the other twenty NPCs
doing the same thing.

```ts
import { Crowd } from "@vapour/engine";

const crowd = new Crowd(navmesh);
const guard = crowd.addAgent({ position: spawn, radius: 0.35, maxSpeed: 3.5 });

crowd.setDestination(guard, post);

// once per fixed step
crowd.update(fixedDelta);
```

`setDestination` returns whether a route exists. An unreachable destination
leaves the agent stationary in the `unreachable` state rather than walking
toward somewhere it cannot get to.

`updateMovingDestination(agent, target, threshold)` repaths only when the target
has moved further than the threshold. That is how an NPC chases a moving player
without repathing every frame — on a large navmesh, the difference between a
playable crowd and a frame-rate problem.

### Why velocity sampling

Local avoidance proposes a fan of candidate velocities around the desired one
and picks the best-scoring by time-to-collision against neighbours. This is
chosen over a force-based model because forces produce the two failures that
make crowds look wrong: agents that oscillate against each other, and agents
that shove each other through walls. Sampling never proposes a velocity that
was not already acceptable.

Scoring balances how soon a candidate collides against how far it deviates from
what the agent wanted, so an agent with a clear path keeps going straight and
one facing a collision turns the smallest amount that resolves it. Candidates
are sampled alternately left and right of the desired heading, which is what
stops a symmetric head-on encounter deadlocking.

`priority` decides who yields. Equal priorities split the adjustment, following
the reciprocal assumption that both agents are solving the same problem.

### Determinism

Agents step in id order, candidates are enumerated in a fixed order, and ties
break on index. The same inputs produce the same movement on every machine,
which is what lets a client predict NPC motion instead of waiting for the server
to send positions. `nav-agent.test.ts` asserts this directly.

### Cost

`maxNeighbours` (8 by default) bounds how many neighbours each agent considers,
so a dense crowd costs `O(agents × maxNeighbours × samples)` rather than
`O(agents²)`. `avoidanceSamples` (12) trades smoothness for time; lower it for
background crowds.
