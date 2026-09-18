import { describe, expect, it } from "vitest";
import { VoxelGenerationPipeline } from "./voxel-generation.js";
describe("VoxelGenerationPipeline", () => {
    it("owns global/local traversal and ordered decorator passes", () => {
        const pipeline = new VoxelGenerationPipeline({ sectionSize: 2, sectionHeight: 3, fallbackDimension: "world" });
        pipeline.register({
            id: "world",
            generateColumn: ({ worldX, worldZ, set }) => set(0, worldX + worldZ + 20),
            decorate: [
                ({ set }) => set(0, 1, 0, 90),
                ({ get, set }) => set(0, 2, 0, get(0, 1, 0) + 1),
            ],
        });
        const blocks = pipeline.generate({ x: 1, y: 0, z: 2, dimension: "world", seed: "seed" });
        expect([...blocks]).toEqual([26, 27, 27, 28, 90, 0, 0, 0, 91, 0, 0, 0]);
    });
    it("supports plugin dimension resolvers and explicit fallback", () => {
        const pipeline = new VoxelGenerationPipeline({ sectionSize: 1, fallbackDimension: "overworld" });
        pipeline.register({ id: "overworld", generateColumn: ({ set }) => set(0, 1) });
        pipeline.registerResolver((id) => id.startsWith("arena:")
            ? { id, generateColumn: ({ set }) => set(0, 7) }
            : undefined);
        expect(pipeline.generate({ x: 0, y: 0, z: 0, dimension: "arena:red", seed: 1 })[0]).toBe(7);
        expect(pipeline.generate({ x: 0, y: 0, z: 0, dimension: "unknown", seed: 1 })[0]).toBe(1);
    });
    it("rejects invalid dimensions, coordinates, and block IDs", () => {
        const pipeline = new VoxelGenerationPipeline({ sectionSize: 1 });
        pipeline.register({ id: "default", generateColumn: ({ set }) => set(0, 70_000) });
        expect(() => pipeline.generate({ x: 0, y: 0, z: 0, dimension: "default", seed: 1 })).toThrow(/unsigned 16-bit/);
        expect(() => pipeline.generate({ x: 0.5, y: 0, z: 0, dimension: "default", seed: 1 })).toThrow(/safe integers/);
    });
});
//# sourceMappingURL=voxel-generation.test.js.map