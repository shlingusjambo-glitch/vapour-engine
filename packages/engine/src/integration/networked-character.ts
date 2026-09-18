/** Networked animated characters: server rigid-body authority + client root motion.
 *
 * Two systems both want to move the same character. The animator's root
 * motion says "this walk cycle carried the root 0.03 m forward this frame";
 * the server's rigid-body snapshot says "the body is at (4, 0, 7)". Applied
 * blindly, both together move the character twice, and applied in the wrong
 * order the snapshot snaps the character back to where it was a packet ago
 * every tick.
 *
 * The rule here:
 *
 * - **Between snapshots, root motion wins.** It is the client's prediction:
 *   the character walks smoothly at the clip's pace, rotated into the facing
 *   the client is rendering.
 * - **When a snapshot arrives, the server wins.** The predicted pose is handed
 *   to the reconciler (`applyRigidBodyAuthority` from `@vapour/net`), which
 *   snaps on a large error and closes a fraction of a small one. Velocities
 *   are the server's regardless — root motion never sets them.
 *
 * `@vapour/engine` cannot depend on `@vapour/net`, so the body state and the
 * reconciler are typed structurally: `NetworkedBodyState` is field-for-field
 * `RigidBodyState`, and `BodyReconciler` is `applyRigidBodyAuthority` with its
 * options bound. Pass the real function:
 *
 * ```ts
 * const character = new NetworkedCharacter(spawn, { skeleton, reconcile: (l, a) => applyRigidBodyAuthority(l, a, { snapThreshold: 0.5 }) });
 * character.animate(animator.update(dt));          // every frame
 * character.reconcile(unpackRigidBody(entity.state)); // every snapshot
 * ```
 */
import { add, rotateVector, type Quat, type Vec3 } from "@vapour/math";
import type { Pose } from "../animation/clip.js";
import { rootMotionDelta, type SkinnedSkeleton } from "../animation/skinning.js";

/** Structurally identical to `@vapour/net`'s `RigidBodyState` and to `PhysicsBodySnapshot3d` without `id`. */
export interface NetworkedBodyState {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly linearVelocity: readonly [number, number, number];
  readonly angularVelocity: readonly [number, number, number];
  readonly sleeping: boolean;
}

/** The shape of `applyRigidBodyAuthority(local, authority, options)` with options bound. */
export type BodyReconciler = (local: NetworkedBodyState, authority: NetworkedBodyState) => { readonly state: NetworkedBodyState; readonly snapped: boolean };

export interface NetworkedCharacterOptions {
  readonly skeleton: SkinnedSkeleton;
  readonly reconcile: BodyReconciler;
  /**
   * A root delta longer than this in one frame is a loop wrap or a clip
   * change, not locomotion, and is dropped. Default 1 m.
   */
  readonly maxStep?: number;
}

export interface NetworkedCharacterReconciliation {
  /** The server's pose was taken whole; any root motion since the last snapshot was discarded. */
  readonly snapped: boolean;
  /** Distance between the predicted and authoritative position before correction. */
  readonly error: number;
}

export class NetworkedCharacter {
  readonly #skeleton: SkinnedSkeleton;
  readonly #reconcile: BodyReconciler;
  readonly #maxStep: number;
  #state: NetworkedBodyState;
  #previousPose: Pose | undefined;

  constructor(initial: NetworkedBodyState, options: NetworkedCharacterOptions) {
    this.#skeleton = options.skeleton;
    this.#reconcile = options.reconcile;
    this.#maxStep = options.maxStep ?? 1;
    if (!(this.#maxStep > 0)) throw new Error("A networked character's max root step must be positive.");
    this.#state = initial;
  }

  /** What the client renders this frame. */
  get state(): NetworkedBodyState {
    return this.#state;
  }

  /**
   * Applies one frame of root motion. The delta is measured against the pose
   * from the previous call, rotated by the rendered facing, and added to the
   * position. The first call after construction or a snap only records the
   * pose, so a clip does not lurch on its first frame.
   */
  animate(pose: Pose): Vec3 {
    const previous = this.#previousPose;
    // Poses are reused by the animator, so keep a copy of the root only.
    this.#previousPose = new Map([[this.#skeleton.bones[0]!.name, { ...pose.get(this.#skeleton.bones[0]!.name) }]]);
    if (!previous) return [0, 0, 0];
    const local = rootMotionDelta(this.#skeleton, previous, pose);
    if (Math.hypot(local[0], local[1], local[2]) > this.#maxStep) return [0, 0, 0];
    const world = rotateVector(this.#state.rotation as Quat, local);
    this.#state = { ...this.#state, position: add(this.#state.position, world) as [number, number, number] };
    return world;
  }

  /** Reconciles the predicted pose with a server snapshot. Server velocities and sleep always win. */
  reconcile(authority: NetworkedBodyState): NetworkedCharacterReconciliation {
    const before = this.#state.position;
    const result = this.#reconcile(this.#state, authority);
    this.#state = result.state;
    if (result.snapped) this.#previousPose = undefined;
    return { snapped: result.snapped, error: Math.hypot(before[0] - authority.position[0], before[1] - authority.position[1], before[2] - authority.position[2]) };
  }
}
