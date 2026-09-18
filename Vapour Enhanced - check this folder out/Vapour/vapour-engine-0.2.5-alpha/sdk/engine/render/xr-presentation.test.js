import { describe, expect, it, vi } from "vitest";
import { FrameBuilder, composeTranslation } from "../core/frame-builder.js";
import { XrRig, syntheticXrFrame } from "../xr/xr-rig.js";
import { HeadlessRenderHost } from "./headless-render-host.js";
import { RENDER_LAYER_HAS_PROJECTION, packRenderLayers, projectionExtent } from "./render-layers.js";
import { XrPresentation, canvasSubImageCopier, probeXrPresentation, } from "./xr-presentation.js";
const EYE = { width: 1832, height: 1920 };
/** A fake `XRGPUBinding`: side-by-side `texture` layers, or one texture
 * with two array slices when it supports `texture-array`. */
function fakeBinding(supportsTextureArray) {
    const layers = [];
    return {
        layers,
        getPreferredColorFormat: vi.fn(() => "bgra8unorm"),
        createProjectionLayer: vi.fn((init) => {
            if (init.textureType === "texture-array" && !supportsTextureArray)
                throw new TypeError("texture-array is not supported");
            const layer = { textureType: init.textureType ?? "texture" };
            layers.push(layer);
            return layer;
        }),
        getViewSubImage: vi.fn((layer, view) => {
            const index = view.eye === "right" ? 1 : 0;
            return layer.textureType === "texture-array"
                ? { colorTexture: { width: EYE.width, height: EYE.height }, viewport: { x: 0, y: 0, ...EYE }, imageIndex: index }
                : { colorTexture: { width: EYE.width * 2, height: EYE.height }, viewport: { x: index * EYE.width, y: 0, ...EYE } };
        }),
    };
}
function scene() {
    const world = new FrameBuilder(1);
    world.draw("builtin:cube", composeTranslation(new Float32Array(16), 0, 1, -2));
    return world.pack();
}
async function headless() {
    const host = new HeadlessRenderHost();
    await host.initialize();
    const submitLayers = vi.spyOn(host, "submitLayers");
    const renderFrame = vi.spyOn(host, "renderFrame");
    return { host, submitLayers, renderFrame };
}
function rigFrame() {
    const rig = new XrRig({ referenceSpace: "local-floor" });
    rig.setPose([10, 0, 5]);
    return rig.resolve(syntheticXrFrame({ headPosition: [0, 1.6, 0], ipd: 0.064 }));
}
describe("probeXrPresentation", () => {
    it("reports multiview when the binding takes a texture-array layer", () => {
        expect(probeXrPresentation(fakeBinding(true))).toEqual({ multiview: true, colorFormat: "bgra8unorm" });
        expect(probeXrPresentation(fakeBinding(false))).toEqual({ multiview: false, colorFormat: "bgra8unorm" });
    });
});
describe("two-pass presentation", () => {
    it("submits each eye separately with its own view, projection, and viewport", async () => {
        const { host, submitLayers, renderFrame } = await headless();
        const binding = fakeBinding(false);
        const session = { updateRenderState: vi.fn() };
        const copies = [];
        const presentation = new XrPresentation({ host, binding, session, copy: (copy) => copies.push(copy) });
        expect(presentation.mode).toBe("two-pass");
        expect(session.updateRenderState).toHaveBeenCalledWith({ layers: [binding.layers[binding.layers.length - 1]] });
        const rig = rigFrame();
        const frame = syntheticXrFrame({ headPosition: [0, 1.6, 0] });
        const result = presentation.present(frame.views, rig, scene(), 16);
        expect(result.mode).toBe("two-pass");
        expect(result.submissions).toBe(2);
        expect(submitLayers).toHaveBeenCalledTimes(2);
        expect(renderFrame).toHaveBeenCalledTimes(2);
        expect(result.canvasSize).toEqual({ width: EYE.width * 2, height: EYE.height });
        const [left] = submitLayers.mock.calls[0][0];
        const [right] = submitLayers.mock.calls[1][0];
        expect(left).toBeDefined();
        expect(right).toBeDefined();
        // Each eye's camera is that eye's world transform: 64 mm apart in x, rig-offset.
        const leftPosition = [left.frame.camera[12], left.frame.camera[13], left.frame.camera[14]];
        const rightPosition = [right.frame.camera[12], right.frame.camera[13], right.frame.camera[14]];
        expect(leftPosition[0]).toBeCloseTo(10 - 0.032, 6);
        expect(rightPosition[0]).toBeCloseTo(10 + 0.032, 6);
        expect(leftPosition[1]).toBeCloseTo(1.6, 6);
        expect(leftPosition[2]).toBeCloseTo(5, 6);
        expect(left.frame.camera).not.toEqual(right.frame.camera);
        // Viewports: left half and right half of the side-by-side canvas.
        expect(left.viewport).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
        expect(right.viewport).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
        expect(left.clearColor).toBe(true);
        expect(left.clearDepth).toBe(true);
        // The projection travels explicitly, rewritten to WebGPU depth, and the
        // camera record carries the extent it encodes.
        const packed = packRenderLayers([left]);
        expect(packed.layerFlags[0] & RENDER_LAYER_HAS_PROJECTION).toBe(RENDER_LAYER_HAS_PROJECTION);
        const extent = projectionExtent(packed.projections, "zero-to-one");
        expect(extent.fieldOfViewDegrees).toBeCloseTo(90, 4);
        expect(extent.near).toBeCloseTo(0.1, 4);
        expect(left.frame.camera[17]).toBeCloseTo(90, 4);
        expect(left.frame.camera[18]).toBeCloseTo(0.1, 6);
        expect(left.frame.camera[19]).toBeCloseTo(1000, 0);
        // Copies land in each eye's viewport of the shared texture.
        expect(copies).toHaveLength(2);
        expect(copies[0]).toMatchObject({ sourceRect: { x: 0, y: 0, ...EYE }, destinationRect: { x: 0, y: 0, ...EYE }, imageIndex: 0 });
        expect(copies[1]).toMatchObject({ sourceRect: { x: EYE.width, y: 0, ...EYE }, destinationRect: { x: EYE.width, y: 0, ...EYE }, imageIndex: 0 });
        expect(result.eyes.map((eye) => eye.eye)).toEqual(["left", "right"]);
    });
});
describe("multiview presentation", () => {
    it("submits both eyes as two layers of one frame and copies into array slices", async () => {
        const { host, submitLayers, renderFrame } = await headless();
        const binding = fakeBinding(true);
        const setFixedSize = vi.fn();
        const copies = [];
        const presentation = new XrPresentation({
            host: { submitLayers: host.submitLayers.bind(host), renderFrame: host.renderFrame.bind(host), setFixedSize },
            binding,
            session: { updateRenderState: vi.fn() },
            copy: (copy) => copies.push(copy),
        });
        expect(presentation.mode).toBe("multiview");
        expect(binding.layers.at(-1)).toEqual({ textureType: "texture-array" });
        const result = presentation.present(syntheticXrFrame({ headPosition: [0, 1.6, 0] }).views, rigFrame(), scene(), 33);
        expect(result.submissions).toBe(1);
        expect(submitLayers).toHaveBeenCalledTimes(1);
        expect(renderFrame).toHaveBeenCalledTimes(1);
        const layers = submitLayers.mock.calls[0][0];
        expect(layers).toHaveLength(2);
        expect(layers[0].viewport).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
        expect(layers[1].viewport).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
        expect(layers[0].frame.camera[12]).toBeCloseTo(10 - 0.032, 6);
        expect(layers[1].frame.camera[12]).toBeCloseTo(10 + 0.032, 6);
        // The canvas was pinned to the eye layout once, before the first frame.
        expect(setFixedSize).toHaveBeenCalledTimes(1);
        expect(setFixedSize).toHaveBeenCalledWith(EYE.width * 2, EYE.height);
        // Each eye copies from its canvas half into slice 0 / slice 1 at the origin.
        expect(copies[0]).toMatchObject({ sourceRect: { x: 0, y: 0, ...EYE }, destinationRect: { x: 0, y: 0, ...EYE }, imageIndex: 0 });
        expect(copies[1]).toMatchObject({ sourceRect: { x: EYE.width, y: 0, ...EYE }, destinationRect: { x: 0, y: 0, ...EYE }, imageIndex: 1 });
        // A second frame at the same size does not re-pin the canvas.
        presentation.present(syntheticXrFrame({ headPosition: [0, 1.6, 0] }).views, rigFrame(), scene(), 50);
        expect(setFixedSize).toHaveBeenCalledTimes(1);
    });
    it("can be forced to two-pass and rejects a frame missing an eye", async () => {
        const { host } = await headless();
        const presentation = new XrPresentation({ host, binding: fakeBinding(true), session: { updateRenderState: vi.fn() }, copy: vi.fn(), multiview: false });
        expect(presentation.mode).toBe("two-pass");
        const frame = syntheticXrFrame({ headPosition: [0, 1.6, 0] });
        expect(() => presentation.present([frame.views[0]], rigFrame(), scene(), 0)).toThrow(/no 'right' view/);
    });
});
describe("canvasSubImageCopier", () => {
    it("copies the canvas rectangle into the sub-image at its viewport and slice", () => {
        const copyExternalImageToTexture = vi.fn();
        const canvas = {};
        const copy = canvasSubImageCopier({ queue: { copyExternalImageToTexture } }, canvas);
        const subImage = { colorTexture: { width: 8, height: 4 } };
        copy({ subImage, sourceRect: { x: 4, y: 0, width: 4, height: 4 }, destinationRect: { x: 0, y: 0, width: 4, height: 4 }, imageIndex: 1 });
        expect(copyExternalImageToTexture).toHaveBeenCalledWith({ source: canvas, origin: { x: 4, y: 0 } }, { texture: subImage.colorTexture, origin: { x: 0, y: 0, z: 1 } }, { width: 4, height: 4 });
    });
});
//# sourceMappingURL=xr-presentation.test.js.map