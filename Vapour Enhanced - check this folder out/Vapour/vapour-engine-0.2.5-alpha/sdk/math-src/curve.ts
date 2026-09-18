/** Keyframed scalar curves.
 *
 * A curve is plain serializable data — an ordered list of keys with tangents —
 * so it round-trips through scene JSON and can be authored in an editor, driven
 * by an AI-generated asset description, or built in code. Animation, particle
 * lifetimes, audio falloff, and terrain shaping all evaluate the same type.
 */
import { clamp, EPSILON, lerp, repeat, pingPong } from "./scalar.js";

/** What happens outside the curve's key range. */
export type CurveWrapMode = "clamp" | "loop" | "pingPong";

export type CurveInterpolation = "linear" | "cubic" | "constant";

export interface CurveKey {
  /** Position along the curve; keys are sorted by this. */
  readonly time: number;
  readonly value: number;
  /** Incoming slope in value-per-time. Ignored unless interpolation is cubic. */
  readonly inTangent?: number;
  /** Outgoing slope in value-per-time. */
  readonly outTangent?: number;
}

export interface CurveOptions {
  readonly interpolation?: CurveInterpolation;
  readonly preWrap?: CurveWrapMode;
  readonly postWrap?: CurveWrapMode;
}

export interface Curve {
  readonly keys: readonly CurveKey[];
  readonly interpolation: CurveInterpolation;
  readonly preWrap: CurveWrapMode;
  readonly postWrap: CurveWrapMode;
}

/** Validates and sorts keys. Rejects duplicate times, which make evaluation
 * ambiguous and are almost always an authoring mistake. */
export function curve(keys: readonly CurveKey[], options: CurveOptions = {}): Curve {
  if (keys.length === 0) throw new Error("A curve requires at least one key.");
  for (const key of keys) {
    if (!Number.isFinite(key.time) || !Number.isFinite(key.value)) throw new Error("Curve keys require finite time and value.");
  }
  const sorted = [...keys].sort((a, b) => a.time - b.time);
  for (let index = 1; index < sorted.length; index += 1) {
    if (Math.abs(sorted[index]!.time - sorted[index - 1]!.time) < EPSILON) {
      throw new Error(`A curve cannot have two keys at time ${sorted[index]!.time}.`);
    }
  }
  return {
    keys: sorted,
    interpolation: options.interpolation ?? "linear",
    preWrap: options.preWrap ?? "clamp",
    postWrap: options.postWrap ?? "clamp",
  };
}

/** A flat curve holding a single value; useful as a default. */
export function constantCurve(value: number): Curve {
  return curve([{ time: 0, value }]);
}

/** A straight ramp from `from` at time 0 to `to` at time 1. */
export function linearCurve(from: number, to: number): Curve {
  return curve([
    { time: 0, value: from },
    { time: 1, value: to },
  ]);
}

export function curveDuration(value: Curve): number {
  const first = value.keys[0]!;
  const last = value.keys[value.keys.length - 1]!;
  return last.time - first.time;
}

function wrapTime(value: Curve, time: number): number {
  const start = value.keys[0]!.time;
  const end = value.keys[value.keys.length - 1]!.time;
  const duration = end - start;
  if (duration < EPSILON) return start;
  if (time < start) {
    if (value.preWrap === "clamp") return start;
    if (value.preWrap === "loop") return start + repeat(time - start, duration);
    return start + pingPong(time - start, duration);
  }
  if (time > end) {
    if (value.postWrap === "clamp") return end;
    if (value.postWrap === "loop") return start + repeat(time - start, duration);
    return start + pingPong(time - start, duration);
  }
  return time;
}

export function evaluateCurve(value: Curve, time: number): number {
  if (!Number.isFinite(time)) throw new Error("Curve evaluation requires a finite time.");
  const keys = value.keys;
  if (keys.length === 1) return keys[0]!.value;
  const t = wrapTime(value, time);
  // Endpoints are exact for every interpolation mode; without this a constant
  // curve could never reach its final key, whose value only ever appears as the
  // *end* of a segment.
  if (t <= keys[0]!.time) return keys[0]!.value;
  const lastKey = keys[keys.length - 1]!;
  if (t >= lastKey.time) return lastKey.value;
  // Binary search for the segment containing t.
  let low = 0;
  let high = keys.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (keys[mid]!.time <= t) low = mid;
    else high = mid;
  }
  const a = keys[low]!;
  const b = keys[high]!;
  const span = b.time - a.time;
  if (span < EPSILON) return a.value;
  const fraction = clamp((t - a.time) / span, 0, 1);
  if (value.interpolation === "constant") return a.value;
  if (value.interpolation === "linear") return lerp(a.value, b.value, fraction);
  // Cubic Hermite. Tangents default to the segment's own slope, which makes an
  // untangented cubic curve behave exactly like a linear one.
  const slope = (b.value - a.value) / span;
  const outTangent = a.outTangent ?? slope;
  const inTangent = b.inTangent ?? slope;
  const f2 = fraction * fraction;
  const f3 = f2 * fraction;
  return (
    (2 * f3 - 3 * f2 + 1) * a.value +
    (f3 - 2 * f2 + fraction) * span * outTangent +
    (-2 * f3 + 3 * f2) * b.value +
    (f3 - f2) * span * inTangent
  );
}

/** Samples a curve into a fixed-size table, for hot paths that cannot afford a
 * search per evaluation (particle systems, shader uploads, audio curves). */
export function sampleCurve(value: Curve, sampleCount: number): Float32Array {
  if (!Number.isInteger(sampleCount) || sampleCount < 2) throw new Error("Curve sampling requires at least two samples.");
  const start = value.keys[0]!.time;
  const duration = curveDuration(value);
  const out = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    out[index] = evaluateCurve(value, start + (duration * index) / (sampleCount - 1));
  }
  return out;
}

/** Smallest and largest values the curve reaches at its keys and across a
 * sampled sweep, which is what LOD and particle bounds need. */
export function curveRange(value: Curve, sampleCount = 64): [number, number] {
  const samples = sampleCurve(value, Math.max(2, sampleCount));
  let min = Infinity;
  let max = -Infinity;
  for (const sample of samples) {
    min = Math.min(min, sample);
    max = Math.max(max, sample);
  }
  return [min, max];
}
