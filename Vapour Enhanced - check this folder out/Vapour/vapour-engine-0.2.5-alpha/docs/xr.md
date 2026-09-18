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

## Stereo presentation through WebGPU

`XrPresentation` (`packages/engine/src/render/xr-presentation.ts`) drives the
real render host once per eye against the WebXR/WebGPU binding. The renderer
draws into its own canvas, so presenting a headset frame is: lay the eyes out
side by side in that canvas at their compositor sizes, submit each eye as a
render layer — the eye's world transform from `XrRig`, its *asymmetric*
projection, and its rectangle — render, and copy each rectangle into the
eye's `XRGPUSubImage` (`getViewSubImage` per view).

Two modes, chosen by `probeXrPresentation`, which asks the binding for a
`texture-array` projection layer:

- **multiview** — accepted: both eyes go to the renderer in **one**
  submission of two layers and one frame, and each eye is copied into its
  array slice (`imageIndex`).
- **two-pass** — refused: a `texture` layer; each eye is its own submission
  and frame, copied into its viewport of the shared side-by-side texture.

The renderer culls and lights each eye with its own frustum and uniforms in
both modes; multiview here means one submission and one command stream, not
a WGSL view-index extension (no browser exposes one to WebGPU yet).

Two details the wiring depends on:

- **Depth range.** `XRView.projectionMatrix` maps depth to [-1, 1]; the Rust
  renderer expects WebGPU's [0, 1]. Every eye's projection is rewritten
  (`projectionToWebGpuDepth`) and travels as an explicit per-layer matrix
  (`RenderLayerOptions.projection`, flag `RENDER_LAYER_HAS_PROJECTION`),
  which `SurfaceRenderer` uses for the view-projection and the culling
  planes. The camera record still carries the field of view, near, and far
  the matrix encodes (`projectionExtent`) because shadow cascades size
  themselves from those.
- **Canvas size.** Copies are pixel for pixel, so the presenter pins the
  host's drawing buffer to the eye layout (`WebGpuRenderHost.setFixedSize`)
  the first time it sees the sub-image sizes and whenever they change.

### Wiring a session

```ts
const host = new WebGpuRenderHost(canvas);
await host.initialize();
const rig = new XrRig({ referenceSpace: "local-floor" });

// After the XR session starts (see XrSessionManager): the binding needs an
// xr-compatible device of its own, which is also the copy destination.
const adapter = await navigator.gpu.requestAdapter({ xrCompatible: true });
const device = await adapter.requestDevice();
const binding = new XRGPUBinding(session, device);
const presentation = new XrPresentation({
  host,
  binding,
  session,
  copy: canvasSubImageCopier(device, canvas),
});

// Every XR frame: resolve the rig, then present the scene per eye.
session.requestAnimationFrame(function onFrame(time, frame) {
  const viewer = frame.getViewerPose(space);
  if (viewer !== null) {
    const rigFrame = rig.resolve(snapshot);         // XrFrameSnapshot from XrSessionManager
    const result = presentation.present(viewer.views, rigFrame, world.pack(), time);
    // result.mode, result.submissions (1 or 2), result.eyes[i].textureRect
  }
  session.requestAnimationFrame(onFrame);
});
```

`XrSessionManager`'s own `webGpuPresentation` option is the clear-only
compositor from before this work and stays as a smoke test for the binding;
a game that renders uses `XrPresentation` instead.

Tested without a headset: `xr-presentation.test.ts` drives a
`HeadlessRenderHost` against a fake `XRGPUBinding` and asserts that two eyes
produce two submissions with different camera transforms (64 mm apart) and
the correct viewports ([0, 0, 0.5, 1] and [0.5, 0, 0.5, 1] of a 3664×1920
canvas, copied into `x = 0` and `x = 1832` of the texture), and that the
multiview flag produces one submission of two layers copied into slices 0 and
1. What it cannot prove is the compositor's acceptance of a real frame; that
remains a hardware gate.

## Current boundary

The session, tracking, and presentation layers work. The following are not
complete yet:

- foveation and headset-specific performance controls;
- grab, ray, teleport, snap/smooth turn, and world-space UI interactors;
- controller model loading and fallback meshes;
- editor headset preview, tracking visualization, and XR profiler counters;
- a browser/headset integration test on real XR hardware, including the
  compositor accepting `XrPresentation`'s frames.

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
| `XrPresentation` | `present(views, rigFrame, frame, time)` per XR frame; `mode` |
| `probeXrPresentation`, `canvasSubImageCopier` | Multiview probe; the default canvas → sub-image copy |

## Vapour Script

The same API from Vapour Script — VS compiles to ESM and receives the same
engine objects as TypeScript, so nothing below is a binding layer.

```py
from "@vapour/engine" import XrRig, HandPoseRecognizer, XrHaptics

export class Player:
    func constructor(pulse):
        self.rig = new XrRig({ referenceSpace: "local-floor", mode: "standing" })
        self.poses = new HandPoseRecognizer()
        self.haptics = new XrHaptics(pulse)

    func frame(snapshot):
        var cameras = self.rig.resolve(snapshot)
        for source in snapshot.inputs:
            if source.joints.length > 0:
                var state = self.poses.update(source)
                if state.pose == "pinch":
                    self.haptics.pulse(source.handedness, 0.3, 10)
        return cameras.eyes
```
