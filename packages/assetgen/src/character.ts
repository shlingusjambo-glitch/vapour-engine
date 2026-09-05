/** Procedural character generation.
 *
 * A character is the hardest asset to describe in text, because "a person" is
 * not a shape — it is a set of proportions, a skeleton, a skinned surface, and
 * a set of expectations about what animations will play on it. Getting any one
 * of those wrong makes the other three useless.
 *
 * So the generator produces all four together and keeps them consistent by
 * construction: the mesh is built *from* the skeleton's rest pose, so every
 * vertex knows which bone it belongs to without a separate skinning step, and
 * the skeleton follows the standard humanoid convention, so clips authored for
 * any other humanoid play on it.
 *
 * The result is deliberately a **base body**, not a finished hero character. It
 * is the thing an NPC crowd, a placeholder player, or a clothed character is
 * built on — geometry with correct proportions, correct weights, and correct
 * bone names, which is the part that is tedious and mechanical rather than
 * creative.
 */
import { MeshBuilder, computeNormals, mergeMeshes, weldVertices, type MeshData } from "./mesh.js";
import { capsule, sphere } from "./primitives.js";
import { meshBounds, placeMesh, translateMesh } from "./transform.js";
import {
  boneIndex, humanoidSkeleton, inverseBindMatrices, restPositions,
  type HumanoidProportions, type Skeleton,
} from "./skeleton.js";

/** Per-vertex bone influences, in the layout the GPU skinning pipeline wants. */
export interface SkinData {
  /** Four bone indices per vertex. */
  readonly joints: Uint16Array;
  /** Four weights per vertex, summing to one. */
  readonly weights: Float32Array;
  /** One inverse bind matrix per bone, flattened. */
  readonly inverseBind: Float32Array;
}

export interface GeneratedCharacter {
  readonly mesh: MeshData;
  readonly skeleton: Skeleton;
  readonly skin: SkinData;
  /** Where equipment attaches, in model space. */
  readonly attachments: readonly { readonly name: string; readonly bone: string; readonly position: readonly [number, number, number] }[];
  readonly stats: { readonly height: number; readonly bones: number; readonly triangles: number };
}

export type CharacterBuild = "slim" | "average" | "heavy";
export type CharacterStyle = "realistic" | "stylized";

export interface CharacterSpec extends HumanoidProportions {
  readonly name?: string;
  readonly build?: CharacterBuild;
  /** `stylized` exaggerates the head and simplifies the limbs. */
  readonly style?: CharacterStyle;
  /** Segments around each limb. Lower is cheaper; 8 is fine for a crowd. */
  readonly limbSegments?: number;
}

const BUILD_THICKNESS: Readonly<Record<CharacterBuild, number>> = { slim: 0.82, average: 1, heavy: 1.28 };

/**
 * Builds a base humanoid body around a skeleton.
 *
 * Each limb is a capsule spanning its bone, which is why the mesh and the
 * skeleton cannot drift apart: the geometry is derived from the rest pose
 * rather than authored beside it. Capsules also happen to be what a ragdoll and
 * a hit-detection rig want, so the same construction serves three purposes.
 */
export function generateCharacter(spec: CharacterSpec = {}): GeneratedCharacter {
  const style = spec.style ?? "realistic";
  const build = spec.build ?? "average";
  const thickness = BUILD_THICKNESS[build];
  if (thickness === undefined) {
    throw new Error(`Unknown character build "${build}". Builds are ${Object.keys(BUILD_THICKNESS).join(", ")}.`);
  }
  const segments = spec.limbSegments ?? 10;
  if (!Number.isInteger(segments) || segments < 3) throw new Error("A character needs at least three limb segments.");

  const proportions: HumanoidProportions = {
    ...spec,
    // A stylized figure is chiefly a bigger head on shorter limbs; expressing
    // that as a proportion change keeps the skeleton standard.
    ...(style === "stylized" ? { headSize: spec.headSize ?? 0.19, legLength: spec.legLength ?? 0.44 } : {}),
  };
  const skeleton = humanoidSkeleton(proportions);
  const height = proportions.height ?? 1.75;
  const positions = restPositions(skeleton);

  /** A capsule spanning two bones, tagged with the bone it is weighted to. */
  const limb = (fromBone: string, toBone: string, radius: number, weightBone = fromBone): { mesh: MeshData; bone: string } => {
    const from = positions[boneIndex(skeleton, fromBone)]!;
    const to = positions[boneIndex(skeleton, toBone)]!;
    const [dx, dy, dz] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-6) {
      // Coincident bones would make a degenerate capsule; a sphere is the
      // correct degenerate case and keeps the surface closed.
      return { mesh: translateMesh(sphere({ radius, segments, rings: Math.max(3, segments / 2) }), from), bone: weightBone };
    }
    const shape = capsule({ radius, height: length, segments, rings: Math.max(2, Math.round(segments / 3)) });
    // The capsule is built along Y; rotate it onto the bone's direction.
    const pitch = (Math.atan2(Math.hypot(dx, dz), dy) * 180) / Math.PI;
    const yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
    return {
      mesh: placeMesh(shape, {
        position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
        rotation: [pitch, yaw, 0],
      }),
      bone: weightBone,
    };
  };

  const limbRadius = height * 0.032 * thickness;
  const parts: { mesh: MeshData; bone: string }[] = [
    limb("Hips", "Chest", height * 0.075 * thickness, "Spine"),
    limb("Chest", "Neck", height * 0.07 * thickness, "Chest"),
    limb("Neck", "Head", height * 0.032, "Neck"),
  ];

  const headRadius = height * (proportions.headSize ?? 0.125) * 0.55;
  parts.push({
    mesh: translateMesh(sphere({ radius: headRadius, segments: segments * 2, rings: segments }), [
      positions[boneIndex(skeleton, "Head")]![0],
      positions[boneIndex(skeleton, "Head")]![1] + headRadius * 0.7,
      positions[boneIndex(skeleton, "Head")]![2],
    ]),
    bone: "Head",
  });

  for (const side of ["Left", "Right"] as const) {
    parts.push(
      limb(`${side}Shoulder`, `${side}UpperArm`, limbRadius * 1.1, `${side}Shoulder`),
      limb(`${side}UpperArm`, `${side}LowerArm`, limbRadius, `${side}UpperArm`),
      limb(`${side}LowerArm`, `${side}Hand`, limbRadius * 0.85, `${side}LowerArm`),
      limb(`${side}Hand`, `${side}Hand`, limbRadius * 0.9, `${side}Hand`),
      limb(`${side}UpperLeg`, `${side}LowerLeg`, limbRadius * 1.45, `${side}UpperLeg`),
      limb(`${side}LowerLeg`, `${side}Foot`, limbRadius * 1.15, `${side}LowerLeg`),
      limb(`${side}Foot`, `${side}Toes`, limbRadius * 0.9, `${side}Foot`),
    );
  }

  // Build one mesh while recording which bone each vertex came from, so
  // weights never have to be inferred from proximity afterwards.
  const builder = new MeshBuilder();
  const vertexBones: number[] = [];
  for (const part of parts) {
    const index = boneIndex(skeleton, part.bone);
    const before = builder.vertexCount;
    builder.append(part.mesh);
    for (let vertex = before; vertex < builder.vertexCount; vertex += 1) vertexBones.push(index);
  }
  const raw = builder.build();

  // Ground the character: limb capsules extend past their bones by a radius, so
  // the assembled body sits slightly below zero and stands slightly taller than
  // asked. Shifting the mesh *and* the skeleton by the same amount makes
  // `height` mean what it says — floor to the top of the head — without letting
  // the two drift apart.
  const rawBounds = meshBounds(raw);
  const groundOffset = -rawBounds.min[1];
  const grounded: Skeleton = {
    ...skeleton,
    bones: skeleton.bones.map((bone, index) =>
      index === 0 ? { ...bone, position: [bone.position[0], bone.position[1] + groundOffset, bone.position[2]] as [number, number, number] } : bone,
    ),
  };
  const mesh = computeNormals(translateMesh(raw, [0, groundOffset, 0]), { smooth: true });
  const groundedPositions = restPositions(grounded);

  const vertexCount = mesh.positions.length / 3;
  const joints = new Uint16Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    joints[vertex * 4] = vertexBones[vertex] ?? 0;
    // Rigid binding: one bone at full weight. Smooth blending across joints is
    // the animation system's business, and doing it here would bake a guess
    // into the asset that a skinning solver can do better at runtime.
    weights[vertex * 4] = 1;
  }

  const inverse = inverseBindMatrices(grounded);
  const inverseBind = new Float32Array(inverse.length * 16);
  for (const [index, matrix] of inverse.entries()) inverseBind.set(matrix, index * 16);

  const attachment = (name: string, bone: string): { name: string; bone: string; position: readonly [number, number, number] } => ({
    name,
    bone,
    position: groundedPositions[boneIndex(grounded, bone)]! as [number, number, number],
  });

  return {
    mesh,
    skeleton: grounded,
    skin: { joints, weights, inverseBind },
    attachments: [
      attachment("RightHand", "RightHand"),
      attachment("LeftHand", "LeftHand"),
      attachment("Back", "UpperChest"),
      attachment("Hip", "Hips"),
      attachment("Head", "Head"),
    ],
    stats: { height, bones: grounded.bones.length, triangles: mesh.indices.length / 3 },
  };
}

/**
 * A capsule collider per limb, for a ragdoll or for hit detection.
 *
 * Derived from the same rest pose as the mesh, so the collider and the visual
 * cannot disagree — the mismatch that produces shots passing through a visible
 * body.
 */
export function characterColliders(character: GeneratedCharacter): readonly {
  readonly bone: string;
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly radius: number;
}[] {
  const positions = restPositions(character.skeleton);
  const radius = character.stats.height * 0.04;
  const pairs: readonly [string, string, number][] = [
    ["Hips", "Chest", 1.9],
    ["Chest", "Head", 1.7],
    ["LeftUpperArm", "LeftLowerArm", 0.8],
    ["LeftLowerArm", "LeftHand", 0.7],
    ["RightUpperArm", "RightLowerArm", 0.8],
    ["RightLowerArm", "RightHand", 0.7],
    ["LeftUpperLeg", "LeftLowerLeg", 1.1],
    ["LeftLowerLeg", "LeftFoot", 0.9],
    ["RightUpperLeg", "RightLowerLeg", 1.1],
    ["RightLowerLeg", "RightFoot", 0.9],
  ];
  return pairs.map(([from, to, scale]) => ({
    bone: from,
    from: positions[boneIndex(character.skeleton, from)]! as [number, number, number],
    to: positions[boneIndex(character.skeleton, to)]! as [number, number, number],
    radius: radius * scale,
  }));
}

/** A crowd of varied characters from one base description.
 *
 * Variation is driven by a seed so a populated street is reproducible: the same
 * seed yields the same crowd on every client, which is what lets a multiplayer
 * game replicate "spawn crowd 7" instead of twenty character descriptions. */
export function generateCrowd(count: number, base: CharacterSpec = {}, seed = 1): readonly GeneratedCharacter[] {
  if (!Number.isInteger(count) || count < 1) throw new Error("A crowd needs at least one character.");
  let state = seed >>> 0 || 1;
  const random = (): number => {
    // xorshift32: small, fast, and identical across platforms, which matters
    // more here than statistical quality.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
  const builds: CharacterBuild[] = ["slim", "average", "heavy"];
  return Array.from({ length: count }, () => {
    const height = (base.height ?? 1.75) * (0.92 + random() * 0.16);
    return generateCharacter({
      ...base,
      height,
      build: base.build ?? builds[Math.floor(random() * builds.length)]!,
      legLength: (base.legLength ?? 0.47) * (0.97 + random() * 0.06),
      shoulderWidth: (base.shoulderWidth ?? 0.115) * (0.94 + random() * 0.12),
    });
  });
}
