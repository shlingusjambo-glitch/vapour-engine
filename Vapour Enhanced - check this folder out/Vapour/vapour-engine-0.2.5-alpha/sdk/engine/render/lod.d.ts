import type { RenderCameraSnapshot, RenderInstanceSnapshot } from "./render-world.js";
export interface LodLevel {
    /** Mesh drawn at this level. */
    readonly mesh: string;
    /**
     * Draw this level while the object covers at least this fraction of the
     * viewport's height. Levels are ordered most to least detailed, so their
     * thresholds descend.
     */
    readonly minScreenHeight: number;
}
export interface LodChain {
    readonly levels: readonly LodLevel[];
    /**
     * Stop drawing entirely below this screen height. Omit to always draw the
     * least detailed level.
     */
    readonly cullScreenHeight?: number;
}
export interface LodOptions {
    /**
     * Multiplies every threshold. Above 1 keeps detail longer (a quality
     * setting); below 1 drops it sooner (a performance setting). This is the one
     * knob a game exposes to players.
     */
    readonly bias?: number;
}
export interface LodStats {
    readonly total: number;
    readonly drawn: number;
    readonly culled: number;
    /** How many instances were drawn at each level index. */
    readonly perLevel: readonly number[];
}
export interface LodResult {
    readonly instances: readonly RenderInstanceSnapshot[];
    readonly stats: LodStats;
}
export declare function validateLodChain(chain: LodChain, meshId: string): LodChain;
/**
 * Fraction of the viewport's height an object's bounding sphere covers.
 *
 * For a perspective camera this is `radius / (distance * tan(fov/2))`; for an
 * orthographic camera it is independent of distance, which is exactly the
 * behaviour an orthographic view should have.
 */
export declare function projectedScreenHeight(camera: RenderCameraSnapshot, worldRadius: number, distance: number): number;
/** Index of the level to draw, or `undefined` when the object is too small. */
export declare function selectLodLevel(chain: LodChain, screenHeight: number, options?: LodOptions): number | undefined;
/** Bounding radius of a mesh, from the same extents culling and picking use. */
export declare function meshRadius(meshId: string): number;
/**
 * A registry mapping a base mesh id to its LOD chain.
 *
 * Meshes with no chain are drawn as authored, so LOD is opt-in per asset and
 * adding it to one asset cannot change how any other renders.
 */
export declare class LodRegistry {
    #private;
    define(meshId: string, chain: LodChain): void;
    has(meshId: string): boolean;
    get(meshId: string): LodChain | undefined;
    get meshIds(): readonly string[];
    /**
     * Rewrites each instance to the mesh its LOD chain selects, dropping the ones
     * that are too small to be worth drawing.
     *
     * Instances whose mesh has no chain pass through untouched and are counted at
     * level 0, so `perLevel[0]` reads as "drawn at full detail" either way.
     */
    apply(instances: readonly RenderInstanceSnapshot[], camera: RenderCameraSnapshot, options?: LodOptions): LodResult;
}
//# sourceMappingURL=lod.d.ts.map