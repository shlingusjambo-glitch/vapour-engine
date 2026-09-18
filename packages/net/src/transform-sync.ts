/** Networked transforms: what to replicate, how coarsely, and how to show it.
 *
 * A `NetworkTransform` is a *descriptor*, not a component with behaviour. The
 * pack side is a pure function from a transform to `NetState`; the receive side
 * is a pure function from (shown, authoritative) to the next shown value. Both
 * are testable without an entity, a scene, or a socket, and the engine's scene
 * layer applies the result to whatever owns the transform.
 *
 * Quantization here is coarser than the server default on purpose. A position
 * at millimetre precision is invisible past a few metres, and every dropped
 * decimal is bytes per entity per tick per client.
 */
import { distance, lerpVec3, slerp, angleBetweenQuat, normalizeQuat } from "@vapour/math";
import { quantizeState, type NetState } from "./protocol.js";

/** Read-only tuples, the shape the physics and scene layers already use. */
export type Vec3Tuple = readonly [number, number, number];
export type QuatTuple = readonly [number, number, number, number];

export interface Transform {
  readonly position: Vec3Tuple;
  readonly rotation: QuatTuple;
  readonly scale: Vec3Tuple;
}

export interface NetworkTransform {
  /** Replicate position. Default `true`. */
  readonly position?: boolean;
  /** Replicate rotation. Default `true`. */
  readonly rotation?: boolean;
  /** Replicate scale. Default `false`: almost nothing scales at runtime. */
  readonly scale?: boolean;
  /** Decimals kept on the wire. Default 2 — centimetres. */
  readonly decimals?: number;
  /** Send every N-th tick. 1 sends every tick; 2 halves the rate. Default 1. */
  readonly sendRateDivisor?: number;
  /**
   * Position error beyond which the receiver snaps rather than smooths.
   *
   * Smoothing a teleport shows the entity sliding across the map; snapping a
   * one-centimetre correction shows it stutter. Default 2 units.
   */
  readonly snapThreshold?: number;
  /** Rotation error, in radians, beyond which the receiver snaps. Default pi/2. */
  readonly snapAngle?: number;
  /** Fraction of the remaining error closed per receive step, in `(0, 1]`. Default 0.5. */
  readonly smoothing?: number;
}

/** Wire keys, short because they appear once per entity per snapshot. */
export const TRANSFORM_KEYS = { position: "p", rotation: "r", scale: "s" } as const;

export const IDENTITY_TRANSFORM: Transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };

export function resolveNetworkTransform(descriptor: NetworkTransform = {}): Required<NetworkTransform> {
  const resolved = {
    position: descriptor.position ?? true,
    rotation: descriptor.rotation ?? true,
    scale: descriptor.scale ?? false,
    decimals: descriptor.decimals ?? 2,
    sendRateDivisor: descriptor.sendRateDivisor ?? 1,
    snapThreshold: descriptor.snapThreshold ?? 2,
    snapAngle: descriptor.snapAngle ?? Math.PI / 2,
    smoothing: descriptor.smoothing ?? 0.5,
  };
  if (!Number.isInteger(resolved.decimals) || resolved.decimals < 0) throw new Error("Transform decimals must be a non-negative whole number.");
  if (!Number.isInteger(resolved.sendRateDivisor) || resolved.sendRateDivisor < 1) throw new Error("A send-rate divisor must be a whole number of at least 1.");
  if (!(resolved.snapThreshold >= 0)) throw new Error("A snap threshold must not be negative.");
  if (!(resolved.snapAngle >= 0)) throw new Error("A snap angle must not be negative.");
  if (!(resolved.smoothing > 0 && resolved.smoothing <= 1)) throw new Error("Transform smoothing must lie in (0, 1].");
  return resolved;
}

/** Whether this entity's transform goes out on `tick`. */
export function shouldSendTransform(tick: number, descriptor: NetworkTransform = {}): boolean {
  return tick % resolveNetworkTransform(descriptor).sendRateDivisor === 0;
}

/** The replicated fields of a transform, quantized. */
export function packTransform(transform: Transform, descriptor: NetworkTransform = {}): NetState {
  const options = resolveNetworkTransform(descriptor);
  const state: Record<string, readonly number[]> = {};
  if (options.position) state[TRANSFORM_KEYS.position] = transform.position;
  if (options.rotation) state[TRANSFORM_KEYS.rotation] = normalizeQuat(transform.rotation);
  if (options.scale) state[TRANSFORM_KEYS.scale] = transform.scale;
  return quantizeState(state, options.decimals);
}

/** A transform from replicated state, keeping `fallback` for anything not replicated. */
export function unpackTransform(state: NetState, fallback: Transform = IDENTITY_TRANSFORM): Transform {
  const p = state[TRANSFORM_KEYS.position];
  const r = state[TRANSFORM_KEYS.rotation];
  const s = state[TRANSFORM_KEYS.scale];
  return {
    position: isVec(p, 3) ? (p as Vec3Tuple) : fallback.position,
    rotation: isVec(r, 4) ? normalizeQuat(r as QuatTuple) : fallback.rotation,
    scale: isVec(s, 3) ? (s as Vec3Tuple) : fallback.scale,
  };
}

export interface SmoothedTransform {
  readonly transform: Transform;
  /** True when the error exceeded a snap threshold and was applied in full. */
  readonly snapped: boolean;
}

/**
 * Moves what is shown toward what is authoritative: snap past the thresholds,
 * otherwise close a fraction of the gap. Scale always snaps — there is no
 * plausible motion between two scales.
 */
export function smoothTransform(shown: Transform, target: Transform, descriptor: NetworkTransform = {}): SmoothedTransform {
  const options = resolveNetworkTransform(descriptor);
  const positionError = distance(shown.position, target.position);
  const angleError = angleBetweenQuat(shown.rotation, target.rotation);
  const snapped = positionError > options.snapThreshold || angleError > options.snapAngle;
  if (snapped) return { transform: target, snapped };
  return {
    transform: {
      position: lerpVec3(shown.position, target.position, options.smoothing),
      rotation: slerp(shown.rotation, target.rotation, options.smoothing),
      scale: target.scale,
    },
    snapped,
  };
}

function isVec(value: unknown, length: number): boolean {
  return Array.isArray(value) && value.length === length && value.every((member) => typeof member === "number" && Number.isFinite(member));
}
