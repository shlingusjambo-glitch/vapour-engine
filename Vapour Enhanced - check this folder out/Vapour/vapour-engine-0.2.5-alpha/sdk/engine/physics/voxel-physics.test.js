import { describe, expect, it } from "vitest";
import { moveVoxelBody, raycastVoxels } from "./voxel-physics.js";
import { VoxelPalette, VoxelWorld } from "../voxel/voxel-world.js";
const palette = new VoxelPalette([
    { id: 1, name: "Stone", solid: true, opaque: true, color: [0.6, 0.6, 0.6, 1] },
    { id: 2, name: "Water", solid: false, opaque: false, color: [0.1, 0.3, 0.8, 0.5] },
]);
function worldWithFloor() {
    const world = new VoxelWorld({ chunkSize: 8, height: 8 });
    for (let z = 0; z < 8; z += 1)
        for (let x = 0; x < 8; x += 1)
            world.setBlock(x, 0, z, 1);
    return world;
}
function body(position, velocity) {
    return { position, velocity, width: 0.6, height: 1.8, depth: 0.6, grounded: false };
}
describe("raycastVoxels", () => {
    it("finds an axis-aligned block and its entered face", () => {
        const world = new VoxelWorld({ chunkSize: 8, height: 8 });
        world.setBlock(3, 2, 1, 1);
        expect(raycastVoxels(world, palette, [0.5, 2.5, 1.5], [1, 0, 0], 10)).toEqual({
            x: 3, y: 2, z: 1, blockId: 1, distance: 2.5, normal: [-1, 0, 0],
        });
    });
    it("normalizes diagonal directions and respects max distance", () => {
        const world = new VoxelWorld({ chunkSize: 8, height: 8 });
        world.setBlock(2, 2, 2, 1);
        expect(raycastVoxels(world, palette, [0.5, 0.5, 0.5], [1, 1, 1], 2)).toBeUndefined();
        expect(raycastVoxels(world, palette, [0.5, 0.5, 0.5], [1, 1, 1], 4)?.blockId).toBe(1);
    });
    it("returns an immediate hit when the origin is inside solid and skips liquid", () => {
        const world = new VoxelWorld({ chunkSize: 8, height: 8 });
        world.setBlock(0, 0, 0, 1);
        world.setBlock(1, 0, 0, 2);
        expect(raycastVoxels(world, palette, [0.2, 0.2, 0.2], [1, 0, 0], 5)?.distance).toBe(0);
        world.setBlock(0, 0, 0, 0);
        expect(raycastVoxels(world, palette, [0.2, 0.2, 0.2], [1, 0, 0], 5)).toBeUndefined();
    });
    it("rejects invalid rays", () => {
        const world = new VoxelWorld();
        expect(() => raycastVoxels(world, palette, [0, 0, 0], [0, 0, 0], 2)).toThrow(/non-zero/);
        expect(() => raycastVoxels(world, palette, [0, 0, 0], [1, 0, 0], -1)).toThrow(/non-negative/);
    });
});
describe("moveVoxelBody", () => {
    it("lands on a floor and reports grounded", () => {
        const world = worldWithFloor();
        const player = body([2.5, 3, 2.5], [0, -10, 0]);
        const result = moveVoxelBody(world, palette, player, 1);
        expect(result.collidedY).toBe(true);
        expect(result.grounded).toBe(true);
        expect(player.position[1]).toBeCloseTo(1, 4);
        expect(player.velocity[1]).toBe(0);
    });
    it("cannot tunnel through a wall at high speed", () => {
        const world = worldWithFloor();
        for (let y = 1; y < 5; y += 1)
            world.setBlock(4, y, 2, 1);
        const player = body([1.5, 1, 2.5], [100, 0, 0]);
        const result = moveVoxelBody(world, palette, player, 1);
        expect(result.collidedX).toBe(true);
        expect(player.position[0]).toBeCloseTo(3.7, 4);
        expect(player.velocity[0]).toBe(0);
    });
    it("moves freely through non-solid blocks", () => {
        const world = worldWithFloor();
        world.setBlock(2, 1, 2, 2);
        const player = body([1.5, 1, 2.5], [2, 0, 0]);
        const result = moveVoxelBody(world, palette, player, 0.5);
        expect(result.collidedX).toBe(false);
        expect(player.position[0]).toBe(2.5);
    });
    it("supports upward ceiling collision without claiming grounded", () => {
        const world = worldWithFloor();
        world.setBlock(2, 3, 2, 1);
        const player = body([2.5, 1, 2.5], [0, 8, 0]);
        const result = moveVoxelBody(world, palette, player, 1);
        expect(result.collidedY).toBe(true);
        expect(result.grounded).toBe(false);
        expect(player.position[1] + player.height).toBeCloseTo(3, 4);
    });
});
//# sourceMappingURL=voxel-physics.test.js.map