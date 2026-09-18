import { describe, expect, it } from "vitest";
import { ThirdPersonMotor3d, findSafeCharacterPosition3d } from "./locomotion-3d.js";
class FloorWorld {
    moveCharacter(_dt, position, _rotation, desired) {
        const feet = position[1] - 0.9;
        const y = Math.max(desired[1], -feet);
        return { translation: [desired[0], y, desired[2]], grounded: feet + y <= 0.001, slidingDownSlope: false, collisions: feet + desired[1] < 0 ? [99] : [] };
    }
    overlapShape(position) { return position[0] > 2 ? [5] : []; }
    raycast(origin, direction, distance) {
        if (direction[1] >= 0)
            return undefined;
        const hitDistance = origin[1] / -direction[1];
        return hitDistance <= distance ? { bodyId: 99, distance: hitDistance, point: [origin[0], 0, origin[2]], normal: [0, 1, 0] } : undefined;
    }
}
describe("ThirdPersonMotor3d", () => {
    it("accelerates without diagonal boost, turns, and remains grounded", () => {
        const motor = new ThirdPersonMotor3d(new FloorWorld(), { position: [0, 0, 0] });
        for (let index = 0; index < 60; index++)
            motor.update(1 / 60, { move: [1, 1] });
        expect(Math.hypot(motor.state.velocity[0], motor.state.velocity[2])).toBeCloseTo(4.2, 5);
        expect(motor.state.position[1]).toBe(0);
        expect(motor.state.grounded).toBe(true);
        expect(motor.state.yaw).toBeCloseTo(-3 * Math.PI / 4, 2);
    });
    it("buffers one jump edge and subdivides long fixed updates", () => {
        const motor = new ThirdPersonMotor3d(new FloorWorld(), { position: [0, 0, 0] });
        motor.update(1 / 60, { move: [0, 0] });
        motor.update(0.05, { move: [0, 0], jump: true });
        expect(motor.state.position[1]).toBeGreaterThan(0.2);
        expect(motor.state.velocity[1]).toBeGreaterThan(0);
        expect(() => motor.update(0.3, { move: [0, 0] })).toThrow("delta");
    });
    it("finds clear ground for safe exits and rejects occupied capsules", () => {
        const world = new FloorWorld();
        expect(findSafeCharacterPosition3d(world, [1, 0, 0])).toEqual([1, 0.035, 0]);
        expect(findSafeCharacterPosition3d(world, [3, 0, 0])).toBeUndefined();
    });
});
//# sourceMappingURL=locomotion-3d.test.js.map