import { describe, expect, it } from "vitest";
import { interpolateBody3d, interpolateBodies3d } from "./physics-interpolation.js";
function body(id, x, sleeping = false) {
    return { id, position: [x, 0, 0], rotation: [0, 0, 0, 1], linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0], sleeping };
}
describe("interpolateBody3d", () => {
    it("returns the earlier transform at alpha 0", () => {
        expect(interpolateBody3d(body(1, 0), body(1, 10), 0).position).toEqual([0, 0, 0]);
    });
    it("returns the midpoint at alpha 0.5", () => {
        expect(interpolateBody3d(body(1, 0), body(1, 10), 0.5).position).toEqual([5, 0, 0]);
    });
    it("returns the later transform at alpha 1", () => {
        expect(interpolateBody3d(body(1, 0), body(1, 10), 1).position).toEqual([10, 0, 0]);
    });
    it("clamps an out-of-range alpha", () => {
        expect(interpolateBody3d(body(1, 0), body(1, 10), 1.5).position).toEqual([10, 0, 0]);
        expect(interpolateBody3d(body(1, 0), body(1, 10), -0.5).position).toEqual([0, 0, 0]);
    });
    it("refuses to interpolate two different bodies", () => {
        expect(() => interpolateBody3d(body(1, 0), body(2, 10), 0.5)).toThrow(/same body/);
    });
});
describe("interpolateBodies3d", () => {
    it("interpolates every body present in both snapshots", () => {
        const from = [body(1, 0), body(2, 100)];
        const to = [body(1, 10), body(2, 100)];
        const result = interpolateBodies3d(from, to, 0.5);
        expect(result.find((b) => b.id === 1).position).toEqual([5, 0, 0]);
        expect(result.find((b) => b.id === 2).position).toEqual([100, 0, 0]);
    });
    it("renders a newly spawned body at its own transform, unblended", () => {
        const result = interpolateBodies3d([body(1, 0)], [body(1, 5), body(2, 42)], 0.5);
        expect(result.find((b) => b.id === 2).position).toEqual([42, 0, 0]);
    });
    it("drops a body that no longer exists in the later snapshot", () => {
        const result = interpolateBodies3d([body(1, 0), body(2, 0)], [body(1, 1)], 0.5);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
    });
});
//# sourceMappingURL=physics-interpolation.test.js.map