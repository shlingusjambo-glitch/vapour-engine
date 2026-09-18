import { describe, expect, it } from "vitest";
import { FrameBuilder, composeTranslation } from "../core/frame-builder.js";
import { HeadlessRenderHost } from "./headless-render-host.js";

const triangle = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
};

describe("HeadlessRenderHost", () => {
  it("validates uploads and computes real frame workload statistics", async () => {
    const host = new HeadlessRenderHost();
    await host.initialize();
    host.uploadMesh("test:triangle", triangle);
    const frame = new FrameBuilder();
    const matrix = new Float32Array(16);
    composeTranslation(matrix, 0, 0, 0);
    frame.draw("test:triangle", matrix);
    composeTranslation(matrix, 2, 0, 0);
    frame.draw("test:triangle", matrix);
    host.submitFrame(frame.pack());
    expect(host.snapshot()).toEqual({
      drawCalls: 1,
      triangles: 2,
      instances: 2,
      meshIds: ["test:triangle"],
    });
    expect(host.renderFrame(100).triangles).toBe(2);
  });

  it("measures all camera layers in one presentation", async () => {
    const host = new HeadlessRenderHost();
    await host.initialize();
    host.uploadMesh("test:triangle", triangle);
    const world = new FrameBuilder(1);
    const overlay = new FrameBuilder(1);
    world.draw(
      "test:triangle",
      composeTranslation(new Float32Array(16), 0, 0, 0),
    );
    overlay.draw(
      "test:triangle",
      composeTranslation(new Float32Array(16), 0, 0, -1),
    );
    host.submitLayers([
      { frame: world.pack() },
      { frame: overlay.pack(), clearColor: false, clearDepth: true },
    ]);
    expect(host.snapshot()).toEqual({
      drawCalls: 2,
      triangles: 2,
      instances: 2,
      meshIds: ["test:triangle"],
    });
  });

  it("rejects missing meshes and malformed buffers", async () => {
    const host = new HeadlessRenderHost();
    await host.initialize();
    expect(() =>
      host.uploadMesh("bad", {
        ...triangle,
        indices: new Uint32Array([0, 1, 9]),
      }),
    ).toThrow(/out of range/);
    const frame = new FrameBuilder();
    const matrix = new Float32Array(16);
    composeTranslation(matrix, 0, 0, 0);
    frame.draw("missing", matrix);
    expect(() => host.submitFrame(frame.pack())).toThrow(/missing mesh/);
  });

  it("never silently operates before initialization or after destruction", async () => {
    const host = new HeadlessRenderHost();
    expect(() => host.renderFrame(0)).toThrow(/not initialized/);
    await host.initialize();
    host.destroy();
    await expect(host.initialize()).rejects.toThrow(/destroyed/);
  });

  it("validates and retains HDR presentation settings", () => {
    const host = new HeadlessRenderHost();
    host.setPostProcess({
      exposure: 1.5,
      toneMapping: "reinhard",
      bloom: { intensity: 0.8, threshold: 1.2, scatter: 0.7 },
      saturation: 0.9,
      contrast: 1.1,
      vignette: 0.25,
      chromaticAberration: 0.05,
    });
    expect(host.postProcess()).toMatchObject({
      exposure: 1.5,
      toneMapping: "reinhard",
      bloom: { intensity: 0.8, threshold: 1.2, scatter: 0.7 },
    });
    expect(() =>
      host.setPostProcess({ exposure: -1, toneMapping: "aces" }),
    ).toThrow(/\[0, 64\]/);
    expect(() =>
      host.setPostProcess({ exposure: 1, toneMapping: "bad" as "aces" }),
    ).toThrow(/Unknown tone mapping/);
    expect(() =>
      host.setPostProcess({
        exposure: 1,
        toneMapping: "aces",
        bloom: { scatter: 2 },
      }),
    ).toThrow(/Bloom scatter/);
    expect(() =>
      host.setPostProcess({ exposure: 1, toneMapping: "aces", vignette: NaN }),
    ).toThrow(/Vignette/);
  });

  it("validates texture dependencies and material references", async () => {
    const host = new HeadlessRenderHost();
    await host.initialize();
    const pixels = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ]);
    host.uploadTexture("atlas:blocks", { width: 2, height: 2, pixels });
    host.defineMaterial("material:blocks", {
      textures: { baseColor: "atlas:blocks" },
      filter: "nearest",
    });
    host.uploadMesh("test:triangle", triangle);
    const frame = new FrameBuilder();
    frame.draw(
      "test:triangle",
      composeTranslation(new Float32Array(16), 0, 0, 0),
      { material: "material:blocks" },
    );
    expect(() => host.submitFrame(frame.pack())).not.toThrow();
    expect(() => host.releaseTexture("atlas:blocks")).toThrow(/still used/);
    expect(host.releaseMaterial("material:blocks")).toBe(true);
    expect(host.releaseTexture("atlas:blocks")).toBe(true);
    expect(() =>
      host.uploadTexture("bad", {
        width: 2,
        height: 2,
        pixels: new Uint8Array(3),
      }),
    ).toThrow(/16 RGBA8 bytes/);
    expect(() =>
      host.defineMaterial("missing", { textures: { baseColor: "nope" } }),
    ).toThrow(/missing texture/);
  });

  it("tracks the environment source without a GPU", async () => {
    const host = new HeadlessRenderHost();
    await host.initialize();
    expect(host.environment()).toBeUndefined();
    const faces = new Uint8Array(4 * 6);
    host.uploadEnvironment({ faceSize: 1, faces });
    expect(host.environment()).toEqual({ faceSize: 1, faces });
    expect(() =>
      host.uploadEnvironment({ faceSize: 3, faces }),
    ).toThrow(/needs 216 RGBA8 bytes/);
    host.deriveEnvironmentFromSky();
    expect(host.environment()).toBe("sky");
    expect(() => host.deriveEnvironmentFromSky(-1)).toThrow(/intensity/);
    host.clearEnvironment();
    expect(host.environment()).toBeUndefined();
  });

  it("tracks render targets and rejects a camera sampling its own target", async () => {
    const host = new HeadlessRenderHost();
    await host.initialize();
    host.createRenderTarget("rt:monitor", { scale: 0.5 });
    expect(host.renderTargetIds()).toEqual(["rt:monitor"]);
    expect(() => host.createRenderTarget("rt:bad", { scale: 0 })).toThrow(/scale/);
    host.defineMaterial("screen", { textures: { baseColor: "rt:monitor" } });
    const builder = new FrameBuilder(1);
    builder.draw(
      "builtin:cube",
      composeTranslation(new Float32Array(16), 0, 0, 0),
      { material: "screen" },
    );
    expect(() =>
      host.submitLayers([{ frame: builder.pack(), target: "rt:monitor" }]),
    ).toThrow(/rt:monitor -> rt:monitor/);
    expect(() =>
      host.submitLayers([{ frame: builder.pack(), target: "rt:missing" }]),
    ).toThrow(/not a render target/);
    // Rendering the monitor's feed elsewhere and showing it on screen is fine.
    host.submitLayers([
      { frame: new FrameBuilder(1).pack(), target: "rt:monitor" },
      { frame: builder.pack() },
    ]);
    expect(() => host.releaseRenderTarget("rt:monitor")).toThrow(/still used/);
    host.releaseMaterial("screen");
    expect(host.releaseRenderTarget("rt:monitor")).toBe(true);
  });
});
