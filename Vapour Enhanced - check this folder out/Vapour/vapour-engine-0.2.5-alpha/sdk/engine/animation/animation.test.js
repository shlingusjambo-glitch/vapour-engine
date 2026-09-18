import { describe, expect, it } from "vitest";
import { Animator, blendPoses, clipTargets, maskPose, missingTargets, poseClip, sampleBlendTree, sampleChannel, samplePose, validateBlendTree, validateClip, wrapClipTime, } from "./index.js";
/** A clip moving one bone from x=0 to x=10 over two seconds. */
const slide = {
    name: "slide",
    duration: 2,
    channels: [
        {
            target: "Hips",
            property: "position",
            keyframes: [
                { time: 0, value: [0, 0, 0] },
                { time: 2, value: [10, 0, 0] },
            ],
        },
    ],
};
/** A clip rotating one bone a quarter turn. */
const turn = {
    name: "turn",
    duration: 1,
    channels: [
        {
            target: "Hips",
            property: "rotation",
            keyframes: [
                { time: 0, value: [0, 0, 0, 1] },
                { time: 1, value: [0, 0.7071068, 0, 0.7071068] },
            ],
        },
    ],
};
const raiseArm = {
    name: "raiseArm",
    duration: 1,
    channels: [
        {
            target: "LeftUpperArm",
            property: "position",
            keyframes: [
                { time: 0, value: [0, 0, 0] },
                { time: 1, value: [0, 5, 0] },
            ],
        },
    ],
};
describe("clip validation", () => {
    it("accepts a well-formed clip", () => {
        expect(validateClip(slide)).toBe(slide);
    });
    it("reports what is wrong, specifically", () => {
        expect(() => validateClip({ ...slide, name: " " })).toThrow(/non-empty name/);
        expect(() => validateClip({ ...slide, duration: 0 })).toThrow(/positive duration/);
        expect(() => validateClip({ ...slide, channels: [] })).toThrow(/no channels/);
        expect(() => validateClip({
            ...slide,
            channels: [
                {
                    target: "",
                    property: "position",
                    keyframes: [{ time: 0, value: [0, 0, 0] }],
                },
            ],
        })).toThrow(/no target bone/);
        expect(() => validateClip({
            ...slide,
            channels: [{ target: "Hips", property: "position", keyframes: [] }],
        })).toThrow(/has no keyframes/);
        // A rotation channel needs four components, not three.
        expect(() => validateClip({
            ...slide,
            channels: [
                {
                    target: "Hips",
                    property: "rotation",
                    keyframes: [{ time: 0, value: [0, 0, 0] }],
                },
            ],
        })).toThrow(/expects 4 components per keyframe but got 3/);
        expect(() => validateClip({
            ...slide,
            channels: [
                {
                    target: "Hips",
                    property: "position",
                    keyframes: [
                        { time: 1, value: [0, 0, 0] },
                        { time: 0, value: [0, 0, 0] },
                    ],
                },
            ],
        })).toThrow(/keyframes out of order/);
    });
});
describe("sampling", () => {
    it("interpolates linearly between keyframes", () => {
        expect(sampleChannel(slide.channels[0], 1)).toEqual([5, 0, 0]);
        expect(sampleChannel(slide.channels[0], 0.5)).toEqual([2.5, 0, 0]);
    });
    it("clamps outside the keyframe range", () => {
        expect(sampleChannel(slide.channels[0], -5)).toEqual([0, 0, 0]);
        expect(sampleChannel(slide.channels[0], 99)).toEqual([10, 0, 0]);
    });
    it("holds the previous value with step interpolation", () => {
        const stepped = { ...slide.channels[0], interpolation: "step" };
        expect(sampleChannel(stepped, 1.9)).toEqual([0, 0, 0]);
        expect(sampleChannel(stepped, 2)).toEqual([10, 0, 0]);
    });
    it("interpolates rotations on the sphere, keeping them unit length", () => {
        const value = sampleChannel(turn.channels[0], 0.5);
        expect(Math.hypot(value[0], value[1], value[2], value[3])).toBeCloseTo(1, 6);
        // Halfway to a quarter turn is an eighth turn.
        expect(value[1]).toBeCloseTo(Math.sin(Math.PI / 8), 4);
    });
    it("samples a whole pose", () => {
        const pose = samplePose(slide, 1);
        expect(pose.get("Hips").position).toEqual([5, 0, 0]);
        expect(pose.size).toBe(1);
    });
    it("finds the right segment in a many-keyframe channel", () => {
        const many = {
            name: "many",
            duration: 10,
            channels: [
                {
                    target: "Hips",
                    property: "position",
                    keyframes: Array.from({ length: 101 }, (_, index) => ({
                        time: index / 10,
                        value: [index, 0, 0],
                    })),
                },
            ],
        };
        expect(samplePose(many, 5).get("Hips").position[0]).toBeCloseTo(50, 6);
        expect(samplePose(many, 7.25).get("Hips").position[0]).toBeCloseTo(72.5, 6);
    });
});
describe("loop modes", () => {
    it("clamps a non-looping clip", () => {
        expect(wrapClipTime(slide, 5)).toBe(2);
        expect(wrapClipTime(slide, -1)).toBe(0);
    });
    it("wraps a looping clip", () => {
        const looping = { ...slide, loop: "loop" };
        expect(wrapClipTime(looping, 2.5)).toBeCloseTo(0.5, 6);
        expect(wrapClipTime(looping, 6)).toBeCloseTo(0, 6);
        // Negative time wraps forward, not to a negative sample.
        expect(wrapClipTime(looping, -0.5)).toBeCloseTo(1.5, 6);
    });
    it("reverses on alternate cycles when ping-ponging", () => {
        const pingPong = { ...slide, loop: "pingPong" };
        expect(wrapClipTime(pingPong, 0.5)).toBeCloseTo(0.5, 6);
        expect(wrapClipTime(pingPong, 2.5)).toBeCloseTo(1.5, 6);
        expect(wrapClipTime(pingPong, 4.5)).toBeCloseTo(0.5, 6);
    });
});
describe("pose blending and masking", () => {
    it("blends positions and rotations by weight", () => {
        const a = samplePose(slide, 0);
        const b = samplePose(slide, 2);
        expect(blendPoses(a, b, 0.5).get("Hips").position).toEqual([5, 0, 0]);
        expect(blendPoses(a, b, 0).get("Hips").position).toEqual([0, 0, 0]);
        expect(blendPoses(a, b, 1).get("Hips").position).toEqual([10, 0, 0]);
    });
    it("clamps the blend weight", () => {
        const a = samplePose(slide, 0);
        const b = samplePose(slide, 2);
        expect(blendPoses(a, b, 5).get("Hips").position).toEqual([10, 0, 0]);
    });
    it("takes a bone present in only one pose unchanged", () => {
        // Blending a bone against an implicit identity is how a partially-authored
        // clip yanks a character's arms to its sides.
        const legs = samplePose(slide, 2);
        const arms = samplePose(raiseArm, 1);
        const blended = blendPoses(legs, arms, 0.5);
        expect(blended.get("Hips").position).toEqual([10, 0, 0]);
        expect(blended.get("LeftUpperArm").position).toEqual([0, 5, 0]);
    });
    it("restricts a pose to a mask", () => {
        const pose = new Map([
            ["Hips", { position: [1, 0, 0] }],
            ["LeftUpperArm", { position: [0, 1, 0] }],
        ]);
        const masked = maskPose(pose, new Set(["LeftUpperArm"]));
        expect([...masked.keys()]).toEqual(["LeftUpperArm"]);
    });
    it("builds a clip from a pose and reports its targets", () => {
        const clip = poseClip("rest", samplePose(slide, 1));
        expect(clipTargets(clip)).toEqual(["Hips"]);
        expect(samplePose(clip, 0).get("Hips").position).toEqual([5, 0, 0]);
    });
    it("reports clip targets a skeleton does not have", () => {
        // A clip silently doing nothing because its bone names do not match is one
        // of the hardest animation bugs to notice.
        expect(missingTargets(raiseArm, ["Hips", "Spine"])).toEqual([
            "LeftUpperArm",
        ]);
        expect(missingTargets(raiseArm, ["LeftUpperArm"])).toEqual([]);
    });
});
describe("Animator", () => {
    it("plays a clip on the base layer", () => {
        const animator = new Animator();
        animator.play(slide);
        const pose = animator.update(1);
        expect(pose.get("Hips").position[0]).toBeCloseTo(5, 6);
    });
    it("does not restart a clip that is already playing", () => {
        const animator = new Animator();
        animator.play(slide);
        animator.update(1);
        // Gameplay calls play() every frame while walking; restarting each time is
        // the classic way to make a character twitch.
        animator.play(slide);
        expect(animator.update(0).get("Hips").position[0]).toBeCloseTo(5, 6);
        animator.play(slide, { restart: true });
        expect(animator.update(0).get("Hips").position[0]).toBeCloseTo(0, 6);
    });
    it("crossfades between clips", () => {
        const animator = new Animator();
        animator.play(slide);
        animator.update(2); // slide is at x = 10
        animator.play(raiseArm, { fadeSeconds: 1 });
        // Immediately after the fade begins, the previous clip still dominates.
        const early = animator.update(0.01);
        expect(early.get("Hips").position[0]).toBeGreaterThan(9);
        // Halfway through, the new clip's bone is half applied.
        const middle = animator.update(0.49);
        expect(middle.get("LeftUpperArm").position[1]).toBeGreaterThan(0);
        animator.update(1);
        expect(animator.base.isFading).toBe(false);
    });
    it("scales playback speed", () => {
        const animator = new Animator();
        animator.play(slide, { speed: 2 });
        expect(animator.update(0.5).get("Hips").position[0]).toBeCloseTo(5, 6);
    });
    it("stops", () => {
        const animator = new Animator();
        animator.play(slide);
        animator.base.stop();
        expect(animator.update(1).size).toBe(0);
    });
    it("validates its inputs", () => {
        const animator = new Animator();
        expect(() => animator.play(slide, { fadeSeconds: -1 })).toThrow(/must not be negative/);
        expect(() => animator.play(slide, { speed: Number.NaN })).toThrow(/must be finite/);
        expect(() => animator.update(-1)).toThrow(/non-negative delta/);
        expect(() => animator.setParameter("", 1)).toThrow(/non-empty name/);
        expect(() => animator.setParameter("speed", Number.NaN)).toThrow(/must be finite/);
        expect(() => animator.layer("nope")).toThrow(/no layer "nope".*Layers: base/s);
    });
});
describe("Animator layers", () => {
    it("blends a masked layer over the base without disturbing it", () => {
        const animator = new Animator();
        animator.play(slide);
        const upper = animator.addLayer({
            name: "upper",
            weight: 1,
            mask: ["LeftUpperArm"],
        });
        upper.play(raiseArm);
        const pose = animator.update(1);
        // The masked layer moved the arm; the base still owns the hips.
        expect(pose.get("LeftUpperArm").position[1]).toBeCloseTo(5, 6);
        expect(pose.get("Hips").position[0]).toBeCloseTo(5, 6);
    });
    it("scales a layer's influence by weight", () => {
        const animator = new Animator();
        animator.play(slide);
        const overlay = animator.addLayer({ name: "overlay", weight: 0.25 });
        overlay.play({
            ...slide,
            name: "slideFar",
            channels: [
                {
                    target: "Hips",
                    property: "position",
                    keyframes: [
                        { time: 0, value: [100, 0, 0] },
                        { time: 2, value: [100, 0, 0] },
                    ],
                },
            ],
        });
        const pose = animator.update(1);
        // 5 blended a quarter of the way toward 100.
        expect(pose.get("Hips").position[0]).toBeCloseTo(5 + (100 - 5) * 0.25, 4);
    });
    it("rejects duplicate layers and invalid weights", () => {
        const animator = new Animator();
        animator.addLayer({ name: "upper" });
        expect(() => animator.addLayer({ name: "upper" })).toThrow(/already has a layer named/);
        expect(() => animator.addLayer({ name: "bad", weight: 2 })).toThrow(/\[0, 1\]/);
        expect(() => animator.addLayer({ name: " " })).toThrow(/non-empty name/);
    });
    it("changes a mask at runtime", () => {
        const animator = new Animator();
        const upper = animator.addLayer({ name: "upper", mask: ["Nothing"] });
        upper.play(raiseArm);
        expect(animator.update(1).has("LeftUpperArm")).toBe(false);
        upper.setMask(undefined);
        expect(animator.update(0).has("LeftUpperArm")).toBe(true);
    });
});
describe("Animator state machine", () => {
    const idle = { ...slide, name: "idle", loop: "loop" };
    const walk = { ...slide, name: "walk", loop: "loop" };
    const jump = { ...slide, name: "jump" };
    const machine = {
        initial: "idle",
        states: [
            {
                name: "idle",
                clip: idle,
                transitions: [
                    {
                        to: "walk",
                        conditions: [
                            { parameter: "speed", operator: ">", value: 0.1 },
                        ],
                    },
                ],
            },
            {
                name: "walk",
                clip: walk,
                transitions: [
                    {
                        to: "idle",
                        conditions: [
                            { parameter: "speed", operator: "<=", value: 0.1 },
                        ],
                    },
                ],
            },
            { name: "jump", clip: jump, transitions: [] },
        ],
        anyStateTransitions: [
            {
                to: "jump",
                conditions: [
                    { parameter: "grounded", operator: "==", value: false },
                ],
            },
        ],
    };
    it("enters its initial state", () => {
        const animator = new Animator();
        animator.setStateMachine(machine);
        expect(animator.state).toBe("idle");
        expect(animator.base.currentClip?.name).toBe("idle");
    });
    it("transitions when a parameter condition holds", () => {
        const animator = new Animator();
        animator.setStateMachine(machine);
        animator.setParameter("speed", 3);
        animator.update(1 / 60);
        expect(animator.state).toBe("walk");
        animator.setParameter("speed", 0);
        animator.update(1 / 60);
        expect(animator.state).toBe("idle");
    });
    it("stays put while conditions do not hold", () => {
        const animator = new Animator();
        animator.setStateMachine(machine);
        animator.setParameter("speed", 0);
        for (let step = 0; step < 20; step += 1)
            animator.update(1 / 60);
        expect(animator.state).toBe("idle");
    });
    it("treats a missing parameter as not matching, rather than throwing mid-frame", () => {
        const animator = new Animator();
        animator.setStateMachine(machine);
        animator.update(1 / 60);
        expect(animator.state).toBe("idle");
    });
    it("fires an any-state transition from anywhere", () => {
        const animator = new Animator();
        animator.setStateMachine(machine);
        animator.setParameter("speed", 3);
        animator.update(1 / 60);
        expect(animator.state).toBe("walk");
        animator.setParameter("grounded", false);
        animator.update(1 / 60);
        expect(animator.state).toBe("jump");
    });
    it("validates the machine", () => {
        const animator = new Animator();
        expect(() => animator.setStateMachine({ initial: "a", states: [] })).toThrow(/at least one state/);
        expect(() => animator.setStateMachine({
            initial: "ghost",
            states: [{ name: "a", clip: idle }],
        })).toThrow(/initial state "ghost"/);
        expect(() => animator.setStateMachine({
            initial: "a",
            states: [
                {
                    name: "a",
                    clip: idle,
                    transitions: [{ to: "ghost", conditions: [] }],
                },
            ],
        })).toThrow(/transitions to "ghost"/);
        expect(() => animator.setStateMachine({
            initial: "a",
            states: [
                { name: "a", clip: idle },
                { name: "a", clip: walk },
            ],
        })).toThrow(/duplicate state names/);
    });
    it("reports transitions and raises enter events", () => {
        const animator = new Animator();
        animator.setStateMachine(machine);
        animator.setParameter("speed", 3);
        animator.update(1 / 60);
        const events = animator.drainEvents();
        expect(events.map((event) => event.name)).toEqual([
            "enter:idle",
            "enter:walk",
        ]);
        expect(animator.drainEvents()).toEqual([]);
        expect(animator.stats()).toMatchObject({
            state: "walk",
            transitions: 2,
            layers: 1,
        });
    });
});
describe("blend trees", () => {
    const idle = {
        ...slide,
        name: "idle",
        channels: [
            {
                ...slide.channels[0],
                keyframes: [
                    { time: 0, value: [0, 0, 0] },
                    { time: 2, value: [0, 0, 0] },
                ],
            },
        ],
    };
    const run = {
        ...slide,
        name: "run",
        channels: [
            {
                ...slide.channels[0],
                keyframes: [
                    { time: 0, value: [20, 0, 0] },
                    { time: 2, value: [20, 0, 0] },
                ],
            },
        ],
    };
    it("interpolates neighboring clips in a 1D locomotion tree", () => {
        const tree = {
            type: "1d",
            parameter: "speed",
            children: [
                { threshold: 0, clip: idle },
                { threshold: 10, clip: run },
            ],
        };
        expect(sampleBlendTree(tree, { speed: 2.5 }, 0).get("Hips").position[0]).toBeCloseTo(5, 6);
        expect(sampleBlendTree(tree, { speed: -2 }, 0).get("Hips").position[0]).toBe(0);
        expect(sampleBlendTree(tree, { speed: 50 }, 0).get("Hips").position[0]).toBe(20);
    });
    it("blends planar velocity in a 2D freeform tree and selects exact samples", () => {
        const tree = {
            type: "2d",
            parameterX: "moveX",
            parameterY: "moveY",
            children: [
                { position: [0, 0], clip: idle },
                { position: [1, 0], clip: run },
                {
                    position: [0, 1],
                    clip: {
                        ...run,
                        name: "forward",
                        channels: [
                            {
                                ...run.channels[0],
                                keyframes: [
                                    { time: 0, value: [0, 20, 0] },
                                    { time: 2, value: [0, 20, 0] },
                                ],
                            },
                        ],
                    },
                },
            ],
        };
        expect(sampleBlendTree(tree, { moveX: 1, moveY: 0 }, 0).get("Hips").position).toEqual([20, 0, 0]);
        const mixed = sampleBlendTree(tree, { moveX: 0.5, moveY: 0.5 }, 0).get("Hips").position;
        expect(mixed[0]).toBeGreaterThan(0);
        expect(mixed[1]).toBeGreaterThan(0);
    });
    it("rejects ambiguous trees and missing numeric parameters with context", () => {
        expect(() => validateBlendTree({
            type: "1d",
            parameter: "speed",
            children: [
                { threshold: 1, clip: idle },
                { threshold: 1, clip: run },
            ],
        })).toThrow(/strictly increasing/);
        expect(() => sampleBlendTree({
            type: "1d",
            parameter: "speed",
            children: [{ threshold: 0, clip: idle }],
        }, {}, 0)).toThrow(/parameter "speed"/);
    });
    it("runs a blend tree as a state-machine motion", () => {
        const animator = new Animator();
        animator.setParameter("speed", 5);
        animator.setStateMachine({
            initial: "locomotion",
            states: [
                {
                    name: "locomotion",
                    blendTree: {
                        type: "1d",
                        parameter: "speed",
                        children: [
                            { threshold: 0, clip: idle },
                            { threshold: 10, clip: run },
                        ],
                    },
                },
            ],
        });
        expect(animator.update(0).get("Hips").position[0]).toBeCloseTo(10, 6);
        animator.setParameter("speed", 10);
        expect(animator.update(0).get("Hips").position[0]).toBeCloseTo(20, 6);
    });
});
//# sourceMappingURL=animation.test.js.map