import { LodRegistry } from "../render/lod.js";
import type { RenderInstanceSnapshot } from "../render/render-world.js";
import { type ProceduralSeed } from "./procedural-noise.js";
import type { TerrainHeightfield } from "./terrain.js";
/** One kind of scattered object: a full mesh plus, optionally, a cheaper
 * stand-in drawn once the instance is small on screen. */
export interface VegetationPrototype {
    readonly id: string;
    /** Mesh-library id of the full-detail mesh. */
    readonly meshId: string;
    /** Mesh-library id of a flat billboard/impostor mesh, used once the
     * instance's projected screen height drops below `impostorScreenHeight`. */
    readonly impostorMeshId?: string;
    readonly impostorScreenHeight?: number;
    /** Cull entirely below this screen height. */
    readonly cullScreenHeight?: number;
    readonly material: string;
    /** Roughly how much ground one instance occupies, in world units. Used to
     * space placements so canopies do not fully overlap. */
    readonly footprintRadius: number;
    readonly minScale?: number;
    readonly maxScale?: number;
    readonly baseColor?: readonly [number, number, number, number];
}
export interface VegetationScatterRule {
    readonly prototype: VegetationPrototype;
    /** Instances attempted per square world unit before rejection rules apply.
     * Small (e.g. 0.02 = one attempt per 50 square units) — this is a Poisson-ish
     * density knob, not a guaranteed count. */
    readonly density: number;
    /** Placement is rejected outside this local-space height range (after
     * `TerrainHeightfield.scale[1]`). */
    readonly minHeight?: number;
    readonly maxHeight?: number;
    /** Placement is rejected where the surface slope, in degrees from
     * horizontal, exceeds this. */
    readonly maxSlopeDegrees?: number;
}
export interface VegetationScatterOptions {
    readonly seed: ProceduralSeed;
    readonly rules: readonly VegetationScatterRule[];
}
export interface VegetationInstance {
    readonly prototypeId: string;
    readonly position: readonly [number, number, number];
    readonly rotationY: number;
    readonly scale: number;
}
/**
 * Deterministically scatters vegetation instances over a heightfield's local
 * space (the same centred space `TerrainHeightfield.mesh()` uses).
 *
 * Each rule gets its own named substream (`fork(prototype.id)`), so adding or
 * removing one prototype does not reshuffle every other prototype's placement.
 */
export declare function scatterVegetation(field: TerrainHeightfield, options: VegetationScatterOptions): readonly VegetationInstance[];
/**
 * Converts scattered placements into renderer-ready instances, one per
 * prototype's *full-detail* mesh. Pair with `vegetationLodRegistry` and
 * `LodRegistry.apply` to switch distant instances to their impostor.
 */
export declare function vegetationInstances(instances: readonly VegetationInstance[], prototypes: readonly VegetationPrototype[]): readonly RenderInstanceSnapshot[];
/** Builds an `LodRegistry` switching each prototype with an impostor to it
 * below `impostorScreenHeight`, and culling below `cullScreenHeight` when
 * given. Prototypes without an impostor are left undefined, which
 * `LodRegistry.apply` already draws untouched at full detail. */
export declare function vegetationLodRegistry(prototypes: readonly VegetationPrototype[]): LodRegistry;
//# sourceMappingURL=vegetation.d.ts.map