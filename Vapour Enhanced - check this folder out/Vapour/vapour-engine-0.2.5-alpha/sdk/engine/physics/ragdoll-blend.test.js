import { describe, expect, it } from "vitest";
import { blendRagdollPose, rampWeight, ragdollActivationTargets, RagdollBlendController, } from "./ragdoll-blend.js";
/** A two-bone vertical chain: root at the origin, tip one unit above it —
 * simple enough that the blended midpoint has an exact expected value. */
const chain = {
    bones: [
        { name: "Root", parent: -1, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        { name: "Tip", parent: 0, position: [0, 1, 0], rotation: [0, 0, 0, 1] },
    ],
};
const animatedPose = new Map();
// Rest pose: Root at world [0,0,0], Tip at world [0,1,0].
const ragdollTransforms = new Map([
    ["Tip", { position: [4, 1, 0], rotation: [0, 0, 0, 1] }],
]);
describe("blendRagdollPose", () => {
    it("at weight 0 reproduces pure animation exactly", () => {
        const blended = blendRagdollPose(chain, animatedPose, ragdollTransforms, new Map([["Tip", 0]]));
        expect(blended.get("Tip")).toBeUndefined(); // untouched: same as the animated pose, which has no override
    });
    it("at weight 0.5 sits at the midpoint between animated and ragdoll world positions", () => {
        const blended = blendRagdollPose(chain, animatedPose, ragdollTransforms, new Map([["Tip", 0.5]]));
        const tip = blended.get("Tip");
        // Animated world position [0,1,0], ragdoll world position [4,1,0]: midpoint [2,1,0].
        // Root did not move, so local == world here.
        expect(tip.position).toEqual([2, 1, 0]);
    });
    it("at weight 1 is pure ragdoll", () => {
        const blended = blendRagdollPose(chain, animatedPose, ragdollTransforms, new Map([["Tip", 1]]));
        const tip = blended.get("Tip");
        expect(tip.position[0]).toBeCloseTo(4, 10);
        expect(tip.position[1]).toBeCloseTo(1, 10);
        expect(tip.position[2]).toBeCloseTo(0, 10);
    });
    it("leaves a bone with no ragdoll transform driven purely by animation", () => {
        const blended = blendRagdollPose(chain, animatedPose, ragdollTransforms, new Map([["Root", 1]]));
        expect(blended.get("Root")).toBeUndefined();
        expect(blended.get("Tip")).toBeUndefined();
    });
});
describe("rampWeight", () => {
    it("ramps linearly from 0 to 1 over the duration", () => {
        expect(rampWeight(0, 1)).toBe(0);
        expect(rampWeight(0.5, 1)).toBe(0.5);
        expect(rampWeight(1, 1)).toBe(1);
        expect(rampWeight(2, 1)).toBe(1); // clamped
    });
    it("snaps to 1 immediately for a non-positive duration", () => {
        expect(rampWeight(0, 0)).toBe(1);
    });
});
describe("ragdollActivationTargets", () => {
    it("estimates linear velocity from two consecutive poses", () => {
        const previous = new Map([["Tip", { position: [0, 1, 0] }]]);
        const now = new Map([["Tip", { position: [0, 1.5, 0] }]]);
        const [target] = ragdollActivationTargets(chain, ["Tip"], now, previous, 0.5);
        expect(target.linearVelocity[1]).toBeCloseTo(1, 10); // (1.5 - 1) / 0.5
    });
});
describe("RagdollBlendController", () => {
    it("ramps in on activation, holds at full ragdoll, then ramps out on recovery", () => {
        const controller = new RagdollBlendController(["Tip"], { rampInSeconds: 1, rampOutSeconds: 1 });
        expect(controller.phase).toBe("animated");
        expect(controller.weight("Tip")).toBe(0);
        const previous = new Map([["Tip", { position: [0, 1, 0] }]]);
        const now = new Map([["Tip", { position: [0, 1, 0] }]]);
        controller.activate(chain, now, previous, 1 / 60);
        expect(controller.phase).toBe("activatingRagdoll");
        expect(controller.weight("Tip")).toBe(0);
        controller.advance(0.5);
        expect(controller.weight("Tip")).toBeCloseTo(0.5, 10);
        controller.advance(0.5);
        expect(controller.phase).toBe("ragdoll");
        expect(controller.weight("Tip")).toBe(1);
        controller.recover();
        expect(controller.phase).toBe("recoveringToAnimation");
        expect(controller.weight("Tip")).toBe(1);
        controller.advance(0.5);
        expect(controller.weight("Tip")).toBeCloseTo(0.5, 10);
        const recovered = controller.advance(0.5);
        expect(recovered).toBe(true);
        expect(controller.phase).toBe("animated");
        expect(controller.weight("Tip")).toBe(0);
    });
    it("blend() uses the controller's current ramp weight", () => {
        const controller = new RagdollBlendController(["Tip"], { rampInSeconds: 1 });
        const previous = new Map([["Tip", { position: [0, 1, 0] }]]);
        controller.activate(chain, animatedPose, previous, 1 / 60);
        controller.advance(0.5);
        const blended = controller.blend(chain, animatedPose, ragdollTransforms);
        // Halfway ramped in: midpoint between [0,1,0] and [4,1,0].
        expect(blended.get("Tip").position).toEqual([2, 1, 0]);
    });
});
//# sourceMappingURL=ragdoll-blend.test.js.map