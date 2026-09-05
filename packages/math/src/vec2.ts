/** Two-component vector maths, used by 2D games, UI layout, and screen space. */
import { clamp, EPSILON, lerp, wrapAngle } from "./scalar.js";

export type Vec2 = [number, number];
export type Vec2Like = readonly number[];

export const VEC2_ZERO: Vec2 = [0, 0];
export const VEC2_ONE: Vec2 = [1, 1];
export const VEC2_RIGHT: Vec2 = [1, 0];
export const VEC2_UP: Vec2 = [0, 1];

export function vec2(x = 0, y = 0): Vec2 {
  return [x, y];
}

export function toVec2(value: Vec2Like, label = "A 2D vector"): Vec2 {
  if (value.length < 2) throw new Error(`${label} requires two components.`);
  const [x, y] = [value[0]!, value[1]!];
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${label} requires finite components.`);
  return [x, y];
}

export function add2(a: Vec2Like, b: Vec2Like): Vec2 {
  return [a[0]! + b[0]!, a[1]! + b[1]!];
}

export function subtract2(a: Vec2Like, b: Vec2Like): Vec2 {
  return [a[0]! - b[0]!, a[1]! - b[1]!];
}

export function multiply2(a: Vec2Like, b: Vec2Like): Vec2 {
  return [a[0]! * b[0]!, a[1]! * b[1]!];
}

export function scale2(value: Vec2Like, factor: number): Vec2 {
  return [value[0]! * factor, value[1]! * factor];
}

export function negate2(value: Vec2Like): Vec2 {
  return [-value[0]!, -value[1]!];
}

export function dot2(a: Vec2Like, b: Vec2Like): number {
  return a[0]! * b[0]! + a[1]! * b[1]!;
}

/** Z component of the 3D cross product; its sign gives winding order. */
export function cross2(a: Vec2Like, b: Vec2Like): number {
  return a[0]! * b[1]! - a[1]! * b[0]!;
}

export function length2(value: Vec2Like): number {
  return Math.hypot(value[0]!, value[1]!);
}

export function lengthSquared2(value: Vec2Like): number {
  return dot2(value, value);
}

export function distance2(a: Vec2Like, b: Vec2Like): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
}

export function distanceSquared2(a: Vec2Like, b: Vec2Like): number {
  const dx = a[0]! - b[0]!;
  const dy = a[1]! - b[1]!;
  return dx * dx + dy * dy;
}

export function normalize2(value: Vec2Like): Vec2 {
  const magnitude = length2(value);
  if (magnitude < EPSILON) throw new Error("Cannot normalize a zero-length vector.");
  return [value[0]! / magnitude, value[1]! / magnitude];
}

export function normalizeOr2(value: Vec2Like, fallback: Vec2Like = VEC2_RIGHT): Vec2 {
  const magnitude = length2(value);
  if (magnitude < EPSILON) return toVec2(fallback);
  return [value[0]! / magnitude, value[1]! / magnitude];
}

export function lerpVec2(a: Vec2Like, b: Vec2Like, t: number): Vec2 {
  return [lerp(a[0]!, b[0]!, t), lerp(a[1]!, b[1]!, t)];
}

export function minVec2(a: Vec2Like, b: Vec2Like): Vec2 {
  return [Math.min(a[0]!, b[0]!), Math.min(a[1]!, b[1]!)];
}

export function maxVec2(a: Vec2Like, b: Vec2Like): Vec2 {
  return [Math.max(a[0]!, b[0]!), Math.max(a[1]!, b[1]!)];
}

export function clampVec2(value: Vec2Like, minimum: Vec2Like, maximum: Vec2Like): Vec2 {
  return [clamp(value[0]!, minimum[0]!, maximum[0]!), clamp(value[1]!, minimum[1]!, maximum[1]!)];
}

export function clampLength2(value: Vec2Like, maxLength: number): Vec2 {
  if (maxLength < 0) throw new Error("clampLength2 requires a non-negative maximum.");
  const magnitude = length2(value);
  return magnitude <= maxLength || magnitude < EPSILON ? toVec2(value) : scale2(value, maxLength / magnitude);
}

/** Rotates counter-clockwise about the origin. */
export function rotate2(value: Vec2Like, radians: number): Vec2 {
  const [sin, cos] = [Math.sin(radians), Math.cos(radians)];
  return [value[0]! * cos - value[1]! * sin, value[0]! * sin + value[1]! * cos];
}

/** Left-hand perpendicular, the 2D equivalent of a surface normal. */
export function perpendicular2(value: Vec2Like): Vec2 {
  return [-value[1]!, value[0]!];
}

/** Signed angle from `a` to `b` in `(-PI, PI]`. */
export function signedAngle2(a: Vec2Like, b: Vec2Like): number {
  return wrapAngle(Math.atan2(cross2(a, b), dot2(a, b)));
}

export function equalsVec2(a: Vec2Like, b: Vec2Like, tolerance = EPSILON): boolean {
  return Math.abs(a[0]! - b[0]!) <= tolerance && Math.abs(a[1]! - b[1]!) <= tolerance;
}
