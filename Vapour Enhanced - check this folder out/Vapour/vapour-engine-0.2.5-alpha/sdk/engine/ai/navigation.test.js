import { describe, expect, it } from "vitest";
import { findPath, gridNeighbours4, manhattanDistance, navigationNodeKey } from "./navigation.js";
describe("findPath", () => {
    it("routes around blocked cells deterministically", () => {
        const blocked = new Set(["1,0,0", "1,0,1"]);
        const result = findPath({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, {
            neighbours: gridNeighbours4, traversable: (node) => !blocked.has(navigationNodeKey(node)), heuristic: manhattanDistance, maxVisited: 100,
        });
        expect(result.status).toBe("complete");
        expect(result.cost).toBe(4);
        expect(result.path.map(navigationNodeKey)).toEqual(["0,0,0", "0,0,-1", "1,0,-1", "2,0,-1", "2,0,0"]);
    });
    it("distinguishes unreachable and budget-exceeded searches", () => {
        const enclosed = findPath({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { neighbours: gridNeighbours4, traversable: (node) => Math.abs(node.x) < 1 });
        expect(enclosed.status).toBe("unreachable");
        const budget = findPath({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { neighbours: gridNeighbours4, maxVisited: 2 });
        expect(budget).toMatchObject({ status: "budget-exceeded", visited: 2, path: [] });
    });
    it("validates custom costs and budgets", () => {
        expect(() => findPath({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { neighbours: gridNeighbours4, maxVisited: 0 })).toThrow("positive integer");
        expect(() => findPath({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { neighbours: gridNeighbours4, cost: () => -1 })).toThrow("finite and non-negative");
    });
});
//# sourceMappingURL=navigation.test.js.map