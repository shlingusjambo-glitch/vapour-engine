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
import { type NavMesh, type NavMeshInput, type NavMeshSettings, type RebakeRegion, type RebakeReport } from "../ai/navmesh.js";
import { type ChunkStreamEvent, type SpatialChunkCoordinate } from "../world/world-streaming.js";
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
export declare class StreamingNavMesh<T> {
    #private;
    constructor(options: StreamingNavMeshOptions<T>);
    /** The current mesh. Changes identity on every rebake. */
    get navmesh(): NavMesh;
    get rebakes(): number;
    /** World-space rectangle a chunk's load or unload rebakes: its footprint plus the erosion margin. */
    region(coordinate: SpatialChunkCoordinate): RebakeRegion;
    /** Wire to `ChunkStreamManager.subscribe`. Failed loads change nothing. */
    handle(event: ChunkStreamEvent<T>): void;
}
//# sourceMappingURL=streaming-navmesh.d.ts.map