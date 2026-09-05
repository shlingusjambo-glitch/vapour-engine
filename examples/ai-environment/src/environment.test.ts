import { describe, expect, it } from "vitest";
import { meshStats } from "@vapour/assetgen";
import { VILLAGE, generateVillage, previewMesh } from "./environment.js";

/** The showcase is also a regression test: it exercises terrain, architecture,
 * CSG, characters, vegetation, scattering, collision, and navigation together,
 * which is where integration bugs actually live. */
describe("the generated village", () => {
  const village = generateVillage(VILLAGE);

  it("produces every kind of asset from one description", () => {
    expect(village.buildings).toHaveLength(VILLAGE.houses.length);
    expect(village.npcs).toHaveLength(VILLAGE.population);
    expect(village.trees.length).toBeGreaterThan(0);
    expect(village.rocks.length).toBeGreaterThan(0);
    expect(meshStats(village.terrain.mesh).triangles).toBeGreaterThan(0);
  });

  it("expands a tiny description into a real amount of geometry", () => {
    expect(village.stats.descriptionBytes).toBeLessThan(2000);
    expect(village.stats.instancedTriangles).toBeGreaterThan(50_000);
    // The whole argument for the asset system, as a number.
    expect(village.stats.instancedTriangles / village.stats.descriptionBytes).toBeGreaterThan(20);
  });

  it("derives navigation for every building without extra authoring", () => {
    expect(village.stats.navSurfaces).toBeGreaterThanOrEqual(village.buildings.length);
    // One walkable door per house, and no window links.
    expect(village.stats.navLinks).toBe(village.buildings.length);
    for (const entry of village.buildings) {
      for (const link of entry.asset.navigation!.links) {
        expect(link.kind).toBe("door");
        expect(link.width).toBeGreaterThan(0.8);
      }
    }
  });

  it("gives every building collision and an LOD chain", () => {
    for (const entry of village.buildings) {
      expect(entry.asset.collision.kind).toBe("mesh");
      expect(meshStats(entry.asset.collision.mesh!).triangles).toBeGreaterThan(0);
      expect(entry.asset.lods.levels.length).toBeGreaterThan(1);
      expect(entry.asset.lods.triangleCounts[1]!).toBeLessThan(entry.asset.lods.triangleCounts[0]!);
    }
  });

  it("keeps multi-storey houses' upper floors and stairs", () => {
    const twoStorey = village.buildings.find((entry) => entry.building.floorLevels.length > 1);
    expect(twoStorey).toBeDefined();
    expect(twoStorey!.building.floorLevels[1]).toBeGreaterThan(2);
    expect(twoStorey!.building.rooms.length).toBeGreaterThan(1);
  });

  it("places houses off the street and vegetation clear of both", () => {
    const halfStreet = VILLAGE.street.width / 2;
    for (const entry of village.buildings) {
      expect(Math.abs(entry.placement.position[0])).toBeGreaterThan(halfStreet);
    }
    for (const variant of village.trees) {
      for (const placement of variant.placements) {
        expect(Math.abs(placement.position[0])).toBeGreaterThan(halfStreet);
      }
    }
  });

  it("sits everything on the terrain rather than floating", () => {
    for (const variant of [...village.trees, ...village.rocks]) {
      for (const placement of variant.placements) {
        expect(Number.isFinite(placement.position[1])).toBe(true);
        expect(Math.abs(placement.position[1])).toBeLessThan(VILLAGE.terrain.relief * 2);
      }
    }
  });

  it("gives every NPC a standard skeleton and consistent skin weights", () => {
    for (const npc of village.npcs) {
      expect(npc.stats.bones).toBe(22);
      expect(npc.skin.joints).toHaveLength(meshStats(npc.mesh).vertices * 4);
      expect(npc.skin.inverseBind).toHaveLength(npc.stats.bones * 16);
    }
  });

  it("is reproducible from its seed", () => {
    const again = generateVillage(VILLAGE);
    expect(again.stats.uniqueTriangles).toBe(village.stats.uniqueTriangles);
    expect(again.buildings[0]!.placement).toEqual(village.buildings[0]!.placement);
    expect([...again.terrain.heights]).toEqual([...village.terrain.heights]);
  });

  it("merges into a valid preview mesh with finite positions", () => {
    const preview = previewMesh(village);
    expect(meshStats(preview).triangles).toBeGreaterThan(10_000);
    for (let index = 0; index < preview.positions.length; index += 1) {
      if (!Number.isFinite(preview.positions[index]!)) throw new Error(`Non-finite position at ${index}`);
    }
    // Indices stay in range after merging thousands of placed instances.
    const vertices = meshStats(preview).vertices;
    for (const index of preview.indices) expect(index).toBeLessThan(vertices);
  });
});
