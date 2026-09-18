import { describe, expect, it } from "vitest";
import { ChunkStreamManager } from "../index.js";
import { StreamingNavMesh } from "./streaming-navmesh.js";
const CHUNK = 16;
const source = {
    load(coordinate) {
        const x0 = coordinate.x * CHUNK, z0 = coordinate.z * CHUNK, x1 = x0 + CHUNK, z1 = z0 + CHUNK;
        return { ground: { positions: new Float32Array([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1]), indices: new Uint32Array([0, 2, 1, 0, 3, 2]) } };
    },
};
describe("StreamingNavMesh (M124)", () => {
    it("rebakes a chunk's footprint as it streams in and out", async () => {
        const manager = new ChunkStreamManager(source, { unloadDelayUpdates: 0 });
        const streaming = new StreamingNavMesh({ chunkSize: CHUNK, geometry: (tile) => tile.ground, settings: { cellSize: 0.5, agentRadius: 0.5 } });
        manager.subscribe((event) => streaming.handle(event));
        expect(streaming.navmesh.isEmpty).toBe(true);
        manager.update([{ coordinate: { x: 0, y: 0, z: 0 }, radius: 0 }]);
        await manager.settleActiveLoads();
        const first = streaming.navmesh;
        expect(streaming.rebakes).toBe(1);
        expect(first.spanCount).toBeGreaterThan(0);
        expect(first.isWalkable([8, 0, 8])).toBe(true);
        expect(first.findPath([2, 0, 2], [14, 0, 14]).status).toBe("complete");
        // The observer walks one chunk east: chunk 1 loads, chunk 0 unloads.
        manager.update([{ coordinate: { x: 1, y: 0, z: 0 }, radius: 0 }]);
        await manager.settleActiveLoads();
        expect(streaming.rebakes).toBe(3);
        expect(streaming.navmesh).not.toBe(first);
        expect(streaming.navmesh.isWalkable([24, 0, 8])).toBe(true);
        expect(streaming.navmesh.isWalkable([8, 0, 8])).toBe(false);
        expect(streaming.navmesh.findPath([2, 0, 2], [14, 0, 14]).status).not.toBe("complete");
        manager.destroy();
    });
    it("connects neighbouring chunks and keeps a neighbour's edge when one unloads", async () => {
        const manager = new ChunkStreamManager(source, { unloadDelayUpdates: 0, shape: "box", maxStartsPerUpdate: 9, maxConcurrentLoads: 9 });
        const streaming = new StreamingNavMesh({ chunkSize: CHUNK, geometry: (tile) => tile.ground, settings: { cellSize: 0.5, agentRadius: 0.5 } });
        manager.subscribe((event) => streaming.handle(event));
        manager.update([{ coordinate: { x: 0, y: 0, z: 0 }, radius: 1 }]);
        await manager.settleActiveLoads();
        expect(streaming.rebakes).toBe(9);
        const across = streaming.navmesh.findPath([-12, 0, -12], [28, 0, 28]);
        expect(across.status).toBe("complete");
        manager.update([{ coordinate: { x: 0, y: 0, z: 0 }, radius: 0 }]);
        await manager.settleActiveLoads();
        expect(streaming.rebakes).toBe(17);
        // Chunk 0 survives intact, including its boundary columns.
        expect(streaming.navmesh.isWalkable([1, 0, 1])).toBe(true);
        expect(streaming.navmesh.isWalkable([15, 0, 15])).toBe(true);
        expect(streaming.navmesh.isWalkable([20, 0, 20])).toBe(false);
        manager.destroy();
    });
    it("ignores failed loads and rejects a bad chunk size", () => {
        const streaming = new StreamingNavMesh({ chunkSize: CHUNK, geometry: (tile) => tile.ground });
        streaming.handle({ type: "failed", coordinate: { x: 0, y: 0, z: 0 }, error: new Error("nope"), attempts: 1 });
        expect(streaming.rebakes).toBe(0);
        expect(() => new StreamingNavMesh({ chunkSize: 0, geometry: (tile) => tile.ground })).toThrow(/chunk size/);
    });
});
//# sourceMappingURL=streaming-navmesh.test.js.map