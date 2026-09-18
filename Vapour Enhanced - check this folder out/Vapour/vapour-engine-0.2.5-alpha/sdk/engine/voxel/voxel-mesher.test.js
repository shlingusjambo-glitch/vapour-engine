import { describe, expect, it } from "vitest";
import { meshVoxelChunk } from "./voxel-mesher.js";
import { VoxelPalette, VoxelWorld } from "./voxel-world.js";
const palette = new VoxelPalette([
    { id: 1, name: "Stone", solid: true, opaque: true, color: [0.8, 0.6, 0.4, 1] },
    { id: 2, name: "Glass", solid: true, opaque: false, color: [0.5, 0.8, 1, 0.5] },
]);
describe("meshVoxelChunk", () => {
    it("emits six indexed faces for one isolated cube", () => {
        const world = new VoxelWorld({ chunkSize: 4, height: 4 });
        world.setBlock(1, 1, 1, 1);
        const mesh = meshVoxelChunk(world, palette, 0, 0);
        expect(mesh.blockCount).toBe(1);
        expect(mesh.faceCount).toBe(6);
        expect(mesh.positions).toHaveLength(6 * 4 * 3);
        expect(mesh.indices).toHaveLength(6 * 6);
        expect(mesh.colors).toHaveLength(6 * 4 * 4);
    });
    it("culls shared faces inside and across chunks", () => {
        const world = new VoxelWorld({ chunkSize: 2, height: 2 });
        world.setBlock(0, 0, 0, 1);
        world.setBlock(1, 0, 0, 1);
        expect(meshVoxelChunk(world, palette, 0, 0).faceCount).toBe(10);
        world.setBlock(2, 0, 0, 1);
        expect(meshVoxelChunk(world, palette, 0, 0).faceCount).toBe(9);
        expect(meshVoxelChunk(world, palette, 1, 0).faceCount).toBe(5);
    });
    it("culls equal transparent interiors but preserves unlike boundaries", () => {
        const world = new VoxelWorld({ chunkSize: 4, height: 2 });
        world.setBlock(0, 0, 0, 2);
        world.setBlock(1, 0, 0, 2);
        expect(meshVoxelChunk(world, palette, 0, 0).faceCount).toBe(10);
        world.setBlock(2, 0, 0, 1);
        expect(meshVoxelChunk(world, palette, 0, 0).faceCount).toBe(15);
    });
    it("writes outward-facing triangles and unit normals", () => {
        const world = new VoxelWorld({ chunkSize: 2, height: 2 });
        world.setBlock(0, 0, 0, 1);
        const mesh = meshVoxelChunk(world, palette, 0, 0);
        for (let face = 0; face < mesh.faceCount; face += 1) {
            const vertex = face * 12;
            const ax = mesh.positions[vertex];
            const ay = mesh.positions[vertex + 1];
            const az = mesh.positions[vertex + 2];
            const bx = mesh.positions[vertex + 3];
            const by = mesh.positions[vertex + 4];
            const bz = mesh.positions[vertex + 5];
            const cx = mesh.positions[vertex + 6];
            const cy = mesh.positions[vertex + 7];
            const cz = mesh.positions[vertex + 8];
            const cross = [
                (by - ay) * (cz - az) - (bz - az) * (cy - ay),
                (bz - az) * (cx - ax) - (bx - ax) * (cz - az),
                (bx - ax) * (cy - ay) - (by - ay) * (cx - ax),
            ];
            const normal = face * 12;
            const dot = cross[0] * mesh.normals[normal] + cross[1] * mesh.normals[normal + 1] + cross[2] * mesh.normals[normal + 2];
            expect(dot).toBeGreaterThan(0);
        }
    });
    it("applies directional light without mutating alpha", () => {
        const world = new VoxelWorld({ chunkSize: 2, height: 2 });
        world.setBlock(0, 0, 0, 1);
        const mesh = meshVoxelChunk(world, palette, 0, 0, {
            faceLight: { east: 0.5, west: 0.5, top: 0.5, bottom: 0.5, south: 0.5, north: 0.5 },
        });
        expect(mesh.colors[0]).toBeCloseTo(0.4);
        expect(mesh.colors[1]).toBeCloseTo(0.3);
        expect(mesh.colors[2]).toBeCloseTo(0.2);
        expect(mesh.colors[3]).toBe(1);
    });
    it("returns a valid empty upload for a missing or empty chunk", () => {
        const world = new VoxelWorld({ chunkSize: 2, height: 2 });
        expect(meshVoxelChunk(world, palette, 9, 9).indices).toHaveLength(0);
        world.ensureChunk(0, 0);
        expect(meshVoxelChunk(world, palette, 0, 0).faceCount).toBe(0);
    });
});
//# sourceMappingURL=voxel-mesher.test.js.map