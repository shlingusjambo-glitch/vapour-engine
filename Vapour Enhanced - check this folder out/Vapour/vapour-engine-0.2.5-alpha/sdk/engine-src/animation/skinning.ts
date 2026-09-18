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
import { compose, multiplyMat4, type Mat4, type Quat, type Vec3 } from "@vapour/math";
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
export function validateSkinnedSkeleton(skeleton: SkinnedSkeleton): SkinnedSkeleton {
  if (skeleton.bones.length === 0) throw new Error("A skinned skeleton needs at least one bone.");
  for (const [index, bone] of skeleton.bones.entries()) {
    if (bone.parent >= index) {
      throw new Error(`Bone "${bone.name}" has parent index ${bone.parent}, which must be less than its own index ${index}.`);
    }
  }
  return skeleton;
}

/**
 * Model-space matrices for a posed skeleton.
 *
 * A bone the pose does not mention keeps its rest transform, so a clip that
 * animates only the legs leaves the arms where they were rather than collapsing
 * them to the origin.
 */
export function poseMatrices(skeleton: SkinnedSkeleton, pose: Pose, into: Mat4[] = []): Mat4[] {
  validateSkinnedSkeleton(skeleton);
  into.length = skeleton.bones.length;
  for (const [index, bone] of skeleton.bones.entries()) {
    const posed = pose.get(bone.name);
    const local = compose(
      posed?.position ?? bone.position,
      posed?.rotation ?? bone.rotation,
      posed?.scale ?? [1, 1, 1],
    );
    into[index] = bone.parent === -1 ? local : multiplyMat4(into[bone.parent]!, local);
  }
  return into;
}

/**
 * Matrices to upload for skinning: model-space times inverse-bind.
 *
 * `inverseBind` comes from the asset — `@vapour/assetgen` produces it, and glTF
 * ships it — because it is a property of the bind pose, not of the animation.
 */
export function skinningMatrices(skeleton: SkinnedSkeleton, pose: Pose, inverseBind: readonly Mat4[], into?: Float32Array): Float32Array {
  if (inverseBind.length !== skeleton.bones.length) {
    throw new Error(`Skinning needs one inverse bind matrix per bone: ${skeleton.bones.length} bones but ${inverseBind.length} matrices.`);
  }
  const model = poseMatrices(skeleton, pose);
  const out = into && into.length === skeleton.bones.length * 16 ? into : new Float32Array(skeleton.bones.length * 16);
  for (let index = 0; index < model.length; index += 1) {
    out.set(multiplyMat4(model[index]!, inverseBind[index]!), index * 16);
  }
  return out;
}

/** Unpacks a flat inverse-bind buffer, as assets store it. */
export function unpackMatrices(flat: Float32Array): Mat4[] {
  if (flat.length % 16 !== 0) throw new Error(`A matrix buffer must be a multiple of 16 floats (got ${flat.length}).`);
  const out: Mat4[] = [];
  for (let index = 0; index < flat.length / 16; index += 1) out.push([...flat.slice(index * 16, index * 16 + 16)]);
  return out;
}

/** World-space bone positions, for debug drawing and for attaching equipment. */
export function bonePositions(skeleton: SkinnedSkeleton, pose: Pose): Vec3[] {
  return poseMatrices(skeleton, pose).map((matrix) => [matrix[12]!, matrix[13]!, matrix[14]!]);
}

/**
 * Root motion: how far the root bone travelled between two poses.
 *
 * Extracting it lets the *character controller* move the character while the
 * clip stays in place, which is what keeps animation and physics agreeing. A
 * clip that moves the root and a controller that also moves the character
 * produce a character travelling at twice the intended speed.
 */
export function rootMotionDelta(skeleton: SkinnedSkeleton, from: Pose, to: Pose): Vec3 {
  const root = skeleton.bones[0];
  if (!root) throw new Error("A skeleton with no bones has no root motion.");
  const before = from.get(root.name)?.position ?? root.position;
  const after = to.get(root.name)?.position ?? root.position;
  return [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
}

/** Removes the root bone's horizontal translation, so a clip animates in place. */
export function stripRootMotion(skeleton: SkinnedSkeleton, pose: Pose): Pose {
  const root = skeleton.bones[0];
  if (!root) return pose;
  const posed = pose.get(root.name);
  if (posed?.position) {
    // Vertical motion is kept: a jump's arc is animation, not locomotion.
    posed.position = [root.position[0], posed.position[1], root.position[2]];
  }
  return pose;
}
