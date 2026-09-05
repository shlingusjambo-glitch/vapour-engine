# XR locomotion and contact physics

Alpha 0.2.1 provides engine-level primitives for arm-driven locomotion without
hardcoding a particular game. The design was checked against Another Axiom's
MIT-licensed public Gorilla Locomotion reference implementation:
<https://github.com/Another-Axiom/GorillaLocomotion>.

The reference exposed requirements that a generic character controller alone
does not satisfy: constrained arm reach, swept hand volumes, projected sliding,
thin-geometry anti-tunneling, different surface grip, two-hand bracing, hand
unsticking, rolling velocity history, and bounded release impulses.

## Physics contact resolution

`XrHandCollisionResolver` runs against `PhysicsWorld3dBridge`, so all collision
queries remain in Vapour's Rust/Rapier physics world. It provides:

- swept-sphere hand collision instead of point or overlap-only tests;
- a second sweep along the collision plane;
- a ray fallback for thin geometry;
- collision layers, masks, and sensor control;
- per-body surface slip through `surfaceSlip(bodyId)`;
- safe hand-unsticking corridor tests.

```ts
const contacts = new XrHandCollisionResolver(physics, {
  mask: CLIMBABLE_WORLD,
  surfaceSlip(bodyId) {
    return surfaceMaterials.get(bodyId)?.slip;
  },
});

const left = contacts.resolve(previousLeft, trackedLeftDelta, 0.055, false);
```

Slip is a normalized value. `0` means maximum grip and `1` permits the complete
tangential remainder. Invalid normals, masks, radii, body IDs, and slip values
throw contextual errors at the call site.

## Arm locomotion

`XrArmLocomotionSolver` consumes tracked head/hands plus contact results. It
clamps hands to a configurable arm length, averages braced two-hand motion,
applies gravity without support, limits tracking spikes, maintains a velocity
history, and produces a bounded release velocity.

`XrPhysicsRig` passes the resulting translation through Vapour's native
character controller. Terrain, triangle meshes, slopes, autostep, collision
layers, and dynamic body filtering therefore behave consistently between
ordinary characters and XR rigs.

The solver does not decide which surfaces are climbable, play sounds, score
movement, or define a player avatar. Those remain game systems built on the
contact IDs and results.

## Controller feedback

`XrSessionManager.pulse(hand, intensity, durationMs)` supports both WebXR haptic
actuators and dual-rumble implementations. It returns `false` when no matching
actuator exists. Profiles such as `oculus-touch-v3` are included in each input
snapshot so games can select correct models and bindings without user-agent
sniffing.

## Vapour Script

VS imports the exact same engine classes. There is no reduced scripting-only
physics implementation:

```vs
from "@vapour/engine" import XrArmLocomotionSolver

var locomotion = XrArmLocomotionSolver({
    "maxArmLength": 1.5,
    "maxSpeed": 9.0,
    "maxLaunchSpeed": 7.0
})

export func reset_player():
    locomotion.reset()
```

Object keys currently use the TypeScript API spelling (`maxArmLength`, etc.) in
executable VS. Snake-case aliases are planned but must not be documented as
working until the compiler/runtime implements them.

## Quest acceptance requirements

Desktop tests validate deterministic math and physics-query ordering. A release
claim for Quest additionally requires testing on a physical Quest 2 through
Meta Browser: tracking loss, boundary changes, 72 Hz frame pacing, controller
profiles, haptics, audio unlock, suspend/resume, and repeated session entry/exit.
The engine must never claim headset verification based on an emulator alone.
