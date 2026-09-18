/** Networked rigid bodies: server-authoritative, client-corrected.
 *
 * The server's physics world is the truth. Each replicated body's pose,
 * velocities, and sleep state are packed into `NetState`; a client applies
 * them to its own copy of the body with {@link applyRigidBodyAuthority}, which
 * decides between three responses to disagreement:
 *
 * - **Snap** when the error is large. A body that fell off a ledge on the
 *   server and not on the client is not going to smooth its way down.
 * - **Correct** when the error is small: close a fraction of the gap in pose
 *   and take the server's velocities, so the local simulation carries on from
 *   a nearby state rather than being frozen to the last packet.
 * - **Sleep or wake** to match the server, because a client that keeps
 *   simulating a body the server has put to sleep drifts it every tick.
 *
 * Ownership is the escape hatch: a body owned by a client (the crate the
 * player is carrying) is predicted there, and the server hands it over with an
 * `ownership` message that only the current owner can trigger.
 *
 * `RigidBodyState` is declared here rather than imported from the engine: the
 * engine depends on nothing in this package and this package depends on
 * nothing in the engine, and the shape is small enough that a structural match
 * against `PhysicsBodySnapshot3d` costs less than a dependency edge.
 */
import { angleBetweenQuat, distance, lerpVec3, normalizeQuat, slerp } from "@vapour/math";
import { quantizeState, type NetState } from "./protocol.js";
import type { QuatTuple, Vec3Tuple } from "./transform-sync.js";

/** Structurally identical to the engine's `PhysicsBodySnapshot3d` without `id`. */
export interface RigidBodyState {
  readonly position: Vec3Tuple;
  readonly rotation: QuatTuple;
  readonly linearVelocity: Vec3Tuple;
  readonly angularVelocity: Vec3Tuple;
  readonly sleeping: boolean;
}

/** Wire keys, short because they appear once per body per snapshot. */
export const RIGID_BODY_KEYS = { position: "p", rotation: "r", linearVelocity: "v", angularVelocity: "w", sleeping: "z" } as const;

export const RESTING_BODY: RigidBodyState = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  linearVelocity: [0, 0, 0],
  angularVelocity: [0, 0, 0],
  sleeping: true,
};

export interface PhysicsSyncOptions {
  /** Decimals kept on the wire. Default 2. */
  readonly decimals?: number;
  /** Position error beyond which the client snaps. Default 1 unit. */
  readonly snapThreshold?: number;
  /** Rotation error, in radians, beyond which the client snaps. Default pi/4. */
  readonly snapAngle?: number;
  /** Fraction of a small pose error closed per apply. Default 0.3. */
  readonly correction?: number;
}

function resolve(options: PhysicsSyncOptions): Required<PhysicsSyncOptions> {
  const resolved = {
    decimals: options.decimals ?? 2,
    snapThreshold: options.snapThreshold ?? 1,
    snapAngle: options.snapAngle ?? Math.PI / 4,
    correction: options.correction ?? 0.3,
  };
  if (!Number.isInteger(resolved.decimals) || resolved.decimals < 0) throw new Error("Rigid body decimals must be a non-negative whole number.");
  if (!(resolved.snapThreshold >= 0)) throw new Error("A snap threshold must not be negative.");
  if (!(resolved.snapAngle >= 0)) throw new Error("A snap angle must not be negative.");
  if (!(resolved.correction > 0 && resolved.correction <= 1)) throw new Error("Rigid body correction must lie in (0, 1].");
  return resolved;
}

/**
 * The replicable fields of a body. A sleeping body's velocities are zero by
 * definition, so they are left out: that is most bodies most of the time.
 */
export function packRigidBody(body: RigidBodyState, options: PhysicsSyncOptions = {}): NetState {
  const { decimals } = resolve(options);
  const state: Record<string, readonly number[] | boolean> = {
    [RIGID_BODY_KEYS.position]: body.position,
    [RIGID_BODY_KEYS.rotation]: normalizeQuat(body.rotation),
    [RIGID_BODY_KEYS.sleeping]: body.sleeping,
  };
  if (!body.sleeping) {
    state[RIGID_BODY_KEYS.linearVelocity] = body.linearVelocity;
    state[RIGID_BODY_KEYS.angularVelocity] = body.angularVelocity;
  }
  return quantizeState(state, decimals);
}

/** A body from replicated state, falling back field by field. */
export function unpackRigidBody(state: NetState, fallback: RigidBodyState = RESTING_BODY): RigidBodyState {
  const sleeping = typeof state[RIGID_BODY_KEYS.sleeping] === "boolean" ? (state[RIGID_BODY_KEYS.sleeping] as boolean) : fallback.sleeping;
  const p = state[RIGID_BODY_KEYS.position];
  const r = state[RIGID_BODY_KEYS.rotation];
  const v = state[RIGID_BODY_KEYS.linearVelocity];
  const w = state[RIGID_BODY_KEYS.angularVelocity];
  return {
    position: isVec(p, 3) ? (p as Vec3Tuple) : fallback.position,
    rotation: isVec(r, 4) ? normalizeQuat(r as QuatTuple) : fallback.rotation,
    linearVelocity: sleeping ? [0, 0, 0] : isVec(v, 3) ? (v as Vec3Tuple) : fallback.linearVelocity,
    angularVelocity: sleeping ? [0, 0, 0] : isVec(w, 3) ? (w as Vec3Tuple) : fallback.angularVelocity,
    sleeping,
  };
}

export interface RigidBodyCorrection {
  /** What the client's body should now be. */
  readonly state: RigidBodyState;
  /** The error was past a snap threshold and the authority was taken whole. */
  readonly snapped: boolean;
  /** The client's body was awake and must be put to sleep. */
  readonly sleep: boolean;
  /** The client's body was asleep and must be woken. */
  readonly wake: boolean;
}

/**
 * Reconciles a client's body with the server's.
 *
 * Velocities are always the server's. A pose is something the client can
 * approach gradually; a velocity is not, because integrating the wrong one for
 * even a tick reopens the pose gap the correction just closed.
 */
export function applyRigidBodyAuthority(local: RigidBodyState, authority: RigidBodyState, options: PhysicsSyncOptions = {}): RigidBodyCorrection {
  const resolved = resolve(options);
  const sleep = authority.sleeping && !local.sleeping;
  const wake = !authority.sleeping && local.sleeping;
  const positionError = distance(local.position, authority.position);
  const angleError = angleBetweenQuat(local.rotation, authority.rotation);
  const snapped = positionError > resolved.snapThreshold || angleError > resolved.snapAngle || authority.sleeping;
  if (snapped) return { state: authority, snapped: true, sleep, wake };
  return {
    state: {
      position: lerpVec3(local.position, authority.position, resolved.correction),
      rotation: slerp(local.rotation, authority.rotation, resolved.correction),
      linearVelocity: authority.linearVelocity,
      angularVelocity: authority.angularVelocity,
      sleeping: false,
    },
    snapped: false,
    sleep,
    wake,
  };
}

function isVec(value: unknown, length: number): boolean {
  return Array.isArray(value) && value.length === length && value.every((member) => typeof member === "number" && Number.isFinite(member));
}
