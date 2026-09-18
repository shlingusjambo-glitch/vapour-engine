import { describe, expect, it } from "vitest";
import { AIR_BLOCK, VoxelChunk, VoxelPalette, VoxelWorld, chunkKey, floorDiv, floorMod } from "./voxel-world.js";
const stone = { id: 1, name: "Stone", solid: true, opaque: true, color: [0.5, 0.5, 0.5, 1] };
describe("VoxelPalette", () => {
    it("reserves air and resolves collision/render properties", () => {
        const palette = new VoxelPalette([stone]);
        expect(palette.require(AIR_BLOCK).name).toBe("Air");
        expect(palette.isSolid(0)).toBe(false);
        expect(palette.isSolid(1)).toBe(true);
        expect(palette.isOpaque(99)).toBe(false);
    });
    it("rejects invalid and duplicate definitions loudly", () => {
        const palette = new VoxelPalette([stone]);
        expect(() => palette.define(stone)).toThrow(/already defined/);
        expect(() => palette.define({ ...stone, id: 0 })).toThrow(/reserved/);
        expect(() => palette.require(77)).toThrow(/does not define/);
    });
});
describe("VoxelChunk", () => {
    it("stores dense blocks and increments revisions only for changes", () => {
        const chunk = new VoxelChunk(-2, 3, 4, 8);
        expect(chunk.blocks).toHaveLength(128);
        expect(chunk.setBlock(3, 7, 1, 12)).toBe(true);
        expect(chunk.block(3, 7, 1)).toBe(12);
        expect(chunk.revision).toBe(1);
        expect(chunk.setBlock(3, 7, 1, 12)).toBe(false);
        expect(chunk.revision).toBe(1);
    });
    it("validates coordinates and replacement sizes", () => {
        const chunk = new VoxelChunk(0, 0, 2, 2);
        expect(() => chunk.block(2, 0, 0)).toThrow(RangeError);
        expect(() => chunk.replace(new Uint16Array(2))).toThrow(/needs 8 blocks/);
    });
});
describe("VoxelWorld", () => {
    it("maps negative world coordinates to the correct chunk and local cell", () => {
        const world = new VoxelWorld({ chunkSize: 16, height: 32 });
        world.setBlock(-1, 5, -17, 8);
        expect(world.chunk(-1, -2)?.block(15, 5, 15)).toBe(8);
        expect(world.getBlock(-1, 5, -17)).toBe(8);
        expect(world.getBlock(-1, -1, -17)).toBe(AIR_BLOCK);
        expect(floorDiv(-1, 16)).toBe(-1);
        expect(floorMod(-1, 16)).toBe(15);
    });
    it("tracks the edited chunk and seam neighbours", () => {
        const world = new VoxelWorld({ chunkSize: 4, height: 8 });
        world.takeDirtyChunks();
        world.setBlock(0, 1, 3, 1);
        expect(world.takeDirtyChunks()).toEqual([
            { x: -1, z: 0 },
            { x: 0, z: 0 },
            { x: 0, z: 1 },
        ]);
        world.setBlock(1, 1, 1, 1);
        expect(world.takeDirtyChunks()).toEqual([{ x: 0, z: 0 }]);
    });
    it("accepts worker chunk data by defensive copy", () => {
        const world = new VoxelWorld({ chunkSize: 2, height: 2 });
        const data = new Uint16Array(8);
        data[7] = 4;
        world.setChunk(1, 2, data);
        data[7] = 9;
        expect(world.getBlock(3, 1, 5)).toBe(4);
        expect(world.chunkCount).toBe(1);
    });
    it("deleting a chunk exposes all four neighbours for remeshing", () => {
        const world = new VoxelWorld({ chunkSize: 2, height: 2 });
        world.ensureChunk(4, -3);
        world.takeDirtyChunks();
        expect(world.deleteChunk(4, -3)).toBe(true);
        expect(world.takeDirtyChunks().map(({ x, z }) => chunkKey(x, z))).toEqual([
            "4,-4", "3,-3", "4,-3", "5,-3", "4,-2",
        ]);
    });
});
//# sourceMappingURL=voxel-world.test.js.map