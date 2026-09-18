import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorCamera } from "./editor-camera.js";
import { FrameBuilder, composeTranslation } from "../core/frame-builder.js";
import { validateMaterialUpload, WebGpuRenderHost } from "./host/index.js";
import { packDecals } from "./decals.js";
import { GpuParticleSystem } from "../particles/gpu-particles.js";
import { defaultTransform } from "../core/scene-document.js";
const originalNavigator = globalThis.navigator;
const originalResizeObserver = globalThis.ResizeObserver;
const originalDevicePixelRatio = globalThis.devicePixelRatio;
afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator,
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: originalResizeObserver,
    });
    Object.defineProperty(globalThis, "devicePixelRatio", {
        configurable: true,
        value: originalDevicePixelRatio,
    });
});
function browserGlobals() {
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { gpu: {} },
    });
    Object.defineProperty(globalThis, "devicePixelRatio", {
        configurable: true,
        value: 1,
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: class {
            observe() { }
            disconnect() { }
        },
    });
}
describe("WebGpuRenderHost", () => {
    it("queues one authored render-world snapshot before GPU initialization", async () => {
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: { gpu: {} },
        });
        Object.defineProperty(globalThis, "devicePixelRatio", {
            configurable: true,
            value: 1,
        });
        Object.defineProperty(globalThis, "ResizeObserver", {
            configurable: true,
            value: class {
                observe() { }
                disconnect() { }
            },
        });
        let submitted = "";
        const renderer = {
            resize: vi.fn(),
            set_render_world_json: vi.fn((json) => {
                submitted = json;
            }),
            render: vi.fn(() => "{}"),
            capabilities_json: vi.fn(() => JSON.stringify({ adapterName: "Test", tier: "baseline" })),
            upload_mesh: vi.fn(),
            upload_skinned_mesh: vi.fn(),
            release_mesh: vi.fn(() => true),
            mesh_ids_json: vi.fn(() => "[]"),
            upload_texture_rgba8: vi.fn(),
            release_texture: vi.fn(() => true),
            define_material_json: vi.fn(),
            release_material: vi.fn(() => true),
            set_render_frame: vi.fn(),
            set_render_layers: vi.fn(),
            free: vi.fn(),
        };
        const canvas = {
            width: 0,
            height: 0,
            clientWidth: 320,
            clientHeight: 180,
        };
        const host = new WebGpuRenderHost(canvas, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        host.setScene(sceneWithCube());
        await host.initialize();
        expect(JSON.parse(submitted)).toMatchObject({
            version: 1,
            instances: [{ entityId: "cube", mesh: "builtin:cube" }],
        });
        expect(renderer.set_render_world_json).toHaveBeenCalledTimes(1);
        host.destroy();
        expect(renderer.free).toHaveBeenCalledTimes(1);
    });
    it("substitutes the editor camera without disturbing the authored scene", () => {
        const host = new WebGpuRenderHost({
            width: 0,
            height: 0,
            clientWidth: 320,
            clientHeight: 180,
        });
        const scene = sceneWithCube();
        scene.entities.push({
            id: "camera",
            name: "Main Camera",
            enabled: true,
            components: [
                { typeName: "vapour.Transform", version: 1, data: defaultTransform() },
                {
                    typeName: "vapour.Camera",
                    version: 1,
                    data: { fieldOfView: 45, near: 0.3, far: 500 },
                },
            ],
        });
        host.setScene(scene);
        expect(host.snapshot()?.camera?.entityId).toBe("camera");
        const editorCamera = new EditorCamera({ distance: 12 });
        host.setViewer(editorCamera.snapshot());
        expect(host.snapshot()?.camera?.entityId).toBe("editor:scene-camera");
        // The authored camera and the drawn instances are untouched by navigation.
        expect(scene.entities.find((entity) => entity.id === "camera")?.components[1]
            ?.data).toEqual({ fieldOfView: 45, near: 0.3, far: 500 });
        expect(host.snapshot()?.instances).toHaveLength(1);
        host.setViewer(undefined);
        expect(host.snapshot()?.camera?.entityId).toBe("camera");
        host.destroy();
    });
    it("has no snapshot before a scene is submitted", () => {
        const host = new WebGpuRenderHost({
            width: 0,
            height: 0,
            clientWidth: 8,
            clientHeight: 8,
        });
        expect(host.snapshot()).toBeUndefined();
        host.setViewer(new EditorCamera().snapshot());
        expect(host.snapshot()).toBeUndefined();
        host.destroy();
    });
    it("retains validated HDR settings before GPU initialization", () => {
        const host = new WebGpuRenderHost({
            width: 0,
            height: 0,
            clientWidth: 8,
            clientHeight: 8,
        });
        host.setPostProcess({ exposure: 2, toneMapping: "reinhard" });
        expect(host.postProcess()).toEqual({
            exposure: 2,
            toneMapping: "reinhard",
        });
        expect(() => host.setPostProcess({ exposure: Infinity, toneMapping: "aces" })).toThrow(/HDR exposure/);
        expect(() => host.setPostProcess({
            exposure: 1,
            toneMapping: "aces",
            bloom: { intensity: 11 },
        })).toThrow(/Bloom intensity/);
        expect(() => host.setPostProcess({ exposure: 1, toneMapping: "aces", saturation: -1 })).toThrow(/Saturation/);
        host.destroy();
    });
    it("reports adapter/device startup that never settles instead of hanging", async () => {
        browserGlobals();
        const host = new WebGpuRenderHost({
            width: 0,
            height: 0,
            clientWidth: 8,
            clientHeight: 8,
        }, {
            initializationTimeoutMs: 5,
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: () => new Promise(() => undefined) },
            }),
        });
        await expect(host.initialize()).rejects.toThrow(/did not finish within 5 ms/);
        host.destroy();
    });
});
function sceneWithCube() {
    return {
        formatVersion: 1,
        id: "scene",
        name: "Scene",
        entities: [
            {
                id: "cube",
                name: "Cube",
                enabled: true,
                components: [
                    {
                        typeName: "vapour.Transform",
                        version: 1,
                        data: defaultTransform(),
                    },
                    {
                        typeName: "vapour.MeshRenderer",
                        version: 1,
                        data: { mesh: "builtin:cube" },
                    },
                ],
            },
        ],
    };
}
describe("runtime meshes", () => {
    function fakeRenderer() {
        return {
            resize: vi.fn(),
            set_render_world_json: vi.fn(),
            render: vi.fn(() => "{}"),
            capabilities_json: vi.fn(() => JSON.stringify({ adapterName: "Test", tier: "baseline" })),
            upload_mesh: vi.fn(),
            upload_skinned_mesh: vi.fn(),
            release_mesh: vi.fn(() => true),
            mesh_ids_json: vi.fn(() => "[]"),
            upload_texture_rgba8: vi.fn(),
            release_texture: vi.fn(() => true),
            define_material_json: vi.fn(),
            release_material: vi.fn(() => true),
            set_render_frame: vi.fn(),
            set_render_layers: vi.fn(),
            free: vi.fn(),
        };
    }
    const triangle = {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
    };
    it("replays meshes uploaded before the GPU existed, ahead of the scene", async () => {
        browserGlobals();
        const renderer = fakeRenderer();
        const order = [];
        renderer.upload_mesh.mockImplementation(() => order.push("mesh"));
        renderer.set_render_world_json.mockImplementation(() => order.push("scene"));
        const host = new WebGpuRenderHost({
            width: 0,
            height: 0,
            clientWidth: 8,
            clientHeight: 8,
        }, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        host.uploadMesh("chunk:0", triangle);
        host.setScene(sceneWithCube());
        await host.initialize();
        // A scene submitted before its geometry would be rejected by the renderer.
        expect(order).toEqual(["mesh", "scene"]);
        expect(host.meshIds()).toEqual(["chunk:0"]);
        host.destroy();
    });
    it("passes optional attributes through as empty arrays", async () => {
        browserGlobals();
        const renderer = fakeRenderer();
        const host = new WebGpuRenderHost({
            width: 0,
            height: 0,
            clientWidth: 8,
            clientHeight: 8,
        }, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        await host.initialize();
        host.uploadMesh("chunk:0", triangle);
        const call = renderer.upload_mesh.mock.calls[0];
        expect(call[0]).toBe("chunk:0");
        expect(call[2]).toHaveLength(0);
        expect(call[3]).toHaveLength(0);
        expect(call[4]).toHaveLength(0);
        expect(call[5]).toHaveLength(0);
        expect(call[6]).toHaveLength(0);
        expect(call[7]).toBe(triangle.indices);
        host.destroy();
    });
    it("passes authored tangent frames through the typed WASM boundary", async () => {
        browserGlobals();
        const renderer = fakeRenderer();
        const host = new WebGpuRenderHost({
            width: 0,
            height: 0,
            clientWidth: 8,
            clientHeight: 8,
        }, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        await host.initialize();
        const tangents = new Float32Array([1, 0, 0, -1, 1, 0, 0, -1, 1, 0, 0, -1]);
        host.uploadMesh("chunk:tangent", { ...triangle, tangents });
        expect(renderer.upload_mesh.mock.calls[0][5]).toBe(tangents);
        host.destroy();
    });
    it("rejects geometry that is not a whole number of vertices or triangles", () => {
        const host = new WebGpuRenderHost({
            width: 0,
            height: 0,
            clientWidth: 8,
            clientHeight: 8,
        });
        expect(() => host.uploadMesh("", triangle)).toThrow(/non-empty identifier/);
        expect(() => host.uploadMesh("bad", {
            positions: new Float32Array([0, 0]),
            indices: new Uint32Array([0, 1, 2]),
        })).toThrow(/whole number of vertices/);
        expect(() => host.uploadMesh("bad", {
            positions: triangle.positions,
            indices: new Uint32Array([0, 1]),
        })).toThrow(/whole number of triangles/);
        expect(() => host.uploadMesh("bad", {
            ...triangle,
            textureLayers: new Float32Array([0, 1]),
        })).toThrow(/textureLayers length/);
        expect(() => host.uploadMesh("bad", {
            ...triangle,
            tangents: new Float32Array([1, 0, 0, 1]),
        })).toThrow(/tangents length/);
        host.destroy();
    });
    it("forgets released meshes so they are not replayed", async () => {
        browserGlobals();
        const renderer = fakeRenderer();
        const host = new WebGpuRenderHost({
            width: 0,
            height: 0,
            clientWidth: 8,
            clientHeight: 8,
        }, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        host.uploadMesh("chunk:0", triangle);
        host.uploadMesh("chunk:1", triangle);
        expect(host.releaseMesh("chunk:0")).toBe(true);
        expect(host.releaseMesh("chunk:0")).toBe(false);
        await host.initialize();
        expect(renderer.upload_mesh).toHaveBeenCalledTimes(1);
        expect(host.meshIds()).toEqual(["chunk:1"]);
        host.destroy();
    });
    it("queues uploads without a GPU rather than throwing", () => {
        // Streaming code should not have to know whether the device is ready yet.
        const host = new WebGpuRenderHost({
            width: 0,
            height: 0,
            clientWidth: 8,
            clientHeight: 8,
        });
        expect(() => host.uploadMesh("chunk:0", triangle)).not.toThrow();
        expect(host.meshIds()).toEqual(["chunk:0"]);
        host.destroy();
    });
    it("replays textures before dependent materials and submits material tables", async () => {
        browserGlobals();
        const renderer = fakeRenderer();
        const order = [];
        renderer.upload_texture_rgba8.mockImplementation(() => order.push("texture"));
        renderer.define_material_json.mockImplementation(() => order.push("material"));
        renderer.upload_mesh.mockImplementation(() => order.push("mesh"));
        const host = new WebGpuRenderHost({
            width: 0,
            height: 0,
            clientWidth: 8,
            clientHeight: 8,
        }, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        host.uploadTexture("atlas:blocks", {
            width: 1,
            height: 1,
            pixels: new Uint8Array([255, 255, 255, 255]),
        });
        host.defineMaterial("material:blocks", {
            textures: { baseColor: "atlas:blocks" },
            filter: "nearest",
            atlas: { columns: 16, rows: 96, inset: 0.006, origin: "top-left" },
        });
        host.uploadMesh("chunk:0", triangle);
        await host.initialize();
        expect(order).toEqual(["texture", "material", "mesh"]);
        expect(JSON.parse(renderer.define_material_json.mock.calls[0][1])
            .atlas).toEqual({ columns: 16, rows: 96, inset: 0.006, origin: "top-left" });
        const frame = new FrameBuilder();
        frame.draw("chunk:0", composeTranslation(new Float32Array(16), 0, 0, 0), {
            material: "material:blocks",
        });
        host.submitFrame(frame.pack());
        const call = renderer.set_render_frame.mock.calls[0];
        expect(JSON.parse(call[2])).toEqual([
            "builtin:default",
            "material:blocks",
        ]);
        expect(call[3]).toEqual(new Uint32Array([1]));
        host.destroy();
    });
    it("accepts SDF coverage materials and rejects unknown coverage modes", () => {
        expect(() => validateMaterialUpload("material:font", { coverageMode: "sdf", alphaMode: "blend", depthWrite: false }, () => true)).not.toThrow();
        expect(() => validateMaterialUpload("material:bad", { coverageMode: "msdf" }, () => true)).toThrow(/coverageMode.*alpha or sdf/);
    });
    it("passes several camera layers through one typed-array WASM call", async () => {
        browserGlobals();
        const renderer = fakeRenderer();
        const host = new WebGpuRenderHost({
            width: 0,
            height: 0,
            clientWidth: 8,
            clientHeight: 8,
        }, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        await host.initialize();
        const world = new FrameBuilder(1);
        const overlay = new FrameBuilder(1);
        world.draw("builtin:cube", composeTranslation(new Float32Array(16), 0, 0, 0));
        overlay.draw("builtin:cube", composeTranslation(new Float32Array(16), 0, 0, -1));
        host.submitLayers([
            { frame: world.pack() },
            { frame: overlay.pack(), clearColor: false, clearDepth: true },
        ]);
        expect(renderer.set_render_layers).toHaveBeenCalledTimes(1);
        const call = renderer.set_render_layers.mock.calls[0];
        expect(call[7]).toEqual(new Uint32Array([1, 1]));
        expect(call[8]).toEqual(new Uint32Array([3, 2]));
        expect(call[4].length).toBe(32);
        host.destroy();
    });
    it("uploads and replays an environment map, and derives one from the sky", async () => {
        browserGlobals();
        const renderer = {
            ...fakeRenderer(),
            upload_environment_cubemap: vi.fn(),
            set_environment_from_sky: vi.fn(),
            clear_environment: vi.fn(),
        };
        const host = new WebGpuRenderHost({ width: 0, height: 0, clientWidth: 8, clientHeight: 8 }, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        const faces = new Uint8Array(2 * 2 * 4 * 6).fill(128);
        // Before the GPU exists the upload is remembered and replayed.
        host.uploadEnvironment({ faceSize: 2, faces, intensity: 1.5 });
        expect(renderer.upload_environment_cubemap).not.toHaveBeenCalled();
        await host.initialize();
        expect(renderer.upload_environment_cubemap).toHaveBeenCalledWith(2, faces, true, 1.5);
        expect(() => host.uploadEnvironment({ faceSize: 2, faces: faces.subarray(1) })).toThrow(/needs 96 RGBA8 bytes, received 95/);
        expect(() => host.uploadEnvironment({ faceSize: 2, faces, intensity: 65 })).toThrow(/intensity/);
        host.deriveEnvironmentFromSky(0.8);
        expect(renderer.set_environment_from_sky).toHaveBeenCalledWith(0.8);
        host.clearEnvironment();
        expect(renderer.clear_environment).toHaveBeenCalledTimes(1);
        host.destroy();
    });
    it("names a stale WASM build when it lacks environment support", async () => {
        browserGlobals();
        const renderer = fakeRenderer();
        const host = new WebGpuRenderHost({ width: 0, height: 0, clientWidth: 8, clientHeight: 8 }, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        await host.initialize();
        expect(() => host.uploadEnvironment({ faceSize: 1, faces: new Uint8Array(24) })).toThrow(/pnpm build:wasm/);
        host.destroy();
    });
    it("submits and replays decals against an uploaded atlas", async () => {
        browserGlobals();
        const renderer = { ...fakeRenderer(), set_decals: vi.fn() };
        const host = new WebGpuRenderHost({ width: 0, height: 0, clientWidth: 8, clientHeight: 8 }, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        const packed = packDecals([{ matrix: identity }]);
        expect(() => host.submitDecals(packed, "missing")).toThrow(/has not been uploaded/);
        host.uploadTexture("decals:atlas", { width: 1, height: 1, pixels: new Uint8Array(4) });
        host.submitDecals(packed, "decals:atlas");
        await host.initialize();
        // Textures replay before decals, so the atlas exists when the set lands.
        const order = renderer.upload_texture_rgba8.mock.invocationCallOrder[0];
        expect(renderer.set_decals.mock.invocationCallOrder[0]).toBeGreaterThan(order);
        expect(renderer.set_decals).toHaveBeenCalledWith("decals:atlas", packed);
        host.submitDecals(new Float32Array(0));
        expect(renderer.set_decals).toHaveBeenLastCalledWith("", new Float32Array(0));
        expect(() => host.submitDecals(new Float32Array(27))).toThrow(/28 values/);
        host.destroy();
    });
    it("replays render targets before the materials that sample them and passes layer targets", async () => {
        browserGlobals();
        const renderer = {
            ...fakeRenderer(),
            create_render_target: vi.fn(),
            release_render_target: vi.fn(() => true),
        };
        const host = new WebGpuRenderHost({ width: 0, height: 0, clientWidth: 8, clientHeight: 8 }, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        host.createRenderTarget("rt:monitor", { scale: 0.5 });
        host.createRenderTarget("rt:map", { width: 256, height: 256 });
        host.defineMaterial("screen", { textures: { baseColor: "rt:monitor" } });
        await host.initialize();
        expect(renderer.create_render_target).toHaveBeenCalledWith("rt:monitor", 0, 0, 0.5);
        expect(renderer.create_render_target).toHaveBeenCalledWith("rt:map", 256, 256, 0);
        expect(renderer.create_render_target.mock.invocationCallOrder[0]).toBeLessThan(renderer.define_material_json.mock.invocationCallOrder[0]);
        const world = new FrameBuilder(1);
        world.draw("builtin:cube", composeTranslation(new Float32Array(16), 0, 0, 0));
        host.submitLayers([
            { frame: world.pack(), target: "rt:monitor" },
            { frame: world.pack(), viewport: { x: 0, y: 0, width: 0.5, height: 1 } },
        ]);
        const call = renderer.set_render_layers.mock.calls[0];
        expect(call[15]).toBe(JSON.stringify(["rt:monitor", ""]));
        expect([...call[16]]).toEqual([0, 0, 1, 1, 0, 0, 0.5, 1]);
        expect(host.releaseRenderTarget("rt:map")).toBe(true);
        expect(renderer.release_render_target).toHaveBeenCalledWith("rt:map");
        host.destroy();
    });
    it("surfaces which culling path ran and replays the preference", async () => {
        browserGlobals();
        const renderer = {
            ...fakeRenderer(),
            set_gpu_culling: vi.fn(),
            render: vi
                .fn()
                .mockReturnValueOnce(JSON.stringify({ drawCalls: 3, triangles: 36, cpuEncodeMs: 0.2, gpuCulling: true, culledInstances: null }))
                .mockReturnValueOnce(JSON.stringify({ drawCalls: 1, triangles: 12, cpuEncodeMs: 0.3, gpuCulling: false, culledInstances: 7 })),
        };
        const host = new WebGpuRenderHost({ width: 0, height: 0, clientWidth: 8, clientHeight: 8 }, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        host.setGpuCulling(false);
        await host.initialize();
        expect(renderer.set_gpu_culling).toHaveBeenCalledWith(false);
        host.setGpuCulling(true);
        expect(renderer.set_gpu_culling).toHaveBeenLastCalledWith(true);
        expect(host.renderFrame(16)).toMatchObject({ culling: "gpu", drawCalls: 3 });
        expect(host.renderFrame(32)).toMatchObject({ culling: "cpu", culledInstances: 7 });
        host.destroy();
    });
    it("drives GPU particle systems through the WASM particle API", async () => {
        browserGlobals();
        const renderer = {
            ...fakeRenderer(),
            set_gpu_particles: vi.fn(),
            create_particle_system: vi.fn(),
            update_particle_system: vi.fn(),
            clear_particle_system: vi.fn(),
            release_particle_system: vi.fn(() => true),
            particle_system_stats_json: vi.fn(() => JSON.stringify({ gpu: true, requested: 12, alive: null, emitted: null, expired: null, dropped: null })),
        };
        const host = new WebGpuRenderHost({ width: 0, height: 0, clientWidth: 8, clientHeight: 8 }, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        // Systems live in the renderer, so before initialization there is none.
        expect(host.supportsGpuParticles()).toBe(false);
        expect(new GpuParticleSystem(host, { rate: 0 }).mode).toBe("cpu");
        await host.initialize();
        expect(renderer.set_gpu_particles).toHaveBeenCalledWith(true);
        expect(host.supportsGpuParticles()).toBe(true);
        const system = new GpuParticleSystem(host, { capacity: 64, rate: 0, burst: 12, seed: 9 }, "fx");
        expect(system.mode).toBe("gpu");
        const [id, json] = renderer.create_particle_system.mock.calls[0];
        expect(id).toBe("fx");
        expect(JSON.parse(json)).toMatchObject({ capacity: 64, seed: 9, shape: "point", sizeLut: expect.any(Array) });
        system.setOrigin([1, 2, 3]);
        system.play();
        system.update(0.5);
        expect(renderer.update_particle_system).toHaveBeenCalledWith("fx", 0.5, 12, 1, 2, 3);
        expect(system.stats()).toMatchObject({ mode: "gpu", requested: 12, alive: 12, emitted: undefined });
        system.clear();
        expect(renderer.clear_particle_system).toHaveBeenCalledWith("fx");
        system.release();
        expect(renderer.release_particle_system).toHaveBeenCalledWith("fx");
        host.destroy();
    });
    it("pins the drawing buffer to a fixed size for XR eye layouts", async () => {
        browserGlobals();
        const renderer = fakeRenderer();
        const canvas = { width: 0, height: 0, clientWidth: 8, clientHeight: 8 };
        const host = new WebGpuRenderHost(canvas, {
            loadModule: async () => ({
                default: async () => undefined,
                WebGpuRenderer: { create: async () => renderer },
            }),
        });
        await host.initialize();
        host.setFixedSize(3664, 1920);
        expect([canvas.width, canvas.height]).toEqual([3664, 1920]);
        expect(renderer.resize).toHaveBeenLastCalledWith(3664, 1920);
        expect(() => host.setFixedSize(0, 10)).toThrow(/positive whole pixel/);
        host.setFixedSize(undefined);
        expect([canvas.width, canvas.height]).toEqual([8, 8]);
        host.destroy();
    });
});
//# sourceMappingURL=render-host.test.js.map