import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorCamera } from "./editor-camera.js";
import { FrameBuilder, composeTranslation } from "../core/frame-builder.js";
import { validateMaterialUpload, WebGpuRenderHost } from "./host/index.js";
import { defaultTransform, type SceneData } from "../core/scene-document.js";

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

function browserGlobals(): void {
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
      observe(): void {}
      disconnect(): void {}
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
        observe(): void {}
        disconnect(): void {}
      },
    });
    let submitted = "";
    const renderer = {
      resize: vi.fn(),
      set_render_world_json: vi.fn((json: string) => {
        submitted = json;
      }),
      render: vi.fn(() => "{}"),
      capabilities_json: vi.fn(() =>
        JSON.stringify({ adapterName: "Test", tier: "baseline" }),
      ),
      upload_mesh: vi.fn(),
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
    } as HTMLCanvasElement;
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
    } as HTMLCanvasElement);
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
    expect(
      scene.entities.find((entity) => entity.id === "camera")?.components[1]
        ?.data,
    ).toEqual({ fieldOfView: 45, near: 0.3, far: 500 });
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
    } as HTMLCanvasElement);
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
    } as HTMLCanvasElement);
    host.setPostProcess({ exposure: 2, toneMapping: "reinhard" });
    expect(host.postProcess()).toEqual({
      exposure: 2,
      toneMapping: "reinhard",
    });
    expect(() =>
      host.setPostProcess({ exposure: Infinity, toneMapping: "aces" }),
    ).toThrow(/HDR exposure/);
    expect(() =>
      host.setPostProcess({
        exposure: 1,
        toneMapping: "aces",
        bloom: { intensity: 11 },
      }),
    ).toThrow(/Bloom intensity/);
    expect(() =>
      host.setPostProcess({ exposure: 1, toneMapping: "aces", saturation: -1 }),
    ).toThrow(/Saturation/);
    host.destroy();
  });

  it("reports adapter/device startup that never settles instead of hanging", async () => {
    browserGlobals();
    const host = new WebGpuRenderHost(
      {
        width: 0,
        height: 0,
        clientWidth: 8,
        clientHeight: 8,
      } as HTMLCanvasElement,
      {
        initializationTimeoutMs: 5,
        loadModule: async () => ({
          default: async () => undefined,
          WebGpuRenderer: { create: () => new Promise(() => undefined) },
        }),
      },
    );
    await expect(host.initialize()).rejects.toThrow(
      /did not finish within 5 ms/,
    );
    host.destroy();
  });
});

function sceneWithCube(): SceneData {
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
      capabilities_json: vi.fn(() =>
        JSON.stringify({ adapterName: "Test", tier: "baseline" }),
      ),
      upload_mesh: vi.fn(),
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
    const order: string[] = [];
    renderer.upload_mesh.mockImplementation(() => order.push("mesh"));
    renderer.set_render_world_json.mockImplementation(() =>
      order.push("scene"),
    );

    const host = new WebGpuRenderHost(
      {
        width: 0,
        height: 0,
        clientWidth: 8,
        clientHeight: 8,
      } as HTMLCanvasElement,
      {
        loadModule: async () => ({
          default: async () => undefined,
          WebGpuRenderer: { create: async () => renderer },
        }),
      },
    );
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
    const host = new WebGpuRenderHost(
      {
        width: 0,
        height: 0,
        clientWidth: 8,
        clientHeight: 8,
      } as HTMLCanvasElement,
      {
        loadModule: async () => ({
          default: async () => undefined,
          WebGpuRenderer: { create: async () => renderer },
        }),
      },
    );
    await host.initialize();
    host.uploadMesh("chunk:0", triangle);
    const call = renderer.upload_mesh.mock.calls[0]!;
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
    const host = new WebGpuRenderHost(
      {
        width: 0,
        height: 0,
        clientWidth: 8,
        clientHeight: 8,
      } as HTMLCanvasElement,
      {
        loadModule: async () => ({
          default: async () => undefined,
          WebGpuRenderer: { create: async () => renderer },
        }),
      },
    );
    await host.initialize();
    const tangents = new Float32Array([1, 0, 0, -1, 1, 0, 0, -1, 1, 0, 0, -1]);
    host.uploadMesh("chunk:tangent", { ...triangle, tangents });
    expect(renderer.upload_mesh.mock.calls[0]![5]).toBe(tangents);
    host.destroy();
  });

  it("rejects geometry that is not a whole number of vertices or triangles", () => {
    const host = new WebGpuRenderHost({
      width: 0,
      height: 0,
      clientWidth: 8,
      clientHeight: 8,
    } as HTMLCanvasElement);
    expect(() => host.uploadMesh("", triangle)).toThrow(/non-empty identifier/);
    expect(() =>
      host.uploadMesh("bad", {
        positions: new Float32Array([0, 0]),
        indices: new Uint32Array([0, 1, 2]),
      }),
    ).toThrow(/whole number of vertices/);
    expect(() =>
      host.uploadMesh("bad", {
        positions: triangle.positions,
        indices: new Uint32Array([0, 1]),
      }),
    ).toThrow(/whole number of triangles/);
    expect(() =>
      host.uploadMesh("bad", {
        ...triangle,
        textureLayers: new Float32Array([0, 1]),
      }),
    ).toThrow(/textureLayers length/);
    expect(() =>
      host.uploadMesh("bad", {
        ...triangle,
        tangents: new Float32Array([1, 0, 0, 1]),
      }),
    ).toThrow(/tangents length/);
    host.destroy();
  });

  it("forgets released meshes so they are not replayed", async () => {
    browserGlobals();
    const renderer = fakeRenderer();
    const host = new WebGpuRenderHost(
      {
        width: 0,
        height: 0,
        clientWidth: 8,
        clientHeight: 8,
      } as HTMLCanvasElement,
      {
        loadModule: async () => ({
          default: async () => undefined,
          WebGpuRenderer: { create: async () => renderer },
        }),
      },
    );
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
    } as HTMLCanvasElement);
    expect(() => host.uploadMesh("chunk:0", triangle)).not.toThrow();
    expect(host.meshIds()).toEqual(["chunk:0"]);
    host.destroy();
  });

  it("replays textures before dependent materials and submits material tables", async () => {
    browserGlobals();
    const renderer = fakeRenderer();
    const order: string[] = [];
    renderer.upload_texture_rgba8.mockImplementation(() =>
      order.push("texture"),
    );
    renderer.define_material_json.mockImplementation(() =>
      order.push("material"),
    );
    renderer.upload_mesh.mockImplementation(() => order.push("mesh"));
    const host = new WebGpuRenderHost(
      {
        width: 0,
        height: 0,
        clientWidth: 8,
        clientHeight: 8,
      } as HTMLCanvasElement,
      {
        loadModule: async () => ({
          default: async () => undefined,
          WebGpuRenderer: { create: async () => renderer },
        }),
      },
    );
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
    expect(
      JSON.parse(renderer.define_material_json.mock.calls[0]![1] as string)
        .atlas,
    ).toEqual({ columns: 16, rows: 96, inset: 0.006, origin: "top-left" });

    const frame = new FrameBuilder();
    frame.draw("chunk:0", composeTranslation(new Float32Array(16), 0, 0, 0), {
      material: "material:blocks",
    });
    host.submitFrame(frame.pack());
    const call = renderer.set_render_frame.mock.calls[0]!;
    expect(JSON.parse(call[2] as string)).toEqual([
      "builtin:default",
      "material:blocks",
    ]);
    expect(call[3]).toEqual(new Uint32Array([1]));
    host.destroy();
  });

  it("accepts SDF coverage materials and rejects unknown coverage modes", () => {
    expect(() =>
      validateMaterialUpload(
        "material:font",
        { coverageMode: "sdf", alphaMode: "blend", depthWrite: false },
        () => true,
      ),
    ).not.toThrow();
    expect(() =>
      validateMaterialUpload(
        "material:bad",
        { coverageMode: "msdf" as "sdf" },
        () => true,
      ),
    ).toThrow(/coverageMode.*alpha or sdf/);
  });

  it("passes several camera layers through one typed-array WASM call", async () => {
    browserGlobals();
    const renderer = fakeRenderer();
    const host = new WebGpuRenderHost(
      {
        width: 0,
        height: 0,
        clientWidth: 8,
        clientHeight: 8,
      } as HTMLCanvasElement,
      {
        loadModule: async () => ({
          default: async () => undefined,
          WebGpuRenderer: { create: async () => renderer },
        }),
      },
    );
    await host.initialize();
    const world = new FrameBuilder(1);
    const overlay = new FrameBuilder(1);
    world.draw(
      "builtin:cube",
      composeTranslation(new Float32Array(16), 0, 0, 0),
    );
    overlay.draw(
      "builtin:cube",
      composeTranslation(new Float32Array(16), 0, 0, -1),
    );
    host.submitLayers([
      { frame: world.pack() },
      { frame: overlay.pack(), clearColor: false, clearDepth: true },
    ]);

    expect(renderer.set_render_layers).toHaveBeenCalledTimes(1);
    const call = renderer.set_render_layers.mock.calls[0]!;
    expect(call[7]).toEqual(new Uint32Array([1, 1]));
    expect(call[8]).toEqual(new Uint32Array([3, 2]));
    expect((call[4] as Float32Array).length).toBe(32);
    host.destroy();
  });
});
