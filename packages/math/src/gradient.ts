/** Colour gradients with independent colour and alpha keys.
 *
 * Separating the two matches how particle systems, sky rendering, and UI
 * theming actually author fades — a smoke puff changes opacity on a different
 * schedule from its tint — and it is the same split Unity and Unreal use, so
 * imported effect descriptions map across without loss.
 */
import { clamp, EPSILON, lerp } from "./scalar.js";
import type { Rgba, RgbaLike } from "./color.js";
import { toRgba } from "./color.js";

export type GradientMode = "blend" | "fixed";

export interface GradientColorKey {
  /** Position in `[0, 1]`. */
  readonly time: number;
  /** RGB only; alpha comes from the alpha keys. */
  readonly color: readonly [number, number, number];
}

export interface GradientAlphaKey {
  readonly time: number;
  readonly alpha: number;
}

export interface Gradient {
  readonly colorKeys: readonly GradientColorKey[];
  readonly alphaKeys: readonly GradientAlphaKey[];
  /** `fixed` steps between keys instead of blending. */
  readonly mode: GradientMode;
}

function validateKeys<T extends { time: number }>(keys: readonly T[], label: string): readonly T[] {
  if (keys.length === 0) throw new Error(`A gradient requires at least one ${label} key.`);
  for (const key of keys) {
    if (!Number.isFinite(key.time) || key.time < 0 || key.time > 1) throw new Error(`Gradient ${label} key times must lie in [0, 1].`);
  }
  return [...keys].sort((a, b) => a.time - b.time);
}

export function gradient(colorKeys: readonly GradientColorKey[], alphaKeys: readonly GradientAlphaKey[] = [{ time: 0, alpha: 1 }], mode: GradientMode = "blend"): Gradient {
  return {
    colorKeys: validateKeys(colorKeys, "colour") as readonly GradientColorKey[],
    alphaKeys: validateKeys(alphaKeys, "alpha") as readonly GradientAlphaKey[],
    mode,
  };
}

/** A two-stop gradient between opaque colours, the common case. */
export function gradientBetween(from: RgbaLike, to: RgbaLike): Gradient {
  const a = toRgba(from);
  const b = toRgba(to);
  return gradient(
    [
      { time: 0, color: [a[0], a[1], a[2]] },
      { time: 1, color: [b[0], b[1], b[2]] },
    ],
    [
      { time: 0, alpha: a[3] },
      { time: 1, alpha: b[3] },
    ],
  );
}

function evaluateStops<T extends { time: number }>(keys: readonly T[], time: number, mode: GradientMode, blend: (a: T, b: T, t: number) => number[]): number[] | T {
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (time <= first.time) return first;
  if (time >= last.time) return last;
  let index = 0;
  while (index < keys.length - 1 && keys[index + 1]!.time <= time) index += 1;
  const a = keys[index]!;
  const b = keys[Math.min(index + 1, keys.length - 1)]!;
  if (mode === "fixed") return a;
  const span = b.time - a.time;
  return span < EPSILON ? a : blend(a, b, (time - a.time) / span);
}

/** Samples the gradient at `time`, clamped to `[0, 1]`. */
export function evaluateGradient(value: Gradient, time: number): Rgba {
  const t = clamp(time, 0, 1);
  const colorResult = evaluateStops(value.colorKeys, t, value.mode, (a, b, fraction) => [
    lerp(a.color[0], b.color[0], fraction),
    lerp(a.color[1], b.color[1], fraction),
    lerp(a.color[2], b.color[2], fraction),
  ]);
  const rgb = Array.isArray(colorResult) ? colorResult : [...(colorResult as GradientColorKey).color];
  const alphaResult = evaluateStops(value.alphaKeys, t, value.mode, (a, b, fraction) => [lerp(a.alpha, b.alpha, fraction)]);
  const alpha = Array.isArray(alphaResult) ? alphaResult[0]! : (alphaResult as GradientAlphaKey).alpha;
  return [rgb[0]!, rgb[1]!, rgb[2]!, alpha];
}

/** Bakes a gradient into an RGBA8 strip, ready to upload as a 1D lookup
 * texture for GPU particles or post-processing. */
export function sampleGradient(value: Gradient, width: number): Uint8Array {
  if (!Number.isInteger(width) || width < 2) throw new Error("Gradient sampling requires a width of at least two.");
  const out = new Uint8Array(width * 4);
  for (let index = 0; index < width; index += 1) {
    const color = evaluateGradient(value, index / (width - 1));
    for (let channel = 0; channel < 4; channel += 1) {
      out[index * 4 + channel] = Math.round(clamp(color[channel]!, 0, 1) * 255);
    }
  }
  return out;
}
