# WebXR runtime

`XrSessionManager` owns browser WebXR session and reference-space lifecycle and
converts browser frame objects into renderer-neutral typed snapshots. VS and
TypeScript consume the same API.

```ts
const xr = new XrSessionManager();
if (await xr.supported("immersive-vr")) {
  // Call from a click/tap handler. Browsers require a user gesture.
  await xr.start({
    mode: "immersive-vr",
    referenceSpace: "local-floor",
    optionalFeatures: ["hand-tracking", "bounded-floor"],
  });
  xr.startFrameLoop(frame => updateXrGame(frame));
}
```

## Frame data

Every `XrFrameSnapshot` contains:

- viewer transform and visibility state;
- one or more views with eye, transform, and projection matrix;
- input-source handedness and target-ray mode;
- target-ray and grip transforms when tracked;
- controller button values, pressed/touched state, and axes;
- named hand-joint transforms and radii when hand tracking is available.
- ordered WebXR controller profiles for model/binding selection.

Matrices and axes are copied into typed arrays. This removes browser-owned
object lifetimes from gameplay code and creates a stable batch boundary for the
Rust/WASM renderer. Invalid matrix lengths and non-finite controller values are
reported immediately.

## Session behavior

The manager checks mode support before requesting a session, provides detailed
secure-context/headset/user-gesture diagnostics, ends a partially created
session when reference-space acquisition fails, prevents duplicate frame loops,
and handles sessions ended by the browser or headset.

Controller haptics are available through `pulse(handedness, intensity,
durationMs)` with WebXR actuator and dual-rumble support. See
`xr-locomotion.md` for native swept-hand collision and arm-driven movement.

Supported modes are `inline`, `immersive-vr`, and `immersive-ar`. Reference
spaces include viewer, local, local-floor, bounded-floor, and unbounded.

## Current boundary

The session and tracking layer works. The following are not complete yet:

- binding a WebGPU-compatible XR swapchain/layer;
- submitting each XR view through the Rust render graph;
- multiview/single-pass stereo capability paths;
- foveation and headset-specific performance controls;
- grab, ray, teleport, snap/smooth turn, and world-space UI interactors;
- controller model loading and fallback meshes;
- editor headset preview, tracking visualization, and XR profiler counters;
- a browser/headset integration test on real XR hardware.

Do not claim a production VR renderer until those gates are implemented and
verified on hardware. Non-XR games remain usable when WebXR is unavailable.

---

# XR interaction and locomotion (Alpha 0.2.5)

Game developers should not have to build standard VR interaction themselves —
and the reason is that the standard behaviours are **subtle**. Ray-pointing that
jitters, a grab that teleports objects, a snap turn with no blink, and smooth
locomotion that ignores head orientation are not stylistic choices; they are the
difference between a comfortable experience and one that makes people ill.

Everything here is pure state and maths over injected poses, so it runs and is
tested without a headset. The parts that genuinely need hardware — stereo
presentation, foveation — are **not** here and are not claimed.

## Rays are cones

```ts
const hit = raycastTargets(controllerPose, targets, { softness: 0.035, maxDistance: 10 });
```

A mathematically thin ray is unusable in VR. Hand tremor is roughly a degree, so
a thin ray flickers between targets and off them entirely. `softness` widens the
ray into a cone that grows with distance, so a distant target is as easy to hit
as a near one of the same apparent size. Every shipped VR interface does this.

Targets are **spheres, not meshes**: a pointer needs to be forgiving, and precise
mesh intersection makes small controls nearly impossible to hit.

## Grabbing

```ts
const grab = new XrGrabController();
grab.grabDirect("right", handPose, grabbables);        // reach out and take it
grab.grabByRay("left", controllerPose, targets);       // pull from a distance

const target = grab.resolve("right", handPose);        // where it should be now
```

`resolve` returns a **position**, not a movement, so the caller decides whether
to snap an object there (a UI panel) or drive it with physics (a crate). Ray
grabs keep the object at its captured distance — that is what makes a distant
object feel attached to the pointer rather than reeled in the moment it is
grabbed.

### Two hands

```ts
const transform = grab.resolveTwoHanded(leftPose, rightPose);
// { position, scale, yaw } — midpoint, separation change, and angle change
```

Two-handed manipulation is included because pulling your hands apart to make
something bigger is a gesture people try **unprompted**, and because retrofitting
it means changing how single-handed grabs store their offsets.

## Locomotion

```ts
const locomotion = new XrLocomotion({ turnStyle: "snap", snapDegrees: 30, comfortFadeSeconds: 0.1 });
const { position, yaw, fade } = locomotion.update({ moveX, moveY, turnX }, headForward, deltaSeconds);
```

**Snap turning is the default.** Smooth turning is the single most common cause
of simulator sickness. Both are offered rather than chosen for the player.

**The blink is what keeps even a snap comfortable.** The turn or teleport lands
at the *midpoint* of the fade, so the player never sees the world move. Turn
input is read before the fade advances, so the snap and its blink begin on the
same frame — advancing the fade first delays it by a frame, which reads as the
world turning slightly before the blink covers it.

**Movement follows the head**, flattened to the ground plane. Ignoring head
orientation is the other classic comfort failure; so is letting a downward gaze
sink the player.

Snap turns fire once per push, because a held stick that snapped every frame
would spin the player.

## Teleport arcs

```ts
const arc = teleportArc(controllerPose, (point) => navmesh.isWalkable(point), (x, z) => ground.heightAt(x, z));
if (arc.valid) drawValidArc(arc.points); else drawInvalidArc(arc.points);
```

An arc rather than a straight ray, because it lets a player aim at the floor
without pointing straight down — and because **seeing the landing point before
committing is what makes teleport comfortable in the first place**. An invalid
arc still returns its points, so it can be drawn in red rather than vanishing.

Validity is an injected predicate, so a navmesh, a physics raycast, or a simple
height test all work. Using `navmesh.isWalkable` means the player cannot
teleport onto a ledge an agent could not stand on.

## API reference

| Export | Purpose |
| ------ | ------- |
| `raycastTargets` | Cone-widened ray against sphere targets, with priority |
| `XrGrabController` | `grabDirect`, `grabByRay`, `resolve`, `resolveTwoHanded`, `release` |
| `XrLocomotion` | `update`, `teleport`, `setPosition`, `position`, `yaw`, `fade` |
| `teleportArc` | Ballistic arc with injected ground and validity |
