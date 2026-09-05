import { describe, expect, it } from "vitest";
import { FrameBuilder, composeTranslation } from "../core/frame-builder.js";
import {
  RENDER_LAYER_CLEAR_COLOR,
  RENDER_LAYER_CLEAR_DEPTH,
  RENDER_LAYER_HAS_CAMERA,
  RENDER_LAYER_HAS_ENVIRONMENT,
  packRenderLayers,
} from "./render-layers.js";

function frame(mesh: string, material: string, x: number, cameraFov?: number) {
  const builder = new FrameBuilder(1);
  builder.draw(mesh, composeTranslation(new Float32Array(16), x, 0, 0), {
    material,
  });
  if (cameraFov !== undefined) {
    builder.setCamera(
      composeTranslation(new Float32Array(16), x, 2, 5),
      cameraFov,
      0.1,
      500,
    );
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
    expect(packed.layerFlags[0]).toBe(
      RENDER_LAYER_CLEAR_COLOR |
        RENDER_LAYER_CLEAR_DEPTH |
        RENDER_LAYER_HAS_CAMERA,
    );
    expect(packed.layerFlags[1]).toBe(
      RENDER_LAYER_CLEAR_DEPTH | RENDER_LAYER_HAS_CAMERA,
    );
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
    expect(packed.layerFlags[0]! & RENDER_LAYER_HAS_ENVIRONMENT).toBe(
      RENDER_LAYER_HAS_ENVIRONMENT,
    );
    expect(packed.layerFlags[1]! & RENDER_LAYER_HAS_ENVIRONMENT).toBe(0);
    expect(packed.environments).toHaveLength(48);
    expect(packed.environments.slice(0, 4)).toEqual(
      new Float32Array([0.1, 0.2, 0.3, 1]),
    );
    expect(packed.environments[7]).toBe(1);
    expect(packed.environments.slice(24)).toEqual(new Float32Array(24));
  });

  it("rejects an empty submission and a first layer that cannot initialize the target", () => {
    expect(() => packRenderLayers([])).toThrow(/at least one layer/);
    const source = frame("mesh:a", "builtin:default", 0);
    expect(() =>
      packRenderLayers([{ frame: source, clearColor: false }]),
    ).toThrow(/clear both colour and depth/);
  });
});
