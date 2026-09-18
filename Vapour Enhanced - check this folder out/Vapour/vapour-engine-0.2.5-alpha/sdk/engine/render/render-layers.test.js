import { describe, expect, it } from "vitest";
import { FrameBuilder, composeTranslation } from "../core/frame-builder.js";
import { RENDER_LAYER_CLEAR_COLOR, RENDER_LAYER_CLEAR_DEPTH, RENDER_LAYER_HAS_CAMERA, RENDER_LAYER_HAS_ENVIRONMENT, detectRenderTargetCycle, packRenderLayers, RENDER_LAYER_HAS_PROJECTION, projectionExtent, projectionToWebGpuDepth, } from "./render-layers.js";
function frame(mesh, material, x, cameraFov) {
    const builder = new FrameBuilder(1);
    builder.draw(mesh, composeTranslation(new Float32Array(16), x, 0, 0), {
        material,
    });
    if (cameraFov !== undefined) {
        builder.setCamera(composeTranslation(new Float32Array(16), x, 2, 5), cameraFov, 0.1, 500);
    }
    const packed = builder.pack();
    return {
        ...packed,
        meshTable: [...packed.meshTable],
        meshIndices: packed.meshIndices.slice(),
        materialTable: [...packed.materialTable],
        materialIndices: packed.materialIndices.slice(),
        matrices: packed.matrices.slice(),
        baseColors: packed.baseColors.slice(),
        materialParams: packed.materialParams.slice(),
        camera: packed.camera.slice(),
        light: packed.light.slice(),
    };
}
describe("packRenderLayers", () => {
    it("deduplicates tables and remaps each layer into one atomic submission", () => {
        const packed = packRenderLayers([
            { frame: frame("mesh:world", "material:stone", 1, 70) },
            {
                frame: frame("mesh:hands", "material:stone", 2, 55),
                clearColor: false,
                clearDepth: true,
            },
        ]);
        expect(packed.meshTable).toEqual(["mesh:world", "mesh:hands"]);
        expect(packed.meshIndices).toEqual(new Uint32Array([0, 1]));
        expect(packed.materialTable).toEqual(["builtin:default", "material:stone"]);
        expect(packed.materialIndices).toEqual(new Uint32Array([1, 1]));
        expect(packed.layerInstanceCounts).toEqual(new Uint32Array([1, 1]));
        expect(packed.layerFlags[0]).toBe(RENDER_LAYER_CLEAR_COLOR |
            RENDER_LAYER_CLEAR_DEPTH |
            RENDER_LAYER_HAS_CAMERA);
        expect(packed.layerFlags[1]).toBe(RENDER_LAYER_CLEAR_DEPTH | RENDER_LAYER_HAS_CAMERA);
        expect(packed.cameras[17]).toBe(70);
        expect(packed.cameras[20 + 17]).toBe(55);
        expect(packed.matrices[12]).toBe(1);
        expect(packed.matrices[16 + 12]).toBe(2);
    });
    it("fills optional instance arrays with the renderer defaults", () => {
        const source = frame("mesh:a", "builtin:default", 0);
        const packed = packRenderLayers([
            {
                frame: {
                    ...source,
                    baseColors: new Float32Array(),
                    materialParams: new Float32Array(),
                },
            },
        ]);
        expect(packed.baseColors).toEqual(new Float32Array([1, 1, 1, 1]));
        expect(packed.materialParams).toEqual(new Float32Array([0, 0.6, 0, 0.01]));
    });
    it("keeps an independent environment for every layer", () => {
        const world = new FrameBuilder(1);
        const overlay = new FrameBuilder(1);
        world.setEnvironment({
            clearColor: [0.1, 0.2, 0.3, 1],
            fog: { mode: "linear", color: [0.2, 0.3, 0.4], near: 20, far: 180 },
        });
        const packed = packRenderLayers([
            { frame: world.pack() },
            { frame: overlay.pack() },
        ]);
        expect(packed.layerFlags[0] & RENDER_LAYER_HAS_ENVIRONMENT).toBe(RENDER_LAYER_HAS_ENVIRONMENT);
        expect(packed.layerFlags[1] & RENDER_LAYER_HAS_ENVIRONMENT).toBe(0);
        expect(packed.environments).toHaveLength(48);
        expect(packed.environments.slice(0, 4)).toEqual(new Float32Array([0.1, 0.2, 0.3, 1]));
        expect(packed.environments[7]).toBe(1);
        expect(packed.environments.slice(24)).toEqual(new Float32Array(24));
    });
    it("rejects an empty submission and a first layer that cannot initialize the target", () => {
        expect(() => packRenderLayers([])).toThrow(/at least one layer/);
        const source = frame("mesh:a", "builtin:default", 0);
        expect(() => packRenderLayers([{ frame: source, clearColor: false }])).toThrow(/clear both colour and depth/);
    });
});
describe("render targets and viewports", () => {
    it("packs per-layer targets and viewports only when a layer asks for them", () => {
        const world = new FrameBuilder(1);
        world.draw("builtin:cube", composeTranslation(new Float32Array(16), 0, 0, 0));
        const plain = packRenderLayers([{ frame: world.pack() }]);
        expect(plain.layerTargets).toEqual([]);
        expect(plain.viewports.length).toBe(0);
        const packed = packRenderLayers([
            { frame: world.pack(), target: "rt:monitor" },
            {
                frame: world.pack(),
                clearColor: false,
                clearDepth: true,
                viewport: { x: 0.5, y: 0, width: 0.5, height: 1 },
            },
        ]);
        expect(packed.layerTargets).toEqual(["rt:monitor", ""]);
        expect([...packed.viewports]).toEqual([0, 0, 1, 1, 0.5, 0, 0.5, 1]);
        expect(packed.projections.length).toBe(0);
        expect(() => packRenderLayers([
            { frame: world.pack(), viewport: { x: 0.75, y: 0, width: 0.5, height: 1 } },
        ])).toThrow(/viewport must be a non-empty rectangle/);
        expect(() => packRenderLayers([{ frame: world.pack(), target: " " }])).toThrow(/empty render target/);
    });
    it("rejects a camera that samples the target it writes, with the chain named", () => {
        expect(() => detectRenderTargetCycle([{ target: "monitor", samples: ["monitor"] }])).toThrow("Render target 'monitor' is sampled by a layer that renders into it (monitor -> monitor); a camera cannot read the texture it writes.");
        expect(() => detectRenderTargetCycle([
            { target: "a", samples: ["b"] },
            { target: "b", samples: ["c"] },
            { target: "c", samples: ["a"] },
        ])).toThrow(/a -> b -> c -> a/);
        expect(() => detectRenderTargetCycle([
            { target: "a", samples: ["b"] },
            { target: "b", samples: [] },
            { samples: ["a", "b"] },
        ])).not.toThrow();
    });
});
describe("explicit projections", () => {
    it("packs a per-layer projection matrix and flags the layer", () => {
        const world = new FrameBuilder(1);
        world.draw("builtin:cube", composeTranslation(new Float32Array(16), 0, 0, 0));
        const eye = Float32Array.from({ length: 16 }, (_, index) => index + 1);
        const packed = packRenderLayers([
            { frame: world.pack(), projection: eye },
            { frame: world.pack(), clearColor: false },
        ]);
        expect(packed.layerFlags[0] & RENDER_LAYER_HAS_PROJECTION).toBe(RENDER_LAYER_HAS_PROJECTION);
        expect(packed.layerFlags[1] & RENDER_LAYER_HAS_PROJECTION).toBe(0);
        expect([...packed.projections.subarray(0, 16)]).toEqual([...eye]);
        expect([...packed.projections.subarray(16)]).toEqual(new Array(16).fill(0));
        expect(() => packRenderLayers([{ frame: world.pack(), projection: eye.subarray(0, 15) }])).toThrow(/16 finite values/);
    });
    it("recovers field of view, near, and far in either depth convention", () => {
        // OpenGL / WebXR: 90° vertical, near 0.1, far 100.
        const near = 0.1;
        const far = 100;
        const gl = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, (near + far) / (near - far), -1, 0, 0, (2 * near * far) / (near - far), 0];
        const extentGl = projectionExtent(gl, "negative-one-to-one");
        expect(extentGl.fieldOfViewDegrees).toBeCloseTo(90, 6);
        expect(extentGl.near).toBeCloseTo(near, 6);
        expect(extentGl.far).toBeCloseTo(far, 4);
        // Rewritten for WebGPU, the same extent reads back in the other convention.
        const webgpu = projectionToWebGpuDepth(gl);
        expect(webgpu[10]).toBeCloseTo(far / (near - far), 6);
        expect(webgpu[14]).toBeCloseTo((near * far) / (near - far), 6);
        const extentWebGpu = projectionExtent(webgpu, "zero-to-one");
        expect(extentWebGpu.near).toBeCloseTo(near, 6);
        expect(extentWebGpu.far).toBeCloseTo(far, 2);
        // Depth of a point on the far plane: GL 1 → WebGPU 1; near plane: -1 → 0.
        const clipZ = (m, z) => m[10] * z + m[14];
        const clipW = (z) => -z;
        expect(clipZ(gl, -far) / clipW(-far)).toBeCloseTo(1, 5);
        expect(clipZ(webgpu, -far) / clipW(-far)).toBeCloseTo(1, 5);
        expect(clipZ(gl, -near) / clipW(-near)).toBeCloseTo(-1, 5);
        expect(clipZ(webgpu, -near) / clipW(-near)).toBeCloseTo(0, 5);
        // Infinite far planes are reported as such, not as garbage.
        const infinite = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -2 * near, 0];
        expect(projectionExtent(infinite, "negative-one-to-one").far).toBe(Number.POSITIVE_INFINITY);
    });
});
//# sourceMappingURL=render-layers.test.js.map