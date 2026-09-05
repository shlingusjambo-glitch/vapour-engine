/** A complete environment, described in structured data.
 *
 * This is the Mirage showcase for AI-native asset generation: a village — its
 * terrain, a street of houses, trees and rocks scattered across it, and a
 * population of NPCs — described entirely as data, with no vertex, no matrix,
 * and no editor interaction anywhere in the description.
 *
 * The description below is the *entire* input. Everything else is derived:
 * geometry, materials, collision, navigation surfaces and doorway links,
 * skeletons and skinning weights, and LOD chains.
 */
import {
  compileBuilding, generateBuilding, generateCharacter, generateCrowd, generateRock,
  generateTerrain, generateTree, mergeMeshes, meshStats, placeMesh, rectangularWalls,
  sampleTerrainHeight, scatterOnTerrain, seededRandom,
  type CompiledAsset, type GeneratedBuilding, type GeneratedCharacter, type GeneratedTerrain,
  type MeshData,
} from "@vapour/assetgen";

export interface HouseDescription {
  readonly name: string;
  /** Position along the street, in metres from its start. */
  readonly along: number;
  /** Which side of the street: `-1` or `1`. */
  readonly side: -1 | 1;
  readonly width: number;
  readonly depth: number;
  readonly storeys: number;
  readonly roof: "gable" | "hip" | "flat";
}

export interface VillageDescription {
  readonly name: string;
  readonly seed: number;
  readonly terrain: { readonly size: number; readonly resolution: number; readonly relief: number };
  readonly street: { readonly length: number; readonly width: number };
  readonly houses: readonly HouseDescription[];
  readonly vegetation: { readonly trees: number; readonly rocks: number; readonly minSpacing: number };
  readonly population: number;
}

/** The village. This object is the whole authored input. */
export const VILLAGE: VillageDescription = {
  name: "Ashcombe",
  seed: 20250903,
  terrain: { size: 120, resolution: 48, relief: 2.5 },
  street: { length: 70, width: 7 },
  houses: [
    { name: "Forge", along: 8, side: -1, width: 9, depth: 7, storeys: 1, roof: "gable" },
    { name: "Bakery", along: 22, side: -1, width: 7, depth: 8, storeys: 2, roof: "gable" },
    { name: "Inn", along: 38, side: -1, width: 12, depth: 9, storeys: 2, roof: "hip" },
    { name: "Cooper", along: 56, side: -1, width: 8, depth: 7, storeys: 1, roof: "gable" },
    { name: "Chandler", along: 14, side: 1, width: 8, depth: 7, storeys: 1, roof: "gable" },
    { name: "Weaver", along: 30, side: 1, width: 9, depth: 8, storeys: 2, roof: "gable" },
    { name: "Store", along: 48, side: 1, width: 11, depth: 9, storeys: 1, roof: "flat" },
  ],
  vegetation: { trees: 90, rocks: 40, minSpacing: 3.5 },
  population: 12,
};

export interface Placement {
  readonly position: readonly [number, number, number];
  readonly rotationY: number;
  readonly scale: number;
}

export interface GeneratedVillage {
  readonly terrain: GeneratedTerrain;
  readonly buildings: readonly { readonly name: string; readonly building: GeneratedBuilding; readonly asset: CompiledAsset; readonly placement: Placement }[];
  readonly trees: readonly { readonly mesh: MeshData; readonly placements: readonly Placement[] }[];
  readonly rocks: readonly { readonly mesh: MeshData; readonly placements: readonly Placement[] }[];
  readonly npcs: readonly GeneratedCharacter[];
  readonly stats: VillageStats;
}

export interface VillageStats {
  readonly descriptionBytes: number;
  readonly buildings: number;
  readonly uniqueTriangles: number;
  readonly instancedTriangles: number;
  readonly navSurfaces: number;
  readonly navLinks: number;
  readonly npcBones: number;
  readonly generationMs: number;
}

/** Turns one house description into a full building specification. */
function houseSpec(house: HouseDescription, street: VillageDescription["street"]): Parameters<typeof generateBuilding>[0] {
  const storeyHeight = 2.7;
  const [halfWidth, halfDepth] = [house.width / 2, house.depth / 2];
  // The front wall faces the street, so its door goes on the near side.
  const frontIsNorth = house.side === -1;
  return {
    name: house.name,
    wallThickness: 0.25,
    floors: Array.from({ length: house.storeys }, (_, storey) => ({
      level: storey * storeyHeight,
      height: storeyHeight,
      walls: rectangularWalls(-halfWidth, -halfDepth, halfWidth, halfDepth, {
        openings:
          storey === 0
            ? {
                // Ground floor: a door onto the street, windows either side.
                [frontIsNorth ? "north" : "south"]: [
                  { kind: "door" as const, offset: house.width / 2, width: 1.1, height: 2.1 },
                ],
                east: [{ offset: house.depth / 2, width: 1.1, height: 1.1, sill: 1 }],
                west: [{ offset: house.depth / 2, width: 1.1, height: 1.1, sill: 1 }],
              }
            : {
                // Upper floors: windows only.
                [frontIsNorth ? "north" : "south"]: [{ offset: house.width / 2, width: 1, height: 1, sill: 1 }],
                east: [{ offset: house.depth / 2, width: 1, height: 1, sill: 1 }],
              },
      }),
      rooms: [
        {
          name: `${house.name} ${storey === 0 ? "ground" : `floor ${storey + 1}`}`,
          footprint: [
            [-halfWidth + 0.3, -halfDepth + 0.3],
            [halfWidth - 0.3, -halfDepth + 0.3],
            [halfWidth - 0.3, halfDepth - 0.3],
            [-halfWidth + 0.3, halfDepth - 0.3],
          ] as const,
        },
      ],
      ...(house.storeys > 1 && storey === 0
        ? { stairs: [{ position: [halfWidth - 1.2, halfDepth - 1.5] as const, rotation: 180, steps: 15, rise: storeyHeight }] }
        : {}),
    })),
    roof: { kind: house.roof, pitchHeight: 1.6, overhang: 0.4 },
  };
}

/** Generates the whole village from its description. */
export function generateVillage(description: VillageDescription = VILLAGE): GeneratedVillage {
  const started = Date.now();
  const random = seededRandom(description.seed);

  const terrain = generateTerrain({
    width: description.terrain.size,
    depth: description.terrain.size,
    resolution: description.terrain.resolution,
    amplitude: description.terrain.relief,
    seed: description.seed,
  });

  const buildings = description.houses.map((house) => {
    const building = generateBuilding(houseSpec(house, description.street));
    const x = house.side * (description.street.width / 2 + house.depth / 2 + 1.5);
    const z = house.along - description.street.length / 2;
    return {
      name: house.name,
      building,
      asset: compileBuilding(building, { lodLevels: 3 }),
      placement: {
        // Sit each house on the terrain, facing the street.
        position: [x, sampleTerrainHeight(terrain, x, z), z] as const,
        rotationY: house.side === -1 ? 0 : 180,
        scale: 1,
      },
    };
  });

  // Trees and rocks are generated once per variant and *instanced*, because
  // merging ninety trees into one mesh is how a scene becomes unrenderable.
  const treeVariants = Array.from({ length: 4 }, (_, index) =>
    generateTree({ kind: index === 3 ? "conifer" : "broadleaf", height: 5 + random() * 4, seed: description.seed + index, branchDepth: 2 }),
  );
  const rockVariants = Array.from({ length: 3 }, (_, index) =>
    generateRock({ radius: 0.4 + random() * 0.8, roughness: 0.4, seed: description.seed + 100 + index }),
  );

  const clearStreet = (placements: readonly Placement[]): Placement[] =>
    // Keep vegetation off the street and away from the houses.
    placements.filter((placement) => Math.abs(placement.position[0]) > description.street.width / 2 + 12);

  const treePlacements = clearStreet(
    scatterOnTerrain(terrain, {
      count: description.vegetation.trees,
      seed: description.seed + 1,
      minSpacing: description.vegetation.minSpacing,
      maxSlopeDegrees: 30,
      margin: 4,
    }),
  );
  const rockPlacements = clearStreet(
    scatterOnTerrain(terrain, { count: description.vegetation.rocks, seed: description.seed + 2, minSpacing: 2, margin: 4 }),
  );

  const trees = treeVariants.map((tree, index) => ({
    mesh: tree.mesh,
    placements: treePlacements.filter((_, placement) => placement % treeVariants.length === index),
  }));
  const rocks = rockVariants.map((rock, index) => ({
    mesh: rock,
    placements: rockPlacements.filter((_, placement) => placement % rockVariants.length === index),
  }));

  const npcs = generateCrowd(description.population, { height: 1.75, limbSegments: 8 }, description.seed + 3);

  const uniqueTriangles =
    buildings.reduce((sum, entry) => sum + meshStats(entry.building.mesh).triangles, 0) +
    treeVariants.reduce((sum, tree) => sum + meshStats(tree.mesh).triangles, 0) +
    rockVariants.reduce((sum, rock) => sum + meshStats(rock).triangles, 0) +
    meshStats(terrain.mesh).triangles +
    (npcs[0] ? npcs.reduce((sum, npc) => sum + npc.stats.triangles, 0) : 0);

  const instancedTriangles =
    uniqueTriangles +
    trees.reduce((sum, variant) => sum + meshStats(variant.mesh).triangles * Math.max(0, variant.placements.length - 1), 0) +
    rocks.reduce((sum, variant) => sum + meshStats(variant.mesh).triangles * Math.max(0, variant.placements.length - 1), 0);

  return {
    terrain,
    buildings,
    trees,
    rocks,
    npcs,
    stats: {
      descriptionBytes: JSON.stringify(description).length,
      buildings: buildings.length,
      uniqueTriangles,
      instancedTriangles,
      navSurfaces: buildings.reduce((sum, entry) => sum + (entry.asset.navigation?.surfaces.length ?? 0), 0),
      navLinks: buildings.reduce((sum, entry) => sum + (entry.asset.navigation?.links.length ?? 0), 0),
      npcBones: npcs[0]?.stats.bones ?? 0,
      generationMs: Date.now() - started,
    },
  };
}

/** Merges everything unique into one mesh, for a quick single-draw preview.
 * Real rendering should instance the vegetation instead. */
export function previewMesh(village: GeneratedVillage): MeshData {
  const parts: MeshData[] = [village.terrain.mesh];
  for (const entry of village.buildings) {
    parts.push(placeMesh(entry.building.mesh, { position: entry.placement.position, rotation: [0, entry.placement.rotationY, 0] }));
  }
  for (const variant of [...village.trees, ...village.rocks]) {
    for (const placement of variant.placements) {
      parts.push(placeMesh(variant.mesh, { position: placement.position, rotation: [0, placement.rotationY, 0], scale: placement.scale }));
    }
  }
  return mergeMeshes(parts);
}
