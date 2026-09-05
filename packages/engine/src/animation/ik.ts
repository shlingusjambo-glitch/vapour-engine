/** Inverse kinematics and look-at.
 *
 * Animation alone cannot make a character's feet meet uneven ground or its
 * hands meet a specific object, because the clip was authored without knowing
 * where either would be. IK closes that gap, and it is the difference between a
 * character that walks on a hillside and one that skates above it.
 *
 * Two solvers cover almost every game case:
 *
 * - **Two-bone IK** for limbs, solved analytically. A leg or an arm is two
 *   bones and a hinge, and the closed-form solution is exact, instant, and has
 *   no iteration artefacts.
 * - **Look-at** for heads and aiming, which is a constrained rotation rather
 *   than a chain.
 */
import { clamp, quatFromTo, quatLookRotation, multiplyQuat, normalizeQuat, type Quat, type Vec3 } from "@vapour/math";

/** A position an IK solver reads but never writes, so callers may pass frozen
 * or `as const` data as freely as a mutable {@link Vec3}. */
export type ReadonlyVec3 = readonly [number, number, number];

export interface TwoBoneIkInput {
  /** Shoulder or hip, in model space. */
  readonly root: ReadonlyVec3;
  /** Elbow or knee. */
  readonly mid: ReadonlyVec3;
  /** Hand or foot. */
  readonly tip: ReadonlyVec3;
  /** Where the tip should end up. */
  readonly target: ReadonlyVec3;
  /**
   * A point the joint should bend toward.
   *
   * Without it, a straightened limb has infinitely many valid solutions and the
   * solver picks an arbitrary one, which shows up as a knee snapping sideways.
   */
  readonly pole?: ReadonlyVec3;
}

export interface TwoBoneIkResult {
  /** Rotation to apply to the root bone, in model space. */
  readonly rootRotation: Quat;
  /** Rotation to apply to the mid bone. */
  readonly midRotation: Quat;
  /** True when the target was out of reach and the limb was straightened. */
  readonly stretched: boolean;
}

/**
 * Solves a two-bone chain analytically.
 *
 * The law of cosines gives the joint angle that puts the tip on the target;
 * when the target is beyond reach the limb straightens and points at it, which
 * looks like reaching rather than like a solver failure.
 */
export function solveTwoBoneIk(input: TwoBoneIkInput): TwoBoneIkResult {
  const upper = distance(input.root, input.mid);
  const lower = distance(input.mid, input.tip);
  if (upper < 1e-6 || lower < 1e-6) throw new Error("A two-bone IK chain needs both bones to have length.");

  const toTarget = subtract(input.target, input.root);
  const targetDistance = length(toTarget);
  if (targetDistance < 1e-6) throw new Error("A two-bone IK target cannot coincide with the chain's root.");

  const reach = upper + lower;
  const stretched = targetDistance >= reach;
  // Clamp inside the reachable annulus, or the law of cosines goes imaginary.
  const clamped = clamp(targetDistance, Math.abs(upper - lower) + 1e-6, reach - 1e-6);

  const currentDirection = subtract(input.tip, input.root);
  // First: swing the whole chain so its tip points at the target.
  const swing = quatFromTo(normalize(currentDirection), normalize(toTarget));

  // Then: bend the joint so the tip lands at the right distance.
  const currentAngle = jointAngle(upper, lower, length(currentDirection));
  const desiredAngle = jointAngle(upper, lower, clamped);
  const bendAxis = bendAxisFor(input, swing);
  const bend = axisAngle(bendAxis, desiredAngle - currentAngle);

  return {
    rootRotation: multiplyQuat(bend, swing),
    midRotation: axisAngle(bendAxis, -(desiredAngle - currentAngle) * 2),
    stretched,
  };
}

/** Interior angle at the root, by the law of cosines. */
function jointAngle(upper: number, lower: number, span: number): number {
  const cosine = clamp((upper * upper + span * span - lower * lower) / (2 * upper * span), -1, 1);
  return Math.acos(cosine);
}

/** The axis the joint bends about, respecting the pole when given. */
function bendAxisFor(input: TwoBoneIkInput, swing: Quat): Vec3 {
  const chain = normalize(subtract(input.target, input.root));
  const poleDirection = input.pole
    ? subtract(input.pole, input.root)
    : // No pole: bend in the plane the limb is already bent in, which keeps the
      // knee pointing where the animator put it.
      subtract(input.mid, input.root);
  const projected = subtract(poleDirection, scale(chain, dot(poleDirection, chain)));
  if (length(projected) < 1e-6) {
    // Degenerate: the pole lies along the chain. Any perpendicular will do.
    const fallback: Vec3 = Math.abs(chain[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    return normalize(cross(chain, fallback));
  }
  void swing;
  return normalize(cross(chain, normalize(projected)));
}

export interface LookAtInput {
  /** Position of the bone doing the looking, in model space. */
  readonly position: ReadonlyVec3;
  readonly target: ReadonlyVec3;
  /** The bone's current forward direction. */
  readonly forward?: ReadonlyVec3;
  readonly up?: ReadonlyVec3;
  /** Maximum rotation from `forward`, in degrees. Keeps heads on necks. */
  readonly maxAngleDegrees?: number;
  /** Blend between the current orientation and the look, in `[0, 1]`. */
  readonly weight?: number;
}

/**
 * A rotation aiming a bone at a target.
 *
 * The angle limit is what stops the classic horror of a head rotating past its
 * neck: beyond the limit the rotation is clamped toward the target rather than
 * snapping to it.
 */
export function solveLookAt(input: LookAtInput): Quat {
  const weight = clamp(input.weight ?? 1, 0, 1);
  const forward = normalize(input.forward ?? [0, 0, -1]);
  const toTarget = subtract(input.target, input.position);
  if (length(toTarget) < 1e-6) return [0, 0, 0, 1];
  const direction = normalize(toTarget);

  const maxAngle = input.maxAngleDegrees === undefined ? Math.PI : (input.maxAngleDegrees * Math.PI) / 180;
  if (!(maxAngle >= 0)) throw new Error("A look-at angle limit must not be negative.");
  const angle = Math.acos(clamp(dot(forward, direction), -1, 1));

  const full = quatLookRotation(direction, input.up ?? [0, 1, 0]);
  if (angle <= maxAngle && weight >= 1) return full;

  // Scale the rotation rather than clamping the direction: interpolating toward
  // the identity keeps the motion smooth as the limit is approached.
  const allowed = angle <= 1e-6 ? 1 : Math.min(1, maxAngle / angle);
  return slerpToIdentity(full, allowed * weight);
}

/** Interpolates a rotation toward identity, used to scale a look-at. */
function slerpToIdentity(rotation: Quat, t: number): Quat {
  const identity: Quat = [0, 0, 0, 1];
  const clamped = clamp(t, 0, 1);
  const dotProduct = rotation[3];
  const sign = dotProduct < 0 ? -1 : 1;
  return normalizeQuat([
    identity[0] + (rotation[0] * sign - identity[0]) * clamped,
    identity[1] + (rotation[1] * sign - identity[1]) * clamped,
    identity[2] + (rotation[2] * sign - identity[2]) * clamped,
    identity[3] + (rotation[3] * sign - identity[3]) * clamped,
  ]);
}

function subtract(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: ReadonlyVec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function dot(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(a: ReadonlyVec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function distance(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function normalize(a: ReadonlyVec3): Vec3 {
  const magnitude = length(a);
  if (magnitude < 1e-9) return [0, 0, -1];
  return [a[0] / magnitude, a[1] / magnitude, a[2] / magnitude];
}

function axisAngle(axis: ReadonlyVec3, radians: number): Quat {
  const half = radians / 2;
  const sin = Math.sin(half);
  return normalizeQuat([axis[0] * sin, axis[1] * sin, axis[2] * sin, Math.cos(half)]);
}
