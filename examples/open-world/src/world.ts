/** Open-world showcase: the large-world systems composed, headlessly.
 *
 * Proves that terrain, vegetation, partitioned streaming, the floating
 * origin, NavMesh baking, crowd navigation, and localized rebaking work
 * *together* using only public engine API — no sample-only hooks. Every step
 * is deterministic from the seed so the printed numbers are reproducible.
 */
import {
  Crowd,
  Diagnostics,
  FloatingOrigin,
  NavMesh,
  TerrainChunkGrid,
  TerrainHeightfield,
  TerrainMaterial,
  TerrainSculptor,
  WorldPartition,
  bakeNavMesh,
  generateProceduralHeights,
  scatterVegetation,
  type NavMeshInput,
  type RebakeReport,
  type VegetationInstance,
} from "@vapour/engine";

export interface OpenWorldOptions {
  readonly seed?: number;
  /** Heightfield samples per side. */
  readonly samples?: number;
  /** World-space width and depth in metres. */
  readonly extent?: number;
}

export interface OpenWorldStats {
  readonly chunks: number;
  readonly terrainTriangles: number;
  readonly vegetation: number;
  readonly navSpans: number;
  readonly residentCells: number;
  readonly originShifts: number;
  readonly agentState: string;
  readonly agentDistance: number;
  readonly rebake: RebakeReport | undefined;
}

export class OpenWorld {
  readonly diagnostics = new Diagnostics({ now: () => performance.now() });
  readonly heightfield: TerrainHeightfield;
  readonly grid: TerrainChunkGrid;
  readonly vegetation: readonly VegetationInstance[];
  readonly partition: WorldPartition;
  readonly origin: FloatingOrigin;
  readonly crowd: Crowd;
  #navmesh: NavMesh;
  #originShifts = 0;
  #rebake: RebakeReport | undefined;
  readonly #agentStart: readonly [number, number, number];
  readonly #extent: number;

  constructor(options: OpenWorldOptions = {}) {
    const seed = options.seed ?? 7;
    const samples = options.samples ?? 65;
    const extent = options.extent ?? 512;
    this.#extent = extent;
    // Rolling hills: gentle amplitude so most of the world is walkable.
    const sample = generateProceduralHeights({ seed, rows: samples, columns: samples, scale: [extent, 6, extent], noise: { octaves: 3, frequency: 0.02 } });
    this.heightfield = TerrainHeightfield.generate(samples, samples, [extent, 6, extent], (x, z) => sample(x, z));
    const material = new TerrainMaterial({ layers: [{ name: "grass" }, { name: "rock" }, { name: "sand" }] });
    this.grid = new TerrainChunkGrid({ heightfield: this.heightfield, material, chunkCells: 16 });
    this.vegetation = scatterVegetation(this.heightfield, {
      seed,
      rules: [
        { prototype: { id: "tree", meshId: "tree", impostorMeshId: "tree-card", impostorScreenHeight: 0.05, material: "bark", footprintRadius: 2 }, density: 0.004, maxSlopeDegrees: 30 },
        { prototype: { id: "rock", meshId: "rock", material: "stone", footprintRadius: 1 }, density: 0.001 },
      ],
    });
    this.partition = new WorldPartition({ cellSize: 64, loadRadius: 2, unloadPadding: 1 });
    this.origin = new FloatingOrigin({ threshold: 128 });
    this.#navmesh = bakeNavMesh(this.#navInput(), { cellSize: 4, agentRadius: 0.5, maxSlopeDegrees: 40 });
    this.crowd = new Crowd(this.#navmesh);
    this.#agentStart = this.#groundPoint(-extent * 0.25, -extent * 0.25);
    this.crowd.addAgent({ position: this.#agentStart, maxSpeed: 6, radius: 0.5 });
  }

  get navmesh(): NavMesh {
    return this.#navmesh;
  }

  /** Streams around a viewer and shifts the origin when it wanders far. */
  stream(viewer: readonly [number, number, number]): void {
    const local = this.origin.toLocal(viewer);
    const shift = this.origin.update(local);
    if (shift !== undefined) {
      this.#originShifts += 1;
      this.partition.applyOriginShift(shift);
    }
    const update = this.partition.update(this.origin.toLocal(viewer));
    this.diagnostics.set("world.residentCells", update.resident);
    this.diagnostics.add("world.cellLoads", update.toLoad.length);
  }

  /** Sends the agent walking to a far corner. */
  sendAgent(): boolean {
    const agent = this.crowd.agent(1)!;
    return this.crowd.setDestination(agent, this.#groundPoint(this.#extent * 0.25, this.#extent * 0.25));
  }

  step(deltaSeconds: number): void {
    this.diagnostics.begin("world.step");
    this.crowd.update(deltaSeconds);
    this.diagnostics.end("world.step");
  }

  /** Raises a hill under a region and rebakes only that region's navigation. */
  raiseHill(column: number, row: number, radius: number): RebakeReport {
    const sculptor = new TerrainSculptor(this.heightfield);
    const patch = sculptor.raise(column, row, { radius, strength: 1, falloff: "smooth" }, 8);
    // Terrain local space is centred on the origin; samples map to [-extent/2, extent/2].
    const cell = this.#extent / (this.heightfield.columns - 1);
    const half = this.#extent / 2;
    const report = this.#navmesh.rebakeRegion(this.#navInput(), {
      minX: (column - radius - 1) * cell - half,
      maxX: (column + radius + 1) * cell - half,
      minZ: (row - radius - 1) * cell - half,
      maxZ: (row + radius + 1) * cell - half,
    });
    this.#navmesh = report.navmesh;
    this.#rebake = report;
    this.diagnostics.set("world.sculptedSamples", patch.edits.length);
    return report;
  }

  stats(): OpenWorldStats {
    const agent = this.crowd.agent(1)!;
    const [sx, , sz] = this.#agentStart;
    const triangles = this.grid.chunks().reduce((sum, chunk) => sum + chunk.mesh().triangleCount, 0);
    return {
      chunks: this.grid.chunkCount,
      terrainTriangles: triangles,
      vegetation: this.vegetation.length,
      navSpans: this.#navmesh.spanCount,
      residentCells: this.diagnostics.counter("world.residentCells").value,
      originShifts: this.#originShifts,
      agentState: agent.state,
      agentDistance: Math.hypot(agent.position[0] - sx, agent.position[2] - sz),
      rebake: this.#rebake,
    };
  }

  #navInput(): NavMeshInput {
    const mesh = this.heightfield.mesh();
    return { positions: mesh.positions, indices: mesh.indices };
  }

  #groundPoint(x: number, z: number): readonly [number, number, number] {
    const height = this.heightfield.sampleHeight(x, z);
    if (height === undefined) throw new Error(`(${String(x)}, ${String(z)}) lies outside the terrain.`);
    return [x, height, z];
  }
}
