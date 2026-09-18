import type { RenderWorldSnapshot } from "./render-world.js";
export interface PickRay {
    readonly origin: readonly [number, number, number];
    /** Unit-length direction in world space. */
    readonly direction: readonly [number, number, number];
}
export interface PickHit {
    readonly entityId: string;
    /** Distance along the ray, in world units, to the nearest surface. */
    readonly distance: number;
}
/**
 * Builds a world-space ray through a normalized device coordinate.
 *
 * `ndcX` and `ndcY` are in [-1, 1] with +Y up, matching WebGPU clip space. The
 * camera basis comes straight from the snapshot the renderer consumed, so a
 * pick always agrees with what is currently on screen.
 */
export declare function rayThroughViewport(snapshot: RenderWorldSnapshot, ndcX: number, ndcY: number, aspectRatio: number): PickRay;
/**
 * Returns the nearest instance the ray enters, or `undefined` for empty space.
 *
 * Each instance is tested as an oriented box sized from its mesh's own extents:
 * the ray is moved into the instance's local space and clipped against those
 * slabs. Selection is therefore bounds-accurate rather than triangle-accurate —
 * clicking the corner of a sphere's box selects it — which is fast, predictable,
 * and needs no depth-buffer readback. Instances with a degenerate (zero-scale)
 * transform are skipped rather than producing a divide-by-zero hit.
 */
export declare function pickInstance(snapshot: RenderWorldSnapshot, ray: PickRay): PickHit | undefined;
/** Convenience pick straight from viewport pixels. */
export declare function pickAtPixel(snapshot: RenderWorldSnapshot, pixelX: number, pixelY: number, widthPixels: number, heightPixels: number): PickHit | undefined;
/** Inverts a column-major affine (rotation, scale, translation) matrix, or
 * returns undefined when it is singular. */
export declare function invertAffine(matrix: ArrayLike<number>): number[] | undefined;
//# sourceMappingURL=picking.d.ts.map