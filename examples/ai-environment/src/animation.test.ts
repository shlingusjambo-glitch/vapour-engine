import { describe, expect, it } from "vitest";
import {
  Animator, bonePositions, poseMatrices, samplePose, skinningMatrices, solveLookAt,
  solveTwoBoneIk, unpackMatrices, type AnimationClip, type Pose, type SkinnedSkeleton,
} from "@vapour/engine";
import { equalsMat4, identity } from "@vapour/math";
import { generateCharacter } from "@vapour/assetgen";

/**
 * The asset system and the animation system meet here.
 *
 * A generated character is only useful if a clip authored against the standard
 * humanoid convention plays on it without adaptation — that is the entire
 * argument for generating a *named* skeleton rather than an arbitrary one, and
 * this is where the claim is checked.
 */
describe("animating a generated character", () => {
  const character = generateCharacter({ height: 1.8, limbSegments: 6 });
  // The generated skeleton satisfies the engine's structural skeleton type with
  // no adapter, which is the point of defining that type structurally.
  const skeleton: SkinnedSkeleton = character.skeleton;

  /** A clip authored against humanoid bone names, knowing nothing else. */
  const wave: AnimationClip = {
    name: "wave",
    duration: 1,
    loop: "loop",
    channels: [
      {
        target: "RightUpperArm",
        property: "rotation",
        keyframes: [
          { time: 0, value: [0, 0, 0, 1] },
          { time: 0.5, value: [0, 0, 0.7071068, 0.7071068] },
          { time: 1, value: [0, 0, 0, 1] },
        ],
      },
    ],
  };

  it("plays a humanoid clip on a generated skeleton with no adaptation", () => {
    const animator = new Animator();
    animator.play(wave);
    const pose = animator.update(0.5);
    expect(pose.has("RightUpperArm")).toBe(true);
    // The clip's target exists on the generated skeleton.
    expect(skeleton.bones.some((bone) => bone.name === "RightUpperArm")).toBe(true);
  });

  it("moves the arm and leaves every other bone at rest", () => {
    const rest = bonePositions(skeleton, new Map());
    const posed = bonePositions(skeleton, samplePose(wave, 0.5));

    const armIndex = skeleton.bones.findIndex((bone) => bone.name === "RightHand");
    const headIndex = skeleton.bones.findIndex((bone) => bone.name === "Head");
    const movedArm = Math.hypot(...posed[armIndex]!.map((value, axis) => value - rest[armIndex]![axis]!));
    const movedHead = Math.hypot(...posed[headIndex]!.map((value, axis) => value - rest[headIndex]![axis]!));

    expect(movedArm).toBeGreaterThan(0.1);
    // A clip animating one arm must not disturb anything else.
    expect(movedHead).toBeCloseTo(0, 6);
  });

  it("produces identity skinning matrices for the rest pose", () => {
    const inverseBind = unpackMatrices(character.skin.inverseBind);
    const matrices = unpackMatrices(skinningMatrices(skeleton, new Map(), inverseBind));
    // A character standing in its bind pose must not deform at all — the check
    // that catches a mismatched inverse-bind set immediately.
    for (const matrix of matrices) expect(equalsMat4(matrix, identity(), 1e-4)).toBe(true);
  });

  it("produces one skinning matrix per bone, matching the mesh's joint indices", () => {
    const inverseBind = unpackMatrices(character.skin.inverseBind);
    const flat = skinningMatrices(skeleton, samplePose(wave, 0.25), inverseBind);
    expect(flat).toHaveLength(skeleton.bones.length * 16);
    for (const joint of character.skin.joints) expect(joint).toBeLessThan(skeleton.bones.length);
    for (const value of flat) expect(Number.isFinite(value)).toBe(true);
  });

  it("drives the same clip on characters of different proportions", () => {
    // One clip, three body shapes: the payoff of a named skeleton convention.
    for (const spec of [{ height: 1.2 }, { height: 1.8, build: "heavy" as const }, { height: 2.4, style: "stylized" as const }]) {
      const other = generateCharacter({ ...spec, limbSegments: 4 });
      const posed = bonePositions(other.skeleton, samplePose(wave, 0.5));
      for (const position of posed) {
        for (const component of position) expect(Number.isFinite(component)).toBe(true);
      }
      expect(posed).toHaveLength(other.skeleton.bones.length);
    }
  });

  it("plants a foot on uneven ground with two-bone IK", () => {
    const rest = bonePositions(skeleton, new Map());
    const index = (name: string): number => skeleton.bones.findIndex((bone) => bone.name === name);
    const result = solveTwoBoneIk({
      root: rest[index("LeftUpperLeg")]!,
      mid: rest[index("LeftLowerLeg")]!,
      tip: rest[index("LeftFoot")]!,
      // A step up onto a 15 cm kerb.
      target: [rest[index("LeftFoot")]![0], rest[index("LeftFoot")]![1] + 0.15, rest[index("LeftFoot")]![2]],
      pole: [rest[index("LeftUpperLeg")]![0], rest[index("LeftLowerLeg")]![1], rest[index("LeftLowerLeg")]![2] + 1],
    });
    expect(result.stretched).toBe(false);
    for (const component of result.rootRotation) expect(Number.isFinite(component)).toBe(true);
  });

  it("aims the head at a target within a neck's range", () => {
    const rest = bonePositions(skeleton, new Map());
    const head = rest[skeleton.bones.findIndex((bone) => bone.name === "Head")]!;
    const rotation = solveLookAt({ position: head, target: [head[0] + 2, head[1], head[2] - 3], maxAngleDegrees: 70 });
    expect(Math.hypot(...rotation)).toBeCloseTo(1, 6);
  });

  it("keeps a full animator update finite across a whole loop", () => {
    const animator = new Animator();
    animator.play(wave);
    const inverseBind = unpackMatrices(character.skin.inverseBind);
    for (let step = 0; step < 60; step += 1) {
      const pose: Pose = animator.update(1 / 60);
      const matrices = poseMatrices(skeleton, pose);
      expect(matrices).toHaveLength(skeleton.bones.length);
      for (const value of skinningMatrices(skeleton, pose, inverseBind)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
