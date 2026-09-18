import { describe, expect, it, vi } from "vitest";
import { ChunkStreamManager, planChunkInterest, spatialChunkKey, } from "./world-streaming.js";
function immediateSource(log = [], disposed = []) {
    return {
        load(coordinate, context) {
            const key = spatialChunkKey(coordinate);
            log.push(key);
            return { key, requestId: context.requestId };
        },
        dispose(value) { disposed.push(value.key); },
    };
}
function observer(radius = 0, verticalRadius = 0) {
    return { coordinate: { x: 0, y: 0, z: 0 }, radius, verticalRadius };
}
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
describe("ChunkStreamManager", () => {
    it("exposes the same stable planner to existing world pipelines", () => {
        const plan = planChunkInterest([observer(1, 1)], "cylinder", (coordinate) => {
            return coordinate.x * coordinate.x + coordinate.z * coordinate.z + Math.abs(coordinate.y) * 0.18;
        });
        expect(plan).toHaveLength(15);
        expect(plan[0]).toEqual({ coordinate: { x: 0, y: 0, z: 0 }, priority: 0 });
        expect(plan[1]?.priority).toBe(0.18);
        expect(() => planChunkInterest([observer()], "cylinder", () => Number.NaN)).toThrow(/priority/);
    });
    it("prioritizes nearest chunks under a per-update start budget", async () => {
        const loaded = [];
        const manager = new ChunkStreamManager(immediateSource(loaded), { maxStartsPerUpdate: 2, maxConcurrentLoads: 8 });
        const stats = manager.update([observer(2)]);
        expect(stats.desired).toBe(13);
        expect(stats.loading).toBe(2);
        await manager.settleActiveLoads();
        expect(loaded[0]).toBe("0,0,0");
        expect(loaded[1]).toBe("0,0,-1");
        manager.destroy();
    });
    it("supports cylindrical, box, and spherical interest volumes", () => {
        const cylinder = new ChunkStreamManager(immediateSource(), { shape: "cylinder", maxStartsPerUpdate: 1 });
        const box = new ChunkStreamManager(immediateSource(), { shape: "box", maxStartsPerUpdate: 1 });
        const sphere = new ChunkStreamManager(immediateSource(), { shape: "sphere", maxStartsPerUpdate: 1 });
        expect(cylinder.update([observer(1, 1)]).desired).toBe(15);
        expect(box.update([observer(1, 1)]).desired).toBe(27);
        expect(sphere.update([observer(1, 1)]).desired).toBe(7);
        cylinder.destroy();
        box.destroy();
        sphere.destroy();
    });
    it("bounds active asynchronous work", () => {
        const requests = [];
        const pending = [];
        const manager = new ChunkStreamManager({
            load(coordinate, context) {
                requests.push({ coordinate, context });
                const load = deferred();
                pending.push(load);
                return load.promise;
            },
        }, { maxConcurrentLoads: 2, maxStartsPerUpdate: 10 });
        expect(manager.update([observer(2)]).loading).toBe(2);
        expect(manager.stats().loading).toBe(2);
        manager.destroy();
    });
    it("cancels stale loads and disposes results that ignore abort", async () => {
        const load = deferred();
        let seenSignal;
        const dispose = vi.fn();
        const manager = new ChunkStreamManager({
            load: (_coordinate, context) => { seenSignal = context.signal; return load.promise; },
            dispose,
        });
        manager.update([observer()]);
        await Promise.resolve();
        manager.update([]);
        expect(seenSignal?.aborted).toBe(true);
        load.resolve({ key: "0,0,0", requestId: 1 });
        await manager.settleActiveLoads();
        expect(dispose).toHaveBeenCalledOnce();
        expect(manager.entries()).toEqual([]);
    });
    it("retains ready chunks briefly to avoid boundary thrash", async () => {
        const disposed = [];
        const manager = new ChunkStreamManager(immediateSource([], disposed), { unloadDelayUpdates: 2 });
        manager.update([observer()]);
        await manager.settleActiveLoads();
        expect(manager.stats().ready).toBe(1);
        manager.update([]);
        expect(manager.stats().ready).toBe(1);
        manager.update([]);
        expect(manager.stats().ready).toBe(0);
        expect(disposed).toEqual(["0,0,0"]);
    });
    it("retries desired failures after a deterministic update delay", async () => {
        let attempts = 0;
        const manager = new ChunkStreamManager({
            load(coordinate, context) {
                attempts += 1;
                if (attempts === 1)
                    throw new Error("worker crashed");
                return { key: spatialChunkKey(coordinate), requestId: context.requestId };
            },
        }, { retryDelayUpdates: 2 });
        manager.update([observer()]);
        await manager.settleActiveLoads();
        expect(manager.stats().failed).toBe(1);
        manager.update([observer()]);
        expect(manager.stats().failed).toBe(1);
        manager.update([observer()]);
        await manager.settleActiveLoads();
        expect(attempts).toBe(2);
        expect(manager.stats().ready).toBe(1);
        expect(manager.entry({ x: 0, y: 0, z: 0 })?.attempts).toBe(2);
    });
    it("deduplicates overlap from multiple observers", () => {
        const manager = new ChunkStreamManager(immediateSource(), { maxStartsPerUpdate: 1 });
        const stats = manager.update([
            { coordinate: { x: 0, y: 0, z: 0 }, radius: 1 },
            { coordinate: { x: 1, y: 0, z: 0 }, radius: 1 },
        ]);
        expect(stats.desired).toBe(8);
        manager.destroy();
    });
    it("emits ready, failed, and unloaded lifecycle notifications", async () => {
        const events = [];
        const manager = new ChunkStreamManager(immediateSource(), { unloadDelayUpdates: 0 });
        manager.subscribe((event) => events.push(event.type));
        manager.update([observer()]);
        await manager.settleActiveLoads();
        manager.update([]);
        expect(events).toEqual(["ready", "unloaded"]);
        const failed = new ChunkStreamManager({ load: () => { throw new Error("bad cell"); } });
        failed.subscribe((event) => events.push(event.type));
        failed.update([observer()]);
        await failed.settleActiveLoads();
        expect(events.at(-1)).toBe("failed");
    });
    it("validates configuration and coordinates", () => {
        expect(() => new ChunkStreamManager(immediateSource(), { maxConcurrentLoads: 0 })).toThrow(/positive/);
        const manager = new ChunkStreamManager(immediateSource());
        expect(() => manager.update([{ coordinate: { x: 0.5, y: 0, z: 0 }, radius: 1 }])).toThrow(/safe integers/);
        expect(() => manager.update([{ coordinate: { x: 0, y: 0, z: 0 }, radius: -1 }])).toThrow(/non-negative/);
        manager.destroy();
        expect(() => manager.update([])).toThrow(/destroyed/);
    });
});
//# sourceMappingURL=world-streaming.test.js.map