import { describe, expect, it } from "vitest";
import { equalsMat4, identity, multiplyMat4, quatFromEuler, transformPoint, } from "@vapour/math";
import { bonePositions, buildRetargetMap, canonicalBoneName, poseMatrices, retargetPose, rootMotionDelta, samplePose, skinningMatrices, solveLookAt, solveTwoBoneIk, stripRootMotion, unpackMatrices, validateSkinnedSkeleton, } from "./index.js";
/** A three-bone vertical chain: root at y=0, mid at +1, tip at +1 more. */
const chain = {
    bones: [
        { name: "Root", parent: -1, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        { name: "Mid", parent: 0, position: [0, 1, 0], rotation: [0, 0, 0, 1] },
        { name: "Tip", parent: 1, position: [0, 1, 0], rotation: [0, 0, 0, 1] },
    ],
};
describe("poseMatrices", () => {
    it("accumulates transforms down the hierarchy", () => {
        const positions = bonePositions(chain, new Map());
        expect(positions[0]).toEqual([0, 0, 0]);
        expect(positions[1]).toEqual([0, 1, 0]);
        expect(positions[2]).toEqual([0, 2, 0]);
    });
    it("keeps the rest transform for bones the pose does not mention", () => {
        // A clip animating only the legs must not collapse the arms to the origin.
        const pose = new Map([
            ["Root", { position: [5, 0, 0] }],
        ]);
        const positions = bonePositions(chain, pose);
        expect(positions[0]).toEqual([5, 0, 0]);
        expect(positions[2]).toEqual([5, 2, 0]);
    });
    it("propagates a parent's rotation to its children", () => {
        const pose = new Map([
            ["Root", { rotation: quatFromEuler([0, 0, 90]) }],
        ]);
        const positions = bonePositions(chain, pose);
        // A quarter turn about Z swings the chain onto -X.
        expect(positions[2][0]).toBeCloseTo(-2, 5);
        expect(positions[2][1]).toBeCloseTo(0, 5);
    });
    it("requires parents to precede children", () => {
        expect(() => validateSkinnedSkeleton({
            bones: [
                { name: "A", parent: 1, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
            ],
        })).toThrow(/must be less than its own index/);
        expect(() => validateSkinnedSkeleton({ bones: [] })).toThrow(/at least one bone/);
    });
});
describe("skinningMatrices", () => {
    /** Inverse bind for the rest pose: each bone's model matrix, inverted. */
    const inverseBind = [
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1],
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -2, 0, 1],
    ];
    it("produces identity for the bind pose, so a rest mesh does not move", () => {
        // Uploading model matrices instead of model x inverse-bind is the classic
        // skinning bug: the mesh explodes outward.
        const matrices = unpackMatrices(skinningMatrices(chain, new Map(), inverseBind));
        for (const matrix of matrices)
            expect(equalsMat4(matrix, identity(), 1e-6)).toBe(true);
    });
    it("moves a bound vertex with its bone", () => {
        const pose = new Map([
            ["Root", { position: [3, 0, 0] }],
        ]);
        const matrices = unpackMatrices(skinningMatrices(chain, pose, inverseBind));
        // A vertex at the tip's rest position, bound to the tip bone.
        expect(transformPoint(matrices[2], [0, 2, 0])).toEqual([3, 2, 0]);
    });
    it("reuses a caller-supplied buffer", () => {
        const buffer = new Float32Array(chain.bones.length * 16);
        expect(skinningMatrices(chain, new Map(), inverseBind, buffer)).toBe(buffer);
    });
    it("rejects a mismatched inverse bind set", () => {
        expect(() => skinningMatrices(chain, new Map(), inverseBind.slice(0, 2))).toThrow(/3 bones but 2 matrices/);
        expect(() => unpackMatrices(new Float32Array(17))).toThrow(/multiple of 16/);
    });
});
describe("root motion", () => {
    const walk = {
        name: "walk",
        duration: 1,
        channels: [
            {
                target: "Root",
                property: "position",
                keyframes: [
                    { time: 0, value: [0, 0, 0] },
                    { time: 1, value: [0, 0, -2] },
                ],
            },
        ],
    };
    it("reports how far the root travelled between poses", () => {
        const delta = rootMotionDelta(chain, samplePose(walk, 0), samplePose(walk, 1));
        expect(delta).toEqual([0, 0, -2]);
    });
    it("strips horizontal travel but keeps vertical, so a jump still arcs", () => {
        const pose = new Map([
            ["Root", { position: [3, 1.5, -4] }],
        ]);
        const stripped = stripRootMotion(chain, pose);
        expect(stripped.get("Root").position).toEqual([0, 1.5, 0]);
    });
});
describe("runtime retargeting", () => {
    const tall = {
        bones: [
            {
                name: "mixamorig:Hips",
                parent: -1,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
            },
            {
                name: "mixamorig:Mid",
                parent: 0,
                position: [0, 2, 0],
                rotation: [0, 0, 0, 1],
            },
            {
                name: "mixamorig:Tip",
                parent: 1,
                position: [0, 2, 0],
                rotation: [0, 0, 0, 1],
            },
        ],
    };
    it("matches exporter-prefixed names and reports mapping coverage", () => {
        const map = buildRetargetMap(chain, tall, {
            boneMap: { Root: "mixamorig:Hips" },
        });
        expect(map.entries.get("Root")?.target).toBe("mixamorig:Hips");
        expect(map.entries.get("Mid")?.target).toBe("mixamorig:Mid");
        expect(map.unmappedSource).toEqual([]);
        expect(canonicalBoneName("mixamorig:Left_Arm")).toBe("leftarm");
    });
    it("preserves rotations and scales translation offsets to target proportions", () => {
        const rotation = quatFromEuler([0, 30, 0]);
        const source = new Map([
            ["Mid", { position: [0, 1.5, 0], rotation, scale: [1.1, 1.1, 1.1] }],
        ]);
        const result = retargetPose(source, chain, tall, {
            boneMap: { Root: "mixamorig:Hips" },
        });
        const mid = result.get("mixamorig:Mid");
        // Source moved 0.5 along a one-unit bone; the two-unit target moves 1.
        expect(mid.position).toEqual([0, 3, 0]);
        expect(mid.rotation).toEqual(rotation);
        expect(mid.scale).toEqual([1.1, 1.1, 1.1]);
        expect(source.has("mixamorig:Mid")).toBe(false);
    });
    it("fails loudly for invalid explicit maps and ambiguous skeletons", () => {
        expect(() => buildRetargetMap(chain, tall, { boneMap: { Root: "Missing" } })).toThrow(/missing target bone/);
        expect(() => buildRetargetMap(chain, { bones: [tall.bones[0], tall.bones[0]] })).toThrow(/duplicate bone name/);
    });
});
describe("two-bone IK", () => {
    const limb = {
        root: [0, 0, 0],
        mid: [0, -1, 0.2],
        tip: [0, -2, 0],
    };
    it("bends toward a reachable target", () => {
        const result = solveTwoBoneIk({ ...limb, target: [1, -1.5, 0] });
        expect(result.stretched).toBe(false);
        expect(Number.isFinite(result.rootRotation[0])).toBe(true);
        expect(Math.hypot(...result.rootRotation)).toBeCloseTo(1, 6);
        expect(Math.hypot(...result.midRotation)).toBeCloseTo(1, 6);
    });
    it("straightens rather than failing when the target is out of reach", () => {
        const result = solveTwoBoneIk({ ...limb, target: [0, -50, 0] });
        expect(result.stretched).toBe(true);
        expect(Math.hypot(...result.rootRotation)).toBeCloseTo(1, 6);
    });
    it("honours a pole so the joint does not snap sideways", () => {
        const forward = solveTwoBoneIk({
            ...limb,
            target: [0, -1.6, 0],
            pole: [0, -1, 5],
        });
        const backward = solveTwoBoneIk({
            ...limb,
            target: [0, -1.6, 0],
            pole: [0, -1, -5],
        });
        // Opposite poles bend the joint opposite ways.
        expect(forward.rootRotation).not.toEqual(backward.rootRotation);
    });
    it("handles a pole lying along the chain without producing NaN", () => {
        const result = solveTwoBoneIk({
            ...limb,
            target: [0, -1.5, 0],
            pole: [0, -3, 0],
        });
        for (const component of result.rootRotation)
            expect(Number.isFinite(component)).toBe(true);
    });
    it("rejects a degenerate chain or target", () => {
        expect(() => solveTwoBoneIk({
            root: [0, 0, 0],
            mid: [0, 0, 0],
            tip: [0, -1, 0],
            target: [1, 0, 0],
        })).toThrow(/both bones to have length/);
        expect(() => solveTwoBoneIk({ ...limb, target: [0, 0, 0] })).toThrow(/cannot coincide with the chain's root/);
    });
});
describe("look-at", () => {
    it("aims at the target when unconstrained", () => {
        const rotation = solveLookAt({ position: [0, 0, 0], target: [0, 0, -5] });
        expect(Math.hypot(...rotation)).toBeCloseTo(1, 6);
    });
    it("returns identity when the target is the bone's own position", () => {
        expect(solveLookAt({ position: [1, 2, 3], target: [1, 2, 3] })).toEqual([
            0, 0, 0, 1,
        ]);
    });
    it("clamps beyond the angle limit rather than snapping the head round", () => {
        const behind = [0, 0, 5];
        const free = solveLookAt({ position: [0, 0, 0], target: behind });
        const limited = solveLookAt({
            position: [0, 0, 0],
            target: behind,
            maxAngleDegrees: 45,
        });
        expect(limited).not.toEqual(free);
        expect(Math.hypot(...limited)).toBeCloseTo(1, 6);
        // A limited rotation is closer to identity than the full one.
        expect(Math.abs(limited[3])).toBeGreaterThan(Math.abs(free[3]));
    });
    it("scales by weight", () => {
        const target = [5, 0, -5];
        const half = solveLookAt({ position: [0, 0, 0], target, weight: 0.5 });
        const none = solveLookAt({ position: [0, 0, 0], target, weight: 0 });
        expect(Math.abs(none[3])).toBeCloseTo(1, 6);
        expect(Math.abs(half[3])).toBeLessThan(1);
    });
    it("rejects a negative angle limit", () => {
        expect(() => solveLookAt({
            position: [0, 0, 0],
            target: [0, 0, -1],
            maxAngleDegrees: -1,
        })).toThrow(/must not be negative/);
    });
});
//# sourceMappingURL=skinning.test.js.map