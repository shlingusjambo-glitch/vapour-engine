/** Skeletons and rigging metadata.
 *
 * A generated character is useless without a skeleton: it cannot be animated,
 * cannot be retargeted, and cannot share a walk cycle with anything else. So
 * the character generator produces a rig alongside the mesh, and it produces a
 * **named, standard** rig rather than an arbitrary one.
 *
 * That naming is the whole point. If every generated character has a bone
 * called `LeftUpperArm` in the same place in the hierarchy, one animation clip
 * plays on all of them, a retargeter can map to and from other engines' rigs,
 * and an IK solver can find the chain it needs without being told. An arbitrary
 * per-character skeleton would make each one an island.
 *
 * Bone transforms are stored in **parent space**, matching the engine's
 * transform hierarchy and glTF's node convention, so a generated skeleton needs
 * no conversion to be posed by the animation system.
 */
import { compose, decompose, multiplyMat4, quatFromEuler, type Mat4, type Quat, type Vec3 } from "@vapour/math";

export interface Bone {
  readonly name: string;
  /** Index of the parent bone, or `-1` for the root. Parents precede children. */
  readonly parent: number;
  /** Rest position in parent space. */
  readonly position: Vec3;
  /** Rest rotation in parent space. */
  readonly rotation: Quat;
  /** Distance to this bone's tip, for IK and for debug drawing. */
  readonly length: number;
}

export interface Skeleton {
  readonly name: string;
  readonly bones: readonly Bone[];
  /** Standard rig this skeleton conforms to, if any. */
  readonly convention?: "vapour.humanoid";
}

/**
 * The standard humanoid bone names.
 *
 * Deliberately the same set most engines and motion-capture pipelines use, so
 * that clips authored elsewhere map on without a hand-written table.
 */
export const HUMANOID_BONES = [
  "Hips",
  "Spine", "Chest", "UpperChest", "Neck", "Head",
  "LeftShoulder", "LeftUpperArm", "LeftLowerArm", "LeftHand",
  "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand",
  "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "LeftToes",
  "RightUpperLeg", "RightLowerLeg", "RightFoot", "RightToes",
] as const;

export type HumanoidBoneName = (typeof HUMANOID_BONES)[number];

export function validateSkeleton(skeleton: Skeleton): Skeleton {
  if (skeleton.bones.length === 0) throw new Error(`Skeleton "${skeleton.name}" has no bones.`);
  const names = new Set<string>();
  for (const [index, bone] of skeleton.bones.entries()) {
    if (!bone.name.trim()) throw new Error(`Bone ${index} in "${skeleton.name}" has an empty name.`);
    if (names.has(bone.name)) throw new Error(`Skeleton "${skeleton.name}" has two bones named "${bone.name}".`);
    names.add(bone.name);
    if (bone.parent >= index) {
      // Parents preceding children is what lets world transforms be resolved in
      // a single forward pass, which every consumer of this data relies on.
      throw new Error(`Bone "${bone.name}" has parent index ${bone.parent}, which must be less than its own index ${index}.`);
    }
    if (bone.parent < -1) throw new Error(`Bone "${bone.name}" has an invalid parent index ${bone.parent}.`);
    if (!(bone.length >= 0)) throw new Error(`Bone "${bone.name}" has a negative length.`);
  }
  if (skeleton.bones[0]!.parent !== -1) throw new Error(`Skeleton "${skeleton.name}" must start with a root bone.`);
  return skeleton;
}

export function boneIndex(skeleton: Skeleton, name: string): number {
  const index = skeleton.bones.findIndex((bone) => bone.name === name);
  if (index < 0) {
    throw new Error(`Skeleton "${skeleton.name}" has no bone named "${name}". Bones: ${skeleton.bones.map((bone) => bone.name).join(", ")}.`);
  }
  return index;
}

/** Rest-pose model-space matrices, resolved in one forward pass. */
export function restMatrices(skeleton: Skeleton): Mat4[] {
  validateSkeleton(skeleton);
  const matrices: Mat4[] = [];
  for (const bone of skeleton.bones) {
    const local = compose(bone.position, bone.rotation, [1, 1, 1]);
    matrices.push(bone.parent === -1 ? local : multiplyMat4(matrices[bone.parent]!, local));
  }
  return matrices;
}

/**
 * Inverse bind matrices: the transform from model space into each bone's rest
 * space. Skinning needs exactly these, and computing them here means a
 * generated character arrives ready to skin.
 */
export function inverseBindMatrices(skeleton: Skeleton): Mat4[] {
  return restMatrices(skeleton).map((matrix) => {
    const parts = decompose(matrix);
    // Invert a rigid transform by transposing the rotation and negating the
    // rotated translation — cheaper and stabler than a general inverse.
    const inverseRotation: Quat = [-parts.rotation[0], -parts.rotation[1], -parts.rotation[2], parts.rotation[3]];
    const rotated = rotateVec(inverseRotation, parts.translation);
    return compose([-rotated[0], -rotated[1], -rotated[2]], inverseRotation, [1, 1, 1]);
  });
}

/** Rest-pose model-space positions, for placing geometry and debug drawing. */
export function restPositions(skeleton: Skeleton): Vec3[] {
  return restMatrices(skeleton).map((matrix) => [matrix[12]!, matrix[13]!, matrix[14]!]);
}

export interface SkeletonBuilderBone {
  readonly name: string;
  readonly parent?: string;
  /** Offset from the parent bone, in parent space. */
  readonly offset: readonly number[];
  readonly rotation?: readonly number[];
  readonly length?: number;
}

/**
 * Builds a skeleton from parent-named bones, in any order.
 *
 * Ordering by name and then topologically sorting is a small convenience that
 * removes a whole class of mistake: an author adding a bone no longer has to
 * work out where in the array it belongs.
 */
export function buildSkeleton(name: string, bones: readonly SkeletonBuilderBone[], convention?: Skeleton["convention"]): Skeleton {
  if (bones.length === 0) throw new Error(`Skeleton "${name}" needs at least one bone.`);
  const byName = new Map(bones.map((bone) => [bone.name, bone]));
  const ordered: SkeletonBuilderBone[] = [];
  const placed = new Set<string>();

  const visit = (bone: SkeletonBuilderBone, chain: readonly string[]): void => {
    if (placed.has(bone.name)) return;
    if (chain.includes(bone.name)) throw new Error(`Skeleton "${name}" has a bone cycle: ${[...chain, bone.name].join(" -> ")}.`);
    if (bone.parent !== undefined) {
      const parent = byName.get(bone.parent);
      if (!parent) throw new Error(`Bone "${bone.name}" names parent "${bone.parent}", which this skeleton does not define.`);
      visit(parent, [...chain, bone.name]);
    }
    placed.add(bone.name);
    ordered.push(bone);
  };
  for (const bone of bones) visit(bone, []);

  const indexOf = new Map(ordered.map((bone, index) => [bone.name, index]));
  return validateSkeleton({
    name,
    ...(convention ? { convention } : {}),
    bones: ordered.map((bone) => ({
      name: bone.name,
      parent: bone.parent === undefined ? -1 : indexOf.get(bone.parent)!,
      position: [bone.offset[0] ?? 0, bone.offset[1] ?? 0, bone.offset[2] ?? 0] as Vec3,
      rotation: quatFromEuler(bone.rotation ?? [0, 0, 0]),
      length: bone.length ?? Math.hypot(bone.offset[0] ?? 0, bone.offset[1] ?? 0, bone.offset[2] ?? 0),
    })),
  });
}

export interface HumanoidProportions {
  /** Total height in metres, from floor to the top of the head. */
  readonly height?: number;
  /** Shoulder width as a fraction of height. */
  readonly shoulderWidth?: number;
  /** Hip width as a fraction of height. */
  readonly hipWidth?: number;
  /** Leg length as a fraction of height. */
  readonly legLength?: number;
  /** Arm length as a fraction of height. */
  readonly armLength?: number;
  /** Head height as a fraction of total height. */
  readonly headSize?: number;
}

/**
 * A standard humanoid skeleton, scaled by proportions.
 *
 * The defaults are roughly canonical adult proportions — an eight-heads figure
 * with legs at a little under half the total height. Every value is a *fraction
 * of height* rather than an absolute measurement, so changing one number
 * produces a consistent character rather than a broken one, and a child, an
 * adult, and a stylized figure with a huge head are all the same call.
 */
export function humanoidSkeleton(proportions: HumanoidProportions = {}): Skeleton {
  const height = proportions.height ?? 1.75;
  if (!(height > 0)) throw new Error("A humanoid's height must be positive.");
  const shoulderWidth = fraction(proportions.shoulderWidth ?? 0.115, "shoulderWidth");
  const hipWidth = fraction(proportions.hipWidth ?? 0.055, "hipWidth");
  const legLength = fraction(proportions.legLength ?? 0.47, "legLength");
  const armLength = fraction(proportions.armLength ?? 0.34, "armLength");
  const headSize = fraction(proportions.headSize ?? 0.125, "headSize");

  const hipHeight = height * legLength;
  const neckLength = height * 0.04;
  // The spine is derived, not guessed: the Head bone must land at the *base* of
  // the skull, so that hips + spine + neck + skull equals the stated height.
  // Choosing a spine length independently is how a generator ends up producing
  // a 1.8m character that measures 2.01m.
  const spineToHead = height * (1 - headSize) - neckLength - hipHeight;
  if (spineToHead <= 0) {
    throw new Error(
      `A humanoid with legLength ${legLength} and headSize ${headSize} leaves no room for a torso. Their sum must be well under 1.`,
    );
  }
  // Spine, Chest, and UpperChest are full segments; Neck sits 0.8 of one above.
  const spineLength = spineToHead / 3.8;
  const upperLeg = hipHeight * 0.52;
  const lowerLeg = hipHeight * 0.44;
  const upperArm = height * armLength * 0.45;
  const lowerArm = height * armLength * 0.42;

  const bones: SkeletonBuilderBone[] = [
    { name: "Hips", offset: [0, hipHeight, 0], length: spineLength },
    { name: "Spine", parent: "Hips", offset: [0, spineLength, 0], length: spineLength },
    { name: "Chest", parent: "Spine", offset: [0, spineLength, 0], length: spineLength },
    { name: "UpperChest", parent: "Chest", offset: [0, spineLength, 0], length: spineLength * 0.8 },
    { name: "Neck", parent: "UpperChest", offset: [0, spineLength * 0.8, 0], length: neckLength },
    { name: "Head", parent: "Neck", offset: [0, neckLength, 0], length: height * headSize },
  ];

  for (const side of ["Left", "Right"] as const) {
    const sign = side === "Left" ? 1 : -1;
    bones.push(
      { name: `${side}Shoulder`, parent: "UpperChest", offset: [sign * height * shoulderWidth * 0.4, spineLength * 0.6, 0], length: height * shoulderWidth * 0.6 },
      { name: `${side}UpperArm`, parent: `${side}Shoulder`, offset: [sign * height * shoulderWidth * 0.6, 0, 0], length: upperArm },
      { name: `${side}LowerArm`, parent: `${side}UpperArm`, offset: [sign * upperArm, 0, 0], length: lowerArm },
      { name: `${side}Hand`, parent: `${side}LowerArm`, offset: [sign * lowerArm, 0, 0], length: height * 0.055 },
      { name: `${side}UpperLeg`, parent: "Hips", offset: [sign * height * hipWidth, 0, 0], length: upperLeg },
      { name: `${side}LowerLeg`, parent: `${side}UpperLeg`, offset: [0, -upperLeg, 0], length: lowerLeg },
      { name: `${side}Foot`, parent: `${side}LowerLeg`, offset: [0, -lowerLeg, 0], length: height * 0.04 },
      { name: `${side}Toes`, parent: `${side}Foot`, offset: [0, -height * 0.025, height * 0.075], length: height * 0.03 },
    );
  }

  return buildSkeleton("Humanoid", bones, "vapour.humanoid");
}

/** True when a skeleton provides every standard humanoid bone, so a clip
 * authored for the convention will play on it. */
export function isHumanoid(skeleton: Skeleton): boolean {
  const names = new Set(skeleton.bones.map((bone) => bone.name));
  return HUMANOID_BONES.every((bone) => names.has(bone));
}

/** Bones missing from a skeleton that claims the humanoid convention. */
export function missingHumanoidBones(skeleton: Skeleton): readonly HumanoidBoneName[] {
  const names = new Set(skeleton.bones.map((bone) => bone.name));
  return HUMANOID_BONES.filter((bone) => !names.has(bone));
}

function fraction(value: number, label: string): number {
  if (!(value > 0 && value < 1)) throw new Error(`A humanoid's ${label} must be a fraction of height in (0, 1) (got ${value}).`);
  return value;
}

function rotateVec(rotation: Quat, vector: Vec3): Vec3 {
  const [x, y, z, w] = rotation;
  const tx = 2 * (y * vector[2] - z * vector[1]);
  const ty = 2 * (z * vector[0] - x * vector[2]);
  const tz = 2 * (x * vector[1] - y * vector[0]);
  return [
    vector[0] + w * tx + y * tz - z * ty,
    vector[1] + w * ty + z * tx - x * tz,
    vector[2] + w * tz + x * ty - y * tx,
  ];
}
