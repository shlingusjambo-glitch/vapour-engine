import { describe, expect, it } from "vitest";
import { loadNativePhysics3d } from "./native-test-world.js";
/**
 * Thousands of dynamic bodies falling onto a floor: the worst case for the
 * solver's broad phase and narrow phase, not a synthetic microbenchmark.
 *
 * Bounds are deliberately loose, matching the house style set by
 * `render-scale.perf.test.ts` and `net-scale.perf.test.ts` (see their
 * comments): a single step can spike far above the average from GC or OS
 * scheduling noise with no algorithmic regression behind it, so only the
 * *average* per-step cost is asserted against a tight-ish budget, and the
 * worst single step against a separate, much more generous one. The real
 * numbers are printed so a regression is visible long before either bound
 * trips.
 */
const BODY_COUNT = 2000;
const STEPS = 120;
const DT = 1 / 60;
const AVERAGE_MS_PER_STEP_BUDGET = 40;
const WORST_MS_PER_STEP_BUDGET = 400;
describe("physics scale", async () => {
    const world = await loadNativePhysics3d();
    it.skipIf(world === undefined)(`steps ${String(BODY_COUNT)} dynamic bodies without NaN/Infinity, within a generous budget`, () => {
        const native = world;
        native.insert({
            id: 1,
            bodyType: "static",
            position: [0, -0.5, 0],
            rotation: [0, 0, 0, 1],
            shape: { type: "box", halfExtents: [200, 0.5, 200] },
        });
        // A deterministic PRNG: reproducible spawn positions across runs, spread
        // over a wide floor so bodies do not all pile into one contact cluster.
        let seed = 987_654_321;
        const random = () => {
            seed = (seed * 1_103_515_245 + 12_345) >>> 0;
            return seed / 0x1_0000_0000;
        };
        for (let index = 0; index < BODY_COUNT; index += 1) {
            const id = index + 2;
            native.insert({
                id,
                bodyType: "dynamic",
                position: [(random() - 0.5) * 100, 5 + random() * 50, (random() - 0.5) * 100],
                rotation: [0, 0, 0, 1],
                shape: { type: "sphere", radius: 0.5 },
            });
        }
        let worstMs = 0;
        let totalMs = 0;
        let sawNaN = false;
        for (let step = 0; step < STEPS; step += 1) {
            const started = performance.now();
            const result = native.step(DT);
            const elapsed = performance.now() - started;
            worstMs = Math.max(worstMs, elapsed);
            totalMs += elapsed;
            for (const body of result.bodies) {
                if (![...body.position, ...body.rotation, ...body.linearVelocity, ...body.angularVelocity].every(Number.isFinite)) {
                    sawNaN = true;
                }
            }
        }
        const averageMs = totalMs / STEPS;
        console.log(`[physics-scale] ${String(BODY_COUNT)} dynamic bodies, ${String(STEPS)} steps: ` +
            `${averageMs.toFixed(2)} ms/step avg, ${worstMs.toFixed(2)} ms worst`);
        expect(sawNaN).toBe(false);
        expect(native.bodyCount).toBe(BODY_COUNT + 1);
        expect(averageMs).toBeLessThan(AVERAGE_MS_PER_STEP_BUDGET);
        expect(worstMs).toBeLessThan(WORST_MS_PER_STEP_BUDGET);
        native.destroy();
    });
});
//# sourceMappingURL=physics-scale.perf.test.js.map