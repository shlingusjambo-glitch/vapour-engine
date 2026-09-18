import { describe, expect, it } from "vitest";
import { quatFromEuler, rotateVector } from "@vapour/math";
import { UiDocument } from "./ui.js";
import { WorldUiCanvas, screenPointToWorldRay } from "./world-ui.js";
import { invert, multiplyMat4, perspective, lookAt } from "@vapour/math";
/** Mirage M89: world-space and XR UI over the same document as screen UI. */
function panel() {
    const ui = new UiDocument({ id: "root", role: "panel", style: { direction: "column", padding: 10, gap: 10 }, children: [
            { id: "ok", role: "button", style: { height: 30 } },
            { id: "cancel", role: "button", style: { height: 30 } },
        ] });
    ui.layout(200, 100);
    return ui;
}
describe("WorldUiCanvas", () => {
    it("maps canvas pixels to metres through pixelsPerUnit, centred on the quad", () => {
        const canvas = new WorldUiCanvas(panel(), { position: [0, 1.5, -2], pixelsPerUnit: 100 });
        expect(canvas.worldSize).toEqual([2, 1]);
        // Top-left pixel is the top-left corner: -1 m in x, +0.5 m in y from the centre.
        expect(canvas.toWorld(0, 0)).toEqual([-1, 2, -2]);
        expect(canvas.toWorld(200, 100)).toEqual([1, 1, -2]);
    });
    it("hit-tests a world ray to a canvas pixel and the node under it", () => {
        const canvas = new WorldUiCanvas(panel(), { position: [0, 0, -2], pixelsPerUnit: 100 });
        // The "ok" button spans y 10..40 in a 100px canvas; its centre is y=25 → +0.25 m.
        const hit = canvas.hitTest({ origin: [0, 0.25, 0], direction: [0, 0, -1] });
        expect(hit).toBeDefined();
        expect(hit?.x).toBeCloseTo(100);
        expect(hit?.y).toBeCloseTo(25);
        expect(hit?.distance).toBeCloseTo(2);
        expect(hit?.nodeId).toBe("ok");
    });
    it("ignores rays that miss the quad or approach from behind", () => {
        const canvas = new WorldUiCanvas(panel(), { position: [0, 0, -2], pixelsPerUnit: 100 });
        expect(canvas.hitTest({ origin: [5, 0, 0], direction: [0, 0, -1] })).toBeUndefined();
        expect(canvas.hitTest({ origin: [0, 0, -4], direction: [0, 0, 1] })).toBeUndefined();
        expect(canvas.hitTest({ origin: [0, 0, 0], direction: [0, 0, 1] })).toBeUndefined();
    });
    it("drives document presses through a ray exactly like a pointer", () => {
        const ui = panel();
        const canvas = new WorldUiCanvas(ui, { position: [0, 0, -2] });
        const ray = { origin: [0, -0.25, 0], direction: [0, 0, -1] };
        expect(canvas.pointerDown(ray)).toBe("cancel");
        canvas.pointerUp(ray);
        expect(ui.drainActions()).toEqual([{ type: "focus", id: "cancel" }, { type: "click", id: "cancel" }]);
    });
    it("respects the canvas rotation when hit-testing", () => {
        // Rotated +90° about Y: the panel's -Z face now points along -X, so a
        // canvas at x=-2 is hit head-on by a ray travelling -X from the origin.
        const canvas = new WorldUiCanvas(panel(), { position: [-2, 0, 0], rotation: quatFromEuler([0, 90, 0]) });
        const hit = canvas.hitTest({ origin: [0, 0, 0], direction: [-1, 0, 0] });
        expect(hit).toBeDefined();
        expect(hit?.x).toBeCloseTo(100);
        expect(hit?.y).toBeCloseTo(50);
    });
    it("billboards toward a viewer, and 'upright' keeps the canvas vertical", () => {
        const full = new WorldUiCanvas(panel(), { position: [0, 0, 0], billboard: "full" });
        full.face([0, 3, 4]);
        const facing = rotateVector(full.rotation, [0, 0, 1]);
        // The quad's front (+Z) now points at the viewer.
        expect(facing[0]).toBeCloseTo(0);
        expect(facing[1]).toBeCloseTo(0.6);
        expect(facing[2]).toBeCloseTo(0.8);
        const upright = new WorldUiCanvas(panel(), { position: [0, 0, 0], billboard: "upright" });
        upright.face([0, 3, 4]);
        const up = rotateVector(upright.rotation, [0, 1, 0]);
        expect(up[1]).toBeCloseTo(1);
        expect(rotateVector(upright.rotation, [0, 0, 1])[2]).toBeCloseTo(1);
        // And a ray from the viewer actually hits the faced panel.
        upright.face([0, 0, 4]);
        expect(upright.hitTest({ origin: [0, 0, 4], direction: [0, 0, -1] })).toBeDefined();
    });
    it("emits world quads for every node with the document's ids", () => {
        const canvas = new WorldUiCanvas(panel(), { position: [0, 0, -2], pixelsPerUnit: 100 });
        const quads = canvas.quads();
        expect(quads.map((quad) => quad.id)).toEqual(["root", "ok", "cancel"]);
        const ok = quads[1];
        expect(ok.corners[0][0]).toBeCloseTo(-0.9);
        expect(ok.corners[0][1]).toBeCloseTo(0.4);
        expect(ok.corners[0][2]).toBeCloseTo(-2);
        expect(ok.corners[2][0]).toBeCloseTo(0.9);
        expect(ok.corners[2][1]).toBeCloseTo(0.1);
        expect(ok.corners[2][2]).toBeCloseTo(-2);
    });
    it("builds a world ray through a screen pixel from an inverse view-projection", () => {
        const view = lookAt([0, 0, 5], [0, 0, 0]);
        const projection = perspective(60, 1, 0.1, 100);
        const inverse = invert(multiplyMat4(projection, view));
        const ray = screenPointToWorldRay(inverse, 50, 50, 100, 100);
        expect(ray.direction[2]).toBeCloseTo(-1);
        expect(Math.abs(ray.direction[0])).toBeLessThan(1e-6);
        const canvas = new WorldUiCanvas(panel(), { position: [0, 0, 0] });
        // The centre pixel (100, 50) is the top edge of "cancel" (y 50..80).
        expect(canvas.hitTest(ray)?.nodeId).toBe("cancel");
    });
});
//# sourceMappingURL=world-ui.test.js.map