/** Named easing functions over the unit interval.
 *
 * Every function maps `[0, 1]` to a value that starts at 0 and ends at 1 (the
 * `back` and `elastic` families overshoot in between). Tweening, UI animation,
 * and animation curves all resolve easings by name so they can be serialized
 * into scene JSON and chosen from a dropdown.
 */
import { saturate } from "./scalar.js";

export type EasingFunction = (t: number) => number;

const BACK_C1 = 1.70158;
const BACK_C2 = BACK_C1 * 1.525;
const BACK_C3 = BACK_C1 + 1;
const ELASTIC_C4 = (2 * Math.PI) / 3;
const ELASTIC_C5 = (2 * Math.PI) / 4.5;

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/** The complete easing catalogue, keyed by serializable name. */
export const EASINGS = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t: number) => t ** 3,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  inQuart: (t: number) => t ** 4,
  outQuart: (t: number) => 1 - (1 - t) ** 4,
  inOutQuart: (t: number) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  inQuint: (t: number) => t ** 5,
  outQuint: (t: number) => 1 - (1 - t) ** 5,
  inOutQuint: (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
  inSine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t: number) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  inExpo: (t: number) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutExpo: (t: number) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  inCirc: (t: number) => 1 - Math.sqrt(1 - t * t),
  outCirc: (t: number) => Math.sqrt(1 - (t - 1) ** 2),
  inOutCirc: (t: number) => (t < 0.5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2),
  inBack: (t: number) => BACK_C3 * t ** 3 - BACK_C1 * t * t,
  outBack: (t: number) => 1 + BACK_C3 * (t - 1) ** 3 + BACK_C1 * (t - 1) ** 2,
  inOutBack: (t: number) =>
    t < 0.5
      ? ((2 * t) ** 2 * ((BACK_C2 + 1) * 2 * t - BACK_C2)) / 2
      : ((2 * t - 2) ** 2 * ((BACK_C2 + 1) * (t * 2 - 2) + BACK_C2) + 2) / 2,
  inElastic: (t: number) => (t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ELASTIC_C4)),
  outElastic: (t: number) => (t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC_C4) + 1),
  inOutElastic: (t: number) =>
    t === 0
      ? 0
      : t === 1
        ? 1
        : t < 0.5
          ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * ELASTIC_C5)) / 2
          : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * ELASTIC_C5)) / 2 + 1,
  inBounce: (t: number) => 1 - bounceOut(1 - t),
  outBounce: bounceOut,
  inOutBounce: (t: number) => (t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2),
} as const satisfies Record<string, EasingFunction>;

export type EasingName = keyof typeof EASINGS;

export const EASING_NAMES = Object.keys(EASINGS) as readonly EasingName[];

/** Resolves a serialized easing name, clamping its input to `[0, 1]`. */
export function easing(name: EasingName): EasingFunction {
  const fn = EASINGS[name];
  if (!fn) throw new Error(`Unknown easing "${String(name)}". Known easings: ${EASING_NAMES.join(", ")}.`);
  return (t: number) => fn(saturate(t));
}

export function isEasingName(value: string): value is EasingName {
  return Object.hasOwn(EASINGS, value);
}

/**
 * A CSS-style cubic Bézier easing through control points `(x1, y1)` and
 * `(x2, y2)`, solved for `y` at a given `x` by Newton iteration with a
 * bisection fallback for the flat regions Newton handles badly.
 */
export function cubicBezierEasing(x1: number, y1: number, x2: number, y2: number): EasingFunction {
  if ([x1, x2].some((value) => value < 0 || value > 1)) throw new Error("Bezier easing control x values must lie in [0, 1].");
  const curveAt = (a: number, b: number, t: number): number => (((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t + 3 * a) * t;
  const slopeAt = (a: number, b: number, t: number): number => 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
  return (input: number) => {
    const x = saturate(input);
    if (x === 0 || x === 1) return x;
    let t = x;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const error = curveAt(x1, x2, t) - x;
      if (Math.abs(error) < 1e-6) return curveAt(y1, y2, t);
      const slope = slopeAt(x1, x2, t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let low = 0;
    let high = 1;
    t = x;
    for (let iteration = 0; iteration < 24 && high - low > 1e-6; iteration += 1) {
      t = (low + high) / 2;
      if (curveAt(x1, x2, t) < x) low = t;
      else high = t;
    }
    return curveAt(y1, y2, t);
  };
}
