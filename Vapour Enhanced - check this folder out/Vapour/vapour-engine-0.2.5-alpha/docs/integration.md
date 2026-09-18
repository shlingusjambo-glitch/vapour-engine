# Integration

Every Vapour subsystem is tested on its own. `packages/engine/src/integration/`
is where two of them are proven to compose: each module joins two real
subsystem APIs and states which side wins when they disagree. Nothing here is
a new system. Everything is exported from `@vapour/engine`.

`@vapour/engine` depends on neither `@vapour/net` nor `@vapour/assetgen`. Where
one of those is involved its types are matched structurally (same field names
as the real types) and its behaviour is injected — the same pattern as
`createSceneSync`. The tests therefore exercise the real engine subsystems and
restate the net/assetgen contract in a few lines; in a game, pass the real
`@vapour/net` functions and `@vapour/assetgen` outputs.

## Networked animated characters (M120)

`NetworkedCharacter` joins a server-authoritative rigid body with client-side
root motion.

| Situation | Who wins |
|---|---|
| Between snapshots | Root motion: `animate(pose)` moves the character by `rootMotionDelta`, rotated into the rendered facing. |
| Snapshot, small error | Server via the reconciler: a fraction of the gap closes, velocities are the server's, root motion continues on top. |
| Snapshot, large error or server says sleeping | Server, whole: the pose snaps and root motion re-anchors so no stale delta lurches the character. |
| A clip loops or changes | Neither: a root delta longer than `maxStep` (1 m) in one frame is discarded. |

```ts
import { NetworkedCharacter } from "@vapour/engine";
import { applyRigidBodyAuthority, unpackRigidBody } from "@vapour/net";

const character = new NetworkedCharacter(spawnState, {
  skeleton,
  reconcile: (local, authority) => applyRigidBodyAuthority(local, authority, { snapThreshold: 0.5 }),
});
// each frame
character.animate(animator.update(dt));
// each snapshot
character.reconcile(unpackRigidBody(entity.state));
render(character.state.position, character.state.rotation);
```

`NetworkedBodyState` is field-for-field `RigidBodyState` (and
`PhysicsBodySnapshot3d` without `id`); `BodyReconciler` is
`applyRigidBodyAuthority` with its options bound.

## XR grabbing networked objects (M121)

`NetworkedGrabSession` (client) and `handleNetworkedGrabRpc` (server) join
`XrGrabController` with `@vapour/net` ownership.

- **Grab → ownership request.** Only the current owner may call
  `transferOwnership`, so a grab is sent as the `xr.grab` RPC and the server
  hands the entity over with `setOwner`. The hand holds the object from the
  first frame; the ownership notification confirms it.
- **Release → final transform.** `xr.release` carries the hand-resolved
  position; the server writes it under `"p"` (`RIGID_BODY_KEYS.position`) and
  returns ownership to the server so physics carries on from there.
- **Remote grab on a held object.** Policy `first-holder-wins` (default): the
  client never grabs what its replicated state says someone else owns, and if
  two grabs race the server refuses the later one with `xr.grab.refused`, which
  the session turns into a local release. Policy `steal`: the newer grab wins;
  the previous holder learns through `onOwnership` and its session releases.

```ts
const session = new NetworkedGrabSession(client);
const client = new NetworkClient(transport, {
  onOwnership: (entity) => session.onOwnership(entity),
  onRpc: (name, args, id) => session.onRpc(name, args, id),
});
// server
new NetworkServer(transport, { onRpc: (connection, name, args, id) => handleNetworkedGrabRpc(server, connection.id, name, args, id) });
```

## Nav agents driving physics; AI state driving animation (M122)

`NavMotorBinding` turns a `Crowd` agent's post-avoidance velocity into
`ThirdPersonMotor3d` input each tick and writes the motor's position back to
the agent. Physics is the truth for position, navigation for intent: an NPC
stopped by a door the navmesh does not know about stops on the navmesh too.
Set the motor's `speed` to the agent's `maxSpeed` so the two agree on pace.

```ts
const binding = new NavMotorBinding(agent, motor);
crowd.update(dt);
binding.update(dt);
```

`AnimatorStateBinding` maps AI `StateMachine` state names to `Animator`
parameter sets and applies the current one on `apply()`. The animator's own
transitions, fades and wait-for-exit rules are untouched: AI says *chasing*,
animation decides how to get from idle to run. An AI state with no mapping
throws, because a silent no-op leaves the NPC in the wrong animation.

```ts
const binding = new AnimatorStateBinding(brain, animator, { idle: { moving: false }, chase: { moving: true } });
brain.update(npc, dt); binding.apply(); animator.update(dt);
```

## Generated assets → collision and navigation (M123)

`compileAsset`/`compileBuilding` already produce `collision` and `navigation`.
These adapters finish the job:

- `colliderFromAsset(asset)` → `ColliderShape3d`: `box` (wrapped in a
  one-child `compound` when off-centre), `convexMesh`, or `triangleMesh`.
- `navMeshInputFromAssets(placed)` / `offMeshLinksFromAssets(placed)`:
  walkable triangles and door/passage links of placed assets, translated into
  the world. Translation only; buildings are generated in world orientation.
- `bakeAssetNavMesh(placed, settings)` bakes and wires the links, reporting
  any `unlinked` door that opens onto nothing.

`CompiledAssetLike` names the fields of `CompiledAsset` that are read. The
committed test uses a hand-built fixture of that shape; the same adapter run
against a real `compileBuilding` hall yields a 112-triangle collider and a
560-span navmesh with the doorway linked.

## Streaming updates navigation; audio follows entities (M124)

`StreamingNavMesh` subscribes to `ChunkStreamManager` and calls
`NavMesh.rebakeRegion` over the chunk's footprint on every `ready` and
`unloaded` event — with the chunk's geometry on load, nothing on unload. The
footprint is grown by the agent radius plus a cell so erosion at a chunk edge
is redone once the neighbour arrives, which is what joins chunks. Every
rebake yields a new `NavMesh`; read `streaming.navmesh` each tick rather than
caching it. Per-triangle `areas` are not carried through the merge.

```ts
const streaming = new StreamingNavMesh<Tile>({ chunkSize: 16, geometry: (tile) => tile.ground });
manager.subscribe((event) => streaming.handle(event));
```

`AudioEntityFollower` pushes each followed entity's world position — via
`computeWorldMatrices`, so parents count — to an `AudioSource` or `AudioVoice`
every tick, plus the velocity the move implies so Doppler works for free.
Followers whose entity was removed are dropped.

```ts
const follower = new AudioEntityFollower(scene);
follower.attach(source, lanternId);
follower.update(dt);
```
