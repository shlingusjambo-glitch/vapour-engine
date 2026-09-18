/** Turning a pose into the matrices a skinned mesh is drawn with.
 *
 * The skeleton type here is deliberately **structural**, not imported from the
 * asset system. The engine must be able to skin a character that came from
 * glTF, from `@vapour/assetgen`, or from a game's own code, and requiring one
 * concrete class would couple the renderer to whichever produced it. Anything
 * with named bones, parent indices, and rest transforms qualifies.
 *
 * The pipeline is three steps, and the order matters:
 *
 * 1. **Local** — a pose overrides parts of each bone's rest transform.
 * 2. **Model** — locals accumulate down the hierarchy in one forward pass.
 * 3. **Skinning** — model times inverse-bind, which is what the shader wants.
 *
 * Skipping step 3 and uploading model matrices is the single most common
 * skinning bug: the mesh explodes outward, because every vertex gets its bone's
 * full transform applied on top of where it already was.
 */
import { type Mat4, type Quat, type Vec3 } from "@vapour/math";
import type { Pose } from "./clip.js";
/** The minimum a skeleton must provide to be skinned. */
export interface SkinnedBone {
    readonly name: string;
    /** Parent index, or `-1` for a root. Parents must precede children. */
    readonly parent: number;
    readonly position: Vec3;
    readonly rotation: Quat;
}
export interface SkinnedSkeleton {
    readonly bones: readonly SkinnedBone[];
}
/** Validates the ordering invariant every consumer here relies on. */
export declare function validateSkinnedSkeleton(skeleton: SkinnedSkeleton): SkinnedSkeleton;
/**
 * Model-space matrices for a posed skeleton.
 *
 * A bone the pose does not mention keeps its rest transform, so a clip that
 * animates only the legs leaves the arms where they were rather than collapsing
 * them to the origin.
 */
export declare function poseMatrices(skeleton: SkinnedSkeleton, pose: Pose, into?: Mat4[]): Mat4[];
/**
 * Matrices to upload for skinning: model-space times inverse-bind.
 *
 * `inverseBind` comes from the asset — `@vapour/assetgen` produces it, and glTF
 * ships it — because it is a property of the bind pose, not of the animation.
 */
export declare function skinningMatrices(skeleton: SkinnedSkeleton, pose: Pose, inverseBind: readonly Mat4[], into?: Float32Array): Float32Array;
/** Unpacks a flat inverse-bind buffer, as assets store it. */
export declare function unpackMatrices(flat: Float32Array): Mat4[];
/** World-space bone positions, for debug drawing and for attaching equipment. */
export declare function bonePositions(skeleton: SkinnedSkeleton, pose: Pose): Vec3[];
/**
 * Root motion: how far the root bone travelled between two poses.
 *
 * Extracting it lets the *character controller* move the character while the
 * clip stays in place, which is what keeps animation and physics agreeing. A
 * clip that moves the root and a controller that also moves the character
 * produce a character travelling at twice the intended speed.
 */
export declare function rootMotionDelta(skeleton: SkinnedSkeleton, from: Pose, to: Pose): Vec3;
/** Removes the root bone's horizontal translation, so a clip animates in place. */
export declare function stripRootMotion(skeleton: SkinnedSkeleton, pose: Pose): Pose;
//# sourceMappingURL=skinning.d.ts.map