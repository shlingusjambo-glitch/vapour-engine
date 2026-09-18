import { describe, expect, it } from "vitest";
import { SpriteAtlas, packGridAtlas } from "./atlas-2d.js";

describe("SpriteAtlas", () => {
  it("looks up a named region as a ready-to-draw sprite", () => {
    const atlas = new SpriteAtlas({
      material: "sheet",
      textureSize: [128, 128],
      pixelsPerUnit: 32,
      regions: [
        { name: "hero_idle", rect: [0, 0, 32, 32], pivot: [0.5, 0] },
        { name: "hero_walk_0", rect: [32, 0, 32, 32], border: [2, 2, 2, 2] },
      ],
    });
    console.log(`M115 atlas lookup: names=${atlas.names.join(",")}`);
    const idle = atlas.region("hero_idle");
    expect(idle).toBeDefined();
    expect(idle!.rect).toEqual([0, 0, 32, 32]);
    expect(idle!.pivot).toEqual([0.5, 0]);
    expect(idle!.material).toBe("sheet");
    expect(atlas.region("hero_walk_0")!.border).toEqual([2, 2, 2, 2]);
    expect(atlas.region("missing")).toBeUndefined();
  });

  it("rejects duplicate names and degenerate rects", () => {
    expect(
      () =>
        new SpriteAtlas({
          material: "sheet",
          textureSize: [64, 64],
          regions: [
            { name: "a", rect: [0, 0, 16, 16] },
            { name: "a", rect: [16, 0, 16, 16] },
          ],
        }),
    ).toThrow(/duplicate/i);
    expect(
      () =>
        new SpriteAtlas({
          material: "sheet",
          textureSize: [64, 64],
          regions: [{ name: "a", rect: [0, 0, 0, 16] }],
        }),
    ).toThrow(/positive rect/);
  });

  it("packs a regular grid sheet, naming cells left to right then top to bottom", () => {
    const atlas = packGridAtlas({
      material: "walk",
      textureSize: [64, 32],
      cellSize: [16, 16],
      columns: 4,
      rows: 2,
    });
    expect(atlas.names).toHaveLength(8);
    expect(atlas.region("cell_0")!.rect).toEqual([0, 0, 16, 16]);
    expect(atlas.region("cell_3")!.rect).toEqual([48, 0, 16, 16]);
    expect(atlas.region("cell_4")!.rect).toEqual([0, 16, 16, 16]);
  });

  it("packs a grid sheet with custom names", () => {
    const atlas = packGridAtlas({
      material: "walk",
      textureSize: [32, 16],
      cellSize: [16, 16],
      columns: 2,
      rows: 1,
      names: ["left", "right"],
    });
    expect(atlas.region("left")!.rect).toEqual([0, 0, 16, 16]);
    expect(atlas.region("right")!.rect).toEqual([16, 0, 16, 16]);
  });
});
