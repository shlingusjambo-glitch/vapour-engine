import { describe, expect, it } from "vitest";
import {
  NATURE_SLOTS, generateGrassClump, generateRock, generateTerrain, generateTree, isClosed,
  meshBounds, meshStats, sampleTerrainHeight, scatterOnTerrain, seededRandom, signedVolume,
  weldVertices,
} from "./index.js";

describe("seededRandom", () => {
  it("is reproducible and stays in [0, 1)", () => {
    const first = Array.from({ length: 50 }, seededRandom(1234));
    const second = Array.from({ length: 50 }, seededRandom(1234));
    expect(second).toEqual(first);
    expect(Array.from({ length: 50 }, seededRandom(5678))).not.toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("never returns a constant, even from seed zero", () => {
    const values = Array.from({ length: 20 }, seededRandom(0));
    expect(new Set(values).size).toBeGreaterThan(5);
  });
});

describe("generateTree", () => {
  it("grows to roughly the requested height", () => {
    const tree = generateTree({ height: 8, seed: 3 });
    expect(tree.height).toBeGreaterThan(4);
    expect(tree.height).toBeLessThan(12);
    expect(tree.stats.branches).toBeGreaterThan(1);
    expect(tree.canopyRadius).toBeGreaterThan(0);
  });

  it("is identical for the same seed and different for another", () => {
    const a = generateTree({ seed: 7 });
    const b = generateTree({ seed: 7 });
    const c = generateTree({ seed: 8 });
    expect([...b.mesh.positions]).toEqual([...a.mesh.positions]);
    expect([...c.mesh.positions]).not.toEqual([...a.mesh.positions]);
  });

  it("branches more with depth, and not at all at depth zero", () => {
    const shallow = generateTree({ branchDepth: 0, seed: 1 });
    const deep = generateTree({ branchDepth: 2, seed: 1 });
    expect(shallow.stats.branches).toBe(1);
    expect(deep.stats.branches).toBeGreaterThan(shallow.stats.branches);
    expect(deep.stats.triangles).toBeGreaterThan(shallow.stats.triangles);
  });

  it("gives a dead tree no foliage", () => {
    const alive = generateTree({ kind: "broadleaf", seed: 2 });
    const dead = generateTree({ kind: "dead", seed: 2 });
    expect(new Set(alive.mesh.materialSlots!)).toContain(NATURE_SLOTS.foliage);
    expect(new Set(dead.mesh.materialSlots!)).not.toContain(NATURE_SLOTS.foliage);
  });

  it("shapes each kind differently", () => {
    const conifer = generateTree({ kind: "conifer", seed: 5, height: 8 });
    const palm = generateTree({ kind: "palm", seed: 5, height: 8 });
    // A palm's fronds spread outward; a conifer's canopy stays tighter.
    expect(palm.canopyRadius).toBeGreaterThan(conifer.canopyRadius);
  });

  it("validates its parameters", () => {
    expect(() => generateTree({ height: 0 })).toThrow(/must be a positive/);
    expect(() => generateTree({ trunkRadius: 0.9 })).toThrow(/fraction of height/);
    expect(() => generateTree({ branchDepth: 9 })).toThrow(/\[0, 4\]/);
    expect(() => generateTree({ segments: 2 })).toThrow(/at least three/);
  });
});

describe("generateRock", () => {
  it("is a closed solid, so it can be its own collider", () => {
    const rock = generateRock({ seed: 4 });
    expect(isClosed(weldVertices(rock, 1e-4))).toBe(true);
    expect(signedVolume(rock)).toBeGreaterThan(0);
  });

  it("is irregular but bounded by its radius scale", () => {
    const rock = generateRock({ radius: 1, roughness: 0.4, seed: 9 });
    const bounds = meshBounds(rock);
    expect(bounds.max[0]).toBeGreaterThan(0.3);
    expect(bounds.max[0]).toBeLessThan(2.5);
    // A smooth rock is just a sphere.
    const smooth = generateRock({ radius: 1, roughness: 0, seed: 9 });
    expect(meshBounds(smooth).max[0]).toBeCloseTo(1, 1);
  });

  it("is reproducible from its seed", () => {
    expect([...generateRock({ seed: 11 }).positions]).toEqual([...generateRock({ seed: 11 }).positions]);
  });

  it("validates its parameters", () => {
    expect(() => generateRock({ radius: 0 })).toThrow(/must be a positive/);
    expect(() => generateRock({ roughness: 1 })).toThrow(/\[0, 1\)/);
    expect(() => generateRock({ segments: 3 })).toThrow(/at least four/);
  });
});

describe("generateGrassClump", () => {
  it("is cheap, because grass is drawn in enormous numbers", () => {
    const clump = generateGrassClump({ blades: 6 });
    // Two triangles per blade.
    expect(meshStats(clump).triangles).toBe(12);
    expect(new Set(clump.materialSlots!)).toEqual(new Set([NATURE_SLOTS.foliage]));
  });

  it("stands on the ground and stays within its clump radius", () => {
    const clump = generateGrassClump({ blades: 12, height: 0.5, radius: 0.2, seed: 3 });
    const bounds = meshBounds(clump);
    expect(bounds.min[1]).toBeGreaterThan(-0.1);
    expect(bounds.max[1]).toBeLessThan(0.8);
    expect(Math.max(Math.abs(bounds.min[0]), bounds.max[0])).toBeLessThan(0.5);
  });

  it("validates its parameters", () => {
    expect(() => generateGrassClump({ blades: 0 })).toThrow(/at least one blade/);
    expect(() => generateGrassClump({ height: 0 })).toThrow(/must be a positive/);
  });
});

describe("generateTerrain", () => {
  it("produces a grid whose heightfield matches its mesh", () => {
    const terrain = generateTerrain({ width: 16, depth: 16, resolution: 8, seed: 2 });
    expect(terrain.heights).toHaveLength(81);
    expect(meshStats(terrain.mesh).vertices).toBe(81);
    expect(meshStats(terrain.mesh).triangles).toBe(8 * 8 * 2);
    expect(meshBounds(terrain.mesh).max[0]).toBeCloseTo(8);
  });

  it("accepts real elevation data instead of generating it", () => {
    const heights = Array.from({ length: 9 }, (_, index) => index);
    const terrain = generateTerrain({ resolution: 2, width: 4, depth: 4, heights });
    expect([...terrain.heights]).toEqual(heights);
    expect(() => generateTerrain({ resolution: 2, heights: [1, 2] })).toThrow(/must have 9 samples/);
  });

  it("samples height bilinearly, matching the grid at its corners", () => {
    const heights = [0, 0, 0, 0, 10, 0, 0, 0, 0];
    const terrain = generateTerrain({ resolution: 2, width: 4, depth: 4, heights });
    // The centre sample is the raised vertex.
    expect(sampleTerrainHeight(terrain, 0, 0)).toBeCloseTo(10, 5);
    expect(sampleTerrainHeight(terrain, -2, -2)).toBeCloseTo(0, 5);
    // Halfway between is halfway up.
    expect(sampleTerrainHeight(terrain, -1, 0)).toBeCloseTo(5, 5);
  });

  it("clamps samples taken outside the patch", () => {
    const terrain = generateTerrain({ resolution: 2, width: 4, depth: 4, heights: [0, 0, 0, 0, 10, 0, 0, 0, 0] });
    expect(() => sampleTerrainHeight(terrain, 1000, 1000)).not.toThrow();
    expect(sampleTerrainHeight(terrain, 1000, 1000)).toBeCloseTo(0, 5);
  });

  it("is reproducible from its seed", () => {
    expect([...generateTerrain({ seed: 5 }).heights]).toEqual([...generateTerrain({ seed: 5 }).heights]);
  });

  it("faces up, so it renders and is walkable", () => {
    // Wound face-down, terrain is invisible under backface culling and bakes to
    // an empty navmesh — a failure that is silent until something looks for it.
    const terrain = generateTerrain({ resolution: 4, width: 8, depth: 8, heights: new Array(25).fill(0) });
    for (const value of terrain.mesh.normals!.filter((_, index) => index % 3 === 1)) {
      expect(value).toBeGreaterThan(0.9);
    }
  });

  it("validates its parameters", () => {
    expect(() => generateTerrain({ width: 0 })).toThrow(/must be a positive/);
    expect(() => generateTerrain({ resolution: 0 })).toThrow(/at least 1/);
  });
});

describe("scatterOnTerrain", () => {
  const flat = generateTerrain({ width: 40, depth: 40, resolution: 8, heights: new Array(81).fill(0) });

  it("places instances on the surface", () => {
    const placements = scatterOnTerrain(flat, { count: 30, seed: 3 });
    expect(placements).toHaveLength(30);
    for (const placement of placements) {
      expect(placement.position[1]).toBeCloseTo(0, 5);
      expect(Math.abs(placement.position[0])).toBeLessThanOrEqual(20);
      expect(placement.rotationY).toBeGreaterThanOrEqual(0);
      expect(placement.scale).toBeGreaterThan(0.5);
    }
  });

  it("honours a minimum spacing", () => {
    const placements = scatterOnTerrain(flat, { count: 20, seed: 4, minSpacing: 5 });
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const distance = Math.hypot(
          placements[i]!.position[0] - placements[j]!.position[0],
          placements[i]!.position[2] - placements[j]!.position[2],
        );
        expect(distance).toBeGreaterThanOrEqual(5 - 1e-9);
      }
    }
  });

  it("gives up rather than looping forever when the spacing cannot be met", () => {
    const placements = scatterOnTerrain(flat, { count: 500, seed: 5, minSpacing: 15 });
    expect(placements.length).toBeGreaterThan(0);
    expect(placements.length).toBeLessThan(500);
  });

  it("rejects slopes steeper than the limit", () => {
    // A ramp climbing steeply across the patch.
    const side = 9;
    const heights = Array.from({ length: side * side }, (_, index) => (index % side) * 8);
    const steep = generateTerrain({ width: 40, depth: 40, resolution: 8, heights });
    expect(scatterOnTerrain(steep, { count: 20, seed: 6, maxSlopeDegrees: 10 })).toHaveLength(0);
    expect(scatterOnTerrain(steep, { count: 20, seed: 6, maxSlopeDegrees: 89 }).length).toBeGreaterThan(0);
  });

  it("is reproducible and validates its count", () => {
    const a = scatterOnTerrain(flat, { count: 10, seed: 8 });
    const b = scatterOnTerrain(flat, { count: 10, seed: 8 });
    expect(b).toEqual(a);
    expect(scatterOnTerrain(flat, { count: 0 })).toEqual([]);
    expect(() => scatterOnTerrain(flat, { count: -1 })).toThrow(/non-negative whole number/);
  });
});
