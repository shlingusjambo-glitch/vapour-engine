import { describe, expect, it } from "vitest";
import { WorldPartition } from "./large-world.js";
import { generateProceduralHeights } from "./terrain-sculpt.js";
import { TerrainChunkGrid, TerrainMaterial } from "./terrain-chunks.js";
import { TerrainHeightfield } from "./terrain.js";
import { scatterVegetation, vegetationInstances, vegetationLodRegistry, type VegetationPrototype } from "./vegetation.js";
import type { RenderCameraSnapshot } from "../render/render-world.js";

/**
 * A large streamed terrain, its full vegetation scatter, and sustained
 * partition churn from a moving viewer: the three costs an open world pays
 * every session and none of which a small demo ever exercises. Bounds are
 * deliberately loose — this must not flake on a loaded CI box — and the real
 * numbers are printed so a regression is visible long before it trips an
 * assertion, exactly like `packages/net/src/net-scale.perf.test.ts`.
 */
const HEIGHTFIELD_RESOLUTION = 257; // 256x256 cells
const CHUNK_CELLS = 32; // 8x8 = 64 chunks
const WORLD_SIZE = 2048;

const TERRAIN_MESH_AVERAGE_MS_BOUND = 15;
const TERRAIN_MESH_WORST_MS_BOUND = 200;

const VEGETATION_DENSITY = 0.002; // instances per square world unit
const VEGETATION_SCATTER_MS_BOUND = 500;

const PARTITION_TICKS = 500;
const PARTITION_AVERAGE_MS_BOUND = 2;
const PARTITION_WORST_MS_BOUND = 50;

function buildTerrain(): TerrainChunkGrid {
  const sampler = generateProceduralHeights({
    seed: "world-scale-perf",
    rows: HEIGHTFIELD_RESOLUTION,
    columns: HEIGHTFIELD_RESOLUTION,
    scale: [WORLD_SIZE, 96, WORLD_SIZE],
    noise: { octaves: 5, frequency: 1 / 300 },
  });
  const field = TerrainHeightfield.generate(HEIGHTFIELD_RESOLUTION, HEIGHTFIELD_RESOLUTION, [WORLD_SIZE, 96, WORLD_SIZE], sampler);
  const material = new TerrainMaterial({ layers: [{ name: "grass" }, { name: "rock" }, { name: "sand" }] });
  return new TerrainChunkGrid({ heightfield: field, chunkCells: CHUNK_CELLS, material });
}

describe("world scale", () => {
  it(`meshes a ${String(HEIGHTFIELD_RESOLUTION)}x${String(HEIGHTFIELD_RESOLUTION)} terrain's chunks within budget`, () => {
    const grid = buildTerrain();
    const viewerChunk = { x: Math.floor(grid.chunksX / 2), z: Math.floor(grid.chunksZ / 2) };
    const levels = [
      { resolution: CHUNK_CELLS + 1, ringRadius: 2 },
      { resolution: CHUNK_CELLS / 2 + 1, ringRadius: 5 },
      { resolution: CHUNK_CELLS / 4 + 1, ringRadius: 100 },
    ];

    let worstMs = 0;
    let totalMs = 0;
    let totalVertices = 0;
    let totalTriangles = 0;
    const chunks = grid.chunks();
    for (const chunk of chunks) {
      const started = performance.now();
      const mesh = grid.chunkMesh(chunk, levels, viewerChunk, { skirtDepth: 1 });
      const elapsed = performance.now() - started;
      worstMs = Math.max(worstMs, elapsed);
      totalMs += elapsed;
      totalVertices += mesh.vertexCount;
      totalTriangles += mesh.triangleCount;
    }
    const averageMs = totalMs / chunks.length;

    console.log(
      `[world-scale] terrain: ${String(chunks.length)} chunks, ${String(totalVertices)} vertices, ${String(totalTriangles)} triangles: ` +
        `${averageMs.toFixed(3)} ms/chunk avg, ${worstMs.toFixed(3)} ms worst`,
    );

    expect(chunks.length).toBe(grid.chunksX * grid.chunksZ);
    expect(averageMs).toBeLessThan(TERRAIN_MESH_AVERAGE_MS_BOUND);
    expect(worstMs).toBeLessThan(TERRAIN_MESH_WORST_MS_BOUND);
  });

  it("scatters and LOD-batches vegetation across the whole terrain within budget", () => {
    const grid = buildTerrain();
    const field = grid.heightfield;
    const tree: VegetationPrototype = {
      id: "tree", meshId: "mesh:tree", impostorMeshId: "mesh:tree-impostor", impostorScreenHeight: 0.08,
      material: "mat:foliage", footprintRadius: 2,
    };
    const rock: VegetationPrototype = { id: "rock", meshId: "mesh:rock", material: "mat:rock", footprintRadius: 1 };
    const prototypes = [tree, rock];

    const started = performance.now();
    const placements = scatterVegetation(field, {
      seed: "world-scale-vegetation",
      rules: [
        { prototype: tree, density: VEGETATION_DENSITY, maxSlopeDegrees: 35 },
        { prototype: rock, density: VEGETATION_DENSITY / 4, minHeight: -10 },
      ],
    });
    const instances = vegetationInstances(placements, prototypes);
    const registry = vegetationLodRegistry(prototypes);
    const camera: RenderCameraSnapshot = {
      entityId: "cam", worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, WORLD_SIZE / 2, 20, WORLD_SIZE / 2, 1],
      fieldOfView: 60, near: 0.1, far: 4000,
    };
    const lod = registry.apply(instances, camera);
    const elapsedMs = performance.now() - started;

    console.log(
      `[world-scale] vegetation: ${String(placements.length)} instances scattered, ` +
        `${String(lod.stats.drawn)} drawn (${String(lod.stats.culled)} culled) in ${elapsedMs.toFixed(2)} ms`,
    );

    expect(placements.length).toBeGreaterThan(1000);
    expect(elapsedMs).toBeLessThan(VEGETATION_SCATTER_MS_BOUND);
  });

  it(`sustains ${String(PARTITION_TICKS)} ticks of streaming churn from a moving viewer within budget`, () => {
    const partition = new WorldPartition({ cellSize: 128, loadRadius: 4, unloadPadding: 1 });
    let worstMs = 0;
    let totalMs = 0;
    let totalLoads = 0;
    let totalUnloads = 0;
    for (let tick = 0; tick < PARTITION_TICKS; tick += 1) {
      // A viewer sweeping across the world, guaranteeing continuous
      // load/unload churn rather than settling into a static residency set.
      const viewer: readonly [number, number, number] = [tick * 37, 0, tick * 19];
      const started = performance.now();
      const update = partition.update(viewer);
      const elapsed = performance.now() - started;
      worstMs = Math.max(worstMs, elapsed);
      totalMs += elapsed;
      totalLoads += update.toLoad.length;
      totalUnloads += update.toUnload.length;
    }
    const averageMs = totalMs / PARTITION_TICKS;

    console.log(
      `[world-scale] streaming: ${String(PARTITION_TICKS)} ticks, ${String(totalLoads)} total loads, ${String(totalUnloads)} total unloads: ` +
        `${averageMs.toFixed(4)} ms/tick avg, ${worstMs.toFixed(3)} ms worst`,
    );

    expect(totalLoads).toBeGreaterThan(0);
    expect(averageMs).toBeLessThan(PARTITION_AVERAGE_MS_BOUND);
    expect(worstMs).toBeLessThan(PARTITION_WORST_MS_BOUND);
  });
});
