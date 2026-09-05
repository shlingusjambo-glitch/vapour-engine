/** Scalar helpers shared by every Vapour subsystem.
 *
 * These exist so gameplay code, the editor, and the renderer agree on edge-case
 * behaviour — what `lerp` does outside `[0, 1]`, which way `wrapAngle` folds,
 * how `smoothDamp` treats a zero smoothing time — instead of each subsystem
 * shipping a slightly different copy.
 */

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;

/** Default tolerance for float comparisons at typical world scales. */
export const EPSILON = 1e-6;

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) throw new Error("clamp requires minimum <= maximum.");
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

/** Clamps to `[0, 1]`, the range colour and blend weights are defined over. */
export function saturate(value: number): number {
  return clamp(value, 0, 1);
}

/** Unclamped linear interpolation; pass a clamped `t` when extrapolation is wrong. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function lerpClamped(from: number, to: number, t: number): number {
  return lerp(from, to, saturate(t));
}

/** The inverse of {@link lerp}. Returns 0 when the range is degenerate. */
export function inverseLerp(from: number, to: number, value: number): number {
  const span = to - from;
  return Math.abs(span) < EPSILON ? 0 : (value - from) / span;
}

export function remap(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
  return lerp(toMin, toMax, inverseLerp(fromMin, fromMax, value));
}

/** Hermite ease-in-out across `[edge0, edge1]`, matching the WGSL builtin. */
export function smoothStep(edge0: number, edge1: number, value: number): number {
  const t = saturate(inverseLerp(edge0, edge1, value));
  return t * t * (3 - 2 * t);
}

/** Ken Perlin's second-order smoothstep: zero first *and* second derivative. */
export function smootherStep(edge0: number, edge1: number, value: number): number {
  const t = saturate(inverseLerp(edge0, edge1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Steps toward a target by at most `maxDelta`, never overshooting. */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  if (maxDelta < 0) throw new Error("moveTowards requires a non-negative maxDelta.");
  const delta = target - current;
  return Math.abs(delta) <= maxDelta ? target : current + Math.sign(delta) * maxDelta;
}

/** Positive modulo: unlike `%`, the result always has the sign of `length`. */
export function repeat(value: number, length: number): number {
  if (length <= 0) throw new Error("repeat requires a positive length.");
  return value - Math.floor(value / length) * length;
}

/** Triangle wave over `[0, length]`, used for looping ping-pong animation. */
export function pingPong(value: number, length: number): number {
  const folded = repeat(value, length * 2);
  return length - Math.abs(folded - length);
}

/** Folds an angle in radians into `(-PI, PI]`. */
export function wrapAngle(radians: number): number {
  const wrapped = repeat(finite(radians, "Angle") + Math.PI, TAU) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/** Shortest signed angular distance from `from` to `to`, in radians. */
export function deltaAngle(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Angle-aware {@link lerp}; interpolates the short way around the circle. */
export function lerpAngle(from: number, to: number, t: number): number {
  return wrapAngle(from + deltaAngle(from, to) * t);
}

export function degToRad(degrees: number): number {
  return finite(degrees, "Angle") * DEG_TO_RAD;
}

export function radToDeg(radians: number): number {
  return finite(radians, "Angle") * RAD_TO_DEG;
}

export function approximately(a: number, b: number, tolerance = EPSILON): boolean {
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Rounds to `decimals` places, normalising `-0` so serialized scenes diff cleanly. */
export function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor + 0;
}

/** Next power of two at or above `value`; sizes atlases and GPU buffers. */
export function nextPowerOfTwo(value: number): number {
  if (value <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(value));
}

export function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

/** Mutable state for {@link smoothDamp}; one per damped value. */
export interface SmoothDampState {
  velocity: number;
}

/**
 * Critically damped spring toward `target`.
 *
 * Frame-rate independent and overshoot-free, which is what camera follow, aim
 * smoothing, and UI easing actually want — a plain `lerp` per frame is neither.
 */
export function smoothDamp(current: number, target: number, state: SmoothDampState, smoothTime: number, deltaTime: number, maxSpeed = Infinity): number {
  if (smoothTime <= 0) {
    state.velocity = deltaTime > 0 ? (target - current) / deltaTime : 0;
    return target;
  }
  const omega = 2 / smoothTime;
  const x = omega * deltaTime;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxDelta = maxSpeed * smoothTime;
  const change = clamp(current - target, -maxDelta, maxDelta);
  const goal = current - change;
  const temp = (state.velocity + omega * change) * deltaTime;
  state.velocity = (state.velocity - omega * temp) * decay;
  const result = goal + (change + temp) * decay;
  // Prevent the spring from overshooting past the target on a large step.
  if (target - current > 0 === result > target) {
    state.velocity = (target - goal) / deltaTime;
    return target;
  }
  return result;
}
