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
import { type Quat } from "@vapour/math";
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
export declare function solveTwoBoneIk(input: TwoBoneIkInput): TwoBoneIkResult;
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
export declare function solveLookAt(input: LookAtInput): Quat;
//# sourceMappingURL=ik.d.ts.map