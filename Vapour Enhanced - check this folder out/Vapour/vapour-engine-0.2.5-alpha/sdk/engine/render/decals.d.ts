export declare const DECAL_STRIDE = 28;
export declare const MAX_DECALS = 4096;
export interface DecalSubmission {
    /** Column-major world matrix of the unit decal box. Scale sets the
     * projected size (x, y) and depth reach (z). */
    readonly matrix: ArrayLike<number>;
    /** Atlas rectangle `[u0, v0, u1, v1]`; defaults to the whole texture. */
    readonly region?: readonly [number, number, number, number];
    /** Linear RGBA multiplier; defaults to opaque white. */
    readonly tint?: readonly [number, number, number, number];
    /** Overall alpha in [0, 1]. Defaults to 1. */
    readonly opacity?: number;
    /** Cosine of the surface angle at which the decal has fully faded (its
     * projection axis against the surface normal). 0 keeps it on every
     * surface; 0.35 (the default) drops it from surfaces more than ~70° off. */
    readonly angleCutoff?: number;
    /** Width of the angle fade, also in cosine. Defaults to 0.2. */
    readonly angleSoftness?: number;
    /** Fraction of the box's half depth over which alpha fades to zero at the
     * front and back faces, in [0, 1]. Defaults to 0.25. */
    readonly zFade?: number;
}
/** Packs decals into the renderer's record layout. */
export declare function packDecals(decals: readonly DecalSubmission[], target?: Float32Array<ArrayBuffer>): Float32Array;
/** Where `point` lands on a decal's projected image: `u`/`v` in [0, 1]
 * (`v` runs down, so an upright decal reads its atlas the right way up) and
 * the local depth in [-0.5, 0.5], or undefined when the point is outside the
 * box. Mirrors `decal_local_uv` in Rust and the projection in `decal.wgsl`. */
export declare function decalLocalUv(matrix: ArrayLike<number>, point: readonly [number, number, number]): {
    u: number;
    v: number;
    depth: number;
} | undefined;
//# sourceMappingURL=decals.d.ts.map