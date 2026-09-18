import type { RenderCameraSnapshot } from "./render-world.js";
export interface EditorCameraState {
    readonly target: readonly [number, number, number];
    readonly distance: number;
    /** Radians around world +Y, measured from world +Z. */
    readonly yaw: number;
    /** Radians above the XZ plane, clamped just short of the poles. */
    readonly pitch: number;
    readonly fieldOfView: number;
    readonly near: number;
    readonly far: number;
}
export interface Bounds {
    readonly center: readonly [number, number, number];
    /** Radius of a sphere enclosing the content; zero for a single point. */
    readonly radius: number;
}
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
export declare class EditorCamera {
    #private;
    constructor(state?: Partial<EditorCameraState>);
    get state(): EditorCameraState;
    /** Orbits around the pivot. Inputs are pixel deltas from a pointer drag. */
    orbit(deltaXPixels: number, deltaYPixels: number, radiansPerPixel?: number): void;
    /** Slides the pivot across the view plane, matching cursor speed at the
     * pivot's depth so dragging feels like grabbing the scene. */
    pan(deltaXPixels: number, deltaYPixels: number, viewportHeightPixels: number): void;
    /** Moves toward or away from the pivot. `steps` is normalized wheel notches;
     * the response is multiplicative so zoom feels even at every scale. */
    dolly(steps: number, zoomPerStep?: number): void;
    /** Frames content so its bounding sphere fits the vertical field of view. */
    focus(bounds: Bounds): void;
    /** Camera position in world space. */
    position(): [number, number, number];
    /** Column-major world matrix. Column 2 is +Z, so the renderer's -Z forward
     * convention points at the pivot. */
    worldMatrix(): number[];
    snapshot(): RenderCameraSnapshot;
}
/**
 * Bounding sphere enclosing the given instances in world space.
 *
 * Each instance is sized from its mesh's own half-extents, so framing a plane
 * does not zoom out as if it were a cube. Callers that have no mesh — the
 * editor framing an empty or a camera, for instance — omit it and get the
 * default unit box, which is the right footprint for a gizmo-only object.
 */
export declare function boundsOfInstances(instances: readonly {
    readonly entityId: string;
    readonly modelMatrix: readonly number[];
    readonly mesh?: string;
}[]): Bounds | undefined;
//# sourceMappingURL=editor-camera.d.ts.map