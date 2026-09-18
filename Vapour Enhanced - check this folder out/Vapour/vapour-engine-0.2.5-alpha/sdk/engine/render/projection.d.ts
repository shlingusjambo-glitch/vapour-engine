import type { RenderCameraSnapshot } from "./render-world.js";
export type Mat4 = number[];
export type Vec3 = [number, number, number];
export interface ViewportPoint {
    readonly x: number;
    readonly y: number;
    /** Clip-space depth; negative when the point is behind the camera. */
    readonly depth: number;
    /** False when the point sits behind the near plane and must not be drawn. */
    readonly visible: boolean;
}
/**
 * World→clip matrix matching the Rust renderer's camera convention exactly:
 * right-handed, looking down the camera's -Z, with WebGPU's 0..1 depth range.
 * Editor overlays project through this so gizmo handles land on the pixels the
 * renderer actually drew.
 */
export declare function viewProjectionMatrix(camera: RenderCameraSnapshot, aspectRatio: number): Mat4;
/** Inverse of the camera's world matrix, exploiting its orthonormal basis. */
export declare function viewMatrix(camera: RenderCameraSnapshot): Mat4;
export declare function perspective(fieldOfViewDegrees: number, aspectRatio: number, near: number, far: number): Mat4;
export declare function orthographic(verticalSize: number, aspectRatio: number, near: number, far: number): Mat4;
/** Projects a world point to viewport pixels, origin at the top-left. */
export declare function projectToViewport(viewProjection: Mat4, point: readonly number[], widthPixels: number, heightPixels: number): ViewportPoint;
/** World-units-per-pixel at a given world position, used to keep gizmo handles
 * a constant on-screen size regardless of distance. */
export declare function worldUnitsPerPixel(camera: RenderCameraSnapshot, point: readonly number[], heightPixels: number): number;
/**
 * Distance in pixels from a point to a line segment, and how far along the
 * segment the closest approach lies. Gizmo axis hit-testing runs entirely in
 * screen space so handles stay grabbable at any camera angle.
 */
export declare function distanceToSegment(point: readonly [number, number], start: readonly [number, number], end: readonly [number, number]): {
    distance: number;
    t: number;
};
/**
 * How far to move along a world axis so the dragged handle tracks the cursor.
 *
 * The axis is projected to screen space and the pointer delta is projected onto
 * it, which is the standard screen-space translate/scale drag: it stays stable
 * when the axis is nearly edge-on, where a plane-intersection solve blows up.
 */
export declare function dragAlongAxis(origin: ViewportPoint, axisTip: ViewportPoint, axisWorldLength: number, pointerDelta: readonly [number, number]): number;
/** Signed angle in radians swept around a screen-space pivot between two
 * pointer positions, used by the rotation gizmo. */
export declare function sweptAngle(pivot: readonly [number, number], from: readonly [number, number], to: readonly [number, number]): number;
export declare function multiply(left: Mat4, right: Mat4): Mat4;
//# sourceMappingURL=projection.d.ts.map