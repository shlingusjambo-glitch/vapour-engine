import { describe, expect, it } from "vitest";
import { UiDocument } from "./ui.js";
/**
 * Mirage M86: the full widget set — panels, images, buttons, sliders,
 * checkboxes (toggles), dropdowns, and progress bars — all driven through the
 * same pointer, keyboard/controller, and value APIs, with disabled state.
 */
function settings() {
    return new UiDocument({ id: "root", role: "panel", style: { direction: "column", gap: 0 }, children: [
            { id: "logo", role: "image", style: { height: 20 }, intrinsicSize: [64, 20] },
            { id: "quality", role: "dropdown", style: { height: 20 }, options: ["low", "medium", "high"], value: "medium" },
            { id: "vsync", role: "toggle", style: { height: 20 }, value: true },
            { id: "loading", role: "progress", style: { height: 10 }, minimum: 0, maximum: 200, value: 50 },
            { id: "apply", role: "button", style: { height: 20 } },
            { id: "locked", role: "button", style: { height: 20, enabled: false } },
        ] });
}
describe("dropdown", () => {
    it("opens on activation, moves the highlight with adjust, and commits on activate", () => {
        const ui = settings();
        ui.layout(200, 120);
        expect(ui.selectedIndex("quality")).toBe(1);
        ui.activate("quality");
        expect(ui.isOpen("quality")).toBe(true);
        ui.adjust("quality", 1);
        expect(ui.highlightedIndex("quality")).toBe(2);
        ui.activate("quality");
        expect(ui.isOpen("quality")).toBe(false);
        expect(ui.value("quality")).toBe("high");
        expect(ui.drainActions().map((action) => action.type)).toEqual(["open", "close", "change"]);
    });
    it("changes the selection directly while closed, wrapping at the ends", () => {
        const ui = settings();
        ui.layout(200, 120);
        ui.adjust("quality", -2);
        expect(ui.value("quality")).toBe("high");
        ui.adjust("quality", 1);
        expect(ui.value("quality")).toBe("low");
    });
    it("cancel restores the pre-open selection and picks options by pointer", () => {
        const ui = settings();
        ui.layout(200, 120);
        ui.activate("quality");
        ui.adjust("quality", 1);
        ui.cancel("quality");
        expect(ui.value("quality")).toBe("medium");
        ui.activate("quality");
        const rects = ui.optionRects("quality", 16);
        expect(rects).toHaveLength(3);
        expect(rects[0]).toEqual({ x: 0, y: 40, width: 200, height: 16 });
        expect(ui.optionAt("quality", 5, 40 + 2 * 16 + 1, 16)).toBe(2);
        ui.select("quality", 0);
        expect(ui.value("quality")).toBe("low");
        expect(ui.isOpen("quality")).toBe(false);
    });
    it("rejects setValue to an option that does not exist", () => {
        const ui = settings();
        expect(() => ui.setValue("quality", "ultra")).toThrow(/no option/);
    });
});
describe("progress, image, panel", () => {
    it("reports a clamped fill fraction for progress bars and sliders", () => {
        const ui = settings();
        ui.layout(200, 120);
        expect(ui.fraction("loading")).toBeCloseTo(0.25);
        ui.setValue("loading", 999);
        expect(ui.fraction("loading")).toBe(1);
        expect(() => ui.fraction("apply")).toThrow(/no fill fraction/);
    });
    it("lays out images from their intrinsic size and panels as plain containers", () => {
        const ui = settings();
        ui.layout(200, 120);
        expect(ui.rect("logo")).toEqual({ x: 0, y: 0, width: 200, height: 20 });
        expect(ui.nodes().find((node) => node.id === "logo")?.role).toBe("image");
    });
    it("does not activate or hit-test a disabled control", () => {
        const ui = settings();
        ui.layout(200, 120);
        expect(() => ui.activate("locked")).toThrow(/cannot be activated/);
        expect(ui.nodes().find((node) => node.id === "locked")?.enabled).toBe(false);
        ui.pointerDown(10, 105);
        ui.pointerUp(10, 105);
        expect(ui.drainActions().some((action) => action.id === "locked")).toBe(false);
    });
    it("toggles a checkbox and clicks a button through focus navigation", () => {
        const ui = settings();
        ui.layout(200, 120);
        ui.focus("vsync");
        ui.activateFocused();
        expect(ui.value("vsync")).toBe(false);
        ui.focus("apply");
        ui.activateFocused();
        expect(ui.drainActions().filter((action) => action.type === "click").map((action) => action.id)).toEqual(["apply"]);
    });
});
//# sourceMappingURL=widgets-m86.test.js.map