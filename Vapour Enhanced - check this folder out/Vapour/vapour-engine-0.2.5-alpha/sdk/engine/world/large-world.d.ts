/** Large-world coordinates: floating origin and world partitioning.
 *
 * A 32-bit float has about seven significant decimal digits. Near the origin
 * that is nanometre precision; ten kilometres out it is roughly a millimetre,
 * and a hundred kilometres out roughly a centimetre. Vertices, matrices, and
 * physics all run in `f32` on the GPU and across the WASM boundary, so a world
 * larger than a few kilometres develops visible jitter: geometry shimmers,
 * physics contacts chatter, and a camera rotating in place appears to vibrate.
 *
 * The fix is not more precision — it is keeping the numbers small. A floating
 * origin stores world position in `f64` and periodically **rebases** everything
 * so the camera sits near zero, which is what makes an open world of any size
 * behave as well as a small one.
 *
 * This cannot be retrofitted cheaply: every system that caches a world position
 * has to learn about rebasing. So the shift is published as an event with the
 * delta, and systems subscribe.
 */
import { Signal } from "../framework/signal.js";
/** A position in double precision, which the engine's `f32` path cannot hold. */
export type WorldPosition = readonly [number, number, number];
export interface FloatingOriginOptions {
    /**
     * Distance from the current origin at which a rebase happens.
     *
     * Large enough that rebasing is rare, small enough that `f32` precision
     * stays comfortable. A kilometre keeps rendered coordinates under ~1 mm of
     * error while rebasing perhaps once a minute of travel.
     */
    readonly threshold?: number;
    /**
     * Round the shift to a multiple of this.
     *
     * Snapping keeps procedural content, shadow cascades, and texture sampling
     * stable across a rebase: an unsnapped shift changes the fractional part of
     * every coordinate and makes noise-based terrain visibly crawl.
     */
    readonly snap?: number;
}
export interface OriginShift {
    /** Movement applied to every rendered position, in world units. */
    readonly delta: WorldPosition;
    /** The new origin, in absolute world space. */
    readonly origin: WorldPosition;
    readonly shiftCount: number;
}
/**
 * Keeps rendered coordinates near zero for an arbitrarily large world.
 *
 * Absolute positions are held in `f64` here; everything downstream sees a local
 * position that never grows large.
 */
export declare class FloatingOrigin {
    #private;
    /** Emitted after each rebase, so systems can move cached positions. */
    readonly shifted: Signal<OriginShift>;
    constructor(options?: FloatingOriginOptions);
    /** The current origin in absolute world space. */
    get origin(): WorldPosition;
    get shiftCount(): number;
    /** Converts an absolute world position into engine-local coordinates. */
    toLocal(world: WorldPosition): [number, number, number];
    /** Converts engine-local coordinates back to absolute world space. */
    toWorld(local: WorldPosition): [number, number, number];
    /**
     * Rebases if the viewer has strayed too far, returning the shift if so.
     *
     * Called with the viewer's **local** position, because that is what a camera
     * actually has after a previous rebase.
     */
    update(viewerLocal: WorldPosition): OriginShift | undefined;
    /** Applies a shift to a position, for systems handling the event. */
    static apply(position: readonly number[], shift: OriginShift): [number, number, number];
    /** Applies a shift in place across a packed position buffer. */
    static applyToBuffer(positions: Float32Array, shift: OriginShift, stride?: number): void;
    /** Resets to absolute zero, for a level change. */
    reset(origin?: WorldPosition): void;
    /**
     * Worst-case `f32` precision at a distance, in world units.
     *
     * Exposed so a game can assert its threshold is actually tight enough rather
     * than discovering the jitter in play.
     */
    static precisionAt(distance: number): number;
}
export interface PartitionCell {
    readonly x: number;
    readonly z: number;
    /** Distance in cells from the viewer's cell. */
    readonly ring: number;
}
export interface WorldPartitionOptions {
    /** Edge length of one cell, in world units. */
    readonly cellSize?: number;
    /** Cells loaded around the viewer, as a radius in cells. */
    readonly loadRadius?: number;
    /**
     * Extra radius before a cell is unloaded.
     *
     * Without hysteresis a viewer standing on a boundary loads and unloads the
     * same cell every frame — the single most common streaming bug.
     */
    readonly unloadPadding?: number;
}
export interface PartitionUpdate {
    readonly toLoad: readonly PartitionCell[];
    readonly toUnload: readonly PartitionCell[];
    readonly resident: number;
}
/**
 * A grid of world cells with hysteresis.
 *
 * Complements `ChunkStreamManager`, which owns the *loading*; this owns the
 * decision of what should be resident. Separating them means the policy can be
 * tested without any asynchronous loading at all.
 */
export declare class WorldPartition {
    #private;
    constructor(options?: WorldPartitionOptions);
    get cellSize(): number;
    get residentCells(): readonly PartitionCell[];
    /** The cell containing a position. */
    cellOf(position: WorldPosition): {
        x: number;
        z: number;
    };
    /** World-space centre of a cell, for placing and culling its contents. */
    centerOf(cell: {
        x: number;
        z: number;
    }): [number, number, number];
    /** Updates residency for a viewer, returning what changed. */
    update(viewer: WorldPosition): PartitionUpdate;
    /** Shifts every resident cell after a floating-origin rebase. */
    applyOriginShift(shift: OriginShift): void;
    clear(): void;
}
export interface TerrainLodLevel {
    /** Vertices along one edge of a chunk at this level. */
    readonly resolution: number;
    /** Chunks within this many cells of the viewer use this level. */
    readonly ringRadius: number;
}
/**
 * Chooses a terrain chunk's mesh resolution by distance.
 *
 * Terrain LOD is by *ring*, not by screen size, because neighbouring chunks
 * must agree: two adjacent chunks at different resolutions leave a crack along
 * their shared edge, and a screen-size rule makes which pairs differ
 * unpredictable. Rings make adjacency predictable, so seams can be stitched.
 */
export declare function selectTerrainLod(levels: readonly TerrainLodLevel[], ring: number): TerrainLodLevel;
/**
 * Which edges of a chunk border a coarser neighbour.
 *
 * Those edges need their vertices collapsed to the neighbour's spacing, or the
 * height mismatch shows as a visible crack. Returning the set lets a mesher
 * stitch exactly the edges that need it and no others.
 */
export declare function terrainSeams(levels: readonly TerrainLodLevel[], cell: PartitionCell, viewerCell: {
    x: number;
    z: number;
}): {
    readonly north: boolean;
    readonly south: boolean;
    readonly east: boolean;
    readonly west: boolean;
};
//# sourceMappingURL=large-world.d.ts.map