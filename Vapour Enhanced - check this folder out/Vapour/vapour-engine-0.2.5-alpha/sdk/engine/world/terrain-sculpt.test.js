import { describe, expect, it } from "vitest";
import { TerrainSplatMap } from "./terrain-chunks.js";
import { TerrainEditHistory, TerrainPaintbrush, TerrainSculptor, brushWeight, generateProceduralHeights, } from "./terrain-sculpt.js";
import { TerrainHeightfield } from "./terrain.js";
function flatField(rows = 9, columns = 9) {
    return new TerrainHeightfield({ rows, columns, heights: new Float32Array(rows * columns), scale: [64, 16, 64] });
}
describe("brushWeight", () => {
    it("is full strength at the centre and zero at/beyond the radius", () => {
        expect(brushWeight(0, { radius: 4 })).toBeCloseTo(1);
        expect(brushWeight(4, { radius: 4 })).toBe(0);
        expect(brushWeight(5, { radius: 4 })).toBe(0);
    });
    it("linear falloff decreases monotonically", () => {
        const a = brushWeight(1, { radius: 4, falloff: "linear" });
        const b = brushWeight(3, { radius: 4, falloff: "linear" });
        expect(a).toBeGreaterThan(b);
    });
    it("rejects a non-positive radius", () => {
        expect(() => brushWeight(0, { radius: 0 })).toThrow();
    });
});
describe("TerrainSculptor", () => {
    it("raises heights under the brush and leaves the rest untouched", () => {
        const field = flatField();
        const sculptor = new TerrainSculptor(field);
        const patch = sculptor.raise(4, 4, { radius: 2 }, 1);
        expect(field.heights[4 * 9 + 4]).toBeGreaterThan(0);
        expect(field.heights[0]).toBe(0);
        expect(patch.edits.length).toBeGreaterThan(0);
    });
    it("lower is the exact inverse of raise for the same brush", () => {
        const field = flatField();
        const sculptor = new TerrainSculptor(field);
        sculptor.raise(4, 4, { radius: 2 }, 1);
        const before = field.heights[4 * 9 + 4];
        sculptor.lower(4, 4, { radius: 2 }, 1);
        expect(field.heights[4 * 9 + 4]).toBeCloseTo(before - 1 * 1);
    });
    it("flatten moves samples toward the target without overshoot at full weight", () => {
        const field = flatField();
        const sculptor = new TerrainSculptor(field);
        sculptor.flatten(4, 4, { radius: 0.5, falloff: "constant" }, 2);
        expect(field.heights[4 * 9 + 4]).toBeCloseTo(2);
    });
    it("smooth pulls a spike toward its neighbourhood average", () => {
        const field = flatField();
        field.heights[4 * 9 + 4] = 10;
        const sculptor = new TerrainSculptor(field);
        sculptor.smooth(4, 4, { radius: 0.5, falloff: "constant" });
        expect(field.heights[4 * 9 + 4]).toBeLessThan(10);
        expect(field.heights[4 * 9 + 4]).toBeGreaterThan(0);
    });
    it("is deterministic: the same operations on two fresh fields agree exactly", () => {
        const a = flatField();
        const b = flatField();
        for (const field of [a, b]) {
            const sculptor = new TerrainSculptor(field);
            sculptor.raise(3, 3, { radius: 3, falloff: "smooth" }, 2);
            sculptor.smooth(3, 3, { radius: 2 });
        }
        expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    });
});
describe("TerrainEditHistory", () => {
    it("undoes and redoes a height patch back to the exact prior values", () => {
        const field = flatField();
        const sculptor = new TerrainSculptor(field);
        const history = new TerrainEditHistory();
        const before = Array.from(field.heights);
        const patch = sculptor.raise(4, 4, { radius: 2 }, 3);
        history.record(patch);
        expect(Array.from(field.heights)).not.toEqual(before);
        history.undo({ heightfield: field });
        expect(Array.from(field.heights)).toEqual(before);
        expect(history.canRedo).toBe(true);
        history.redo({ heightfield: field });
        const afterRaise = Array.from(field.heights);
        expect(afterRaise).not.toEqual(before);
    });
    it("undoing twice with nothing left is a no-op", () => {
        const history = new TerrainEditHistory();
        expect(history.undo({})).toBeUndefined();
    });
    it("recording a new patch clears the redo stack", () => {
        const field = flatField();
        const sculptor = new TerrainSculptor(field);
        const history = new TerrainEditHistory();
        history.record(sculptor.raise(4, 4, { radius: 1 }, 1));
        history.undo({ heightfield: field });
        expect(history.canRedo).toBe(true);
        history.record(sculptor.raise(1, 1, { radius: 1 }, 1));
        expect(history.canRedo).toBe(false);
    });
    it("undoes a splat paint patch back to the prior weights", () => {
        const splat = new TerrainSplatMap(9, 9, 2);
        const brush = new TerrainPaintbrush(splat);
        const history = new TerrainEditHistory();
        const before = splat.weightsAt(splat.vertexIndex(4, 4));
        history.record(brush.paint(4, 4, { radius: 2 }, 1));
        expect(splat.weightsAt(splat.vertexIndex(4, 4))).not.toEqual(before);
        history.undo({ splat });
        expect(splat.weightsAt(splat.vertexIndex(4, 4))).toEqual(before);
    });
});
describe("generateProceduralHeights", () => {
    it("is deterministic for the same seed", () => {
        const a = generateProceduralHeights({ seed: "island", rows: 5, columns: 5, scale: [10, 10, 10] });
        const b = generateProceduralHeights({ seed: "island", rows: 5, columns: 5, scale: [10, 10, 10] });
        expect(a(0.3, 0.7)).toBe(b(0.3, 0.7));
    });
    it("feeds TerrainHeightfield.generate directly", () => {
        const sampler = generateProceduralHeights({ seed: 42, rows: 9, columns: 9, scale: [10, 10, 10], noise: { octaves: 3 } });
        const field = TerrainHeightfield.generate(9, 9, [64, 16, 64], (x, z) => sampler(x, z));
        expect(field.heights.length).toBe(81);
        expect(Array.from(field.heights).every(Number.isFinite)).toBe(true);
    });
});
//# sourceMappingURL=terrain-sculpt.test.js.map