import { describe, expect, it } from "vitest";
import { quatFromEuler } from "@vapour/math";
import { Diagnostics } from "../diagnostics/counters.js";
import { batchText, CachedTextLayout, screenTextTransform, TEXT_COUNTERS, textBatchBounds, worldTextTransform } from "./text-batch.js";
/** Mirage M92: measurement-free caching, batching by material, and placement. */
const font = {
    id: "font:test", material: "material:font", textureSize: [64, 32], designSize: 10, lineHeight: 12,
    glyphs: [
        { character: "A", rect: [0, 0, 8, 10], advance: 8, bearing: [0, 8] },
        { character: "B", rect: [8, 0, 7, 10], advance: 7, bearing: [0, 8] },
    ],
};
const other = { ...font, id: "font:other", material: "material:other" };
describe("CachedTextLayout", () => {
    it("returns the same layout for repeated text and counts hits and misses", () => {
        const diagnostics = new Diagnostics({ now: () => 0 });
        const cache = new CachedTextLayout({ diagnostics });
        const first = cache.layout(font, "AB", { fontSize: 10 });
        const second = cache.layout(font, "AB", { fontSize: 10 });
        expect(second).toBe(first);
        cache.layout(font, "AB", { fontSize: 20 });
        expect(diagnostics.counter(TEXT_COUNTERS.cacheHits).value).toBe(1);
        expect(diagnostics.counter(TEXT_COUNTERS.cacheMisses).value).toBe(2);
        expect(diagnostics.counter(TEXT_COUNTERS.cacheEntries).value).toBe(2);
        expect(cache.stats().bytes).toBeGreaterThan(0);
    });
    it("evicts least-recently-used entries at the size limit", () => {
        const cache = new CachedTextLayout({ maxEntries: 1 });
        const a = cache.layout(font, "A", { fontSize: 10 });
        cache.layout(font, "B", { fontSize: 10 });
        expect(cache.layout(font, "A", { fontSize: 10 })).not.toBe(a);
    });
});
describe("batchText", () => {
    it("merges labels sharing a material into one mesh with offset positions and rebased indices", () => {
        const diagnostics = new Diagnostics({ now: () => 0 });
        const cache = new CachedTextLayout();
        const a = cache.layout(font, "A", { fontSize: 10 });
        const b = cache.layout(font, "B", { fontSize: 10 });
        const batches = batchText([{ layout: a, position: [0, 0] }, { layout: b, position: [100, 50] }], diagnostics);
        expect(batches).toHaveLength(1);
        const batch = batches[0];
        expect(batch.labelCount).toBe(2);
        expect(batch.glyphCount).toBe(2);
        expect(batch.mesh.positions).toHaveLength(8 * 3);
        expect(batch.mesh.indices).toHaveLength(12);
        // The second label's first vertex is its own first vertex plus the offset.
        expect(batch.mesh.positions[12]).toBeCloseTo(b.mesh.positions[0] + 100);
        expect(batch.mesh.positions[13]).toBeCloseTo(b.mesh.positions[1] + 50);
        // Its indices address the second quad.
        expect(Array.from(batch.mesh.indices.slice(6))).toEqual([4, 5, 6, 4, 6, 7]);
        expect(diagnostics.counter(TEXT_COUNTERS.batches).value).toBe(1);
        expect(diagnostics.counter(TEXT_COUNTERS.batchedGlyphs).value).toBe(2);
    });
    it("keeps different materials in different batches", () => {
        const cache = new CachedTextLayout();
        const batches = batchText([
            { layout: cache.layout(font, "A", { fontSize: 10 }), position: [0, 0] },
            { layout: cache.layout(other, "A", { fontSize: 10 }), position: [0, 0] },
            { layout: cache.layout(font, "B", { fontSize: 10 }), position: [0, 0] },
        ]);
        expect(batches.map((batch) => [batch.material, batch.labelCount])).toEqual([["material:font", 2], ["material:other", 1]]);
    });
    it("applies a per-label scale", () => {
        const cache = new CachedTextLayout();
        const a = cache.layout(font, "A", { fontSize: 10 });
        const [batch] = batchText([{ layout: a, position: [0, 0], scale: 0.5 }]);
        expect(batch.mesh.positions[3]).toBeCloseTo(a.mesh.positions[3] * 0.5);
    });
});
describe("placement", () => {
    it("places a screen batch by pixel offset", () => {
        const cache = new CachedTextLayout();
        const [batch] = batchText([{ layout: cache.layout(font, "A", { fontSize: 10 }), position: [0, 0] }]);
        const bounds = textBatchBounds(batch, screenTextTransform(10, 20));
        expect(bounds.min[0]).toBeCloseTo(10);
        expect(bounds.max[0]).toBeCloseTo(18);
    });
    it("places a world batch in metres with +Y up", () => {
        const cache = new CachedTextLayout();
        const [batch] = batchText([{ layout: cache.layout(font, "A", { fontSize: 10 }), position: [0, 0] }]);
        // 100 pixels per metre: an 8px glyph is 0.08 m wide; the glyph's top (y=8, +Y down) becomes +0.08 m.
        const bounds = textBatchBounds(batch, worldTextTransform([1, 2, 3], [0, 0, 0, 1], 100));
        expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(0.08);
        expect(bounds.max[1]).toBeCloseTo(2 + 0.08);
        expect(bounds.min[2]).toBeCloseTo(3);
        const rotated = textBatchBounds(batch, worldTextTransform([0, 0, 0], quatFromEuler([0, 90, 0]), 100));
        expect(rotated.max[0] - rotated.min[0]).toBeLessThan(1e-6);
        expect(rotated.max[2] - rotated.min[2]).toBeCloseTo(0.08);
        expect(() => worldTextTransform([0, 0, 0], [0, 0, 0, 1], 0)).toThrow(/positive/);
    });
});
//# sourceMappingURL=text-batch.test.js.map