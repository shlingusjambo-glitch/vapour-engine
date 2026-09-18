import { describe, expect, it } from "vitest";
import { UiDocument, anchorRect, resolveBreakpoints } from "./ui.js";
/**
 * Mirage M85: anchors, flex, stacks, grids, and responsive breakpoints. Every
 * assertion is an exact rectangle, because a layout engine that is "roughly
 * right" is one nobody can build a HUD on.
 */
describe("flex layout", () => {
    it("distributes free space by flexGrow and respects a fixed sibling", () => {
        const ui = new UiDocument({ id: "root", role: "panel", style: { direction: "row", gap: 10 }, children: [
                { id: "a", role: "panel", style: { flexGrow: 1 } },
                { id: "b", role: "panel", style: { flexGrow: 3 } },
                { id: "c", role: "panel", style: { width: 20 } },
            ] });
        ui.layout(140, 50);
        // 140 - 20 fixed - 2 gaps of 10 = 100 free, split 1:3.
        expect(ui.rect("a")).toEqual({ x: 0, y: 0, width: 25, height: 50 });
        expect(ui.rect("b")).toEqual({ x: 35, y: 0, width: 75, height: 50 });
        expect(ui.rect("c")).toEqual({ x: 120, y: 0, width: 20, height: 50 });
    });
    it("shrinks overflowing items in proportion to flexShrink and never shrinks a zero", () => {
        const ui = new UiDocument({ id: "root", role: "panel", style: { direction: "row" }, children: [
                { id: "a", role: "panel", style: { flexBasis: 100, flexShrink: 1 } },
                { id: "b", role: "panel", style: { flexBasis: 100, flexShrink: 1 } },
                { id: "c", role: "panel", style: { flexBasis: 100, flexShrink: 0 } },
            ] });
        ui.layout(200, 10);
        // 300 wanted in 200: the 100 overflow is taken from a and b only.
        expect(ui.rect("a").width).toBe(50);
        expect(ui.rect("b").width).toBe(50);
        expect(ui.rect("c").width).toBe(100);
    });
    it("wraps onto a second line and stacks lines along the cross axis", () => {
        const ui = new UiDocument({ id: "root", role: "panel", style: { direction: "row", wrap: true, gap: 0 }, children: [
                { id: "a", role: "panel", style: { width: 60, height: 10 } },
                { id: "b", role: "panel", style: { width: 60, height: 10 } },
                { id: "c", role: "panel", style: { width: 60, height: 10 } },
            ] });
        ui.layout(130, 40);
        expect(ui.rect("a")).toMatchObject({ x: 0, y: 0 });
        expect(ui.rect("b")).toMatchObject({ x: 60, y: 0 });
        expect(ui.rect("c")).toMatchObject({ x: 0, y: 10 });
    });
    it("justifies with space-between and centres on the cross axis", () => {
        const ui = new UiDocument({ id: "root", role: "panel", style: { direction: "row", justify: "space-between", align: "center" }, children: [
                { id: "a", role: "panel", style: { width: 10, height: 10 } },
                { id: "b", role: "panel", style: { width: 10, height: 10 } },
                { id: "c", role: "panel", style: { width: 10, height: 30, alignSelf: "start" } },
            ] });
        ui.layout(100, 50);
        expect(ui.rect("a")).toEqual({ x: 0, y: 20, width: 10, height: 10 });
        expect(ui.rect("b")).toEqual({ x: 45, y: 20, width: 10, height: 10 });
        expect(ui.rect("c")).toEqual({ x: 90, y: 0, width: 10, height: 30 });
    });
    it("stacks a column with gap and fills the remaining height", () => {
        const ui = new UiDocument({ id: "root", role: "panel", style: { direction: "column", gap: 4 }, children: [
                { id: "top", role: "text", style: { height: 16 } },
                { id: "body", role: "panel", style: { height: "fill" } },
                { id: "bottom", role: "text", style: { height: 16 } },
            ] });
        ui.layout(80, 100);
        expect(ui.rect("body")).toEqual({ x: 0, y: 20, width: 80, height: 60 });
        expect(ui.rect("bottom").y).toBe(84);
    });
});
describe("grid layout", () => {
    it("sizes fixed, auto, and fractional tracks and auto-flows cells", () => {
        const ui = new UiDocument({ id: "root", role: "panel", style: { grid: { columns: [40, "auto", { fraction: 1 }, { fraction: 2 }], columnGap: 0, rowGap: 0 } }, children: [
                { id: "a", role: "panel", style: { height: 10 }, intrinsicSize: [0, 10] },
                { id: "b", role: "panel", style: { height: 10 }, intrinsicSize: [30, 10] },
                { id: "c", role: "panel", style: { height: 10 } },
                { id: "d", role: "panel", style: { height: 10 } },
            ] });
        ui.layout(190, 10);
        // 190 - 40 fixed - 30 auto = 120 free, split 1:2 = 40 + 80.
        expect(ui.rect("a")).toMatchObject({ x: 0, width: 40 });
        expect(ui.rect("b")).toMatchObject({ x: 40, width: 30 });
        expect(ui.rect("c")).toMatchObject({ x: 70, width: 40 });
        expect(ui.rect("d")).toMatchObject({ x: 110, width: 80 });
    });
    it("lets a cell span columns and rows, and flows the rest around it", () => {
        const ui = new UiDocument({ id: "root", role: "panel", style: { grid: { columns: [50, 50, 50], rows: [20, 20], columnGap: 0, rowGap: 0 } }, children: [
                { id: "wide", role: "panel", style: { gridArea: { column: 0, row: 0, columnSpan: 2 } } },
                { id: "tall", role: "panel", style: { gridArea: { column: 2, row: 0, rowSpan: 2 } } },
                { id: "flow", role: "panel" },
            ] });
        ui.layout(150, 40);
        expect(ui.rect("wide")).toEqual({ x: 0, y: 0, width: 100, height: 20 });
        expect(ui.rect("tall")).toEqual({ x: 100, y: 0, width: 50, height: 40 });
        // The only free cell left is row 1, column 0.
        expect(ui.rect("flow")).toEqual({ x: 0, y: 20, width: 50, height: 20 });
    });
    it("applies column and row gaps between tracks", () => {
        const ui = new UiDocument({ id: "root", role: "panel", style: { grid: { columns: [10, 10], rows: [10, 10], columnGap: 5, rowGap: 7 } }, children: [
                { id: "a", role: "panel" }, { id: "b", role: "panel" }, { id: "c", role: "panel" }, { id: "d", role: "panel" },
            ] });
        ui.layout(100, 100);
        expect(ui.rect("b").x).toBe(15);
        expect(ui.rect("c").y).toBe(17);
    });
});
describe("anchors", () => {
    it("pins a child to a corner with size from offsets, independent of resolution", () => {
        const child = { id: "hud", role: "text", style: { anchor: { min: [1, 0], max: [1, 0], offsets: [-116, 16, -16, 40] } } };
        for (const [w, h] of [[800, 600], [1920, 1080]]) {
            const ui = new UiDocument({ id: "root", role: "panel", children: [child] });
            ui.layout(w, h);
            expect(ui.rect("hud")).toEqual({ x: w - 116, y: 16, width: 100, height: 24 });
        }
    });
    it("stretches a child across the parent with insets", () => {
        const rect = anchorRect({ min: [0, 0], max: [1, 1], offsets: [8, 8, -8, -8] }, { x: 0, y: 0, width: 200, height: 100 });
        expect(rect).toEqual({ x: 8, y: 8, width: 184, height: 84 });
    });
    it("removes anchored children from the flex flow", () => {
        const ui = new UiDocument({ id: "root", role: "panel", style: { direction: "row" }, children: [
                { id: "pinned", role: "text", style: { anchor: { min: [0, 0], max: [0, 0], offsets: [0, 0, 10, 10] } } },
                { id: "flow", role: "panel", style: { width: "fill" } },
            ] });
        ui.layout(100, 20);
        expect(ui.rect("flow").width).toBe(100);
    });
});
describe("breakpoints", () => {
    it("merges the widest matching breakpoint on top of narrower ones", () => {
        const style = resolveBreakpoints({ direction: "column", gap: 2, breakpoints: [{ minWidth: 600, style: { direction: "row" } }, { minWidth: 900, style: { gap: 20 } }] }, 1000);
        expect(style.direction).toBe("row");
        expect(style.gap).toBe(20);
        expect(resolveBreakpoints({ direction: "column", breakpoints: [{ minWidth: 600, style: { direction: "row" } }] }, 400).direction).toBe("column");
    });
    it("re-flows the tree when the viewport crosses a breakpoint", () => {
        const definition = { id: "root", role: "panel", style: { direction: "column", breakpoints: [{ minWidth: 500, style: { direction: "row" } }] }, children: [
                { id: "a", role: "panel", style: { width: 40, height: 10 } },
                { id: "b", role: "panel", style: { width: 40, height: 10 } },
            ] };
        const narrow = new UiDocument(definition);
        narrow.layout(300, 100);
        const wide = new UiDocument(definition);
        wide.layout(800, 100);
        expect(narrow.rect("b")).toMatchObject({ x: 0, y: 10 });
        expect(wide.rect("b")).toMatchObject({ x: 40, y: 0 });
    });
});
//# sourceMappingURL=layout.test.js.map