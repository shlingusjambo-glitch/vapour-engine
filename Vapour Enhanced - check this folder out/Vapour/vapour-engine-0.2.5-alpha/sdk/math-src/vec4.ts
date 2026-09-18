/** Four-component vector maths, used for colours, tangents, and clip-space points. */
import { clamp, EPSILON, lerp } from "./scalar.js";

export type Vec4 = [number, number, number, number];
export type Vec4Like = readonly number[];

export const VEC4_ZERO: Vec4 = [0, 0, 0, 0];
export const VEC4_ONE: Vec4 = [1, 1, 1, 1];

export function vec4(x = 0, y = 0, z = 0, w = 0): Vec4 {
  return [x, y, z, w];
}

export function toVec4(value: Vec4Like, label = "A 4D vector"): Vec4 {
  if (value.length < 4) throw new Error(`${label} requires four components.`);
  const out: Vec4 = [value[0]!, value[1]!, value[2]!, value[3]!];
  if (out.some((component) => !Number.isFinite(component))) throw new Error(`${label} requires finite components.`);
  return out;
}

export function add4(a: Vec4Like, b: Vec4Like): Vec4 {
  return [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!, a[3]! + b[3]!];
}

export function subtract4(a: Vec4Like, b: Vec4Like): Vec4 {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!, a[3]! - b[3]!];
}

export function scale4(value: Vec4Like, factor: number): Vec4 {
  return [value[0]! * factor, value[1]! * factor, value[2]! * factor, value[3]! * factor];
}

export function dot4(a: Vec4Like, b: Vec4Like): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
}

export function length4(value: Vec4Like): number {
  return Math.hypot(value[0]!, value[1]!, value[2]!, value[3]!);
}

export function normalize4(value: Vec4Like): Vec4 {
  const magnitude = length4(value);
  if (magnitude < EPSILON) throw new Error("Cannot normalize a zero-length vector.");
  return [value[0]! / magnitude, value[1]! / magnitude, value[2]! / magnitude, value[3]! / magnitude];
}

export function lerpVec4(a: Vec4Like, b: Vec4Like, t: number): Vec4 {
  return [lerp(a[0]!, b[0]!, t), lerp(a[1]!, b[1]!, t), lerp(a[2]!, b[2]!, t), lerp(a[3]!, b[3]!, t)];
}

export function clampVec4(value: Vec4Like, minimum: number, maximum: number): Vec4 {
  return [clamp(value[0]!, minimum, maximum), clamp(value[1]!, minimum, maximum), clamp(value[2]!, minimum, maximum), clamp(value[3]!, minimum, maximum)];
}

export function equalsVec4(a: Vec4Like, b: Vec4Like, tolerance = EPSILON): boolean {
  return [0, 1, 2, 3].every((index) => Math.abs(a[index]! - b[index]!) <= tolerance);
}
