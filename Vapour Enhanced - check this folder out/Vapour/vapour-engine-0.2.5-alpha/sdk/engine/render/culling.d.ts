/** Frustum and distance culling for extracted render worlds.
 *
 * Before Mirage the renderer submitted every instance in the scene every frame:
 * draw submission was O(all objects), whether or not the camera could see them.
 * That is survivable for a demo and fatal for an open world, where the vast
 * majority of the scene is behind the camera or beyond the far plane.
 *
 * Culling here runs on the extracted snapshot rather than inside the renderer,
 * so it is testable without a GPU, reusable for shadow cascades and for
 * secondary cameras, and cheap to reason about: given a camera, it returns the
 * subset of instances that could be visible, plus the numbers that explain why
 * the rest were dropped.
 */
import { type Aabb, type Frustum } from "@vapour/math";
import type { RenderCameraSnapshot, RenderInstanceSnapshot, RenderWorldSnapshot } from "./render-world.js";
export interface CullStats {
    readonly total: number;
    readonly visible: number;
    readonly culledByFrustum: number;
    readonly culledByDistance: number;
}
export interface CullOptions {
    /** Instances farther than this from the camera are dropped before the
     * frustum test, which is the cheap win in an open world. */
    readonly maxDistance?: number;
    /**
     * Grows every bounding box by this many world units.
     *
     * Bounds come from the mesh library's picking extents, which describe the
     * base mesh rather than anything a shader displaces. A small margin keeps
     * vertex-animated or outlined geometry from popping at the screen edge.
     */
    readonly boundsMargin?: number;
}
export interface CullResult {
    readonly instances: readonly RenderInstanceSnapshot[];
    readonly stats: CullStats;
}
/**
 * World-space bounds of one instance.
 *
 * The local box comes from the mesh library's picking half-extents — the same
 * source the editor uses to select and frame objects — so what culling believes
 * about an object's size always matches what clicking it believes.
 */
export declare function instanceBounds(instance: RenderInstanceSnapshot, margin?: number): Aabb;
/** Culls a list of instances against an explicit frustum. */
export declare function cullInstances(instances: readonly RenderInstanceSnapshot[], frustum: Frustum, options?: CullOptions & {
    readonly camera?: RenderCameraSnapshot;
}): CullResult;
/** Builds the frustum a camera snapshot describes. */
export declare function cameraFrustum(camera: RenderCameraSnapshot, aspectRatio: number): Frustum;
/**
 * Culls a whole render world against its own camera.
 *
 * A world with no camera is returned untouched: there is nothing to cull
 * against, and silently dropping every instance would look like a renderer bug.
 */
export declare function cullRenderWorld(world: RenderWorldSnapshot, aspectRatio: number, options?: CullOptions): {
    world: RenderWorldSnapshot;
    stats: CullStats;
};
/**
 * A frustum for a shadow cascade or any other sub-range of a camera's depth.
 *
 * Cascaded shadow maps need the frustum slice between two depths rather than
 * the whole view, and so does any system that partitions the view by distance.
 */
export declare function cameraSliceFrustum(camera: RenderCameraSnapshot, aspectRatio: number, near: number, far: number): Frustum;
/** Combines a view and a projection into a view-projection matrix. Exposed
 * because culling, LOD, and picking all need the same composition. */
export declare function composeViewProjection(projection: readonly number[], view: readonly number[]): number[];
//# sourceMappingURL=culling.d.ts.map