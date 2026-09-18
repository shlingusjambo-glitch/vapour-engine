/** Three-component vector maths on plain tuples.
 *
 * Vapour stores positions, scales, and directions as `[x, y, z]` tuples in
 * scene JSON and across the WASM boundary, so the maths operates directly on
 * that representation rather than on a wrapper class. Every function accepts
 * `readonly number[]` so callers can pass slices of larger buffers, and returns
 * a fresh tuple; the `*Into` variants write into a caller-owned tuple for hot
 * loops that must not allocate.
 */
import { clamp, EPSILON, lerp } from "./scalar.js";

export type Vec3 = [number, number, number];
export type Vec3Like = readonly number[];

export const VEC3_ZERO: Vec3 = [0, 0, 0];
export const VEC3_ONE: Vec3 = [1, 1, 1];
export const VEC3_UP: Vec3 = [0, 1, 0];
export const VEC3_DOWN: Vec3 = [0, -1, 0];
export const VEC3_RIGHT: Vec3 = [1, 0, 0];
export const VEC3_LEFT: Vec3 = [-1, 0, 0];
/** Vapour is right-handed with -Z forward, matching glTF and WebGPU NDC depth. */
export const VEC3_FORWARD: Vec3 = [0, 0, -1];
export const VEC3_BACK: Vec3 = [0, 0, 1];

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

/** Validates and copies an arbitrary numeric input into a tuple. */
export function toVec3(value: Vec3Like, label = "A 3D vector"): Vec3 {
  if (value.length < 3) throw new Error(`${label} requires three components.`);
  const [x, y, z] = [value[0]!, value[1]!, value[2]!];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error(`${label} requires finite components.`);
  return [x, y, z];
}

export function add(a: Vec3Like, b: Vec3Like): Vec3 {
  return [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
}

export function subtract(a: Vec3Like, b: Vec3Like): Vec3 {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}

export function multiply(a: Vec3Like, b: Vec3Like): Vec3 {
  return [a[0]! * b[0]!, a[1]! * b[1]!, a[2]! * b[2]!];
}

export function scale(value: Vec3Like, factor: number): Vec3 {
  return [value[0]! * factor, value[1]! * factor, value[2]! * factor];
}

export function negate(value: Vec3Like): Vec3 {
  return [-value[0]!, -value[1]!, -value[2]!];
}

export function dot(a: Vec3Like, b: Vec3Like): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

export function cross(a: Vec3Like, b: Vec3Like): Vec3 {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}

export function length(value: Vec3Like): number {
  return Math.hypot(value[0]!, value[1]!, value[2]!);
}

/** Squared length; prefer it for comparisons to skip the square root. */
export function lengthSquared(value: Vec3Like): number {
  return dot(value, value);
}

export function distance(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

export function distanceSquared(a: Vec3Like, b: Vec3Like): number {
  const dx = a[0]! - b[0]!;
  const dy = a[1]! - b[1]!;
  const dz = a[2]! - b[2]!;
  return dx * dx + dy * dy + dz * dz;
}

/** Throws on a zero-length vector: a direction that cannot be normalized is a
 * bug at the call site, and silently returning zero hides it downstream. */
export function normalize(value: Vec3Like): Vec3 {
  const magnitude = length(value);
  if (magnitude < EPSILON) throw new Error("Cannot normalize a zero-length vector.");
  return [value[0]! / magnitude, value[1]! / magnitude, value[2]! / magnitude];
}

/** Normalizes, or returns `fallback` when the vector is degenerate. */
export function normalizeOr(value: Vec3Like, fallback: Vec3Like = VEC3_FORWARD): Vec3 {
  const magnitude = length(value);
  if (magnitude < EPSILON) return toVec3(fallback);
  return [value[0]! / magnitude, value[1]! / magnitude, value[2]! / magnitude];
}

export function lerpVec3(a: Vec3Like, b: Vec3Like, t: number): Vec3 {
  return [lerp(a[0]!, b[0]!, t), lerp(a[1]!, b[1]!, t), lerp(a[2]!, b[2]!, t)];
}

export function minVec3(a: Vec3Like, b: Vec3Like): Vec3 {
  return [Math.min(a[0]!, b[0]!), Math.min(a[1]!, b[1]!), Math.min(a[2]!, b[2]!)];
}

export function maxVec3(a: Vec3Like, b: Vec3Like): Vec3 {
  return [Math.max(a[0]!, b[0]!), Math.max(a[1]!, b[1]!), Math.max(a[2]!, b[2]!)];
}

export function clampVec3(value: Vec3Like, minimum: Vec3Like, maximum: Vec3Like): Vec3 {
  return [clamp(value[0]!, minimum[0]!, maximum[0]!), clamp(value[1]!, minimum[1]!, maximum[1]!), clamp(value[2]!, minimum[2]!, maximum[2]!)];
}

/** Caps a vector's magnitude without changing its direction. */
export function clampLength(value: Vec3Like, maxLength: number): Vec3 {
  if (maxLength < 0) throw new Error("clampLength requires a non-negative maximum.");
  const magnitude = length(value);
  return magnitude <= maxLength || magnitude < EPSILON ? toVec3(value) : scale(value, maxLength / magnitude);
}

export function moveTowardsVec3(current: Vec3Like, target: Vec3Like, maxDelta: number): Vec3 {
  const delta = subtract(target, current);
  const magnitude = length(delta);
  if (magnitude <= maxDelta || magnitude < EPSILON) return toVec3(target);
  return add(current, scale(delta, maxDelta / magnitude));
}

/** Component of `value` along `onto`. */
export function project(value: Vec3Like, onto: Vec3Like): Vec3 {
  const denominator = lengthSquared(onto);
  if (denominator < EPSILON) throw new Error("Cannot project onto a zero-length vector.");
  return scale(onto, dot(value, onto) / denominator);
}

/** Component of `value` lying in the plane with the given normal. */
export function projectOnPlane(value: Vec3Like, planeNormal: Vec3Like): Vec3 {
  return subtract(value, project(value, planeNormal));
}

/** Mirrors `direction` about a surface with the given unit `normal`. */
export function reflect(direction: Vec3Like, normal: Vec3Like): Vec3 {
  return subtract(direction, scale(normal, 2 * dot(direction, normal)));
}

/** Unsigned angle between two directions, in radians. */
export function angleBetween(a: Vec3Like, b: Vec3Like): number {
  const denominator = Math.sqrt(lengthSquared(a) * lengthSquared(b));
  if (denominator < EPSILON) throw new Error("Cannot measure an angle against a zero-length vector.");
  return Math.acos(clamp(dot(a, b) / denominator, -1, 1));
}

export function equalsVec3(a: Vec3Like, b: Vec3Like, tolerance = EPSILON): boolean {
  return Math.abs(a[0]! - b[0]!) <= tolerance && Math.abs(a[1]! - b[1]!) <= tolerance && Math.abs(a[2]! - b[2]!) <= tolerance;
}

/** Any unit vector perpendicular to `value`; used to build tangent frames. */
export function orthogonal(value: Vec3Like): Vec3 {
  const direction = normalize(value);
  // Cross with whichever cardinal axis is least aligned to stay well conditioned.
  const axis: Vec3 = Math.abs(direction[0]) < 0.9 ? VEC3_RIGHT : VEC3_UP;
  return normalize(cross(direction, axis));
}
