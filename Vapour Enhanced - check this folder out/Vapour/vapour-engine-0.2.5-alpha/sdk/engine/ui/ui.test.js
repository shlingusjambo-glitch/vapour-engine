import { describe, expect, it } from "vitest";
import { UiDocument } from "./ui.js";
function menu() {
    return new UiDocument({ id: "root", role: "panel", style: { direction: "column", padding: 10, gap: 5 }, children: [
            { id: "title", role: "text", style: { height: 20 } },
            { id: "choices", role: "panel", style: { height: "fill", direction: "row", gap: 10 }, children: [
                    { id: "yes", role: "button", style: { width: "fill" } },
                    { id: "no", role: "button", style: { width: "fill" } },
                ] },
            { id: "volume", role: "slider", style: { height: 20 }, minimum: 0, maximum: 1, step: 0.1, value: 0.5 },
        ] });
}
describe("UiDocument", () => {
    it("lays out nested row/column containers deterministically", () => {
        const ui = menu();
        ui.layout(210, 120);
        expect(ui.rect("title")).toEqual({ x: 10, y: 10, width: 190, height: 20 });
        expect(ui.rect("yes")).toEqual({ x: 10, y: 35, width: 90, height: 50 });
        expect(ui.rect("no")).toEqual({ x: 110, y: 35, width: 90, height: 50 });
        expect(ui.rect("volume")).toEqual({ x: 10, y: 90, width: 190, height: 20 });
    });
    it("shares layout rectangles with pointer hit testing and activation", () => {
        const ui = menu();
        ui.layout(210, 120);
        expect(ui.pointerDown(20, 50)).toBe("yes");
        ui.pointerUp(20, 50);
        expect(ui.drainActions()).toEqual([{ type: "focus", id: "yes" }, { type: "click", id: "yes" }]);
    });
    it("supports keyboard/gamepad focus, toggles, and quantized sliders", () => {
        const ui = new UiDocument({ id: "root", role: "panel", children: [
                { id: "toggle", role: "toggle", value: false, style: { height: 20 } },
                { id: "slider", role: "slider", value: 0, minimum: 0, maximum: 10, step: 2, style: { height: 20 } },
            ] });
        ui.layout(100, 40);
        expect(ui.focusNext()).toBe("toggle");
        ui.activateFocused();
        expect(ui.value("toggle")).toBe(true);
        expect(ui.focusNext()).toBe("slider");
        ui.pointerDown(74, 30);
        ui.pointerUp(74, 30);
        expect(ui.value("slider")).toBe(8);
        expect(ui.drainActions().filter((action) => action.type === "change").map((action) => action.value)).toEqual([true, 8]);
    });
    it("rejects duplicate IDs and refuses hidden controls", () => {
        expect(() => new UiDocument({ id: "root", role: "panel", children: [{ id: "x", role: "button" }, { id: "x", role: "button" }] })).toThrow(/duplicated/);
        const ui = new UiDocument({ id: "root", role: "panel", children: [{ id: "hidden", role: "button", style: { visible: false } }] });
        ui.layout(10, 10);
        expect(ui.hitTest(1, 1)).toBeUndefined();
        expect(() => ui.focus("hidden")).toThrow(/cannot receive focus/);
    });
    it("measures content-sized containers from nested children, gaps, and padding", () => {
        const ui = new UiDocument({ id: "root", role: "panel", children: [
                { id: "column", role: "panel", style: { width: "content", height: "content", padding: [2, 3, 4, 5], gap: 7 }, children: [
                        { id: "first", role: "text", intrinsicSize: [40, 10] },
                        { id: "row", role: "panel", style: { width: "content", height: "content", direction: "row", gap: 2 }, children: [
                                { id: "a", role: "image", intrinsicSize: [12, 8] },
                                { id: "b", role: "image", intrinsicSize: [18, 14] },
                            ] },
                    ] },
            ] });
        ui.layout(200, 100);
        expect(ui.rect("column")).toEqual({ x: 0, y: 0, width: 48, height: 37 });
        expect(ui.rect("row")).toEqual({ x: 5, y: 19, width: 32, height: 14 });
        expect(ui.rect("b")).toEqual({ x: 19, y: 19, width: 18, height: 14 });
    });
});
//# sourceMappingURL=ui.test.js.map