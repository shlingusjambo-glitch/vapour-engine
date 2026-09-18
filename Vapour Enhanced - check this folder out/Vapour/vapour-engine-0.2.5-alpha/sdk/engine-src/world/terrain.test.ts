import { describe, expect, it } from "vitest";
import { TerrainHeightfield } from "./terrain.js";

describe("TerrainHeightfield", () => {
  it("builds matching centered render and physics surfaces", () => {
    const terrain = new TerrainHeightfield({ rows: 2, columns: 3, heights: [0, 1, 0, 0, 1, 0], scale: [10, 2, 4], uvScale: [5, 2] });
    const mesh = terrain.mesh();
    expect(Array.from(mesh.positions.slice(0, 3))).toEqual([-5, 0, -2]);
    expect(Array.from(mesh.positions.slice(3, 6))).toEqual([0, 2, -2]);
    expect(Array.from(mesh.indices)).toEqual([0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5]);
    expect(terrain.collider()).toEqual({ type: "heightfield", rows: 2, columns: 3, heights: [0, 1, 0, 0, 1, 0], scale: [10, 2, 4] });
    expect(terrain.sampleHeight(0, 0)).toBe(2);
    expect(terrain.sampleHeight(6, 0)).toBeUndefined();
  });

  it("generates deterministic grids and reports malformed input precisely", () => {
    const terrain = TerrainHeightfield.generate(3, 3, [2, 1, 2], (x, z) => x + z);
    expect(Array.from(terrain.heights)).toEqual([0, 0.5, 1, 0.5, 1, 1.5, 1, 1.5, 2]);
    expect(terrain.sampleHeight(0, 0)).toBe(1);
    expect(() => new TerrainHeightfield({ rows: 3, columns: 3, heights: [0], scale: [1, 1, 1] })).toThrow(/requires 9/);
  });
});
