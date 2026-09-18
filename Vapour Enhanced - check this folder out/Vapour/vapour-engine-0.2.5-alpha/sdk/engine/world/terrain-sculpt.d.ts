/** Terrain sculpt/paint tooling and procedural terrain generation.
 *
 * Sculpting mutates `TerrainHeightfield.heights` in place — the same buffer
 * `mesh()`, `collider()`, and `TerrainChunkGrid` already read — so an edit is
 * visible to every consumer without a second copy to keep in sync. Every
 * operation is a deterministic function of (grid position, brush, strength):
 * no timers, no randomness, so the same sequence of calls produces the same
 * terrain on every machine, which is what a headless editor test and a
 * multiplayer edit-replication path both need.
 *
 * Paint uses the same brush shape over `TerrainSplatMap.paint`, which already
 * owns weight normalisation; this module only decides *which* vertices a
 * brush touches and *how strongly*.
 *
 * Undo is a command log of before/after patches rather than a snapshot stack:
 * a patch only stores the vertices an operation actually touched, so undoing a
 * small brush stroke on a large terrain is cheap.
 */
import { type FractalNoiseOptions, type ProceduralSeed } from "./procedural-noise.js";
import type { TerrainSplatMap } from "./terrain-chunks.js";
import type { TerrainHeightfield } from "./terrain.js";
export type BrushFalloff = "constant" | "linear" | "smooth";
export interface BrushOptions {
    /** Radius in grid cells (fractional allowed). */
    readonly radius: number;
    readonly falloff?: BrushFalloff;
    /** Overall multiplier in [0, 1] applied on top of the falloff curve. */
    readonly strength?: number;
}
/** Weight in [0, 1] for a sample at `distance` cells from the brush centre. */
export declare function brushWeight(distance: number, brush: BrushOptions): number;
export interface HeightEdit {
    readonly index: number;
    readonly before: number;
    readonly after: number;
}
/** One undoable operation: the exact set of heightfield samples it changed. */
export interface TerrainPatch {
    readonly kind: "height";
    readonly edits: readonly HeightEdit[];
}
export interface SplatEdit {
    readonly vertex: number;
    readonly before: readonly number[];
    readonly after: readonly number[];
}
export interface SplatPatch {
    readonly kind: "splat";
    readonly edits: readonly SplatEdit[];
}
export type EditPatch = TerrainPatch | SplatPatch;
/** Applies (or reverses) a patch. Used by both the sculptor and undo/redo. */
export declare function applyPatch(target: {
    readonly heightfield?: TerrainHeightfield;
    readonly splat?: TerrainSplatMap;
}, patch: EditPatch, direction?: "after" | "before"): void;
/** A linear undo/redo log of edit patches. */
export declare class TerrainEditHistory {
    #private;
    get canUndo(): boolean;
    get canRedo(): boolean;
    /** Records a patch that has already been applied. Clears the redo log, as
     * any linear history does once a fresh edit branches from it. */
    record(patch: EditPatch): void;
    undo(target: {
        readonly heightfield?: TerrainHeightfield;
        readonly splat?: TerrainSplatMap;
    }): EditPatch | undefined;
    redo(target: {
        readonly heightfield?: TerrainHeightfield;
        readonly splat?: TerrainSplatMap;
    }): EditPatch | undefined;
    clear(): void;
}
/** Sculpts a heightfield in place with brush-shaped, deterministic operations.
 * Every method returns the patch it applied, so a caller can feed it straight
 * into a `TerrainEditHistory` (or a network edit log) without recomputing it. */
export declare class TerrainSculptor {
    #private;
    private readonly field;
    constructor(field: TerrainHeightfield);
    raise(centerColumn: number, centerRow: number, brush: BrushOptions, amount: number): TerrainPatch;
    lower(centerColumn: number, centerRow: number, brush: BrushOptions, amount: number): TerrainPatch;
    /** Moves samples toward `targetHeight` (in the same normalized units
     * `TerrainHeightfield` stores, i.e. before `scale[1]`). */
    flatten(centerColumn: number, centerRow: number, brush: BrushOptions, targetHeight: number): TerrainPatch;
    /** Alias of `flatten`, named for the common "paint an exact elevation" case
     * where the whole brush is meant to reach the target rather than blend
     * toward it — same interpolation, since a single-radius brush is already at
     * full weight at its centre. */
    setHeight(centerColumn: number, centerRow: number, brush: BrushOptions, height: number): TerrainPatch;
    /** Box-blurs each touched sample toward its 3x3 neighbourhood average,
     * scaled by the brush weight. */
    smooth(centerColumn: number, centerRow: number, brush: BrushOptions): TerrainPatch;
}
/** Paints splat weights within a brush footprint, sharing the exact same
 * falloff shape sculpting uses so a "raise and paint rock" tool stays
 * consistent between its two effects. */
export declare class TerrainPaintbrush {
    private readonly splat;
    constructor(splat: TerrainSplatMap);
    paint(centerColumn: number, centerRow: number, brush: BrushOptions, layer: number): SplatPatch;
}
export interface ProceduralTerrainOptions {
    readonly seed: ProceduralSeed;
    readonly rows: number;
    readonly columns: number;
    readonly scale: readonly [number, number, number];
    readonly noise?: FractalNoiseOptions;
    /** Base elevation added under the noise, in normalized [-1, 1]-ish units
     * before `scale[1]`. Defaults to 0. */
    readonly base?: number;
    readonly uvScale?: readonly [number, number];
}
/** Deterministic terrain from `GradientNoise`, in the shape
 * `TerrainHeightfield.generate` expects. Kept here rather than duplicating a
 * noise field: this is a thin, documented default for "a plausible island of
 * hills from a seed", not a second noise implementation. */
export declare function generateProceduralHeights(options: ProceduralTerrainOptions): (x: number, z: number) => number;
//# sourceMappingURL=terrain-sculpt.d.ts.map