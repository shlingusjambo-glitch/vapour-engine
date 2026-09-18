import { describe, expect, it, vi } from "vitest";
import { AiController, Blackboard, blackboardKey, perceiveHearing, perceiveVision, selectTarget } from "./perception.js";
describe("vision perception", () => {
    const targets = [
        { id: "front", position: { x: 0, y: 0, z: -4 }, tags: ["enemy"], threat: 1 },
        { id: "side", position: { x: 4, y: 0, z: 0 }, tags: ["enemy"], threat: 4 },
        { id: "friend", position: { x: 0, y: 0, z: -2 }, tags: ["friend"] },
    ];
    it("filters by range, field of view, tag, and line of sight", () => {
        expect(perceiveVision(targets, { range: 10, fieldOfView: 90 }, "enemy").map((target) => target.id)).toEqual(["front"]);
        expect(perceiveVision(targets, { range: 10, fieldOfView: 360, occluded: (_a, _b, target) => target.id === "front" }, "enemy").map((target) => target.id)).toEqual(["side"]);
    });
    it("selects deterministically by score, distance, or threat", () => {
        const perceived = perceiveVision(targets, { range: 10, fieldOfView: 360 });
        expect(selectTarget(perceived)?.id).toBe("side");
        expect(selectTarget(perceived, "nearest")?.id).toBe("friend");
        expect(selectTarget(perceived, "highest-threat")?.id).toBe("side");
    });
    it("rejects invalid sensor configuration", () => {
        expect(() => perceiveVision([], { range: 0, fieldOfView: 90 })).toThrow(/range/);
        expect(() => perceiveVision([], { range: 1, fieldOfView: 361 })).toThrow(/field of view/);
        expect(() => perceiveVision([], { range: 1, fieldOfView: 90, forward: { x: 0, y: 0, z: 0 } })).toThrow(/cannot be zero/);
    });
});
describe("hearing perception", () => {
    it("attenuates by distance and obstruction and sorts strongest first", () => {
        const heard = perceiveHearing({ x: 0, y: 0, z: 0 }, 10, [
            { id: "near", position: { x: 2, y: 0, z: 0 }, loudness: 1 },
            { id: "far", position: { x: 8, y: 0, z: 0 }, loudness: 2 },
            { id: "outside", position: { x: 20, y: 0, z: 0 }, loudness: 1 },
        ], (_from, _to, sound) => sound.id === "near" ? 0.5 : 0);
        expect(heard.map((sound) => sound.id)).toEqual(["near", "far"]);
        expect(heard[0].strength).toBeCloseTo(0.4);
    });
    it("validates query output", () => {
        expect(() => perceiveHearing({ x: 0, y: 0, z: 0 }, 1, [{ id: "x", position: { x: 0, y: 0, z: 0 }, loudness: -1 }])).toThrow(/loudness/);
        expect(() => perceiveHearing({ x: 0, y: 0, z: 0 }, 1, [{ id: "x", position: { x: 0, y: 0, z: 0 }, loudness: 1 }], () => 2)).toThrow(/\[0, 1\]/);
    });
});
describe("Blackboard", () => {
    it("provides typed defaults, observation, snapshots, and required values", () => {
        const health = blackboardKey("health", 100);
        const target = blackboardKey("target");
        const board = new Blackboard();
        const changed = vi.fn();
        const unsubscribe = board.observe(health, changed);
        expect(board.get(health)).toBe(100);
        board.set(health, 75);
        expect(changed).toHaveBeenCalledWith(75, 100);
        expect(board.snapshot()).toEqual({ health: 75 });
        expect(() => board.require(target)).toThrow(/has no value/);
        unsubscribe();
        board.set(health, 50);
        expect(changed).toHaveBeenCalledTimes(1);
    });
});
describe("AiController", () => {
    it("runs decisions every update and sensors at a bounded cadence", () => {
        const sense = vi.fn();
        const decide = vi.fn();
        const controller = new AiController({ sense, decide, sensingInterval: 0.5 });
        controller.update({}, 0.1);
        controller.update({}, 0.1);
        controller.update({}, 0.3);
        expect(sense).toHaveBeenCalledTimes(2);
        expect(decide).toHaveBeenCalledTimes(3);
        controller.enabled = false;
        controller.update({}, 1);
        expect(decide).toHaveBeenCalledTimes(3);
    });
});
//# sourceMappingURL=perception.test.js.map