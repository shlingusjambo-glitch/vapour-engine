import { describe, expect, it } from "vitest";
import { XrGrabController, XrLocomotion, raycastTargets, teleportArc } from "./interaction.js";
const forwardPose = (position = [0, 0, 0], forward = [0, 0, -1]) => ({ position, forward });
describe("raycastTargets", () => {
    it("hits the nearest target along the ray", () => {
        const hit = raycastTargets(forwardPose(), [
            { id: "far", position: [0, 0, -8], radius: 0.5 },
            { id: "near", position: [0, 0, -3], radius: 0.5 },
        ]);
        expect(hit).toMatchObject({ id: "near" });
        expect(hit.distance).toBeCloseTo(3, 5);
    });
    it("misses what is behind or beyond range", () => {
        expect(raycastTargets(forwardPose(), [{ id: "behind", position: [0, 0, 5], radius: 1 }])).toBeUndefined();
        expect(raycastTargets(forwardPose(), [{ id: "far", position: [0, 0, -50], radius: 1 }], { maxDistance: 10 })).toBeUndefined();
    });
    it("widens with distance, so a thin ray does not flicker off small controls", () => {
        // Hand tremor is roughly a degree; a mathematically thin ray is unusable.
        const offAxis = { id: "button", position: [0.2, 0, -5], radius: 0.05 };
        expect(raycastTargets(forwardPose(), [offAxis], { softness: 0 })).toBeUndefined();
        expect(raycastTargets(forwardPose(), [offAxis], { softness: 0.05 })).toBeDefined();
    });
    it("respects priority over proximity", () => {
        const hit = raycastTargets(forwardPose(), [
            { id: "near", position: [0, 0, -2], radius: 0.5 },
            { id: "important", position: [0, 0, -6], radius: 0.5, priority: 10 },
        ]);
        expect(hit.id).toBe("important");
    });
    it("reports the point along the ray", () => {
        const hit = raycastTargets(forwardPose([0, 1, 0]), [{ id: "t", position: [0, 1, -4], radius: 0.5 }]);
        expect(hit.point[1]).toBeCloseTo(1, 5);
        expect(hit.point[2]).toBeCloseTo(-4, 5);
    });
    it("validates its inputs", () => {
        expect(() => raycastTargets(forwardPose(), [], { maxDistance: 0 })).toThrow(/must be positive/);
        expect(() => raycastTargets(forwardPose(), [], { softness: -1 })).toThrow(/must not be negative/);
        expect(() => raycastTargets(forwardPose(), [{ id: "bad", position: [0, 0, -1], radius: 0 }])).toThrow(/positive radius/);
    });
});
describe("XrGrabController", () => {
    it("grabs what is within reach and keeps its offset", () => {
        const grab = new XrGrabController();
        const state = grab.grabDirect("right", forwardPose([0, 1, 0]), [{ id: "cup", position: [0.05, 1, 0], radius: 0.1 }]);
        expect(state).toMatchObject({ id: "cup", mode: "direct" });
        expect(grab.isHeld("cup")).toBe(true);
        // Moving the hand carries the object, preserving the offset.
        const resolved = grab.resolve("right", forwardPose([1, 1, 0]));
        expect(resolved[0]).toBeCloseTo(1.05, 5);
    });
    it("grabs nothing out of reach", () => {
        const grab = new XrGrabController();
        expect(grab.grabDirect("right", forwardPose(), [{ id: "far", position: [5, 0, 0], radius: 0.1 }])).toBeUndefined();
    });
    it("grabs by ray and keeps the object at its captured distance", () => {
        // What makes a distant object feel attached to the pointer rather than
        // reeled in the moment it is grabbed.
        const grab = new XrGrabController();
        grab.grabByRay("right", forwardPose(), [{ id: "crate", position: [0, 0, -5], radius: 0.6 }]);
        const resolved = grab.resolve("right", forwardPose([0, 0, 0], [1, 0, 0]));
        expect(resolved[0]).toBeCloseTo(5, 4);
        expect(resolved[2]).toBeCloseTo(0, 4);
    });
    it("releases", () => {
        const grab = new XrGrabController();
        grab.grabDirect("left", forwardPose(), [{ id: "cup", position: [0, 0, 0], radius: 0.2 }]);
        expect(grab.release("left")).toBe("cup");
        expect(grab.release("left")).toBeUndefined();
        expect(grab.resolve("left", forwardPose())).toBeUndefined();
    });
    it("detects a two-handed grab of one object", () => {
        const grab = new XrGrabController();
        const target = [{ id: "box", position: [0, 1, 0], radius: 1 }];
        grab.grabDirect("left", forwardPose([-0.2, 1, 0]), target);
        expect(grab.twoHanded).toBe(false);
        grab.grabDirect("right", forwardPose([0.2, 1, 0]), target);
        expect(grab.twoHanded).toBe(true);
    });
    it("scales and rotates from the change between the hands", () => {
        const grab = new XrGrabController();
        const target = [{ id: "box", position: [0, 1, 0], radius: 2 }];
        grab.grabDirect("left", forwardPose([-0.5, 1, 0]), target);
        grab.grabDirect("right", forwardPose([0.5, 1, 0]), target);
        // First resolve establishes the reference, so scale starts at one.
        const start = grab.resolveTwoHanded(forwardPose([-0.5, 1, 0]), forwardPose([0.5, 1, 0]));
        expect(start.scale).toBeCloseTo(1, 5);
        expect(start.position[0]).toBeCloseTo(0, 5);
        // Pulling the hands apart makes it bigger — the gesture people try unprompted.
        const wider = grab.resolveTwoHanded(forwardPose([-1, 1, 0]), forwardPose([1, 1, 0]));
        expect(wider.scale).toBeCloseTo(2, 5);
        // Rotating the hands about the up axis yaws it.
        const turned = grab.resolveTwoHanded(forwardPose([0, 1, -0.5]), forwardPose([0, 1, 0.5]));
        expect(Math.abs(turned.yaw)).toBeGreaterThan(1);
    });
    it("reports no two-handed transform with one hand", () => {
        const grab = new XrGrabController();
        grab.grabDirect("left", forwardPose(), [{ id: "box", position: [0, 0, 0], radius: 1 }]);
        expect(grab.resolveTwoHanded(forwardPose(), forwardPose())).toBeUndefined();
    });
    it("releases everything", () => {
        const grab = new XrGrabController();
        const target = [{ id: "box", position: [0, 0, 0], radius: 1 }];
        grab.grabDirect("left", forwardPose(), target);
        grab.grabDirect("right", forwardPose(), target);
        grab.releaseAll();
        expect(grab.held).toEqual([]);
    });
});
describe("XrLocomotion", () => {
    const head = [0, 0, -1];
    it("snaps in fixed increments, once per push", () => {
        // A held stick that snapped every frame would spin the player.
        const locomotion = new XrLocomotion({ turnStyle: "snap", snapDegrees: 45, comfortFadeSeconds: 0 });
        locomotion.update({ turnX: 1 }, head, 1 / 60);
        const after = locomotion.yaw;
        expect(Math.abs(after)).toBeCloseTo(Math.PI / 4, 5);
        for (let step = 0; step < 10; step += 1)
            locomotion.update({ turnX: 1 }, head, 1 / 60);
        expect(locomotion.yaw).toBeCloseTo(after, 5);
        // Releasing and pushing again turns once more.
        locomotion.update({ turnX: 0 }, head, 1 / 60);
        locomotion.update({ turnX: 1 }, head, 1 / 60);
        expect(Math.abs(locomotion.yaw)).toBeCloseTo(Math.PI / 2, 5);
    });
    it("turns continuously in smooth mode", () => {
        const locomotion = new XrLocomotion({ turnStyle: "smooth", smoothTurnSpeed: 90 });
        for (let step = 0; step < 30; step += 1)
            locomotion.update({ turnX: 1 }, head, 1 / 60);
        expect(Math.abs(locomotion.yaw)).toBeGreaterThan(0.5);
    });
    it("blinks through a snap turn, landing at the midpoint", () => {
        // The fade is what keeps even a snap comfortable.
        const locomotion = new XrLocomotion({ turnStyle: "snap", comfortFadeSeconds: 0.2 });
        locomotion.update({ turnX: 1 }, head, 0.01);
        expect(locomotion.fade).toBeGreaterThan(0);
        expect(locomotion.yaw).toBe(0);
        locomotion.update({ turnX: 1 }, head, 0.1);
        expect(locomotion.yaw).not.toBe(0);
        locomotion.update({ turnX: 1 }, head, 0.2);
        expect(locomotion.fade).toBe(0);
    });
    it("moves relative to where the player is looking", () => {
        // Ignoring head orientation is the other classic comfort failure.
        const locomotion = new XrLocomotion({ moveSpeed: 2, deadZone: 0 });
        locomotion.update({ moveY: 1 }, [0, 0, -1], 1);
        expect(locomotion.position[2]).toBeCloseTo(-2, 5);
        locomotion.setPosition([0, 0, 0]);
        locomotion.update({ moveY: 1 }, [1, 0, 0], 1);
        expect(locomotion.position[0]).toBeCloseTo(2, 5);
    });
    it("flattens head pitch, so looking down does not sink the player", () => {
        const locomotion = new XrLocomotion({ moveSpeed: 2, deadZone: 0 });
        locomotion.update({ moveY: 1 }, [0, -0.9, -0.4], 1);
        expect(locomotion.position[1]).toBe(0);
    });
    it("applies a dead zone, rescaled from its edge", () => {
        const locomotion = new XrLocomotion({ moveSpeed: 10, deadZone: 0.5 });
        locomotion.update({ moveY: 0.4 }, head, 1);
        expect(locomotion.position[2]).toBe(0);
        locomotion.update({ moveY: 1 }, head, 1);
        expect(locomotion.position[2]).toBeCloseTo(-10, 5);
    });
    it("teleports at the midpoint of its fade", () => {
        const locomotion = new XrLocomotion({ comfortFadeSeconds: 0.2 });
        locomotion.teleport([5, 0, 5]);
        expect(locomotion.position).toEqual([0, 0, 0]);
        locomotion.update({}, head, 0.05);
        expect(locomotion.position).toEqual([0, 0, 0]);
        locomotion.update({}, head, 0.1);
        expect(locomotion.position).toEqual([5, 0, 5]);
    });
    it("teleports immediately with no fade configured", () => {
        const locomotion = new XrLocomotion({ comfortFadeSeconds: 0 });
        locomotion.teleport([1, 0, 2]);
        expect(locomotion.position).toEqual([1, 0, 2]);
    });
    it("validates its options", () => {
        expect(() => new XrLocomotion({ snapDegrees: 0 })).toThrow(/positive number of degrees/);
        expect(() => new XrLocomotion({ moveSpeed: -1 })).toThrow(/must not be negative/);
        expect(() => new XrLocomotion({ deadZone: 1 })).toThrow(/\[0, 1\)/);
        expect(() => new XrLocomotion({ comfortFadeSeconds: -1 })).toThrow(/must not be negative/);
        expect(() => new XrLocomotion().update({}, head, -1)).toThrow(/non-negative delta/);
    });
});
describe("teleportArc", () => {
    const flatGround = () => 0;
    const anywhere = () => true;
    it("arcs down and lands on the ground", () => {
        const arc = teleportArc(forwardPose([0, 1.6, 0], [0, -0.2, -1]), anywhere, flatGround);
        expect(arc.valid).toBe(true);
        expect(arc.destination[1]).toBe(0);
        expect(arc.destination[2]).toBeLessThan(0);
        expect(arc.points.length).toBeGreaterThan(2);
    });
    it("reports an invalid landing but still returns the arc to draw", () => {
        // Seeing where it would land before committing is what makes teleport
        // comfortable in the first place.
        const arc = teleportArc(forwardPose([0, 1.6, 0], [0, -0.2, -1]), () => false, flatGround);
        expect(arc.valid).toBe(false);
        expect(arc.destination).toBeUndefined();
        expect(arc.points.length).toBeGreaterThan(2);
    });
    it("finds no landing when aimed at the sky", () => {
        const arc = teleportArc(forwardPose([0, 1.6, 0], [0, 1, 0]), anywhere, () => undefined);
        expect(arc.destination).toBeUndefined();
        expect(arc.valid).toBe(false);
    });
    it("lands further when thrown faster", () => {
        const slow = teleportArc(forwardPose([0, 1.6, 0], [0, 0, -1]), anywhere, flatGround, { speed: 4 });
        const fast = teleportArc(forwardPose([0, 1.6, 0], [0, 0, -1]), anywhere, flatGround, { speed: 12 });
        expect(Math.abs(fast.destination[2])).toBeGreaterThan(Math.abs(slow.destination[2]));
    });
    it("follows uneven ground", () => {
        const arc = teleportArc(forwardPose([0, 3, 0], [0, 0, -1]), anywhere, (_x, z) => (z < -3 ? 1 : 0));
        expect(arc.destination[1]).toBe(1);
    });
    it("validates its options", () => {
        expect(() => teleportArc(forwardPose(), anywhere, flatGround, { speed: 0 })).toThrow(/must be positive/);
        expect(() => teleportArc(forwardPose(), anywhere, flatGround, { steps: 1 })).toThrow(/at least two steps/);
    });
});
//# sourceMappingURL=interaction.test.js.map