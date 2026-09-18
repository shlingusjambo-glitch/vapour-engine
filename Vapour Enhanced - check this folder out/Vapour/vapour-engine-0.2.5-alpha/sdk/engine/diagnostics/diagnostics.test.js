import { describe, expect, it, vi } from "vitest";
import { COUNTERS, Counter, Diagnostics } from "./counters.js";
import { Logger, MemorySink, consoleSink, LOG_CATEGORIES } from "./logging.js";
import { DEBUG_CATEGORIES, DEBUG_COLORS, DebugDraw } from "./debug-draw.js";
describe("Counter", () => {
    it("summarizes a window of samples", () => {
        const counter = new Counter("frame.time", { unit: "milliseconds", window: 4 });
        for (const value of [10, 20, 30, 40])
            counter.set(value);
        expect(counter.sample()).toMatchObject({ name: "frame.time", unit: "milliseconds", mean: 25, min: 10, max: 40, samples: 4 });
    });
    it("reports a p95 that surfaces the spike a mean would hide", () => {
        const counter = new Counter("frame.time", { window: 100 });
        for (let index = 0; index < 99; index += 1)
            counter.set(16);
        counter.set(300);
        const sample = counter.sample();
        expect(sample.mean).toBeLessThan(20);
        expect(sample.max).toBe(300);
        expect(sample.p95).toBeGreaterThanOrEqual(16);
    });
    it("keeps only the newest samples in its ring", () => {
        const counter = new Counter("x", { window: 2 });
        counter.set(1);
        counter.set(2);
        counter.set(3);
        expect(counter.sample().samples).toBe(2);
        expect(counter.sample().min).toBe(2);
    });
    it("accumulates with add and records one sample on commit", () => {
        const counter = new Counter("render.drawCalls");
        counter.add(3);
        counter.add(4);
        expect(counter.value).toBe(7);
        counter.commit();
        expect(counter.value).toBe(0);
        expect(counter.sample()).toMatchObject({ samples: 1, max: 7 });
    });
    it("returns a zeroed sample before anything is recorded", () => {
        expect(new Counter("x").sample()).toMatchObject({ samples: 0, mean: 0, max: 0, p95: 0 });
    });
    it("validates its name, window, and values", () => {
        expect(() => new Counter(" ")).toThrow(/non-empty name/);
        expect(() => new Counter("x", { window: 0 })).toThrow(/at least one sample/);
        expect(() => new Counter("x").set(Number.NaN)).toThrow(/non-finite value/);
        expect(() => new Counter("x").add(Infinity)).toThrow(/non-finite delta/);
    });
    it("resets", () => {
        const counter = new Counter("x");
        counter.set(5);
        counter.reset();
        expect(counter.sample().samples).toBe(0);
    });
});
describe("Diagnostics", () => {
    it("creates counters lazily and lists them", () => {
        const diagnostics = new Diagnostics();
        diagnostics.set(COUNTERS.drawCalls, 12);
        diagnostics.set(COUNTERS.triangles, 900);
        expect(diagnostics.names).toEqual(["render.drawCalls", "render.triangles"]);
        expect(diagnostics.counter(COUNTERS.drawCalls)).toBe(diagnostics.counter(COUNTERS.drawCalls));
    });
    it("times a region with an injected clock", () => {
        let now = 0;
        const diagnostics = new Diagnostics({ now: () => now });
        diagnostics.begin("physics.step");
        now = 4.5;
        expect(diagnostics.end("physics.step")).toBe(4.5);
        expect(diagnostics.counter("physics.step").sample()).toMatchObject({ unit: "milliseconds", max: 4.5 });
    });
    it("reports unbalanced timing regions", () => {
        const diagnostics = new Diagnostics();
        diagnostics.begin("a");
        expect(() => diagnostics.begin("a")).toThrow(/begun twice without an end/);
        expect(() => diagnostics.end("never")).toThrow(/ended without being begun/);
    });
    it("ends a measured region even when the body throws", () => {
        let now = 0;
        const diagnostics = new Diagnostics({ now: () => now });
        expect(() => diagnostics.measure("boom", () => { now = 2; throw new Error("x"); })).toThrow("x");
        expect(diagnostics.counter("boom").sample().samples).toBe(1);
        // The region closed, so it can be measured again.
        expect(() => diagnostics.measure("boom", () => 1)).not.toThrow();
    });
    it("becomes a no-op when disabled, without removing call sites", () => {
        const diagnostics = new Diagnostics();
        diagnostics.enabled = false;
        diagnostics.set(COUNTERS.drawCalls, 5);
        diagnostics.begin("x");
        expect(diagnostics.end("x")).toBe(0);
        expect(diagnostics.names).toEqual([]);
    });
    it("commits accumulated counters once per frame", () => {
        const diagnostics = new Diagnostics();
        diagnostics.add(COUNTERS.drawCalls, 2);
        diagnostics.add(COUNTERS.drawCalls, 3);
        diagnostics.commitFrame();
        expect(diagnostics.counter(COUNTERS.drawCalls).sample()).toMatchObject({ samples: 1, max: 5 });
    });
    it("groups samples by subsystem prefix", () => {
        const diagnostics = new Diagnostics();
        diagnostics.set(COUNTERS.drawCalls, 1);
        diagnostics.set(COUNTERS.physicsBodies, 2);
        diagnostics.set("standalone", 3);
        const grouped = diagnostics.grouped();
        expect([...grouped.keys()].sort()).toEqual(["general", "physics", "render"]);
        expect(grouped.get("render")).toHaveLength(1);
    });
    it("produces a machine-readable report", () => {
        const diagnostics = new Diagnostics();
        diagnostics.set(COUNTERS.fps, 60);
        const report = JSON.parse(diagnostics.report());
        expect(report.counters).toContainEqual(expect.objectContaining({ name: "frame.fps", max: 60 }));
    });
    it("resets every counter", () => {
        const diagnostics = new Diagnostics();
        diagnostics.set(COUNTERS.fps, 60);
        diagnostics.reset();
        expect(diagnostics.counter(COUNTERS.fps).sample().samples).toBe(0);
    });
});
describe("Logger", () => {
    it("routes records to the sink with category and level", () => {
        const sink = new MemorySink();
        const logger = new Logger({ sink: sink.write, now: () => 1234 });
        logger.category(LOG_CATEGORIES.render).warn("shader recompiled", { id: "pbr" });
        expect(sink.records).toEqual([
            { category: "render", level: "warn", message: "shader recompiled", data: { id: "pbr" }, timestamp: 1234 },
        ]);
    });
    it("filters by the default level", () => {
        const sink = new MemorySink();
        const logger = new Logger({ sink: sink.write, defaultLevel: "warn" });
        const render = logger.category("render");
        render.debug("noisy");
        render.info("also noisy");
        render.error("real problem");
        expect(sink.records.map((record) => record.level)).toEqual(["error"]);
    });
    it("sets levels per category so one subsystem can be made verbose", () => {
        const sink = new MemorySink();
        const logger = new Logger({ sink: sink.write, defaultLevel: "warn" });
        logger.setLevel("navigation", "debug");
        logger.category("navigation").debug("path found");
        logger.category("render").debug("frame");
        expect(sink.records.map((record) => record.category)).toEqual(["navigation"]);
        expect(logger.levelOf("navigation")).toBe("debug");
        expect(logger.levelOf("render")).toBe("warn");
        expect(logger.configuredCategories).toEqual([{ category: "navigation", level: "debug" }]);
    });
    it("silences a category entirely", () => {
        const sink = new MemorySink();
        const logger = new Logger({ sink: sink.write, defaultLevel: "debug" });
        logger.setLevel("render", "silent");
        logger.category("render").error("ignored");
        expect(sink.records).toEqual([]);
        expect(logger.isEnabled("render", "error")).toBe(false);
    });
    it("validates categories and levels", () => {
        const logger = new Logger({ sink: () => { } });
        expect(() => logger.category(" ")).toThrow(/must not be empty/);
        expect(() => logger.setLevel("x", "loud")).toThrow(/Unknown log level "loud"/);
        expect(() => logger.setDefaultLevel("loud")).toThrow(/Unknown log level/);
    });
    it("swaps the sink at runtime", () => {
        const first = new MemorySink();
        const second = new MemorySink();
        const logger = new Logger({ sink: first.write });
        logger.category("x").info("a");
        logger.setSink(second.write);
        logger.category("x").info("b");
        expect(first.records).toHaveLength(1);
        expect(second.records).toHaveLength(1);
    });
    it("bounds the memory sink and filters its records", () => {
        const sink = new MemorySink(2);
        const logger = new Logger({ sink: sink.write, defaultLevel: "debug" });
        logger.category("a").info("1");
        logger.category("a").warn("2");
        logger.category("b").error("3");
        expect(sink.records.map((record) => record.message)).toEqual(["2", "3"]);
        expect(sink.filter({ category: "b" })).toHaveLength(1);
        expect(sink.filter({ level: "error" })).toHaveLength(1);
        sink.clear();
        expect(sink.records).toEqual([]);
        expect(() => new MemorySink(0)).toThrow(/at least 1/);
    });
    it("maps levels onto console methods", () => {
        const target = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
        const logger = new Logger({ sink: consoleSink(target), defaultLevel: "debug" });
        logger.category("render").debug("d");
        logger.category("render").error("e", { code: 1 });
        expect(target.debug).toHaveBeenCalledWith("[render]", "d");
        expect(target.error).toHaveBeenCalledWith("[render]", "e", { code: 1 });
    });
});
describe("DebugDraw", () => {
    it("queues lines with defaults", () => {
        const draw = new DebugDraw();
        draw.line([0, 0, 0], [1, 2, 3]);
        expect(draw.primitives()).toEqual([
            { kind: "line", category: "general", from: [0, 0, 0], to: [1, 2, 3], color: DEBUG_COLORS.white, duration: 0, depthTest: true },
        ]);
    });
    it("draws a box as twelve edges and a sphere as three rings", () => {
        const draw = new DebugDraw();
        draw.box([0, 0, 0], [1, 1, 1]);
        expect(draw.count).toBe(12);
        draw.reset();
        draw.sphere([0, 0, 0], 1, { segments: 8 });
        expect(draw.count).toBe(24);
        expect(() => draw.sphere([0, 0, 0], 0)).toThrow(/positive radius/);
        expect(() => draw.sphere([0, 0, 0], 1, { segments: 2 })).toThrow(/at least three segments/);
    });
    it("closes a polyline only when asked", () => {
        const draw = new DebugDraw();
        draw.polyline([[0, 0, 0], [1, 0, 0], [1, 1, 0]]);
        expect(draw.count).toBe(2);
        draw.reset();
        draw.polyline([[0, 0, 0], [1, 0, 0], [1, 1, 0]], { close: true });
        expect(draw.count).toBe(3);
    });
    it("draws an arrow with a head and axes in the conventional colours", () => {
        const draw = new DebugDraw();
        draw.arrow([0, 0, 0], [0, 0, 1]);
        expect(draw.count).toBe(3);
        draw.reset();
        // A zero-length direction has no meaningful head.
        draw.arrow([0, 0, 0], [0, 0, 0]);
        expect(draw.count).toBe(1);
        draw.reset();
        draw.axes([0, 0, 0]);
        const colors = draw.primitives().map((primitive) => primitive.color);
        expect(colors).toContainEqual(DEBUG_COLORS.red);
        expect(colors).toContainEqual(DEBUG_COLORS.green);
        expect(colors).toContainEqual(DEBUG_COLORS.blue);
    });
    it("skips disabled categories and can be switched off entirely", () => {
        const draw = new DebugDraw();
        draw.setCategoryEnabled(DEBUG_CATEGORIES.physics, false);
        draw.line([0, 0, 0], [1, 1, 1], { category: DEBUG_CATEGORIES.physics });
        draw.line([0, 0, 0], [1, 1, 1], { category: DEBUG_CATEGORIES.navigation });
        expect(draw.count).toBe(1);
        expect(draw.disabledCategories).toEqual(["physics"]);
        draw.enabled = false;
        draw.line([0, 0, 0], [1, 1, 1]);
        expect(draw.count).toBe(1);
    });
    it("clears each frame but keeps timed primitives until they expire", () => {
        const draw = new DebugDraw();
        draw.line([0, 0, 0], [1, 0, 0]);
        draw.line([0, 0, 0], [0, 1, 0], { duration: 0.5 });
        draw.clear(0.2);
        expect(draw.count).toBe(1);
        expect(draw.primitives()[0].duration).toBeCloseTo(0.3);
        draw.clear(0.4);
        expect(draw.count).toBe(0);
        expect(() => draw.clear(-1)).toThrow(/non-negative delta/);
    });
    it("reports dropped primitives instead of freezing on a runaway loop", () => {
        const draw = new DebugDraw({ maxPrimitives: 2 });
        for (let index = 0; index < 10; index += 1)
            draw.line([0, 0, 0], [1, 1, 1]);
        expect(draw.count).toBe(2);
        expect(draw.dropped).toBe(8);
        draw.clear();
        expect(draw.dropped).toBe(0);
        expect(() => new DebugDraw({ maxPrimitives: 0 })).toThrow(/positive whole primitive budget/);
    });
    it("queues world-space text", () => {
        const draw = new DebugDraw();
        draw.text([1, 2, 3], "spawn", { color: DEBUG_COLORS.yellow, category: DEBUG_CATEGORIES.ai });
        expect(draw.primitives()[0]).toMatchObject({ kind: "text", text: "spawn", position: [1, 2, 3], category: "ai" });
    });
});
//# sourceMappingURL=diagnostics.test.js.map