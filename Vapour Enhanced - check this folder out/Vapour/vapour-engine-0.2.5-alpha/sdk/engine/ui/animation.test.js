import { describe, expect, it } from "vitest";
import { UiAnimator, validateUiAnimation, } from "./animation.js";
const appear = {
    name: "appear",
    duration: 1,
    tracks: [
        { property: "opacity", from: 0, to: 1, easing: "outCubic" },
        { property: "scale", from: 0.8, to: 1 },
        { property: "color", from: [1, 0, 0, 1], to: [0, 0, 1, 1] },
    ],
};
describe("UiAnimator", () => {
    it("animates numeric and colour state with serializable easing", () => {
        const animator = new UiAnimator();
        animator.play("dialog", appear);
        animator.update(0.5);
        expect(animator.state("dialog").opacity).toBeGreaterThan(0.5);
        expect(animator.state("dialog").scale).toBeCloseTo(0.9, 6);
        expect(animator.state("dialog").color).toEqual([0.5, 0, 0.5, 1]);
        animator.update(0.5);
        expect(animator.state("dialog")).toMatchObject({ opacity: 1, scale: 1 });
        expect(animator.drainEvents()).toEqual([
            { target: "dialog", clip: "appear", type: "complete" },
        ]);
    });
    it("supports delay, looping, ping-pong, cancellation, and reduced motion", () => {
        const animator = new UiAnimator();
        animator.play("pulse", {
            name: "pulse",
            duration: 1,
            delay: 0.5,
            loop: true,
            pingPong: true,
            tracks: [{ property: "scale", from: 1, to: 2 }],
        });
        animator.update(0.25);
        expect(animator.state("pulse").scale).toBe(1);
        animator.update(1);
        expect(animator.state("pulse").scale).toBeCloseTo(1.75, 6);
        expect(animator.cancel("pulse")).toBe(true);
        expect(animator.drainEvents()[0]).toMatchObject({ type: "cancel" });
        animator.reducedMotion = true;
        animator.play("instant", appear);
        expect(animator.state("instant").opacity).toBe(1);
        expect(animator.activeCount).toBe(0);
    });
    it("rejects malformed clips and updates", () => {
        expect(() => validateUiAnimation({ name: "bad", duration: 0, tracks: [] })).toThrow(/duration/);
        expect(() => validateUiAnimation({
            name: "bad",
            duration: 1,
            tracks: [{ property: "opacity", from: [0, 0, 0, 1], to: [1, 1, 1, 1] }],
        })).toThrow(/wrong value type/);
        expect(() => validateUiAnimation({
            name: "bad",
            duration: 1,
            tracks: [
                { property: "opacity", from: 0, to: 1 },
                { property: "opacity", from: 1, to: 0 },
            ],
        })).toThrow(/duplicate track/);
        expect(() => new UiAnimator().update(-1)).toThrow(/non-negative delta/);
    });
});
//# sourceMappingURL=animation.test.js.map