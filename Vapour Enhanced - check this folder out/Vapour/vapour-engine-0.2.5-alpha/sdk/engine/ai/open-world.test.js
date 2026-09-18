import { describe, expect, it } from "vitest";
import { SimulationLodScheduler, SpatialEntityIndex, TrafficSignalController } from "./open-world.js";
describe("SpatialEntityIndex", () => {
    it("tracks moving entities and returns deterministic nearest results", () => {
        const index = new SpatialEntityIndex(10);
        index.upsert({ id: "far", x: 8, y: 0, z: 0, kind: "car" });
        index.upsert({ id: "near", x: 2, y: 0, z: 0, kind: "person" });
        expect(index.queryRadius({ x: 0, y: 0, z: 0 }, 10).map((e) => e.id)).toEqual(["near", "far"]);
        index.upsert({ id: "near", x: 100, y: 0, z: 0, kind: "person" });
        expect(index.queryRadius({ x: 0, y: 0, z: 0 }, 10, (e) => e.kind === "person")).toEqual([]);
        expect(index.remove("far")).toBe(true);
    });
});
describe("SimulationLodScheduler", () => {
    it("ticks near actors, throttles middle distance, and sleeps remote actors", () => {
        const scheduler = new SimulationLodScheduler({ fullDistance: 10, reducedDistance: 30, reducedHz: 5 });
        expect(scheduler.evaluate("near", { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0.016)).toMatchObject({ tier: "full", shouldTick: true });
        expect(scheduler.evaluate("far", { x: 40, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0.016)).toEqual({ tier: "dormant", shouldTick: false, deltaSeconds: 0 });
        let total = 0, ticks = 0;
        for (let i = 0; i < 60; i += 1) {
            const result = scheduler.evaluate("mid", { x: 20, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1 / 60);
            if (result.shouldTick) {
                ticks++;
                total += result.deltaSeconds;
            }
        }
        expect(ticks).toBeGreaterThanOrEqual(4);
        expect(ticks).toBeLessThanOrEqual(6);
        expect(total).toBeGreaterThan(0.8);
    });
});
describe("TrafficSignalController", () => {
    it("cycles green, yellow, clearance, then the next approach", () => {
        const signal = new TrafficSignalController([{ greenSeconds: 10, yellowSeconds: 3, clearanceSeconds: 1 }, { greenSeconds: 8 }]);
        expect(signal.permits(0)).toBe(true);
        expect(signal.update(10)).toMatchObject({ approach: 0, phase: "yellow", remainingSeconds: 3 });
        expect(signal.update(3)).toMatchObject({ approach: 0, phase: "all-red", remainingSeconds: 1 });
        expect(signal.update(1)).toMatchObject({ approach: 1, phase: "green", remainingSeconds: 8 });
        expect(signal.permits(0)).toBe(false);
        expect(signal.permits(1)).toBe(true);
    });
});
//# sourceMappingURL=open-world.test.js.map