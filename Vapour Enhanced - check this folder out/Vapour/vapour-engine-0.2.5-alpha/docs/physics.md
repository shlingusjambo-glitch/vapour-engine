# Physics

Vapour's general 2D and 3D physics worlds run in Rust/WASM on Rapier. VS and
TypeScript use the same `PhysicsWorld2dBridge` and `PhysicsWorld3dBridge`; commands queue in TypeScript and
cross into Rust as one batch per fixed step. Solver handles never escape the
engine—games use stable positive integer IDs suitable for saves and networking.

```ts
const physics = await createPhysicsWorld3d();
physics.insert({
  id: 1,
  bodyType: "dynamic",
  position: [0, 5, 0],
  rotation: [0, 0, 0, 1],
  shape: { type: "capsule", halfHeight: 0.5, radius: 0.3 },
  continuousCollisionDetection: true,
});

function fixedUpdate(_game: GameContext, dt: number): void {
  const { bodies, events } = physics.step(dt);
  // Apply body snapshots to presentation transforms and dispatch events.
}
```

2D uses the same fixed-step workflow, but its native shapes and rotations are
2D-specific:

```ts
const physics = await createPhysicsWorld2d();
physics.insert({
  id: 1,
  bodyType: "dynamic",
  position: [0, 5],
  shape: { type: "circle", radius: 0.5 },
});
```

## Implemented 2D behavior

- static, dynamic, position-kinematic, and velocity-kinematic bodies;
- rectangles, circles, Y-axis capsules, and convex polygons;
- the same materials, damping, force/impulse, CCD, layers, sensors, stable-ID
  events, and filtered nearest-raycast contract as 3D;
- scalar rotation/angular velocity and two-component positions and velocities;
- batched commands and actionable validation at both the TypeScript and Rust
  boundaries.

## Implemented 3D behavior

- static, dynamic, position-kinematic, and velocity-kinematic bodies;
- boxes, spheres, Y-axis capsules, cylinders, infinite planes, convex hulls,
  triangle meshes, native heightfields, and nested compound colliders with
  per-child local position and rotation;
- gravity, density, friction, restitution, linear/angular damping;
- linear/angular velocities, forces, force-at-point, torque, linear/angular
  impulses, and kinematic targets;
- optional continuous collision detection;
- 32 collision-layer membership and mask bits;
- solid colliders and non-blocking sensors;
- deterministic stable-ID snapshots;
- collision enter/exit and trigger enter/exit events;
- nearest raycasts with layer filters, optional sensor inclusion, hit points,
  distances, and surface normals;
- exact overlap queries for every supported collider shape;
- swept-shape casts with stable IDs, impact distance, shape position, and a
  world-space normal oriented against incoming movement;
- explicit validation for finite values, sizes, quaternions, IDs, layers, and
  stale body references.

Call `step` from `GameRuntime.fixedUpdate`. Do not step from presentation
`update`, because variable timesteps make gameplay depend on frame rate.
`destroy()` releases the Rust/WASM world.

Complex objects use one compound shape rather than several independently
simulated bodies. Each child can be any supported shape—including another
compound—and has a transform local to the parent body:

```ts
physics.insert({
  id: 42,
  bodyType: "dynamic",
  position: [0, 3, 0],
  rotation: [0, 0, 0, 1],
  shape: {
    type: "compound",
    children: [
      {
        position: [-0.8, 0, 0],
        rotation: [0, 0, 0, 1],
        shape: { type: "sphere", radius: 0.45 },
      },
      {
        position: [0.8, 0, 0],
        rotation: [0, 0, 0, 1],
        shape: { type: "box", halfExtents: [0.5, 0.3, 0.7] },
      },
    ],
  },
});
```

Empty compounds, invalid child transforms, degenerate convex hulls, and bad
mesh indices fail before simulation. A compound produces one rigid body and
one stable game ID, so collision events and network ownership remain at the
object level.

## Serialized scene integration

The editor exposes `Rigidbody 2D`, `Collider 2D`, `Rigidbody 3D`, and
`Collider 3D` components. `ScenePhysicsRuntime` reconciles those components
with the native worlds rather than requiring gameplay scripts to create bodies:

```ts
const scenePhysics = new ScenePhysicsRuntime(sceneDocument, {
  physics2d: await createPhysicsWorld2d(),
  physics3d: await createPhysicsWorld3d(),
});
const game = new GameRuntime(canvas, hooks, { scenePhysics, scripts });
```

`GameRuntime` advances the binding only during fixed updates. Dynamic poses are
written back to scene transforms, authored position-kinematic transforms are
pushed into Rapier, removed or disabled entities release their native bodies,
and collision/trigger events are delivered to both VS and TypeScript modules
with scene entity IDs. Static colliders do not require a Rigidbody component.
An entity cannot mix 2D and 3D colliders; Vapour reports the entity name instead
of choosing a solver silently.

## Character controllers

`Character Controller 2D` and `Character Controller 3D` are editor-authored,
serialized components backed by Rapier's native kinematic controller. They are
not hardcoded player behavior: first-person, third-person, platformer, NPC, and
XR locomotion scripts provide desired translation while the engine handles
collision clipping, wall sliding, ground detection, slope limits, steep-slope
sliding, stair stepping, ground snapping, layers, and stable collision IDs.

```ts
const motion = game.physics!.moveCharacter3d(
  playerId,
  [vx * dt, vy * dt, vz * dt],
  dt,
);
if (motion.grounded) verticalVelocity = Math.max(0, verticalVelocity);
```

The same calls and result shapes are available to VS. Scene-level methods apply
the effective translation to the entity transform and translate native IDs back
to scene entity IDs. Lower-level `moveCharacter` methods remain available on
`PhysicsWorld2dBridge` and `PhysicsWorld3dBridge` for streamed or ECS-owned
worlds.

## Boundary and performance

The browser loads `PhysicsEngine2d` and `PhysicsEngine3d` from the same `vapour_runtime.js` and
`vapour_runtime_bg.wasm` artifact as the renderer. Body mutations are batched.
Ray origins/directions use typed arrays. Step snapshots and events currently
return deterministic JSON; a packed typed-array result is still required before
very large rigid-body worlds can be called optimized.

Rapier provides the solver, broad/narrow phases, generational storage, CCD, and
query acceleration. Vapour owns stable IDs, descriptors, validation, lifecycle,
serialization shape, scripting bindings, and the JS/WASM batching policy.

## Remaining physics gates

- polygon, convex-mesh, triangle-mesh, and heightfield authoring controls;
- advanced mesh/compound collider authoring controls in the visual inspector;
- constraints/joints, motors, springs, and break thresholds;
- rotation/translation locks, sleeping controls, mass overrides and material
  combine modes;
- dynamic-body pushing, controller crouch resizing, and moving-platform policy;
- packed snapshot output, worker-thread ownership and SharedArrayBuffer sync;
- scene `Rigidbody`/`Collider` runtime binding, editor controls and debug draw;
- save/network state integration and deterministic replay tests;
- browser-scale benchmarks and production tuning.

The existing voxel swept-AABB controller remains useful for block worlds. It is
separate from the general rigid-body solver rather than hidden inside it.

---

# Joints (Alpha 0.2.5)

Joints are what turn a physics world into a game world. A door, a lid, a wheel,
a suspension arm, a drawer, a tow hitch, and a ragdoll's every limb are all
constraints between two bodies, and none of them is expressible with rigid
bodies alone.

## The set, and why it is small

| Joint    | What it is                                              |
| -------- | ------------------------------------------------------- |
| `fixed`  | Welds two bodies. Breakable joins, compound props.      |
| `hinge`  | One rotational axis. Doors, lids, elbows, wheels.       |
| `slider` | One translational axis. Pistons, drawers, lifts.        |
| `ball`   | Three rotational axes. Shoulders, hips, tow hitches.    |
| `spring` | A damped distance constraint. Suspension, rope bridges. |

Rapier's full generic joint is more expressive and much harder to use
correctly. Naming the five that games actually build with keeps the common case
a one-liner.

## Anchors are local

```ts
import { hingeJoint, addJointCommand } from "@vapour/engine";

const door = hingeJoint(1, frameBodyId, doorBodyId, {
  anchorA: [0, 0, 0], // in the frame's local space
  anchorB: [-0.45, 0, 0], // the door's left edge, in the door's space
  axis: [0, 1, 0],
  limits: [0, Math.PI / 2], // opens 90°, one way
});

physics.applyCommands([addJointCommand(door)]);
```

Anchors are given in each body's **own local space**. That is what makes a joint
description independent of where the bodies happen to be when it is created — a
door hinge is "the left edge of the door" regardless of which way the door is
currently swinging.

## Motors

```ts
hingeJoint(2, chassisId, wheelId, {
  anchorA: [1, -0.3, 1.4],
  anchorB: [0, 0, 0],
  axis: [1, 0, 0],
  motor: [targetRadiansPerSecond, maxForce],
});

physics.applyCommands([
  { type: "setJointMotor", id: 2, targetVelocity: 0, maxForce: 500 },
]);
```

A motor drives a hinge or a slider toward a target velocity, bounded by a
maximum force. Setting the target to zero with a high force is how a powered
joint brakes.

## `collideConnected` is off by default

A hinge whose two halves collide with each other jitters at the joint. That is
almost never what an author wants and is hard to diagnose after the fact, so
connected bodies ignore each other unless asked not to.

## Ragdolls

```ts
import { ragdollJoints, HUMANOID_RAGDOLL_CONNECTIONS } from "@vapour/engine";
import { characterColliders } from "@vapour/assetgen";

const capsules = characterColliders(character);
const bodies = capsules.map((capsule, index) => ({
  id: 100 + index,
  bone: capsule.bone,
  position: capsule.from,
}));
const joints = ragdollJoints(bodies, HUMANOID_RAGDOLL_CONNECTIONS, 200);
```

The capsules come from the same rest pose the character's mesh was built from,
so collider and visual cannot disagree — and the joints line up with those
capsules. The two agreeing is what stops a ragdoll folding through its own body.

Connections whose bones are missing are skipped rather than failing, so a
partial skeleton produces a partial ragdoll instead of an error.

## Ragdoll runtime blend

`ragdollJoints` builds the constraints once. What happens every frame after
that — a hit ramping a character from its animated pose into physics, and
physics ramping back into animation once it recovers — is `ragdoll-blend.ts`.

```ts
import { RagdollBlendController } from "@vapour/engine";

const blend = new RagdollBlendController(ragdollBoneNames, {
  rampInSeconds: 0.25,
  rampOutSeconds: 0.4,
});

// On a hit: hand physics its starting velocity, matching the animation's
// momentum at this instant, then start ramping in.
const targets = blend.activate(skeleton, poseNow, posePrevious, dt);
for (const target of targets) {
  physics.setKinematicTarget(bodyIdFor(target.bone), target.position, target.rotation);
  physics.setLinearVelocity(bodyIdFor(target.bone), target.linearVelocity);
  physics.setAngularVelocity(bodyIdFor(target.bone), target.angularVelocity);
  physics.setBodyType(bodyIdFor(target.bone), "dynamic"); // now the solver owns it
}

// Every frame while blend.phase !== "animated":
const pose = blend.blend(skeleton, animatedPose, ragdollBodyTransforms);
skinningMatrices(skeleton, pose, inverseBind);
blend.advance(dt);

// When the character should stand back up:
blend.recover();
// blend.advance(dt) returns true the frame recovery completes, at which
// point every bone is back to weight 0 and the animator owns the pose again.
```

Per-bone weight is `0` (pure animation) to `1` (pure ragdoll); a partial
ragdoll — legs only, say — is just a `boneWeights` map that omits the rest.
`blendRagdollPose` is a pure function: it blends in world space (so a
dynamic body's world transform and an animated bone's local pose combine
correctly regardless of hierarchy) and converts back to the skeleton's local
pose space, which is what `skinningMatrices` expects. A bone with weight `0`
is left as an exact clone of the animated pose — no world round-trip, no
floating-point drift — so weight `0` reproduces pure animation precisely.

`ragdollActivationTargets` estimates each bone's world velocity from two
consecutive animated poses (finite difference for linear, a small-angle
quaternion delta for angular), which is what lets a character already
running keep running momentum the instant it ragdolls, instead of popping to
rest.

## Lifetime

Removing a body **drops its joints**: a constraint referencing a removed body
would otherwise dangle. Removing a joint **wakes both bodies**, or a sleeping
body released from its constraint would stay frozen in place until something
else disturbed it.

## Validation

`validateJoint3d` runs before anything crosses the WASM boundary. The Rust side
rejects bad joints too, but its error arrives as an opaque string from inside a
command batch; checking in TypeScript names the joint and the field, which is
the difference between a fixable message and a puzzle.

## API reference

| Export                                          | Purpose                                       |
| ----------------------------------------------- | --------------------------------------------- |
| `JointDescriptor3d`, `JointSpec3d`              | The joint types                               |
| `validateJoint3d`                               | Validates a spec, naming what is wrong        |
| `addJointCommand`                               | A validated `addJoint` command                |
| `hingeJoint`                                    | The common case, with a default vertical axis |
| `ragdollJoints`, `HUMANOID_RAGDOLL_CONNECTIONS` | A ragdoll from bone positions                 |
| Commands                                        | `addJoint`, `removeJoint`, `setJointMotor`    |

---

# Interaction: grabbing, carrying, throwing, doors

Every physics sandbox needs these, every game reimplements them, and almost
every implementation gets the same thing wrong: it moves the held object by
**setting its position**. That teleports it, so it passes through walls, gains
no momentum when released, and can crush the player against geometry.

## Velocity, not position

`GrabController` moves held objects with a damped spring on **velocity**. That
single choice gives correct behaviour for free:

- the object **collides on the way**, because it actually travels;
- it arrives with **real momentum**, so throwing works without special-casing;
- a heavy object, or one wedged behind geometry, simply **fails to keep up**
  rather than tunnelling through the world.

```ts
import { GrabController, holdPointInFront, throwImpulse } from "@vapour/engine";

const grab = new GrabController();
grab.grab(crateBodyId, holdPointInFront(camera.position, camera.forward, 2));

// each fixed step
grab.moveHold(
  crateBodyId,
  holdPointInFront(camera.position, camera.forward, 2),
);
const { commands, broken } = grab.update(poses, fixedDelta);
physics.applyCommands(commands);
for (const id of broken) hud.showGrabLost(id);

// on release
physics.applyCommands(
  grab.throwObject(crateBodyId, throwImpulse(camera.forward, 12)),
);
```

`throwObject` returns an **impulse**, not a velocity, so mass matters — a thrown
crate travels further than a thrown anvil for the same effort.

## Grabs break

```ts
grab.grab(id, point, { breakDistance: 3 });
```

Without a break distance, an object wedged behind geometry stays "held" forever
from across the level. That reads as a bug to a player even though the physics
is correct, so the grab releases and reports it in `broken`.

A body with no pose in the map is **skipped**, not treated as being at the
origin — which would yank it across the level on the frame a snapshot is
missing.

## Doors

```ts
import { PhysicsDoor } from "@vapour/engine";

const door = new PhysicsDoor({
  jointId: hingeId,
  speed: 2,
  force: 500,
  travelSeconds: 0.8,
  autoCloseSeconds: 4,
});
door.open();

physics.applyCommands(door.update(fixedDelta));
```

Driven by a **hinge motor**, not by animation. That is what lets the door push
objects, be blocked by them, and be held open by a crate — the behaviours that
make a physics door worth having over a scripted one.

When it arrives, the door **holds position with the motor** rather than
releasing it; otherwise a door leaned on by a crate drifts shut on its own.

## API reference

| Export                 | Purpose                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `GrabController`       | `grab`, `moveHold`, `release`, `releaseAll`, `throwObject`, `update`, `isHeld`, `heldBodies` |
| `PhysicsDoor`          | `open`, `close`, `toggle`, `update`, `state`                                                 |
| `holdPointInFront`     | Hold position from an eye and a forward direction                                            |
| `throwImpulse`         | Throw impulse from an aim direction and strength                                             |
| `DEFAULT_GRAB_OPTIONS` | The tuned defaults                                                                           |

## Multiplayer considerations

Grabbing is a **server** decision. A client that decides what it is holding can
hold anything, anywhere. Replicate the grab as ownership transfer — `setOwner`
in `@vapour/net` — and let the server run the spring; the client predicts the
held object like any other owned entity.

---

# Worker-side stepping and render interpolation

Physics steps on a fixed schedule; render frames do not line up with it.
Stepping physics off the main thread (`physics-worker-protocol.ts`) and
interpolating what gets drawn between two published steps
(`physics-interpolation.ts`) are what keep a low, fixed physics rate from
looking like it is ticking — the two only make sense together.

## The shared-memory handoff

`PhysicsWorkerChannel` is one class shared by both sides: a worker (or the
same-thread fallback below) calls `publish` once per physics step, and the
main thread calls `consume` once per render frame.

```ts
import {
  createPhysicsWorkerBuffer,
  physicsWorkerBufferByteLength,
  PhysicsWorkerChannel,
  isSharedPhysicsBufferAvailable,
} from "@vapour/engine";

const maxBodies = 4096;
const sab = createPhysicsWorkerBuffer(maxBodies); // SharedArrayBuffer, or ArrayBuffer as fallback
worker.postMessage({ buffer: sab, maxBodies }); // structured-clone shares a SharedArrayBuffer

// worker side, after each step:
const channel = new PhysicsWorkerChannel(sab, maxBodies);
channel.publish(tick, physics.step(dt).bodies);

// main thread, once per render frame:
const channel = new PhysicsWorkerChannel(sab, maxBodies);
const snapshot = channel.consume(); // undefined only before the first publish
```

The layout is a small integer header (generation, active-buffer index, tick,
body count) plus two double-buffered `Float32Array` body regions. The worker
always writes into the region the reader is *not* currently using, then flips
the header's active index — but that alone does not rule out a slow reader
still copying region A when the worker races ahead, finishes B, and starts
overwriting A again for the next step. The header's `generation` counter is
what catches that: it increments before and after every publish, so `consume`
rereads it after copying and retries if it moved — an ordinary seqlock. A
torn read is a generation mismatch, not corrupted data; it is detected and
retried, never returned.

## The same-thread fallback

`Atomics.store`/`Atomics.load` work identically on a `SharedArrayBuffer` and
on a plain `ArrayBuffer` — only the blocking `Atomics.wait` needs sharing,
which nothing here uses. `createPhysicsWorkerBuffer` checks
`isSharedPhysicsBufferAvailable()` (`typeof SharedArrayBuffer !== "undefined"`
and, where the flag exists, `crossOriginIsolated`) and allocates whichever
buffer type the runtime supports; `PhysicsWorkerChannel` itself has no branch
for either case. A page that is not cross-origin isolated, or a Node script
with no worker at all, gets a plain `ArrayBuffer` and simply calls `publish`
and `consume` synchronously on the same thread — same class, same layout,
same public API, just no second thread underneath it.

## Interpolating between two steps

```ts
import { interpolateBodies3d } from "@vapour/engine";

let previous = channel.consume();
function renderFrame(alpha: number) {
  const latest = channel.consume() ?? previous;
  const rendered = interpolateBodies3d(previous?.bodies ?? [], latest?.bodies ?? [], alpha);
  // draw `rendered` transforms this frame
  previous = latest;
}
```

`alpha` is how far the render frame sits between the previous and latest
published physics tick, in `[0, 1]` (clamped). Position lerps, rotation
`nlerp`s. A body only in the later snapshot (just spawned) renders at its own
transform unblended, since there is no earlier state; a body only in the
earlier one (since removed) is dropped.

## API reference

| Export                            | Purpose                                              |
| ---------------------------------- | ----------------------------------------------------- |
| `PhysicsWorkerChannel`             | `publish` (producer), `consume` (reader), one class   |
| `createPhysicsWorkerBuffer`        | Allocates a `SharedArrayBuffer` or `ArrayBuffer`      |
| `isSharedPhysicsBufferAvailable`   | Whether the runtime can share memory across a worker  |
| `physicsWorkerBufferByteLength`    | Buffer size for a given body capacity                 |
| `interpolateBody3d`, `interpolateBodies3d` | Pure lerp/`nlerp` between two published steps |

---

# Physics debug rendering and statistics

`physics-debug.ts` follows the engine's existing diagnostics modules exactly:
shapes and joints queue into the shared `DebugDraw` buffer
(`../diagnostics/debug-draw.ts`), and the solver's own numbers publish into
the shared counter registry (`../diagnostics/counters.ts`). Neither module is
physics-specific; this file only calls their existing public API.

```ts
import { drawPhysicsDebugScene3d, recordPhysicsStats3d } from "@vapour/engine";

const step = physics.step(dt);
drawPhysicsDebugScene3d(debugDraw, {
  bodies: myDebugBodies, // { id, bodyType, shape, position, rotation, sleeping }
  joints: myJointSpecs,
  contacts: physics.contacts(),
});
if (step.stats) recordPhysicsStats3d(diagnostics, step.stats, stepTimeMs);
```

Every collider draws as a wireframe **oriented bounding box** — a box (or,
for a compound, one box per child) transformed by the body's own position and
rotation. That is a deliberate simplification ("a wireframe or bounds-based
representation is fine, this is debug draw, not a full renderer"): every leaf
shape costs exactly 12 `line()` calls regardless of its actual geometry
(sphere, capsule, convex hull, mesh, heightfield all reduce to their local
bounding box), which is also what makes the primitive count for a known scene
exact and testable — `12 * leafShapes + joints + contacts`. Sleeping bodies
tint differently from awake ones (cyan vs. green; static geometry stays
white), a joint draws as one line between its two world-space anchors, and a
contact draws as one short line along its normal.

`recordPhysicsStats3d` publishes `PhysicsStats3d` — sourced straight from
Rust (`vapour-core`'s `PhysicsStats3d`, crossing the WASM boundary already
attached to every `step_json` result as `PhysicsStep3d.stats`) — as real
counters: body counts split by type (`dynamic`/`kinematic`/`fixed`) and by
sleep state (`awake`/`sleeping`), joint count, manifold and contact-pair and
contact-point counts, and, when the caller measured it, the step's own
wall-clock cost under the existing `physics.step` counter.

## API reference

| Export                        | Purpose                                                  |
| ------------------------------ | --------------------------------------------------------- |
| `drawColliderDebug3d`          | One body's collider as a wireframe OBB                    |
| `drawJointDebug3d`              | One joint as a line between its anchors                   |
| `drawContactDebug3d`            | One contact as a short marker along its normal            |
| `drawPhysicsDebugScene3d`       | All of the above for a whole scene                        |
| `recordPhysicsStats3d`         | Publishes a `PhysicsStats3d` into the counter registry     |
| `PHYSICS_DEBUG_COUNTERS`       | The counter names it uses                                  |

---

# Stress test: thousands of dynamic bodies

`physics-scale.perf.test.ts` spawns 2000 dynamic spheres over a static floor
on the real Rapier-backed `PhysicsWorld3dBridge` (via `native-test-world.ts`,
the same helper `vehicle-3d.test.ts` uses to run against the built WASM
artifact rather than a fake), steps 120 times, and asserts:

- no `NaN` or `Infinity` ever appears in any body's position, rotation, or
  velocity, across every step;
- the **average** per-step cost stays under a generous 40 ms budget;
- the **worst single** step stays under a much more generous 400 ms budget,
  separately from the average — following the pattern in
  `render-scale.perf.test.ts` and `net-scale.perf.test.ts`: a single step can
  spike from GC or OS scheduling noise with no regression behind it, so a
  tight bound on one measurement flakes for reasons that have nothing to do
  with physics.

A real run on this machine:

```
[physics-scale] 2000 dynamic bodies, 120 steps: 2.47 ms/step avg, 21.33 ms worst
```

Both numbers sit well inside their budgets — the loose bounds exist to catch
an order-of-magnitude regression on a loaded CI box, not to track day-to-day
performance, which is what the printed line is for.

## Vapour Script

The same API from Vapour Script — VS compiles to ESM and receives the same
engine objects as TypeScript, so nothing below is a binding layer.

```py
from "@vapour/engine" import createPhysicsWorld3d, rampWeight

export async func spawn_ball(restitution):
    var physics = await createPhysicsWorld3d()
    physics.defineMaterial({ name: "rubber", friction: 0.8, restitution: restitution, frictionCombine: "average", restitutionCombine: "max" })
    physics.insert({ id: 1, bodyType: "dynamic", position: [0, 5, 0], rotation: [0, 0, 0, 1], shape: { type: "sphere", radius: 0.3 }, material: "rubber" })
    return physics

export func ragdoll_weight(elapsed):
    return rampWeight(elapsed, 0.5)
```
