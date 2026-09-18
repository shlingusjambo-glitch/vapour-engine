import type { ColliderShape3d } from "../physics/physics-3d.js";
import type { MeshUpload } from "../render/host/index.js";
export interface TerrainHeightfieldOptions {
    /** Samples along world Z. Must be at least two. */
    readonly rows: number;
    /** Samples along world X. Must be at least two. */
    readonly columns: number;
    /** Row-major samples: `heights[z * columns + x]`. */
    readonly heights: readonly number[] | Float32Array;
    /** Total world-space width, height multiplier, and depth. */
    readonly scale: readonly [number, number, number];
    /** UV repetitions across the full terrain. Defaults to one. */
    readonly uvScale?: readonly [number, number];
}
/** One authoritative terrain surface for rendering, physics, grounding, and AI.
 * Coordinates are centered around the owning entity, matching Rapier's native
 * heightfield. Games no longer need a visual mesh plus box-collider proxies. */
export declare class TerrainHeightfield {
    readonly rows: number;
    readonly columns: number;
    readonly heights: Float32Array;
    readonly scale: readonly [number, number, number];
    readonly uvScale: readonly [number, number];
    constructor(options: TerrainHeightfieldOptions);
    /** Samples a height generator at normalized [0,1] grid coordinates. The
     * callback is deterministic and worker-safe when its inputs are. */
    static generate(rows: number, columns: number, scale: readonly [number, number, number], sampler: (x: number, z: number, column: number, row: number) => number, uvScale?: readonly [number, number]): TerrainHeightfield;
    /** Bilinear local-space elevation. Returns undefined beyond the terrain. */
    sampleHeight(localX: number, localZ: number): number | undefined;
    /** Rapier-native collision descriptor using the exact same samples. */
    collider(): ColliderShape3d;
    /** Indexed, smooth-normal render mesh matching `collider()` vertex-for-vertex. */
    mesh(): MeshUpload;
    private height;
}
//# sourceMappingURL=terrain.d.ts.map