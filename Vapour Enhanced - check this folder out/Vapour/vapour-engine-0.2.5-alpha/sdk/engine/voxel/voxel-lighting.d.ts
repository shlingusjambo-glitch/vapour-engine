/** Voxel lighting: block-light propagation, top-down skylight, and bounded
 * incremental relight after an edit.
 *
 * Light is stored per chunk, one byte per voxel, nibble-packed (`sky << 4 |
 * block`) — 4 bits is exactly enough range for the 0..15 attenuation levels
 * both channels use, and packing halves storage against two byte arrays. This
 * mirrors `VoxelChunk`'s own dense `Uint16Array` layout so a light chunk and a
 * block chunk always agree on which coordinates exist.
 *
 * Both channels are a breadth-first flood fill from their sources — emissive
 * blocks for block light, every column open to the sky for skylight — losing
 * one level per step through a non-opaque block and stopping at an opaque
 * one. That is the whole algorithm; the only real design decision is *how
 * much of the world* a relight has to touch.
 */
import { type VoxelPalette, type VoxelWorld } from "./voxel-world.js";
export declare const MAX_LIGHT_LEVEL = 15;
export interface VoxelLightSample {
    readonly block: number;
    readonly sky: number;
}
/**
 * Block-light and skylight for a `VoxelWorld`, recomputed on demand.
 *
 * This does not subscribe to the world's edits automatically — call
 * `relight(x, y, z)` after `world.setBlock(...)`, the same way a mesher is
 * told to remesh the dirtied chunks. That keeps lighting an explicit,
 * synchronous step a game can budget per frame rather than a hidden cost of
 * every block edit.
 */
export declare class VoxelLightField {
    #private;
    constructor(world: VoxelWorld, palette: VoxelPalette);
    get(x: number, y: number, z: number): VoxelLightSample;
    /**
     * Fully recomputes every currently-loaded chunk from scratch: a top-down
     * skylight pass per column, then a combined BFS flood for both channels
     * across every loaded chunk. Call this once after bulk-loading a region
     * (e.g. a freshly generated or deserialized area); after that, prefer the
     * far cheaper `relight`.
     */
    recomputeAll(): void;
    /**
     * Recomputes light in a padded box around one changed voxel.
     *
     * Light can travel at most `MAX_LIGHT_LEVEL` blocks from any source, so a
     * source further than that from the edit cannot be affected by it, and
     * nothing inside the box can be lit from further than that either. The
     * box's outer shell therefore keeps whatever light it already holds — that
     * value was computed correctly by an earlier call and the edit cannot have
     * changed it — and doubles as the fixed boundary condition the interior
     * reflood reads from, exactly like a Dirichlet boundary.
     *
     * ponytail: this reflood does not itself widen the box when a very bright,
     * newly-exposed source sits right at the boundary and would have thrown
     * light past it — call `relight` again centred further out (or
     * `recomputeAll`) if a change near a chunk boundary looks under-lit. A
     * region larger than `MAX_LIGHT_LEVEL` on every axis removes the gap
     * entirely at the cost of relighting more voxels.
     */
    relight(x: number, y: number, z: number, radius?: number): void;
}
//# sourceMappingURL=voxel-lighting.d.ts.map