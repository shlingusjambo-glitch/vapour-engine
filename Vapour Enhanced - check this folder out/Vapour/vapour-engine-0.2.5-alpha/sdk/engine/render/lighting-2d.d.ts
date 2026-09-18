/** 2D point/spot/global lights and normal-map-free light accumulation.
 *
 * No shaders, no GPU: this is the pure-computation half a sprite renderer
 * needs — given a list of lights and a sample point (or a grid of them),
 * produce the colour to multiply a sprite's texel by. A 2D game rarely has
 * normal maps, so lighting here is the honest simplification that implies:
 * intensity falls off with distance and (for spot lights) angle, but a
 * sprite's own surface orientation plays no part, unlike 3D lighting.
 */
export interface Light2D {
    readonly kind: "point" | "spot" | "global";
    readonly position?: readonly [number, number];
    /** Distance at which intensity reaches 0. Ignored for `global`. */
    readonly radius?: number;
    /** How the fall-off curves from full intensity at the light to zero at
     * `radius`: `linear` ramps evenly, `quadratic` (the default, physically
     * closer to a real point light) falls off faster near the edge. */
    readonly falloff?: "linear" | "quadratic";
    readonly color?: readonly [number, number, number];
    readonly intensity?: number;
    /** Spot direction in radians (0 = +X) and half-angle in radians. */
    readonly direction?: number;
    readonly coneAngle?: number;
}
/** Intensity multiplier `[0, 1]` a single light contributes at `point`,
 * ignoring colour. */
export declare function lightAttenuation(light: Light2D, point: readonly [number, number]): number;
/** This light's contribution at `point`: colour times intensity times
 * attenuation. Additive — combine several with {@link accumulateLighting2D}. */
export declare function lightContribution(light: Light2D, point: readonly [number, number]): [number, number, number];
/** Sums every light's contribution at one point. This is the per-pixel (or
 * per-tile, if `point` is a tile centre) operation a sprite/tile renderer
 * multiplies its texel by. */
export declare function accumulateLighting2D(lights: readonly Light2D[], point: readonly [number, number], ambient?: readonly [number, number, number]): [number, number, number];
export interface LightGrid2D {
    readonly width: number;
    readonly height: number;
    /** `rgb` per cell, row-major: `[r0,g0,b0, r1,g1,b1, ...]`. */
    readonly colors: Float32Array;
}
/** Bakes a per-cell light-colour buffer over a `width x height` grid of
 * cells sized `cellSize` world units, with `origin` as the world position of
 * cell (0, 0)'s corner — exactly the shape a tilemap or a 2D light-map
 * texture wants to sample once per frame (or once, for static lights)
 * instead of walking the light list per sprite. */
export declare function accumulateLightGrid(lights: readonly Light2D[], options: {
    readonly width: number;
    readonly height: number;
    readonly cellSize?: number;
    readonly origin?: readonly [number, number];
    readonly ambient?: readonly [number, number, number];
}): LightGrid2D;
//# sourceMappingURL=lighting-2d.d.ts.map