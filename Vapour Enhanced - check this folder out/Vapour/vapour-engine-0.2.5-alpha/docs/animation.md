# Animation

Clips target bones **by name**, not by index. That single choice is what lets
one walk cycle play on every character `@vapour/assetgen` produces, and what
makes retargeting between skeletons possible at all. A clip bound to bone
indices only works on the exact skeleton it was authored against.

Time is explicit throughout: the game calls `update(deltaSeconds)`, so animation
pauses with the game, follows slow motion, and reproduces exactly in a replay or
on a server tick.

## Clips

A clip is plain data — channels of keyframes — so it serializes into scene JSON,
imports from glTF without translation, and can be generated procedurally.

```ts
import { samplePose, validateClip, type AnimationClip } from "@vapour/engine";

const wave: AnimationClip = {
  name: "wave",
  duration: 1,
  loop: "loop",
  channels: [
    {
      target: "RightUpperArm",
      property: "rotation",
      keyframes: [
        { time: 0, value: [0, 0, 0, 1] },
        { time: 0.5, value: [0, 0, 0.7071068, 0.7071068] },
        { time: 1, value: [0, 0, 0, 1] },
      ],
    },
  ],
};
```

Rotations interpolate on the sphere. A component-wise lerp of quaternions
produces a non-unit rotation that shears the mesh, so `sampleChannel` uses
`nlerp` for rotation channels and linear interpolation for everything else.

`missingTargets(clip, boneNames)` reports bones a clip drives that a skeleton
does not have. A clip silently doing nothing because its names do not match is
one of the hardest animation bugs to notice, so it is worth checking at load.

## The animator

```ts
import { Animator } from "@vapour/engine";

const animator = new Animator();
animator.play(walk, { fadeSeconds: 0.2 });

// each frame
const pose = animator.update(deltaSeconds);
```

Playing the clip already playing is a **no-op, not a restart**. Gameplay code
calls `play("walk")` every frame while walking, and restarting on each call is
the classic way to make a character twitch. Pass `{ restart: true }` when you
mean it.

### Layers and masks

Each layer produces a full pose and blends over the one below by weight and
mask. An "aim" layer masked to the spine and arms plays over a locomotion base
without disturbing the legs:

```ts
const upper = animator.addLayer({
  name: "upper",
  weight: 1,
  mask: ["Chest", "RightUpperArm", "RightLowerArm", "RightHand"],
});
upper.play(aimClip);
```

Blending takes a bone present in only one pose **unchanged** rather than
blending it toward an implicit identity — that is how a partially-authored clip
would otherwise yank a character's arms to its sides.

### State machines

Transitions fire on conditions over named parameters, so gameplay sets `speed`
and `grounded` and never touches a clip name:

```ts
animator.setStateMachine({
  initial: "idle",
  states: [
    {
      name: "idle",
      clip: idle,
      transitions: [
        {
          to: "walk",
          conditions: [{ parameter: "speed", operator: ">", value: 0.1 }],
        },
      ],
    },
    {
      name: "walk",
      clip: walk,
      transitions: [
        {
          to: "idle",
          conditions: [{ parameter: "speed", operator: "<=", value: 0.1 }],
        },
      ],
    },
    { name: "jump", clip: jump },
  ],
  anyStateTransitions: [
    {
      to: "jump",
      conditions: [{ parameter: "grounded", operator: "==", value: false }],
    },
  ],
});

animator.setParameter("speed", velocity.length());
```

A missing parameter simply does not match, rather than throwing mid-frame.
`anyStateTransitions` cover interrupts like death or stagger.

### Blend trees

Blend trees turn continuous gameplay values into animation instead of forcing
scripts to switch clips at arbitrary thresholds. A one-dimensional tree blends
the two neighboring samples and clamps outside its authored range:

```ts
const locomotion = {
  type: "1d" as const,
  parameter: "speed",
  children: [
    { threshold: 0, clip: idle },
    { threshold: 2, clip: walk },
    { threshold: 7, clip: run, speed: 1.15 },
  ],
};

animator.setStateMachine({
  initial: "locomotion",
  states: [{ name: "locomotion", blendTree: locomotion }],
});
```

Two-dimensional freeform trees use inverse-distance weights for planar
velocity or aim direction. Exact authored positions select exactly one child,
so an idle sample at `[0, 0]` cannot leak motion. Child speeds are independent;
the state speed scales the whole tree. Trees validate clips, numeric parameters,
strictly ordered 1D thresholds, unique 2D positions, and finite coordinates
before evaluation. `sampleBlendTree` is also public for procedural systems that
do not need an `Animator` state machine.

## Skinning

```ts
import { skinningMatrices, unpackMatrices } from "@vapour/engine";

const inverseBind = unpackMatrices(character.skin.inverseBind);
const matrices = skinningMatrices(character.skeleton, pose, inverseBind);
```

Three steps, and the order matters:

1. **Local** — the pose overrides parts of each bone's rest transform.
2. **Model** — locals accumulate down the hierarchy in one forward pass.
3. **Skinning** — model times inverse-bind, which is what the shader wants.

Skipping step 3 and uploading model matrices is the single most common skinning
bug: the mesh explodes outward, because every vertex gets its bone's full
transform applied on top of where it already is. The test suite asserts that a
bind pose produces identity matrices, which catches it immediately.

The skeleton type is **structural**, not a concrete class — anything with named
bones, parent indices, and rest transforms qualifies. A character from
`@vapour/assetgen`, from glTF, or from a game's own code all skin through the
same path with no adapter.

### Root motion

```ts
const delta = rootMotionDelta(skeleton, previousPose, pose);
controller.move(delta);
stripRootMotion(skeleton, pose); // animate in place
```

Extract it and let the _character controller_ move the character. A clip that
moves the root and a controller that also moves the character produce a
character travelling at twice the intended speed. `stripRootMotion` keeps
vertical motion, because a jump's arc is animation rather than locomotion.

## IK

Animation alone cannot make feet meet uneven ground or hands meet a specific
object, because the clip was authored without knowing where either would be.

```ts
const result = solveTwoBoneIk({
  root: hip,
  mid: knee,
  tip: foot,
  target: groundPoint,
  pole: kneeHint,
});
const look = solveLookAt({
  position: head,
  target: player,
  maxAngleDegrees: 70,
});
```

**Two-bone IK** is solved analytically by the law of cosines — a limb is two
bones and a hinge, and the closed form is exact, instant, and free of iteration
artefacts. Out-of-reach targets straighten the limb and point at them, which
reads as reaching rather than as a solver failure (`result.stretched` says so).

The `pole` matters more than it looks: without it, a nearly straight limb has
infinitely many valid solutions and the solver picks an arbitrary one, which
shows up in play as a knee snapping sideways.

**Look-at** clamps beyond `maxAngleDegrees` by scaling the rotation toward
identity rather than clamping the direction, so motion stays smooth as the limit
is approached — and heads stay on necks.

### Runtime retargeting

`buildRetargetMap(source, target)` matches exact bone names and common exporter
prefixes such as `mixamorig:`. Supply `boneMap` for semantic differences such
as `Pelvis` to `Hips`; an explicit mapping to a missing bone is an error rather
than a silently frozen limb. The result reports unmapped source and target
bones so import tools and agents can make coverage visible.

`retargetPose` transfers local rotation and scale while preserving each target
bone's rest translation. Animated translation is treated as an offset from the
source rest pose and scaled by source/target bone length, allowing one walk or
reach animation to run on characters with different proportions. Pass
`scaleTranslation: false` for rigs already authored at a shared scale. The
source pose is never mutated and an `into` pose can be reused each frame.

## API reference

| Module       | Exports                                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clip`       | `validateClip`, `samplePose`, `sampleChannel`, `wrapClipTime`, `blendPoses`, `maskPose`, `poseClip`, `clipTargets`, `missingTargets`, and the `AnimationClip`/`Pose` types |
| `animator`   | `Animator`, `AnimatorLayer`, and the state-machine types                                                                                                                   |
| `blend-tree` | `validateBlendTree`, `sampleBlendTree`, `blendTreeDuration`, and 1D/2D tree types                                                                                          |
| `skinning`   | `poseMatrices`, `skinningMatrices`, `bonePositions`, `unpackMatrices`, `rootMotionDelta`, `stripRootMotion`, `validateSkinnedSkeleton`, `SkinnedSkeleton`                  |
| `ik`         | `solveTwoBoneIk`, `solveLookAt`                                                                                                                                            |
| `retarget`   | `buildRetargetMap`, `retargetPose`, `canonicalBoneName`, and mapping diagnostics                                                                                          |

## Performance considerations

- `samplePose` binary-searches each channel, so clips with hundreds of keyframes
  cost the same per frame as short ones.
- Poses are `Map`s reused across frames by the animator; `blendPoses` and
  `maskPose` accept an `into` map so a per-frame blend need not allocate.
- `skinningMatrices` accepts a caller-supplied `Float32Array`, so the buffer
  uploaded to the GPU can be allocated once per character.
- Layers cost one full pose evaluation each. Two or three is normal; a dozen is
  a design smell.

## Multiplayer considerations

Animation is presentation and should generally **not** be replicated. Replicate
the _parameters_ — `speed`, `grounded`, a state id — and let each client's
animator derive the pose. Because `update` is deterministic given the same
deltas and parameters, clients agree without any pose traffic.

Root motion is the exception: if animation drives movement, the server must own
it, or clients will disagree about where a character actually is.

## XR considerations

An avatar's head and hands are driven by tracked poses, not by clips. Use a
masked layer for the body's locomotion and drive the arms with `solveTwoBoneIk`
toward the tracked controller positions, with `solveLookAt` on the head. Clamp
the look-at, or a player turning their head produces an avatar that looks
broken to everyone else.

## Vapour Script

The same API from Vapour Script — VS compiles to ESM and receives the same
engine objects as TypeScript, so nothing below is a binding layer.

```py
from "@vapour/engine" import samplePose, blendPoses

export func crossfade(walk, run, time, weight):
    var a = samplePose(walk, time)
    var b = samplePose(run, time)
    return blendPoses(a, b, weight)
```
