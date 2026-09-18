import { pickingHalfExtents } from "../assets/mesh-library.js";
const MIN_DISTANCE = 0.05;
const MAX_DISTANCE = 20_000;
/** Keeps the orbit basis well conditioned: at exactly ±90° pitch the world-up
 * reference becomes parallel to the view direction and the frame collapses. */
const MAX_PITCH = Math.PI / 2 - 1e-3;
/**
 * Scene-view camera for the editor viewport.
 *
 * This camera is editor state, never scene data: navigating the viewport must
 * not dirty the document or move the game's `vapour.Camera`. It produces the
 * same `RenderCameraSnapshot` shape the scene camera does, so the Rust renderer
 * consumes both through one code path.
 *
 * All math is deliberately dependency free and synchronous so it is unit
 * testable without a browser or GPU.
 */
export class EditorCamera {
    #target;
    #distance;
    #yaw;
    #pitch;
    #fieldOfView;
    #near;
    #far;
    constructor(state = {}) {
        this.#target = [...(state.target ?? [0, 0, 0])];
        this.#distance = clamp(state.distance ?? 8, MIN_DISTANCE, MAX_DISTANCE);
        this.#yaw = state.yaw ?? Math.PI * 0.2;
        this.#pitch = clamp(state.pitch ?? 0.42, -MAX_PITCH, MAX_PITCH);
        this.#fieldOfView = clamp(state.fieldOfView ?? 60, 1, 179);
        this.#near = Math.max(state.near ?? 0.05, 1e-4);
        this.#far = Math.max(state.far ?? 5_000, this.#near * 10);
    }
    get state() {
        return {
            target: [...this.#target],
            distance: this.#distance,
            yaw: this.#yaw,
            pitch: this.#pitch,
            fieldOfView: this.#fieldOfView,
            near: this.#near,
            far: this.#far,
        };
    }
    /** Orbits around the pivot. Inputs are pixel deltas from a pointer drag. */
    orbit(deltaXPixels, deltaYPixels, radiansPerPixel = 0.0075) {
        if (!Number.isFinite(deltaXPixels) || !Number.isFinite(deltaYPixels))
            return;
        this.#yaw -= deltaXPixels * radiansPerPixel;
        this.#pitch = clamp(this.#pitch + deltaYPixels * radiansPerPixel, -MAX_PITCH, MAX_PITCH);
    }
    /** Slides the pivot across the view plane, matching cursor speed at the
     * pivot's depth so dragging feels like grabbing the scene. */
    pan(deltaXPixels, deltaYPixels, viewportHeightPixels) {
        if (!Number.isFinite(deltaXPixels) || !Number.isFinite(deltaYPixels))
            return;
        const height = Math.max(1, viewportHeightPixels);
        const worldPerPixel = (2 * this.#distance * Math.tan(degreesToRadians(this.#fieldOfView) / 2)) /
            height;
        const { right, up } = this.#basis();
        for (let axis = 0; axis < 3; axis += 1) {
            this.#target[axis] =
                this.#target[axis] +
                    (-deltaXPixels * right[axis] + deltaYPixels * up[axis]) *
                        worldPerPixel;
        }
    }
    /** Moves toward or away from the pivot. `steps` is normalized wheel notches;
     * the response is multiplicative so zoom feels even at every scale. */
    dolly(steps, zoomPerStep = 1.15) {
        if (!Number.isFinite(steps))
            return;
        this.#distance = clamp(this.#distance * zoomPerStep ** steps, MIN_DISTANCE, MAX_DISTANCE);
    }
    /** Frames content so its bounding sphere fits the vertical field of view. */
    focus(bounds) {
        if (bounds.center.some((value) => !Number.isFinite(value)) ||
            !Number.isFinite(bounds.radius)) {
            throw new Error("Cannot focus the viewport on non-finite bounds.");
        }
        this.#target = [...bounds.center];
        const radius = Math.max(bounds.radius, 0.25);
        const fitted = radius / Math.sin(degreesToRadians(this.#fieldOfView) / 2);
        this.#distance = clamp(fitted * 1.1, MIN_DISTANCE, MAX_DISTANCE);
    }
    /** Camera position in world space. */
    position() {
        const cosPitch = Math.cos(this.#pitch);
        return [
            this.#target[0] + this.#distance * cosPitch * Math.sin(this.#yaw),
            this.#target[1] + this.#distance * Math.sin(this.#pitch),
            this.#target[2] + this.#distance * cosPitch * Math.cos(this.#yaw),
        ];
    }
    /** Column-major world matrix. Column 2 is +Z, so the renderer's -Z forward
     * convention points at the pivot. */
    worldMatrix() {
        const position = this.position();
        const { right, up, back } = this.#basis();
        return [
            right[0],
            right[1],
            right[2],
            0,
            up[0],
            up[1],
            up[2],
            0,
            back[0],
            back[1],
            back[2],
            0,
            position[0],
            position[1],
            position[2],
            1,
        ];
    }
    snapshot() {
        return {
            entityId: "editor:scene-camera",
            worldMatrix: this.worldMatrix(),
            fieldOfView: this.#fieldOfView,
            near: this.#near,
            far: this.#far,
        };
    }
    #basis() {
        const cosPitch = Math.cos(this.#pitch);
        // `back` points from the pivot toward the camera, i.e. the camera's +Z.
        const back = [
            cosPitch * Math.sin(this.#yaw),
            Math.sin(this.#pitch),
            cosPitch * Math.cos(this.#yaw),
        ];
        const right = normalize(cross([0, 1, 0], back));
        const up = cross(back, right);
        return { right, up, back };
    }
}
/**
 * Bounding sphere enclosing the given instances in world space.
 *
 * Each instance is sized from its mesh's own half-extents, so framing a plane
 * does not zoom out as if it were a cube. Callers that have no mesh — the
 * editor framing an empty or a camera, for instance — omit it and get the
 * default unit box, which is the right footprint for a gizmo-only object.
 */
export function boundsOfInstances(instances) {
    if (instances.length === 0)
        return undefined;
    let minimum = [Infinity, Infinity, Infinity];
    let maximum = [-Infinity, -Infinity, -Infinity];
    for (const instance of instances) {
        const matrix = instance.modelMatrix;
        const center = [
            matrix[12],
            matrix[13],
            matrix[14],
        ];
        const local = instance.mesh === undefined
            ? [0.5, 0.5, 0.5]
            : pickingHalfExtents(instance.mesh);
        // Conservative world extent of the local box under an affine transform.
        const extent = [0, 1, 2].map((axis) => Math.abs(matrix[axis]) * local[0] +
            Math.abs(matrix[4 + axis]) * local[1] +
            Math.abs(matrix[8 + axis]) * local[2]);
        for (let axis = 0; axis < 3; axis += 1) {
            minimum[axis] = Math.min(minimum[axis], center[axis] - extent[axis]);
            maximum[axis] = Math.max(maximum[axis], center[axis] + extent[axis]);
        }
    }
    const center = [0, 1, 2].map((axis) => (minimum[axis] + maximum[axis]) / 2);
    const radius = Math.hypot(...[0, 1, 2].map((axis) => (maximum[axis] - minimum[axis]) / 2));
    return { center, radius };
}
function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}
function normalize(value) {
    const length = Math.hypot(value[0], value[1], value[2]);
    if (length < Number.EPSILON)
        throw new Error("Cannot normalize a zero-length editor camera basis vector.");
    return [value[0] / length, value[1] / length, value[2] / length];
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
function degreesToRadians(degrees) {
    return (degrees * Math.PI) / 180;
}
//# sourceMappingURL=editor-camera.js.map