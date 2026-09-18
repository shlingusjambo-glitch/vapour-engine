import { describe, expect, it, vi } from "vitest";
import { Scheduler, waitFor, waitFrames, waitSeconds, waitUntil } from "./scheduler.js";
describe("timers", () => {
    it("fires a one-shot timer once the simulation clock reaches it", () => {
        const scheduler = new Scheduler();
        const fired = vi.fn();
        scheduler.after(1, fired);
        scheduler.advance(0.5);
        expect(fired).not.toHaveBeenCalled();
        scheduler.advance(0.5);
        expect(fired).toHaveBeenCalledOnce();
        scheduler.advance(10);
        expect(fired).toHaveBeenCalledOnce();
        expect(scheduler.stats().timers).toBe(0);
    });
    it("repeats on an interval and catches up across a long delta", () => {
        const scheduler = new Scheduler();
        const fired = vi.fn();
        scheduler.every(0.25, fired);
        scheduler.advance(1);
        // A hitch must not silently swallow ticks.
        expect(fired).toHaveBeenCalledTimes(4);
    });
    it("reports remaining time and cancels", () => {
        const scheduler = new Scheduler();
        const fired = vi.fn();
        const handle = scheduler.after(2, fired);
        scheduler.advance(0.5);
        expect(handle.remaining).toBeCloseTo(1.5);
        handle.cancel();
        expect(handle.remaining).toBe(0);
        scheduler.advance(10);
        expect(fired).not.toHaveBeenCalled();
    });
    it("lets a timer callback schedule and cancel other timers safely", () => {
        const scheduler = new Scheduler();
        const seen = [];
        // Registered first, so it runs first and can cancel the one behind it.
        let second;
        scheduler.after(0.5, () => {
            seen.push("first");
            second.cancel();
            scheduler.after(0.5, () => seen.push("nested"));
        });
        second = scheduler.after(0.5, () => seen.push("second"));
        scheduler.advance(0.5);
        expect(seen).toEqual(["first"]);
        scheduler.advance(0.5);
        expect(seen).toEqual(["first", "nested"]);
    });
    it("validates its arguments", () => {
        const scheduler = new Scheduler();
        expect(() => scheduler.after(-1, () => { })).toThrow(/non-negative delay/);
        expect(() => scheduler.every(0, () => { })).toThrow(/positive interval/);
        expect(() => scheduler.after(1, undefined)).toThrow(/callback function/);
        expect(() => scheduler.advance(-1)).toThrow(/non-negative delta/);
    });
    it("refuses a re-entrant advance", () => {
        const scheduler = new Scheduler();
        let error;
        scheduler.after(0, () => {
            try {
                scheduler.advance(1);
            }
            catch (caught) {
                error = caught;
            }
        });
        scheduler.advance(0.1);
        expect(String(error)).toMatch(/re-entrantly/);
    });
    it("tracks elapsed simulation time and step count", () => {
        const scheduler = new Scheduler();
        scheduler.advance(0.25);
        scheduler.advance(0.25);
        expect(scheduler.stats()).toMatchObject({ elapsedSeconds: 0.5, steps: 2 });
    });
});
describe("coroutines", () => {
    it("runs to its first yield immediately", () => {
        const scheduler = new Scheduler();
        const seen = [];
        scheduler.run(function* () {
            seen.push("start");
            yield waitSeconds(1);
            seen.push("after");
        });
        expect(seen).toEqual(["start"]);
        scheduler.advance(1);
        expect(seen).toEqual(["start", "after"]);
    });
    it("waits the requested simulation seconds", () => {
        const scheduler = new Scheduler();
        const seen = [];
        scheduler.run(function* () {
            yield waitSeconds(0.5);
            seen.push(1);
            yield waitSeconds(0.5);
            seen.push(2);
        });
        scheduler.advance(0.4);
        expect(seen).toEqual([]);
        scheduler.advance(0.4);
        expect(seen).toEqual([1]);
        scheduler.advance(0.4);
        expect(seen).toEqual([1, 2]);
    });
    it("waits a number of steps", () => {
        const scheduler = new Scheduler();
        const seen = [];
        scheduler.run(function* () {
            yield waitFrames(2);
            seen.push("done");
        });
        scheduler.advance(1);
        scheduler.advance(1);
        expect(seen).toEqual([]);
        scheduler.advance(1);
        expect(seen).toEqual(["done"]);
    });
    it("waits until a predicate holds, checked once per step", () => {
        const scheduler = new Scheduler();
        let ready = false;
        const seen = [];
        scheduler.run(function* () {
            yield waitUntil(() => ready);
            seen.push("go");
        });
        scheduler.advance(1);
        expect(seen).toEqual([]);
        ready = true;
        scheduler.advance(1);
        expect(seen).toEqual(["go"]);
    });
    it("resumes when an awaited promise settles", async () => {
        const scheduler = new Scheduler();
        const seen = [];
        let resolve;
        const promise = new Promise((r) => { resolve = r; });
        scheduler.run(function* () {
            yield waitFor(promise);
            seen.push("loaded");
        });
        scheduler.advance(1);
        expect(seen).toEqual([]);
        resolve();
        await promise;
        scheduler.advance(1);
        expect(seen).toEqual(["loaded"]);
    });
    it("throws a rejected promise back into the coroutine", async () => {
        const scheduler = new Scheduler();
        const seen = [];
        const promise = Promise.reject(new Error("offline"));
        scheduler.run(function* () {
            try {
                yield waitFor(promise);
            }
            catch (error) {
                seen.push(error.message);
            }
        });
        await promise.catch(() => undefined);
        scheduler.advance(1);
        expect(seen).toEqual(["offline"]);
    });
    it("reports completion and stops tracking finished coroutines", () => {
        const scheduler = new Scheduler();
        const handle = scheduler.run(function* () {
            yield waitSeconds(1);
        });
        expect(handle.done).toBe(false);
        scheduler.advance(1);
        expect(handle.done).toBe(true);
        expect(scheduler.stats().coroutines).toBe(0);
    });
    it("runs a cancelled coroutine's finally block", () => {
        const scheduler = new Scheduler();
        const seen = [];
        const handle = scheduler.run(function* () {
            try {
                yield waitSeconds(10);
            }
            finally {
                seen.push("cleanup");
            }
        });
        handle.cancel();
        expect(seen).toEqual(["cleanup"]);
        expect(handle.done).toBe(true);
        scheduler.advance(20);
        expect(seen).toEqual(["cleanup"]);
    });
    it("advances past a bare yield within one step but still yields control", () => {
        const scheduler = new Scheduler();
        const seen = [];
        scheduler.run(function* () {
            seen.push(1);
            yield waitFrames(0);
            seen.push(2);
        });
        expect(seen).toEqual([1]);
        scheduler.advance(0);
        expect(seen).toEqual([1, 2]);
    });
    it("produces the same sequence for the same delta sequence", () => {
        const record = () => {
            const scheduler = new Scheduler();
            const seen = [];
            scheduler.every(0.3, () => seen.push(`timer@${scheduler.elapsedSeconds.toFixed(2)}`));
            scheduler.run(function* () {
                yield waitSeconds(0.5);
                seen.push(`coroutine@${scheduler.elapsedSeconds.toFixed(2)}`);
                yield waitFrames(1);
                seen.push(`frames@${scheduler.elapsedSeconds.toFixed(2)}`);
            });
            for (const delta of [0.1, 0.25, 0.4, 0.05, 0.6])
                scheduler.advance(delta);
            return seen;
        };
        expect(record()).toEqual(record());
    });
    it("clears everything and runs coroutine cleanup", () => {
        const scheduler = new Scheduler();
        const seen = [];
        scheduler.after(1, () => seen.push("timer"));
        scheduler.run(function* () {
            try {
                yield waitSeconds(5);
            }
            finally {
                seen.push("cleanup");
            }
        });
        scheduler.clear();
        scheduler.advance(10);
        expect(seen).toEqual(["cleanup"]);
        expect(scheduler.stats()).toMatchObject({ timers: 0, coroutines: 0 });
    });
    it("validates wait arguments", () => {
        expect(() => waitSeconds(-1)).toThrow(/non-negative duration/);
        expect(() => waitFrames(1.5)).toThrow(/whole number of frames/);
        expect(() => waitUntil(undefined)).toThrow(/predicate function/);
    });
});
//# sourceMappingURL=scheduler.test.js.map