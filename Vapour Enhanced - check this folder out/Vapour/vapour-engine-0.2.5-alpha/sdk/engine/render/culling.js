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
import { aabbFromCenterExtents, frustumFromViewProjection, frustumIntersectsAabb, multiplyMat4, transformAabb, } from "@vapour/math";
import { pickingHalfExtents } from "../assets/mesh-library.js";
import { viewProjectionMatrix } from "./projection.js";
/**
 * World-space bounds of one instance.
 *
 * The local box comes from the mesh library's picking half-extents — the same
 * source the editor uses to select and frame objects — so what culling believes
 * about an object's size always matches what clicking it believes.
 */
export function instanceBounds(instance, margin = 0) {
    const half = pickingHalfExtents(instance.mesh);
    const local = aabbFromCenterExtents([0, 0, 0], [half[0] + margin, half[1] + margin, half[2] + margin]);
    return transformAabb(local, instance.modelMatrix);
}
/** Squared distance from a camera's position to an instance's origin. */
function distanceSquaredToCamera(camera, instance) {
    const m = instance.modelMatrix;
    const c = camera.worldMatrix;
    const dx = (m[12] ?? 0) - (c[12] ?? 0);
    const dy = (m[13] ?? 0) - (c[13] ?? 0);
    const dz = (m[14] ?? 0) - (c[14] ?? 0);
    return dx * dx + dy * dy + dz * dz;
}
/** Culls a list of instances against an explicit frustum. */
export function cullInstances(instances, frustum, options = {}) {
    const margin = options.boundsMargin ?? 0;
    if (margin < 0)
        throw new Error("A culling bounds margin must not be negative.");
    const maxDistance = options.maxDistance;
    if (maxDistance !== undefined && !(maxDistance > 0))
        throw new Error("A culling max distance must be positive.");
    const maxDistanceSquared = maxDistance === undefined ? undefined : maxDistance * maxDistance;
    const visible = [];
    let culledByFrustum = 0;
    let culledByDistance = 0;
    for (const instance of instances) {
        if (maxDistanceSquared !== undefined && options.camera !== undefined) {
            if (distanceSquaredToCamera(options.camera, instance) > maxDistanceSquared) {
                culledByDistance += 1;
                continue;
            }
        }
        if (!frustumIntersectsAabb(frustum, instanceBounds(instance, margin))) {
            culledByFrustum += 1;
            continue;
        }
        visible.push(instance);
    }
    return {
        instances: visible,
        stats: {
            total: instances.length,
            visible: visible.length,
            culledByFrustum,
            culledByDistance,
        },
    };
}
/** Builds the frustum a camera snapshot describes. */
export function cameraFrustum(camera, aspectRatio) {
    return frustumFromViewProjection(viewProjectionMatrix(camera, aspectRatio));
}
/**
 * Culls a whole render world against its own camera.
 *
 * A world with no camera is returned untouched: there is nothing to cull
 * against, and silently dropping every instance would look like a renderer bug.
 */
export function cullRenderWorld(world, aspectRatio, options = {}) {
    if (!(aspectRatio > 0))
        throw new Error("Culling requires a positive aspect ratio.");
    const camera = world.camera;
    if (camera === undefined) {
        return {
            world,
            stats: {
                total: world.instances.length,
                visible: world.instances.length,
                culledByFrustum: 0,
                culledByDistance: 0,
            },
        };
    }
    const result = cullInstances(world.instances, cameraFrustum(camera, aspectRatio), { ...options, camera });
    return {
        world: { ...world, instances: result.instances },
        stats: result.stats,
    };
}
/**
 * A frustum for a shadow cascade or any other sub-range of a camera's depth.
 *
 * Cascaded shadow maps need the frustum slice between two depths rather than
 * the whole view, and so does any system that partitions the view by distance.
 */
export function cameraSliceFrustum(camera, aspectRatio, near, far) {
    if (!(near > 0 && far > near))
        throw new Error("A camera slice requires 0 < near < far.");
    const sliced = { ...camera, near, far };
    return frustumFromViewProjection(viewProjectionMatrix(sliced, aspectRatio));
}
/** Combines a view and a projection into a view-projection matrix. Exposed
 * because culling, LOD, and picking all need the same composition. */
export function composeViewProjection(projection, view) {
    return multiplyMat4(projection, view);
}
//# sourceMappingURL=culling.js.map