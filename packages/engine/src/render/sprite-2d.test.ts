import { describe, expect, it } from "vitest";
import {
  OrthographicCamera2D,
  SpriteBatch2D,
  type SpriteAsset,
} from "./sprite-2d.js";

const sprite: SpriteAsset = {
  id: "hero",
  material: "characters",
  textureSize: [256, 256],
  rect: [32, 64, 64, 32],
  pixelsPerUnit: 32,
};

describe("SpriteBatch2D", () => {
  it("builds a naturally sized pivoted quad with correct atlas UVs", () => {
    const batch = new SpriteBatch2D("scene");
    batch.add({ sprite, position: [3, 4] });
    const result = batch.build()[0]!;
    expect(result.id).toBe("scene:0");
    expect(result.mesh.positions).toEqual(
      new Float32Array([2, 3.5, 0, 4, 3.5, 0, 4, 4.5, 0, 2, 4.5, 0]),
    );
    expect(result.mesh.indices).toEqual(new Uint32Array([0, 1, 2, 0, 2, 3]));
    expect([...result.mesh.uvs!]).toEqual([
      0.125, 0.625, 0.375, 0.625, 0.375, 0.75, 0.125, 0.75,
    ]);
  });

  it("produces nine-slice geometry and compresses borders for undersized targets", () => {
    const panel: SpriteAsset = {
      ...sprite,
      id: "panel",
      rect: [0, 0, 60, 60],
      pixelsPerUnit: 10,
      border: [20, 20, 20, 20],
    };
    const batch = new SpriteBatch2D();
    batch.add({ sprite: panel, position: [0, 0], size: [2, 2] });
    const mesh = batch.build()[0]!.mesh;
    // The target is smaller than the combined fixed borders, so Vapour scales
    // the four corners down and removes the zero-sized center row/column.
    expect(mesh.positions.length / 3).toBe(16);
    expect(mesh.indices.length / 3).toBe(8);
    expect(
      Math.min(...mesh.positions.filter((_, index) => index % 3 === 0)),
    ).toBe(-1);
    expect(
      Math.max(...mesh.positions.filter((_, index) => index % 3 === 0)),
    ).toBe(1);
  });

  it("groups by material and layer while preserving stable order", () => {
    const batch = new SpriteBatch2D();
    batch.add({ sprite, position: [1, 0], sortingLayer: 2, order: 4 });
    batch.add({
      sprite: { ...sprite, material: "background" },
      position: [0, 0],
      sortingLayer: 0,
    });
    batch.add({ sprite, position: [2, 0], sortingLayer: 2, order: 5 });
    const groups = batch.build();
    expect(
      groups.map((group) => [
        group.material,
        group.sortingLayer,
        group.spriteCount,
      ]),
    ).toEqual([
      ["background", 0, 1],
      ["characters", 2, 2],
    ]);
  });

  it("rejects malformed sprite assets with actionable errors", () => {
    const batch = new SpriteBatch2D();
    expect(() =>
      batch.add({
        sprite: { ...sprite, rect: [250, 0, 64, 32] },
        position: [0, 0],
      }),
    ).toThrow(/contained within/);
    expect(() =>
      batch.add({
        sprite: { ...sprite, border: [40, 0, 40, 0] },
        position: [0, 0],
      }),
    ).toThrow(/borders/);
  });
});

describe("OrthographicCamera2D", () => {
  it("expands without cropping the reference resolution", () => {
    const camera = new OrthographicCamera2D({
      referenceResolution: [1920, 1080],
      pixelsPerUnit: 100,
      mode: "expand",
    });
    expect(camera.bounds([2560, 1080]).width).toBeCloseTo(25.6);
    expect(camera.bounds([1080, 1920]).height).toBeCloseTo(34.133333, 5);
  });

  it("maps top-left screen coordinates and snaps to physical pixels", () => {
    const camera = new OrthographicCamera2D({
      referenceResolution: [800, 600],
      pixelsPerUnit: 100,
    });
    expect(camera.screenToWorld([0, 0], [800, 600])).toEqual([-4, 3]);
    expect(camera.screenToWorld([400, 300], [800, 600], [2, -1])).toEqual([
      2, -1,
    ]);
    expect(camera.snap([0.014, 0.026], [1600, 1200])).toEqual([0.015, 0.025]);
  });
});
