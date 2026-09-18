/** Ragdoll runtime blend: fading a character between an animated pose and its
 * physics-driven ragdoll bodies.
 *
 * Ragdoll *joints* (see `ragdollJoints` in `physics-3d.ts`) are built once,
 * from the skeleton, when a character is set up. What happens every frame
 * *after* that — a hit ramping a character from animation into physics, and
 * physics ramping back into animation once it recovers — is what lives here.
 *
 * The blend runs in world space and converts back to the skeleton's local
 * pose space, because that is the space `Pose` (and therefore skinning)
 * expects. Only bones a caller supplies a ragdoll transform for are touched;
 * everything else passes the animated pose through untouched, so a partial
 * ragdoll (legs only, say) leaves the rest of the character animating.
 */
import { type Quat, type Vec3 } from "@vapour/math";
import type { Pose } from "../animation/clip.js";
import { type SkinnedSkeleton } from "../animation/skinning.js";
/** A physics body's transform, in world space, for one bone. */
export interface RagdollBodyTransform {
    readonly position: Vec3;
    readonly rotation: Quat;
}
/** Per-bone blend weight: `0` is pure animation, `1` is pure ragdoll. */
export type RagdollWeights = ReadonlyMap<string, number>;
/**
 * Blends an animated pose with dynamic ragdoll body transforms, per bone.
 *
 * A bone with no ragdoll transform, or a weight of `0`, keeps its animated
 * local pose exactly — no world round-trip, no floating-point drift — which
 * is what makes weight `0` reproduce pure animation precisely rather than
 * merely approximately.
 */
export declare function blendRagdollPose(skeleton: SkinnedSkeleton, animatedPose: Pose, ragdollTransforms: ReadonlyMap<string, RagdollBodyTransform>, weights: RagdollWeights, into?: Pose): Pose;
/** A single bone's target once physics takes over: the position, rotation,
 * and velocity a kinematic-then-dynamic body should start from so the
 * hand-off carries the character's existing momentum instead of a pop to
 * rest. Velocities are estimated from two consecutive animated poses. */
export interface RagdollActivationTarget {
    readonly bone: string;
    readonly position: Vec3;
    readonly rotation: Quat;
    readonly linearVelocity: Vec3;
    readonly angularVelocity: Vec3;
}
/**
 * Computes, for each bound bone, the world transform and velocity the
 * animated pose had at the instant ragdoll activates.
 *
 * A caller feeds these into the physics bridge (`setKinematicTarget` /
 * `setLinearVelocity` / `setAngularVelocity`, or directly into the dynamic
 * body's initial state) *before* handing the bone over to the solver.
 */
export declare function ragdollActivationTargets(skeleton: SkinnedSkeleton, bones: readonly string[], poseNow: Pose, posePrevious: Pose, dt: number): readonly RagdollActivationTarget[];
/** Linear ramp, clamped to `[0, 1]`; `duration <= 0` snaps immediately to `1`. */
export declare function rampWeight(elapsed: number, duration: number): number;
export type RagdollBlendPhase = "animated" | "activatingRagdoll" | "ragdoll" | "recoveringToAnimation";
export interface RagdollBlendOptions {
    /** Seconds to ramp from animation into ragdoll. Default `0.25`. */
    readonly rampInSeconds?: number;
    /** Seconds to ramp from ragdoll back into animation. Default `0.4`. */
    readonly rampOutSeconds?: number;
    /** Per-bone weight once fully in ragdoll; bones not listed default to `1`. */
    readonly boneWeights?: RagdollWeights;
}
/**
 * Drives one character's ragdoll ramp and hand-off state.
 *
 * A small stateful wrapper around the pure functions above: it owns nothing
 * but a phase and an elapsed time, and every frame's blended pose is still
 * computed by {@link blendRagdollPose}, so the state machine stays testable
 * without a physics world.
 */
export declare class RagdollBlendController {
    #private;
    constructor(bones: readonly string[], options?: RagdollBlendOptions);
    get phase(): RagdollBlendPhase;
    /** The current effective weight for one bone: `0` animation, `1` ragdoll. */
    weight(bone: string): number;
    /** Every bound bone's current weight, for {@link blendRagdollPose}. */
    weights(): RagdollWeights;
    /**
     * Hands control to physics: starts (or restarts) the ramp into ragdoll and
     * returns the kinematic targets each bound body should start from, so the
     * transition carries the animated pose's momentum.
     */
    activate(skeleton: SkinnedSkeleton, poseNow: Pose, posePrevious: Pose, dt: number): readonly RagdollActivationTarget[];
    /** Starts blending the animated pose back in. */
    recover(): void;
    /** Advances the ramp by `dt`. Returns `true` on the frame recovery
     * completes and control returns fully to the animator. */
    advance(dt: number): boolean;
    /** This frame's blended pose. */
    blend(skeleton: SkinnedSkeleton, animatedPose: Pose, ragdollTransforms: ReadonlyMap<string, RagdollBodyTransform>, into?: Pose): Pose;
}
//# sourceMappingURL=ragdoll-blend.d.ts.map