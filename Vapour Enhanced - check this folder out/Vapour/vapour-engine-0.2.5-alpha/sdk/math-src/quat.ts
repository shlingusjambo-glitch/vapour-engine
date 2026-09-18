/** Quaternion rotation maths.
 *
 * Vapour stores rotations as `[x, y, z, w]` unit quaternions everywhere — scene
 * JSON, the WASM boundary, and animation clips — because they compose and
 * interpolate without gimbal lock. Euler conversion uses the intrinsic Y→X→Z
 * (yaw, pitch, roll) order the editor inspector presents, matching what Unity
 * and Godot show so imported content and tutorials line up.
 */
import { clamp, EPSILON, RAD_TO_DEG } from "./scalar.js";
import type { Vec3, Vec3Like } from "./vec3.js";

export type Quat = [number, number, number, number];
export type QuatLike = readonly number[];
/** Euler angles in degrees, ordered `[pitch, yaw, roll]` (X, Y, Z). */
export type EulerDegrees = [number, number, number];

export const QUAT_IDENTITY: Quat = [0, 0, 0, 1];

export function quat(x = 0, y = 0, z = 0, w = 1): Quat {
  return [x, y, z, w];
}

/** Validates and renormalizes; rejects the zero quaternion, which has no rotation. */
export function toQuat(value: QuatLike, label = "A quaternion"): Quat {
  if (value.length < 4) throw new Error(`${label} requires four components.`);
  const out: Quat = [value[0]!, value[1]!, value[2]!, value[3]!];
  if (out.some((component) => !Number.isFinite(component))) throw new Error(`${label} requires finite components.`);
  return normalizeQuat(out);
}

export function normalizeQuat(value: QuatLike): Quat {
  const magnitude = Math.hypot(value[0]!, value[1]!, value[2]!, value[3]!);
  if (magnitude < 1e-8) throw new Error("A rotation cannot be the zero quaternion.");
  return [value[0]! / magnitude, value[1]! / magnitude, value[2]! / magnitude, value[3]! / magnitude];
}

/** Hamilton product: applies `b` first, then `a`. */
export function multiplyQuat(a: QuatLike, b: QuatLike): Quat {
  const [ax, ay, az, aw] = [a[0]!, a[1]!, a[2]!, a[3]!];
  const [bx, by, bz, bw] = [b[0]!, b[1]!, b[2]!, b[3]!];
  return normalizeQuat([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

/** Inverse of a unit quaternion, which is simply its conjugate. */
export function invertQuat(value: QuatLike): Quat {
  const [x, y, z, w] = normalizeQuat(value);
  return [-x, -y, -z, w];
}

export function conjugateQuat(value: QuatLike): Quat {
  return [-value[0]!, -value[1]!, -value[2]!, value[3]!];
}

export function dotQuat(a: QuatLike, b: QuatLike): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
}

export function quatFromAxisAngle(axis: Vec3Like, radians: number): Quat {
  const magnitude = Math.hypot(axis[0]!, axis[1]!, axis[2]!);
  if (magnitude < EPSILON) throw new Error("A rotation axis cannot be zero-length.");
  const half = radians / 2;
  const sin = Math.sin(half) / magnitude;
  return normalizeQuat([axis[0]! * sin, axis[1]! * sin, axis[2]! * sin, Math.cos(half)]);
}

export function quatFromEuler(euler: readonly number[]): Quat {
  if (euler.length < 3 || euler.some((angle) => !Number.isFinite(angle))) throw new Error("Euler angles must be three finite numbers.");
  // Written as (deg * PI) / 180 / 2 rather than deg * (PI / 180) / 2: the two
  // differ in the last bit, and committed scene JSON is compared exactly.
  const half = (degrees: number): number => (degrees * Math.PI) / 180 / 2;
  const [x, y, z] = [half(euler[0]!), half(euler[1]!), half(euler[2]!)];
  const [sx, cx] = [Math.sin(x), Math.cos(x)];
  const [sy, cy] = [Math.sin(y), Math.cos(y)];
  const [sz, cz] = [Math.sin(z), Math.cos(z)];
  return normalizeQuat([
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ]);
}

export function eulerFromQuat(value: QuatLike): EulerDegrees {
  const [x, y, z, w] = normalizeQuat(value);
  // sin(pitch) from the rotation matrix's m12 term, clamped so a straight-up
  // orientation degrades to a gimbal-locked solution instead of NaN.
  const sinPitch = clamp(2 * (w * x - y * z), -1, 1);
  const pitch = Math.asin(sinPitch);
  const locked = Math.abs(sinPitch) > 1 - 1e-6;
  const yaw = locked
    ? Math.atan2(-2 * (x * z - w * y), 1 - 2 * (x * x + y * y))
    : Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
  const roll = locked ? 0 : Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z));
  return [pitch * RAD_TO_DEG, yaw * RAD_TO_DEG, roll * RAD_TO_DEG];
}

export function rotateVector(rotation: QuatLike, vector: Vec3Like): Vec3 {
  const [x, y, z, w] = normalizeQuat(rotation);
  const [vx, vy, vz] = [vector[0]!, vector[1]!, vector[2]!];
  // t = 2 * (q.xyz x v); v' = v + w * t + q.xyz x t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
}

/**
 * Normalized linear interpolation.
 *
 * Cheaper than {@link slerp} and indistinguishable for the small per-frame
 * deltas animation blending produces, which is why it is the default for
 * pose blending in the animation system.
 */
export function nlerp(a: QuatLike, b: QuatLike, t: number): Quat {
  const sign = dotQuat(a, b) < 0 ? -1 : 1;
  return normalizeQuat([
    a[0]! + (b[0]! * sign - a[0]!) * t,
    a[1]! + (b[1]! * sign - a[1]!) * t,
    a[2]! + (b[2]! * sign - a[2]!) * t,
    a[3]! + (b[3]! * sign - a[3]!) * t,
  ]);
}

/** Constant-angular-velocity interpolation along the shortest arc. */
export function slerp(a: QuatLike, b: QuatLike, t: number): Quat {
  const from = normalizeQuat(a);
  let to = normalizeQuat(b);
  let cosine = dotQuat(from, to);
  // Negate one end so we always travel the short way around the hypersphere.
  if (cosine < 0) {
    to = [-to[0], -to[1], -to[2], -to[3]];
    cosine = -cosine;
  }
  // Nearly parallel: slerp becomes numerically unstable, and nlerp is exact enough.
  if (cosine > 1 - 1e-6) return nlerp(from, to, t);
  const angle = Math.acos(clamp(cosine, -1, 1));
  const sine = Math.sin(angle);
  const scaleFrom = Math.sin((1 - t) * angle) / sine;
  const scaleTo = Math.sin(t * angle) / sine;
  return normalizeQuat([
    from[0] * scaleFrom + to[0] * scaleTo,
    from[1] * scaleFrom + to[1] * scaleTo,
    from[2] * scaleFrom + to[2] * scaleTo,
    from[3] * scaleFrom + to[3] * scaleTo,
  ]);
}

/** Shortest rotation taking unit vector `from` onto unit vector `to`. */
export function quatFromTo(from: Vec3Like, to: Vec3Like): Quat {
  const a = [from[0]!, from[1]!, from[2]!];
  const b = [to[0]!, to[1]!, to[2]!];
  const magnitude = Math.sqrt((a[0]! ** 2 + a[1]! ** 2 + a[2]! ** 2) * (b[0]! ** 2 + b[1]! ** 2 + b[2]! ** 2));
  if (magnitude < EPSILON) throw new Error("Cannot rotate between zero-length directions.");
  const cosine = (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / magnitude;
  // Opposite directions have no unique arc; pick any perpendicular axis.
  if (cosine < -1 + 1e-6) {
    const axis = Math.abs(a[0]!) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const perpendicular: Vec3 = [
      a[1]! * axis[2]! - a[2]! * axis[1]!,
      a[2]! * axis[0]! - a[0]! * axis[2]!,
      a[0]! * axis[1]! - a[1]! * axis[0]!,
    ];
    return quatFromAxisAngle(perpendicular, Math.PI);
  }
  const cross: Vec3 = [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  return normalizeQuat([cross[0], cross[1], cross[2], magnitude + cosine * magnitude]);
}

/** Orientation whose -Z axis points along `forward`, with `up` as the hint. */
export function quatLookRotation(forward: Vec3Like, up: Vec3Like = [0, 1, 0]): Quat {
  const magnitude = Math.hypot(forward[0]!, forward[1]!, forward[2]!);
  if (magnitude < EPSILON) throw new Error("A look direction cannot be zero-length.");
  const back: Vec3 = [-forward[0]! / magnitude, -forward[1]! / magnitude, -forward[2]! / magnitude];
  let right: Vec3 = [up[1]! * back[2] - up[2]! * back[1], up[2]! * back[0] - up[0]! * back[2], up[0]! * back[1] - up[1]! * back[0]];
  let rightLength = Math.hypot(right[0], right[1], right[2]);
  if (rightLength < EPSILON) {
    // `up` is parallel to the look direction; fall back to a world axis.
    const fallback: Vec3 = Math.abs(back[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    right = [fallback[1] * back[2] - fallback[2] * back[1], fallback[2] * back[0] - fallback[0] * back[2], fallback[0] * back[1] - fallback[1] * back[0]];
    rightLength = Math.hypot(right[0], right[1], right[2]);
  }
  right = [right[0] / rightLength, right[1] / rightLength, right[2] / rightLength];
  const trueUp: Vec3 = [back[1] * right[2] - back[2] * right[1], back[2] * right[0] - back[0] * right[2], back[0] * right[1] - back[1] * right[0]];
  return quatFromBasis(right, trueUp, back);
}

/** Builds a rotation from three orthonormal basis vectors. */
export function quatFromBasis(right: Vec3Like, up: Vec3Like, back: Vec3Like): Quat {
  const trace = right[0]! + up[1]! + back[2]!;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    return normalizeQuat([(up[2]! - back[1]!) / scale, (back[0]! - right[2]!) / scale, (right[1]! - up[0]!) / scale, scale / 4]);
  }
  if (right[0]! > up[1]! && right[0]! > back[2]!) {
    const scale = Math.sqrt(1 + right[0]! - up[1]! - back[2]!) * 2;
    return normalizeQuat([scale / 4, (up[0]! + right[1]!) / scale, (back[0]! + right[2]!) / scale, (up[2]! - back[1]!) / scale]);
  }
  if (up[1]! > back[2]!) {
    const scale = Math.sqrt(1 + up[1]! - right[0]! - back[2]!) * 2;
    return normalizeQuat([(up[0]! + right[1]!) / scale, scale / 4, (back[1]! + up[2]!) / scale, (back[0]! - right[2]!) / scale]);
  }
  const scale = Math.sqrt(1 + back[2]! - right[0]! - up[1]!) * 2;
  return normalizeQuat([(back[0]! + right[2]!) / scale, (back[1]! + up[2]!) / scale, scale / 4, (right[1]! - up[0]!) / scale]);
}

/** Unsigned angle in radians between two orientations. */
export function angleBetweenQuat(a: QuatLike, b: QuatLike): number {
  return 2 * Math.acos(clamp(Math.abs(dotQuat(normalizeQuat(a), normalizeQuat(b))), -1, 1));
}

/** Steps toward a target orientation by at most `maxRadians`. */
export function rotateTowards(current: QuatLike, target: QuatLike, maxRadians: number): Quat {
  if (maxRadians < 0) throw new Error("rotateTowards requires a non-negative maximum.");
  const angle = angleBetweenQuat(current, target);
  if (angle < EPSILON) return normalizeQuat(target);
  return slerp(current, target, Math.min(1, maxRadians / angle));
}

export function equalsQuat(a: QuatLike, b: QuatLike, tolerance = EPSILON): boolean {
  // q and -q are the same rotation, so compare the absolute dot product.
  return Math.abs(Math.abs(dotQuat(normalizeQuat(a), normalizeQuat(b))) - 1) <= tolerance;
}
