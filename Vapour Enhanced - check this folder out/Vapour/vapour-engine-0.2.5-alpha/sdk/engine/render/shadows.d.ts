/** Cascaded shadow map setup.
 *
 * A single shadow map covering a whole view either has no resolution near the
 * camera or covers nothing far from it. Cascades split the view's depth range
 * into slices and give each its own map, so the near slice gets the texel
 * density it needs and the far slice still reaches the horizon.
 *
 * Vapour's split of labour puts this computation in TypeScript and the drawing
 * in Rust: the matrices are pure maths, they change every frame with the
 * camera, and getting them wrong produces the two classic artefacts — peter
 * panning and shimmering edges — that are far easier to debug against unit
 * tests than against a screenshot. The renderer receives finished matrices and
 * simply renders depth into each cascade.
 *
 * Two details here are what separate a working cascade setup from a broken one:
 *
 * - **Texel snapping.** The light's projection is quantized to whole shadow-map
 *   texels, so a camera moving smoothly does not make shadow edges crawl. This
 *   is the single most visible difference between a real implementation and a
 *   naive one.
 * - **A sphere-based bound per cascade.** Fitting the light's box to the
 *   cascade's bounding *sphere* rather than its corners keeps the shadow map's
 *   extent constant as the camera rotates, which is the other half of stopping
 *   shimmer.
 */
import { type Mat4, type Vec3 } from "@vapour/math";
import type { RenderCameraSnapshot } from "./render-world.js";
export interface ShadowCascade {
    /** Index from the camera outward; 0 is nearest. */
    readonly index: number;
    /** Depth range this cascade covers, in view-space units from the camera. */
    readonly near: number;
    readonly far: number;
    /** Light-space view-projection the depth pass renders with. */
    readonly viewProjection: Mat4;
    /** Radius of the cascade's bounding sphere, in world units. */
    readonly radius: number;
    /** World-space centre of that sphere. */
    readonly center: Vec3;
    /** World units per shadow-map texel. Useful for choosing a depth bias. */
    readonly texelWorldSize: number;
}
export interface PointShadow {
    /** World-space position of the light. */
    readonly position: Vec3;
    /** The six view-projections for the cube map faces. */
    readonly views: readonly Mat4[];
    /** The light's far plane. */
    readonly far: number;
}
export interface SpotShadow {
    /** World-space position of the light. */
    readonly position: Vec3;
    /** Light-space view-projection. */
    readonly viewProjection: Mat4;
    /** The light's far plane. */
    readonly far: number;
}
export interface ShadowSettings {
    /** Number of cascades. Three or four is the usual range. */
    readonly cascadeCount?: number;
    /** Shadow map resolution per cascade, in texels. */
    readonly resolution?: number;
    /**
     * Blend between a uniform and a logarithmic split.
     *
     * `0` splits the range evenly, wasting near-camera resolution. `1` is fully
     * logarithmic, which is theoretically ideal but puts almost nothing in the
     * far cascades. The default of 0.75 is the practical compromise most engines
     * settle on.
     */
    readonly splitLambda?: number;
    /** Farthest distance shadows are cast to. Defaults to the camera's far plane,
     * which is usually far too generous — shadows rarely need the whole view. */
    readonly maxDistance?: number;
    /** Pushes the light's near plane back so casters behind the cascade still
     * appear in its map. */
    readonly casterDistance?: number;
}
export declare const DEFAULT_SHADOW_SETTINGS: Required<Omit<ShadowSettings, "maxDistance">>;
/**
 * Distances at which the view's depth range is split.
 *
 * Returns `cascadeCount + 1` boundaries, starting at `near` and ending at
 * `far`, using the practical split scheme: a blend of a uniform split (equal
 * world distance) and a logarithmic one (equal perspective foreshortening).
 */
export declare function cascadeSplits(near: number, far: number, cascadeCount: number, lambda?: number): number[];
/** The eight world-space corners of a camera's frustum between two depths. */
export declare function frustumCorners(camera: RenderCameraSnapshot, aspectRatio: number, near: number, far: number): Vec3[];
/**
 * The bounding sphere of a set of points.
 *
 * Cascades are fitted to a sphere rather than to the corner box because a
 * sphere is rotation invariant: the shadow map's extent then stays constant as
 * the camera turns, which is half of what stops shadow edges from shimmering.
 */
export declare function boundingSphere(points: readonly Vec3[]): {
    center: Vec3;
    radius: number;
};
/** Builds one cascade's light-space view-projection. */
export declare function computeCascade(camera: RenderCameraSnapshot, aspectRatio: number, lightDirection: readonly number[], near: number, far: number, index: number, settings?: ShadowSettings): ShadowCascade;
/**
 * Builds the full cascade set for a camera and a directional light.
 *
 * The returned cascades are ordered near to far, which is the order a shader
 * selects them in: the first cascade whose `far` exceeds the fragment's view
 * depth is the one to sample.
 */
export declare function computeCascades(camera: RenderCameraSnapshot, aspectRatio: number, lightDirection: readonly number[], settings?: ShadowSettings): readonly ShadowCascade[];
/**
 * A depth bias scaled to a cascade's texel size.
 *
 * A constant bias is wrong for cascades: the far cascade's texels cover far
 * more world space, so the bias that stops acne there causes visible peter
 * panning near the camera. Scaling with texel size gives one authored number
 * that behaves correctly at every cascade.
 */
export declare function cascadeDepthBias(cascade: ShadowCascade, biasTexels?: number): number;
/** Packs cascade split distances for upload, padded to the shader's fixed array. */
export declare function packCascadeSplits(cascades: readonly ShadowCascade[], maxCascades?: number): Float32Array;
/** Packs cascade matrices contiguously for a single uniform upload. */
export declare function packCascadeMatrices(cascades: readonly ShadowCascade[], maxCascades?: number): Float32Array;
/** The cascade a view-space depth falls into, matching the shader's selection. */
export declare function selectCascade(cascades: readonly ShadowCascade[], viewDepth: number): number | undefined;
//# sourceMappingURL=shadows.d.ts.map