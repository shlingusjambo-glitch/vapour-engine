/** World streaming keeps the navmesh current: a loaded chunk is walkable, an
 * unloaded one is not.
 *
 * `ChunkStreamManager` emits `ready` and `unloaded` per chunk;
 * `NavMesh.rebakeRegion` rebakes one world-space rectangle and returns a new
 * mesh. This joins them: each event rebakes exactly the chunk's footprint —
 * with the chunk's walkable geometry on load, with nothing on unload — and
 * the `navmesh` getter always points at the latest mesh. Agents and crowds
 * that hold a `NavMesh` should read it from here each tick rather than
 * caching it, because a rebake is a new object.
 *
 * Rebakes are synchronous and happen inside the stream event, so a chunk is
 * never briefly loaded-but-unwalkable. A world with no navigation yet starts
 * from `bakeNavMesh` over zero triangles.
 */
import { bakeNavMesh, type NavMesh, type NavMeshInput, type NavMeshSettings, type RebakeRegion, type RebakeReport } from "../ai/navmesh.js";
import { spatialChunkKey, type ChunkStreamEvent, type SpatialChunkCoordinate } from "../world/world-streaming.js";

export interface StreamingNavMeshOptions<T> {
  /** World-space size of one chunk along X and Z. */
  readonly chunkSize: number;
  /** Walkable triangles of a loaded chunk, in world space. */
  readonly geometry: (value: T, coordinate: SpatialChunkCoordinate) => NavMeshInput;
  /** The mesh to start from. Default: an empty bake with `settings`. */
  readonly navmesh?: NavMesh;
  readonly settings?: NavMeshSettings;
  /** Called after each rebake, for diagnostics. */
  readonly onRebake?: (coordinate: SpatialChunkCoordinate, report: RebakeReport) => void;
}

const EMPTY: NavMeshInput = { positions: new Float32Array(0), indices: new Uint32Array(0) };

function merge(inputs: readonly NavMeshInput[]): NavMeshInput {
  if (inputs.length === 0) return EMPTY;
  if (inputs.length === 1) return inputs[0]!;
  const positions = new Float32Array(inputs.reduce((total, input) => total + input.positions.length, 0));
  const indices = new Uint32Array(inputs.reduce((total, input) => total + input.indices.length, 0));
  let vertex = 0;
  let index = 0;
  for (const input of inputs) {
    positions.set(input.positions, vertex);
    const base = vertex / 3;
    for (let at = 0; at < input.indices.length; at += 1) indices[index + at] = input.indices[at]! + base;
    vertex += input.positions.length;
    index += input.indices.length;
  }
  return { positions, indices };
}

export class StreamingNavMesh<T> {
  readonly #options: StreamingNavMeshOptions<T>;
  readonly #loaded = new Map<string, NavMeshInput>();
  #navmesh: NavMesh;
  #rebakes = 0;

  constructor(options: StreamingNavMeshOptions<T>) {
    if (!(options.chunkSize > 0)) throw new Error("A streaming navmesh chunk size must be positive.");
    this.#options = options;
    this.#navmesh = options.navmesh ?? bakeNavMesh(EMPTY, options.settings);
  }

  /** The current mesh. Changes identity on every rebake. */
  get navmesh(): NavMesh {
    return this.#navmesh;
  }

  get rebakes(): number {
    return this.#rebakes;
  }

  /** World-space rectangle a chunk's load or unload rebakes: its footprint plus the erosion margin. */
  region(coordinate: SpatialChunkCoordinate): RebakeRegion {
    const size = this.#options.chunkSize;
    const { agentRadius, cellSize } = this.#navmesh.settings;
    const margin = agentRadius + cellSize;
    return { minX: coordinate.x * size - margin, maxX: (coordinate.x + 1) * size + margin, minZ: coordinate.z * size - margin, maxZ: (coordinate.z + 1) * size + margin };
  }

  /** Wire to `ChunkStreamManager.subscribe`. Failed loads change nothing. */
  handle(event: ChunkStreamEvent<T>): void {
    if (event.type === "failed") return;
    const key = spatialChunkKey(event.coordinate);
    if (event.type === "ready") this.#loaded.set(key, this.#options.geometry(event.value, event.coordinate));
    else this.#loaded.delete(key);
    // ponytail: concatenates every loaded chunk per event; the rebake only
    // rasterizes triangles touching the region, so switch to the 3x3
    // neighbourhood if the copy shows up in profiles.
    const report = this.#navmesh.rebakeRegion(merge([...this.#loaded.values()]), this.region(event.coordinate));
    this.#navmesh = report.navmesh;
    this.#rebakes += 1;
    this.#options.onRebake?.(event.coordinate, report);
  }
}
