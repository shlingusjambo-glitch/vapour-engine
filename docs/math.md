# Math

`@vapour/math` holds the linear algebra, easing, curve, gradient, colour, and
geometry primitives every other Vapour subsystem is built on. Before Mirage this
code was duplicated across the renderer, the editor, and the Rust transform
layer; it now has one home.

## Concept

Everything is **plain data on numeric tuples and plain objects**. There are no
wrapper classes and no hidden state, so a value produced here serializes into
scene JSON, crosses the WASM boundary, transfers to a worker, and packs into a
typed array with no adapters.

Conventions the rest of the engine relies on:

| Convention | Value |
| ---------- | ----- |
| Vectors | `[x, y, z]` tuples |
| Quaternions | `[x, y, z, w]`, unit length |
| Matrices | column-major, flat 16-element arrays (element `[col * 4 + row]`), matching WGSL's `mat4x4<f32>` and glTF node matrices |
| Handedness | right-handed, `+Y` up, `-Z` forward |
| Clip depth | WebGPU's `[0, 1]` range, not OpenGL's `[-1, 1]` |
| Euler order | intrinsic Y→X→Z (yaw, pitch, roll), in degrees |
| Colour | authored in sRGB, converted to linear before lighting |

Invalid input **throws with an actionable message** rather than propagating
`NaN`. A zero-length vector cannot be normalized, a singular matrix cannot be
inverted, and a curve cannot have two keys at the same time — each of those is a
bug at the call site, and silently returning a plausible number hides it until
it surfaces somewhere much harder to diagnose.

## Setup

`@vapour/math` is a dependency of `@vapour/engine`, so it is already present in
any Vapour project. Import it directly:

```ts
import { compose, quatFromEuler, frustumFromViewProjection } from "@vapour/math";
```

## Basic example

```ts
import { compose, quatFromEuler, transformPoint } from "@vapour/math";

const model = compose([0, 1, 0], quatFromEuler([0, 45, 0]), [2, 2, 2]);
const worldPoint = transformPoint(model, [1, 0, 0]);
```

## Typical usage

Culling a list of objects against a camera:

```ts
import { frustumFromViewProjection, frustumIntersectsAabb, multiplyMat4, lookAt, perspective, transformAabb } from "@vapour/math";

const viewProjection = multiplyMat4(perspective(60, width / height, 0.1, 1000), lookAt(eye, target));
const frustum = frustumFromViewProjection(viewProjection);

const visible = objects.filter((object) => frustumIntersectsAabb(frustum, transformAabb(object.localBounds, object.worldMatrix)));
```

Driving a value over time with a curve and an easing:

```ts
import { curve, easing, evaluateCurve } from "@vapour/math";

const falloff = curve([
  { time: 0, value: 1 },
  { time: 10, value: 0 },
], { interpolation: "cubic" });

const volume = evaluateCurve(falloff, distance);
const fade = easing("outCubic")(elapsed / duration);
```

### Vapour Script

```vapour
use math

fn update(dt: f32) {
  let eased = math.easing("outCubic")(self.t)
  self.transform.position = math.lerpVec3(self.from, self.to, eased)
}
```

## Advanced usage

**Damped follow.** `smoothDamp` is a critically damped spring: frame-rate
independent and overshoot-free, which is what camera follow and aim smoothing
actually want. A per-frame `lerp` is neither.

```ts
import { smoothDamp } from "@vapour/math";

const state = { velocity: 0 };
height = smoothDamp(height, targetHeight, state, 0.2, deltaTime);
```

**Normals under non-uniform scale.** `transformDirection` is wrong for normals
when scale is non-uniform. Use `normalMatrix`, which is the inverse-transpose of
the upper-left 3x3.

**Mirrored transforms.** `decompose` folds a negative determinant into a
negative X scale, because a quaternion cannot express a mirror. This is what
makes `compose(decompose(m))` round-trip for mirrored matrices.

**Gradients** keep colour and alpha keys on independent schedules, matching how
particle systems author fades and how Unity and Unreal effect descriptions map
in. `sampleGradient` bakes one into an RGBA8 strip ready to upload as a lookup
texture.

## API reference

| Module | Exports |
| ------ | ------- |
| `scalar` | `clamp`, `saturate`, `lerp`, `lerpClamped`, `inverseLerp`, `remap`, `smoothStep`, `smootherStep`, `moveTowards`, `repeat`, `pingPong`, `wrapAngle`, `deltaAngle`, `lerpAngle`, `degToRad`, `radToDeg`, `approximately`, `round`, `nextPowerOfTwo`, `isPowerOfTwo`, `smoothDamp`, `DEG_TO_RAD`, `RAD_TO_DEG`, `TAU`, `EPSILON` |
| `vec2` | `vec2`, `toVec2`, `add2`, `subtract2`, `multiply2`, `scale2`, `negate2`, `dot2`, `cross2`, `length2`, `lengthSquared2`, `distance2`, `distanceSquared2`, `normalize2`, `normalizeOr2`, `lerpVec2`, `minVec2`, `maxVec2`, `clampVec2`, `clampLength2`, `rotate2`, `perpendicular2`, `signedAngle2`, `equalsVec2` |
| `vec3` | `vec3`, `toVec3`, `add`, `subtract`, `multiply`, `scale`, `negate`, `dot`, `cross`, `length`, `lengthSquared`, `distance`, `distanceSquared`, `normalize`, `normalizeOr`, `lerpVec3`, `minVec3`, `maxVec3`, `clampVec3`, `clampLength`, `moveTowardsVec3`, `project`, `projectOnPlane`, `reflect`, `angleBetween`, `equalsVec3`, `orthogonal`, plus `VEC3_*` constants |
| `vec4` | `vec4`, `toVec4`, `add4`, `subtract4`, `scale4`, `dot4`, `length4`, `normalize4`, `lerpVec4`, `clampVec4`, `equalsVec4` |
| `quat` | `quat`, `toQuat`, `normalizeQuat`, `multiplyQuat`, `invertQuat`, `conjugateQuat`, `dotQuat`, `quatFromAxisAngle`, `quatFromEuler`, `eulerFromQuat`, `rotateVector`, `nlerp`, `slerp`, `quatFromTo`, `quatLookRotation`, `quatFromBasis`, `angleBetweenQuat`, `rotateTowards`, `equalsQuat`, `QUAT_IDENTITY` |
| `mat4` | `identity`, `toMat4`, `multiplyMat4`, `transpose`, `fromTranslation`, `fromScale`, `fromQuat`, `compose`, `decompose`, `determinant`, `invert`, `transformPoint`, `transformDirection`, `normalMatrix`, `lookAt`, `perspective`, `orthographic`, `equalsMat4`, `MAT4_IDENTITY` |
| `geometry` | `aabb`, `emptyAabb`, `isEmptyAabb`, `aabbFromCenterExtents`, `aabbFromPoints`, `expandAabb`, `unionAabb`, `aabbCenter`, `aabbHalfExtents`, `aabbContainsPoint`, `aabbIntersects`, `closestPointOnAabb`, `transformAabb`, `sphere`, `sphereFromAabb`, `sphereIntersects`, `sphereIntersectsAabb`, `plane`, `planeFromPointNormal`, `planeDistanceToPoint`, `ray`, `rayPoint`, `rayIntersectsAabb`, `rayIntersectsSphere`, `rayIntersectsPlane`, `frustumFromViewProjection`, `frustumIntersectsAabb`, `frustumIntersectsSphere`, `frustumContainsPoint` |
| `easing` | `EASINGS`, `EASING_NAMES`, `easing`, `isEasingName`, `cubicBezierEasing` |
| `curve` | `curve`, `constantCurve`, `linearCurve`, `curveDuration`, `evaluateCurve`, `sampleCurve`, `curveRange` |
| `gradient` | `gradient`, `gradientBetween`, `evaluateGradient`, `sampleGradient` |
| `color` | `rgba`, `toRgba`, `rgbaFromHex`, `rgbaToHex`, `srgbToLinear`, `linearToSrgb`, `srgbToLinearChannel`, `linearToSrgbChannel`, `lerpColor`, `premultiply`, `luminance`, `rgbaFromHsv`, plus `COLOR_*` constants |

## Performance considerations

- Every function returns a **fresh tuple**. In a per-frame loop over thousands
  of objects that allocation shows up in GC time; hoist results out of the loop,
  or work on a typed array directly.
- Prefer the squared variants (`lengthSquared`, `distanceSquared`,
  `distanceSquared2`) for comparisons — they skip a square root.
- `frustumIntersectsAabb` tests only the corner furthest along each plane
  normal, so it is six dot products, not eight corner transforms. Cull with a
  sphere first when objects are cheap to bound and expensive to box.
- `sampleCurve` and `sampleGradient` exist for hot paths: bake once, then index,
  instead of running a binary search per particle per frame.
- `slerp` falls back to `nlerp` when the arc is nearly zero, which is both
  faster and numerically stabler; animation blending should prefer `nlerp`
  outright for the small per-frame deltas it produces.

## Multiplayer considerations

Tuples and plain objects serialize directly into snapshots. Quaternions should
be sent normalized and may be compressed to three components plus a sign bit,
since `w` is recoverable; `normalizeQuat` on receipt absorbs the quantization
error. Note that `q` and `-q` are the same rotation — `equalsQuat` accounts for
this, and a naive component-wise comparison will report false deltas.

## XR considerations

XR poses arrive as `DOMPointReadOnly` positions and orientations plus a
column-major `Float32Array` matrix. That matrix layout matches `Mat4` exactly,
so `decompose` accepts it without conversion.
