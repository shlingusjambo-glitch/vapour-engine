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
