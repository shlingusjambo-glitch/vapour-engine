import { describe, expect, it } from "vitest";
import {
  HUMANOID_BONES, boneIndex, buildSkeleton, characterColliders, generateCharacter,
  generateCrowd, humanoidSkeleton, inverseBindMatrices, isHumanoid, meshBounds, meshStats,
  missingHumanoidBones, restMatrices, restPositions, validateSkeleton,
} from "./index.js";
import { multiplyMat4, equalsMat4, identity } from "@vapour/math";

describe("skeletons", () => {
  it("orders bones so every parent precedes its children", () => {
    const skeleton = buildSkeleton("Test", [
      { name: "Hand", parent: "Arm", offset: [0.3, 0, 0] },
      { name: "Root", offset: [0, 1, 0] },
      { name: "Arm", parent: "Root", offset: [0.2, 0, 0] },
    ]);
    expect(skeleton.bones.map((bone) => bone.name)).toEqual(["Root", "Arm", "Hand"]);
    for (const [index, bone] of skeleton.bones.entries()) expect(bone.parent).toBeLessThan(index);
  });

  it("rejects a cycle, a missing parent, and duplicate names", () => {
    expect(() =>
      buildSkeleton("Bad", [{ name: "A", parent: "B", offset: [0, 0, 0] }, { name: "B", parent: "A", offset: [0, 0, 0] }]),
    ).toThrow(/bone cycle/);
    expect(() => buildSkeleton("Bad", [{ name: "A", parent: "Ghost", offset: [0, 0, 0] }])).toThrow(/does not define/);
    expect(() =>
      validateSkeleton({ name: "Bad", bones: [
        { name: "A", parent: -1, position: [0, 0, 0], rotation: [0, 0, 0, 1], length: 1 },
        { name: "A", parent: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], length: 1 },
      ] }),
    ).toThrow(/two bones named "A"/);
    expect(() => buildSkeleton("Empty", [])).toThrow(/at least one bone/);
  });

  it("resolves rest matrices by accumulating down the hierarchy", () => {
    const skeleton = buildSkeleton("Chain", [
      { name: "Root", offset: [0, 1, 0] },
      { name: "Mid", parent: "Root", offset: [0, 1, 0] },
      { name: "Tip", parent: "Mid", offset: [0, 1, 0] },
    ]);
    expect(restPositions(skeleton).map((position) => position[1])).toEqual([1, 2, 3]);
  });

  it("produces inverse bind matrices that undo the rest pose", () => {
    const skeleton = humanoidSkeleton();
    const rest = restMatrices(skeleton);
    const inverse = inverseBindMatrices(skeleton);
    for (const [index, matrix] of rest.entries()) {
      expect(equalsMat4(multiplyMat4(matrix, inverse[index]!), identity(), 1e-5)).toBe(true);
    }
  });

  it("finds bones by name and reports the ones it has when it cannot", () => {
    const skeleton = humanoidSkeleton();
    expect(skeleton.bones[boneIndex(skeleton, "Head")]!.name).toBe("Head");
    expect(() => boneIndex(skeleton, "Tail")).toThrow(/no bone named "Tail".*Bones: Hips/s);
  });
});

describe("humanoidSkeleton", () => {
  it("provides every standard humanoid bone", () => {
    const skeleton = humanoidSkeleton();
    expect(isHumanoid(skeleton)).toBe(true);
    expect(missingHumanoidBones(skeleton)).toEqual([]);
    expect(skeleton.bones).toHaveLength(HUMANOID_BONES.length);
    expect(skeleton.convention).toBe("vapour.humanoid");
  });

  it("scales the whole figure with height", () => {
    const tall = restPositions(humanoidSkeleton({ height: 2 }));
    const short = restPositions(humanoidSkeleton({ height: 1 }));
    const headOf = (positions: readonly (readonly number[])[]) => positions[5]![1]!;
    expect(headOf(tall)).toBeCloseTo(headOf(short) * 2, 5);
  });

  it("places feet near the ground and the head near the top", () => {
    const skeleton = humanoidSkeleton({ height: 1.8 });
    const positions = restPositions(skeleton);
    const foot = positions[boneIndex(skeleton, "LeftFoot")]![1];
    const head = positions[boneIndex(skeleton, "Head")]![1];
    expect(foot).toBeGreaterThanOrEqual(0);
    expect(foot).toBeLessThan(0.2);
    expect(head).toBeGreaterThan(1.4);
    expect(head).toBeLessThan(1.8);
  });

  it("mirrors left and right", () => {
    const skeleton = humanoidSkeleton();
    const positions = restPositions(skeleton);
    const left = positions[boneIndex(skeleton, "LeftHand")]!;
    const right = positions[boneIndex(skeleton, "RightHand")]!;
    expect(left[0]).toBeCloseTo(-right[0], 6);
    expect(left[1]).toBeCloseTo(right[1], 6);
  });

  it("rejects proportions that are not fractions of height", () => {
    expect(() => humanoidSkeleton({ height: 0 })).toThrow(/height must be positive/);
    expect(() => humanoidSkeleton({ legLength: 1.5 })).toThrow(/legLength must be a fraction of height/);
    expect(() => humanoidSkeleton({ headSize: 0 })).toThrow(/headSize must be a fraction/);
  });
});

describe("generateCharacter", () => {
  it("produces a body, a skeleton, and skin weights that agree", () => {
    const character = generateCharacter({ height: 1.8 });
    const vertices = meshStats(character.mesh).vertices;
    expect(character.skin.joints).toHaveLength(vertices * 4);
    expect(character.skin.weights).toHaveLength(vertices * 4);
    expect(character.skin.inverseBind).toHaveLength(character.skeleton.bones.length * 16);
    expect(character.stats.bones).toBe(HUMANOID_BONES.length);
  });

  it("weights every vertex to exactly one valid bone, summing to one", () => {
    const character = generateCharacter();
    const boneCount = character.skeleton.bones.length;
    for (let vertex = 0; vertex < meshStats(character.mesh).vertices; vertex += 1) {
      const weight = character.skin.weights.slice(vertex * 4, vertex * 4 + 4).reduce((sum, value) => sum + value, 0);
      expect(weight).toBeCloseTo(1, 6);
      expect(character.skin.joints[vertex * 4]!).toBeLessThan(boneCount);
    }
  });

  it("stands exactly on the ground, at the height it was asked for", () => {
    for (const height of [1.2, 1.8, 2.4]) {
      const bounds = meshBounds(generateCharacter({ height }).mesh);
      // Feet on y = 0, and the stated height is floor to top of head.
      expect(bounds.min[1]).toBeCloseTo(0, 6);
      expect(bounds.max[1]).toBeGreaterThan(height * 0.95);
      expect(bounds.max[1]).toBeLessThan(height * 1.06);
    }
  });

  it("keeps the skeleton on the ground with the mesh", () => {
    const character = generateCharacter({ height: 1.8 });
    const feet = restPositions(character.skeleton)[boneIndex(character.skeleton, "LeftFoot")]![1];
    // The foot bone sits just above the sole, not below the floor.
    expect(feet).toBeGreaterThan(0);
    expect(feet).toBeLessThan(0.25);
  });

  it("varies thickness with build without changing height", () => {
    const slim = generateCharacter({ height: 1.8, build: "slim" });
    const heavy = generateCharacter({ height: 1.8, build: "heavy" });
    const width = (character: typeof slim) => meshBounds(character.mesh).max[0] - meshBounds(character.mesh).min[0];
    expect(width(heavy)).toBeGreaterThan(width(slim));
    expect(meshBounds(heavy.mesh).max[1]).toBeCloseTo(meshBounds(slim.mesh).max[1], 1);
  });

  it("gives a stylized character a larger head", () => {
    const realistic = generateCharacter({ height: 1.8, style: "realistic" });
    const stylized = generateCharacter({ height: 1.8, style: "stylized" });
    expect(stylized.skeleton.bones[boneIndex(stylized.skeleton, "Head")]!.length)
      .toBeGreaterThan(realistic.skeleton.bones[boneIndex(realistic.skeleton, "Head")]!.length);
  });

  it("exposes attachment points on real bones", () => {
    const character = generateCharacter();
    expect(character.attachments.map((attachment) => attachment.name)).toContain("RightHand");
    for (const attachment of character.attachments) {
      expect(() => boneIndex(character.skeleton, attachment.bone)).not.toThrow();
    }
  });

  it("scales triangle count with limb segments, for crowds", () => {
    const cheap = generateCharacter({ limbSegments: 4 });
    const detailed = generateCharacter({ limbSegments: 16 });
    expect(cheap.stats.triangles).toBeLessThan(detailed.stats.triangles);
    expect(() => generateCharacter({ limbSegments: 2 })).toThrow(/at least three limb segments/);
  });

  it("rejects an unknown build", () => {
    expect(() => generateCharacter({ build: "enormous" as never })).toThrow(/Unknown character build/);
  });
});

describe("characterColliders", () => {
  it("derives a capsule per limb from the same rest pose as the mesh", () => {
    const character = generateCharacter({ height: 1.8 });
    const colliders = characterColliders(character);
    expect(colliders.length).toBeGreaterThanOrEqual(10);
    for (const collider of colliders) {
      expect(collider.radius).toBeGreaterThan(0);
      expect(() => boneIndex(character.skeleton, collider.bone)).not.toThrow();
    }
    // The leg capsules span real distance, so a ragdoll built from them holds up.
    const leg = colliders.find((collider) => collider.bone === "LeftUpperLeg")!;
    expect(Math.abs(leg.from[1] - leg.to[1])).toBeGreaterThan(0.2);
  });
});

describe("generateCrowd", () => {
  it("produces varied characters", () => {
    const crowd = generateCrowd(8, { height: 1.75 }, 42);
    expect(crowd).toHaveLength(8);
    const heights = crowd.map((character) => character.stats.height);
    expect(new Set(heights.map((height) => height.toFixed(4))).size).toBeGreaterThan(1);
    for (const height of heights) {
      expect(height).toBeGreaterThan(1.6);
      expect(height).toBeLessThan(1.9);
    }
  });

  it("is reproducible from its seed, which is what lets a crowd be replicated", () => {
    const first = generateCrowd(5, {}, 7).map((character) => character.stats.height);
    const second = generateCrowd(5, {}, 7).map((character) => character.stats.height);
    const different = generateCrowd(5, {}, 8).map((character) => character.stats.height);
    expect(second).toEqual(first);
    expect(different).not.toEqual(first);
  });

  it("rejects an empty crowd", () => {
    expect(() => generateCrowd(0)).toThrow(/at least one character/);
  });
});
