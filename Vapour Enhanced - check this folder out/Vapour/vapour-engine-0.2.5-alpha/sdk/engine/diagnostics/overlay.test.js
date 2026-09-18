import { describe, expect, it } from "vitest";
import { COUNTERS, Diagnostics } from "./counters.js";
import { DiagnosticsOverlay, buildOverlayModel, formatBytes, formatCounterValue, formatOverlayText } from "./overlay.js";
function element() {
    const attributes = {};
    const properties = {};
    return {
        textContent: null,
        attributes,
        properties,
        style: { setProperty: (name, value) => { properties[name] = value; } },
        setAttribute: (name, value) => { attributes[name] = value; },
    };
}
function populated() {
    const diagnostics = new Diagnostics();
    for (let index = 0; index < 20; index += 1)
        diagnostics.set(COUNTERS.frameTime, 16, { unit: "milliseconds" });
    // Three spikes in twenty-three samples, so the 95th percentile lands on a
    // spike rather than being averaged away — which is the point of tracking it.
    for (let index = 0; index < 3; index += 1)
        diagnostics.set(COUNTERS.frameTime, 48, { unit: "milliseconds" });
    diagnostics.set(COUNTERS.drawCalls, 120);
    diagnostics.set(COUNTERS.resourceBytes, 5 * 1024 * 1024, { unit: "bytes" });
    return diagnostics;
}
describe("formatting", () => {
    it("scales byte units", () => {
        expect(formatBytes(512)).toBe("512B");
        expect(formatBytes(2048)).toBe("2.0KB");
        expect(formatBytes(5 * 1024 * 1024)).toBe("5.0MB");
        expect(formatBytes(-1024)).toBe("-1.0KB");
    });
    it("formats each unit the way a developer reads it", () => {
        const sample = (unit) => ({ name: "x", unit, value: 0, mean: 0, min: 0, max: 0, p95: 0, samples: 1 });
        expect(formatCounterValue(sample("milliseconds"), 16.666)).toBe("16.67ms");
        // Sub-millisecond timings are more readable in microseconds.
        expect(formatCounterValue(sample("milliseconds"), 0.25)).toBe("250µs");
        expect(formatCounterValue(sample("count"), 12345)).toBe("12,345");
        expect(formatCounterValue(sample("ratio"), 0.873)).toBe("87.3%");
        expect(formatCounterValue(sample("bytes"), 1024)).toBe("1.0KB");
    });
});
describe("buildOverlayModel", () => {
    it("groups counters into sections with formatted rows", () => {
        const model = buildOverlayModel(populated(), { now: () => 5 });
        expect(model.capturedAt).toBe(5);
        expect(model.sections.map((section) => section.title)).toEqual(["frame", "render", "resources"]);
        const frame = model.sections[0].rows[0];
        expect(frame.label).toBe("time");
        expect(frame.detail).toMatch(/^p95 .*· max 48\.00ms$/);
    });
    it("flags a counter whose p95 exceeds its budget", () => {
        const model = buildOverlayModel(populated(), { budgets: { [COUNTERS.frameTime]: 20, [COUNTERS.drawCalls]: 1000 } });
        const rows = model.sections.flatMap((section) => section.rows);
        expect(rows.find((row) => row.label === "time")?.overBudget).toBe(true);
        expect(rows.find((row) => row.label === "drawCalls")?.overBudget).toBe(false);
    });
    it("restricts and orders sections when asked", () => {
        const model = buildOverlayModel(populated(), { sections: ["render", "frame", "missing"] });
        expect(model.sections.map((section) => section.title)).toEqual(["render", "frame"]);
    });
    it("says so when a counter has no samples yet", () => {
        const diagnostics = new Diagnostics();
        diagnostics.counter(COUNTERS.fps);
        expect(buildOverlayModel(diagnostics).sections[0].rows[0].detail).toBe("no samples");
    });
    it("renders as aligned text with a marker on over-budget rows", () => {
        const text = formatOverlayText(buildOverlayModel(populated(), { budgets: { [COUNTERS.frameTime]: 20 } }));
        expect(text).toContain("frame");
        expect(text).toMatch(/! time/);
        expect(text).toMatch(/ {4}drawCalls/);
    });
});
describe("DiagnosticsOverlay", () => {
    it("paints into an attached element", () => {
        const overlay = new DiagnosticsOverlay(populated());
        const host = element();
        overlay.attach(host);
        expect(host.attributes["data-vapour-overlay"]).toBe("true");
        expect(host.properties["white-space"]).toBe("pre");
        expect(host.textContent).toContain("frame");
    });
    it("refreshes only when the interval elapses", () => {
        const diagnostics = new Diagnostics();
        diagnostics.set(COUNTERS.drawCalls, 1);
        const overlay = new DiagnosticsOverlay(diagnostics, { refreshSeconds: 0.5 });
        const host = element();
        overlay.attach(host);
        diagnostics.set(COUNTERS.drawCalls, 999);
        overlay.advance(0.2);
        expect(host.textContent).not.toContain("999");
        overlay.advance(0.4);
        expect(host.textContent).toContain("500"); // mean of 1 and 999
    });
    it("refreshes on demand", () => {
        const diagnostics = new Diagnostics();
        const overlay = new DiagnosticsOverlay(diagnostics);
        const host = element();
        overlay.attach(host);
        diagnostics.set(COUNTERS.fps, 60);
        overlay.refresh();
        expect(host.textContent).toContain("fps");
    });
    it("hides and shows without detaching", () => {
        const overlay = new DiagnosticsOverlay(populated());
        const host = element();
        overlay.attach(host);
        overlay.visible = false;
        expect(host.properties["display"]).toBe("none");
        host.textContent = "stale";
        overlay.refresh();
        expect(host.textContent).toBe("stale");
        overlay.visible = true;
        overlay.refresh();
        expect(host.textContent).toContain("frame");
    });
    it("stops painting once detached", () => {
        const overlay = new DiagnosticsOverlay(populated());
        const host = element();
        overlay.attach(host);
        overlay.detach();
        host.textContent = "unchanged";
        overlay.refresh();
        expect(host.textContent).toBe("unchanged");
        // The model still updates, so a caller can read it without an element.
        expect(overlay.model.sections.length).toBeGreaterThan(0);
    });
    it("validates its options and deltas", () => {
        expect(() => new DiagnosticsOverlay(new Diagnostics(), { refreshSeconds: 0 })).toThrow(/positive refresh interval/);
        expect(() => new DiagnosticsOverlay(new Diagnostics()).advance(-1)).toThrow(/non-negative delta/);
    });
});
//# sourceMappingURL=overlay.test.js.map